// 插件注册表：从 pcause.config.json 读取本地 Provider / Judge 插件声明，动态 import 并校验接口。
//
// 设计约束（与豆包讨论后收敛）：
//- 接口尽可能小：Provider 只要 `generate({system,user,ctx})`，Judge 只要 `judgeBatch(pairs, ctx)`；
//- 插件上下文 ctx 只传只读配置（kind/name/configFile/options），不暴露核心状态；
//- 预算与缓存由核心统一负责：一次 generate / 一个判定批次记 1 次调用，插件内部不要自行重试放大调用量；
//- 本地插件是「可执行代码」：只加载用户显式声明在配置里的模块，不做远程加载，也不自动安装。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RESERVED = {
  provider: new Set(['mock', 'deepseek', 'doubao']),
  judge: new Set(['heuristic', 'deepseek', 'doubao']),
};

const registryCache = new Map();
const implCache = new Map();

export function pluginError(message) {
  const err = new Error(message);
  err.code = 'PCAUSE_PLUGIN';
  return err;
}

export function resolveConfigPath(explicit) {
  if (explicit) {
    const p = path.resolve(explicit);
    if (!fs.existsSync(p)) throw pluginError(`插件配置不存在：${p}`);
    return p;
  }
  if (process.env.PCAUSE_CONFIG) {
    const p = path.resolve(process.env.PCAUSE_CONFIG);
    if (!fs.existsSync(p)) throw pluginError(`插件配置不存在（来自 PCAUSE_CONFIG）：${p}`);
    return p;
  }
  const auto = path.resolve('pcause.config.json');
  return fs.existsSync(auto) ? auto : null;
}

export function loadPluginRegistry(explicit) {
  const file = resolveConfigPath(explicit);
  const cacheKey = file || '(none)';
  if (registryCache.has(cacheKey)) return registryCache.get(cacheKey);

  const reg = { file: null, provider: new Map(), judge: new Map() };
  if (!file) {
    registryCache.set(cacheKey, reg);
    return reg;
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw pluginError(`插件配置不是合法 JSON：${file}（${err.message}）`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw pluginError(`插件配置必须是 JSON 对象：${file}`);
  reg.file = file;

  for (const kind of ['provider', 'judge']) {
    const section = raw[kind];
    if (section === undefined) continue;
    if (!section || typeof section !== 'object' || Array.isArray(section)) {
      throw pluginError(`插件配置的 "${kind}" 必须是对象`);
    }
    for (const [name, entry] of Object.entries(section)) {
      if (RESERVED[kind].has(name)) {
        throw pluginError(`插件名 "${name}" 是内置 ${kind}，不能覆盖（内置：${[...RESERVED[kind]].join(' / ')}）`);
      }
      if (!entry || typeof entry.module !== 'string' || !entry.module.trim()) {
        throw pluginError(`插件 ${kind}.${name} 缺少 module 字段（相对配置文件的路径）`);
      }
      if (entry.options !== undefined && (entry.options === null || typeof entry.options !== 'object' || Array.isArray(entry.options))) {
        throw pluginError(`插件 ${kind}.${name} 的 options 必须是对象`);
      }
      const modulePath = path.resolve(path.dirname(file), entry.module);
      const options = Object.freeze({ ...(entry.options || {}) });
      reg[kind].set(name, {
        kind,
        name,
        module: modulePath,
        options,
        configFile: file,
        cacheKey: `${modulePath}#${name}#${JSON.stringify(options)}`,
      });
    }
  }
  registryCache.set(cacheKey, reg);
  return reg;
}

/** 从注册表取插件声明；不存在时给出内置与已配置清单 */
export function pluginEntry(kind, name, registry) {
  const entry = registry[kind].get(name);
  if (entry) return entry;
  const available = [...registry[kind].keys()];
  const builtin = [...RESERVED[kind]].join(' / ');
  const extra = available.length ? `；已配置插件：${available.join(' / ')}` : '；未配置任何插件';
  throw pluginError(`未知 ${kind}：${name}（内置：${builtin}${extra}）`);
}

const METHOD = { provider: 'generate', judge: 'judgeBatch' };

/** 动态加载并校验插件模块；结果按模块缓存（同一进程内只初始化一次） */
export function loadPlugin(entry) {
  if (implCache.has(entry.cacheKey)) return implCache.get(entry.cacheKey);
  const promise = (async () => {
    if (!fs.existsSync(entry.module)) throw pluginError(`插件模块不存在：${entry.module}`);
    let mod;
    try {
      mod = await import(pathToFileURL(entry.module).href);
    } catch (err) {
      throw pluginError(`插件加载失败（${entry.kind}.${entry.name}）：${err.message}`);
    }
    const factory = mod.default ?? mod.create;
    if (typeof factory !== 'function') {
      throw pluginError(`插件 ${entry.kind}.${entry.name} 需要 export default function (options) {...}（或 export function create）`);
    }
    let impl;
    try {
      impl = await factory(entry.options);
    } catch (err) {
      throw pluginError(`插件初始化失败（${entry.kind}.${entry.name}）：${err.message}`);
    }
    if (!impl || typeof impl !== 'object') throw pluginError(`插件 ${entry.kind}.${entry.name} 的工厂必须返回对象`);
    const method = METHOD[entry.kind];
    if (typeof impl[method] !== 'function') {
      throw pluginError(`插件 ${entry.kind}.${entry.name} 缺少 ${method} 方法`);
    }
    return impl;
  })();
  implCache.set(entry.cacheKey, promise);
  return promise;
}

export function pluginContext(entry) {
  return Object.freeze({
    kind: entry.kind,
    name: entry.name,
    configFile: entry.configFile,
    options: entry.options,
  });
}
