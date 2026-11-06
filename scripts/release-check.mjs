#!/usr/bin/env node
// 发布前检查（release-check）：把「发布到 npm」这件事里能自动化的部分一次跑完。
// 默认会跑测试类步骤（preflight 含自测、pack-check 安装演练）并尝试查询 registry；
// --offline 跳过所有网络相关检查（认证、registry 版本占用），便于离线/CI 复跑；
// 真正的 npm publish 涉及登录与 2FA，永远是人工步骤，脚本只在最后打印清单。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { REQUIRED_IN_TARBALL, FORBIDDEN_PREFIXES, normalizeTarballPaths, missingFromTarball, forbiddenInTarball, hasShebang, ROOT } from './pack-check.mjs';

export const MANUAL_STEPS = [
  '确认 npm 官方源与登录状态：npm config get registry（应为 https://registry.npmjs.org/）→ npm login（开了 2FA 时 publish 还需一次性验证码）',
  '在仓库根目录发布：npm publish --access public',
  '核对线上版本：npm view pcause version 应等于 package.json 的版本',
  '干净环境验证安装：在空目录执行 npx pcause@latest demo，应能装包并跑通内置演示',
  '打标签并推送：git tag v<version> && git push origin v<version>',
];

export function parseGitStatus(out) {
  const files = String(out || '')
    .trim()
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  return { clean: files.length === 0, files };
}

export function checkAuthResult(r) {
  const ok = r && r.status === 0;
  const user = ok ? String(r.stdout || '').trim() : null;
  return {
    ok,
    user,
    message: ok ? `已登录 npm：${user}` : '未登录 npm（发布前需要 npm login；本检查只提示，不算失败）',
  };
}

export function tagOf(version) {
  return 'v' + version;
}

export function manualSteps(version) {
  return MANUAL_STEPS.map((s) => s.replaceAll('<version>', version));
}

function sh(cmd, args) {
  // Windows 下 npm/gh 是 .cmd，必须经 shell；把参数拼成一条命令再交给 shell，
  // 避免 Node 对「shell: true + 参数数组」的 DEP0190 弃用警告。
  if (process.platform === 'win32') {
    const line = [cmd, ...args]
      .map((s) => (String(s).includes(' ') ? `"${String(s)}"` : String(s)))
      .join(' ');
    return spawnSync(line, { encoding: 'utf8', cwd: ROOT, shell: true });
  }
  return spawnSync(cmd, args, { encoding: 'utf8', cwd: ROOT });
}

export function releaseCheck(opts = {}) {
  const log = opts.log || (() => {});
  const offline = Boolean(opts.offline);
  const skipTests = Boolean(opts.skipTests);
  const skipPack = Boolean(opts.skipPack);
  const checks = [];
  const add = (name, ok, detail = '', hard = true) => {
    checks.push({ name, ok, hard, detail });
    log(`  ${ok ? '✓' : '✖'} ${name}${detail ? '（' + detail + '）' : ''}`);
  };
  const warn = (name, detail) => {
    checks.push({ name, ok: true, hard: false, warn: true, detail });
    log(`  ⚠ ${name}（${detail}）`);
  };

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const version = pkg.version;

  // 1) 发布元数据：npm 上的展示与安装入口
  const metaMissing = [];
  if (!pkg.name) metaMissing.push('name');
  if (!/^\d+\.\d+\.\d+/.test(String(version || ''))) metaMissing.push('version（需 semver）');
  if (!pkg.bin || pkg.bin.pcause !== './src/cli.mjs') metaMissing.push('bin.pcause=./src/cli.mjs');
  if (!pkg.files || !pkg.files.length) metaMissing.push('files 白名单');
  if (pkg.type !== 'module') metaMissing.push('type=module');
  if (!pkg.engines || !pkg.engines.node) metaMissing.push('engines.node');
  if (!pkg.license) metaMissing.push('license');
  add('发布元数据齐全（name/version/bin/files/type/engines/license）', metaMissing.length === 0, metaMissing.join('、'));

  const binAbs = path.resolve(ROOT, pkg.bin && pkg.bin.pcause ? pkg.bin.pcause : '');
  const binOk = Boolean(pkg.bin && pkg.bin.pcause && fs.existsSync(binAbs) && hasShebang(fs.readFileSync(binAbs, 'utf8')));
  add('bin 入口存在且带合法 shebang（全局安装后命令能找到）', binOk, pkg.bin && pkg.bin.pcause);

  const pkgHome = Boolean(pkg.homepage && pkg.bugs && pkg.repository);
  if (pkgHome) add('仓库信息齐全（repository/homepage/bugs）', true);
  else warn('仓库信息不全', '建议补 repository/homepage/bugs，便于 npm 页面展示 issue 链接');

  // 2) 工作区与版本状态
  const st = parseGitStatus(sh('git', ['status', '--porcelain']).stdout);
  add('工作区干净（发布包不含未提交改动）', st.clean, st.clean ? '' : st.files.slice(0, 3).join('; ') + (st.files.length > 3 ? '…' : ''));
  const ahead = sh('git', ['rev-list', '--count', 'origin/main..HEAD']).stdout;
  add('当前提交已推送到 origin/main（tag 与源码可对齐）', String(ahead).trim() === '0', '未推送提交数：' + String(ahead).trim());
  const tag = tagOf(version);
  const tagExists = sh('git', ['tag', '-l', tag]).stdout.trim() === tag;
  add(`版本标签 ${tag} 尚未创建（避免重复发版）`, !tagExists);

  // 3) 发布包清单（本地打包，不需要网络）
  if (!skipPack) {
    const packed = sh('npm', ['pack', '--json', '--dry-run']);
    let files = null;
    try {
      const arr = JSON.parse(String(packed.stdout));
      files = normalizeTarballPaths((arr[0] && arr[0].files) || []);
    } catch {
      files = null;
    }
    if (!files) {
      add('能读取 npm pack 的打包清单', false, 'npm pack --dry-run 解析失败');
    } else {
      const missing = missingFromTarball(files, REQUIRED_IN_TARBALL);
      add('发布包必含清单齐全', missing.length === 0, missing.join('、'));
      const forbidden = forbiddenInTarball(files, FORBIDDEN_PREFIXES);
      add('发布包未混入工作区/测试/CI/本地配置', forbidden.length === 0, forbidden.slice(0, 3).join('、'));
    }
  }

  // 4) 测试类步骤（preflight 内含离线自测；pack-check 做真实安装演练）
  if (!skipTests) {
    const pf = sh(process.execPath, [path.join(ROOT, 'scripts', 'preflight.mjs'), '--quiet']);
    add('preflight（版本/CHANGELOG/badge/链接/文件/入口 + 离线自测）', pf.status === 0, pf.status === 0 ? '' : '运行 node scripts/preflight.mjs 查看');
    if (!skipPack) {
      const pc = sh(process.execPath, [path.join(ROOT, 'scripts', 'pack-check.mjs'), '--quiet']);
      add('pack-check（npm pack → 独立目录安装 → 跑 bin）', pc.status === 0, pc.status === 0 ? '' : '运行 npm run pack-check 查看');
    }
  }

  // 5) 网络相关：认证与 registry 版本占用（--offline 跳过）
  if (offline) {
    warn('已跳过网络检查', '--offline：未检查 npm 登录状态与 registry 是否已存在该版本');
  } else {
    const auth = checkAuthResult(sh('npm', ['whoami']));
    if (auth.ok) add(auth.message, true);
    else warn(auth.message, '发布前请先 npm login');
    const view = sh('npm', ['view', pkg.name, 'versions', '--json']);
    if (view.status !== 0) {
      if (String(view.stderr || '').includes('404')) {
        add(`registry 上 ${pkg.name} 尚未发布过任何版本（包名可注册）`, true);
      } else {
        warn('无法查询 registry', String(view.stderr || '').trim().split('\n')[0] || '网络/权限问题，已跳过版本占用检查');
      }
    } else {
      let published = [];
      try {
        published = JSON.parse(String(view.stdout));
      } catch {}
      if (!Array.isArray(published)) published = [];
      add(`registry 上尚未存在 ${pkg.name}@${version}（不会覆盖已发布版本）`, !published.includes(version), published.length ? '已发布版本：' + published.slice(-3).join(', ') : '');
    }
  }

  const failed = checks.filter((c) => !c.ok && c.hard);
  return {
    ok: failed.length === 0,
    version,
    checks,
    failures: failed.map((c) => c.name),
    manualSteps: manualSteps(version),
  };
}

function main() {
  const argv = process.argv.slice(2);
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const json = flags.has('--json');
  const log = json ? () => {} : (msg) => console.log(msg);
  console.log('pcause 发布前检查（release-check）\n');
  const r = releaseCheck({ offline: flags.has('--offline'), skipTests: flags.has('--skip-tests'), skipPack: flags.has('--skip-pack'), log });
  if (json) {
    console.log(JSON.stringify(r));
  } else {
    console.log('');
    if (r.ok) console.log('✔ 自动化检查通过，可以进入人工发布步骤');
    else console.log('✖ 有 ' + r.failures.length + ' 项未通过，先修好再发布');
    console.log('\n人工发布步骤（涉及登录/2FA，不可自动执行）：');
    r.manualSteps.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }
  return r.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
