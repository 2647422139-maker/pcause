#!/usr/bin/env node
// pcause —— 提示词因果归因器 CLI
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  initStore, isInitialized, storeRoot, savePrompt, getPrompt, listPrompts,
  saveAttribution, getAttribution, listAttributions, saveRun, readProbes,
} from './store.mjs';
import { diffHunks, describeHunk } from './diff.mjs';
import { attribute, VERDICT_LABEL } from './attribute.mjs';
import { buildMarkdown, buildHtml } from './report.mjs';

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
  pcause selftest                                离线自测

通用选项：
  --provider mock|deepseek|doubao   生成模型（默认 deepseek）
  --model <name>                    模型名（deepseek 默认 deepseek-flash）
  --judge heuristic|deepseek|doubao 判定器（默认 heuristic）
  --verify <judge>                  用第二个模型做第二意见复核，如 --verify doubao
  --samples <n>                     每个探针独立生成 n 次（默认 1；≥2 时自动测噪声地板并做校正，推荐 2~3）
  --repeats <n>                     --samples 的旧别名
  --temperature <n>                 采样温度（默认 0，保证可复现）
  --limit <n>                       只用前 n 个探针
  --max-calls <n>                   调用预算保护（默认 300）
  --repeats <n>                     同提示词重复跑 n 次以测噪声地板（默认 1）
  --json                            机器可读输出

环境变量：
  DEEPSEEK_API_KEY    DeepSeek API Key（也可放在 ~/.dsh/.credentials.yaml）
  DOUBAO_BRIDGE       豆包桥接脚本路径（默认 ~/.dsh/skills/doubao-bridge/scripts/doubao-ask.mjs）
  PCAUSE_HOME         工作区目录（默认 ./.pcause）
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

function requireInit() {
  if (!isInitialized()) {
    throw new Error(`工作区不存在（${storeRoot()}）。先运行：pcause init`);
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
    throw new Error('用法：pcause attribute --old <id> --new <id> --probes <file>');
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
    cache: flags.cache !== 'false',
  };
  const log = flags.json ? () => {} : (msg) => console.error('· ' + msg);
  const attr = await attribute(opts, { log });
  const { mdPath, htmlPath } = writeReports(attr, flags);

  if (flags.json) {
    console.log(JSON.stringify({ ok: true, id: attr.id, report: mdPath, html: htmlPath, summary: summarize(attr) }, null, 2));
    return 0;
  }
  tick(`\n✔ 归因完成：${attr.id}（${attr.calls} 次调用 / ${(attr.elapsedMs / 1000).toFixed(1)}s，缓存命中 ${attr.cacheHits}）`);
  tick(
    `  噪声地板：${attr.noiseFloor == null ? '未测（--samples 2 可测）' : (attr.noiseFloor * 100).toFixed(0) + '%'}　采样：${attr.samples} 次/探针`
  );
  if (attr.lowConfidence) tick(`  ⚠ ${attr.lowConfidenceReason}`);
  tick('');
  const order = { decisive: 0, partial: 1, inert: 2 };
  for (const h of [...attr.hunks].sort((a, b) => order[a.verdict] - order[b.verdict] || b.effect - a.effect)) {
    const bar = (h.verdict === 'decisive' ? '■' : h.verdict === 'partial' ? '▨' : '□').padEnd(2);
    tick(
      `  ${bar} ${h.hunk.id}  ${VERDICT_LABEL[h.verdict].padEnd(4)}  ${String(Math.round(h.effect * 100)).padStart(3)}%` +
        `（原始 ${String(Math.round(h.rawEffect * 100)).padStart(3)}%）  ${h.hunk.summary}`
    );
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
  return 0;
}

function summarize(attr) {
  return attr.hunks.map((h) => ({
    hunk: h.hunk.id,
    type: h.hunk.type,
    summary: h.hunk.summary,
    effect: h.effect,
    rawEffect: h.rawEffect,
    verdict: h.verdict,
    verified: h.verification ? { agree: h.verification.agree, total: h.verification.total } : null,
  }));
}

function cmdDiff(flags, pos) {
  requireInit();
  const [oldId, newId] = pos;
  if (!oldId || !newId) throw new Error('用法：pcause diff <old> <new>');
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
  if (!id) throw new Error('用法：pcause snapshot <id> --file <path> 或 --text "..."');
  let text;
  if (flags.file) {
    const file = path.resolve(flags.file);
    if (!fs.existsSync(file)) throw new Error('找不到文件：' + file);
    text = fs.readFileSync(file, 'utf8');
  } else if (typeof flags.text === 'string') {
    text = flags.text;
  } else {
    throw new Error('缺少 --file 或 --text');
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
  if (!id || !flags.probes) throw new Error('用法：pcause run <id> --probes <file>');
  const prompt = getPrompt(id);
  const probes = readProbes(flags.probes, { limit: num(flags.limit, 0) });
  const { makeProvider } = await import('./providers.mjs');
  const provider = makeProvider(flags.provider || 'deepseek', {
    model: flags.model,
    temperature: num(flags.temperature, 0),
  });
  const outputs = [];
  for (const p of probes) {
    const out = await provider.generate({ system: prompt.text, user: p.input });
    outputs.push({ probeId: p.id, input: p.input, output: out });
    if (!flags.json) console.error(`· ${p.id} ✓`);
  }
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
  if (!id) throw new Error('用法：pcause report <attrId>');
  const attr = getAttribution(id);
  const { mdPath, htmlPath } = writeReports(attr, flags);
  tick(`✔ 已生成报告`);
  tick(`  Markdown: ${mdPath}`);
  tick(`  HTML    : ${htmlPath}`);
  return 0;
}

function cmdSelftest() {
  const script = path.join(PKG_ROOT, 'test', 'selftest.mjs');
  const r = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  return r.status ?? 1;
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
    case 'selftest':
      return cmdSelftest();
    case 'version':
      tick('pcause 0.1.0');
      return 0;
    case 'help':
    case '--help':
    case '-h':
      console.log(HELP);
      return 0;
    default:
      console.error(`未知命令：${cmd}\n`);
      console.log(HELP);
      return 1;
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((err) => {
    console.error('✖ ' + err.message);
    process.exit(1);
  });
