// 示例 Judge 插件：按「输出内容是否完全相同」判定行为是否改变，确定性、离线。
// 用于演示 pcause.config.json 插件机制与自测（不发任何网络请求）。
//
// 契约：export default function (options) → { judgeBatch(pairs, ctx) → Promise<[{ changed, reason }]> }
// pairs 里每项是 { a, b }：a = 新提示词输出，b = 回退某处改动后的输出。
export default function createJudge(options = {}) {
  const ignoreWhitespace = options.ignoreWhitespace === true;
  const norm = (x) => {
    const s = String(x ?? '');
    return ignoreWhitespace ? s.replace(/\s+/g, ' ').trim() : s;
  };
  return {
    name: 'exact',
    async judgeBatch(pairs) {
      return pairs.map(({ a, b }) => {
        const same = norm(a) === norm(b);
        return {
          changed: !same,
          reason: same ? '输出内容完全一致' : '输出内容不同',
        };
      });
    },
  };
}
