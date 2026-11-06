// 示例 Provider 插件：确定性、离线，输出只依赖系统提示词长度与用户输入。
// 用于演示 pcause.config.json 插件机制与自测（不发任何网络请求）。
//
// 契约：export default function (options) → { generate({ system, user, ctx }) → Promise<string> }
export default function createProvider(options = {}) {
  const prefix = typeof options.prefix === 'string' ? options.prefix : '';
  return {
    name: 'echo-system',
    model: 'echo-v1',
    async generate({ system, user }) {
      return `${prefix}[sys:${[...String(system || '')].length}]\n${String(user ?? '')}`;
    },
  };
}
