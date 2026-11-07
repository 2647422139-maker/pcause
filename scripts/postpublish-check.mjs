#!/usr/bin/env node
// 发布后验证（postpublish-check）：确认「已经发到 npm 的那个包」在干净环境真的能用。
// 为什么不能用 release-check 代替：
//   1) npm view / npx 都会读到本地或 CDN 缓存，单次查询可能假阳性；
//   2) npx 可能命中本地已缓存的同名包，跑起来是旧版本；
//   3) 子进程退出码 0 不代表输出正确（demo 可能打印了报错但 exit 0）。
// 因此这里显式做：固定官方源 + 版本精确比对 + 重试等待 + `--no-cache` + JSON 解析 + 关键字段校验。
// 所有网络命令都通过可注入依赖执行，便于离线自测决策逻辑（见 test/selftest.mjs [35/35]）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REGISTRY = 'https://registry.npmjs.org/';
export const DEFAULT_RETRIES = 6;
export const DEFAULT_RETRY_WAIT_MS = 5000;

export function parseViewVersion(stdout, stderr, status) {
  // npm view <pkg> version 在成功时输出纯版本串；404 时 stderr 含 E404 / 404。
  const out = String(stdout || '').trim();
  if (status === 0 && /^\d+\.\d+\.\d+/.test(out)) return { published: true, version: out.split('\n').pop().trim() };
  const err = String(stderr || '');
  if (/E404|404|not found/i.test(err)) return { published: false, version: null };
  return { published: null, version: null, error: err.trim().split('\n')[0] || `exit ${status}` };
}

export function checkVersionOutput(stdout, stderr, wantVersion) {
  // npx 的输出必须精确出现 `pcause <wantVersion>`，只看退出码会被旧缓存骗过。
  const text = String(stdout || '');
  const m = text.match(/pcause\s+(\d+\.\d+\.\d+)/);
  if (!m) return { ok: false, reason: `输出里找不到版本号：${(text || stderr || '').trim().slice(0, 120) || '(空)'}` };
  if (m[1] !== wantVersion) return { ok: false, reason: `版本不一致：期望 ${wantVersion}，实际 ${m[1]}（可能命中本地缓存）` };
  return { ok: true, version: m[1] };
}

export function parseDemoJson(stdout) {
  // demo --json 必须是纯 JSON；stdout 被日志污染、被截断都算失败。
  const text = String(stdout || '').trim();
  if (!text) return { ok: false, reason: 'demo --json 没有输出' };
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, reason: 'demo --json 不是合法 JSON：' + (e.message || String(e)) };
  }
  const hunks = Array.isArray(data.hunks) ? data.hunks : null;
  if (!data.ok) return { ok: false, reason: 'demo 返回 ok != true' };
  if (!hunks || hunks.length < 2) return { ok: false, reason: 'demo 返回的 hunks 少于 2 个（演示不完整）' };
  if (!data.mdPath || !data.htmlPath) return { ok: false, reason: 'demo 缺少 mdPath/htmlPath（报告未生成）' };
  return { ok: true, hunks: hunks.length, attributionId: data.attributionId || null };
}

export function readmeInstallCommand(readme) {
  // README 里的安装入口必须和包名一致，否则用户照做会 404。
  const text = String(readme || '');
  const npx = text.match(/npx\s+(?:-y\s+)?pcause@?[\w.-]*/);
  const global = text.match(/npm\s+(?:i|install)\s+-g\s+pcause/);
  return { npx: npx ? npx[0] : null, global: global ? global[0] : null };
}

function defaultSh(cmd, args, opts = {}) {
  if (process.platform === 'win32') {
    const line = [cmd, ...args]
      .map((s) => (String(s).includes(' ') ? `"${String(s)}"` : String(s)))
      .join(' ');
    return spawnSync(line, { encoding: 'utf8', shell: true, timeout: opts.timeout || 180000 });
  }
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: opts.timeout || 180000 });
}

export function postPublishCheck(opts = {}) {
  const name = opts.name || 'pcause';
  const version = opts.version;
  const log = opts.log || (() => {});
  const offline = Boolean(opts.offline);
  const sh = opts.sh || defaultSh;
  const sleep = opts.sleep || ((ms) => spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${ms})`]));
  const retries = Math.max(1, opts.retries || DEFAULT_RETRIES);
  const waitMs = opts.waitMs ?? DEFAULT_RETRY_WAIT_MS;
  const checks = [];
  const add = (check, ok, detail = '', hard = true) => {
    checks.push({ name: check, ok, hard, detail });
    log(`  ${ok ? '✓' : '✖'} ${check}${detail ? '（' + detail + '）' : ''}`);
  };
  const warn = (check, detail) => {
    checks.push({ name: check, ok: true, hard: false, warn: true, detail });
    log(`  ⚠ ${check}（${detail}）`);
  };

  if (!version) throw new Error('postPublishCheck 需要 version');

  // 0) 本地 README 安装入口一致性（离线可查）
  const readme = (() => {
    try {
      return fs.readFileSync(path.join(opts.root || process.cwd(), 'README.md'), 'utf8');
    } catch {
      return '';
    }
  })();
  const install = readmeInstallCommand(readme);
  if (!readme) warn('未读到 README', '跳过安装入口一致性检查');
  else {
    const same = [install.npx, install.global].filter(Boolean).every((c) => c.includes(name));
    add('README 安装命令与包名一致（npx / npm i -g）', same && Boolean(install.npx), (install.npx || '缺 npx 示例') + (install.global ? ' / ' + install.global : ''));
  }

  if (offline) {
    warn('已跳过网络检查', '--offline：未查询 registry、未执行 npx');
    const failed = checks.filter((c) => !c.ok && c.hard);
    return { ok: failed.length === 0, name, version, checks, failures: failed.map((c) => c.name), verified: false };
  }

  // 1) registry 版本一致性：固定官方源；刚发布时 CDN 有延迟，带重试
  let parsed = { published: null, version: null };
  for (let i = 0; i < retries; i++) {
    const r = sh('npm', ['view', name, 'version', '--json', '--registry=' + REGISTRY]);
    parsed = parseViewVersion(r.stdout, r.stderr, r.status);
    if (parsed.published === true && parsed.version) break;
    if (parsed.published === false && i < retries - 1) {
      log(`  第 ${i + 1} 次查询：${name} 尚未发布（registry/CDN 可能延迟），${Math.round(waitMs / 1000)}s 后重试…`);
      if (typeof sleep === 'function') sleep(waitMs);
    } else {
      break;
    }
  }
  if (parsed.published === null) warn('无法查询 registry', parsed.error || '网络/权限问题，已跳过线上校验');
  else if (parsed.published === false) add(`registry 上不存在 ${name}（尚未发布）`, false, '先完成 npm publish 再跑本检查');
  else add(`registry 上 ${name} 最新版本 = 本地产出版本 ${version}`, parsed.version === version, parsed.version === version ? '' : `线上 ${parsed.version} ≠ 本地 ${version}`);

  // 2) 干净环境跑 bin：--no-cache 避免命中本地旧包；校验输出版本串
  if (parsed.published === true) {
    const v = sh('npx', ['-y', '--no-cache', `${name}@${version}`, 'version'], { timeout: 240000 });
    const cv = checkVersionOutput(v.stdout, v.stderr, version);
    add('npx 目标版本能启动且版本号正确（--no-cache）', cv.ok, cv.ok ? `pcause ${cv.version}` : cv.reason);

    const d = sh('npx', ['-y', '--no-cache', `${name}@${version}`, 'demo', '--json'], { timeout: 240000 });
    const dj = parseDemoJson(d.stdout);
    add('已发布包的内置 demo 可离线跑通（JSON 可解析 + 关键字段齐全）', dj.ok, dj.ok ? `${dj.hunks} 个改动块，报告已生成` : dj.reason);
  }

  const failed = checks.filter((c) => !c.ok && c.hard);
  return {
    ok: failed.length === 0,
    name,
    version,
    checks,
    failures: failed.map((c) => c.name),
    verified: parsed.published === true,
  };
}

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const json = flags.has('--json');
  const offline = flags.has('--offline');
  const vArg = argv.find((a) => /^--version=/.test(a));
  const log = json ? () => {} : (m) => console.log(m);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = vArg ? vArg.split('=')[1] : pkg.version;
  console.log(`pcause 发布后验证（postpublish-check） ${pkg.name}@${version}\n`);
  const r = postPublishCheck({ name: pkg.name, version, offline, root, log });
  if (json) {
    console.log(JSON.stringify(r));
  } else {
    console.log('');
    if (r.ok) console.log(r.verified ? '✔ 已发布版本验证通过' : '✔ 本地/离线检查通过（尚未完成线上验证）');
    else console.log('✖ 有 ' + r.failures.length + ' 项未通过：' + r.failures.join('；'));
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
