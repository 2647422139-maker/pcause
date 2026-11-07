# pcause：提示词里，哪句话真有用？

> 改完提示词，效果变好了——但到底是**哪一句**起了作用？
> pcause 用实验把它测出来，而不是靠猜、靠感觉。

![零依赖](https://img.shields.io/badge/dependencies-0-brightgreen) ![Node](https://img.shields.io/badge/node-%E2%89%A520-blue) ![tests](https://img.shields.io/badge/selftest-319%2F319%20passing-brightgreen) ![CI](https://github.com/2647422139-maker/pcause/actions/workflows/ci.yml/badge.svg)

## 60 秒体验（零 Key、零安装、零网络）

**一句话**：你把提示词从旧版改到新版，pcause 会挨个撤掉改动、用同一批问题重跑，看 AI 的回答是不是真的变了——于是你知道哪一句是决定性的、哪一句只是陪跑。

前提只有一个：[Node.js](https://nodejs.org/) ≥ 20（`node -v` 检查，推荐 LTS）。

```bash
git clone https://github.com/2647422139-maker/pcause.git
cd pcause
node src/cli.mjs demo
```

不用 API Key、不联网、不碰你的项目（结果写在系统临时目录）。真实输出示意（路径和编号每次不同）：

```text
✔ 已创建临时演示工作区：<临时目录>
· 运行归因（mock 生成器 + heuristic 判定，不联网、不花钱）
· 噪声地板：同一提示词重复生成之间的变化率 = 0%（每探针 2 次采样）
✔ 归因完成：attr-…（24 次生成/判定调用，噪声地板 0%）
  ■  h1  决定性 100%    + 输出必须使用 Markdown 表格呈现结论。
  ■  h2  决定性 100%    + 语气保持温和友好。
  □  h3  无影响 0%      + 注意：内部工具，输出会进入数据看板。
报告：<临时目录>/attributions/attr-….md
      <临时目录>/attributions/attr-….html
下一步：pcause demo --json 看机器可读结果；想测自己的提示词，见 README 的「快速开始」
```

以上是**真实运行输出**（只把临时路径与随机编号换成了 `<临时目录>` / `attr-…`）。看到这些说明正常：

- 两个「决定性」+ 一个「无影响」，进程退出码 `0`——说明整条链路是通的；
- `attr-…` 与 `<临时目录>` 每次都不一样（随机编号 + 系统临时目录），演示结果不会写进你的仓库；
- 噪声地板是 `0%`，因为 mock 生成器是确定性的；换成真实模型后通常不是 0%（这正是 pcause 要扣掉随机性的原因）；
- 看到 `✖ [PCAUSE_…]` 才是出错：先跑 `pcause doctor`，或按[错误码表](#41-出错时怎么办错误码与自助排查v19)自查。

> 本包尚未发布到 npm，所以上面的入口是 `git clone` + `node src/cli.mjs`；发布后可使用 `npx pcause demo`。演示提示词与问题都是内置的，报告内容会随版本微调。

想继续看：[它到底解决什么问题](#1-它解决什么问题) · [用自己的提示词跑一次](#3-安装与快速开始) · [命令](#5-命令) · [已知限制](#9-已知限制)。

## 更新日志

完整版本摘要归档在 [docs/updates.md](docs/updates.md)，机器可读版本变更见 [CHANGELOG.md](CHANGELOG.md)。
最新一次：v1.29——README 重写成「说人话」版本：先讲场景和收益，术语集中放在一张对照表里。

## 1. 它解决什么问题

**打个比方：提示词就像菜谱。**

你往菜谱里加了三样调料，菜变好吃了。于是你相信三样都有用，一样都不敢删——可你其实不知道是哪一样起了作用，也不知道换个厨师（换个模型）还灵不灵。

真实情况常常是：

- 真正起作用的可能只有**一处**，其余几处 AI 根本没执行；
- 你感觉到的「变好」，也可能只是**模型这次状态好**。同一段提示词问两遍，答案本来就会不一样（实测 DeepSeek 把随机性关到 0 时，同一个请求四次仍有三种不同输出）。

现有的提示词工具帮不上这个忙：

| 已有工具 | 它能回答 | 它回答不了 |
| --- | --- | --- |
| 文本 diff（如 `promptdiff`） | 提示词改了哪些字 | 哪处改动**改变了 AI 的行为** |
| 评测工具（如 `promptfoo`） | 两个版本**整体**谁得分高 | 分数提升具体来自哪一句 |
| 提示词优化器（如 `DSPy`） | 自动搜出更好的提示词 | 人工改动**为什么**有效 |
| 多模型投票（如 `llm-council`） | 让多个模型投票给更可靠的答案 | 提示词里的因果 |

**pcause 只回答一个问题**：新版提示词里，哪一处改动是决定性的、哪一处只有部分影响、哪一处完全可以删掉。

它**不做**这些事：不帮你优化提示词、不给两个版本打分排名、不做回归监控——这些已经有专门的工具。

## 2. 它怎么工作（不用看懂也能用）

像查电路：一次只拔掉一根线，看灯还亮不亮。pcause 对提示词的每处改动做同样的事：

1. 把新旧提示词逐行对齐，找出所有不同的地方，每一处连续的修改算「一块」；
2. 用**新版**提示词，把准备好的问题挨个问一遍模型，记下回答；
3. 每次只撤掉**其中一块**改动，再问一遍同一批问题；
4. 由一个「裁判」判断：两次回答是**真的行为变了**（格式、结论、是否遵守要求），还是只是换了措辞；
5. 把「模型自己本来就不稳定」的部分扣掉，得到每个改动块的真实影响。

看报告时，对照这张表就够了：

| 报告里的词 | 大白话 |
| --- | --- |
| 改动块（hunk） | 提示词里一处连续的修改（可能是加了一行、改了一行） |
| 探针（probe） | 用来测试的一批输入问题，比如「用户说退款被拒，很生气」 |
| 噪声地板 | 同一段提示词问两遍，回答天然会差多少 |
| 判定器（judge） | 裁判：判断两次回答是否真的不一样 |
| 决定性 / 部分影响 / 无影响 | 撤掉这一块后，回答变化很大 / 有时变 / 基本不变 |
| 第二意见 | 换个模型再当一次裁判，看结论一致不一致 |
| unmeasured | 预算或采样不够，**没测完**——不能当成「无影响」 |

## 3. 安装与快速开始

零依赖，Node ≥ 20：

```bash
git clone <this-repo> && cd pcause
node src/cli.mjs demo      # 零 Key 演示：跑一次完整归因（假模型 + 离线裁判），结果写临时目录
node test/selftest.mjs     # 319/319 项离线自测，不联网、不花钱
npm run preflight          # 发布前自检：版本 / badge / 链接 / 文件 / 入口一次过（含自测）
```

版本变更历史见 [CHANGELOG.md](CHANGELOG.md)。发布包只包含 `src/`、`schema/`、`examples/`、`docs/` 与文档（见 `package.json` 的 `files` 白名单），本地 `.pcause/` 工作区不会跟着发布。

**关于 Key**：`deepseek` 通道自动读取 `DEEPSEEK_API_KEY` 环境变量或 `~/.dsh/.credentials.yaml`；`doubao` 通道复用**已登录的豆包桌面版**（经本机 `doubao-bridge` 技能，不需要任何 API Key）。

### 用自己的提示词跑一次

第一步先把旧版、新版提示词和测试问题准备好，然后四行命令：

```bash
node src/cli.mjs init                                            # 建工作区
node src/cli.mjs snapshot my-prompt-v1 --file v1.md              # 保存旧版
node src/cli.mjs snapshot my-prompt-v2 --file v2.md              # 保存新版
node src/cli.mjs attribute --old my-prompt-v1 --new my-prompt-v2 \
  --probes my-questions.jsonl --provider deepseek --judge deepseek --samples 2
```

测试问题（探针）一行一个，支持 `.jsonl`（`{"id","input"}`）、`.json` 数组或纯文本。

不想先配 Key？先用 `mock` 假模型把流程跑通，看看命令和报告长什么样（秒级完成、零消耗）：

```bash
node src/cli.mjs init
node src/cli.mjs snapshot triage-v1 --file examples/triage-v1.md
node src/cli.mjs snapshot triage-v2 --file examples/triage-v2.md
node src/cli.mjs attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider mock --judge heuristic --samples 2 --early-stop
```

> `mock` 只是确定性假模型（只认「表格 / 温和」这类关键词），**结论不能当真实分析**。真实归因把 `--provider` 换成 `deepseek`（或 `doubao`），裁判推荐 `--judge deepseek --verify doubao`。

真实演示（3 个问题 × 3 处改动，自适应采样，约 1.5 分钟）：

```bash
node src/cli.mjs init
node src/cli.mjs snapshot triage-v1 --file examples/triage-v1.md
node src/cli.mjs snapshot triage-v2 --file examples/triage-v2.md
node src/cli.mjs diff triage-v1 triage-v2
npm run demo
```

### 真实运行长这样

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

翻译成人话：

- 把输出改成 JSON 那条（h2）是决定性的，删了它结果一定变；
- 「情绪激动就加 -URGENT」这条（h1）只对三分之一的工单生效——它不是没用，而是只在这些场景起作用；
- 「内部工具、不对外公开」这句（h3）对行为毫无影响，**可以删**。

报告在 `.pcause/attributions/attr-*.md` 与 `.html`（HTML 双击就能打开）；仓库里的 **[docs/demo-report.html](docs/demo-report.html)** 就是这次运行的报告副本。

## 4. 想接自动化 / CI 时

CI 里需要的是「能判定的结果」，不是好看的报告：

- **先估成本**：`--dry-run` 只算要发多少次请求、预算够不够，不读 Key、不发请求；
- **稳定输出**：`--json` 输出完整结果，`--json-out result.json` 同时落盘；结构见 [`schema/attribution.schema.json`](schema/attribution.schema.json)，也可以用 `pcause schema --out schema.json` 导出；
- **预算不够时**：预算耗尽的块会标成 `unmeasured`（没测完），而不是静默给个假结论，报告会写「采样不足 ≠ 无影响」；
- **卡门禁**：`--fail-on decisive` 在出现决定性改动时退出码 `2`；`--fail-on partial` 连「部分影响」也算命中；没测完的块不参与门禁；
- **两次归因对比**：`pcause compare <旧归因> <新归因>` 列出结论是「不变 / 升级 / 降级 / 新增 / 消失」，适合接在提示词的持续迭代后面。

```bash
# 先看要发多少请求（不联网、不读 Key）
node src/cli.mjs attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider deepseek --judge deepseek --samples 2 --dry-run

# CI：跑完落 JSON；只要出现决定性改动就让流水线失败
node src/cli.mjs attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider deepseek --judge deepseek --samples 2 \
  --json-out /tmp/attribution.json --fail-on decisive
echo $?   # 0 无命中；2 命中门禁；1 运行错误
```

机器可读的演示结果见 [`docs/demo-attribution.json`](docs/demo-attribution.json)。

## 4.1 出错时怎么办：错误码与自助排查（v1.9）

出错时（退出码 1）只在 **stderr** 打两行：错误码 + 一句话原因，再加一行提示。stdout 不受影响，`--json` 照常能解析。

| 错误码 | 含义 | 通常怎么处理 |
| --- | --- | --- |
| `PCAUSE_USAGE` | 命令参数缺失 / 冲突 | 看提示里的用法，或 `pcause help` |
| `PCAUSE_NOT_INIT` | 工作区不存在 | 先 `pcause init`（或用 `PCAUSE_HOME` 指定目录） |
| `PCAUSE_NOT_FOUND` | 快照 / 归因 / 探针 / schema 文件不存在 | `pcause list` 看已有 id；检查路径（含空格要加引号） |
| `PCAUSE_INPUT` | 探针文件格式非法 | `.jsonl` 要求一行一个 `{"id","input"}`；纯文本一行一个输入 |
| `PCAUSE_KIND` | `--kind` 拼错 | 可选 `prompt / system / agent`；kind 指提示词所在位置，不是输出分类 |
| `PCAUSE_NO_DIFF` | 新旧提示词逐行相同 | 这是正常结果，不是失败：没有可拆开测的改动 |
| `PCAUSE_PLUGIN` | 未知 provider / judge | 内置 `mock / deepseek / doubao`；插件需在 `pcause.config.json` 注册 |
| `PCAUSE_ENV` | 缺 `DEEPSEEK_API_KEY`，或找不到豆包桥接脚本 | 配 Key，或用 `DOUBAO_BRIDGE` 指向桥接脚本；不想配就先 `--provider mock` |
| `PCAUSE_REQUEST` | 模型请求失败（网络 / 额度） | 多半可重试，直接重跑；已完成调用有缓存，不会重复计费 |
| `PCAUSE_EMPTY_OUTPUT` | 模型返回空内容（思考型模型把预算用光） | 换 `deepseek-v4-pro` 或调大 `max_tokens` |
| `PCAUSE_INTERNAL` | 内部不一致 / schema 不符（bug） | 附命令行与输出到 GitHub issue |
| `PCAUSE_UNKNOWN_COMMAND` | 未知子命令 | `pcause help` |

排错开关：`PCAUSE_DEBUG=1` 追加堆栈；`PCAUSE_CONFIG` 指定插件配置；`PCAUSE_HOME` 指定工作区。门禁命中（`--fail-on`，退出码 2）是业务阻断，不算错误。

报 issue 前先跑 `pcause doctor --issue`（v1.22）：它直接生成一段可粘贴的 Markdown（四段结构 + 自检输出，不含密钥）；只想要纯文本自检用 `pcause doctor`。它会打印 pcause/Node/平台/工作区/插件配置/通道可用性（**不显示任何密钥**），整段贴进 issue 能省掉环境追问。`--json` 输出机器可读版本。

## 4.2 发布前自检（v1.10）

`npm run preflight` 把发版时最容易互相打架的信息一次校验掉，适合发版前或 CI 里跑：

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
npm run release:verify                             # 发布后：查 registry 版本 + npx 跑目标版本 + demo --json（需已发布）
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

## 4.4 下载下来能装吗（v1.12）

`npm run pack-check` 回答一个 CI 回答不了的问题：**「用户装上之后，真的能用吗？」**

| 检查 | 怎么验 |
| --- | --- |
| 打包能成 | 真的执行 `npm pack`，拿到 `pcause-x.y.z.tgz` |
| 文件齐全 | tarball 必须含 `src/`、`schema/`、`examples/`、`docs/`、`scripts/`、`README`、`CHANGELOG`、`LICENSE` |
| 不含杂物 | `.pcause/`、`test/`、`.github/`、`node_modules/`、`pcause.config.json` 一律不得进入发布包 |
| 装得上 | 在**独立空临时项目**里 `npm install ./pcause-x.y.z.tgz --ignore-scripts` |
| 版本对 | 安装后的 `node_modules/pcause/package.json` 版本 = 仓库版本 |
| bin 能跑 | 通过 `node_modules/.bin/pcause` shim 跑 `version` 与 `help`；再绕过 shim 用 `node` 直接跑一次 |
| shebang 完好 | 安装包内 `src/cli.mjs` 首行必须是 `#!/usr/bin/env node\n`（LF，不被 CRLF 破坏） |

```bash
npm run pack-check              # 10 项检查，几秒，产物自动清理
npm run install:check           # 15 项「安装无关性」检查：不装全局 / 不配 PATH / 长路径 / 深目录
node scripts/pack-check.mjs --keep   # 保留临时目录与 tgz，便于自己翻看
npm run release:check           # 发布前检查（联网）：元数据/仓库状态/打包清单/preflight/pack-check/registry
npm run release:check -- --offline  # 同上但跳过网络检查
npm run release:check -- --json     # 机器可读输出
```

这次演练真的抓到过问题：`files` 白名单漏了 `scripts/`，导致安装后 `npm run preflight` 报文件不存在；已修复。包名另已确认未被占用（`npm view pcause` 返回 404）。

## 4.5 发布到 npm（v1.17）

`npm publish` 需要登录与 2FA，pcause 不会替你发布；但发布**之前**能自动检查的部分，一条命令跑完：

```bash
npm run release:check            # 联网：元数据 / bin / 工作区 / 推送状态 / tag / 打包清单 / preflight / pack-check / npm 登录 / registry 版本占用
npm run release:check -- --offline   # 无网环境：跳过 npm 登录与 registry 检查
```

检查分三类，失败项逐条列出、退出码 1：

| 类别 | 查什么 |
| --- | --- |
| 发布元数据 | `name` / `version`（semver）/ `bin.pcause` 指向的入口存在且有合法 shebang / `files` 白名单 / `type=module` / `engines.node` / `license`；缺 `repository`/`homepage`/`bugs` 只警告 |
| 版本与仓库状态 | 工作区干净（`git status --porcelain` 为空）、当前提交已推送 `origin/main`、`v<version>` 标签尚未创建（避免重复发版） |
| 产物与一致性 | `npm pack --dry-run` 的 tarball 必含/禁含清单、`preflight`（版本↔CHANGELOG↔badge↔链接↔文件）、`pack-check`（打包→独立目录安装→跑 bin）；联网时再看 npm 登录状态（未登录只警告）与 registry 上是否已有该版本 |

通过后脚本打印 5 步人工发布清单：

1. `npm config get registry` 应为 `https://registry.npmjs.org/` → `npm login`（开了 2FA 时 `publish` 还需一次性验证码）
2. `npm publish --access public`
3. `npm view pcause version` 应等于 `package.json` 的版本
4. 空目录 `npx pcause@latest demo`，确认装包后能跑通内置演示
5. `git tag v<version> && git push origin v<version>`

> 提示：`npm view <name>` 返回 404 只说明「当前 registry 上查不到」，不等于包名一定可注册（检索缓存有延迟）；真正能否发布以 `npm publish` 的结果为准。

## 4.6 两次归因怎么比（v1.23）

改了提示词或换了测试问题后，想知道「原来起决定作用的那处改动现在还是不是决定性的」，用 `pcause compare <attrA> <attrB>`：它不重跑模型，只对比两次归因的结论。**两次实验条件（测试问题集 / 采样数 / 生成模型 / 裁判 / kind）必须一致**，否则会拒绝并说明差异（可用 `--allow-incompatible` 强行对比）。

输出把每个改动块标成 不变 / 升级 / 降级 / 新增 / 消失，并给出前后判定与影响值。完整说明与真实示例见 [docs/compare.md](docs/compare.md)、[docs/compare-demo.md](docs/compare-demo.md)。

## 4.7 报告怎么读（v1.24）

报告里三个数字最容易误读：**校正后影响**（默认判断依据）、**原始变化率**（没扣随机性）、**噪声地板**（同一提示词自比差多少）。0% 不等于没测（看 `unmeasured` / 采样不足标记），第二意见一致不等于结论正确，影响百分比也不代表业务重要性。完整读法、证据区怎么用、HTML/JSON/Markdown 怎么选，见 [docs/report.md](docs/report.md)。

## 4.8 常见问题（FAQ）

要不要联网、花不花钱、`0%` 到底是什么、为什么两次结论不同、能不能测 system prompt、怎么接 CI、`unmeasured` 怎么处理——都收在 [docs/faq.md](docs/faq.md)，每条都给判断依据。

## 4.9 安装无关性核对（v1.28）

用户最常见的翻车不是「功能不对」，而是**装上之后跑不起来**：只在自己机器上全局装过、PATH 里恰好有 node、装在浅目录里。这些在 CI 跑单测都发现不了。

`npm run install:check` 用**真实安装**回答「换个环境还灵吗」：

| 检查 | 怎么验 |
| --- | --- |
| 深长中文目录 | 安装到 **203 字符**、含空格与中文的嵌套目录 |
| 安装树合规 | 落盘后必须含 11 个运行文件，且不含 `.pcause/`、`test/`、`.github/`、`pcause.config.json` |
| 零依赖 | 安装项目的 `node_modules` 里只有 `pcause`，且 `dependencies` 为空 |
| 不依赖全局安装 | 只通过本地 `node_modules/.bin/pcause` 运行 |
| PATH 隔离 | PATH 里只留 `node` 所在目录 + 系统目录（移除 npm 全局 bin）仍可运行 |
| 不依赖当前目录 | 在无关临时目录用绝对路径直接 `node .../src/cli.mjs version` |
| npx 本地解析 | `npx --no-install pcause version` 从本地依赖解析，不走网络 |
| 装完能跑演示 | 安装副本运行 `demo --json`，校验 `ok` 与改动块 |
| 超长工作区 | `PCAUSE_HOME` 指向 **211 字符**的中文长路径，`init` / `list` 正常 |
| 能力不缺 | 安装后 `help` 覆盖 11 个核心命令 |

```bash
npm run install:check            # 15 项，几十秒，自动清理临时目录
node scripts/install-check.mjs --keep   # 保留临时安装目录便于排查
```

它和 `pack-check` 的分工：pack-check 证明「包能装上、命令能跑」；install-check 证明「在**恶劣环境**里也能跑」。

## 5. 命令

```
pcause init                                   初始化工作区（.pcause/）
pcause snapshot <id> --file <path>            保存提示词快照（也支持 --text "..."）
pcause list                                   列出快照与历史归因
pcause diff <old> <new>                       查看两个版本的改动块
pcause run <id> --probes <file>               用某个版本跑问题集
pcause attribute --old <id> --new <id> --probes <file> [选项]   核心：跑归因实验
pcause report <attrId> [--md out.md] [--html out.html]          重新导出报告
pcause compare <attrA> <attrB> [--allow-incompatible] [--json] [--md out.md]
                                              对比两次归因的结论迁移（条件一致才允许）
pcause schema [--out file]                    导出机器可读结果 JSON Schema
pcause demo [--json]                          内置演示：不联网、不需要 Key（产物写临时目录）
pcause doctor [--json]                        自检：版本/Node/平台/工作区/配置/通道（不显示密钥，报 issue 前先跑）
pcause selftest                               离线自测
pcause version                                打印版本号
```

> **`compare` 是比对结论，不是打分**：它回答「同一个改动块的影响这次是否还成立」，不是「两次回答谁更好」。想做 A/B 打分评测，请用专门的评测工具。

`attribute` 常用选项：

| 选项 | 说明 |
| --- | --- |
| `--provider mock\|deepseek\|doubao` | 生成模型（默认 deepseek） |
| `--judge heuristic\|deepseek\|doubao` | 裁判（默认 heuristic） |
| `--verify <judge>` | 第二意见裁判，如 `--verify doubao` |
| `--kind prompt\|system\|agent` | 这段提示词的位置（默认 prompt；影响裁判关注点与报告里的可信度提示） |
| `--samples <n>` | 每个问题独立生成 n 次（默认 1；**≥2 才会测噪声地板并校正，推荐 2~3**） |
| `--early-stop` | 采样提前停止：先测 `--min-samples` 次，只有结论含糊或噪声高时才补采样 |
| `--min-samples <n>` | 自适应采样的首轮次数（默认 2，需配合 `--early-stop`） |
| `--concurrency <n>` | 生成阶段并发数（默认 1；2~4 较快，过高易触发限流；预算按发起前预占，不会超支） |
| `--config <file>` | 插件配置文件（默认 `./pcause.config.json`，或 `PCAUSE_CONFIG`） |
| `--limit <n>` | 只用前 n 个测试问题 |
| `--max-calls <n>` | 模型调用预算（默认 400，**单位是请求次数，不是 token 也不是钱**；预算不够的块标记「没测完」） |
| `--temperature <n>` | 采样温度（默认 0） |
| `--dry-run` | 只预估调用量，不发起请求、不读 Key |
| `--fail-on decisive\|partial` | CI 门禁，命中则退出码 2（没测完的块不参与） |
| `--json` | 输出符合 schema 的完整 JSON |
| `--json-out <file>` | 同时把 JSON 写到文件 |

> **`--kind` 是什么**：它描述这段提示词在系统中的**位置**，不是给模型输出打分类标签。`prompt` = 任务提示词（默认），`system` = 系统提示词，`agent` = Agent 指令。选错会让裁判关注点错配（比如把系统提示词当任务提示词，就会漏看「安全拒答、角色边界、工具权限」这些只有系统提示词才重要的维度）。拿不准就保持默认。

`compare` 选项：

| 选项 | 说明 |
| --- | --- |
| `--allow-incompatible` | 两次实验条件不一致时仍强行对比（默认拒绝；输出会标注结论仅供参考） |
| `--json` | 输出机器可读结果（含 `compatible`、`mismatches`、逐块迁移） |
| `--md <file>` | 把对比结果写成 Markdown |

探针文件支持 `.jsonl` / `.json` 数组 / 纯文本（一行一条输入）。退出码：`0` 跑完（可能含「没测完」的块）；`1` 运行错误或 `compare` 条件不一致；`2` 命中 `--fail-on` 门禁。

## 6. 一个真实教训：为什么必须扣掉随机性

这个项目在真实模型上做过对照：

- 用 `deepseek-flash` 评审 3 个代码片段，同一提示词重复生成——**噪声地板 67%**；
- 此时 3 个改动块全被判成「决定性 100%」，连一句「这是内部工具」都被说成「显著改变行为」——其实是随机波动被误读；
- 换成输出更短、约束更强的分类任务，噪声地板降到 0%，结论才和直觉一致；
- 另外实测 `deepseek-flash` 在 `temperature=0` 下对同一请求 4 次调用返回了 **3 种**不同输出。

所以报告把「噪声地板 / 校正后影响 / 原始变化率」三个数并列展示；噪声高时自动警告，而不是给你一个看着精确、其实复现不了的百分比。

## 7. 它是和豆包一起做出来的

pcause 由两个异构模型协作产出：DeepSeek 负责实现与生成，豆包（经本机桥接，免 Key）负责评审、挑刺和第二意见。`--verify doubao` 就是让豆包对 DeepSeek 的每条归因结论独立裁定。

每一次迭代的设计都先过豆包这一关，例如：

- 泛化：先按「归因对象类型」隔离判定语义，而不是一锅端；
- 落地：先补预算预演、失败门禁、稳定 JSON；
- 扩展：先定 Provider / Judge 接口，再谈插件市场；
- 可用性：请豆包扮演第一次使用者，结果它挑出的不是功能缺口，而是三个预期错位——`--kind` 被当成输出标签、预算被当成金额、`compare` 被当成打分对比。

完整的多轮评审记录见 [docs/updates.md](docs/updates.md) 各版本摘要。

## 8. 目录结构

```
pcause/
├── src/
│   ├── cli.mjs        命令行入口
│   ├── diff.mjs       逐行对比、拆分改动块、精确回退
│   ├── store.mjs      .pcause/ 工作区、快照、归因结果、缓存
│   ├── providers.mjs  模型通道：mock / deepseek / doubao
│   ├── judge.mjs      裁判：heuristic / deepseek / doubao
│   ├── attribute.mjs  归因引擎（采样、噪声地板、校正、第二意见、预算护栏、dry-run 预估）
│   ├── concurrency.mjs 有界并发调度（保序、失败即停、进度回调）
│   ├── plugins.mjs    Provider / Judge 插件注册表
│   ├── compare.mjs    两次归因结论对比
│   ├── sampling.mjs   采样策略：固定 / 自适应提前停止
│   ├── schema.mjs     对外稳定 JSON 的映射与校验
│   └── report.mjs     Markdown + 独立 HTML 报告
├── schema/attribution.schema.json  机器可读结果契约（draft-07，核心字段冻结）
├── test/selftest.mjs  319 项离线自测
├── scripts/           发布前自检：preflight、pack-check、release-check、postpublish-check、install-check
├── examples/          演示提示词与问题集；plugins/ 为插件示例，pcause.config.example.json 为配置样例
├── docs/              演示报告（HTML / Markdown）、演示 JSON、[报告读法](docs/report.md)、[compare 指南](docs/compare.md)、[插件指南](docs/plugins.md)、[常见问题](docs/faq.md)
├── CHANGELOG.md       版本变更历史（Keep a Changelog 轻量格式）
└── package.json
```

## 8.1 自定义 Provider / Judge（插件）

不想用内置通道（mock / deepseek / doubao）时，可以用本地插件接入自己的模型、网关或判定规则：在 `pcause.config.json` 里注册模块，然后 `pcause attribute --provider <名字> --judge <名字>`。契约、配置解析、预算与缓存语义、6 个常见坑都写在 [docs/plugins.md](docs/plugins.md)。

## 9. 已知限制

- **以改动块为单位，假设各块互不依赖**：两处耦合的改动如果挨在一起，会被合并成一块，无法分开归因；更隐蔽的是，如果后一块依赖前一块引入的文字（比如前一块定义了一个术语），单独撤掉前一块会让提示词自相矛盾，此时输出变化来自「文本残缺」而不是真实因果。建议一行一条要求、避免跨块引用。
- **不检测改动之间的交互效应**：A、B 单独都没事、一起改才翻车的情况，需要组合实验（复杂度指数级），当前版本明确不覆盖。
- **`--kind` 只是提示词级适配**：它切换裁判的关注点，但不改测试问题、生成参数、采样与判定阈值，也不做结构化分维度打分；不同 kind 的结论强度不能直接横向比较。
- **测试问题决定结论**：问题覆盖不到的场景，改动会显示「无影响」。工具给的是这些问题上可测的影响，不是宇宙真理。
- **裁判也可能出错**：LLM 判定会有误判；`heuristic` 用中文双字组合 + 英文词的相似度（阈值 0.9），对改写仍可能过敏。决定性结论建议结合报告里的原文证据人工复核。
- **豆包通道需要桌面版保持登录并带调试端口运行**（`start-doubao-debug.cmd`），每次调用约 6–13 秒，依赖界面结构，可能随版本变化失效；有硬超时保护。
- **成本**：调用数 ≈ 问题数 × 采样数 × (1 + 改动块数) + 判定批次数，**裁判的模型调用也计入 `--max-calls`**。复杂提示词先用 `--dry-run` 预估，再用 `--limit` 缩小问题集。
- **JSON schema 治理**：核心字段（`meta / hunks / summary`）冻结、按语义化版本维护；新能力优先放进 `extensions`，破坏性变更需升主版本号。
- **`compare` 只比结论，不重跑实验**：两次实验之间换了模型服务商、问题集或采样数都会被拒绝（可 `--allow-incompatible` 强看，但差异可能来自实验条件）；同一句改动若改写了措辞，会被当成「消失 + 新增」。
- **并发只作用于生成阶段**：裁判与复核仍批处理串行（保证判定可解释），`--concurrency` 过大易触发限流，建议 2~4。
- **插件是可执行代码，不是沙箱**：只加载 `pcause.config.json` 里显式声明的本地模块（不做远程加载、不自动安装），但插件以你的用户权限运行，请只使用信任的插件。预算按「一次 generate / 一个判定批次 = 1 次调用」记账，插件内部自己发多次请求会超出统计口径。
- **自适应采样有截断偏倚风险**：`--early-stop` 只在含糊/高噪声时补采样，清晰落在 0 或 1 附近的块会提前截断，理论上让效应分布变窄、均值轻微偏移。需要发表级严谨结论时请关掉它（默认关闭）做满采样。

## 10. 许可

MIT
