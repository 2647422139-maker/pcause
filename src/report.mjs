// 报告生成：Markdown（可贴进 PR / 文档）与独立 HTML（可直接双击打开）
import { VERDICT_LABEL } from './attribute.mjs';
import { CAVEATS, KIND_LABEL, KIND_CONFIDENCE } from './schema.mjs';

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const mdCell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const clip = (s, n = 120) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};
const pct = (x) => (x == null ? '—' : (x * 100).toFixed(0) + '%');

const kindOf = (attr) => attr.kind || 'prompt';

function confidenceOf(attr) {
  return KIND_CONFIDENCE[kindOf(attr)] || KIND_CONFIDENCE.prompt;
}

function sortedHunks(attr) {
  const order = { decisive: 0, partial: 1, inert: 2, unmeasured: 3 };
  return [...attr.hunks].sort((a, b) => order[a.verdict] - order[b.verdict] || (b.effect ?? -1) - (a.effect ?? -1));
}

function noiseText(attr) {
  if (attr.noiseSkipped) return '未测（预算不足，跳过噪声地板测量）';
  if (attr.noiseFloor == null) return '未测（加 --samples 2 可测）';
  return `${pct(attr.noiseFloor)}（同一提示词重复生成之间的变化率）`;
}

function insufficientHunks(attr) {
  return attr.hunks.filter((h) => h.samplingInsufficient);
}

function recommendations(attr) {
  const measured = attr.hunks.filter((h) => !h.samplingInsufficient);
  const keep = measured.filter((h) => h.verdict !== 'inert');
  const drop = measured.filter((h) => h.verdict === 'inert');
  const skipped = insufficientHunks(attr);
  const lines = [];
  if (keep.length) {
    lines.push(
      `- 保留并重点维护：${keep
        .map((h) => `${h.hunk.id}（${VERDICT_LABEL[h.verdict]}，校正后影响 ${pct(h.effect)}）`)
        .join('、')}`
    );
  }
  if (drop.length) {
    lines.push(`- 可安全删除（校正后无可测影响）：${drop.map((h) => h.hunk.id).join('、')}`);
  }
  if (skipped.length) {
    lines.push(`- ⚠ 采样不足，结论待补测：${skipped.map((h) => h.hunk.id).join('、')}（预算不足，不能据此下结论）`);
  }
  if (!drop.length && !keep.length) lines.push('- 没有可归因的改动。');
  if (attr.lowConfidence) lines.push('- ⚠ 本次结论置信度偏低，详见上方「稳定性警告」。');
  lines.push('- 「部分影响」只表示在部分探针上观测到行为变化，不表示该改动是坏改动；门禁只是信号门，不是质量门。');
  return lines.join('\n');
}

export function buildMarkdown(attr) {
  const when = new Date(attr.createdAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
  const seconds = (attr.elapsedMs / 1000).toFixed(1);
  const kind = kindOf(attr);
  const conf = confidenceOf(attr);
  const skipped = insufficientHunks(attr);
  const lines = [];
  lines.push('# 提示词归因报告');
  lines.push('');
  lines.push(`> 不猜哪句改动起作用，用反事实消融实验测出来。生成时间：${when}`);
  lines.push('');
  lines.push('## 阅读须知（固定三条）');
  lines.push('');
  for (const c of CAVEATS) lines.push(`- ${c}`);
  lines.push('');
  lines.push('## 实验设置');
  lines.push('');
  lines.push('| 项目 | 值 |');
  lines.push('| --- | --- |');
  lines.push(`| 新版本（基线） | \`${attr.newId}\` |`);
  lines.push(`| 对照版本 | \`${attr.oldId}\` |`);
  lines.push(`| 归因对象 | ${KIND_LABEL[kind] || kind} |`);
  lines.push(`| 假设可信度 | ${conf.label}：${conf.note} |`);
  lines.push(`| 生成模型 | ${attr.provider.name} / ${attr.provider.model}（temperature=${attr.provider.temperature}） |`);
  lines.push(`| 判定器 | ${attr.judge.name}${attr.verify ? `（第二意见：${attr.verify.name}）` : ''} |`);
  lines.push(`| 探针数 | ${attr.probes.length} |`);
  lines.push(`| 每探针采样 | ${attr.samples} 次 |`);
  lines.push(`| 改动块（hunk） | ${attr.hunks.length} |`);
  lines.push(`| 噪声地板 | ${noiseText(attr)} |`);
  lines.push(`| 判定口径 | 校正后影响 ≥50% 决定性，≥20% 部分影响，否则无影响；预算不足的块标记「未测量」 |`);
  lines.push(`| 模型调用 | ${attr.calls} 次（缓存命中 ${attr.cacheHits}/${attr.maxCalls} 预算） |`);
  lines.push(`| 耗时 | ${seconds}s |`);
  lines.push('');
  if (attr.lowConfidence) {
    lines.push('## ⚠ 稳定性警告');
    lines.push('');
    lines.push(`本次归因的置信度偏低：${attr.lowConfidenceReason}。`);
    lines.push('');
    if (skipped.length) {
      lines.push(`- 因预算不足被跳过或未测完的改动块：${skipped.map((h) => h.hunk.id).join('、')}（这些块没有结论，不是「无影响」）；`);
      lines.push('- 提高 `--max-calls` 或减少探针/采样数量后重跑，可以补全这些块的结论；');
    }
    lines.push('- 提高 `--samples`（建议 3）可以更稳定地估计噪声地板与影响；');
    lines.push('- 或改用输出更短、更受约束的提示词/模型，让模型的随机波动变小；');
    lines.push('- 决定性结论在改动上线前，仍建议人工抽看「逐块证据」。');
    lines.push('');
  }
  lines.push('## 结论排行');
  lines.push('');
  lines.push('| # | 改动块 | 类型 | 影响探针 | 校正后影响 | 原始变化率 | 判定 | 第二意见一致 | 备注 |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  sortedHunks(attr).forEach((h, i) => {
    const verify = h.verification
      ? `${h.verification.agree}/${h.verification.total}${h.verification.fallback ? ' ⚠回退' : ''}`
      : '—';
    const note = h.samplingInsufficient ? '采样不足' : h.verificationSkipped ? '复核被跳过' : '';
    lines.push(
      `| ${i + 1} | ${h.hunk.id} | ${h.hunk.type} | ${h.changedCount}/${attr.probes.length} | ${pct(h.effect)} | ${pct(h.rawEffect)} | ${VERDICT_LABEL[h.verdict]} | ${verify} | ${note} |`
    );
  });
  lines.push('');
  lines.push('## 建议');
  lines.push('');
  lines.push(recommendations(attr));
  lines.push('');
  lines.push('## 逐块证据');
  lines.push('');
  for (const h of sortedHunks(attr)) {
    lines.push(`### ${h.hunk.id} · ${VERDICT_LABEL[h.verdict]} · 校正后影响 ${pct(h.effect)}（原始 ${pct(h.rawEffect)}）`);
    lines.push('');
    lines.push('```diff');
    for (const l of h.hunk.oldLines) lines.push('- ' + l);
    for (const l of h.hunk.newLines) lines.push('+ ' + l);
    lines.push('```');
    lines.push('');
    if (h.samplingInsufficient) {
      lines.push('- ⚠ 预算不足，该改动块未测完：没有可用的输出对比证据，不能据此判断有影响或无影响。');
      lines.push('');
      continue;
    }
    const rows = (h.evidence || []).slice(0, 3);
    for (const e of rows) {
      lines.push(
        `- 探针 \`${e.probeId}\`：该探针上有 ${pct(e.changedRate)} 的采样配对判为行为改变${e.changed ? '' : '（展示的配对为未变）'}`
      );
      lines.push(`  - 新提示词输出：\`${mdCell(clip(e.a, 110))}\``);
      lines.push(`  - 回退 ${h.hunk.id} 后：\`${mdCell(clip(e.b, 110))}\``);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function buildHtml(attr) {
  const when = new Date(attr.createdAt || Date.now()).toISOString().replace('T', ' ').slice(0, 19);
  const kind = kindOf(attr);
  const conf = confidenceOf(attr);
  const skipped = insufficientHunks(attr);
  const rows = sortedHunks(attr)
    .map(
      (h) => `<tr class="${h.verdict === 'unmeasured' ? 'row-off' : ''}">
      <td><code>${esc(h.hunk.id)}</code></td>
      <td class="mono">${esc(h.hunk.summary)}</td>
      <td>${h.hunk.type}</td>
      <td>${h.verdict === 'unmeasured' ? '—' : `${h.changedCount}/${attr.probes.length}`}</td>
      <td>${h.effect == null ? '—' : `<div class="bar"><span style="width:${Math.round(Math.max(0, Math.min(1, h.effect)) * 100)}%"></span></div>${pct(h.effect)}`}</td>
      <td class="muted">${pct(h.rawEffect)}</td>
      <td><span class="tag ${h.verdict}">${VERDICT_LABEL[h.verdict]}</span></td>
      <td>${h.verification ? `${h.verification.agree}/${h.verification.total}${h.verification.fallback ? ' ⚠' : ''}` : '—'}</td>
      <td class="muted">${h.samplingInsufficient ? '采样不足' : h.verificationSkipped ? '复核被跳过' : ''}</td>
    </tr>`
    )
    .join('\n');

  const details = sortedHunks(attr)
    .map((h) => {
      const diff = [
        ...h.hunk.oldLines.map((l) => `<div class="del">- ${esc(l)}</div>`),
        ...h.hunk.newLines.map((l) => `<div class="add">+ ${esc(l)}</div>`),
      ].join('');
      if (h.samplingInsufficient) {
        return `<details class="off">
        <summary><code>${esc(h.hunk.id)}</code> · ${VERDICT_LABEL[h.verdict]} · 预算不足，未测完</summary>
        <div class="diff">${diff}</div>
        <div class="warnbox">⚠ 预算不足：该改动块没有可用的输出对比证据，不能据此判断有影响或无影响。提高 <code>--max-calls</code> 后重跑可补全。</div>
      </details>`;
      }
      const evidence = (h.evidence || [])
        .map(
          (e) => `<div class="pair">
            <div class="probe">探针 <code>${esc(e.probeId)}</code> — 变化率 ${pct(e.changedRate)}，展示的配对：${e.changed ? '<span class="yes">行为改变</span>' : '<span class="no">行为未变</span>'}：${esc(e.reason || '')}</div>
            <div class="io"><b>新提示词输出</b>\n${esc(clip(e.a, 400))}</div>
            <div class="io" style="margin-top:6px"><b>回退 ${esc(h.hunk.id)} 后</b>\n${esc(clip(e.b, 400))}</div>
          </div>`
        )
        .join('');
      return `<details ${h.verdict !== 'inert' ? 'open' : ''}>
        <summary><code>${esc(h.hunk.id)}</code> · ${VERDICT_LABEL[h.verdict]} · 校正后影响 ${pct(h.effect)}（原始 ${pct(h.rawEffect)}）</summary>
        <div class="diff">${diff}</div>
        ${evidence}
      </details>`;
    })
    .join('\n');

  const warning = attr.lowConfidence
    ? `<section><h2>⚠ 稳定性警告</h2><div class="card warn">${esc(attr.lowConfidenceReason)}</div>${
        skipped.length
          ? `<div class="card warn" style="margin-top:10px">因预算不足被跳过或未测完的改动块：${skipped
              .map((h) => esc(h.hunk.id))
              .join('、')}。这些块没有结论，<b>不是「无影响」</b>；提高 <code>--max-calls</code> 后重跑可补全。</div>`
          : ''
      }</section>`
    : '';

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>提示词归因报告 · ${esc(attr.id)}</title>
<style>
  :root { color-scheme: light dark; --bg:#0f1115; --panel:#171a21; --fg:#e6e8ee; --muted:#98a0b3;
    --line:#2a2f3a; --accent:#7aa2ff; --good:#3ecf8e; --warn:#f0b429; --bad:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; padding:40px 24px; background:var(--bg); color:var(--fg);
    font:15px/1.6 "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; }
  main { max-width: 1040px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 6px; letter-spacing: .2px; }
  .sub { color: var(--muted); margin-bottom: 28px; }
  .meta { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px,1fr)); gap:12px; margin-bottom:26px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card.warn { border-color: rgba(240,180,41,.5); color: var(--warn); }
  .card .k { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
  .card .v { font-size:17px; margin-top:4px; word-break:break-all; }
  .card .note { color:var(--muted); font-size:12.5px; margin-top:6px; }
  .caveats { list-style:none; padding:0; margin:0; display:grid; gap:8px; }
  .caveats li { background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--accent); border-radius:8px; padding:9px 12px; font-size:13.5px; color:#c8cfdd; }
  table { width:100%; border-collapse: collapse; background:var(--panel); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
  th, td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--line); font-size:14px; }
  th { color:var(--muted); font-weight:600; font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  tr:last-child td { border-bottom:none; }
  tr.row-off td { opacity:.62; }
  code, .mono { font-family: ui-monospace, "Cascadia Code", Consolas, monospace; font-size:12.5px; }
  .mono { display:inline-block; max-width: 420px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; }
  .muted { color: var(--muted); }
  .tag { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px; font-weight:600; }
  .tag.decisive { background: rgba(255,107,107,.15); color: var(--bad); }
  .tag.partial { background: rgba(240,180,41,.15); color: var(--warn); }
  .tag.inert { background: rgba(62,207,142,.14); color: var(--good); }
  .tag.unmeasured { background: rgba(152,160,179,.16); color: var(--muted); }
  .bar { display:inline-block; width:80px; height:8px; background:var(--line); border-radius:4px; margin-right:8px; vertical-align:middle; overflow:hidden; }
  .bar span { display:block; height:100%; background:var(--accent); }
  section { margin-top:34px; }
  h2 { font-size:17px; margin: 0 0 14px; }
  details { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:12px 16px; margin-bottom:12px; }
  details.off { opacity:.8; }
  summary { cursor:pointer; font-weight:600; }
  .diff { margin:12px 0; padding:10px 12px; background:#0b0d11; border-radius:8px; font-family:ui-monospace,Consolas,monospace; font-size:12.5px; }
  .diff .add { color: var(--good); }
  .diff .del { color: var(--bad); }
  .pair { border-top:1px dashed var(--line); padding-top:10px; margin-top:10px; }
  .probe { color:var(--muted); font-size:13px; margin-bottom:6px; }
  .yes { color: var(--bad); font-weight:600; }
  .no { color: var(--good); font-weight:600; }
  .io { background:#0b0d11; border-radius:8px; padding:10px 12px; font-family:ui-monospace,Consolas,monospace; font-size:12.5px; white-space:pre-wrap; }
  .warnbox { margin-top:10px; color:var(--warn); font-size:13px; }
  .foot { color:var(--muted); font-size:12px; margin-top:40px; }
</style>
</head>
<body>
<main>
  <h1>提示词归因报告</h1>
  <div class="sub">不猜哪句改动起作用，用反事实消融实验测出来 · ${esc(attr.id)} · ${esc(when)}</div>
  <section>
    <h2>阅读须知（固定三条）</h2>
    <ul class="caveats">${CAVEATS.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
  </section>
  <div class="meta" style="margin-top:22px">
    <div class="card"><div class="k">新版本 / 对照</div><div class="v">${esc(attr.newId)} ← ${esc(attr.oldId)}</div></div>
    <div class="card"><div class="k">归因对象</div><div class="v">${esc(KIND_LABEL[kind] || kind)}</div><div class="note">假设可信度：${esc(conf.label)}</div></div>
    <div class="card"><div class="k">生成模型</div><div class="v">${esc(attr.provider.name)} / ${esc(attr.provider.model)}</div></div>
    <div class="card"><div class="k">判定器</div><div class="v">${esc(attr.judge.name)}${attr.verify ? ' + ' + esc(attr.verify.name) : ''}</div></div>
    <div class="card"><div class="k">探针 / 采样 / 改动块</div><div class="v">${attr.probes.length} / ${attr.samples} / ${attr.hunks.length}</div></div>
    <div class="card"><div class="k">噪声地板</div><div class="v">${attr.noiseFloor == null ? '未测' : pct(attr.noiseFloor)}</div></div>
    <div class="card"><div class="k">调用 / 耗时</div><div class="v">${attr.calls} 次 · ${(attr.elapsedMs / 1000).toFixed(1)}s</div></div>
  </div>
  ${warning}
  <section>
    <h2>结论排行</h2>
    <table>
      <thead><tr><th>改动块</th><th>内容</th><th>类型</th><th>影响探针</th><th>校正后影响</th><th>原始</th><th>判定</th><th>第二意见</th><th>备注</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>
  <section>
    <h2>建议</h2>
    <div class="card" style="white-space:pre-wrap">${esc(recommendations(attr))}</div>
  </section>
  <section>
    <h2>逐块证据</h2>
    ${details}
  </section>
  <div class="foot">由 pcause 生成 · 反事实消融 + 噪声校正 + 异构模型判定 · 判定器可能出错，决定性结论建议人工复核。本分析不检测改动交互效应，结论不构成严格因果证明。</div>
</main>
</body>
</html>`;
}
