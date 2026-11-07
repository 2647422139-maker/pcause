#!/usr/bin/env node
// Windows / 安装无关性核对：回答「用户不装全局、不配 PATH、装在又深又长的目录里，
// 还能不能跑？」零依赖、离线，可 import 供自测复用纯函数。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ROOT,
  REQUIRED_IN_TARBALL,
  FORBIDDEN_PREFIXES,
  normalizeTarballPaths,
  missingFromTarball,
  forbiddenInTarball,
  hasShebang,
} from './pack-check.mjs';

/** 安装后必须存在的包内文件（在 tarball 清单之外，再看磁盘上的真实结果） */
export const INSTALLED_MUST_HAVE = [
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
  'scripts/install-check.mjs',
];

/** 安装目录里绝不该出现的东西（工作区数据、测试、CI、配置文件） */
export const INSTALLED_MUST_NOT = ['.pcause', 'test', '.github', 'pcause.config.json', 'node_modules'];

/**
 * 检查安装树：返回缺失的必含文件与混入的禁含路径。
 * @param {string} installedRoot node_modules/pcause
 * @param {{required?: string[], forbidden?: string[]}} [opts]
 */
export function checkInstalledTree(installedRoot, opts = {}) {
  const required = opts.required || INSTALLED_MUST_HAVE;
  const forbidden = opts.forbidden || INSTALLED_MUST_NOT;
  const exists = (rel) => {
    try {
      return fs.existsSync(path.join(installedRoot, rel));
    } catch {
      return false;
    }
  };
  return {
    missing: required.filter((rel) => !exists(rel)),
    forbidden: forbidden.filter((rel) => exists(rel)),
  };
}

/**
 * 构造「只有 Node 自己」的 PATH：排除 npm 全局 bin、nvm shims 等，
 * 用来证明 CLI 不依赖全局安装或额外 PATH 条目。
 * @param {string} nodeDir node.exe 所在目录
 * @param {{platform?: string, env?: Record<string,string>}} [opts]
 */
export function minimalPath(nodeDir, opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  if (platform === 'win32') {
    const root = env.SystemRoot || env.windir || 'C:\\Windows';
    return [nodeDir, path.win32.join(root, 'System32'), path.win32.join(root, 'System32', 'Wbem')].join(';');
  }
  return [nodeDir, '/usr/local/bin', '/usr/bin', '/bin'].join(':');
}

/** 生成安装用「深 + 长 + 空格 + 中文」目录（各段拼接，便于端到端测长路径） */
export function longProjectPath(base, platform = process.platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const segments = [
    'install independence check 安装校验',
    'deep nested consumer project 深层嵌套目录',
    'path with spaces 含空格的目录',
    'level four 第四层',
    'very long directory name 超长目录名用中文与英文混合填充',
  ];
  return segments.reduce((acc, seg) => p.join(acc, seg), base);
}

function run(cmd, args, { cwd, env, shell = false } = {}) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', shell, timeout: 240000 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '', error: r.error };
}

function quoteForCmd(arg) {
  const s = String(arg);
  return /[\s"&|<>^]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function npm(args, opts = {}) {
  if (process.platform === 'win32') {
    return run(['npm', ...args].map(quoteForCmd).join(' '), [], { ...opts, shell: true });
  }
  return run('npm', args, opts);
}

function runShim(shim, args, { cwd, env } = {}) {
  if (process.platform === 'win32') {
    return run([quoteForCmd(shim), ...args].join(' '), [], { cwd, env, shell: true });
  }
  return run(shim, args, { cwd, env });
}

function runShell(command, { cwd, env } = {}) {
  if (process.platform === 'win32') {
    return run(command, [], { cwd, env, shell: true });
  }
  return run(command, [], { cwd, env, shell: true });
}

export function installCheck(opts = {}) {
  const root = opts.root || ROOT;
  const log = opts.log || (() => {});
  const checks = [];
  const add = (ok, name, detail = '') => {
    checks.push({ ok, name, detail });
    log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? '  ' + detail : ''}`);
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcause-install-'));

  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const packDir = path.join(tmp, 'tarball');
    fs.mkdirSync(packDir, { recursive: true });
    const packed = npm(['pack', '--json', '--pack-destination', packDir], { cwd: root });
    let entry = null;
    try {
      const parsed = JSON.parse(packed.stdout.trim());
      entry = Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
      entry = null;
    }
    add(packed.status === 0 && !!entry?.filename, 'npm pack 生成 tarball', entry ? entry.filename : String(packed.stderr).slice(0, 160));
    if (!entry?.filename) return { ok: false, checks, tmp };
    const tarball = path.join(packDir, entry.filename);

    const paths = normalizeTarballPaths(entry.files || []);
    const missingTar = missingFromTarball(paths);
    add(missingTar.length === 0, '发布包含全部运行所需文件', missingTar.length ? `缺失 ${missingTar.join(', ')}` : `共 ${paths.length} 个文件`);
    const forbiddenTar = forbiddenInTarball(paths);
    add(forbiddenTar.length === 0, '发布包不含工作区 / 测试 / CI 产物', forbiddenTar.length ? `混入 ${forbiddenTar.join(', ')}` : '');

    // 1) 装到又深又长、带空格与中文的目录
    const project = longProjectPath(tmp);
    fs.mkdirSync(project, { recursive: true });
    const projectLen = project.length;
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'pcause-install-check-consumer', version: '1.0.0', private: true }, null, 2) + '\n'
    );
    const install = npm(['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], { cwd: project });
    const installedRoot = path.join(project, 'node_modules', 'pcause');
    add(
      install.status === 0 && fs.existsSync(installedRoot),
      '安装到又深又长（含中文/空格）的目录成功',
      install.status !== 0 ? String(install.stderr).slice(0, 200) : `路径 ${projectLen} 字符`
    );
    if (!fs.existsSync(installedRoot)) return { ok: false, checks, tmp };

    // 2) 安装树合规（真正落盘后的文件，而不是 npm 自称的清单）
    const tree = checkInstalledTree(installedRoot);
    add(tree.missing.length === 0, '安装目录含全部运行文件', tree.missing.length ? `缺失 ${tree.missing.join(', ')}` : `共 ${INSTALLED_MUST_HAVE.length} 项`);
    add(tree.forbidden.length === 0, '安装目录不含工作区 / 测试 / CI / 配置文件', tree.forbidden.length ? `混入 ${tree.forbidden.join(', ')}` : '');

    // 3) 无开发依赖：安装后的项目里只有 pcause 本身
    let installedDirs = [];
    try {
      installedDirs = fs.readdirSync(path.join(project, 'node_modules')).filter((n) => n !== '.bin' && !n.startsWith('.'));
    } catch {}
    const installedPkg = JSON.parse(fs.readFileSync(path.join(installedRoot, 'package.json'), 'utf8'));
    const deps = installedPkg.dependencies || {};
    add(installedDirs.length === 1 && installedDirs[0] === 'pcause' && Object.keys(deps).length === 0, '不引入任何依赖（安装项目里只有 pcause）', installedDirs.join(', ') || '空');

    const installedCli = path.join(installedRoot, 'src', 'cli.mjs');
    const cliText = fs.readFileSync(installedCli, 'utf8');
    add(hasShebang(cliText), '安装包里的 bin 带正确 shebang', '');

    // 4) 从无关 cwd 直接 node 运行（不依赖当前目录、不依赖 bin 链接）
    const unrelated = fs.mkdtempSync(path.join(tmp, 'unrelated-'));
    const rDirect = run(process.execPath, [installedCli, 'version'], { cwd: unrelated });
    add(rDirect.status === 0 && rDirect.stdout.includes(pkg.version), '无关 cwd 下直接 node 运行安装包 cli', rDirect.status !== 0 ? String(rDirect.stderr).slice(0, 160) : '');

    // 5) 本地 bin（不装全局）：node_modules/.bin/pcause
    const shim = path.join(project, 'node_modules', '.bin', process.platform === 'win32' ? 'pcause.cmd' : 'pcause');
    const rShim = runShim(shim, ['version'], { cwd: project });
    add(rShim.status === 0 && rShim.stdout.includes(pkg.version), '本地 bin（未全局安装）可运行', rShim.status !== 0 ? String(rShim.stderr).slice(0, 160) : '');

    // 6) PATH 隔离：PATH 里只留 node 自己所在目录与系统目录
    const nodeDir = path.dirname(process.execPath);
    const isolatedEnv = { ...process.env, PATH: minimalPath(nodeDir) };
    const rIsolated = runShim(shim, ['version'], { cwd: project, env: isolatedEnv });
    add(rIsolated.status === 0 && rIsolated.stdout.includes(pkg.version), 'PATH 隔离（无 npm 全局 bin）仍可运行', rIsolated.status !== 0 ? String(rIsolated.stderr).slice(0, 160) : '');

    // 7) npx 从本地 node_modules 解析（不走网络）
    const npxCmd = process.platform === 'win32' ? 'npx --no-install pcause version' : 'npx --no-install pcause version';
    const rNpx = runShell(npxCmd, { cwd: project });
    add(rNpx.status === 0 && rNpx.stdout.includes(pkg.version), 'npx --no-install 从本地依赖解析并运行', rNpx.status !== 0 ? String(rNpx.stderr).slice(0, 160) : '');

    // 8) 安装副本能跑内置演示（离线 mock），且输出是合法 JSON
    const rDemo = run(process.execPath, [installedCli, 'demo', '--json'], { cwd: unrelated });
    let demoJson = null;
    try {
      demoJson = JSON.parse(rDemo.stdout.trim());
    } catch {}
    add(
      rDemo.status === 0 && demoJson && demoJson.ok === true && Array.isArray(demoJson.hunks) && demoJson.hunks.length >= 2,
      '安装副本可离屏运行 demo（零 Key、不联网）',
      rDemo.status !== 0 ? String(rDemo.stderr).slice(0, 160) : 'ok + hunks'
    );

    // 9) 超长工作区路径（数据目录 > 200 字符）可用
    const longHomeBase = fs.mkdtempSync(path.join(tmp, 'home-'));
    const longHome = path.join(longHomeBase, '数据目录 路径 校验 超长 目录 名称 用于测试 Windows 长路径 是否 正常 工作', '再补 一段 中文 与 英文 mixed long directory name 继续加长到超过二百字符 用于触发 长路径 分支 与 真机 行为 校验 还要 再加 一层 目录 深度 才能 足够 长');
    const rInit = run(process.execPath, [installedCli, 'init'], { cwd: unrelated, env: { ...process.env, PCAUSE_HOME: longHome } });
    const rList = run(process.execPath, [installedCli, 'list'], { cwd: unrelated, env: { ...process.env, PCAUSE_HOME: longHome } });
    add(
      rInit.status === 0 && rList.status === 0,
      '超长工作区路径下 init / list 正常',
      rInit.status !== 0 ? String(rInit.stderr).slice(0, 160) : `路径 ${longHome.length} 字符`
    );

    // 10) help 覆盖全部核心命令（装完后能力不缺）
    const rHelp = run(process.execPath, [installedCli, 'help'], { cwd: unrelated });
    const commands = ['init', 'snapshot', 'diff', 'attribute', 'compare', 'report', 'run', 'demo', 'doctor', 'schema', 'selftest'];
    const missingCmds = commands.filter((c) => !new RegExp(`\\b${c}\\b`).test(rHelp.stdout));
    add(rHelp.status === 0 && missingCmds.length === 0, '安装后的 help 覆盖全部核心命令', missingCmds.length ? `缺少 ${missingCmds.join(', ')}` : `${commands.length} 个命令`);

    return { ok: checks.every((c) => c.ok), checks, tmp, tarball, version: pkg.version, project, projectLen, longHome };
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
  const json = args.includes('--json');
  const result = installCheck({ keep, log: quiet || json ? () => {} : (s) => console.log(s) });
  if (json) {
    console.log(JSON.stringify({ ok: result.ok, checks: result.checks, version: result.version }, null, 2));
  } else {
    console.log(`\n${result.ok ? '✔' : '✖'} ${result.checks.filter((c) => c.ok).length}/${result.checks.length} 项安装无关性检查通过`);
    if (!result.ok) {
      for (const c of result.checks.filter((x) => !x.ok)) console.log(`  失败：${c.name}${c.detail ? '（' + c.detail + '）' : ''}`);
      if (keep && result.tmp) console.log(`\n临时目录保留在：${result.tmp}`);
    } else {
      console.log('不装全局、不配 PATH、装在长路径里也能用 ✅');
    }
  }
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
