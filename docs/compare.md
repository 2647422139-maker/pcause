# 两次归因怎么比：`pcause compare` 指南

`compare` 不回答「两次输出谁更好」，也不做打分。它回答的是：**在同一套实验条件下，上一次归因里某个改动块的影响，这一次变成了什么。**

典型用途：你改了提示词/探针/模型，想确认「原来起决定作用的那一处改动，现在还是不是决定性的」。

```bash
pcause compare <attrA> <attrB>
```

## 1. 为什么必须先校验「签名」

两次归因只有在**实验条件一致**时才有可比性。compare 会把下面这些字段拼成实验签名：

| 签名组成 | 为什么影响可比性 |
| --- | --- |
| 探针集（排序后的 id + 输入） | 探针变了，结论本来就会变 |
| `--samples` / `--early-stop` 相关采样设置 | 采样次数不同，噪声地板与置信度不可比 |
| Provider（name / model / temperature） | 换模型 = 换被研究对象 |
| Judge（name / model）与 `--verify` | 判定口径不同，changed 的定义就不同 |
| `--kind` | 判定维度不同，system / agent 与 prompt 不可混比 |

签名不一致时 compare **默认直接拒绝**（错误码 `PCAUSE_SIGNATURE`，退出码 1），而不是给你一张看起来能读、实际在误导的表。确实知道自己要做什么时，可以加 `--allow-incompatible` 强行对比，但报告会保留这个事实。

## 2. 五个迁移状态

| 状态 | 含义 |
| --- | --- |
| 不变 | 同一改动块，判定与校正后影响都没变（允许 ±0pt） |
| 升级 | 影响变强（例如 部分影响 → 决定性） |
| 降级 | 影响变弱（例如 决定性 → 部分影响） |
| 新增 | 这次才出现的改动块（上一次没有对应内容） |
| 消失 | 上一次有、这次没有的改动块 |

「按内容对齐」而不是按位置对齐：每个 hunk 用「类型 + 旧行 + 新行」算出内容键，再配出现序号，所以 hunk 顺序变化不会把 A 的结论错配给 B。

## 3. 读演示结果

仓库里的真实示例：[docs/compare-demo.md](compare-demo.md)、[docs/compare-demo.json](compare-demo.json)（同一份数据，JSON 版给 CI 或脚本用）。

```text
| 不变 | h2 + 最终只输出一个 JSON 对象… | 决定性 → 决定性 | 100% → 100% | +0pt |
```

含义：同一实验条件下，h2（JSON 输出要求）两次都是决定性影响，影响值都是 100%。`+0pt` 是差值，不是「没测到」。

## 4. 常见坑

1. **措辞变化会变成「消失 + 新增」**：compare 按内容键对齐，改了同一行的措辞就匹配不上。想看「同一条规则的影响变化」，改行内容时请一次性改完再比，别把两次改动叠在一起。
2. **compare 只比结论，不重跑**：它不调用模型、不刷新缓存；两次归因本身怎么跑出来的由你负责（预算、采样都要在归因阶段定）。
3. **verdict 相同不等于 effect 相同**：报告同时给判定与影响值，`部分影响 20%` 和 `部分影响 40%` 是同一个 verdict、不同的影响强度。
4. **排除的块不进对比**：`unmeasured`（预算不足）的块只是没测完，不要把它当「无影响」。
5. **JSON 优先**：要进 CI 门禁或自定义看板时用 `--json`，字段与 `schema` 命令导出的一致。

## 5. 放进工作流

```bash
# 1) 改动前：跑一次归因
pcause attribute --old v1 --new v2 --probes probes.jsonl --provider deepseek --judge deepseek --samples 2 --json-out before.json

# 2) 改提示词/探针后：再跑一次（签名必须与上次一致）
pcause attribute --old v1 --new v3 --probes probes.jsonl --provider deepseek --judge deepseek --samples 2 --json-out after.json

# 3) 只看结论迁移，不重跑模型
pcause compare <beforeAttrId> <afterAttrId> --md delta.md
```

如果两次归因的探针或模型不同，compare 会拒绝；这通常意味着你该先统一实验条件，而不是强行对比。
