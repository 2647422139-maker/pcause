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
import { makeJudge } from './judge.mjs';

export function verdictOf(effect) {
  if (effect >= 0.5) return 'decisive';
  if (effect >= 0.2) return 'partial';
  return 'inert';
}

export const VERDICT_LABEL = { decisive: '决定性', partial: '部分影响', inert: '无影响' };

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const rate = (verdicts) => (verdicts.length ? verdicts.filter((v) => v.changed).length / verdicts.length : 0);

/**
 * 跑一次归因实验。
 * @param {object} opts { old, new, probes, provider, model, judge, verify, limit, maxCalls, samples, repeats, temperature, cache }
 */
export async function attribute(opts, { log = () => {}, dryRun = false } = {}) {
  const t0 = Date.now();
  const oldP = getPrompt(opts.old);
  const newP = getPrompt(opts.new);
  const probes = readProbes(opts.probes, { limit: opts.limit || 0, warn: log });
  const hunks = diffHunks(oldP.text, newP.text, {
    onDegrade: (n, m) =>
      log(`⚠ 提示词较长（${n} / ${m} 行），diff 已退化为整段替换，无法逐块归因；结论粒度会变粗`),
  });
  if (!hunks.length) throw new Error(`「${opts.old}」与「${opts.new}」没有差异，无需归因`);
  const samples = Math.max(1, Math.floor(Number(opts.samples ?? opts.repeats ?? 1) || 1));

  const provider = makeProvider(opts.provider, {
    model: opts.model,
    temperature: opts.temperature,
    cache: opts.cache !== false,
  });
  const judge = makeJudge(opts.judge, { model: opts.judgeModel, cache: opts.cache !== false });
  const verifyJudge = opts.verify ? makeJudge(opts.verify, { model: opts.verifyModel, cache: opts.cache !== false }) : null;

  const budget = { max: opts.maxCalls || 400, used: 0 };
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
    if (budget.used > budget.max) {
      throw new Error(`达到 --max-calls 预算（${budget.max}，含判定器调用），实验中止`);
    }
  };
  const callGen = async (system, user) => {
    if (budget.used >= budget.max) throw new Error(`达到 --max-calls 预算（${budget.max}），实验中止`);
    budget.used++;
    return provider.generate({ system, user });
  };

  // 每个探针独立生成 samples 次
  const runOnProbes = async (promptText, n) => {
    const perProbe = [];
    for (const p of probes) {
      const arr = [];
      for (let k = 0; k < n; k++) arr.push(await callGen(promptText, p.input));
      perProbe.push(arr);
    }
    return perProbe;
  };

  log(`基线：用「${opts.new}」在 ${probes.length} 个探针上生成输出（每探针 ${samples} 次，provider=${provider.name}/${provider.model}）`);
  const baselineSamples = await runOnProbes(newP.text, samples);
  const newOutputs = baselineSamples.map((arr) => arr[0]);

  // 噪声地板：同一提示词的不同采样之间被判「行为改变」的比例
  let noiseFloor = null;
  let noisePerProbe = null;
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
    const verdicts = await judge.judgeBatch(pairs);
    chargeJudges();
    noisePerProbe = probes.map((_, pi) => rate(verdicts.filter((_, k) => owners[k] === pi)));
    noiseFloor = mean(noisePerProbe);
    log(`噪声地板：同一提示词重复生成之间的变化率 = ${(noiseFloor * 100).toFixed(0)}%（每探针 ${samples} 次采样）`);
    if (noiseFloor >= 0.34) log(`  ⚠ 生成器噪声偏高，单次对比很容易把随机波动误判为改动效果；结论已做校正，但建议增大 --samples`);
  }

  const variants = [];
  for (const hunk of hunks) {
    const label = describeHunk(hunk);
    log(`消融 ${hunk.id}（${hunk.type}）：${label}`);
    const promptText = revertHunk(newP.text, hunk);
    const variantSamples = await runOnProbes(promptText, samples);

    // 组间对比：基线采样 × 回退后采样 的所有配对（逐探针）
    const entries = [];
    variantSamples.forEach((arr, pi) => {
      baselineSamples[pi].forEach((a, bi) => {
        arr.forEach((b, vi) => entries.push({ a, b, probe: pi, baseIdx: bi, varIdx: vi }));
      });
    });
    const judgements = await judge.judgeBatch(entries.map((e) => ({ a: e.a, b: e.b })));
    chargeJudges();
    const crossPerProbe = probes.map((_, pi) =>
      rate(judgements.filter((_, k) => entries[k].probe === pi))
    );
    const rawEffect = mean(crossPerProbe);

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
      rawEffect,
      effect,
      verdict: verdictOf(effect),
    };

    // 第二意见：用异构模型复核「决定性 / 部分影响」的结论
    if (verifyJudge && v.verdict !== 'inert') {
      log(`复核 ${v.hunk.id}：用 ${verifyJudge.name}/${verifyJudge.model} 做第二意见判定`);
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
    }
    variants.push(v);
  }

  const noisy = noiseFloor != null && noiseFloor >= 0.34;
  const noSamples = samples < 2;
  const unstableProbes = [...new Set(variants.flatMap((v) => v.unreliableProbes || []))];
  const lowConfidence = noisy || noSamples || unstableProbes.length > 0;
  const lowConfidenceReason = noisy
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
    probes,
    samples,
    newOutputs,
    hunks: variants,
    provider: { name: provider.name, model: provider.model, temperature: opts.temperature ?? 0 },
    judge: { name: judge.name, model: judge.model },
    verify: verifyJudge ? { name: verifyJudge.name, model: verifyJudge.model } : null,
    noiseFloor,
    noisePerProbe,
    noiseAdjusted: noiseFloor != null,
    unreliableProbes: unstableProbes,
    lowConfidence,
    lowConfidenceReason,
    calls: budget.used,
    cacheHits: provider.stats?.cacheHits ?? 0,
    elapsedMs: Date.now() - t0,
    oldText: oldP.text,
    newText: newP.text,
  };
  if (dryRun) return result;
  return saveAttribution(result);
}
