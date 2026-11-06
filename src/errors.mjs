// 统一错误出口：结构化错误码 + 面向使用者的下一步提示。
// 约定：错误码只用于「让人自助排查」，不改变 CLI 退出码语义（0 成功 / 1 运行错误 / 2 门禁命中）。

export const EXIT = { OK: 0, ERROR: 1, GATE: 2 };

/** 带错误码与提示的错误 */
export class PcauseError extends Error {
  constructor(code, message, hint = '', options = {}) {
    super(message);
    this.name = 'PcauseError';
    this.code = code;
    this.hint = hint;
    if (options.cause) this.cause = options.cause;
  }
}

export const usage = (message, hint = '') => new PcauseError('PCAUSE_USAGE', message, hint || '运行 pcause help 查看用法，或 pcause <命令> help 查看该命令选项');

export const notInitialized = (root) =>
  new PcauseError('PCAUSE_NOT_INIT', `工作区不存在：${root}`, '先运行：pcause init（或用 PCAUSE_HOME 指定工作区目录）');

export const notFound = (what, id, hint = '') =>
  new PcauseError('PCAUSE_NOT_FOUND', `找不到${what}：${id}`, hint || '运行 pcause list 查看已有的快照与归因结果');

/** 判断是否是「带错误码」的错误（可重复封装，不覆盖原始码） */
export function withCode(code, err, hint = '') {
  if (err instanceof PcauseError) return err;
  const e = new PcauseError(code, err?.message || String(err), hint, { cause: err });
  return e;
}

/**
 * 把任意错误格式化成一屏可自助排查的信息：
 *   第一行：✖ [PCAUSE_xxx] 一句话原因
 *   第二行：提示：下一步怎么做
 *   PCAUSE_DEBUG=1 时才追加堆栈（默认隐藏内部细节）
 */
export function formatError(err, { debug = process.env.PCAUSE_DEBUG === '1' } = {}) {
  const raw = err?.code && String(err.code).startsWith('PCAUSE_') ? err.code : 'PCAUSE_ERROR';
  const message = err?.message || String(err);
  const lines = [`✖ [${raw}] ${message}`];
  const hint = err?.hint || '';
  if (hint) {
    lines.push(`  提示：${hint}`);
  } else if (raw === 'PCAUSE_ERROR') {
    lines.push('  提示：检查输入参数与网络后重试；设置 PCAUSE_DEBUG=1 可打印堆栈，运行 pcause help 查看用法。');
  }
  if (debug && err?.stack) {
    lines.push('  堆栈（PCAUSE_DEBUG=1）：');
    for (const line of String(err.stack).split('\n').slice(1, 12)) lines.push('  ' + line.trim());
  }
  return lines.join('\n');
}
