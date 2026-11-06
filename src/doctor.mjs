// pcause doctor：报问题前先跑的自检。
// 目标：一条命令收集「定位问题需要的最小环境信息」，方便贴进 issue；默认离线、不打印任何密钥。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { storeRoot, paths, isInitialized, listPrompts, listAttributions } from './store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function pkgVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function bridgeCandidates() {
  const cands = [];
  if (process.env.DOUBAO_BRIDGE) cands.push(process.env.DOUBAO_BRIDGE);
  cands.push(path.join(os.homedir(), '.dsh', 'skills', 'doubao-bridge', 'scripts', 'doubao-ask.mjs'));
  cands.push(path.join(ROOT, 'doubao-bridge', 'doubao-ask.mjs'));
  cands.push(path.join(ROOT, '..', 'doubao-bridge', 'doubao-ask.mjs'));
  return cands;
}

function findBridge() {
  return bridgeCandidates().find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  }) || null;
}

function gitInfo() {
  const r = spawnSync('git', ['-C', ROOT, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  const branch = String(r.stdout || '').trim();
  const st = spawnSync('git', ['-C', ROOT, 'status', '--porcelain'], { encoding: 'utf8' });
  return { branch, dirty: Boolean(String(st.stdout || '').trim()) };
}

function configInfo() {
  const configFile = process.env.PCAUSE_CONFIG
    ? path.resolve(process.env.PCAUSE_CONFIG)
    : path.join(process.cwd(), 'pcause.config.json');
  const exists = fs.existsSync(configFile);
  let providers = 0;
  let judges = 0;
  if (exists) {
    try {
      const cfg = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      providers = Object.keys((cfg && cfg.providers) || {}).length;
      judges = Object.keys((cfg && cfg.judges) || {}).length;
    } catch {
      return { path: configFile, exists: true, invalid: true, providers: 0, judges: 0 };
    }
  }
  return { path: configFile, exists, invalid: false, providers, judges };
}

export function collectDoctorInfo({ cwd = process.cwd(), env = process.env } = {}) {
  const rows = [];
  const warnings = [];
  const add = (label, value) => rows.push({ label, value: String(value) });

  add('pcause', pkgVersion());
  add('Node', process.version);
  add('平台', `${process.platform} ${process.arch}`);
  add('工作目录', cwd);

  let initialized = false;
  let prompts = 0;
  let attributions = 0;
  try {
    initialized = isInitialized();
  } catch {
    initialized = false;
  }
  if (initialized) {
    try {
      prompts = listPrompts().length;
      attributions = listAttributions().length;
    } catch {}
    add('工作区', `${storeRoot()}（已初始化：${prompts} 个快照 / ${attributions} 次归因）`);
  } else {
    add('工作区', `${storeRoot()}（未初始化，可先跑 pcause init 或 pcause demo）`);
    warnings.push('当前目录没有 .pcause 工作区：先 `pcause init`，或只想体验就跑 `pcause demo`');
  }

  const cfg = configInfo();
  add('插件配置', cfg.exists ? `${cfg.path}（providers ${cfg.providers} / judges ${cfg.judges}${cfg.invalid ? '，JSON 解析失败' : ''}）` : `未找到 ${cfg.path}`);
  if (cfg.invalid) warnings.push('pcause.config.json 无法解析：检查 JSON 语法或 BOM');

  add('DEEPSEEK_API_KEY', env.DEEPSEEK_API_KEY ? '环境变量已设置（不显示内容）' : '环境变量未设置');
  const credFile = path.join(os.homedir(), '.dsh', '.credentials.yaml');
  let credHasKey = false;
  try {
    const y = fs.readFileSync(credFile, 'utf8');
    credHasKey = /DEEPSEEK_API_KEY\s*:\s*["']?[^\s"']+/i.test(y);
  } catch {}
  add('DeepSeek Key 来源', env.DEEPSEEK_API_KEY ? '环境变量' : credHasKey ? `凭据文件 ${credFile}（不显示内容）` : '未找到');
  if (!env.DEEPSEEK_API_KEY && !credHasKey && cfg.providers === 0) {
    warnings.push('DeepSeek 通道不可用（环境变量与 ~/.dsh/.credentials.yaml 都没有 Key）：真实归因会失败；`pcause demo` 不受影响');
  }

  const bridge = findBridge();
  add('豆包桥接', bridge ? `已找到：${bridge}` : '未找到（仅 --verify doubao 需要）');
  if (!bridge) warnings.push('未找到豆包桥接：`--verify doubao` 会失败；用 `--judge heuristic` 或直接去掉 --verify 可绕过');

  const g = gitInfo();
  add('git', g ? `${g.branch}${g.dirty ? '（有未提交改动）' : ''}` : '不是 git 仓库或未安装 git');

  if (env.PCAUSE_HOME) add('PCAUSE_HOME', env.PCAUSE_HOME);
  if (env.PCAUSE_CONFIG) add('PCAUSE_CONFIG', env.PCAUSE_CONFIG);
  if (env.PCAUSE_DEBUG) add('PCAUSE_DEBUG', env.PCAUSE_DEBUG);

  return { version: pkgVersion(), rows, warnings, initialized };
}

export function formatDoctorText(info, { cwd = process.cwd() } = {}) {
  const lines = [];
  lines.push('pcause 自检（doctor）——报 issue 时把这段完整贴过来即可（不含密钥）');
  lines.push('');
  for (const r of info.rows) lines.push(`  ${r.label}：${r.value}`);
  lines.push('');
  if (info.warnings.length) {
    lines.push('可能的下一步：');
    for (const w of info.warnings) lines.push(`  ⚠ ${w}`);
  } else {
    lines.push('未发现明显的环境问题 ✅');
  }
  lines.push('');
  lines.push('提交 issue 前请确认：已删除密钥 / 已附上完整命令与报错文本（优先文本，不要截图）');
  return lines.join('\n');
}
