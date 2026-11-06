// 判定器：判断「两个输出是否发生实质性行为变化」
// heuristic = 离线快速筛查；deepseek / doubao = 语义级判定（可作第二意见）

import { makeProvider } from './providers.mjs';

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
    throw new Error(`未知 judge：${name}（可选 heuristic / deepseek / doubao）`);
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
            system: JUDGE_SYSTEM,
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
