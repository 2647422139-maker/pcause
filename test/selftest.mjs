// 离线自测：不花钱、不联网，验证 diff / 回退 / 归因 / 报告 / 存储 全链路
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pcause-selftest-'));
process.env.PCAUSE_HOME = path.join(tmpRoot, '.pcause');

const { initStore, savePrompt, getPrompt } = await import('../src/store.mjs');
const { diffHunks, revertHunk } = await import('../src/diff.mjs');
const { attribute } = await import('../src/attribute.mjs');
const { buildMarkdown, buildHtml } = await import('../src/report.mjs');

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
