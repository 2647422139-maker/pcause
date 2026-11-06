# 插件开发指南（Provider / Judge）

pcause 的核心循环是固定的：**按 hunk 回退提示词 → 用 Provider 生成 → 用 Judge 判定输出是否发生实质变化 → 汇总效应**。
插件只替换「生成」和「判定」两个端点，不改变核心循环。你可以在不 fork 仓库的情况下接入自己的模型、私有网关或本地规则。

> 插件是**本地可执行代码**（动态 `import` 的 `.mjs`）。pcause 只加载你显式写在配置文件里的模块，不做远程加载、不自动安装。只运行你信任的插件。

---

## 1. 配置文件

默认查找顺序：`--config <path>` → 环境变量 `PCAUSE_CONFIG` → 当前目录 `pcause.config.json`。

```json
{
  "provider": {
    "my-gateway": {
      "module": "./plugins/my-gateway.mjs",
      "options": { "endpoint": "http://127.0.0.1:8080", "model": "local-7b" }
    }
  },
  "judge": {
    "my-judge": { "module": "./plugins/my-judge.mjs", "options": { "ignoreWhitespace": true } }
  }
}
```

规则：

- `module` 是**相对配置文件所在目录**的路径（不是相对当前工作目录，也不是相对仓库根）。
- `options` 会原样传给插件工厂，并在 `ctx.options` 里以只读对象出现。
- `provider` / `judge` 两个分组都会做同名冲突检查：内置名（`mock` / `deepseek` / `doubao`，Judge 的 `heuristic` / `deepseek` / `doubao`）不能被插件覆盖。
- 未注册的名字会报 `PCAUSE_PLUGIN`，并列出内置名与已配置插件名。
- 同一进程内插件模块只初始化一次（按模块路径 + 插件名 + options 缓存）；改了插件文件需要重跑命令。

可参考 `examples/pcause.config.example.json` 与 `examples/plugins/` 下的两个零依赖示例。

---

## 2. Provider 契约

```js
// export default function (options) → { generate({ system, user, ctx }) → Promise<string> }
export default function createProvider(options = {}) {
  return {
    name: 'my-gateway',   // 可选，仅用于报告/日志
    model: 'local-7b',    // 可选，缺省为 plugin:<注册名>
    async generate({ system, user }) {
      return '这里是模型输出字符串';
    },
  };
}
```

- 必须返回**字符串**；返回其它类型会报 `PCAUSE_PLUGIN`。
- 入参只有 `system`（提示词/系统提示）与 `user`（探针输入），外加只读 `ctx`。
- 抛错会被包装成 `PCAUSE_PLUGIN`，带上插件名，便于定位。

## 3. Judge 契约

```js
// export default function (options) → { judgeBatch(pairs, ctx) → Promise<[{ changed, reason }]> }
export default function createJudge(options = {}) {
  return {
    async judgeBatch(pairs) {
      return pairs.map(({ a, b }) => ({
        changed: a !== b,               // 输出行为是否发生实质变化
        reason: a !== b ? '输出不同' : '输出一致',
      }));
    },
  };
}
```

- `pairs` 每项是 `{ a, b }`：`a` = 新提示词下的输出，`b` = 回退某个 hunk 之后的输出。
- 必须返回**与 `pairs` 等长**的数组，元素含布尔 `changed` 与字符串 `reason`；长度不符会报错。
- 核心会**按批次调用**（内置批大小 6）：一个批次 = 1 次预算调用。你的插件可以自行决定内部是否合并请求。
- 「changed」的语义是**实质行为变化**（格式/结构、遵守指令、核心主张、语气范式、长度量级），不是字面差异；只改写同义词不算 changed。

---

## 4. 预算、缓存与并发

| 事项 | 由谁负责 | 说明 |
| --- | --- | --- |
| 预算计数 | 核心 | 一次 `generate`、一个 Judge 批次各记 1 次，计入 `--max-calls` |
| 内容寻址缓存 | 核心 | Provider 按「插件 + options + 模型 + system + user」缓存；Judge 按批次输入缓存 |
| 并发 | 核心 | `--concurrency` 只作用于生成阶段；判定与复核保持串行 |
| 重试 | 插件自己 | 核心不替你重试。**插件内重试会放大真实请求数，预算仍只记 1 次**，请谨慎 |

因此插件里不要做「偷偷放大请求量」的事（例如在 `generate` 里自动重试 3 次），否则预算数字会失真。

---

## 5. 调试与自测

- `pcause doctor` 会列出插件配置是否找到（不显示内容）；`--json` 输出机器可读结构。
- 报错统一带错误码：插件相关错误码为 `PCAUSE_PLUGIN`，可用 `PCAUSE_DEBUG=1` 查看堆栈。
- 建议给插件写离线测试：把插件当普通模块 `import`，用固定输入断言输出/判定结果，不联网。
- 自测里可以直接调用 `loadPluginRegistry()` / `loadPlugin()`（见 `src/plugins.mjs`）验证配置解析与接口校验。

## 6. 常见坑

1. **ESM / CJS 混用**：pcause 是 ESM 项目，插件用 `.mjs` 或 `"type": "module"`；`module.exports` 会加载失败。
2. **相对路径基准**：`module` 相对**配置文件**解析，不是相对 cwd；移动配置文件时要一起移动插件。
3. **改动不生效**：模块与实现按进程缓存，改插件后必须重跑命令。
4. **判定数组长度不符 / 乱序**：Judge 必须按 `pairs` 顺序等长返回；核心不猜你的意图。
5. **在插件里打日志**：`stdout` 只留给机器可读输出，调试信息请写 `stderr`，否则 `--json` 会被污染。
6. **密钥**：插件 `options` 会出现在进程命令行/配置文件中；优先从环境变量读密钥，不要把密钥写进 `pcause.config.json`。
