// 稳定机器可读输出：把内部归因对象映射成对外冻结的核心 schema。
// 约定（v1.0）：核心字段冻结、语义化版本维护；所有插件/自定义扩展数据只能放进 extensions，
// 上层 CI、对比工具只信任核心字段，永远不读 extensions。

export const SCHEMA_VERSION = '1.0';

export const KINDS = ['prompt', 'system', 'agent'];

export const KIND_LABEL = { prompt: '用户提示词', system: '系统提示', agent: 'Agent 指令' };

// 静态查表得出的假设可信度：不做动态评分，避免让用户误解为统计置信度。
export const KIND_CONFIDENCE = {
  prompt: {
    level: 'medium',
    label: '中等',
    note: '普通提示词的独立改动块之间耦合较少，hunk 独立性假设相对最好。',
  },
  system: {
    level: 'low',
    label: '较低',
    note: '系统提示权重高，一句话的改动可能全局改变模型行为，hunk 独立性假设更容易被破坏。',
  },
  agent: {
    level: 'low',
    label: '较低',
    note: 'Agent 指令改动常影响工具调用流程与多轮行为，hunk 独立性假设更容易被破坏。',
  },
};

// 报告首页固定展示的三段免责声明（原文固定，不做动态改写）。
export const CAVEATS = [
  '假设：本分析假设各改动块（hunk）近似独立，不检测改动与改动之间的交互效应。',
  '约束：结论高度依赖探针集合、判定器与采样随机噪声；判定器本身也可能出错。',
  '泛化：归因对象类型不同（提示词 / 系统提示 / Agent 指令），上述假设的可信度不同。',
];

const STATUS = ['decisive', 'partial', 'inert', 'unmeasured'];

function confidenceOf(kind) {
  return KIND_CONFIDENCE[kind] || KIND_CONFIDENCE.prompt;
}

function toPublicHunk(h, probeCount) {
  return {
    id: String(h.hunk.id),
    type: h.hunk.type,
    summary: h.hunk.summary,
    status: STATUS.includes(h.verdict) ? h.verdict : 'unmeasured',
    effect: h.effect == null ? null : Number(h.effect),
    rawEffect: h.rawEffect == null ? null : Number(h.rawEffect),
    changedProbes: h.changedCount ?? 0,
    probeCount,
    samplesUsed: Number.isFinite(h.samplesUsed) ? h.samplesUsed : null,
    extended: Boolean(h.extended),
    samplingInsufficient: Boolean(h.samplingInsufficient),
    unreliableProbes: h.unreliableProbes || [],
    verification: h.verification
      ? {
          judge: h.verification.judge,
          model: h.verification.model,
          agree: h.verification.agree,
          total: h.verification.total,
          fallback: Boolean(h.verification.fallback),
        }
      : null,
    verificationSkipped: Boolean(h.verificationSkipped),
  };
}

export function summaryOf(attr) {
  const summary = { hunks: attr.hunks.length, decisive: 0, partial: 0, inert: 0, unmeasured: 0, samplingInsufficient: 0 };
  for (const h of attr.hunks) {
    const status = STATUS.includes(h.verdict) ? h.verdict : 'unmeasured';
    summary[status === 'unmeasured' ? 'unmeasured' : status] += 1;
    if (h.samplingInsufficient) summary.samplingInsufficient += 1;
  }
  return summary;
}

/**
 * 映射为对外稳定 JSON（schema/attribution.schema.json）。
 * @param {object} attr 内部归因对象
 * @param {{planned?: object}} [extra] dry-run 时的调用预估
 */
export function toPublicJSON(attr, extra = {}) {
  const kind = attr.kind || 'prompt';
  const out = {
    schemaVersion: SCHEMA_VERSION,
    id: attr.id,
    createdAt: attr.createdAt || null,
    kind,
    kindLabel: KIND_LABEL[kind] || KIND_LABEL.prompt,
    confidence: confidenceOf(kind),
    caveats: CAVEATS,
    experiment: {
      oldId: attr.oldId,
      newId: attr.newId,
      probes: attr.probes.length,
      samples: attr.samples,
      sampling: {
        policy: attr.earlyStop ? 'adaptive' : 'fixed',
        minSamples: attr.minSamples ?? attr.samples,
        samples: attr.samples,
      },
      provider: attr.provider,
      judge: attr.judge,
      verify: attr.verify || null,
      maxCalls: attr.maxCalls ?? null,
      calls: attr.calls ?? 0,
      cacheHits: attr.cacheHits ?? 0,
      elapsedMs: attr.elapsedMs ?? 0,
      dryRun: Boolean(attr.dryRun),
    },
    noise: {
      floor: attr.noiseFloor,
      perProbe: attr.noisePerProbe,
      adjusted: Boolean(attr.noiseAdjusted),
      unreliableProbes: attr.unreliableProbes || [],
    },
    lowConfidence: Boolean(attr.lowConfidence),
    lowConfidenceReason: attr.lowConfidenceReason || null,
    hunks: attr.hunks.map((h) => toPublicHunk(h, attr.probes.length)),
    summary: summaryOf(attr),
    extensions: {},
  };
  if (extra.planned) {
    out.estimates = extra.planned;
    out.experiment.dryRun = true;
  }
  return out;
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isStr = (v) => typeof v === 'string';

/** 只做「核心契约」校验的最小实现（不引第三方依赖）。返回错误信息数组。 */
export function validatePublicJSON(obj) {
  const errs = [];
  const req = (cond, msg) => {
    if (!cond) errs.push(msg);
  };
  req(obj && typeof obj === 'object', '根节点必须是对象');
  if (!obj || typeof obj !== 'object') return errs;
  req(obj.schemaVersion === SCHEMA_VERSION, `schemaVersion 必须是 ${SCHEMA_VERSION}`);
  req(isStr(obj.id) && obj.id.length > 0, 'id 必须是非空字符串');
  req(KINDS.includes(obj.kind), `kind 必须是 ${KINDS.join(' / ')} 之一`);
  req(obj.confidence && ['low', 'medium'].includes(obj.confidence.level), 'confidence.level 非法');
  req(Array.isArray(obj.caveats) && obj.caveats.length === 3, 'caveats 必须固定为 3 条');

  const e = obj.experiment || {};
  req(isStr(e.oldId) && isStr(e.newId), 'experiment.oldId / newId 必须是字符串');
  req(isNum(e.probes) && e.probes > 0, 'experiment.probes 必须是正数');
  req(isNum(e.samples) && e.samples >= 1, 'experiment.samples 必须是 ≥1 的数');
  if (e.sampling) {
    req(['adaptive', 'fixed'].includes(e.sampling.policy), 'experiment.sampling.policy 必须是 adaptive / fixed');
    req(isNum(e.sampling.minSamples) && e.sampling.minSamples >= 1, 'experiment.sampling.minSamples 必须是 ≥1 的数');
    req(isNum(e.sampling.samples) && e.sampling.samples >= 1, 'experiment.sampling.samples 必须是 ≥1 的数');
  }
  req(e.provider && isStr(e.provider.name), 'experiment.provider.name 缺失');
  req(e.judge && isStr(e.judge.name), 'experiment.judge.name 缺失');
  req(typeof e.dryRun === 'boolean', 'experiment.dryRun 必须是布尔值');

  req(obj.noise && typeof obj.noise === 'object', 'noise 缺失');
  if (obj.noise) req(obj.noise.floor === null || isNum(obj.noise.floor), 'noise.floor 必须是数字或 null');

  req(Array.isArray(obj.hunks), 'hunks 必须是数组');
  for (const [i, h] of (obj.hunks || []).entries()) {
    const where = `hunks[${i}]`;
    req(isStr(h.id), `${where}.id 缺失`);
    req(isStr(h.type), `${where}.type 缺失`);
    req(isStr(h.summary), `${where}.summary 缺失`);
    req(STATUS.includes(h.status), `${where}.status 必须是 ${STATUS.join(' / ')} 之一`);
    req(h.effect === null || isNum(h.effect), `${where}.effect 必须是数字或 null`);
    req(h.rawEffect === null || isNum(h.rawEffect), `${where}.rawEffect 必须是数字或 null`);
    req(typeof h.samplingInsufficient === 'boolean', `${where}.samplingInsufficient 必须是布尔值`);
    if (h.samplesUsed !== null && h.samplesUsed !== undefined) {
      req(isNum(h.samplesUsed) && h.samplesUsed >= 0, `${where}.samplesUsed 必须是 ≥0 的数`);
    }
    if (h.extended !== undefined) req(typeof h.extended === 'boolean', `${where}.extended 必须是布尔值`);
    const s = h.status;
    if (s === 'unmeasured') {
      req(h.effect === null, `${where}: unmeasured 的 effect 必须为 null`);
    } else {
      req(isNum(h.effect), `${where}: ${s} 必须有 effect 数值`);
    }
  }

  const sum = obj.summary || {};
  req(isNum(sum.hunks) && sum.hunks === (obj.hunks || []).length, 'summary.hunks 与 hunks 长度不一致');
  for (const k of ['decisive', 'partial', 'inert', 'unmeasured', 'samplingInsufficient']) {
    req(isNum(sum[k]), `summary.${k} 必须是数字`);
  }
  req(obj.extensions && typeof obj.extensions === 'object' && !Array.isArray(obj.extensions), 'extensions 必须是对象');
  return errs;
}
