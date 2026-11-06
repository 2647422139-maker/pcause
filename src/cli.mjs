#!/usr/bin/env node
// pcause —— 提示词因果归因器 CLI
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  initStore, isInitialized, storeRoot, savePrompt, getPrompt, listPrompts,
  saveAttribution, getAttribution, listAttributions, saveRun, readProbes,
} from './store.mjs';
import { diffHunks, describeHunk } from './diff.mjs';
import { attribute, planCalls, VERDICT_LABEL } from './attribute.mjs';
import { buildMarkdown, buildHtml } from './report.mjs';
import { compareAttributions, buildCompareMarkdown } from './compare.mjs';
import { KINDS, toPublicJSON, validatePublicJSON } from './schema.mjs';
import { PcauseError, usage, notInitialized, formatError } from './errors.mjs';
import { readTextFile } from './encoding.mjs';
import { collectDoctorInfo, formatDoctorText } from './doctor.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(HERE, '..');

const HELP = `pcause —— 提示词因果归因器

用法：
  pcause init                                    初始化工作区（.pcause/）
  pcause snapshot <id> --file <path> [--note s]  保存一个提示词版本快照
  pcause snapshot <id> --text "..."              同上，直接给文本
  pcause list                                    列出快照与历史归因
  pcause diff <old> <new>                        查看两个版本的改动块（hunk）
  pcause run <id> --probes <file> [选项]          用某个版本跑探针并保存输出
  pcause attribute --old <id> --new <id> --probes <file> [选项]
                                                 跑一次归因实验（核心命令）
  pcause report <attrId> [--md out.md] [--html out.html]
  pcause compare <attrA> <attrB> [--allow-incompatible] [--json] [--md out.md]
                                                 对比两次归因的结论迁移（签名不一致时拒绝，避免误读）
  pcause schema [--out file]                     导出机器可读结果的 JSON Schema
  pcause demo [--json]                           内置演示：mock 生成 + 离线判定，不联网、不需要 Key，产物写到系统临时目录
  pcause doctor [--json]                         自检：版本/Node/平台/工作区/配置/通道可用性（不显示密钥，报 issue 前先跑）
  pcause selftest                                离线自测
  pcause version                                 打印版本号

注意：compare 不是「两次回答谁更好」的打分对比，而是因果结论迁移对比
      （同一实验条件下，某个改动块的影响是否变了）；要打分评测请用专门的 eval 工具。

run 选项：与 attribute 相同的生成类选项（--provider / --model / --limit / --concurrency /
          --dry-run / --max-calls 等）；判定、采样、复核、门禁选项仅 attribute 使用。

attribute 选项：
  --provider mock|deepseek|doubao   生成模型（默认 deepseek）
  --model <name>                    模型名（deepseek 默认 deepseek-flash）
  --judge heuristic|deepseek|doubao 判定器（默认 heuristic）
  --verify <judge>                  用第二个模型做第二意见复核，如 --verify doubao
  --kind prompt|system|agent        归因对象类型（默认 prompt；影响判定器使用的判定维度与报告里的假设可信度提示）
  --samples <n>                     每个探针独立生成 n 次（默认 1；≥2 时自动测噪声地板并做校正，推荐 2~3）
  --early-stop                      采样提前停止：先测 --min-samples 次，仅在结论含糊/噪声偏高时补采样到 --samples
  --min-samples <n>                 自适应采样的首轮次数（默认 2；需配合 --early-stop，且 ≤ --samples）
  --concurrency <n>                 生成阶段的并发请求数（默认 1；2~4 更快，过高易触发限流）
  --repeats <n>                     --samples 的旧别名
  --temperature <n>                 采样温度（默认 0，保证可复现）
  --config <file>                   插件配置文件（默认 ./pcause.config.json 或 $PCAUSE_CONFIG）
  --limit <n>                       只用前 n 个探针
  --max-calls <n>                   模型调用预算（默认 400，单位是「模型请求次数」，不是 token 或金额；含判定器调用）
  --dry-run                         只预估调用量与预算是否够，不发起任何请求、不读 API Key
  --fail-on decisive|partial        CI 门禁：命中则退出码 2（采样不足的块不参与门禁）
  --json                            输出符合 schema/attribution.schema.json 的完整 JSON
  --json-out <file>                 同时把这份 JSON 写到文件

compare 选项：
  --allow-incompatible  两次实验签名不一致时仍强行对比（默认拒绝，因为差异可能来自实验条件）
  --json                输出机器可读的对比结果
  --md <file>           把对比结果写成 Markdown

退出码：0 成功且未命中门禁；1 运行错误；2 命中 --fail-on 门禁（成功跑完，业务阻断）。

出错时的诊断：
  stderr 输出「✖ [PCAUSE_xxx] 一句话原因」+「提示：下一步怎么做」两行；stdout 不受影响（--json 仍可解析）。
  设置 PCAUSE_DEBUG=1 时额外打印堆栈（默认隐藏）。错误码含义见 README「错误码与自助排查」。

环境变量：
  DEEPSEEK_API_KEY    DeepSeek API Key（也可放在 ~/.dsh/.credentials.yaml）
  DOUBAO_BRIDGE       豆包桥接脚本路径（默认 ~/.dsh/skills/doubao-bridge/scripts/doubao-ask.mjs）
  PCAUSE_HOME         工作区目录（默认 ./.pcause）
  PCAUSE_CONFIG       插件配置文件路径（默认 ./pcause.config.json）
  PCAUSE_DEBUG        设为 1 时在错误输出后追加堆栈，便于反馈 bug
`;

function parseArgs(list) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const next = list[i + 1];
        if (next !== undefined && !next.startsWith('--')) {
          flags[a.slice(2)] = next;
          i++;
        } else {
          flags[a.slice(2)] = true;
        }
      }
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

const num = (v, d) => (v === undefined || v === true ? d : Number(v));
const tick = (s) => console.log(s);
const EXIT_CODES = { OK: 0, ERROR: 1, GATE: 2 };

function requireInit() {
  if (!isInitialized()) {
    throw notInitialized(storeRoot());
  }
}

function writeReports(attr, flags) {
  const dir = path.join(storeRoot(), 'attributions');
  fs.mkdirSync(dir, { recursive: true });
  const mdPath = flags.md === true || flags.md === undefined ? path.join(dir, attr.id + '.md') : path.resolve(flags.md);
  const htmlPath =
    flags.html === true || flags.html === undefined ? path.join(dir, attr.id + '.html') : path.resolve(flags.html);
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(mdPath, buildMarkdown(attr), 'utf8');
  fs.writeFileSync(htmlPath, buildHtml(attr), 'utf8');
  return { mdPath, htmlPath };
}

async function cmdAttribute(flags) {
  requireInit();
  const oldId = flags.old;
  const newId = flags.new;
  const probesFile = flags.probes;
  if (!oldId || !newId || !probesFile) {
    throw usage('用法：pcause attribute --old <id> --new <id> --probes <file>');
  }
  const kind = flags.kind || 'prompt';
  if (!KINDS.includes(kind)) throw new PcauseError('PCAUSE_KIND', `未知 --kind：${kind}（可选 ${KINDS.join(' / ')}）`, '拿不准时先用默认 prompt；kind 描述提示词在系统中的位置，不是输出业务标签');
  const failOn = flags['fail-on'];
  if (failOn !== undefined && failOn !== 'decisive' && failOn !== 'partial') {
    throw usage('--fail-on 只接受 decisive 或 partial');
  }
  const opts = {
    old: oldId,
    new: newId,
    probes: probesFile,
    provider: flags.provider || 'deepseek',
    model: flags.model,
    judge: flags.judge || 'heuristic',
    verify: flags.verify,
    judgeModel: flags['judge-model'],
    verifyModel: flags['verify-model'],
    temperature: num(flags.temperature, 0),
    limit: num(flags.limit, 0),
    maxCalls: num(flags['max-calls'], 400),
    samples: num(flags.samples, num(flags.repeats, 1)),
    earlyStop: Boolean(flags['early-stop']),
    minSamples: num(flags['min-samples'], 2),
    concurrency: num(flags.concurrency, 1),
    cache: flags.cache !== 'false',
    kind,
    config: flags.config,
  };
  const log = flags.json ? () => {} : (msg) => console.error('· ' + msg);

  // --dry-run：只预估调用量，不发起任何模型请求
  if (flags['dry-run']) {
    const plan = await attribute(opts, { log, dryRun: true });
    if (flags.json) {
      console.log(JSON.stringify({ ok: true, dryRun: true, kind: plan.kind, plan: plan.plan, hunks: plan.hunks }, null, 2));
      return 0;
    }
    tick(`\n预演（未发起任何模型请求）：${plan.hunks.length} 个改动块 × ${plan.plan.probes} 个探针 × 每探针 ${plan.plan.samples} 次采样`);
    tick(
      `  预计调用：生成 ${plan.plan.generationCalls} + 判定 ${plan.plan.judgeCalls} + 复核上限 ${plan.plan.verifyCallsMax} = ${plan.plan.plannedCalls} 次（预算 ${plan.plan.maxCalls}）`
    );
    if (!plan.plan.fitsBudget) {
      tick('  ⚠ 预估调用数超过预算：正式运行会在预算耗尽处提前结束，并把未测完的改动块标记为「采样不足」');
    }
    if (plan.plan.earlyStop) {
      tick(
        `  自适应采样：先测 ${plan.plan.minSamples} 次；调用量区间约 ${plan.plan.plannedCallsMin}（全部提前停止）～ ${plan.plan.plannedCalls}（全部补采样）`
      );
    }
    tick(`  说明：${plan.plan.note}`);
    tick('');
    for (const h of plan.hunks) tick(`  ${h.id}  ${h.summary}`);
    return 0;
  }

  // 运行前先给一行消耗预估（仅估算，实际会因缓存命中更少），避免「预算到底指什么」的误解
  if (!flags.json) {
    try {
      const preview = await attribute(opts, { log: () => {}, dryRun: true });
      const p = preview.plan;
      const span = p.earlyStop ? `；自适应采样区间约 ${p.plannedCallsMin}~${p.plannedCalls}` : '';
      tick(`\n计划：${p.hunks} 个改动块 × ${p.probes} 个探针 × 每探针 ${p.samples} 次 → 预计 ≤${p.plannedCalls} 次模型调用（预算 ${p.maxCalls}）${span}`);
      tick('  提示：预算单位是模型请求次数，不是 token 或金额；命中缓存会少于预估。');
    } catch {
      // 预估失败不阻断正式运行
    }
  }

  const attr = await attribute(opts, { log });
  const pub = toPublicJSON(attr);
  const schemaErrs = validatePublicJSON(pub);
  if (schemaErrs.length) {
    throw new PcauseError('PCAUSE_INTERNAL', '内部结果不符合对外 schema（这是 bug，请反馈）：\n  - ' + schemaErrs.join('\n  - '), '把这段输出和命令行参数附到 GitHub issue；临时可用 --json 查看原始结果');
  }
  const { mdPath, htmlPath } = writeReports(attr, flags);
  if (typeof flags['json-out'] === 'string') {
    const outFile = path.resolve(flags['json-out']);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(pub, null, 2) + '\n', 'utf8');
    if (!flags.json) tick(`\nJSON：${outFile}`);
  }

  const gateHits = failOn
    ? attr.hunks.filter(
        (h) =>
          !h.samplingInsufficient &&
          (failOn === 'decisive' ? h.verdict === 'decisive' : h.verdict === 'partial' || h.verdict === 'decisive')
      )
    : [];
  const gateMsg = gateHits.length
    ? `✖ 门禁命中（--fail-on ${failOn}）：${gateHits.map((h) => `${h.hunk.id}(${VERDICT_LABEL[h.verdict]})`).join('、')}`
    : '';

  if (flags.json) {
    console.log(JSON.stringify(pub, null, 2));
    if (gateMsg) console.error(gateMsg + '，退出码 2');
    return gateHits.length ? 2 : 0;
  }
  tick(`\n✔ 归因完成：${attr.id}（${attr.calls} 次调用 / ${(attr.elapsedMs / 1000).toFixed(1)}s，缓存命中 ${attr.cacheHits}）`);
  tick(
    `  噪声地板：${attr.noiseFloor == null ? '未测（--samples 2 可测）' : (attr.noiseFloor * 100).toFixed(0) + '%'}　采样：${attr.samples} 次/探针（${attr.earlyStop ? `自适应，先 ${attr.minSamples} 次` : '固定'}）　归因对象：${attr.kind}`
  );
  if (attr.lowConfidence) tick(`  ⚠ ${attr.lowConfidenceReason}`);
  tick('');
  const order = { decisive: 0, partial: 1, inert: 2, unmeasured: 3 };
  for (const h of [...attr.hunks].sort((a, b) => order[a.verdict] - order[b.verdict] || (b.effect ?? -1) - (a.effect ?? -1))) {
    const bar = (h.verdict === 'decisive' ? '■' : h.verdict === 'partial' ? '▨' : h.verdict === 'inert' ? '□' : '·').padEnd(2);
    tick(
      `  ${bar} ${h.hunk.id}  ${VERDICT_LABEL[h.verdict].padEnd(4)}  ${h.effect == null ? '   —' : String(Math.round(h.effect * 100)).padStart(3) + '%'}` +
        `（原始 ${h.rawEffect == null ? '—' : String(Math.round(h.rawEffect * 100)).padStart(3) + '%'}）  ${h.hunk.summary}`
    );
    if (h.samplingInsufficient) tick('        └ 预算不足，采样不足：该块没有结论（不是「无影响」）');
    if (h.extended) tick(`        └ 自适应采样：先测 ${attr.minSamples} 次后补采样到 ${h.samplesUsed} 次`);
    if (h.verification) {
      tick(
        `        └ 第二意见（${h.verification.judge}）：判定一致 ${h.verification.agree}/${h.verification.total}` +
          `${h.verification.fallback ? '（含回退判定⚠）' : ''}`
      );
    }
  }
  tick('');
  tick(`报告：${mdPath}`);
  tick(`      ${htmlPath}`);
  if (gateMsg) {
    tick(gateMsg + '，退出码 2');
    return 2;
  }
  return 0;
}

function cmdDiff(flags, pos) {
  requireInit();
  const [oldId, newId] = pos;
  if (!oldId || !newId) throw usage('用法：pcause diff <old> <new>');
  const hunks = diffHunks(getPrompt(oldId).text, getPrompt(newId).text, {
    onDegrade: (n, m) =>
      tick(`⚠ 提示词较长（${n} / ${m} 行），已退化为整段替换，无法拆出细粒度改动块`),
  });
  if (!hunks.length) {
    tick('两个版本没有差异。');
    return 0;
  }
  tick(`${oldId} → ${newId}：共 ${hunks.length} 个改动块\n`);
  for (const h of hunks) {
    tick(`[${h.id}] ${h.type}  (old:${h.oldStart}-${h.oldEnd} new:${h.newStart}-${h.newEnd})`);
    for (const l of h.oldLines) tick('  - ' + l);
    for (const l of h.newLines) tick('  + ' + l);
    tick('');
  }
  return 0;
}

function cmdSnapshot(flags, pos) {
  requireInit();
  const id = pos[0];
  if (!id) throw usage('用法：pcause snapshot <id> --file <path> 或 --text "..."');
  let text;
  if (flags.file) {
    const file = path.resolve(flags.file);
    if (!fs.existsSync(file)) {
      throw new PcauseError('PCAUSE_NOT_FOUND', '找不到文件：' + file, '检查路径是否存在；Windows 路径含空格时请用引号包住');
    }
    text = readTextFile(file);
  } else if (typeof flags.text === 'string') {
    text = flags.text;
  } else {
    throw usage('缺少 --file 或 --text');
  }
  const p = savePrompt({ id, text, note: flags.note || '' });
  tick(`✔ 已保存快照 ${p.id}（${text.split('\n').length} 行）`);
  return 0;
}

function cmdList() {
  requireInit();
  const prompts = listPrompts();
  const attrs = listAttributions();
  tick(`工作区：${storeRoot()}\n`);
  tick(`提示词快照（${prompts.length}）：`);
  for (const p of prompts) tick(`  ${p.id.padEnd(18)} ${String(p.text.split('\n').length).padStart(4)} 行  ${p.createdAt.slice(0, 19)}`);
  tick(`\n归因历史（${attrs.length}）：`);
  for (const a of attrs) {
    const dec = a.hunks.filter((h) => h.verdict === 'decisive').length;
    tick(`  ${a.id}  ${a.oldId} → ${a.newId}  决定性 ${dec} / 共 ${a.hunks.length}`);
  }
  return 0;
}

async function cmdRun(flags, pos) {
  requireInit();
  const id = pos[0];
  if (!id) throw usage('用法：pcause run <id> --probes <file>');
  const prompt = getPrompt(id);
  const probes = readProbes(flags.probes, { limit: num(flags.limit, 0) });
  const { makeProvider } = await import('./providers.mjs');
  const { mapLimit } = await import('./concurrency.mjs');
  const provider = makeProvider(flags.provider || 'deepseek', {
    model: flags.model,
    temperature: num(flags.temperature, 0),
    config: flags.config,
  });
  const concurrency = Math.max(1, num(flags.concurrency, 1));
  const outputs = await mapLimit(
    probes,
    concurrency,
    async (p) => {
      const out = await provider.generate({ system: prompt.text, user: p.input });
      if (!flags.json) console.error(`· ${p.id} ✓`);
      return { probeId: p.id, input: p.input, output: out };
    }
  );
  const run = saveRun({
    id: flags.out,
    promptId: id,
    provider: { name: provider.name, model: provider.model },
    outputs,
    calls: provider.stats.calls,
    cacheHits: provider.stats.cacheHits,
  });
  if (flags.json) console.log(JSON.stringify({ ok: true, runId: run.id, calls: provider.stats.calls }, null, 2));
  else tick(`✔ 已保存运行 ${run.id}（${outputs.length} 条输出）`);
  return 0;
}

function cmdReport(flags, pos) {
  requireInit();
  const id = pos[0];
  if (!id) throw usage('用法：pcause report <attrId>');
  const attr = getAttribution(id);
  const { mdPath, htmlPath } = writeReports(attr, flags);
  tick(`✔ 已生成报告`);
  tick(`  Markdown: ${mdPath}`);
  tick(`  HTML    : ${htmlPath}`);
  return 0;
}

function cmdCompare(flags, pos) {
  requireInit();
  const [aId, bId] = pos;
  if (!aId || !bId) throw usage('用法：pcause compare <attrA> <attrB> [--allow-incompatible] [--json] [--md out.md]');
  const a = getAttribution(aId);
  const b = getAttribution(bId);
  let result;
  try {
    result = compareAttributions(a, b, { allowIncompatible: flags['allow-incompatible'] === true });
  } catch (err) {
    if (err.code === 'PCAUSE_SIGNATURE') {
      console.error(formatError(err));
      return 1;
    }
    throw err;
  }
  const md = buildCompareMarkdown(result);
  if (typeof flags.md === 'string') {
    const out = path.resolve(flags.md);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, md, 'utf8');
  }
  if (flags.json) {
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return 0;
  }
  tick(`对比：${result.aId} → ${result.bId}`);
  tick(result.compatible ? '✔ 实验签名一致，结论可直接对比' : '⚠ 实验签名不一致，结论仅作参考');
  if (result.mismatches.length) {
    for (const m of result.mismatches) tick(`  ! ${m.message}`);
  }
  tick('');
  for (const r of result.hunks) {
    const va = r.before ? VERDICT_LABEL[r.before.verdict] ?? r.before.verdict : '—';
    const vb = r.after ? VERDICT_LABEL[r.after.verdict] ?? r.after.verdict : '—';
    const ea = r.before?.effect == null ? '  —' : String(Math.round(r.before.effect * 100)).padStart(3) + '%';
    const eb = r.after?.effect == null ? '  —' : String(Math.round(r.after.effect * 100)).padStart(3) + '%';
    const d = r.effectDelta == null ? '' : ` (${r.effectDelta >= 0 ? '+' : ''}${Math.round(r.effectDelta * 100)}pt)`;
    tick(`  ${r.statusLabel.padEnd(3)} ${String(r.hunk ?? '—').padEnd(4)} ${va} → ${vb}  ${ea} → ${eb}${d}  ${r.summary}`);
  }
  const s = result.summary;
  tick('');
  tick(`合计：不变 ${s.same}，升级 ${s.upgraded}，降级 ${s.downgraded}，新增 ${s.added}，消失 ${s.removed}`);
  if (result.note) tick(`⚠ ${result.note}`);
  if (typeof flags.md === 'string') tick(`Markdown：${path.resolve(flags.md)}`);
  return 0;
}

function cmdSchema(flags) {
  const file = path.join(PKG_ROOT, 'schema', 'attribution.schema.json');
  throw new PcauseError('PCAUSE_NOT_FOUND', 'schema 文件缺失：' + file, '重新 clone 仓库或运行 npm test 检查安装完整性');
  if (typeof flags.out === 'string') {
    const out = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(file, out);
    tick(`✔ 已导出 JSON Schema：${out}`);
  } else {
    tick(fs.readFileSync(file, 'utf8'));
  }
  return 0;
}

function cmdDoctor(flags) {
  const info = collectDoctorInfo({ cwd: process.cwd() });
  if (flags.json === true) {
    console.log(JSON.stringify(info));
  } else {
    console.log(formatDoctorText(info));
  }
  return 0;
}

function cmdSelftest() {
  const script = path.join(PKG_ROOT, 'test', 'selftest.mjs');
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  return r.status ?? 1;
}

// 内置演示：不联网、不需要 API Key、不改动当前工作区。
// 全部写入系统临时目录（PCAUSE_HOME 临时指向它），跑完告诉你产物在哪、下一步怎么用。
const DEMO_OLD_TEXT = ['你是一名客服回复助手。', '请直接回答问题。', '保持简洁。', '保持客观。'].join('\n') + '\n';
const DEMO_NEW_TEXT =
  [
    '你是一名客服回复助手。',
    '输出必须使用 Markdown 表格呈现结论。',
    '请直接回答问题。',
    '保持简洁。',
    '语气保持温和友好。',
    '保持客观。',
    '注意：内部工具，输出会进入数据看板。',
  ].join('\n') + '\n';
const DEMO_PROBES = [
  { id: 'p1', input: '退款被拒，很生气。' },
  { id: 'p2', input: '升级后白屏。' },
  { id: 'p3', input: '收到了，还行。' },
];

async function cmdDemo(flags) {
  const silent = Boolean(flags.json);
  const log = silent ? () => {} : (msg) => console.error('· ' + msg);
  const stamp = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const base = path.join(os.tmpdir(), `pcause-demo-${stamp}`);
  const prevHome = process.env.PCAUSE_HOME;
  try {
    process.env.PCAUSE_HOME = base;
    initStore({ force: false });
    savePrompt({ id: 'demo-old', text: DEMO_OLD_TEXT, note: 'demo 旧版提示词' });
    savePrompt({ id: 'demo-new', text: DEMO_NEW_TEXT, note: 'demo 新版提示词' });
    const probesFile = path.join(base, 'probes.jsonl');
    fs.writeFileSync(probesFile, DEMO_PROBES.map((p) => JSON.stringify(p)).join('\n') + '\n', 'utf8');
    if (!silent) tick(`✔ 已创建临时演示工作区：${base}`);
    if (!silent) tick('· 运行归因（mock 生成器 + heuristic 判定，不联网、不花钱）');
    const attr = await attribute(
      {
        old: 'demo-old',
        new: 'demo-new',
        probes: probesFile,
        provider: 'mock',
        judge: 'heuristic',
        samples: 2,
        maxCalls: 80,
        kind: 'prompt',
        cache: false,
      },
      { log }
    );
    const files = writeReports(attr, {});
    const rows = attr.hunks.map((h) => ({ id: h.hunk.id, verdict: h.verdict, label: VERDICT_LABEL[h.verdict], effect: h.effect, summary: h.hunk.summary }));
    if (silent) {
      console.log(JSON.stringify({ ok: true, workspace: base, attributionId: attr.id, noiseFloor: attr.noiseFloor, hunks: rows, mdPath: files.mdPath, htmlPath: files.htmlPath }));
      return 0;
    }
    tick(`✔ 归因完成：${attr.id}（${attr.calls ?? '?'} 次生成/判定调用，噪声地板 ${attr.noiseFloor == null ? '未测' : Math.round(attr.noiseFloor * 100) + '%'}）`);
    for (const r of rows) {
      tick(`  ${r.verdict === 'decisive' ? '■' : r.verdict === 'inert' ? '□' : '▨'}  ${r.id}  ${r.label} ${r.effect == null ? '' : Math.round(r.effect * 100) + '%'}    ${r.summary}`);
    }
    tick(`报告：${files.mdPath}`);
    tick(`      ${files.htmlPath}`);
    tick('下一步：pcause demo --json 看机器可读结果；想测自己的提示词，见 README 的「快速开始」');
    return 0;
  } finally {
    if (prevHome === undefined) delete process.env.PCAUSE_HOME;
    else process.env.PCAUSE_HOME = prevHome;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0] || 'help';
  const { flags, pos } = parseArgs(argv.slice(1));
  switch (cmd) {
    case 'init': {
      const r = initStore({ force: flags.force === true });
      tick(`✔ 工作区就绪：${r.root}${r.created ? '' : '（已存在）'}`);
      return 0;
    }
    case 'snapshot':
      return cmdSnapshot(flags, pos);
    case 'list':
      return cmdList();
    case 'diff':
      return cmdDiff(flags, pos);
    case 'run':
      return cmdRun(flags, pos);
    case 'attribute':
      return cmdAttribute(flags);
    case 'report':
      return cmdReport(flags, pos);
    case 'compare':
      return cmdCompare(flags, pos);
    case 'schema':
      return cmdSchema(flags);
    case 'doctor':
      return cmdDoctor(flags);
    case 'selftest':
      return cmdSelftest();
    case 'demo':
      return cmdDemo(flags);
    case 'version': {
      const pkg = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
      tick(`pcause ${pkg.version}`);
      return 0;
    }
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.error(formatError(new PcauseError('PCAUSE_UNKNOWN_COMMAND', `未知命令：${cmd}`, '运行 pcause help 查看可用命令')) + '\n');
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error(formatError(err));
    process.exit(EXIT_CODES.ERROR);
  });
