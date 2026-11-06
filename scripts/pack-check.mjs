#!/usr/bin/env node
// 发布包「安装演练」：npm pack → 独立临时目录 npm install ./xxx.tgz → 像用户一样运行 bin。
// 零依赖、离线（本次安装不访问 registry），用来发现「本地能跑、装完用不了」的问题。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 发布包里必须存在的文件（相对 tarball 的 package/ 根） */
export const REQUIRED_IN_TARBALL = [
  'package.json',
  'src/cli.mjs',
  'src/errors.mjs',
  'schema/attribution.schema.json',
  'examples/probes.jsonl',
  'docs/demo-report.html',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
  'scripts/preflight.mjs',
  'scripts/pack-check.mjs',
];

/** 绝不能进发布包的路径前缀 */
export const FORBIDDEN_PREFIXES = ['.pcause/', 'test/', '.github/', 'node_modules/', 'pcause.config.json'];

/** npm pack --json 的 files 路径是 "package/..."，这里归一成包内相对路径 */
export function normalizeTarballPaths(files) {
  return files
    .map((f) => (typeof f === 'string' ? f : f.path))
    .map((p) => p.replace(/^package\//, ''))
    .sort();
}

export function missingFromTarball(paths, required = REQUIRED_IN_TARBALL) {
  const set = new Set(paths);
  return required.filter((r) => !set.has(r));
}

export function forbiddenInTarball(paths, prefixes = FORBIDDEN_PREFIXES) {
  return paths.filter((p) => prefixes.some((prefix) => p === prefix || p.startsWith(prefix)));
}

export function hasShebang(text) {
  return /^#!\/usr\/bin\/env node\r?\n/.test(text);
}

function run(cmd, args, { cwd, shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell, timeout: 240000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function quoteForCmd(arg) {
  const s = String(arg);
  return /[\s"&|<>^]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function npm(args, opts = {}) {
  if (process.platform === 'win32') {
    // Windows 上 npm 是 .cmd，只能经 cmd.exe 调用；拼成单条命令避免 DEP0190（args + shell 组合）
    return run(['npm', ...args].map(quoteForCmd).join(' '), [], { ...opts, shell: true });
  }
  return run('npm', args, opts);
}

function runShim(shim, args, cwd) {
  if (process.platform === 'win32') {
    return run([quoteForCmd(shim), ...args].join(' '), [], { cwd, shell: true });
  }
  return run(shim, args, { cwd });
}

export function packCheck(opts = {}) {
  const root = opts.root || ROOT;
  const log = opts.log || (() => {});
  const checks = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcause-pack-'));
  const add = (ok, name, detail = '') => {
    checks.push({ ok, name, detail });
    log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`);
  };

  try {
    const packDir = path.join(tmp, 'tarball');
    fs.mkdirSync(packDir, { recursive: true });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

    const packed = npm(['pack', '--json', '--pack-destination', packDir], { cwd: root });
    let entry = null;
    try {
      const parsed = JSON.parse(packed.stdout.trim());
      entry = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      entry = null;
    }
    add(
      packed.status === 0 && !!entry && !!entry.filename,
      'npm pack 生成 tarball',
      entry ? entry.filename : String(packed.stderr).slice(0, 160)
    );
    if (!entry || !entry.filename) {
      return { ok: false, checks, tmp };
    }

    const tarball = path.join(packDir, entry.filename);
    const paths = normalizeTarballPaths(entry.files || []);

    const missing = missingFromTarball(paths);
    add(missing.length === 0, '发布包含全部运行所需文件', missing.length ? `缺失 ${missing.join(', ')}` : `共 ${paths.length} 个文件`);
    const forbidden = forbiddenInTarball(paths);
    add(forbidden.length === 0, '发布包不含工作区 / 测试 / CI 产物', forbidden.length ? `混入 ${forbidden.join(', ')}` : '');

    // 像用户一样安装：独立空目录 + 本地 tgz，不走 link
    const project = path.join(tmp, 'consumer');
    fs.mkdirSync(project, { recursive: true });
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'pcause-pack-check-consumer', version: '1.0.0', private: true }, null, 2) + '\n'
    );
    const install = npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], { cwd: project });
    const installedRoot = path.join(project, 'node_modules', 'pcause');
    add(install.status === 0 && fs.existsSync(installedRoot), '在独立临时目录安装 tgz 成功', install.status !== 0 ? String(install.stderr).slice(0, 200) : '');

    const installedPkgPath = path.join(installedRoot, 'package.json');
    let installedPkg = null;
    try {
      installedPkg = JSON.parse(fs.readFileSync(installedPkgPath, 'utf8'));
    } catch {
      installedPkg = null;
    }
    add(!!installedPkg && installedPkg.version === pkg.version, '安装后的版本与仓库一致', installedPkg ? `v${installedPkg.version} / 仓库 v${pkg.version}` : '读不到 package.json');

    const installedCli = path.join(installedRoot, 'src', 'cli.mjs');
    let cliText = '';
    try {
      cliText = fs.readFileSync(installedCli, 'utf8');
    } catch {}
    add(hasShebang(cliText), '安装包里的 bin 带正确 shebang（CRLF 不会破坏）', cliText ? '' : '文件缺失');

    const shim = path.join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'pcause.cmd' : 'pcause');
    add(fs.existsSync(shim), '安装后生成可执行 bin 入口', path.basename(shim));

    // 用 shim 跑 version / help（用户真实调用路径）
    const rVersion = runShim(shim, ['version'], project);
    add(rVersion.status === 0 && rVersion.stdout.includes(pkg.version), '通过 bin 运行 `pcause version` 正常', rVersion.status !== 0 ? String(rVersion.stderr).slice(0, 160) : '');
    const rHelp = runShim(shim, ['help'], project);
    add(rHelp.status === 0 && /用法/.test(rHelp.stdout), '通过 bin 运行 `pcause help` 正常', rHelp.status !== 0 ? String(rHelp.stderr).slice(0, 160) : '');

    // 直接 node 调用（不经 shim）也应可用，排除 shim 掩盖问题
    const rDirect = run(process.execPath, [installedCli, 'version'], { cwd: project });
    add(rDirect.status === 0 && rDirect.stdout.includes(pkg.version), '直接 node 运行安装包内的 cli 正常', '');

    return { ok: checks.every((c) => c.ok), checks, tmp, tarball, version: pkg.version };
  } finally {
    if (!opts.keep) {
      try {
        fs.rmSync(tmp, { recursive: true, force: true });
      } catch {}
    }
  }
}

function main() {
  const args = process.argv.slice(2);
  const keep = args.includes('--keep');
  const quiet = args.includes('--quiet');
  console.log(`pcause pack-check（npm 发布演练）\n仓库：${ROOT}\n`);
  const result = packCheck({ keep, log: quiet ? () => {} : (s) => console.log(s) });
  console.log(`\n✔ ${result.checks.filter((c) => c.ok).length}/${result.checks.length} 项安装演练检查通过`);
  if (!result.ok) {
    for (const c of result.checks.filter((x) => !x.ok)) console.log(`  失败：${c.name}${c.detail ? '（' + c.detail + '）' : ''}`);
    if (keep && result.tmp) console.log(`\n临时目录保留在：${result.tmp}`);
    process.exit(1);
  }
  console.log('可以给用户装了 ✅');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
