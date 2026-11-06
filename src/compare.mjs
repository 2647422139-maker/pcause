// 归因对比：对比两次实验的「因果结论」，回答「同一处改动，前后两轮归因的结论变了吗」。
//
// 关键约束（来自豆包评审）：只对比「同一个改动块」的结论，且两次实验的「签名」必须一致，
// 否则结论差异来自实验条件（换模型/换探针/换采样数），而不是提示词的真实因果变化。
//
// 签名 = 探针集合 + 每探针采样次数 + 生成器(名称/模型/温度) + 判定器(名称/模型) + 复核器 + 归因对象类型。

import { VERDICT_LABEL } from './attribute.mjs';

export const VERDICT_RANK = { unmeasured: 0, inert: 1, partial: 2, decisive: 3 };

const STATUS_LABEL = { same: '不变', upgraded: '升级', downgraded: '降级', added: '新增', removed: '消失' };

// 改动块对齐用「内容」而不是 id：h1..hn 是按顺序编号的，插入一行就会整体错位。
export function hunkKey(h) {
  const hl = Array.isArray(h.oldLines) ? h.oldLines : [];
  const nl = Array.isArray(h.newLines) ? h.newLines : [];
  return [h.type, hl.join('\n'), nl.join('\n')].join('\u0000');
}

function probeKey(p) {
  return `${p.id}\u0000${p.input}`;
}

function sameList(xs, ys) {
  if (xs.length !== ys.length) return false;
  for (let i = 0; i < xs.length; i++) if (xs[i] !== ys[i]) return false;
  return true;
}

/** 提取「实验签名」：两次归因只有在签名一致时才具备可比性。 */
export function signatureOf(attr) {
  const probes = (attr.probes || []).map(probeKey).sort();
  return {
    probes,
    samples: attr.samples ?? null,
    provider: {
      name: attr.provider?.name ?? null,
      model: attr.provider?.model ?? null,
      temperature: attr.provider?.temperature ?? null,
    },
    judge: { name: attr.judge?.name ?? null, model: attr.judge?.model ?? null },
    verify: attr.verify ? { name: attr.verify.name ?? null, model: attr.verify.model ?? null } : null,
    // 老版本归因结果没有 kind 字段；当时唯一支持的对象类型就是 prompt，按默认值归一化。
    kind: attr.kind ?? 'prompt',
  };
}

function mismatch(field, a, b, message) {
  return { field, a, b, message };
}

/** 比较两个签名，返回不一致项（空数组表示可比）。 */
export function compareSignatures(a, b) {
  const sa = signatureOf(a);
  const sb = signatureOf(b);
  const out = [];
  if (!sameList(sa.probes, sb.probes)) {
    const missing = sa.probes.filter((x) => !sb.probes.includes(x)).length;
    const extra = sb.probes.filter((x) => !sa.probes.includes(x)).length;
    out.push(
      mismatch(
        'probes',
        sa.probes.length,
        sb.probes.length,
        `探针集不同：A ${sa.probes.length} 个 / B ${sb.probes.length} 个（A 独有 ${missing}，B 独有 ${extra}）`
      )
    );
  }
  if (sa.samples !== sb.samples) out.push(mismatch('samples', sa.samples, sb.samples, `每探针采样次数不同：A=${sa.samples} / B=${sb.samples}`));
  if (sa.provider.name !== sb.provider.name || sa.provider.model !== sb.provider.model)
    out.push(
      mismatch(
        'provider',
        `${sa.provider.name}/${sa.provider.model}`,
        `${sb.provider.name}/${sb.provider.model}`,
        `生成模型不同：A=${sa.provider.name}/${sa.provider.model} / B=${sb.provider.name}/${sb.provider.model}`
      )
    );
  if (sa.provider.temperature !== sb.provider.temperature)
    out.push(mismatch('temperature', sa.provider.temperature, sb.provider.temperature, `采样温度不同：A=${sa.provider.temperature} / B=${sb.provider.temperature}`));
  if (sa.judge.name !== sb.judge.name || sa.judge.model !== sb.judge.model)
    out.push(
      mismatch(
        'judge',
        `${sa.judge.name}/${sa.judge.model}`,
        `${sb.judge.name}/${sb.judge.model}`,
        `判定器不同：A=${sa.judge.name}/${sa.judge.model} / B=${sb.judge.name}/${sb.judge.model}`
      )
    );
  if (JSON.stringify(sa.verify) !== JSON.stringify(sb.verify))
    out.push(mismatch('verify', sa.verify, sb.verify, `第二意见复核器不同：A=${JSON.stringify(sa.verify)} / B=${JSON.stringify(sb.verify)}`));
  if (sa.kind !== sb.kind) out.push(mismatch('kind', sa.kind, sb.kind, `归因对象类型不同：A=${sa.kind} / B=${sb.kind}`));
  return out;
}

function pick(h) {
  return {
    id: h.hunk?.id ?? null,
    summary: h.hunk?.summary ?? '',
    verdict: h.verdict ?? null,
    effect: h.effect ?? null,
    rawEffect: h.rawEffect ?? null,
    samplingInsufficient: Boolean(h.samplingInsufficient),
  };
}

function sameEffect(x, y) {
  if (x === null && y === null) return true;
  if (x === null || y === null) return false;
  return Math.abs(x - y) < 1e-9;
}

/**
 * 对比两份归因结果的结论迁移。
 * @param {object} a 较早的归因结果
 * @param {object} b 较新的归因结果
 * @param {object} opts { allowIncompatible }
 */
export function compareAttributions(a, b, { allowIncompatible = false } = {}) {
  if (!a || !b) throw new Error('compare 需要两份归因结果');
  const mismatches = compareSignatures(a, b);
  if (mismatches.length && !allowIncompatible) {
    const err = new Error(
      '两次实验的签名不一致，结论不可直接对比（差异可能来自实验条件而非提示词改动）：\n  - ' +
        mismatches.map((m) => m.message).join('\n  - ') +
        '\n如确认仍要对比，加 --allow-incompatible（结论需谨慎解读）'
    );
    err.code = 'PCAUSE_SIGNATURE';
    err.mismatches = mismatches;
    throw err;
  }

  // 按内容对齐 hunk；同一内容出现多次时按出现顺序编号，避免互相覆盖。
  const indexA = indexHunks(a.hunks || []);
  const indexB = indexHunks(b.hunks || []);
  const keys = [...indexA.keys()];
  for (const k of indexB.keys()) if (!indexA.has(k)) keys.push(k);

  const rows = keys.map((key) => {
    const before = indexA.get(key);
    const after = indexB.get(key);
    if (!before) return rowOf('added', key, null, after);
    if (!after) return rowOf('removed', key, before, null);
    return rowOf(statusOf(before, after), key, before, after);
  });

  const summary = { same: 0, upgraded: 0, downgraded: 0, added: 0, removed: 0 };
  for (const r of rows) summary[r.status]++;

  return {
    aId: a.id ?? null,
    bId: b.id ?? null,
    compatible: mismatches.length === 0,
    mismatches,
    summary,
    hunks: rows,
    note: mismatches.length ? '签名不一致，结论仅作参考；建议在相同实验条件下重跑后再对比' : null,
  };
}

function indexHunks(hunks) {
  // 同一内容出现多次时，按出现顺序加 #n 后缀，保证 key 唯一、不互相覆盖。
  const seen = new Map();
  const out = new Map();
  for (const h of hunks) {
    const base = hunkKey(h.hunk || {});
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(n === 0 ? base : base + '\u0000#' + n, h);
  }
  return out;
}

function statusOf(before, after) {
  const rb = VERDICT_RANK[before.verdict] ?? 0;
  const ra = VERDICT_RANK[after.verdict] ?? 0;
  if (ra > rb) return 'upgraded';
  if (ra < rb) return 'downgraded';
  return 'same';
}

function rowOf(status, key, before, after) {
  const b = before ? pick(before) : null;
  const c = after ? pick(after) : null;
  const delta = b && c && b.effect != null && c.effect != null ? c.effect - b.effect : null;
  return {
    key,
    status,
    statusLabel: STATUS_LABEL[status],
    hunk: (c || b)?.id ?? null,
    summary: (c || b)?.summary ?? '',
    before: b,
    after: c,
    effectDelta: delta,
    verdictChanged: Boolean(b && c && b.verdict !== c.verdict),
    note:
      status === 'added'
        ? 'B 中新增的改动块，A 中没有对应块'
        : status === 'removed'
          ? 'A 中有、B 中已不存在的改动块'
          : !sameEffect(b.effect, c.effect)
            ? '同一改动块的影响强度发生变化（结论迁移见 before/after）'
            : null,
  };
}

/** 人类可读的对比报告（Markdown）。 */
export function buildCompareMarkdown(result) {
  const lines = [];
  lines.push(`# pcause 归因对比：${result.aId} → ${result.bId}`);
  lines.push('');
  lines.push(result.compatible ? '✔ 两次实验签名一致，结论可直接对比。' : '⚠ 两次实验签名不一致，结论仅作参考。');
  if (result.mismatches?.length) {
    lines.push('');
    lines.push('签名差异：');
    for (const m of result.mismatches) lines.push(`- ${m.message}`);
  }
  lines.push('');
  lines.push('## 结论迁移');
  lines.push('');
  lines.push('| 状态 | 改动块 | 结论 A → B | 影响 A → B | 变化 |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const r of result.hunks) {
    const va = r.before ? VERDICT_LABEL[r.before.verdict] ?? r.before.verdict : '—';
    const vb = r.after ? VERDICT_LABEL[r.after.verdict] ?? r.after.verdict : '—';
    const ea = r.before?.effect == null ? '—' : Math.round(r.before.effect * 100) + '%';
    const eb = r.after?.effect == null ? '—' : Math.round(r.after.effect * 100) + '%';
    const d = r.effectDelta == null ? '—' : (r.effectDelta >= 0 ? '+' : '') + Math.round(r.effectDelta * 100) + 'pt';
    lines.push(`| ${r.statusLabel} | ${r.hunk ?? '—'} ${r.summary} | ${va} → ${vb} | ${ea} → ${eb} | ${d} |`);
  }
  lines.push('');
  const s = result.summary;
  lines.push(`合计：不变 ${s.same}，升级 ${s.upgraded}，降级 ${s.downgraded}，新增 ${s.added}，消失 ${s.removed}。`);
  if (result.note) {
    lines.push('');
    lines.push('> ' + result.note);
  }
  return lines.join('\n') + '\n';
}
