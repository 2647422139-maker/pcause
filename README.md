# pcause · 提示词因果归因器

> 改完提示词，效果变好了——但到底是**哪一句**起了作用？
> pcause 用反事实消融实验把这个问题**测**出来，而不是靠猜。

![零依赖](https://img.shields.io/badge/dependencies-0-brightgreen) ![Node](https://img.shields.io/badge/node-%E2%89%A520-blue) ![tests](https://img.shields.io/badge/selftest-56%2F56%20passing-brightgreen)

## v1.1 更新摘要

围绕「让结论更可信、让 CI 能接入、让机器能消费」做了四项加固（判定与采样内核逻辑不变）：

- **`--kind prompt|system|agent`**：标注归因对象类型，报告首页固定展示三条免责声明（假设 / 约束 / 泛化），并按类型静态提示假设可信度（系统提示、Agent 指令为「较低」）。
- **`--dry-run` 预演**：不读 API Key、不发任何请求，只预估调用次数与预算是否够；运行中预算耗尽时不再静默中止，而是把未测完的改动块标为 `sampling_insufficient` / `unmeasured`。
- **`--fail-on decisive|partial` CI 门禁**：命中则退出码 2；采样不足的块不参与门禁，避免把「样本不够」误当「破坏性变更」而错误阻断流水线。
- **稳定机器可读输出**：`--json` / `--json-out` 输出符合 `schema/attribution.schema.json`（draft-07，核心字段冻结，插件数据只能放 `extensions`），`pcause schema` 可直接导出 schema。

---

## 1. 它解决什么问题

提示词迭代的典型困境：你把提示词从 v1 改到 v2，输出变好了。于是你相信「新增的这 5 条要求」都有用，甚至不敢删任何一条。但实际上：

- 可能只有 **1 条**改动真正改变了模型行为，其余几万人维护的「仪式性咒语」完全没被模型执行；
- 也可能你的「改进」只是**模型随机波动**——同一提示词跑两次，输出本来就不一样（实测 DeepSeek 在 `temperature=0` 下仍会有 30%~70% 的输出差异）。

现有的提示词工具都解决不了这个问题：

| 已有项目 | 它做什么 | 为什么不是 pcause |
| --- | --- | --- |
| `promptdiff` 等文本 diff 工具 | 显示提示词改了哪些字 | 只告诉你「改了什么」，不告诉你「哪处改动改变了行为」 |
| `promptfoo` / LLM-as-judge 评测 | 比较两个提示词的**整体**得分 | 只有整体分数，无法把效果归因到具体一句 |
| `DSPy` / 提示词优化器 | 自动搜出更好的提示词 | 是「生成器」不是「解释器」；无法回答人工改动为何有效 |
| 多模型议会（如 llm-council） | 多个模型投票给结论 | 解决的是「答案可靠性」，不是「提示词因果」 |

**pcause 的定位是「因果解释器」**：给定提示词旧版/新版 + 一组测试输入（探针），输出一份报告，回答：

> 新版提示词里，哪一处改动是决定性的、哪一处只有部分影响、哪一处完全可以删掉。

## 2. 原理：反事实消融 + 噪声校正

```
旧版提示词 v1 ──diff──▶ 新版提示词 v2 = 公共部分 + h1 + h2 + h3（改动块）
                                        │
            基线：用 v2 在每个探针上生成 samples 次
                                        │
    对每个 hunk：把 v2 中的该 hunk 单独回退（得到 v2 minus h），重新生成
                                        │
        判定器比较「v2 输出」与「回退 h 后的输出」是否发生实质行为变化
                                        │
        校正后影响 = (组间变化率 − 噪声地板) / (1 − 噪声地板)
                                        │
                      输出 Markdown + HTML 报告
```

三个关键设计：

1. **hunk 级消融**：diff 按 LCS 行级对齐，连续变更合并为一个 hunk，逐个回退；逆序回退可精确还原旧版（自测覆盖）。
2. **噪声地板**：每个探针用同一提示词独立生成 `--samples` 次，测「同一提示词自己跟自己比」的变化率。**这是 pcause 与普通 A/B 评测最大的区别**——它承认模型本身有随机性，并把随机性从结论里扣掉。噪声地板 ≥34% 时报告会亮出「稳定性警告」，提示结论不可信。
3. **异构判定 + 第二意见**：判定「是否实质行为变化」可以选 `heuristic`（离线、零成本）、`deepseek` 或 `doubao`（语义级）。`--verify` 让**另一个**模型（例如豆包桌面版）对同一批配对独立判定，报告给出逐条一致率。

## 3. 安装与快速开始

零依赖，Node ≥ 20（用到了原生 fetch / WebSocket）：

```bash
git clone <this-repo> && cd pcause
node test/selftest.mjs     # 56/56 项离线自测，不联网、不花钱
```

生成 Key 不需要：`deepseek` 通道会自动读取 `DEEPSEEK_API_KEY` 环境变量或 `~/.dsh/.credentials.yaml`；`doubao` 通道复用**已登录的豆包桌面版**（经本机 `doubao-bridge` 技能，无需任何 API Key）。

跑演示（3 个探针 × 3 个改动块，约 1 分钟）：

```bash
node src/cli.mjs init
node src/cli.mjs snapshot triage-v1 --file examples/triage-v1.md
node src/cli.mjs snapshot triage-v2 --file examples/triage-v2.md
node src/cli.mjs diff triage-v1 triage-v2
npm run demo
```

### 演示输出（真实运行）

```
✔ 归因完成：attr-20261106170034-d13c（24 次调用 / 52.5s，缓存命中 12）
  噪声地板：0%　采样：2 次/探针

  ■  h2  决定性   100%（原始 100%）  + 最终只输出一个 JSON 对象：{"category": "<类别名>"}
        └ 第二意见（doubao）：判定一致 12/12
  ▨  h1  部分影响   33%（原始  33%）  + 如果工单情绪激动或明确投诉，在类别名后追加「-URGENT」
        └ 第二意见（doubao）：判定一致 12/12
  □  h3  无影响      0%（原始   0%）  + 注意：本分类器是内部工具，输出会进入数据看板
```

结论一目了然：把输出改成 JSON 的那条（h2）是决定性的；情绪加急规则（h1）只对 1/3 的工单生效；「内部工具、不对外公开」这句对行为毫无影响，可以删。报告在 `.pcause/attributions/attr-*.md` 与 `.html`（HTML 可直接双击打开）；仓库里的 **[docs/demo-report.html](docs/demo-report.html)** 就是这次运行的报告副本。

## 4. 机器可消费与 CI 集成（v1.1）

CI 里最需要的是「可判定的结果」，而不是好看的报告：

- **预演**：`--dry-run` 只输出预估调用数（生成 / 判定 / 复核上限）与预算是否够，不读 Key、不发请求，适合先估成本。
- **稳定 JSON**：`--json` 输出完整结果，`--json-out result.json` 同时落盘；结构见 [`schema/attribution.schema.json`](schema/attribution.schema.json)，也可用 `pcause schema --out attribution.schema.json` 导出。核心字段冻结，插件/自定义数据只能进 `extensions`，避免上层脚本被插件字段膨胀拖垮。
- **预算不足的语义**：`--max-calls` 耗尽后，已完成的块照常给结论，未测完的块状态为 `unmeasured`、`samplingInsufficient: true`，报告醒目提示「采样不足 ≠ 无影响」；退出码仍是 0。
- **门禁**：`--fail-on decisive` 在任意「决定性」块出现时退出码 2；`--fail-on partial` 连「部分影响」也算命中。`samplingInsufficient` 的块不参与门禁，避免样本不够时误阻断流水线。

```bash
# 先看要花多少钱（不联网、不读 Key）
node src/cli.mjs attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider deepseek --judge deepseek --samples 2 --dry-run

# CI：跑完并落 JSON；只要出现决定性改动就让流水线失败
node src/cli.mjs attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider deepseek --judge deepseek --samples 2 \
  --json-out /tmp/attribution.json --fail-on decisive
echo $?   # 0 无命中；2 命中门禁；1 运行错误
```

演示用的机器可读结果见 [`docs/demo-attribution.json`](docs/demo-attribution.json)。

## 5. 命令

```
pcause init                                   初始化工作区（.pcause/）
pcause snapshot <id> --file <path>            保存提示词快照（也支持 --text "..."）
pcause list                                   列出快照与历史归因
pcause diff <old> <new>                       查看两个版本的改动块（hunk）
pcause run <id> --probes <file>               用某个版本跑探针
pcause attribute --old <id> --new <id> --probes <file> [选项]   核心：跑归因实验
pcause report <attrId> [--md out.md] [--html out.html]          重新导出报告
pcause schema [--out file]                    导出机器可读结果 JSON Schema
pcause selftest                               离线自测
```

`attribute` 常用选项：

| 选项 | 说明 |
| --- | --- |
| `--provider mock\|deepseek\|doubao` | 生成模型（默认 deepseek） |
| `--judge heuristic\|deepseek\|doubao` | 判定器（默认 heuristic） |
| `--verify <judge>` | 第二意见判定器，如 `--verify doubao` |
| `--kind prompt\|system\|agent` | 归因对象类型（默认 prompt；只影响报告里的假设可信度提示，不改变判定逻辑） |
| `--samples <n>` | 每探针独立生成 n 次（默认 1；**≥2 才会测噪声地板并校正，推荐 2~3**） |
| `--limit <n>` | 只用前 n 个探针 |
| `--max-calls <n>` | 模型调用预算（默认 400，含判定器调用；预算不足的块标记 `samplingInsufficient`，不再静默中止） |
| `--temperature <n>` | 采样温度（默认 0） |
| `--dry-run` | 只预估调用量，不发起任何请求、不读 API Key |
| `--fail-on decisive\|partial` | CI 门禁，命中则退出码 2（采样不足的块不参与） |
| `--json` | 输出符合 schema 的完整 JSON（含元信息、逐块结论、汇总） |
| `--json-out <file>` | 同时把这份 JSON 写到文件 |

探针文件支持 `.jsonl` / `.json` 数组 / 纯文本（一行一条输入）。退出码：`0` 成功跑完（可能含采样不足）；`1` 运行错误；`2` 命中 `--fail-on` 门禁。

## 6. 实测发现：为什么必须做噪声校正

本项目在真实模型上做过对照实验：

- 用 `deepseek-flash` 评审 3 个代码片段，同一提示词重复生成 —— **噪声地板 67%**；
- 此时所有 3 个改动块都被判成「决定性 100%」，连一句「这是内部工具」的说明都显示「显著改变行为」——完全是随机波动被误读；
- 换到输出更短、约束更强的分类任务后，噪声地板降到 0%，归因结果才与直觉完全吻合；
- 另外实测 `deepseek-flash` 在 `temperature=0` 下对同一请求 4 次调用返回了 **3 种**不同输出。

所以 pcause 的报告把「噪声地板」「校正后影响」「原始变化率」并列展示；噪声高时自动警告，而不是给你一个看似精确、实则无法复现的百分比。

## 7. 与 Agent 协作

pcause 是「两个异构模型互相校验」的产物与工具：

- 生成模型与判定模型分离（生成用 DeepSeek，判定可用豆包桌面版）；
- `--verify doubao` 让豆包对 DeepSeek 的每条归因结论投独立裁定，报告附带一致率；
- `--json` / `--json-out` 输出稳定 schema 与明确的退出码（0 成功 / 1 运行错误 / 2 命中门禁），便于被其他 Agent 或 CI 编排。

v1.1 的四项加固来自与豆包的两轮方案评审：

1. 第一轮豆包从泛用性 / 实用性 / 可扩展性三个维度给了一份优先级清单：泛化应先按「消融对象类型」隔离判定语义（而不是把 RAG 模板、工具 schema、模型参数一锅端）；落地必须先补预算分层、失败门禁、稳定机器输出；扩展应先定义 Provider / Judge / Reporter 接口。它同时提醒：pcause 最容易误用的不是模型不稳定，而是用户把「探针上的关联证据」当成严格因果。
2. 第二轮把清单收敛到「一次迭代能完成、测试、发版」的范围：保留 `--kind` + 固定免责、`--dry-run` + 预算语义、CI 门禁、稳定 JSON schema 四项（全部是观测层 / 包装层，不动判定与采样内核）；采样提前停止、插件注册表、两次归因结论对比按规定进入 v1.2 路线。

## 8. 目录结构

```
pcause/
├── src/
│   ├── cli.mjs        命令行入口（init/snapshot/diff/attribute/report/schema/...）
│   ├── diff.mjs       行级 LCS diff、hunk 拆分、精确回退
│   ├── store.mjs      .pcause/ 工作区、快照、归因结果、缓存
│   ├── providers.mjs  模型通道：mock / deepseek / doubao
│   ├── judge.mjs      判定器：heuristic / deepseek / doubao
│   ├── attribute.mjs  归因引擎（采样、噪声地板、校正、第二意见、预算护栏、dry-run 预估）
│   ├── schema.mjs     对外稳定 JSON 的映射与校验（核心契约）
│   └── report.mjs     Markdown + 独立 HTML 报告
├── schema/attribution.schema.json  机器可读结果契约（draft-07，核心字段冻结）
├── test/selftest.mjs  56 项离线自测
├── examples/          分类器演示的提示词与探针
├── docs/              演示报告（HTML / Markdown）与演示 JSON
└── package.json
```

## 9. 已知限制

- **归因以 hunk 为单位，且假设改动块相互独立**：两处耦合改动如果落在同一 hunk，无法分开归因；更隐蔽的是，若 h3 依赖 h1 引入的文本（例如 h1 定义了一个术语、h3 使用它），单独回退 h1 会让提示词自相矛盾，此时输出的变化来自「文本残缺」而不是该改动的真实因果。建议改提示词时一行一条要求、避免跨块引用；对耦合很强的改动，把相关行放进同一个 hunk（相邻行会被自动合并）。
- **本分析不检测改动之间的交互效应**：A、B 单独都没事、同时改才翻车的情况，需要组合实验（复杂度指数级），当前版本在报告里明确声明不覆盖。
- **假设可信度随归因对象类型变化**：`--kind` 只是元标签 + 报告提示，并不会自动让判定逻辑适配系统提示 / 工具定义 / RAG 模板；这些对象的判定语义不同，直接套用普通提示词结论会把关联误当因果。
- **探针选择决定结论**：探针覆盖不到的场景，改动会显示「无影响」。工具给的是探针分布上可测的影响，不是宇宙真理。
- **判定器仍可能出错**：LLM 判定会有误判；`heuristic` 用中文 bigram + 英文词的 Jaccard 相似度（阈值 0.9），对改写仍可能过敏，决定性结论建议结合报告里的原文证据人工复核。
- **豆包通道需要桌面版保持登录并带调试端口运行**（`start-doubao-debug.cmd`），每次调用约 6–13 秒，依赖界面 DOM，可能随版本变化失效；子进程有硬超时保护。
- **成本**：调用数 ≈ 探针数 × 采样数 × (1 + hunk 数) + 判定批次数，**判定器的模型调用也计入 `--max-calls` 预算**。复杂提示词请先用 `--dry-run` 预估、再用 `--limit` 缩小探针集。
- **JSON schema 治理**：核心字段（`meta / hunks / summary`）冻结、按语义化版本维护；新能力优先放进 `extensions`，破坏性变更需升主版本号并同步更新 CI 逻辑。

## 10. 许可

MIT
