// 归因引擎：把新提示词的每一处改动逐个回退（反事实消融），
// 测它对模型输出的真实影响，并用「同一提示词重复生成」测出的噪声地板做校正。
//
// 为什么需要噪声校正：LLM 在 temperature=0 下也可能不保证逐字重复（实测
// deepseek-flash 同一请求 4 次得到 3 种不同输出）。如果不测噪声，随机波动
// 会被误判成「改动生效」。因此这里用多次采样估计：
//   组内变化率 w = 同一提示词不同采样之间被判「行为改变」的比例
//   组间变化率 c = 新提示词采样 与 回退后提示词采样 之间被判改变的比例
//   校正后影响 = max(0, (c - w) / (1 - w))

import { diffHunks, revertHunk, describeHunk } from './diff.mjs';
import { getPrompt, readProbes, saveAttribution, newId } from './store.mjs';
import { makeProvider } from './providers.mjs';
import { makeJudge, JUDGE_BATCH_SIZE } from './judge.mjs';
import { mapLimit } from './concurrency.mjs';
import { KINDS, KIND_CONFIDENCE, CAVEATS } from './schema.mjs';
import { shouldExtendSampling, describeSamplingPolicy, AMBIGUOUS_LOW, AMBIGUOUS_HIGH, NOISE_EXTEND_THRESHOLD } from './sampling.mjs';

export function verdictOf(effect) {
  if (effect >= 0.5) return 'decisive';
  if (effect >= 0.2) return 'partial';
  return 'inert';
}

export const VERDICT_LABEL = { decisive: '决定性', partial: '部分影响', inert: '无影响', unmeasured: '未测量' };

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (verdicts) => (verdicts.length ? verdicts.filter((v) => v.changed).length / verdicts.length : 0);
const CALLS_PER_JUDGE_BATCH = JUDGE_BATCH_SIZE;

function budgetError(max) {
  const err = new Error(`达到 --max-calls 预算（${max}，含判定器调用），实验提前结束`);
  err.code = 'PCAUSE_BUDGET';
  return err;
}

const isBudget = (err) => err && err.code === 'PCAUSE_BUDGET';

/**
 * 只计算「如果现在跑，大约会调用多少次模型」，不发起任何请求。
 * 供 --dry-run 与预算预检使用。verify 调用数因要等第一轮判定才知道是否触发，
 * 这里按「所有改动块都非无影响」取上限。
 */
export function minSamplesOf(opts, samples) {
  if (!opts.earlyStop) return samples;
  const requested = Math.floor(Number(opts.minSamples ?? 2) || 2);
  return Math.min(samples, Math.max(2, requested));
}

export function planCalls(opts, hunks, probes) {
  const samples = Math.max(1, Math.floor(Number(opts.samples ?? opts.repeats ?? 1) || 1));
  const earlyStop = Boolean(opts.earlyStop) && samples >= 2;
  const minSamples = minSamplesOf({ earlyStop, minSamples: opts.minSamples }, samples);
  // 上限：所有改动块都补采样（全部满采样）；下限：所有改动块都提前停止（只有基线满采样）。
  const generationCalls = probes.length * samples * (1 + hunks.length);
  const generationCallsMin = probes.length * samples + hunks.length * probes.length * minSamples;
  const noisePairs = probes.length * ((samples * (samples - 1)) / 2);
  const crossPairsPerHunk = probes.length * samples * samples;
  const crossPairsPerHunkMin = probes.length * samples * minSamples;
  const judgeIsLlm = (opts.judge || 'heuristic') !== 'heuristic';
  const judgeCalls = judgeIsLlm
    ? Math.ceil(noisePairs / CALLS_PER_JUDGE_BATCH) + hunks.length * Math.ceil(crossPairsPerHunk / CALLS_PER_JUDGE_BATCH)
    : 0;
  const judgeCallsMin = judgeIsLlm
    ? Math.ceil(noisePairs / CALLS_PER_JUDGE_BATCH) + hunks.length * Math.ceil(crossPairsPerHunkMin / CALLS_PER_JUDGE_BATCH)
    : 0;
  const verifyIsLlm = Boolean(opts.verify) && opts.verify !== 'heuristic';
  const verifyCallsMax = verifyIsLlm ? hunks.length * Math.ceil(crossPairsPerHunk / CALLS_PER_JUDGE_BATCH) : 0;
  const plannedCalls = generationCalls + judgeCalls + verifyCallsMax;
  const plannedCallsMin = generationCallsMin + judgeCallsMin;
  const maxCalls = opts.maxCalls || 400;
  const note =
    '预估按「无缓存」计算，实际运行时命中缓存会更少；verify 调用按「所有改动块都非无影响」取上限。' +
    (earlyStop
      ? ` 自适应采样已开启：plannedCalls 为「全部补采样」上限，plannedCallsMin 为「全部提前停止」下限（阈值固定 ${AMBIGUOUS_LOW}~${AMBIGUOUS_HIGH}，噪声地板 ≥${NOISE_EXTEND_THRESHOLD} 才补采样）。`
      : '');
  return {
    probes: probes.length,
    hunks: hunks.length,
    samples,
    earlyStop,
    minSamples,
    samplingPolicy: describeSamplingPolicy({ earlyStop, samples, minSamples }),
    generationCalls,
    generationCallsMin,
    judgeCalls,
    judgeCallsMin,
    verifyCallsMax,
    plannedCalls,
    plannedCallsMin,
    maxCalls,
    fitsBudget: plannedCalls <= maxCalls,
    note,
  };
}

/**
 * 跑一次归因实验。
 * @param {object} opts { old, new, probes, provider, model, judge, verify, limit, maxCalls, samples, repeats, temperature, cache, kind, dryRun }
 * @param {object} ctx  { log, dryRun }
 */
export async function attribute(opts, ctx = {}) {
  const { log = () => {} } = ctx;
  const dryRun = Boolean(ctx.dryRun || opts.dryRun);
  const t0 = Date.now();

  const kind = opts.kind || 'prompt';
  if (!KINDS.includes(kind)) throw new Error(`未知归因对象类型：${kind}（可选 ${KINDS.join(' / ')}）`);
  if (!KIND_CONFIDENCE[kind]) throw new Error(`未知归因对象类型：${kind}`);

  const oldP = getPrompt(opts.old);
  const newP = getPrompt(opts.new);
  const probes = readProbes(opts.probes, { limit: opts.limit || 0, warn: log });
  const hunks = diffHunks(oldP.text, newP.text, {
    onDegrade: (n, m) =>
      log(`⚠ 提示词较长（${n} / ${m} 行），diff 已退化为整段替换，无法逐块归因；结论粒度会变粗`),
  });
  if (!hunks.length) throw new Error(`「${opts.old}」与「${opts.new}」没有差异，无需归因`);
  const samples = Math.max(1, Math.floor(Number(opts.samples ?? opts.repeats ?? 1) || 1));
  const earlyStop = Boolean(opts.earlyStop);
  if (earlyStop && samples < 2) {
    throw new Error('--early-stop 需要 --samples ≥ 2（先测 2 次才谈得上「是否补采样」）');
  }
  const minSamples = minSamplesOf({ earlyStop, minSamples: opts.minSamples }, samples);
  const maxCalls = opts.maxCalls || 400;
  // 有界并发只影响「生成阶段」的调度；预算仍是硬上限（发起前预占，见 callGen）。
  const concurrency = Math.max(1, Math.floor(Number(opts.concurrency || 1) || 1));
  if (concurrency > 1) {
    log(`并发：生成阶段最多 ${concurrency} 个请求同时在飞（结果顺序按探针 + 采样序号固定）`);
    if (concurrency > 8) log('  ⚠ 并发过高容易触发 API 限流；建议 2~4');
  }
  if (earlyStop) {
    log(`采样策略：${describeSamplingPolicy({ earlyStop, samples, minSamples })}`);
  }

  // dry-run：只预估调用量，绝不发起任何模型请求（也不读取 API Key）。
  const plan = planCalls(opts, hunks, probes);
  if (dryRun) {
    log(
      `预演：${hunks.length} 个改动块 × ${probes.length} 个探针 × 每探针 ${samples} 次采样 ≈ ${plan.plannedCalls} 次模型调用` +
        `（生成 ${plan.generationCalls} + 判定 ${plan.judgeCalls} + 复核上限 ${plan.verifyCallsMax}），预算 ${maxCalls}`
    );
    if (!plan.fitsBudget) log(`  ⚠ 预估调用数超过预算；正式运行会在预算耗尽处提前结束，并标记「采样不足」`);
    if (earlyStop) log(`  自适应采样：下限 ${plan.plannedCallsMin} 次（全部提前停止）～ 上限 ${plan.plannedCalls} 次（全部补采样）`);
    return { dryRun: true, plan, kind, hunks: hunks.map((h) => ({ id: h.id, summary: describeHunk(h) })) };
  }

  const provider = makeProvider(opts.provider, {
    model: opts.model,
    temperature: opts.temperature,
    cache: opts.cache !== false,
    config: opts.config,
  });
  const judge = makeJudge(opts.judge, { model: opts.judgeModel, cache: opts.cache !== false, config: opts.config });
  const verifyJudge = opts.verify ? makeJudge(opts.verify, { model: opts.verifyModel, cache: opts.cache !== false, config: opts.config }) : null;

  const budget = { max: maxCalls, used: 0 };
  // 判定器内部同样会调用模型（deepseek / doubao），必须计入预算，
  // 否则 --max-calls 只约束了生成侧，判定侧可以无限烧钱。
  const judgeCallCount = () => (judge.stats?.calls ?? 0) + (verifyJudge?.stats?.calls ?? 0);
  let judgeCharged = 0;
  const chargeJudges = () => {
    const used = judgeCallCount();
    if (used > judgeCharged) {
      budget.used += used - judgeCharged;
      judgeCharged = used;
    }
    if (budget.used > budget.max) throw budgetError(budget.max);
  };
  const callGen = async (system, user) => {
    if (budget.used >= budget.max) throw budgetError(budget.max);
    budget.used++;
    return provider.generate({ system, user });
  };

  // 每个探针独立生成 samples 次；并发只改变调度，结果按 (探针, 采样序号) 固定落位。
  const runOnProbes = async (promptText, n, tag = '') => {
    const tasks = [];
    for (let pi = 0; pi < probes.length; pi++) {
      for (let k = 0; k < n; k++) tasks.push({ pi, k, input: probes[pi].input });
    }
    const step = Math.max(1, Math.floor(tasks.length / 5));
    const outputs = await mapLimit(tasks, concurrency, (t) => callGen(promptText, t.input), {
      onProgress: (doneCount, totalCount) => {
        if (concurrency > 1 && (doneCount % step === 0 || doneCount === totalCount)) {
          log(`  ${tag}进度 ${doneCount}/${totalCount}（并发 ${concurrency}）`);
        }
      },
    });
    const perProbe = probes.map(() => []);
    tasks.forEach((t, i) => {
      perProbe[t.pi][t.k] = outputs[i];
    });
    return perProbe;
  };

  log(`基线：用「${opts.new}」在 ${probes.length} 个探针上生成输出（每探针 ${samples} 次，provider=${provider.name}/${provider.model}）`);
  const baselineSamples = await runOnProbes(newP.text, samples, '基线');
  const newOutputs = baselineSamples.map((arr) => arr[0]);

  // 噪声地板：同一提示词的不同采样之间被判「行为改变」的比例
  let noiseFloor = null;
  let noisePerProbe = null;
  let noiseSkipped = false;
  if (samples >= 2) {
    const pairs = [];
    const owners = [];
    baselineSamples.forEach((arr, pi) => {
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          pairs.push({ a: arr[i], b: arr[j] });
          owners.push(pi);
        }
      }
    });
    try {
      const verdicts = await judge.judgeBatch(pairs);
      chargeJudges();
      noisePerProbe = probes.map((_, pi) => rate(verdicts.filter((_, k) => owners[k] === pi)));
      noiseFloor = mean(noisePerProbe);
      log(`噪声地板：同一提示词重复生成之间的变化率 = ${(noiseFloor * 100).toFixed(0)}%（每探针 ${samples} 次采样）`);
      if (noiseFloor >= 0.34) log(`  ⚠ 生成器噪声偏高，单次对比很容易把随机波动误判为改动效果；结论已做校正，但建议增大 --samples`);
    } catch (err) {
      if (!isBudget(err)) throw err;
      noiseSkipped = true;
      log(`  ⚠ 预算不足，跳过噪声地板测量；本次结论无法做噪声校正，置信度将标记为低`);
    }
  }

  // 组间对比辅助：基线采样 × 某一版本的采样，构造全部配对并批量判定。
  const judgeCross = async (varArr) => {
    const entries = [];
    varArr.forEach((arr, pi) => {
      baselineSamples[pi].forEach((a, bi) => {
        arr.forEach((b, vi) => entries.push({ a, b, probe: pi, baseIdx: bi, varIdx: vi }));
      });
    });
    const verdicts = await judge.judgeBatch(entries.map((e) => ({ a: e.a, b: e.b })));
    chargeJudges();
    return { entries, judgements: verdicts };
  };

  const variants = [];
  let samplingInsufficient = false;
  for (const hunk of hunks) {
    const label = describeHunk(hunk);
    log(`消融 ${hunk.id}（${hunk.type}）：${label}`);
    let variantSamples;
    const promptText = revertHunk(newP.text, hunk);
    try {
      variantSamples = await runOnProbes(promptText, minSamples, hunk.id + ' ');
    } catch (err) {
      if (!isBudget(err)) throw err;
      samplingInsufficient = true;
      log(`  ⚠ 预算耗尽，${hunk.id} 及之后的改动块未测量（报告标记为「采样不足」）`);
      variants.push(unmeasuredVariant(hunk, label, probes));
      continue;
    }

    let cross;
    try {
      cross = await judgeCross(variantSamples);
    } catch (err) {
      if (!isBudget(err)) throw err;
      samplingInsufficient = true;
      log(`  ⚠ 预算耗尽，${hunk.id} 的判定未完成（报告标记为「采样不足」）`);
      variants.push(unmeasuredVariant(hunk, label, probes));
      continue;
    }
    let { entries, judgements } = cross;
    let crossPerProbe = probes.map((_, pi) => rate(judgements.filter((_, k) => entries[k].probe === pi)));
    let rawEffect = mean(crossPerProbe);
    let samplesUsed = minSamples;
    let extended = false;

    // 自适应补采样：只在「含糊」（原始变化率 10%~70%）或噪声偏高时补到 --samples 次。
    // 决策只用未校正的原始变化率，噪声校正在采样决策之后进行（避免循环反馈）。
    if (earlyStop && shouldExtendSampling({ rawEffect, noiseFloor, minSamples, maxSamples: samples })) {
      const noiseText = noiseFloor == null ? '噪声未测' : `噪声地板 ${(noiseFloor * 100).toFixed(0)}%`;
      log(`  ${hunk.id} 原始变化率 ${(rawEffect * 100).toFixed(0)}%、${noiseText} → 补采样到 ${samples} 次`);
      try {
        variantSamples = await runOnProbes(promptText, samples, hunk.id + ' 补采样');
        cross = await judgeCross(variantSamples);
        ({ entries, judgements } = cross);
        crossPerProbe = probes.map((_, pi) => rate(judgements.filter((_, k) => entries[k].probe === pi)));
        rawEffect = mean(crossPerProbe);
        samplesUsed = samples;
        extended = true;
      } catch (err) {
        if (!isBudget(err)) throw err;
        log(`  ⚠ 预算不足以补采样，${hunk.id} 保留 ${samplesUsed} 次采样的结论（报告已标注）`);
      }
    }

    let effect = rawEffect;
    const unreliableProbes = [];
    if (noiseFloor != null) {
      effect = mean(
        crossPerProbe.map((c, pi) => {
          const w = noisePerProbe[pi];
          // 单探针噪声 ≈100% 时校正公式的分母趋近 0，硬算会得到爆炸值并被误判为「决定性」。
          // 这种探针本身无法测量任何影响，直接排除出均值。
          if (w > 0.95) {
            unreliableProbes.push(probes[pi].id);
            return 0;
          }
          return Math.max(0, (c - w) / (1 - w));
        })
      );
      if (unreliableProbes.length) {
        log(`  ⚠ 探针 ${unreliableProbes.join('、')} 的同提示词噪声接近 100%，该探针不参与校正（其影响不可测）`);
      }
    }

    // 证据：每个探针取一条代表性配对（优先取「判为改变」的）
    const evidence = probes.map((p, pi) => {
      const own = entries.map((e, k) => ({ e, j: judgements[k] })).filter((x) => x.e.probe === pi);
      const hit = own.find((x) => x.j.changed) || own[0];
      return {
        probeId: p.id,
        changedRate: crossPerProbe[pi],
        a: hit.e.a,
        b: hit.e.b,
        changed: hit.j.changed,
        reason: hit.j.reason,
      };
    });

    const v = {
      hunk: {
        id: hunk.id,
        type: hunk.type,
        oldLines: hunk.oldLines,
        newLines: hunk.newLines,
        oldStart: hunk.oldStart,
        newStart: hunk.newStart,
        summary: label,
      },
      prompt: promptText,
      outputs: variantSamples.map((arr) => arr[0]),
      samples: variantSamples,
      evidence,
      judgements,
      changedCount: crossPerProbe.filter((c) => c >= 0.5).length,
      unreliableProbes,
      samplingInsufficient: false,
      verificationSkipped: false,
      rawEffect,
      effect,
      samplesUsed,
      extended,
      verdict: verdictOf(effect),
    };

    // 第二意见：用异构模型复核「决定性 / 部分影响」的结论
    if (verifyJudge && v.verdict !== 'inert') {
      log(`复核 ${v.hunk.id}：用 ${verifyJudge.name}/${verifyJudge.model} 做第二意见判定`);
      try {
        const second = await verifyJudge.judgeBatch(entries.map((e) => ({ a: e.a, b: e.b })));
        chargeJudges();
        v.verification = {
          judge: verifyJudge.name,
          model: verifyJudge.model,
          judgements: second,
          agree: second.filter((s, k) => s.changed === judgements[k].changed).length,
          total: second.length,
          effect: rate(second),
          fallback: second.some((s) => s.fallback),
        };
      } catch (err) {
        if (!isBudget(err)) throw err;
        v.verificationSkipped = true;
        samplingInsufficient = true;
        log(`  ⚠ 预算耗尽，${v.hunk.id} 的第二意见复核被跳过`);
      }
    }
    variants.push(v);
  }

  const noisy = noiseFloor != null && noiseFloor >= 0.34;
  const noSamples = samples < 2;
  const unstableProbes = [...new Set(variants.flatMap((v) => v.unreliableProbes || []))];
  const lowConfidence = noisy || noSamples || unstableProbes.length > 0 || samplingInsufficient || noiseSkipped;
  const lowConfidenceReason = samplingInsufficient
    ? '预算不足导致部分改动块采样不足或未测量，这些块的结论不可靠（报告已标记）'
    : noiseSkipped
      ? '预算不足，未能测量噪声地板，无法区分「改动生效」与「模型随机波动」'
      : noisy
        ? `生成器自身噪声高：同一提示词重复生成的变化率 ${(noiseFloor * 100).toFixed(0)}%，随机波动可能掩盖或伪造改动效果`
        : noSamples
          ? '只做了单次采样，无法区分「改动生效」与「模型随机波动」（加 --samples 2 可测噪声地板）'
          : unstableProbes.length
            ? `探针 ${unstableProbes.join('、')} 的同提示词噪声接近 100%，这些探针上的影响无法测量，已从校正均值中剔除`
            : null;

  const result = {
    id: opts.id || newId('attr'),
    oldId: oldP.id,
    newId: newP.id,
    kind,
    caveats: CAVEATS,
    probes,
    samples,
    earlyStop,
    minSamples,
    samplingPolicy: describeSamplingPolicy({ earlyStop, samples, minSamples }),
    concurrency,
    maxCalls,
    newOutputs,
    hunks: variants,
    provider: { name: provider.name, model: provider.model, temperature: opts.temperature ?? 0 },
    judge: { name: judge.name, model: judge.model },
    verify: verifyJudge ? { name: verifyJudge.name, model: verifyJudge.model } : null,
    noiseFloor,
    noisePerProbe,
    noiseAdjusted: noiseFloor != null,
    noiseSkipped,
    unreliableProbes: unstableProbes,
    samplingInsufficient,
    lowConfidence,
    lowConfidenceReason,
    calls: budget.used,
    cacheHits: provider.stats?.cacheHits ?? 0,
    elapsedMs: Date.now() - t0,
    oldText: oldP.text,
    newText: newP.text,
  };
  return saveAttribution(result);
}

function unmeasuredVariant(hunk, label, probes) {
  return {
    hunk: {
      id: hunk.id,
      type: hunk.type,
      oldLines: hunk.oldLines,
      newLines: hunk.newLines,
      oldStart: hunk.oldStart,
      newStart: hunk.newStart,
      summary: label,
    },
    prompt: null,
    outputs: [],
    samples: probes.map(() => []),
    evidence: probes.map((p) => ({ probeId: p.id, changedRate: null, a: '', b: '', changed: false, reason: '预算不足，未测量' })),
    judgements: [],
    changedCount: 0,
    unreliableProbes: [],
    samplingInsufficient: true,
    verificationSkipped: true,
    rawEffect: null,
    effect: null,
    samplesUsed: 0,
    extended: false,
    verdict: 'unmeasured',
  };
}
