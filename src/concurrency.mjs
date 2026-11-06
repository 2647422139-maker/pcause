// 有界并发工具：把「逐个 await」的生成阶段改成「同时最多 n 个在飞」，
// 但不改变结果顺序、不改变预算语义、失败后不再调度新任务。
//
// 为什么单独抽一个模块：归因阶段要跑「探针数 × 采样数」次生成，串行太慢；
// 但并发数必须可控（API 限流、豆包桌面版是单窗口串行），且结果必须按输入顺序落位。

/**
 * 以最多 limit 个并发执行 fn(item, index)，返回与 items 顺序一致的结果数组。
 * 任何一个任务抛错后：不再调度新任务（在飞任务自然结束，结果丢弃），最终抛出第一个错误。
 *
 * @param {Array} items
 * @param {number} limit 并发上限（≥1；大于 items.length 时按 items.length 处理）
 * @param {(item:any, index:number)=>Promise<any>} fn
 * @param {{onProgress?:(done:number,total:number)=>void}} [opts]
 */
export async function mapLimit(items, limit, fn, opts = {}) {
  const list = Array.from(items);
  const total = list.length;
  const width = Math.max(1, Math.min(Math.floor(Number(limit) || 1) || 1, Math.max(1, total)));
  const results = new Array(total);
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
  let next = 0;
  let done = 0;
  let firstError = null;

  async function worker() {
    while (firstError === null) {
      const i = next;
      next += 1;
      if (i >= total) return;
      try {
        results[i] = await fn(list[i], i);
      } catch (err) {
        if (firstError === null) firstError = err;
        return;
      }
      done += 1;
      if (onProgress) onProgress(done, total);
    }
  }

  await Promise.all(Array.from({ length: width }, () => worker()));
  if (firstError) throw firstError;
  return results;
}
