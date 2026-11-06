# pcause · 提示词因果归因器

> 改完提示词，效果变好了——但到底是**哪一句**起了作用？
> pcause 用反事实消融实验把这个问题**测**出来，而不是靠猜。

![零依赖](https://img.shields.io/badge/dependencies-0-brightgreen) ![Node](https://img.shields.io/badge/node-%E2%89%A520-blue) ![tests](https://img.shields.io/badge/selftest-258%2F258%20passing-brightgreen) ![CI](https://github.com/2647422139-maker/pcause/actions/workflows/ci.yml/badge.svg)

## 60 秒体验（零 Key、零安装、零网络）

**一句话**：把提示词从旧版改到新版后，pcause 用「逐块回退 + 同探针重跑 + 异构模型判定」测出**哪一处改动真正改变了输出**，而不是靠猜。

前提只有一个：[Node.js](https://nodejs.org/) ≥ 20（`node -v` 检查，推荐 LTS）。

```bash
git clone https://github.com/2647422139-maker/pcause.git
cd pcause
node src/cli.mjs demo
```

不需要 API Key、不联网、不写你的工作区（产物在系统临时目录）。真实输出示意（已截断，颜色与耗时随环境变化）：

```text
✔ 归因完成：attr-…（24 次生成/判定调用，噪声地板 0%）
  ■  h1  决定性 100%    + 输出必须使用 Markdown 表格呈现结论。
  ■  h2  决定性 100%    + 语气保持温和友好。
  □  h3  无影响 0%      + 注意：内部工具，输出会进入数据看板。
报告：<临时目录>/attributions/attr-….md（另有 .html）
```

> 本包尚未发布到 npm，所以上面的入口是 `git clone` + `node src/cli.mjs`；发布后可使用 `npx pcause demo`。样例输出是**示意**，真实报告字段与内容随提示词/探针变化。

想深入：看[它解决什么问题](#1-它解决什么问题) · 用[自己的提示词跑一次](#3-安装与快速开始) · 查[命令](#5-命令)与[已知限制](#9-已知限制)。

## 更新日志

完整版本摘要归档在 [docs/updates.md](docs/updates.md)，机器可读版本变更见 [CHANGELOG.md](CHANGELOG.md)。
最新一次：v1.18——README 首页重整：新增「60 秒体验」区块，历史摘要迁入 `docs/updates.md`，并修正章节编号。

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
node src/cli.mjs demo      # 零 Key 演示：跑一次完整归因（mock 生成器 + 离线判定），产物写到系统临时目录
node test/selftest.mjs     # 258/258 项离线自测，不联网、不花钱
npm run preflight          # 发布前自检：版本 / badge / 链接 / 文件 / 入口一次过（含自测）
```

版本变更历史见 [CHANGELOG.md](CHANGELOG.md)。发布包只包含 `src/`、`schema/`、`examples/`、`docs/` 与文档（见 `package.json` 的 `files` 白名单），本地 `.pcause/` 工作区不会被一起发布。

生成 Key 不需要：`deepseek` 通道会自动读取 `DEEPSEEK_API_KEY` 环境变量或 `~/.dsh/.credentials.yaml`；`doubao` 通道复用**已登录的豆包桌面版**（经本机 `doubao-bridge` 技能，无需任何 API Key）。

不想先配 Key？用 `mock` 通道离线跑通一次，先看清楚命令流和报告长什么样（秒级完成、零消耗）：

```bash
node src/cli.mjs init
node src/cli.mjs snapshot triage-v1 --file examples/triage-v1.md
node src/cli.mjs snapshot triage-v2 --file examples/triage-v2.md
node src/cli.mjs attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider mock --judge heuristic --samples 2 --early-stop
```

`mock` 只是确定性假模型（只认「表格 / 温和」等关键词），**结论不能当真实分析**；真实归因把 `--provider` 换成 `deepseek`（或 `doubao`），判定器推荐 `--judge deepseek --verify doubao`。

跑真实演示（3 个探针 × 3 个改动块，自适应采样，约 1.5 分钟）：

```bash
node src/cli.mjs init
node src/cli.mjs snapshot triage-v1 --file examples/triage-v1.md
node src/cli.mjs snapshot triage-v2 --file examples/triage-v2.md
node src/cli.mjs diff triage-v1 triage-v2
npm run demo
```

### 演示输出（真实运行）

```
✔ 归因完成：attr-20261106185518-d516（57 次调用 / 84.6s，缓存命中 36）
  噪声地板：0%　采样：3 次/探针（自适应，先 2 次）

  ■  h2  决定性   100%（原始 100%）  + 最终只输出一个 JSON 对象：{"category": "<类别名>"}
        └ 第二意见（doubao）：判定一致 18/18
  ▨  h1  部分影响   33%（原始  33%）  + 如果工单情绪激动或明确投诉，在类别名后追加「-URGENT」
        └ 自适应采样：先测 2 次后补采样到 3 次
        └ 第二意见（doubao）：判定一致 27/27
  □  h3  无影响      0%（原始   0%）  + 注意：本分类器是内部工具，输出会进入数据看板
```

结论一目了然：把输出改成 JSON 的那条（h2）是决定性的；情绪加急规则（h1）只对 1/3 的工单生效，且因落在含糊区间被补采样到 3 次确认；「内部工具、不对外公开」这句对行为毫无影响，提前停止、可以删。报告在 `.pcause/attributions/attr-*.md` 与 `.html`（HTML 可直接双击打开）；仓库里的 **[docs/demo-report.html](docs/demo-report.html)** 就是这次运行的报告副本。

## 4. 机器可消费与 CI 集成（v1.1）

CI 里最需要的是「可判定的结果」，而不是好看的报告：

- **预演**：`--dry-run` 只输出预估调用数（生成 / 判定 / 复核上限）与预算是否够，不读 Key、不发请求，适合先估成本。
- **稳定 JSON**：`--json` 输出完整结果，`--json-out result.json` 同时落盘；结构见 [`schema/attribution.schema.json`](schema/attribution.schema.json)，也可用 `pcause schema --out attribution.schema.json` 导出。核心字段冻结，插件/自定义数据只能进 `extensions`，避免上层脚本被插件字段膨胀拖垮。
- **预算不足的语义**：`--max-calls` 耗尽后，已完成的块照常给结论，未测完的块状态为 `unmeasured`、`samplingInsufficient: true`，报告醒目提示「采样不足 ≠ 无影响」；退出码仍是 0。
- **门禁**：`--fail-on decisive` 在任意「决定性」块出现时退出码 2；`--fail-on partial` 连「部分影响」也算命中。`samplingInsufficient` 的块不参与门禁，避免样本不够时误阻断流水线。
- **回归对比**：`pcause compare <旧归因> <新归因>` 在实验签名一致时列出结论迁移（不变 / 升级 / 降级 / 新增 / 消失）与影响强度差值；签名不一致会拒绝（退出码 1）并说明差异，适合放进「提示词连续迭代」的回归检查。

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

## 4.1 出错时怎么办：错误码与自助排查（v1.9）

所有运行错误（退出码 1）默认只在 **stderr** 输出两行：错误码 + 一句话原因、下一步提示。stdout 不受影响，脚本里用 `--json` 仍可直接解析。

| 错误码 | 含义 | 通常怎么处理 |
| --- | --- | --- |
| `PCAUSE_USAGE` | 命令参数缺失 / 冲突 | 看提示里的用法，或 `pcause help` |
| `PCAUSE_NOT_INIT` | 工作区不存在 | 先 `pcause init`（或用 `PCAUSE_HOME` 指定目录） |
| `PCAUSE_NOT_FOUND` | 快照 / 归因 / 探针 / schema 文件不存在 | `pcause list` 看已有 id；检查路径（含空格要加引号） |
| `PCAUSE_INPUT` | 探针文件格式非法 | `.jsonl` 要求一行一个 `{"id","input"}`；纯文本一行一个输入 |
| `PCAUSE_KIND` | `--kind` 拼错 | 可选 `prompt / system / agent`；kind 是提示词位置，不是输出业务标签 |
| `PCAUSE_NO_DIFF` | 新旧提示词逐行相同 | 这是正常结果，不是失败：没有可消融的改动 |
| `PCAUSE_PLUGIN` | 未知 provider / judge | 内置 `mock / deepseek / doubao`；插件需在 `pcause.config.json` 注册 |
| `PCAUSE_ENV` | 缺 `DEEPSEEK_API_KEY`，或找不到豆包桥接脚本 | 配 Key，或用 `DOUBAO_BRIDGE` 指向桥接脚本；不想配就先 `--provider mock` |
| `PCAUSE_REQUEST` | 模型请求失败（网络 / 额度） | 多半可重试，直接重跑；已完成调用按内容缓存，不会重复计费 |
| `PCAUSE_EMPTY_OUTPUT` | 模型返回空内容（思考型模型把预算用光） | 换 `deepseek-v4-pro` 或调大 `max_tokens` |
| `PCAUSE_INTERNAL` | 内部不一致 / schema 不符（bug） | 附命令行与输出到 GitHub issue |
| `PCAUSE_UNKNOWN_COMMAND` | 未知子命令 | `pcause help` |

排错开关：`PCAUSE_DEBUG=1` 追加堆栈；`PCAUSE_CONFIG` 指定插件配置；`PCAUSE_HOME` 指定工作区。门禁命中（`--fail-on`，退出码 2）属于业务阻断，不进入错误码体系。

报 issue 前先跑 `pcause doctor`（v1.19）：它会输出 pcause/Node/平台/工作区/插件配置/通道可用性（**不显示任何密钥**），把整段贴进 issue 即可，能省掉环境追问。`--json` 输出机器可读版本。

## 4.2 发布前自检（v1.10）

`npm run preflight` 把「发版时最容易互相打架的对外信息」一次性校验掉，适合发版前或 CI 里跑：

| 检查 | 说明 |
| --- | --- |
| 版本一致 | `package.json` 版本 = CHANGELOG 最新**已发布**条目（跳过 `[Unreleased]`），且 CHANGELOG 覆盖 0.1.0 |
| badge 不撒谎 | 默认真的跑一遍离线自测，README 的 `selftest-N/N` 必须等于实际通过数 |
| 无残留旧数字 | README 里不能还留着 141/141 这类过期总数 |
| 本地链接与锚点 | 链接目标文件必须存在；`#标题` 锚点用 GitHub 风格 slug 校验目标标题真实存在 |
| 承诺文件齐全 | README 引用的 `docs/demo-*`、`schema/`、`examples/`、`LICENSE` 必须都在 |
| 发布白名单 | `package.json` 的 `files` 覆盖 `src/schema/examples/docs` |
| 入口可用 | `bin` 指向的文件存在，且 `pcause version` / `pcause help` 能跑通 |

```bash
npm run preflight                                  # 全量（含自测，数秒）
node scripts/preflight.mjs --no-tests --quiet      # 只做静态检查，适合极快的本地预检
echo $?                                            # 0 全部通过；1 有检查未通过
```

输出逐项 `✓/✗`，失败时列出具体原因（哪个链接缺失、badge 差多少、哪个版本对不上），不做任何联网检查。

## 4.3 持续集成（v1.11）

仓库自带 `.github/workflows/ci.yml`，push 到 `main`、发起 PR 或手动触发时自动跑：

| 组合 | 平台 | Node |
| --- | --- | --- |
| 主干兼容 | Ubuntu / Windows | 20、22 |
| 前瞻验证 | Ubuntu | 24 |

每个组合依次执行：`npm test`（离线自测）→ `node scripts/preflight.mjs --no-tests`（版本 / badge / 链接 / 文件一致性）→ `npm run pack-check -- --quiet`（打包 + 在独立目录安装 + 跑 bin 的安装演练）。全部离线，**不需要配置任何密钥**。

本地想复刻同样的三步：

```bash
npm test && node scripts/preflight.mjs --no-tests && npm run pack-check -- --quiet
```

查看最近一次运行：`gh run list -R 2647422139-maker/pcause --limit 5`，或点 README 顶部的 CI badge。

## 4.4 npm 发布演练（v1.12）

`npm run pack-check` 回答一个 CI 回答不了的问题：**「用户装上之后，真的能用吗？」**

| 检查 | 怎么验 |
| --- | --- |
| 打包能成 | 真的执行 `npm pack`，拿到 `pcause-x.y.z.tgz` |
| 文件齐全 | tarball 必须含 `src/`、`schema/`、`examples/`、`docs/`、`scripts/`、`README`、`CHANGELOG`、`LICENSE` |
| 不含杂物 | `.pcause/`、`test/`、`.github/`、`node_modules/`、`pcause.config.json` 一律不得进入发布包 |
| 装得上 | 在**独立空临时项目**里 `npm install ./pcause-x.y.z.tgz --ignore-scripts` |
| 版本对 | 安装后的 `node_modules/pcause/package.json` 版本 = 仓库版本 |
| bin 能跑 | 通过 `node_modules/.bin/pcause` shim 跑 `version` 与 `help`；再绕过 shim 用 `node` 直接跑一次 |
| shebang 完好 | 安装包内 `src/cli.mjs` 的首行必须是 `#!/usr/bin/env node\n`（LF，不被 CRLF 破坏） |

```bash
npm run pack-check              # 10 项检查，几秒，产物自动清理
node scripts/pack-check.mjs --keep   # 保留临时目录与 tgz，便于自己翻看
npm run release:check           # 发布前检查（联网）：元数据/仓库状态/打包清单/preflight/pack-check/registry
npm run release:check -- --offline  # 同上但跳过网络检查
npm run release:check -- --json     # 机器可读输出
```

本次演练实际抓到的问题：`files` 白名单漏了 `scripts/`，导致安装后 `npm run preflight` 报文件不存在；已修复并把 `scripts/` 加进白名单。包名可用性另行确认（`npm view pcause` 返回 404，未被占用）。

## 4.5 发布到 npm（v1.17）

`npm publish` 需要登录与 2FA，pcause 不会替你发布；但发布**之前**能自动检查的部分，一条命令跑完：

```bash
npm run release:check            # 联网：元数据 / bin / 工作区 / 推送状态 / tag / 打包清单 / preflight / pack-check / npm 登录 / registry 版本占用
npm run release:check -- --offline   # 无网环境：跳过 npm 登录与 registry 检查
```

检查分三类，失败项逐条列出并退出码 1：

| 类别 | 查什么 |
| --- | --- |
| 发布元数据 | `name` / `version`（semver）/ `bin.pcause` 指向的入口存在且有合法 shebang / `files` 白名单 / `type=module` / `engines.node` / `license`；缺 `repository`/`homepage`/`bugs` 只警告 |
| 版本与仓库状态 | 工作区干净（`git status --porcelain` 为空）、当前提交已推送 `origin/main`、`v<version>` 标签尚未创建（避免重复发版） |
| 产物与一致性 | `npm pack --dry-run` 的 tarball 必含/禁含清单、`preflight`（版本↔CHANGELOG↔badge↔链接↔文件）、`pack-check`（打包→独立目录安装→跑 bin）；联网时再看 npm 登录状态（未登录只警告）与 registry 上是否已有该版本（`npm view pcause versions`） |

通过后脚本打印 5 步人工发布清单：

1. `npm config get registry` 应为 `https://registry.npmjs.org/` → `npm login`（开了 2FA 时 `publish` 还需一次性验证码）
2. `npm publish --access public`
3. `npm view pcause version` 应等于 `package.json` 的版本
4. 空目录 `npx pcause@latest demo`，确认装包后能跑通内置演示
5. `git tag v<version> && git push origin v<version>`

> 提示：`npm view <name>` 返回 404 只说明「当前 registry 上查不到」，不等于包名一定可注册（检索缓存有延迟）；真正能否发布以 `npm publish` 的结果为准。

## 5. 命令

```
pcause init                                   初始化工作区（.pcause/）
pcause snapshot <id> --file <path>            保存提示词快照（也支持 --text "..."）
pcause list                                   列出快照与历史归因
pcause diff <old> <new>                       查看两个版本的改动块（hunk）
pcause run <id> --probes <file>               用某个版本跑探针
pcause attribute --old <id> --new <id> --probes <file> [选项]   核心：跑归因实验
pcause report <attrId> [--md out.md] [--html out.html]          重新导出报告
pcause compare <attrA> <attrB> [--allow-incompatible] [--json] [--md out.md]
                                              对比两次归因的结论迁移（签名一致才允许，默认拒绝）
pcause schema [--out file]                    导出机器可读结果 JSON Schema
pcause demo [--json]                          内置演示：不联网、不需要 Key（产物写临时目录）
pcause doctor [--json]                        自检：版本/Node/平台/工作区/配置/通道（不显示密钥，报 issue 前先跑）
pcause selftest                               离线自测
pcause version                                打印版本号
```

> **`compare` 的预期**：它不是「两次回答谁更好」的打分对比，而是**因果结论迁移对比**——同一实验条件下，同一个改动块的影响是否变了。想做 A/B 打分评测，请用专门的 eval 工具；pcause 只回答「哪一处改动真正改变了行为、这次是否还成立」。

`attribute` 常用选项：

| 选项 | 说明 |
| --- | --- |
| `--provider mock\|deepseek\|doubao` | 生成模型（默认 deepseek） |
| `--judge heuristic\|deepseek\|doubao` | 判定器（默认 heuristic） |
| `--verify <judge>` | 第二意见判定器，如 `--verify doubao` |
| `--kind prompt\|system\|agent` | 归因对象类型（默认 prompt；影响判定器使用的判定维度与报告里的假设可信度提示，v1.6 起 system/agent 有专用判定重点） |
| `--samples <n>` | 每探针独立生成 n 次（默认 1；**≥2 才会测噪声地板并校正，推荐 2~3**） |
| `--early-stop` | 采样提前停止：先测 `--min-samples` 次，仅在结论含糊或噪声偏高时补采样到 `--samples` 次（见 v1.5） |
| `--min-samples <n>` | 自适应采样的首轮次数（默认 2，需配合 `--early-stop` 且 ≤ `--samples`） |
| `--concurrency <n>` | 生成阶段并发请求数（默认 1；2~4 较快，过高易触发限流。预算按发起前预占，不会超支） |
| `--config <file>` | 插件配置文件（默认 `./pcause.config.json`，或环境变量 `PCAUSE_CONFIG`；见 v1.4） |
| `--limit <n>` | 只用前 n 个探针 |
| `--max-calls <n>` | 模型调用预算（默认 400，**单位是模型请求次数，不是 token 或金额**；含判定器调用；预算不足的块标记 `samplingInsufficient`，不再静默中止） |
| `--temperature <n>` | 采样温度（默认 0） |
| `--dry-run` | 只预估调用量，不发起任何请求、不读 API Key |
| `--fail-on decisive\|partial` | CI 门禁，命中则退出码 2（采样不足的块不参与） |
| `--json` | 输出符合 schema 的完整 JSON（含元信息、逐块结论、汇总） |
| `--json-out <file>` | 同时把这份 JSON 写到文件 |

> **`--kind` 是什么**：它描述这段提示词在系统中的**位置**，不是给模型输出打业务标签。`prompt` = 任务提示词（默认），`system` = 系统提示词，`agent` = Agent 指令；选错会让判定维度错配（例如把系统提示词当任务提示词，就会漏看「安全拒答、角色边界、工具权限」这些在系统提示词里才重要的维度）。拿不准时先保持默认，报告里会标注本次使用的判定维度与假设可信度。

`compare` 选项：

| 选项 | 说明 |
| --- | --- |
| `--allow-incompatible` | 两次实验签名不一致时仍强行对比（默认拒绝；输出会标注结论仅作参考） |
| `--json` | 输出机器可读的对比结果（含 `compatible`、`mismatches`、逐块迁移） |
| `--md <file>` | 把对比结果写成 Markdown |

探针文件支持 `.jsonl` / `.json` 数组 / 纯文本（一行一条输入）。退出码：`0` 成功跑完（可能含采样不足）；`1` 运行错误或 `compare` 的签名不一致；`2` 命中 `--fail-on` 门禁。

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
3. v1.2 的第一项按 roadmap 落地为 `compare`，其设计又回到豆包确认：签名必须包含探针集、采样数、生成器与判定器；对比时最容易翻车的是「只比 verdict、忽略 hunk 对齐错位」，所以实现用内容做主键、只比同一改动块的前后结论。
4. v1.3 的并发设计同样先问过豆包：预算按**发起前预占**而不是等完成后再扣，否则 in-flight 请求会让预算透支；并发上限必须单独用 `--concurrency` 控制，不能拿预算当并发数用。它还提醒「重跑要按已完成采样点跳过、输出按固定序号排序」——pcause 用内容寻址缓存 + `(探针, 采样)` 固定落位实现，不需要额外状态文件。
5. v1.4 的插件接口同样先与豆包对表：接口保持「Provider 只有 `generate`、Judge 只有 `judgeBatch`、`ctx` 只传只读配置」；它指出的头号风险是插件自行发起请求或递归调内部逻辑从而绕过核心的调用计数与缓存——因此 pcause 把预算与缓存收在核心包装层（一次 generate / 一个判定批次记 1 次调用），并要求插件名不得覆盖内置通道。本地插件的安全边界也写进了限制（可执行代码，只加载显式声明的本地文件）。
6. v1.6 的判定维度适配由豆包先给结构：它主张 system 与 agent 是两种责任面——system 只看「守不守规则」、agent 只看「活有没有干对」，其余维度（话术润色、角色人设等）都该裁掉；并给了三类高频误判（规则内的合理变通被当越界、异常分支被硬卡格式、需要多步探索的任务被判失败）。实现采纳它的「阶段 1」建议：只做提示词分流、对外 schema 零改动、`--kind prompt` 逐字不变；结构化分维度打分与「system 违规一票否决 agent」的分层流水线留作后续演进。
7. v1.7 维护轮请豆包扮演「第一次使用者」做可用性挑刺：它指出最致命的不是功能缺口，而是三个预期错位——把 `--kind` 当成输出业务标签、把预算当成金额、把 `compare` 当成打分对比。本轮据此只改提示与文档（运行前打印消耗预估、预算单位显式标注、kind 大白话对照、compare 预期锁定、增加零 Key 离线上手路径），不动判定与采样内核。
8. v1.8 的发布元数据与 CHANGELOG 同样先问豆包：它把「package.json 发布元数据 + npm pack 白名单」列为最高性价比，其次是标准化 CHANGELOG 与版本同步校验，第三是结构化可诊断错误码（本轮未做——pcause 已有 `PCAUSE_BUDGET` / `PCAUSE_SIGNATURE` / `PCAUSE_PLUGIN` 等错误码，统一错误出口与快照测试留作后续）。

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
│   ├── concurrency.mjs 有界并发调度（保序、失败即停调度、进度回调）
│   ├── plugins.mjs    Provider / Judge 插件注册表（pcause.config.json、动态 import、接口校验）
│   ├── compare.mjs    归因结论迁移对比（签名校验、按内容对齐 hunk、迁移报告）
│   ├── sampling.mjs   采样策略：固定 / 自适应提前停止（阈值与补采样判定）
│   ├── schema.mjs     对外稳定 JSON 的映射与校验（核心契约）
│   └── report.mjs     Markdown + 独立 HTML 报告
├── schema/attribution.schema.json  机器可读结果契约（draft-07，核心字段冻结）
├── test/selftest.mjs  257 项离线自测
├── scripts/           发布前自检：preflight（版本/链接/文件一致性）、pack-check（安装演练）、release-check（发布检查单）
├── examples/          分类器演示的提示词与探针；plugins/ 为插件示例，pcause.config.example.json 为配置样例
├── docs/              演示报告（HTML / Markdown）、演示 JSON、归因对比演示、[插件开发指南](docs/plugins.md)
├── CHANGELOG.md       版本变更历史（Keep a Changelog 轻量格式）
└── package.json
```

## 8.1 自定义 Provider / Judge（插件）

不想用内置通道（mock / deepseek / doubao）时，可以用本地插件接入自己的模型、网关或判定规则：在 `pcause.config.json` 里注册模块，然后 `pcause attribute --provider <名字> --judge <名字>`。契约、配置解析规则、预算与缓存语义、6 个常见坑都写在 [docs/plugins.md](docs/plugins.md)。

## 9. 已知限制

- **归因以 hunk 为单位，且假设改动块相互独立**：两处耦合改动如果落在同一 hunk，无法分开归因；更隐蔽的是，若 h3 依赖 h1 引入的文本（例如 h1 定义了一个术语、h3 使用它），单独回退 h1 会让提示词自相矛盾，此时输出的变化来自「文本残缺」而不是该改动的真实因果。建议改提示词时一行一条要求、避免跨块引用；对耦合很强的改动，把相关行放进同一个 hunk（相邻行会被自动合并）。
- **本分析不检测改动之间的交互效应**：A、B 单独都没事、同时改才翻车的情况，需要组合实验（复杂度指数级），当前版本在报告里明确声明不覆盖。
- **假设可信度随归因对象类型变化**：`--kind` 会切换判定器的判定重点（system 看规则边界、agent 看任务推进），但它仍是**提示词级适配**：不改变探针集、生成参数、采样阈值与判定阈值，也不做结构化分维度打分（模型只回 changed + 一句话理由）。因此不同 kind 的结论强度不能直接横向比较；系统提示 / Agent 指令的结论建议结合对应维度的证据人工复核。
- **探针选择决定结论**：探针覆盖不到的场景，改动会显示「无影响」。工具给的是探针分布上可测的影响，不是宇宙真理。
- **判定器仍可能出错**：LLM 判定会有误判；`heuristic` 用中文 bigram + 英文词的 Jaccard 相似度（阈值 0.9），对改写仍可能过敏，决定性结论建议结合报告里的原文证据人工复核。
- **豆包通道需要桌面版保持登录并带调试端口运行**（`start-doubao-debug.cmd`），每次调用约 6–13 秒，依赖界面 DOM，可能随版本变化失效；子进程有硬超时保护。
- **成本**：调用数 ≈ 探针数 × 采样数 × (1 + hunk 数) + 判定批次数，**判定器的模型调用也计入 `--max-calls` 预算**。复杂提示词请先用 `--dry-run` 预估、再用 `--limit` 缩小探针集。
- **JSON schema 治理**：核心字段（`meta / hunks / summary`）冻结、按语义化版本维护；新能力优先放进 `extensions`，破坏性变更需升主版本号并同步更新 CI 逻辑。
- **`compare` 只比结论，不重跑实验**：它对比的是两轮归因各自的结论，不会替你重新采样；两次实验间隔期间换了模型服务商、探针或采样数都会被签名校验拦下（可 `--allow-incompatible` 强看，但差异可能来自实验条件）。另外，若「同一句改动」被改写过措辞（旧行/新行内容变了），会被当成「消失 + 新增」，因为对齐主键是内容。
- **并发只作用于生成阶段**：判定器与复核仍按批串行（保持判定批次可解释），`--concurrency` 过大容易触发 API 限流，建议 2~4。预算为「发起前预占」，并发下不会超支，但预算紧张时可能比串行更早进入「采样不足」。
- **插件是可执行代码，不是沙箱**：pcause 只加载 `pcause.config.json` 里显式声明的本地模块（不做远程加载、不自动安装），但插件会以你的用户权限运行，请只使用信任的插件。预算按「一次 `generate` / 一个判定批次 = 1 次调用」记账，若插件内部自己发多次请求，实际成本会超出统计口径（核心无法感知，需插件作者自负）。插件模块在进程内只初始化一次，修改插件后需重新运行命令。
- **自适应采样有截断偏倚风险**：`--early-stop` 只在含糊/高噪声时才补采样，清晰落在 0 或 1 附近的块会被提前截断，理论上会让效应分布的尾部变窄、均值轻微偏移；阈值提前固定、停止判断只用原始变化率，报告披露每块实际采样数与提前终止情况，但**它不能替代满采样实验**。需要发表级严谨结论时请关掉 `--early-stop`（默认关闭）做满采样；不确定时先用 `--limit` 缩小探针集再满采样。

## 10. 许可

MIT
