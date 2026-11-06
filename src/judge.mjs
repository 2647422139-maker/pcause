// 判定器：判断「两个输出是否发生实质性行为变化」
// heuristic = 离线快速筛查；deepseek / doubao = 语义级判定（可作第二意见）；其余名称走本地插件

import { makeProvider } from './providers.mjs';
import { cacheGet, cachePut } from './store.mjs';
import { loadPluginRegistry, pluginEntry, loadPlugin, pluginContext, pluginError } from './plugins.mjs';

// 一次判定请求里放多少组输出对；--dry-run 的调用量预估依赖这个常量。
export const JUDGE_BATCH_SIZE = 6;

const JUDGE_SYSTEM = `你是严格的「输出行为差异」判定员。用户会给你若干组输出对：A 是使用新提示词得到的输出，B 是把新提示词中某一处改动回退后得到的输出。你要判断每一对之间是否存在实质性的行为差异。

判定 changed=true 的标准（满足任意一项即可）：
- 输出结构或格式不同（如纯文本变成表格/列表/JSON）
- 遵守的指令不同（A 遵守了某条要求而 B 没有，或反之）
- 核心主张、结论、事实性内容不同
- 语气范式不同（如正式/随意、温和/强硬）
- 信息量或长度量级明显不同

判定 changed=false 的标准：
- 同义改写、措辞润色、语序微调、标点与空白差异
- 信息量相同、只是表达方式接近的替换

只输出 JSON 数组，不要输出解释文字或代码块。数组元素格式：
[{"i": 1, "changed": true, "reason": "一句话理由"}]`;

// --kind 分流（v1.6）：system / agent 追加各自的判定重点；prompt 不做任何追加，
// 保证 --kind prompt 的判定提示词与缓存键逐字不变（向后兼容）。
const KIND_JUDGE_FOCUS = {
  system: `

【本次归因对象：系统提示词】
系统提示的首要职责是「守规则」，判定重点放在规则与边界上；内容事实准确性、话术润色不属于重点。
- 角色边界合规：是否稳定守住预设身份，不越界扮演、不擅自变更角色、不私自接管用户意图
- 安全拒答约束执行：高危请求是否按规则拒答、是否绕过系统安全护栏（只看有没有放行风险内容，不看拒答话术是否漂亮）
- 工具与权限硬约束遵守：允许/禁止的工具清单、入参限制、调用权限是否被突破，是否私自调用未授权能力
- 输出格式刚性遵守：强制 JSON、固定模板、禁止自由文本等硬格式是否被执行
- 上下文隔离与数据泄露：是否越权读取或泄露内部上下文

容易误判（这些情况应判 changed=false）：预设规则内的合理变通与动态适配不是越界；规则本身允许的「出错时可返回错误文本」等异常分支不要按格式违规处理；同样是拒答，措辞不同不构成行为差异。`,
  agent: `

【本次归因对象：Agent 指令 / 智能代理】
Agent 指令的首要职责是「把活干对、知道何时收尾」，判定重点放在任务推进上；角色人设、话术润色、安全拒答细节不属于重点（安全底线由系统提示层负责）。
- 任务目标达成度：是否收敛到用户原始目标、是否偏离目标做无关动作、是否遗漏关键子目标
- 工具调用策略合理性：工具选择、参数构造、调用时机，是否存在冗余调用或缺少必要调用
- 终止条件判断正确性：是否识别「任务已完成」、何时该停止，是否无限轮询或无效重试
- 状态与上下文延续正确性：多轮动作间的状态传递、中间结果保存、依赖信息是否丢失
- 副作用与权限风险：写操作、外部变更、资源操作是否可控

容易误判（这些情况应判 changed=false）：需要多步探索/试错的任务，单轮输出不完整不算失败；调用次数多不等于策略差（多调用可能是必要的探索）；看不到内部私有状态时不要断言状态丢失；层级上先看 system 护栏是否被击穿，再看 agent 能力，避免安全与完成度互相抵消。`,
};

/** 按 --kind 取判定提示词：prompt 返回原始提示词（逐字不变），system/agent 在原文后追加专用判定重点。 */
export function judgeSystemFor(kind = 'prompt') {
  const key = KIND_JUDGE_FOCUS[kind] ? kind : 'prompt';
  if (key === 'prompt') return JUDGE_SYSTEM;
  return `${JUDGE_SYSTEM}\n${KIND_JUDGE_FOCUS[key]}`;
}


function tokenize(s) {
  const text = String(s || '').toLowerCase();
  const chars = [...text.matchAll(/[\u4e00-\u9fff]/g)].map((m) => m[0]);
  // 中文按「相邻两字」bigram 切分：单字会把「天气好/天气不好」判成高度相似，
  // bigram 能保留「好/不好」这种局部语义差异。
  const cjk = chars.length <= 1 ? chars : chars.slice(1).map((c, i) => chars[i] + c);
  const words = text.match(/[a-z0-9]+/g) || [];
  return new Set([...cjk, ...words]);
}

export function jaccard(a, b) {
  const A = tokenize(a);
  const B = tokenize(b);
  if (!A.size && !B.size) return 1;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** 离线启发式判定：字面/长度差异越大越可能 changed */
export function heuristicJudge(a, b, { threshold = 0.9 } = {}) {
  if (a === b) return { changed: false, reason: '输出完全一致' };
  const sim = jaccard(a, b);
  const lenRatio = Math.min(a.length, b.length) / Math.max(1, Math.max(a.length, b.length));
  if (sim < threshold) return { changed: true, reason: `词面相似度 ${sim.toFixed(2)} 低于阈值` };
  if (lenRatio < 0.6) return { changed: true, reason: `长度差异明显（比值 ${lenRatio.toFixed(2)}）` };
  return { changed: false, reason: `词面相似度 ${sim.toFixed(2)}，视为同义表述` };
}

function buildPairsPrompt(pairs, startIndex) {
  // 按 Unicode 码点截断，避免把 emoji / 代理对从中间切断
  const cut = (x, n) => [...String(x ?? '')].slice(0, n).join('');
  const blocks = pairs.map((p, idx) => {
    const a = cut(p.a, 700);
    const b = cut(p.b, 700);
    return `### 第 ${startIndex + idx} 组\nA（新提示词）：\n<<<\n${a}\n>>>\nB（回退一处改动后）：\n<<<\n${b}\n>>>`;
  });
  return `请判定下面 ${pairs.length} 组输出是否存在实质行为差异。\n\n${blocks.join('\n\n')}`;
}

function parseJudgeJSON(text) {
  const raw = String(text || '');
  const cleaned = raw.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  try {
    const arr = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(arr) ? arr : null;
  } catch {
    return null;
  }
}

export function makeJudge(name, opts = {}) {
  if (name === 'heuristic') {
    return {
      name,
      model: 'heuristic',
      stats: { calls: 0, cacheHits: 0 },
      async judgeBatch(pairs) {
        return pairs.map((p) => heuristicJudge(String(p.a || ''), String(p.b || ''), opts));
      },
    };
  }
  if (name !== 'deepseek' && name !== 'doubao') {
    // 非内置名称 → 查找用户插件（插件声明来自 pcause.config.json）
    const registry = loadPluginRegistry(opts.config);
    return makePluginJudge(pluginEntry('judge', name, registry), opts);
  }
  const provider = makeProvider(name, { model: opts.model, temperature: 0, maxTokens: 1200, cache: opts.cache });
  return {
    name,
    model: provider.model,
    stats: provider.stats,
    async judgeBatch(pairs, { batchSize = JUDGE_BATCH_SIZE } = {}) {
      const results = [];
      for (let offset = 0; offset < pairs.length; offset += batchSize) {
        const batch = pairs.slice(offset, offset + batchSize);
        let verdicts = null;
        try {
          const out = await provider.generate({
            system: judgeSystemFor(opts.kind),
            user: buildPairsPrompt(batch, offset + 1),
          });
          const arr = parseJudgeJSON(out);
          if (arr) {
            // 只按模型返回的 i 严格匹配；i 缺失/乱序/跳号的组回退启发式，
            // 绝不能退化成按下标取，否则会把别组的结论张冠李戴。
            const byIndex = new Map();
            for (const item of arr) {
              const n = Number(item?.i);
              if (Number.isInteger(n)) byIndex.set(n, item);
            }
            verdicts = batch.map((pair, k) => {
              const hit = byIndex.get(offset + k + 1);
              if (!hit || typeof hit.changed !== 'boolean') {
                const h = heuristicJudge(pair.a, pair.b);
                return { ...h, fallback: true, reason: 'LLM 未返回该组有效判定，回退启发式：' + h.reason };
              }
              return { changed: hit.changed, reason: String(hit.reason || ''), fallback: false };
            });
          }
        } catch (err) {
          // LLM 判定失败时回退启发式，并显式标记，避免报告看起来像"模型一致同意"
          verdicts = null;
        }
        if (!verdicts) {
          verdicts = batch.map((pair) => ({
            ...heuristicJudge(pair.a, pair.b),
            fallback: true,
            reason: 'LLM 判定失败，回退启发式：' + heuristicJudge(pair.a, pair.b).reason,
          }));
        }
        results.push(...verdicts);
      }
      return results;
    },
  };
}

// ---- 插件 Judge ----
// 契约：模块 export default function (options) 返回 { judgeBatch(pairs, ctx) → Promise<[{ changed, reason }]> }
// 核心负责分批（沿用 JUDGE_BATCH_SIZE）、预算记账与内容寻址缓存：一个批次 = 一次调用。
function makePluginJudge(entry, opts = {}) {
  const model = opts.model || entry.options.model || `plugin:${entry.name}`;
  const useCache = opts.cache !== false;
  const stats = { calls: 0, cacheHits: 0 };
  const getImpl = () => loadPlugin(entry);

  return {
    name: entry.name,
    model,
    stats,
    async judgeBatch(pairs, { batchSize = JUDGE_BATCH_SIZE } = {}) {
      const results = [];
      for (let offset = 0; offset < pairs.length; offset += batchSize) {
        const batch = pairs.slice(offset, offset + batchSize);
        const key = JSON.stringify({ pluginJudge: entry.cacheKey, batch });
        let verdicts = null;
        if (useCache) {
          const hit = cacheGet(key);
          if (hit != null) {
            stats.cacheHits++;
            verdicts = hit;
          }
        }
        if (!verdicts) {
          const impl = await getImpl();
          let out;
          try {
            out = await impl.judgeBatch(batch, pluginContext(entry));
          } catch (err) {
            throw pluginError(`判定插件 "${entry.name}" 执行失败：${err.message}`);
          }
          if (!Array.isArray(out) || out.length !== batch.length) {
            throw pluginError(
              `判定插件 "${entry.name}" 的 judgeBatch 必须返回与输入等长的数组（期望 ${batch.length}，实际 ${Array.isArray(out) ? out.length : typeof out}）`
            );
          }
          verdicts = out.map((v) => ({ changed: !!v?.changed, reason: String(v?.reason ?? ''), fallback: false }));
          stats.calls++;
          if (useCache) cachePut(key, verdicts);
        }
        results.push(...verdicts);
      }
      return results;
    },
  };
}
