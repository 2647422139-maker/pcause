// 本地工作区存储：.pcause/
//   prompts/<id>.json      提示词快照
//   runs/<id>.json         某次批量运行结果
//   attributions/<id>.json 归因实验结果
//   cache/<sha>.json       模型输出缓存（避免重复花钱）

import fs from 'node:fs';
import { PcauseError, usage, notFound } from './errors.mjs';
import path from 'node:path';
import crypto from 'node:crypto';

export function storeRoot() {
  return process.env.PCAUSE_HOME ? path.resolve(process.env.PCAUSE_HOME) : path.resolve('.pcause');
}

export function paths() {
  const root = storeRoot();
  return {
    root,
    prompts: path.join(root, 'prompts'),
    runs: path.join(root, 'runs'),
    attributions: path.join(root, 'attributions'),
    cache: path.join(root, 'cache'),
  };
}

export function isInitialized() {
  return fs.existsSync(paths().root);
}

export function initStore({ force = false } = {}) {
  const p = paths();
  if (fs.existsSync(p.root) && !force) return { created: false, root: p.root };
  for (const dir of [p.root, p.prompts, p.runs, p.attributions, p.cache]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return { created: true, root: p.root };
}

export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function writeJSON(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function safeId(id) {
  // 允许中文，但限制长度，避免生成超长文件名
  return String(id).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_').slice(0, 80);
}

// ---------- 提示词快照 ----------
export function savePrompt({ id, text, note = '' }) {
  if (!id) throw usage('快照需要 id：pcause snapshot <id> --file <path>');
  const data = { id: safeId(id), text: String(text), note, createdAt: new Date().toISOString() };
  writeJSON(path.join(paths().prompts, data.id + '.json'), data);
  return data;
}

export function getPrompt(id) {
  const file = path.join(paths().prompts, safeId(id) + '.json');
  if (!fs.existsSync(file)) throw notFound('提示词快照', id, `先运行 pcause snapshot ${id} --file <path> 记录它`);
  return readJSON(file);
}

export function listPrompts() {
  const dir = paths().prompts;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(dir, f)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ---------- 运行结果 ----------
export function saveRun(run) {
  const id = safeId(run.id || newId('run'));
  const data = { ...run, id, createdAt: run.createdAt || new Date().toISOString() };
  writeJSON(path.join(paths().runs, id + '.json'), data);
  return data;
}

export function getRun(id) {
  const file = path.join(paths().runs, safeId(id) + '.json');
  if (!fs.existsSync(file)) throw notFound('运行记录', id);
  return readJSON(file);
}

// ---------- 归因结果 ----------
export function saveAttribution(attr) {
  const id = safeId(attr.id || newId('attr'));
  const data = { ...attr, id, createdAt: attr.createdAt || new Date().toISOString() };
  writeJSON(path.join(paths().attributions, id + '.json'), data);
  return data;
}

export function getAttribution(id) {
  const file = path.join(paths().attributions, safeId(id) + '.json');
  if (!fs.existsSync(file)) throw notFound('归因结果', id, '运行 pcause list 查看已保存的归因结果 id');
  return readJSON(file);
}

export function listAttributions() {
  const dir = paths().attributions;
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJSON(path.join(dir, f)))
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

// ---------- 缓存 ----------
export function cacheGet(key) {
  const file = path.join(paths().cache, sha256(key) + '.json');
  if (!fs.existsSync(file)) return null;
  try {
    return readJSON(file).value;
  } catch {
    return null;
  }
}

export function cachePut(key, value) {
  const file = path.join(paths().cache, sha256(key) + '.json');
  writeJSON(file, { key, value, createdAt: new Date().toISOString() });
}

export function newId(prefix) {
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `${prefix}-${stamp}-${crypto.randomBytes(2).toString('hex')}`;
}

// ---------- 探针文件 ----------
export function readProbes(file, { limit = 0, warn = () => {} } = {}) {
  if (!fs.existsSync(file)) throw new PcauseError('PCAUSE_NOT_FOUND', `找不到探针文件：${file}`, '探针文件支持 .json 数组、.jsonl 或纯文本一行一个输入；检查路径与拼写');
  const raw = fs.readFileSync(file, 'utf8');
  const probes = [];
  if (/\.json$/i.test(file)) {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) throw new PcauseError('PCAUSE_INPUT', '探针 JSON 应为数组 [{id,input}]', '例：[{"id":"p1","input":"..."}]；或改用 .jsonl 一行一个对象');
    for (const p of arr) probes.push({ id: String(p.id ?? 'p' + (probes.length + 1)), input: String(p.input ?? '') });
  } else {
    const isJsonl = /\.jsonl$/i.test(file);
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('//'));
    lines.forEach((line, idx) => {
      const lineNo = idx + 1;
      try {
        const obj = JSON.parse(line);
        probes.push({ id: String(obj.id ?? 'p' + (idx + 1)), input: String(obj.input ?? '') });
      } catch (err) {
        // .jsonl 写错一行就明确报错，避免把残缺 JSON 静默当成探针输入；
        // 其它扩展名视为「一行一个输入」的极简格式。
        if (isJsonl) {
          throw new PcauseError(
            'PCAUSE_INPUT',
            `探针文件 ${file} 第 ${lineNo} 行不是合法 JSON（.jsonl 要求一行一个 {"id","input"} 对象）：${line.slice(0, 120)}`,
            '删除或修正该行；若想用「一行一个纯文本输入」，请把扩展名改为 .txt'
          );
        }
        probes.push({ id: 'p' + (idx + 1), input: line });
      }
    });
  }
  if (!probes.length) throw new PcauseError('PCAUSE_INPUT', '探针文件里没有有效探针', '确认文件非空、每行是合法 JSON 或纯文本输入（// 开头的行会被忽略）');
  return limit > 0 ? probes.slice(0, limit) : probes;
}
