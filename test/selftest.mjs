// 离线自测：不花钱、不联网，验证 diff / 回退 / 归因 / 报告 / 存储 / 预算 / 门禁 全链路
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pcause-selftest-'));
process.env.PCAUSE_HOME = path.join(tmpRoot, '.pcause');
const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { initStore, savePrompt, getPrompt } = await import('../src/store.mjs');
const { diffHunks, revertHunk } = await import('../src/diff.mjs');
const { attribute } = await import('../src/attribute.mjs');
const { buildMarkdown, buildHtml } = await import('../src/report.mjs');
const { toPublicJSON, validatePublicJSON, CAVEATS } = await import('../src/schema.mjs');

let passed = 0;
const failures = [];
function check(cond, msg) {
  if (cond) {
    passed++;
    console.log('  ✓ ' + msg);
  } else {
    failures.push(msg);
    console.log('  ✗ ' + msg);
  }
}

// 与 examples/review-v1.md / review-v2.md 同构的 fixture：
// 三处新增改动，彼此之间都有公共行，确保是 3 个独立 hunk
const V1 = [
  '你是一名资深代码评审助手。',
  '请阅读用户给出的代码片段，指出潜在问题。',
  '',
  '输出要求：',
  '- 先给一句总体结论。',
  '- 再逐条列出问题，每条标明严重程度。',
  '',
  '补充说明：涉及安全问题时必须单独高亮。',
].join('\n');

const V2 = [
  '你是一名资深代码评审助手。',
  '请阅读用户给出的代码片段，指出潜在问题。',
  '',
  '输出格式：问题清单必须用 Markdown 表格呈现。',
  '',
  '输出要求：',
  '- 先给一句总体结论。',
  '- 再逐条列出问题，每条标明严重程度。',
  '',
  '语气要求：温和、友善，先肯定作者的思路。',
  '',
  '补充说明：涉及安全问题时必须单独高亮。',
  '',
  '注意：这是内部工具，评审意见不会对外公开。',
].join('\n');

console.log('\n[1/6] 存储');
initStore({ force: true });
savePrompt({ id: 'v1', text: V1 });
savePrompt({ id: 'v2', text: V2 });
check(getPrompt('v1').text === V1, '提示词快照可写入并读回');
check(getPrompt('v2').text === V2, '第二个快照可读回');

console.log('\n[2/6] diff');
const hunks = diffHunks(V1, V2);
check(hunks.length === 3, `三处独立改动被拆成 3 个 hunk（实际 ${hunks.length}）`);
check(
  hunks.some((h) => h.newLines.some((l) => l.includes('表格'))),
  '表格指令单独成块'
);
check(
  hunks.some((h) => h.newLines.some((l) => l.includes('温和'))),
  '语气指令单独成块'
);
check(diffHunks(V1, V1).length === 0, '相同文本没有 hunk');

console.log('\n[3/6] 回退');
let reverted = V2;
for (const h of [...hunks].reverse()) reverted = revertHunk(reverted, h);
check(reverted === V1, '逆序回退全部 hunk 可精确还原旧版本');

console.log('\n[4/6] 归因（mock 模型 + 启发式判定，离线）');
const probesFile = path.join(tmpRoot, 'probes.jsonl');
fs.writeFileSync(
  probesFile,
  [
    JSON.stringify({ id: 'p1', input: 'select * from users where id = ?' }),
    JSON.stringify({ id: 'p2', input: 'average([]) 会返回 NaN 吗' }),
  ].join('\n'),
  'utf8'
);
const attr = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', maxCalls: 50 },
  { log: () => {} }
);
check(attr.hunks.length === 3, '归因结果包含 3 个改动块');
check(attr.calls > 0, '记录了模型调用次数');

const byText = (needle) => attr.hunks.find((h) => h.hunk.newLines.some((l) => l.includes(needle)));
const tableHunk = byText('表格');
const toneHunk = byText('温和');
const noteHunk = byText('内部工具');
check(!!tableHunk && tableHunk.verdict === 'decisive' && tableHunk.effect === 1, '「输出表格」判定为决定性（触发率 100%）');
check(!!toneHunk && toneHunk.verdict === 'decisive', '「语气温和」判定为决定性');
check(!!noteHunk && noteHunk.verdict === 'inert' && noteHunk.effect === 0, '「内部工具」判定为无影响');

console.log('\n[5/6] 报告');
const md = buildMarkdown(attr);
check(md.includes('提示词归因报告'), 'Markdown 报告含标题');
check(md.includes('决定性') && md.includes('无影响'), 'Markdown 报告含判定结论');
check(md.includes('h1'), 'Markdown 报告含证据块');
const html = buildHtml(attr);
check(html.startsWith('<!doctype html>'), 'HTML 报告是完整文档');
check(html.includes('结论排行'), 'HTML 报告含结论表');

console.log('\n[6/7] 收尾');
check(attr.noiseFloor === null, '未要求重复采样时噪声地板为空');

console.log('\n[7/7] 噪声校正（mock 模型确定性输出，噪声应为 0）');
const attr2 = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 2, maxCalls: 100 },
  { log: () => {} }
);
check(attr2.samples === 2, '记录每探针采样次数');
check(attr2.noiseFloor === 0, '确定性模型下噪声地板为 0');
check(attr2.hunks.length === 3, '多采样下仍归因出 3 个改动块');
check(attr2.hunks.every((h) => typeof h.rawEffect === 'number'), '每个改动块同时记录原始变化率与校正后影响');
const md2 = buildMarkdown(attr2);
check(md2.includes('噪声地板'), '报告包含噪声地板字段');
check(md2.includes('原始'), '报告包含原始变化率');
check(attr2.lowConfidence === false, '噪声为 0 且采样足够时不触发低置信度警告');

console.log('\n[8/8] 回归防护');
const { heuristicJudge } = await import('../src/judge.mjs');
const { readProbes } = await import('../src/store.mjs');
check(
  heuristicJudge('今天天气好，适合出门', '今天天气不好，不适合出门').changed === true,
  '启发式判定能识别中文否定翻转（bigram 切分）'
);
let revertRejected = false;
try {
  const h = diffHunks(V1, V2)[0];
  revertHunk(V1, h); // 用旧文本配合新版本的 hunk，坐标对不上
} catch {
  revertRejected = true;
}
check(revertRejected, 'hunk 与文本不匹配时拒绝回退（不产出错误提示词）');
let badJsonlRejected = false;
const badJsonl = path.join(tmpRoot, 'bad.jsonl');
fs.writeFileSync(badJsonl, '{"id":"a","input":"ok"}\n{bad json\n', 'utf8');
try {
  readProbes(badJsonl);
} catch {
  badJsonlRejected = true;
}
check(badJsonlRejected, '.jsonl 里有非法 JSON 行时报错而不是静默当成探针');

console.log('\n[9/11] v1.1：归因对象类型与固定免责声明');
const attrSystem = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 2, maxCalls: 100, kind: 'system' },
  { log: () => {} }
);
check(attrSystem.kind === 'system', 'kind 会写进归因结果');
const pubSystem = toPublicJSON(attrSystem);
check(pubSystem.confidence.level === 'low', '系统提示的假设可信度标记为「较低」');
check(pubSystem.caveats.length === 3 && pubSystem.caveats[0] === CAVEATS[0], '对外 JSON 携带固定三条免责');
const mdSystem = buildMarkdown(attrSystem);
check(mdSystem.includes('阅读须知（固定三条）'), 'Markdown 报告含阅读须知');
check(mdSystem.includes('系统提示'), 'Markdown 报告标注归因对象类型');
check(buildHtml(attrSystem).includes('阅读须知（固定三条）'), 'HTML 报告含阅读须知');
let badKindRejected = false;
try {
  await attribute({ old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', kind: 'nope' }, { log: () => {} });
} catch {
  badKindRejected = true;
}
check(badKindRejected, '未知 --kind 被拒绝');

console.log('\n[10/11] v1.1：dry-run 预演、预算截断与 schema');
const dry = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'deepseek', verify: 'doubao', samples: 2, maxCalls: 100 },
  { log: () => {}, dryRun: true }
);
check(dry.dryRun === true, 'dry-run 返回预演结果');
check(dry.plan.plannedCalls > 0 && dry.plan.generationCalls === 2 * 2 * 4, 'dry-run 正确预估生成调用数');
check(dry.plan.judgeCalls > 0 && dry.plan.verifyCallsMax > 0, 'dry-run 把判定器与复核调用计入预估');
check(dry.plan.fitsBudget === true, '预算充足时 dry-run 标记可运行');
const dryTight = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', maxCalls: 2 },
  { log: () => {}, dryRun: true }
);
check(dryTight.plan.fitsBudget === false, '预算过小时 dry-run 明确提示超出');

const attrBudget = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 1, maxCalls: 5 },
  { log: () => {} }
);
check(attrBudget.samplingInsufficient === true, '预算耗尽时标记采样不足而不是静默丢弃');
check(attrBudget.hunks.some((h) => h.verdict === 'unmeasured' && h.effect === null), '未测完的改动块状态为 unmeasured');
check(attrBudget.lowConfidence === true, '采样不足触发低置信度');
const pubBudget = toPublicJSON(attrBudget);
check(pubBudget.summary.unmeasured >= 1 && pubBudget.summary.samplingInsufficient >= 1, 'JSON 汇总区分 unmeasured 与采样不足');
check(validatePublicJSON(pubBudget).length === 0, '预算截断的结果同样符合对外 schema');
check(buildMarkdown(attrBudget).includes('未测量'), '报告把未测完的块标为未测量');
check(buildMarkdown(attrBudget).includes('不是「无影响」'), '报告明确提醒「采样不足 ≠ 无影响」');

const schemaFile = path.join(PKG_ROOT, 'schema', 'attribution.schema.json');
check(fs.existsSync(schemaFile) && JSON.parse(fs.readFileSync(schemaFile, 'utf8')).$schema.includes('draft-07'), '仓库内置对外 JSON Schema');
const pubAttr = toPublicJSON(attr2);
check(validatePublicJSON(pubAttr).length === 0, '正常归因结果符合对外 schema');
check(pubAttr.extensions && Object.keys(pubAttr.extensions).length === 0, '核心 JSON 的扩展槽为空对象（插件数据唯一出口）');
check(pubAttr.schemaVersion === '1.0', '对外 JSON 带 schemaVersion');

console.log('\n[11/11] v1.1：CLI 门禁与机器输出');
const cliArgs = ['attribute', '--old', 'v1', '--new', 'v2', '--probes', probesFile, '--provider', 'mock', '--judge', 'heuristic', '--max-calls', '100'];
const runCli = (extra) => spawnSync(process.execPath, [path.join(PKG_ROOT, 'src', 'cli.mjs'), ...cliArgs, ...extra], {
  env: process.env,
  encoding: 'utf8',
});
const rJson = runCli(['--json']);
check(rJson.status === 0, '--json 正常退出（0）');
let cliJson = null;
try {
  cliJson = JSON.parse(rJson.stdout);
} catch {
  cliJson = null;
}
check(!!cliJson && validatePublicJSON(cliJson).length === 0, '--json 输出严格符合 schema');
const rFailDecisive = runCli(['--fail-on', 'decisive']);
check(rFailDecisive.status === 2, '--fail-on decisive 命中时退出码为 2');
const rNone = runCli([]);
check(rNone.status === 0, '未开 --fail-on 时退出码为 0');
const rDry = runCli(['--dry-run']);
check(rDry.status === 0 && rDry.stdout.includes('预演'), 'CLI --dry-run 只预演不运行');

const total = passed + failures.length;
console.log(`\n${failures.length ? '✖' : '✔'} ${passed}/${total} 项通过`);
if (failures.length) {
  for (const f of failures) console.log('  失败：' + f);
  process.exit(1);
}
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {}
console.log('全部通过 ✅');
