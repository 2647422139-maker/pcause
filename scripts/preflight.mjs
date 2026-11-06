#!/usr/bin/env node
// 发布前自检：把「对外可见的信任点」一次性校验掉，避免发版时 README / 版本 / CHANGELOG 互相打架。
// 零依赖，离线运行；默认会真的跑一遍自测来核对 README 里的 badge 数字（--no-tests 可跳过）。
//
// 用法：node scripts/preflight.mjs [--no-tests] [--quiet]
// 退出码：0 全部通过；1 有检查未通过。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const read = (rel) => fs.readFileSync(path.join(PKG_ROOT, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(PKG_ROOT, rel));

/** 版本号（只认 semver 形态，避免把注释里的数字当版本） */
export const SEMVER = /^\d+\.\d+\.\d+$/;

/** CHANGELOG 里最新一个「已发布」版本（跳过 [Unreleased] 这类未发布段） */
export function firstChangelogVersion(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = /^##\s*\[([^\]]+)\]/.exec(line.trim());
    if (!m) continue;
    const v = m[1].trim();
    if (SEMVER.test(v)) return v;
  }
  return null;
}

/** 从 README 的 selftest badge 解析出 N/M（兼容 %2F 与 / 两种写法） */
export function badgeCounts(readme) {
  const m = /selftest-(\d+)(?:%2F|\/)(\d+)/.exec(readme);
  if (!m) return null;
  return { passed: Number(m[1]), total: Number(m[2]) };
}

/** 从自测输出解析「✔ 153/153 项通过」 */
export function selftestCounts(output) {
  const m = /(\d+)\/(\d+)\s*项通过/.exec(String(output));
  if (!m) return null;
  return { passed: Number(m[1]), total: Number(m[2]) };
}

/** README 里所有本地相对链接（排除 http/https、mailto、纯锚点） */
export function localLinks(readme) {
  const out = [];
  const re = /\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(readme))) {
    const raw = m[1];
    if (/^(https?:|mailto:)/i.test(raw) || raw.startsWith('#')) continue;
    const [file, anchor] = raw.split('#');
    out.push({ raw, file, anchor: anchor || '' });
  }
  return out;
}

/** GitHub 风格标题 slug（足够覆盖本项目 README 的锚点：小写、去标点、空格转 -） */
export function slugify(heading) {
  return String(heading)
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()>#+.!?，。：；、（）「」《》“”'"‘’/\\|:]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function headingsOf(markdown) {
  return markdown
    .split(/\r?\n/)
    .map((line) => /^#{1,6}\s+(.*)$/.exec(line.trim()))
    .filter(Boolean)
    .map((m) => m[1].trim());
}

function collectChecks({ noTests, quiet }) {
  const checks = [];
  const add = (ok, name, detail = '') => {
    checks.push({ ok, name, detail });
    if (!quiet) console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`);
  };

  const pkg = JSON.parse(read('package.json'));
  const changes = read('CHANGELOG.md');
  const readme = read('README.md');

  // 1) 版本三方一致：package.json ↔ CHANGELOG 最新已发布条目
  const changelogVersion = firstChangelogVersion(changes);
  add(changelogVersion === pkg.version, 'package.json 版本与 CHANGELOG 最新条目一致', `${pkg.version} / ${changelogVersion}`);

  // 2) CHANGELOG 覆盖初始版本、且首条为已发布版本
  add(/##\s*\[0\.1\.0\]/.test(changes), 'CHANGELOG 覆盖初始版本 0.1.0');
  add(!/^##\s*\[Unreleased\]/m.test(changes), 'CHANGELOG 不含未发布的 Unreleased 段，最新条目即当前版本');

  // 3) README badge 与真实自测结果一致（默认真跑一遍自测；--no-tests 时只做静态一致性）
  const badge = badgeCounts(readme);
  if (noTests) {
    add(!!badge, 'README 含 selftest badge', badge ? `${badge.passed}/${badge.total}` : '');
  } else {
    const run = spawnSync(process.execPath, [path.join(PKG_ROOT, 'test', 'selftest.mjs')], {
      env: process.env,
      encoding: 'utf8',
      timeout: 300000,
    });
    const counts = selftestCounts(`${run.stdout || ''}`);
    const okRun = run.status === 0 && counts && counts.passed === counts.total;
    add(okRun, '自测全部通过', counts ? `${counts.passed}/${counts.total}` : `退出码 ${run.status}`);
    add(
      !!badge && !!counts && badge.passed === counts.passed && badge.total === counts.total,
      'README selftest badge 与自测实际数量一致',
      badge && counts ? `badge ${badge.passed}/${badge.total}，实际 ${counts.passed}/${counts.total}` : '缺少 badge 或自测结果'
    );
  }

  // 4) 硬编码的旧数字：README 里 "N/N 项" 形式的自测总数必须与当前 badge 一致（历史语境请写「当时为 N/N」，不带「项」）
  const stale = [...readme.matchAll(/(\d{2,})\/(\d{2,})\s*项/g)]
    .map((m) => `${m[1]}/${m[2]}`)
    .filter((pair) => badge && pair !== `${badge.passed}/${badge.total}`);
  add(
    stale.length === 0,
    'README 的「N/N 项」自测总数与 badge 一致',
    stale.length ? `发现 ${[...new Set(stale)].join('、')}，badge 为 ${badge?.passed}/${badge?.total}` : ''
  );

  // 5) README 本地链接目标存在，且锚点在目标文档里真实存在
  const links = localLinks(readme);
  const missing = [];
  const badAnchors = [];
  for (const { raw, file, anchor } of links) {
    if (!exists(file)) {
      missing.push(raw);
      continue;
    }
    if (anchor && /\.md$/i.test(file)) {
      const target = read(file);
      const slugs = new Set(headingsOf(target).map(slugify));
      if (!slugs.has(slugify(decodeURIComponent(anchor)))) badAnchors.push(raw);
    }
  }
  add(links.length > 0 && missing.length === 0, 'README 本地链接目标均存在', missing.length ? `缺失 ${missing.join(', ')}` : `共 ${links.length} 个`);
  add(badAnchors.length === 0, 'README 本地锚点均能命中目标标题', badAnchors.length ? badAnchors.join(', ') : '');

  // 6) 演示产物与示例文件齐全（README 承诺别人能看到的东西）
  const required = [
    'docs/demo-report.html',
    'docs/demo-report.md',
    'docs/demo-attribution.json',
    'schema/attribution.schema.json',
    'examples/probes.jsonl',
    'examples/triage-v1.md',
    'examples/triage-v2.md',
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'src/errors.mjs',
  ];
  const missingFiles = required.filter((f) => !exists(f));
  add(missingFiles.length === 0, '发布承诺引用的文件齐全', missingFiles.length ? `缺失 ${missingFiles.join(', ')}` : `共 ${required.length} 个`);

  // 7) npm 发布白名单覆盖所有被 README 引用的目录
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  const listed = (dir) => files.some((f) => f === dir || f === dir + '/' || f.startsWith(dir + '/'));
  const uncovered = ['src', 'schema', 'examples', 'docs'].filter((d) => !listed(d));
  add(uncovered.length === 0, 'files 白名单覆盖 src/schema/examples/docs', uncovered.length ? `未覆盖 ${uncovered.join(', ')}` : '');

  // 8) bin 入口存在，且 --help / version 能跑通
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.pcause;
  add(!!bin && exists(bin.replace(/^\.\//, '')), 'bin 入口文件存在', bin || '');
  if (bin) {
    const cli = path.join(PKG_ROOT, bin);
    const version = spawnSync(process.execPath, [cli, 'version'], { env: process.env, encoding: 'utf8' });
    add(String(version.stdout).includes(pkg.version) && !version.error, 'pcause version 输出当前版本', `${pkg.version}`);
    const help = spawnSync(process.execPath, [cli, 'help'], { env: process.env, encoding: 'utf8' });
    add(help.status === 0 && String(help.stdout).includes('pcause version'), 'pcause help 可运行');
  }

  return checks;
}

function main(argv) {
  const noTests = argv.includes('--no-tests');
  const quiet = argv.includes('--quiet');
  if (!quiet) {
    console.log(`pcause preflight（${noTests ? '跳过自测' : '含自测'}）`);
    console.log(`仓库：${PKG_ROOT}\n`);
  }
  const checks = collectChecks({ noTests, quiet });
  const failed = checks.filter((c) => !c.ok);
  if (!quiet) {
    console.log(`\n${failed.length ? '✖' : '✔'} ${checks.length - failed.length}/${checks.length} 项发布前检查通过`);
  }
  if (failed.length) {
    for (const f of failed) console.log(`  未通过：${f.name}${f.detail ? '（' + f.detail + '）' : ''}`);
    process.exit(1);
  }
  if (!quiet) console.log('可以发版 ✅');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
