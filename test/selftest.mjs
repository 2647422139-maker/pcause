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

console.log('\n[12/12] v1.2：归因结论迁移对比（compare）');
const { compareAttributions, compareSignatures, buildCompareMarkdown } = await import('../src/compare.mjs');
const sameCmp = compareAttributions(attr2, attr2);
check(sameCmp.compatible === true, '同签名归因可直接对比');
check(
  sameCmp.hunks.length === 3 && sameCmp.hunks.every((r) => r.status === 'same'),
  '同签名对比时 3 个改动块结论全部「不变」'
);
let incompatibleRejected = false;
try {
  compareAttributions(attr, attr2);
} catch (err) {
  incompatibleRejected = err.code === 'PCAUSE_SIGNATURE';
}
check(incompatibleRejected, '采样数不同的两次实验默认拒绝对比（防误读）');
const forced = compareAttributions(attr, attr2, { allowIncompatible: true });
check(
  forced.compatible === false && forced.mismatches.some((m) => m.field === 'samples'),
  '--allow-incompatible 可强行对比并列出签名差异'
);
check(compareSignatures(attr, attr2).length > 0, 'compareSignatures 能量化签名差异');

// 构造一份「结论发生迁移」的新归因：表格 决定性→无影响、语气 决定性→部分、内部说明消失、新增一块
const attrB = structuredClone(attr2);
attrB.id = 'attrB';
attrB.hunks.find((h) => h.hunk.newLines.some((l) => l.includes('表格'))).verdict = 'inert';
attrB.hunks.find((h) => h.hunk.newLines.some((l) => l.includes('表格'))).effect = 0;
attrB.hunks.find((h) => h.hunk.newLines.some((l) => l.includes('温和'))).verdict = 'partial';
attrB.hunks.find((h) => h.hunk.newLines.some((l) => l.includes('温和'))).effect = 0.3;
attrB.hunks = attrB.hunks.filter((h) => !h.hunk.newLines.some((l) => l.includes('内部工具')));
attrB.hunks.push({
  hunk: { id: 'hX', type: 'added', oldLines: [], newLines: ['新增的一行要求'], summary: '新增的一行要求' },
  verdict: 'partial',
  effect: 0.25,
  rawEffect: 0.25,
});
const migration = compareAttributions(attr2, attrB);
const rowOf = (needle) => migration.hunks.find((r) => r.summary.includes(needle));
check(
  rowOf('表格')?.status === 'downgraded' && rowOf('表格')?.effectDelta === -1,
  '决定性→无影响被标记为降级，且影响差值为 -100pt'
);
check(rowOf('温和')?.status === 'downgraded' && rowOf('温和')?.verdictChanged === true, '结论迁移被标记 verdictChanged');
check(rowOf('内部工具')?.status === 'removed', 'B 中消失的改动块标记为「消失」');
check(rowOf('新增')?.status === 'added', 'B 中新增的改动块标记为「新增」');
const cmpMd = buildCompareMarkdown(migration);
check(cmpMd.includes('归因对比') && cmpMd.includes('降级') && cmpMd.includes('消失'), '对比 Markdown 含标题与迁移状态');

const runCompare = (args) =>
  spawnSync(process.execPath, [path.join(PKG_ROOT, 'src', 'cli.mjs'), 'compare', ...args], {
    env: process.env,
    encoding: 'utf8',
  });
const rCmp = runCompare([attr2.id, attr2.id]);
check(rCmp.status === 0 && rCmp.stdout.includes('不变'), 'CLI compare 同签名退出码 0 且报告「不变」');
const rCmpJson = runCompare([attr2.id, attr2.id, '--json']);
let cmpJson = null;
try {
  cmpJson = JSON.parse(rCmpJson.stdout);
} catch {
  cmpJson = null;
}
check(!!cmpJson && cmpJson.ok === true && Array.isArray(cmpJson.hunks), 'CLI compare --json 输出机器可读结果');
const rCmpBad = runCompare([attr.id, attr2.id]);
check(rCmpBad.status === 1 && rCmpBad.stderr.includes('签名不一致'), 'CLI compare 签名不一致时退出码 1 并说明原因');

console.log('\n[13/13] v1.3：有界并发（--concurrency）');
const { mapLimit } = await import('../src/concurrency.mjs');
let active = 0;
let peak = 0;
const doubled = await mapLimit(Array.from({ length: 12 }, (_, i) => i), 3, async (x) => {
  active++;
  peak = Math.max(peak, active);
  await new Promise((r) => setTimeout(r, 5));
  active--;
  return x * 2;
});
check(peak <= 3 && peak >= 2, `并发上限生效（峰值 ${peak}，上限 3）`);
check(doubled.every((v, i) => v === i * 2), '并发结果按输入顺序返回，顺序稳定');
const progress = [];
await mapLimit([1, 2, 3, 4, 5], 2, async (x) => x, {
  onProgress: (d, t) => progress.push(`${d}/${t}`),
});
check(progress.length === 5 && progress[4] === '5/5', 'onProgress 按完成数上报进度');

let started = 0;
let rejected = '';
try {
  await mapLimit([1, 2, 3, 4, 5], 2, async (x) => {
    started++;
    if (x === 2) throw new Error('boom');
    await new Promise((r) => setTimeout(r, 5));
    return x;
  });
} catch (err) {
  rejected = err.message;
}
check(rejected === 'boom', '任一任务失败时抛出原始错误');
check(started <= 4, `失败后不再调度新任务（已启动 ${started}/5）`);

const runAttr = (concurrency, maxCalls) =>
  attribute(
    { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 2, maxCalls, concurrency },
    { log: () => {} }
  );
const attrC1 = await runAttr(1, 100);
const attrC4 = await runAttr(4, 100);
check(attrC1.concurrency === 1 && attrC4.concurrency === 4, '归因结果记录本次并发度');
const brief = (a) => JSON.stringify(a.hunks.map((h) => [h.hunk.id, h.verdict, h.effect, h.rawEffect]));
check(brief(attrC1) === brief(attrC4), '并发度不改变归因结论与数值（结果按固定序号落位）');
const attrConcBudget = await runAttr(3, 12);
check(attrConcBudget.calls <= 12, `并发下 --max-calls 仍是硬上限（实际 ${attrConcBudget.calls} 次）`);
check(attrConcBudget.samplingInsufficient === true, '并发 + 预算耗尽时正确标记采样不足');
const rConc = spawnSync(process.execPath, [path.join(PKG_ROOT, 'src', 'cli.mjs'), ...cliArgs, '--concurrency', '3', '--json'], {
  env: process.env,
  encoding: 'utf8',
});
let concJson = null;
try {
  concJson = JSON.parse(rConc.stdout);
} catch {
  concJson = null;
}
check(rConc.status === 0 && !!concJson && validatePublicJSON(concJson).length === 0, 'CLI 接受 --concurrency 且输出仍符合 schema');
check(JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version === '0.11.0', '版本号升到 0.11.0');

console.log('\n[14/14] v1.4：Provider / Judge 插件注册表');
const { loadPluginRegistry } = await import('../src/plugins.mjs');
const { makeProvider } = await import('../src/providers.mjs');
const { makeJudge } = await import('../src/judge.mjs');
const exampleConfig = path.join(PKG_ROOT, 'examples', 'pcause.config.example.json');
const reg = loadPluginRegistry(exampleConfig);
check(reg.provider.has('echo-system') && reg.judge.has('exact'), '从 pcause.config.json 读取插件声明');

let unknownErr = null;
try {
  await attribute({ old: 'v1', new: 'v2', probes: probesFile, provider: 'nope', judge: 'heuristic', config: exampleConfig, maxCalls: 10 }, { log: () => {} });
} catch (err) {
  unknownErr = err;
}
check(unknownErr?.code === 'PCAUSE_PLUGIN' && /echo-system/.test(unknownErr.message), '未知 provider 报错并列出已配置插件');

const attrPlugin = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'echo-system', judge: 'exact', samples: 2, config: exampleConfig, maxCalls: 100 },
  { log: () => {} }
);
check(attrPlugin.hunks.length === 3, '插件 provider + 插件 judge 能跑通完整归因');
check(attrPlugin.noiseFloor === 0, '确定性插件 provider 的噪声地板为 0');
check(attrPlugin.hunks.every((h) => h.verdict === 'decisive'), '内容精确比较插件判定三处改动均为决定性');
check(attrPlugin.hunks.every((h) => Array.isArray(h.evidence) && h.evidence.length > 0), '插件归因同样产出逐块证据');

const plug = makeProvider('echo-system', { config: exampleConfig });
const out1 = await plug.generate({ system: 's1', user: 'u1' });
const out2 = await plug.generate({ system: 's1', user: 'u1' });
check(out1 === out2 && plug.stats.calls === 1 && plug.stats.cacheHits === 1, '插件 provider 接入核心缓存（第二次命中）');

const pj = makeJudge('exact', { config: exampleConfig });
const judgePairs = [{ a: 'aaa', b: 'a' }, { a: 'bb', b: 'bb' }];
const v1 = await pj.judgeBatch(judgePairs);
const v2 = await pj.judgeBatch(judgePairs);
check(v1.length === 2 && v1[0].changed === true && v1[1].changed === false, '插件 judge 返回等长判定数组');
check(pj.stats.calls === 1 && pj.stats.cacheHits === 1, '插件 judge 接入核心缓存');

const writeCfg = (name, obj) => {
  const p = path.join(tmpRoot, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
};
const badModule = writeCfg('bad-module.json', { provider: { ghost: { module: './ghost.mjs' } } });
let ghostErr = null;
try {
  await attribute({ old: 'v1', new: 'v2', probes: probesFile, provider: 'ghost', judge: 'heuristic', config: badModule, maxCalls: 10 }, { log: () => {} });
} catch (err) {
  ghostErr = err;
}
check(ghostErr?.code === 'PCAUSE_PLUGIN' && /不存在/.test(ghostErr.message), '插件模块缺失时报明确错误');

const badShapeModule = path.join(tmpRoot, 'bad-shape.mjs');
fs.writeFileSync(badShapeModule, 'export default function () { return {}; }\n');
const badShapeCfg = writeCfg('bad-shape.json', { judge: { half: { module: './bad-shape.mjs' } } });
let shapeErr = null;
try {
  await attribute({ old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'half', config: badShapeCfg, maxCalls: 10 }, { log: () => {} });
} catch (err) {
  shapeErr = err;
}
check(shapeErr?.code === 'PCAUSE_PLUGIN' && /judgeBatch/.test(shapeErr.message), '插件缺少必需方法时拒绝加载');

const badJson = path.join(tmpRoot, 'bad.json');
fs.writeFileSync(badJson, '{ not json');
let jsonErr = null;
try {
  loadPluginRegistry(badJson);
} catch (err) {
  jsonErr = err;
}
check(jsonErr?.code === 'PCAUSE_PLUGIN', '非法配置文件被拒绝');

const reservedCfg = writeCfg('reserved.json', { provider: { deepseek: { module: './ghost.mjs' } } });
let reservedErr = null;
try {
  loadPluginRegistry(reservedCfg);
} catch (err) {
  reservedErr = err;
}
check(reservedErr?.code === 'PCAUSE_PLUGIN' && /内置/.test(reservedErr.message), '禁止用插件覆盖内置通道');

const rPlugin = spawnSync(
  process.execPath,
  [path.join(PKG_ROOT, 'src', 'cli.mjs'), 'attribute', '--old', 'v1', '--new', 'v2', '--probes', probesFile, '--provider', 'echo-system', '--judge', 'exact', '--config', exampleConfig, '--max-calls', '100', '--json'],
  { env: process.env, encoding: 'utf8' }
);
let pluginJson = null;
try {
  pluginJson = JSON.parse(rPlugin.stdout);
} catch {
  pluginJson = null;
}
check(rPlugin.status === 0 && !!pluginJson && validatePublicJSON(pluginJson).length === 0, 'CLI --config 加载插件并输出合规 JSON');

console.log('\n[15/15] v1.5：采样提前停止（自适应补采样）');
const { shouldExtendSampling, describeSamplingPolicy } = await import('../src/sampling.mjs');
const { planCalls } = await import('../src/attribute.mjs');

check(
  shouldExtendSampling({ rawEffect: 0.45, noiseFloor: 0, minSamples: 2, maxSamples: 3 }) === true,
  '原始变化率落在含糊区间 → 需要补采样'
);
check(
  shouldExtendSampling({ rawEffect: 0.0, noiseFloor: 0, minSamples: 2, maxSamples: 3 }) === false,
  '原始变化率为 0（清晰无影响）→ 提前停止'
);
check(
  shouldExtendSampling({ rawEffect: 1.0, noiseFloor: 0, minSamples: 2, maxSamples: 3 }) === false,
  '原始变化率为 1（清晰决定性）→ 提前停止'
);
check(
  shouldExtendSampling({ rawEffect: 1.0, noiseFloor: 0.2, minSamples: 2, maxSamples: 3 }) === true,
  '噪声地板 ≥15% 时即使效应清晰也补采样'
);
check(
  shouldExtendSampling({ rawEffect: 0.45, noiseFloor: 0, minSamples: 3, maxSamples: 3 }) === false,
  'min 与 max 相同时不可能再补采样'
);
check(/自适应采样/.test(describeSamplingPolicy({ earlyStop: true, samples: 3, minSamples: 2 })), '策略说明包含自适应口径');
check(/固定采样/.test(describeSamplingPolicy({ earlyStop: false, samples: 3, minSamples: 3 })), '策略说明包含固定采样口径');

// mock provider 是确定性的：三处改动分别 决定性 / 决定性 / 无影响，均不该补采样。
const attrFixed = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 3, cache: false, maxCalls: 200 },
  { log: () => {} }
);
const attrEarly = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 3, earlyStop: true, minSamples: 2, cache: false, maxCalls: 200 },
  { log: () => {} }
);
check(attrEarly.hunks.every((h) => h.samplesUsed === 2 && h.extended === false), '清晰结论的改动块提前停止（只用 2 次采样）');
check(attrEarly.calls < attrFixed.calls, '提前停止确实省下生成调用');
check(attrEarly.hunks.map((h) => h.verdict).join(',') === attrFixed.hunks.map((h) => h.verdict).join(','), '自适应采样不改变清晰块的判定');

// 含糊区间：plugin provider 每次输出在 A/B 之间翻转，与提示词无关 → 原始变化率≈50%，应补采样。
fs.writeFileSync(
  path.join(tmpRoot, 'coin.mjs'),
  'let n = 0;\nexport default function () {\n  return { name: "coin", model: "coin-v1", async generate() { return (n++ % 2 === 0) ? "A" : "B"; } };\n}\n'
);
fs.writeFileSync(
  path.join(tmpRoot, 'exact.mjs'),
  `export default function () { return { name: 'exact', async judgeBatch(pairs) { return pairs.map(({ a, b }) => ({ changed: String(a) !== String(b), reason: '内容不同' })); } }; }\n`
);
const coinCfg = writeCfg('coin.json', { provider: { coin: { module: './coin.mjs' } }, judge: { exact: { module: './exact.mjs' } } });
const attrCoin = await attribute(
  { old: 'v1', new: 'v2', probes: probesFile, provider: 'coin', judge: 'exact', config: coinCfg, samples: 3, earlyStop: true, minSamples: 2, cache: false, maxCalls: 200 },
  { log: () => {} }
);
check(attrCoin.hunks.every((h) => h.extended === true && h.samplesUsed === 3), '含糊区间的块补采样到满采样');

const pubAdapt = toPublicJSON(attrCoin);
check(validatePublicJSON(pubAdapt).length === 0, '自适应采样结果仍符合对外 JSON schema');
check(pubAdapt.experiment.sampling.policy === 'adaptive' && pubAdapt.experiment.sampling.minSamples === 2, 'schema 记录自适应策略');
check(pubAdapt.hunks.every((h) => h.extended === true && h.samplesUsed === 3), 'schema 记录每块的采样次数与补采样标记');

const mdAdapt = buildMarkdown(attrCoin);
check(/采样策略/.test(mdAdapt) && /提前停止/.test(mdAdapt) && /补采样/.test(mdAdapt), 'Markdown 报告披露采样策略与提前终止情况');
check(/采样策略/.test(buildHtml(attrCoin)), 'HTML 报告披露采样策略');

let minErr = null;
try {
  await attribute({ old: 'v1', new: 'v2', probes: probesFile, provider: 'mock', judge: 'heuristic', samples: 1, earlyStop: true, maxCalls: 50 }, { log: () => {} });
} catch (err) {
  minErr = err;
}
check(/--samples ≥ 2/.test(String(minErr?.message || '')), '--early-stop 且 samples=1 时明确报错');

const dryEarly = spawnSync(
  process.execPath,
  [path.join(PKG_ROOT, 'src', 'cli.mjs'), 'attribute', '--old', 'v1', '--new', 'v2', '--probes', probesFile, '--provider', 'mock', '--judge', 'heuristic', '--samples', '3', '--min-samples', '2', '--early-stop', '--dry-run', '--json'],
  { env: process.env, encoding: 'utf8' }
);
let dryEarlyJson = null;
try {
  dryEarlyJson = JSON.parse(dryEarly.stdout);
} catch {
  dryEarlyJson = null;
}
check(dryEarly.status === 0 && dryEarlyJson?.plan?.earlyStop === true && dryEarlyJson?.plan?.minSamples === 2, 'CLI 接受并透出 --early-stop / --min-samples');
check(dryEarlyJson?.plan?.plannedCallsMin < dryEarlyJson?.plan?.plannedCalls, 'dry-run 给出调用量上下限');

console.log('\n[16/16] v1.6：--kind 判定维度适配');
const { judgeSystemFor, makeJudge: mkJudge } = await import('../src/judge.mjs');
const { KIND_JUDGE_NOTE } = await import('../src/schema.mjs');

const judgePrompt = judgeSystemFor('prompt');
check(judgePrompt.includes('结构或格式不同') && judgePrompt.includes('核心主张'), '--kind prompt 判定提示词保持原维度（逐字不变）');
check(!judgePrompt.includes('角色边界合规') && !judgePrompt.includes('任务目标达成度'), '--kind prompt 不注入 system/agent 专用维度');

const judgeSystemText = judgeSystemFor('system');
check(judgeSystemText.startsWith(judgePrompt) && judgeSystemText.includes('角色边界合规') && judgeSystemText.includes('安全拒答约束执行'), 'system 判定注入角色边界与安全拒答维度');
check(judgeSystemText.includes('容易误判') && judgeSystemText.includes('合理变通'), 'system 判定提示误判边界');

const judgeAgentText = judgeSystemFor('agent');
check(
  judgeAgentText.includes('任务目标达成度') && judgeAgentText.includes('工具调用策略') && judgeAgentText.includes('终止条件判断正确性') && judgeAgentText.includes('状态与上下文延续正确性'),
  'agent 判定注入任务/工具/终止/状态维度'
);
check(judgeAgentText.includes('副作用与权限风险'), 'agent 判定包含副作用风险维度');
check(judgeSystemFor('bogus') === judgePrompt, '未知 kind 回退到 prompt 判定提示词');

const kindPair = [{ a: 'abc', b: 'xyz' }];
const hjDefault = await mkJudge('heuristic', {}).judgeBatch(kindPair);
const hjSystem = await mkJudge('heuristic', { kind: 'system' }).judgeBatch(kindPair);
check(JSON.stringify(hjDefault) === JSON.stringify(hjSystem), 'heuristic 判定行为不因 --kind 改变（prompt 行为不变）');

check(KIND_JUDGE_NOTE.system.includes('角色边界') && KIND_JUDGE_NOTE.agent.includes('任务达成度'), '报告用判定维度说明与判定提示一致');

const mdKindSystem = buildMarkdown(attrSystem);
check(mdKindSystem.includes('判定维度') && mdKindSystem.includes('角色边界'), 'Markdown 报告披露 system 专用判定维度');
check(buildHtml(attrSystem).includes('判定维度'), 'HTML 报告披露判定维度');
const mdKindPrompt = buildMarkdown(attr);
check(mdKindPrompt.includes('判定维度') && mdKindPrompt.includes('通用实质行为差异'), 'prompt 报告标注通用判定维度');

const cliVersion = spawnSync(process.execPath, [path.join(PKG_ROOT, 'src', 'cli.mjs'), 'version'], { env: process.env, encoding: 'utf8' });
check(String(cliVersion.stdout).includes('0.11.0'), 'CLI 版本号与 package.json 同步（0.11.0）');

console.log('\n[17/17] 维护轮：首次使用者的预算与预期提示');
const rPlan = runCli(['--samples', '2']);
check(rPlan.status === 0 && rPlan.stdout.includes('计划：'), '正式运行前打印一行消耗预估（计划：…）');
check(rPlan.stdout.includes('预计 ≤') && rPlan.stdout.includes('预算'), '预估行含调用量上限与预算');
check(rPlan.stdout.includes('预算单位是模型请求次数'), '明确预算单位是模型请求次数（不是 token/金额）');
const rHelp = spawnSync(process.execPath, [path.join(PKG_ROOT, 'src', 'cli.mjs'), 'help'], { env: process.env, encoding: 'utf8' });
check(String(rHelp.stdout).includes('pcause version'), 'help 列出 version 命令');
check(String(rHelp.stdout).includes('run 选项'), 'help 说明 run 命令的可用选项');
check(String(rHelp.stdout).includes('不是「两次回答谁更好」的打分对比'), 'help 里 compare 的预期被显式锁定');

console.log('\n[18/18] v1.8：发布元数据与 CHANGELOG 同步');
const pkgMeta = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8'));
check(pkgMeta.engines && pkgMeta.engines.node === '>=20', 'package.json 声明 engines: node >=20');
const filesList = Array.isArray(pkgMeta.files) ? pkgMeta.files : [];
check(
  ['src/', 'schema/', 'examples/', 'docs/', 'README.md', 'CHANGELOG.md', 'LICENSE'].every((f) => filesList.includes(f)),
  '发布 files 白名单覆盖源码/示例/文档/许可证'
);
check(!filesList.some((f) => f.includes('.pcause') || f.includes('pcause.config.json') || f.startsWith('test')), '发布包排除 .pcause、本地配置与测试脚本');
check(Boolean(pkgMeta.repository && pkgMeta.repository.url && pkgMeta.bugs && pkgMeta.bugs.url && pkgMeta.homepage), '补齐 repository / bugs / homepage 元数据');
check(Array.isArray(pkgMeta.keywords) && pkgMeta.keywords.includes('causal-inference'), 'keywords 含 causal-inference');

const changelogPath = path.join(PKG_ROOT, 'CHANGELOG.md');
const changelogText = fs.existsSync(changelogPath) ? fs.readFileSync(changelogPath, 'utf8') : '';
check(changelogText.length > 0 && changelogText.includes('## [0.1.0]'), 'CHANGELOG 存在且覆盖初始版本');
const firstVersion = (changelogText.match(/## \[(\d+\.\d+\.\d+)\]/) || [])[1];
check(firstVersion === pkgMeta.version, `CHANGELOG 最新条目与 package.json 版本一致（${pkgMeta.version}）`);
const readmeText = fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');
check(readmeText.includes('CHANGELOG.md'), 'README 提供版本历史入口');
check(fs.existsSync(path.join(PKG_ROOT, 'LICENSE')), 'LICENSE 文件存在');

console.log('\n[19/19] v1.9：结构化错误码与可诊断输出');
const { usage, formatError } = await import('../src/errors.mjs');
const formatted = formatError(usage('示例用法错误', '把参数补全后重试'));
check(formatted.includes('✖ [PCAUSE_USAGE]') && formatted.includes('提示：把参数补全后重试'), 'formatError 输出「✖ [码] 原因 + 提示」两行');
check(!formatted.includes('堆栈'), '默认不打印堆栈（不污染 stderr）');
check(formatError(usage('示例', '提示'), { debug: true }).includes('堆栈'), 'PCAUSE_DEBUG=1 时追加堆栈');
check(formatError(new Error('裸错误')).includes('[PCAUSE_ERROR]'), '未包装的普通错误回退到 PCAUSE_ERROR');

const cliBin = path.join(PKG_ROOT, 'src', 'cli.mjs');
const runRaw = (args, env = process.env) => spawnSync(process.execPath, [cliBin, ...args], { env, encoding: 'utf8' });
const rNotInit = runRaw(['list'], { ...process.env, PCAUSE_HOME: path.join(tmpRoot, 'empty-home') });
check(rNotInit.status === 1 && String(rNotInit.stderr).includes('PCAUSE_NOT_INIT'), '未初始化工作区报 PCAUSE_NOT_INIT 且退出码 1');
check(String(rNotInit.stderr).includes('pcause init'), '报错提示直接给出下一步命令');

const probeArgs = ['attribute', '--old', 'v1', '--new', 'v2', '--provider', 'mock', '--judge', 'heuristic'];
const rBadProbe = runRaw([...probeArgs, '--probes', path.join(tmpRoot, 'nope.jsonl')]);
check(rBadProbe.status === 1 && String(rBadProbe.stderr).includes('PCAUSE_NOT_FOUND'), '找不到探针文件报 PCAUSE_NOT_FOUND');
const rBadProvider = runRaw([...probeArgs, '--probes', probesFile, '--provider', 'nope']);
check(rBadProvider.status === 1 && String(rBadProvider.stderr).includes('PCAUSE_PLUGIN'), '未知 provider 报 PCAUSE_PLUGIN 并列出可选值');
const rNoDiff = runRaw(['attribute', '--old', 'v1', '--new', 'v1', '--probes', probesFile, '--provider', 'mock', '--judge', 'heuristic']);
check(rNoDiff.status === 1 && String(rNoDiff.stderr).includes('PCAUSE_NO_DIFF'), '两份提示词无差异报 PCAUSE_NO_DIFF（明确这是正常结果）');
const rUnknown = runRaw(['nope']);
check(rUnknown.status === 1 && String(rUnknown.stderr).includes('PCAUSE_UNKNOWN_COMMAND'), '未知命令报 PCAUSE_UNKNOWN_COMMAND 且退出码 1');
const rPureJson = runRaw([...probeArgs, '--probes', probesFile, '--json']);
let pureJson = null;
try {
  pureJson = JSON.parse(rPureJson.stdout);
} catch {
  pureJson = null;
}
check(rPureJson.status === 0 && !!pureJson && !rPureJson.stdout.includes('计划：'), '错误体系不污染 stdout（--json 仍可解析）');
check(String(runRaw(['help']).stdout).includes('PCAUSE_DEBUG'), 'help 说明 PCAUSE_DEBUG 调试开关');

console.log('\n[20/20] v1.10：发布前自检（scripts/preflight.mjs）');
const pf = await import('../scripts/preflight.mjs');
check(pf.firstChangelogVersion('## [Unreleased]\n\n## [1.2.3] - 2026\n') === '1.2.3', 'CHANGELOG 最新版本跳过 [Unreleased]');
check(pf.firstChangelogVersion('## [0.9.0]\n## [0.8.0]\n') === '0.9.0', 'CHANGELOG 取最新已发布版本（不被旧条目误判）');
check(pf.firstChangelogVersion('没有版本标题') === null, '无版本标题时返回 null');
check(pf.badgeCounts('![t](https://img.shields.io/badge/selftest-153%2F153%20passing)')?.total === 153, '解析 badge 的 %2F 写法');
check(pf.badgeCounts('![t](https://img.shields.io/badge/selftest-12/12)')?.passed === 12, '解析 badge 的 / 写法');
check(pf.selftestCounts('✔ 153/153 项通过')?.passed === 153, '解析自测输出的通过数');
const pfLinks = pf.localLinks('[a](docs/x.md#标题) [b](https://x.y) [c](#local) [d](CHANGELOG.md)');
check(pfLinks.length === 2 && pfLinks[0].file === 'docs/x.md' && pfLinks[0].anchor === '标题', '本地链接提取：排除 http 与纯锚点、保留锚点');
check(pf.slugify('4.1 出错时怎么办：错误码与自助排查（v1.9）') === '41-出错时怎么办错误码与自助排查v19', 'GitHub 风格标题 slug 可用于锚点校验');
const pfRun = spawnSync(process.execPath, [path.join(PKG_ROOT, 'scripts', 'preflight.mjs'), '--no-tests', '--quiet'], {
  env: process.env,
  encoding: 'utf8',
  cwd: PKG_ROOT,
});
check(pfRun.status === 0, '对当前仓库运行 preflight --no-tests 全部通过');

console.log('\n[21/21] v1.11：GitHub Actions CI（.github/workflows/ci.yml）');
const ciPath = path.join(PKG_ROOT, '.github', 'workflows', 'ci.yml');
check(fs.existsSync(ciPath), 'CI workflow 文件存在');
const ciText = fs.readFileSync(ciPath, 'utf8');
check(ciText.includes('branches: [main]') && ciText.includes('pull_request:') && ciText.includes('workflow_dispatch:'), '触发规则：push main + pull_request + 手动触发');
check(ciText.includes("node: ['20', '22']") && ciText.includes("node: '24'"), '矩阵覆盖 Node 20/22，并前瞻验证 Node 24');
check(ciText.includes('ubuntu-latest') && ciText.includes('windows-latest'), '矩阵覆盖 Linux 与 Windows');
check(ciText.includes('permissions:') && ciText.includes('contents: read'), '最小权限：只读 contents');
check(ciText.includes('group: ${{ github.workflow }}-${{ github.ref }}') && ciText.includes('cancel-in-progress: ${{ github.event_name =='), '并发取消策略：PR 取消旧运行、main 保留');
check(/run: npm test/.test(ciText), 'CI 跑离线自测');
check(ciText.includes('node scripts/preflight.mjs --no-tests'), 'CI 跑发布前静态检查');
check(ciText.includes('npm pack --dry-run'), 'CI 验证发布包白名单');
check(!ciText.includes('secrets.'), 'CI 不引用任何密钥');
check(!ciText.includes('\t'), 'workflow 不含 tab 缩进（YAML 合法前提）');
const readmeCi = fs.readFileSync(path.join(PKG_ROOT, 'README.md'), 'utf8');
check(readmeCi.includes('actions/workflows/ci.yml/badge.svg') && readmeCi.includes('v1.11 更新摘要'), 'README 展示 CI badge 并记录 v1.11');

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
