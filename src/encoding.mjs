// 文本读入归一化：统一处理 UTF-8 BOM 与 CRLF / 孤立 CR。
// 原则（讨论结论）：在「读文件之后、业务逻辑之前」一次性归一，不让换行差异污染 diff、指纹与缓存键；
// 写出时保持各写入方自己的约定（本项目统一用 LF）。
import fs from 'node:fs';

export const BOM = '\uFEFF';

/** 去掉文件开头的 UTF-8 BOM（U+FEFF） */
export function stripBom(text) {
  const s = String(text ?? '');
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 把 CRLF 与孤立 CR 统一成 LF */
export function normalizeNewlines(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n');
}

/** 读入文本的完整归一化：去 BOM + 换行统一为 LF */
export function normalizeText(text) {
  return normalizeNewlines(stripBom(text));
}

/** 读文件并归一化（读取失败时抛原始错误，由调用方包装成 PCAUSE_* 错误） */
export function readTextFile(file) {
  return normalizeText(fs.readFileSync(file, 'utf8'));
}
