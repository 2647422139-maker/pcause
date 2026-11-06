// 模型通道：mock（离线确定性）/ deepseek（API）/ doubao（复用已登录豆包桌面版，零 Key）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { cacheGet, cachePut } from './store.mjs';
import { loadPluginRegistry, pluginEntry, loadPlugin, pluginContext, pluginError } from './plugins.mjs';

const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';

function readDeepseekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY.trim();
  const candidates = [
    path.join(os.homedir(), '.dsh', '.credentials.yaml'),
    path.join(os.homedir(), '.dsh', 'credentials.yaml'),
  ];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const m = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*["']?([^"'\s#]+)/m);
    if (m) return m[1].trim();
  }
  throw new Error('找不到 DEEPSEEK_API_KEY（设置环境变量，或写入 ~/.dsh/.credentials.yaml）');
}

function findDoubaoBridge() {
  if (process.env.DOUBAO_BRIDGE) return process.env.DOUBAO_BRIDGE;
  const candidates = [
    path.join(os.homedir(), '.dsh', 'skills', 'doubao-bridge', 'scripts', 'doubao-ask.mjs'),
    path.resolve('doubao-bridge', 'doubao-ask.mjs'),
    path.resolve('..', 'doubao-bridge', 'doubao-ask.mjs'),
  ];
  const found = candidates.find((f) => fs.existsSync(f));
  if (!found) throw new Error('找不到豆包桥接脚本 doubao-ask.mjs（设置 DOUBAO_BRIDGE 环境变量）');
  return found;
}

async function postJSON(url, body, headers = {}, { retries = 2, timeoutMs = 120_000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        const err = new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
        // 4xx（除 429 限流）是请求本身的问题，重试没有意义且会浪费配额
        err.retryable = res.status === 429 || res.status >= 500;
        throw err;
      }
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt >= retries) break;
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('请求模型失败：' + (lastErr?.message || lastErr));
}

/** 离线确定性 mock：仅根据系统提示词里的关键词产生行为，便于自测 */
export function mockGenerate(system, user) {
  const format = /表格|table/i.test(system) ? 'table' : 'prose';
  const tone = /温和|友善|warm/i.test(system) ? 'warm' : 'neutral';
  return [`[format] ${format}`, `[tone] ${tone}`, `[echo] ${user}`].join('\n');
}

export function makeProvider(name, opts = {}) {
  // 非内置名称 → 查找用户插件（插件声明来自 pcause.config.json）
  if (name !== 'mock' && name !== 'deepseek' && name !== 'doubao') {
    const registry = loadPluginRegistry(opts.config);
    return makePluginProvider(pluginEntry('provider', name, registry), opts);
  }
  const model = opts.model || (name === 'mock' ? 'mock-1' : name === 'deepseek' ? 'deepseek-flash' : 'doubao-desktop');
  const temperature = opts.temperature ?? 0;
  const maxTokens = opts.maxTokens ?? 1200;
  const useCache = opts.cache !== false;
  const stats = { calls: 0, cacheHits: 0 };

  async function generate({ system, user }) {
    const key = JSON.stringify({ provider: name, model, system, user, temperature, maxTokens });
    if (useCache) {
      const hit = cacheGet(key);
      if (hit != null) {
        stats.cacheHits++;
        return hit;
      }
    }
    let output;
    if (name === 'mock') {
      output = mockGenerate(system, user);
      stats.calls++;
    } else if (name === 'deepseek') {
      const messages = [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: user },
      ];
      // 默认关闭思考模式：归因实验要求可复现，且思考 token 会吃掉输出预算。
      // 需要思考时传 disableThinking: false。
      const body = {
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
        ...(opts.disableThinking === false ? {} : { thinking: { type: 'disabled' } }),
      };
      const headers = { authorization: 'Bearer ' + readDeepseekKey() };
      let data = await postJSON(DEEPSEEK_URL + '/chat/completions', body, headers);
      let choice = data?.choices?.[0];
      let text = choice?.message?.content ?? '';
      if (!text.trim() && choice?.finish_reason === 'length') {
        // 思考型模型把预算全花在推理上：加大预算 + 强制关闭思考再试一次
        data = await postJSON(
          DEEPSEEK_URL + '/chat/completions',
          { ...body, max_tokens: Math.max(2000, maxTokens * 3), thinking: { type: 'disabled' } },
          headers
        );
        choice = data?.choices?.[0];
        text = choice?.message?.content ?? '';
      }
      if (!text.trim()) {
        throw new Error(`模型 ${model} 返回了空输出（finish_reason=${choice?.finish_reason}）`);
      }
      output = text;
      stats.calls++;
    } else if (name === 'doubao') {
      output = await callDoubao(system, user, opts);
      stats.calls++;
    } else {
      throw new Error(`未知 provider：${name}（可选 mock / deepseek / doubao）`);
    }
    if (useCache) cachePut(key, output);
    return output;
  }

  return { name, model, generate, stats };
}

// ---- 插件 Provider ----
// 契约：模块 export default function (options) 返回 { generate({ system, user, ctx }) → Promise<string> }
// 预算由核心统一记账：一次 generate 记一次调用；缓存按「插件模块 + options + 模型 + 输入」内容寻址。
function makePluginProvider(entry, opts = {}) {
  const model = opts.model || entry.options.model || `plugin:${entry.name}`;
  const useCache = opts.cache !== false;
  const stats = { calls: 0, cacheHits: 0 };
  const getImpl = () => loadPlugin(entry);

  async function generate({ system, user }) {
    const key = JSON.stringify({ pluginProvider: entry.cacheKey, model, system, user });
    if (useCache) {
      const hit = cacheGet(key);
      if (hit != null) {
        stats.cacheHits++;
        return hit;
      }
    }
    const impl = await getImpl();
    let output;
    try {
      output = await impl.generate({ system, user, ctx: pluginContext(entry) });
    } catch (err) {
      throw pluginError(`Provider 插件 "${entry.name}" 执行失败：${err.message}`);
    }
    if (typeof output !== 'string') {
      throw pluginError(`Provider 插件 "${entry.name}" 的 generate 必须返回字符串（实际：${typeof output}）`);
    }
    stats.calls++;
    if (useCache) cachePut(key, output);
    return output;
  }

  return { name: entry.name, model, generate, stats };
}

function callDoubao(system, user, opts = {}) {
  const bridge = findDoubaoBridge();
  const text = `【系统提示词】\n${system || '（无）'}\n\n【用户输入】\n${user}`;
  const bridgeTimeout = Number(opts.bridgeTimeout ?? 180_000);
  const args = [bridge, text, '--new', '--json', '--timeout', String(bridgeTimeout)];
  const MAX_OUTPUT = 2_000_000; // 防止异常输出把内存吃满
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(killer);
      if (err) reject(err);
      else resolve(value);
    };
    // 子进程自己也有 --timeout，但桥接脚本可能卡在页面轮询里；这里再加一层硬超时
    const killer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {}
      finish(new Error(`豆包通道超时（${bridgeTimeout + 15_000}ms），已终止子进程`));
    }, bridgeTimeout + 15_000);
    child.stdout.on('data', (d) => {
      if (stdout.length < MAX_OUTPUT) stdout += d;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < MAX_OUTPUT) stderr += d;
    });
    child.on('error', (err) => finish(err));
    child.on('close', (code) => {
      try {
        const data = JSON.parse(stdout);
        if (data.ok && data.reply) finish(null, String(data.reply));
        else finish(new Error(`豆包通道失败（code ${code}）：${data.error || data.reason || stderr.slice(0, 200)}`));
      } catch {
        finish(new Error(`豆包通道无有效 JSON（code ${code}）：${(stderr || stdout).slice(0, 300)}`));
      }
    });
  });
}
