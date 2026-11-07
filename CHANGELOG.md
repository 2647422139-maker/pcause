# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [0.29.0] - 2026-11-07

### Changed

- README 全面重写为「说人话」版本：开篇用「菜谱调味」类比说明它解决什么、用「查电路」类比说明怎么工作，把 hunk / 探针 / 噪声地板 / 反事实消融等术语收进一张「报告里的词 → 大白话」对照表；顶部保留 60 秒体验与真实输出，之后才是命令、CI、发布等进阶内容。
- 明确写出「它不做什么」（不优化提示词、不打分排名、不做回归监控），并补「适合谁 / 不适合谁」的预期校准；「与 Agent 协作」长段落压缩为一页内可读的协作概述。
- 本次只改文案与结构，不改代码行为、不自增自测项（仍 319/319）。

## [0.28.0] - 2026-11-07

### Added

- 新增 `scripts/install-check.mjs`（`npm run install:check`）：15 项「安装无关性」核对——安装到 203 字符含空格/中文的深目录、落盘安装树合规（必含 11 个文件、禁止 `.pcause/`/`test/`/`.github/`）、零依赖（安装项目只有 pcause、dependencies 为空）、不依赖全局安装（本地 `node_modules/.bin`）、PATH 隔离（仅 node 目录 + 系统目录）、不依赖 cwd、`npx --no-install` 本地解析、安装副本 `demo --json`、`PCAUSE_HOME` 211 字符中文长路径 `init`/`list`、`help` 覆盖 11 个核心命令。
- 导出可复用纯函数 `checkInstalledTree` / `minimalPath` / `longProjectPath`，并新增 9 项自测（安装树缺失/混入、两平台 PATH 构造、深长路径构造、package.json 暴露 `install:check`、发布包必含脚本、README 记录用法），总自测 319 项。
- README 新增「4.9 安装无关性核对」；`pack-check` 的发布包必含清单加入新脚本。

## [0.27.0] - 2026-11-07

### Added

- 新增 `docs/faq.md`：聚合 10 个高频问题（联网/花费、`0%` 与 `unmeasured` 的区别、两次实验结论为何不同、结果与直觉不一致先查什么、能否测 system prompt、调用量与预算控制、CI 接入与退出码、报告可信度四个信号、`PCAUSE_NO_DIFF` 的含义），每条给出判断依据而非空泛结论；README 新增「4.8 常见问题（FAQ）」入口，quickstart 增加直链。
- 新增 11 项自测（FAQ 覆盖清单、区分无影响/未测、噪声校正公式、预算三件套、CI 门禁、README 锚点真实存在、README/quickstart 双向链接），总自测 310 项。

## [0.26.0] - 2026-11-07

### Added

- 新增 `npm run release:verify`（`scripts/postpublish-check.mjs`）：发布后验证已上线包真的可用——固定官方 registry 查询版本并带重试（避开 CDN 延迟）、`npx --no-cache` 启动目标版本并精确比对版本串（避开本地缓存旧包）、跑内置 `demo --json` 并校验 JSON 可解析与关键字段、校验 README 安装命令与包名一致。退出码 0/1，`--offline` 只做离线部分。
- 决策逻辑拆成可注入依赖的纯函数（`parseViewVersion` / `checkVersionOutput` / `parseDemoJson` / `readmeInstallCommand`），新增 13 项自测覆盖假阳性/假阴性场景，总自测 299 项。

## [0.25.0] - 2026-11-07

### Changed

- README「60 秒体验」示例输出改为**真实运行结果**（仅将临时目录与随机 id 替换为占位符），并新增「看到这些说明正常」解读：两个决定性 + 一个无影响、退出码 0、临时路径与 id 每次不同、噪声地板为何是 0%（mock 确定性）、出现 `PCAUSE_*` 才是出错。
- 新增 6 项自测守护该区块（真实输出关键行、占位符、不含本机路径、正常/异常判读、噪声地板解释），总自测 286 项。

## [0.24.0] - 2026-11-07

### Added

- 新增 `docs/report.md` 报告阅读指南：顶部实验条件怎么确认、三个核心数字（原始变化率 / 噪声地板 / 校正后影响）的关系与公式、三个最易误读（0% 不是没测、第二意见一致不等于正确、影响百分比不等于业务重要性）、证据区怎么用、建议怎么落地、HTML / JSON / Markdown 的取舍。
- README 新增「4.7 报告怎么读」并链接指南；目录树同步。
- 新增 7 项自测（指南体量、三个数字、0% 语义、第二意见与未测块、schema 与 compare 链接、README 章节与链接、影响强度与重要性区分），总自测 280 项。

## [0.23.0] - 2026-11-07

### Added

- 新增 `docs/compare.md`：compare 的完整指南——实验签名包含哪些条件、签名不一致为什么默认拒绝、五种迁移状态（不变/升级/降级/新增/消失）、如何读演示结果、五个常见坑（措辞变化→消失+新增、compare 不重跑模型、verdict 相同不代表 effect 相同、unmeasured 不是无影响、CI 用 --json）、以及放进工作流的三步示例。
- README 新增「4.6 两次归因怎么比」并链接指南与真实对比演示；目录树同步。
- 新增 7 项自测（指南体量、签名与采样说明、五种状态、签名拒绝与强制开关、不重跑与未测语义、README 章节与链接、演示文件引用），总自测 273 项。

## [0.22.0] - 2026-11-07

### Added

- `pcause doctor --issue`：输出一段可直接粘进 GitHub issue 的 Markdown——按 bug 模板的四段结构（我做了什么 / 期望 / 实际报错 / 自检输出）排好，自检输出用代码块包裹，**不含密钥**。
- `src/doctor.mjs` 新增 `formatIssueReport(info)`；bug 模板改为推荐 `doctor --issue` 生成报告。
- 新增 8 项自测（命令可用、四段结构、代码块、不泄露密钥、无 undefined/null 泄漏、模板联动、CLI 接线、模块导出），总自测 266 项。

## [0.21.0] - 2026-11-07

### Added

- 新增 `docs/plugins.md` 插件开发指南：配置文件查找顺序与相对路径基准、Provider（`generate({system,user,ctx})`→string）与 Judge（`judgeBatch(pairs,ctx)`→等长 `[{changed,reason}]`）契约、预算/缓存/并发由核心统一负责的口径、调试与自测建议、6 个常见坑（ESM/CJS、路径基准、模块缓存、等长返回、stdout 污染、options 里的密钥）。
- README 新增「8.1 自定义 Provider / Judge（插件）」并链接到指南；目录树补该文档。
- 新增 7 项自测（文档存在与体量、两个契约、配置与路径基准、预算记账、ESM 坑、stderr 提醒、README 链接），总自测 258 项。

## [0.20.0] - 2026-11-07

### Added

- 新增 10 项 Windows 全路径回归测试：中文+空格路径下 `init`、含中文/空格的绝对路径 `--file`、反斜杠与正斜杠混写、带空格的相对路径、跨目录 `list`、任意 cwd 下 `doctor --json` 与 `version`、缺失文件报错保留原始路径、378 字符长路径读取、任意 cwd 下 `demo --json` 输出绝对路径。总自测 251 项。
- `docs/quickstart.md` 新增「Windows 路径提示」：中文/空格路径可直接用，建议把路径用引号包住；反斜杠与正斜杠都可以；超长路径已回归覆盖。

### 说明

- 本轮只补测试与文档，没有改变 CLI 行为；`version` 也不再依赖当前工作目录（此前已按模块位置定位 `package.json`，本轮用跨 cwd 测试锁死）。

## [0.19.0] - 2026-11-07

### Added

- 新增 `pcause doctor [--json]`：离线自检，输出 pcause 版本、Node、平台、工作区状态（是否初始化、快照与归因数）、插件配置、DeepSeek 凭据来源（**不显示内容**）、豆包桥接可用性、git 状态，并给出下一步建议。用于报 issue 前收集环境信息。
- 新增 GitHub issue 模板（`.github/ISSUE_TEMPLATE/`）：`bug_report.yml`（doctor 输出必填、命令/报错/期望/实际必填、禁截图与密钥、问题分类）、`feature_request.yml`（动机/场景/方案/备选）、`config.yml`（快速开始、demo 报告、零 Key 演示入口）。
- 新增 11 项自测（doctor 文本与 JSON、密钥不落屏、未初始化提示、issue 模板结构/必填/无 tab、help 登记），总自测 241 项。

### Fixed

- `isInitialized()` 此前只判断工作区根目录是否存在，用户随手创建一个空目录（或用 `PCAUSE_HOME` 指向空目录）就会被误判为已初始化；现在以 `prompts/` 与 `attributions/` 是否存在为标志，`initStore()` 也会把残缺目录补齐。

## [0.18.0] - 2026-11-07

### Changed

- **README 首页信息架构重整**：此前 18 个版本的「更新摘要」堆在正文之前，真正的「它解决什么问题 / 快速开始」被推到 200 行之后。现在历史摘要整体迁入 `docs/updates.md`，README 只留一行指向归档与 CHANGELOG。
- 新增「60 秒体验」区块（置顶、位于正文之前）：一句话定位、唯一前提（Node ≥ 20）、可复制的 `git clone` + `node src/cli.mjs demo` 入口、真实输出缩略（明确标注「示意」），并说明**本包尚未发布到 npm**，避免用户直接 `npx` 失败。
- 修正重复的章节编号：v1.12 的「npm 发布演练」保持 `4.4`，v1.17 的「发布到 npm」改为 `4.5`。
- 新增 `docs/quickstart.md`：60 秒体验 + 用自己提示词的命令骨架 + 常见报错排查表（Node 版本、npx 404/缓存、clone 失败、空输出、采样不足）。

### Added

- 新增 9 项自测：60 秒区块位置与内容、npm 未发布说明、输出「示意」标注、历史摘要归档完整性、README 不再堆叠摘要、归档链接、quickstart 内容，总自测 230 项。

## [0.17.0] - 2026-11-07

### Added

- 新增 `scripts/release-check.mjs`（`npm run release:check`）：发布到 npm 之前自动化可检查的部分。
  - 发布元数据：`name` / `version`（semver）/ `bin.pcause` 入口存在且 shebang 合法 / `files` 白名单 / `type=module` / `engines.node` / `license`；`repository`/`homepage`/`bugs` 缺失只警告。
  - 版本与仓库状态：工作区干净、当前提交已推送 `origin/main`、`v<version>` 标签尚未创建。
  - 产物与一致性：`npm pack --dry-run` 清单必含/禁含、`preflight`、`pack-check`；联网时额外检查 npm 登录状态（未登录只警告）与 registry 上是否已存在该版本。
  - 通过后打印 5 步人工发布清单（`npm login` → `npm publish --access public` → `npm view` 核对 → 空目录 `npx pcause@latest demo` → 打标签并推送），并明确 `npm publish` 涉及登录与 2FA、必须人工执行。
  - 支持 `--offline` / `--skip-tests` / `--skip-pack` / `--json`，退出码 0/1。
- 新增 9 项自测（git 状态解析、登录状态解析、人工步骤版本代入、离线跳过网络、JSON 可解析等），总自测 221 项。
- README 新增「4.4 发布到 npm」一节，说明为什么不能自动发布、以及首发高频坑（包名 404 不等于可注册、2FA 验证码、bin 名与大小写、registry 镜像缓存）。

## [0.16.0] - 2026-11-07

### Added

- 新增 `pcause demo`：内置演示数据（旧版/新版提示词 + 3 个探针），用 `mock` 生成器 + 启发式判定在本地跑完整归因，不联网、不需要 API Key、不改动当前工作区（产物写到系统临时目录）。
- `pcause demo --json` 输出机器可读结果（纯 JSON 走 stdout，进度日志走 stderr）。
- 7 项自测覆盖 demo：无需 init、JSON 不被污染、3 个改动块、2 决定性 + 1 无影响、临时目录产物、报告落盘、人类可读摘要；总自测 212 项。

## [0.15.0] - 2026-11-07

### Changed

- CI 矩阵从浮动标签 `ubuntu-latest` / `windows-latest` 改为固定镜像 `ubuntu-24.04` / `windows-2022`，消除 runner 跨 OS 大版本迁移导致的不可复现噪音（例如 ubuntu-latest 向 Ubuntu 26 迁移的公告）。
- workflow 注释写明固定原因、`固定标签 ≠ 镜像快照` 的边界，以及「关注 runner-images 公告 → 独立 PR 换候选标签 → 跑绿再合并」的升级节奏。
- 新增 3 项自测：矩阵必须是固定标签、不得出现 `*-latest`、workflow 注释必须包含 pin 原因与升级节奏；总自测 205 项。

## [0.14.0] - 2026-11-07

### Changed

- CI 升级 `actions/checkout@v5`、`actions/setup-node@v5`（Node 24 运行时），消除 GitHub Actions 的「Node.js 20 is deprecated」告警。
- `setup-node@v5` 显式配置 `package-manager-cache: false`：本项目零依赖、无 lockfile，缓存无收益，也避免将来加入 `packageManager` 字段后自动开启缓存引起行为变化。
- 新增 4 项自测守住 CI 配置（必须 v5、不得残留 v4 及更老、Node 版本来自矩阵、显式关闭自动缓存）与 README 记录要求；总自测 202 项。

## [0.13.0] - 2026-11-07

### Added

- 文本读入归一化模块 `src/encoding.mjs`：`stripBom` / `normalizeNewlines` / `normalizeText` / `readTextFile`。提示词文件、探针 `.jsonl`、插件配置 `pcause.config.json` 统一在读取后、业务逻辑前剥离 UTF-8 BOM 并把 CRLF / 孤立 CR 归一为 LF。
- 跨平台兼容测试（12 项）：BOM / CRLF / 组合归一、CRLF+BOM 的 `.jsonl` 探针、CRLF 输入不产生幽灵 hunk、带空格与中文的 `PCAUSE_HOME` 与提示词路径（init → snapshot → list）、CLI `snapshot --file` 回归、落盘文本无 BOM 无 CR。

### Fixed

- `pcause snapshot <id> --file <path>` 的「文件是否存在」守卫在某次行级脚本改写中被整行误删，导致文件存在时也永远报 `PCAUSE_NOT_FOUND`；已恢复守卫并补回归测试。
- JSON 配置带 BOM 时 `JSON.parse` 直接失败的问题（现在先归一化再解析）。

### Changed

- 版本升到 0.13.0。

## [0.12.0] - 2026-11-07

### Added

- 发布演练脚本 `scripts/pack-check.mjs`（`npm run pack-check`）：真的 `npm pack` → 在**独立的空临时项目**里 `npm install ./pcause-x.y.z.tgz` → 通过 `node_modules/.bin/pcause` shim 跑 `version` / `help`，并校验发布包文件清单、排除项、shebang 与版本一致（10 项检查）。
- `package.json` 的 `files` 白名单补上 `scripts/`：此前 `npm run preflight` 引用了未被打进发布包的脚本（演练发现并修复）。
- README「4.4 npm 发布演练」与 v1.12 摘要；自测新增发布演练检查（185 项）。

### Changed

- 版本升到 0.12.0。
- 已确认 `pcause` 包名在 npm registry 上未被占用（`npm view pcause` 返回 404）。

## [0.11.0] - 2026-11-07

### Added

- GitHub Actions CI（`.github/workflows/ci.yml`）：Node 20 / 22 × Ubuntu / Windows 四个组合，外加 Node 24 在 Ubuntu 上的前瞻验证；每个组合跑 `npm test`（离线自测）、`node scripts/preflight.mjs --no-tests`（版本 / badge / 链接 / 文件一致性）、`npm pack --dry-run`（发布白名单）。
- 触发规则：push 到 `main`、所有 `pull_request`、手动 `workflow_dispatch`；`permissions: contents: read` 最小权限；`concurrency` 在 PR 上取消旧运行、在 `main` 上保留历史运行。
- README 顶部 CI badge 与「4.3 持续集成」说明；README 记录 v1.11 摘要。
- 自测新增 CI 配置检查（174 项）。

### Changed

- 版本升到 0.11.0。
- 采纳讨论建议：去掉冗余的 `node --version` 步骤；不为零依赖项目启用缓存；Node 24 不全平台铺开，只在 Linux 做前瞻验证。

## [0.10.0] - 2026-11-07

### Added

- 发布前自检脚本 `scripts/preflight.mjs`（`npm run preflight`）：一次校验版本三方一致（`package.json` ↔ CHANGELOG 最新已发布条目）、CHANGELOG 无未发布段、README selftest badge 与**真实跑出来的**自测数量一致、README 本地链接与标题锚点有效、演示 / 示例文件齐全、`files` 白名单覆盖、`bin` 入口存在且 `version` / `help` 可运行。
  - 默认真的跑一遍离线自测来核对 badge 数字（`--no-tests` 跳过、`--quiet` 静默），适合放进发版 checklist 或 CI。
- `package.json` 增加 `preflight` 脚本；自测新增发布前自检检查（162 项）。

### Changed

- 版本升到 0.10.0。

## [0.9.0] - 2026-11-07

### Added

- 统一错误出口 `src/errors.mjs`：所有运行错误带稳定错误码（`PCAUSE_USAGE` / `PCAUSE_NOT_INIT` / `PCAUSE_NOT_FOUND` / `PCAUSE_INPUT` / `PCAUSE_KIND` / `PCAUSE_NO_DIFF` / `PCAUSE_PLUGIN` / `PCAUSE_ENV` / `PCAUSE_REQUEST` / `PCAUSE_EMPTY_OUTPUT` / `PCAUSE_INTERNAL` / `PCAUSE_UNKNOWN_COMMAND`）。
- 报错默认两行：「✖ [码] 一句话原因」+「提示：下一步怎么做」，只写 stderr，stdout 与 `--json` 不受影响；`PCAUSE_DEBUG=1` 才追加堆栈。
- README「错误码与自助排查」表、`--help` 的诊断与环境变量说明。
- 自测新增结构化错误检查（153 项）。

### Changed

- 退出码语义保持 0 / 1 / 2 不变；门禁命中（退出码 2）不进入错误码体系。
- `--provider` 未知时报 `PCAUSE_PLUGIN` 并列出内置通道与已配置插件。

## [0.8.0] - 2026-11-07

### Added

- 发布元数据：`repository` / `bugs` / `homepage` / `keywords` / `engines`（Node ≥ 20）。
- `files` 白名单：发布包只含 `src/`、`schema/`、`examples/`、`docs/` 与文档，本地工作区 `.pcause/`、测试脚本、插件配置不会被打进包。
- 本 `CHANGELOG.md`；README 增加版本历史入口。
- 自测新增「发布元数据与 CHANGELOG 同步」检查（141 项）。

### Changed

- 快速开始打印的消耗预估、`--kind` 与 `compare` 的预期说明继续保留（v1.7 引入）。

## [0.7.1] - 2026-11-07

### Added

- 正式运行前打印一行消耗预估：`计划：N 个改动块 × P 个探针 × 每探针 S 次 → 预计 ≤X 次模型调用（预算 Y）`。
- 明确标注预算单位是「模型请求次数」，不是 token 或金额。
- README 增加 `--kind` 大白话对照（提示词在系统中的位置，而非输出业务标签）。
- README 与 `--help` 锁定 `compare` 的预期（因果结论迁移对比，不是打分评测）。
- 快速开始增加 `--provider mock` 的零 Key 离线上手路径。

### Changed

- `pcause version` 改为从 `package.json` 读取版本号，不再硬编码。

## [0.7.0] - 2026-11-07

### Added

- `--kind prompt|system|agent` 从报告元标签升级为**判定维度适配**：`system` 追加角色边界 / 安全拒答 / 工具权限 / 输出格式刚性 / 上下文隔离维度；`agent` 追加任务达成度 / 工具调用策略 / 终止条件 / 状态延续 / 副作用风险维度；`prompt` 判定提示词逐字不变。
- 报告 Markdown / HTML 披露「判定维度」与假设可信度。

## [0.6.0] - 2026-11-07

### Added

- `--early-stop` + `--min-samples`：自适应采样提前停止。决策只用未校正的原始变化率，阈值固定（10%~70% 含糊区间、噪声地板 15%），校正发生在决策之后。
- 报告与 `--json` 披露采样策略、提前停止的改动块、补采样次数（`samplesUsed` / `extended`）。

## [0.5.0] - 2026-11-07

### Added

- Provider / Judge 插件注册表：`pcause.config.json` + 动态 import，插件与内置通道共用预算、缓存、报告与调用记账（一次 `generate` 或一个判定批次记 1 次调用）。
- `--config <file>` 与 `examples/plugins/` 示例。

## [0.4.0] - 2026-11-07

### Added

- `--concurrency <n>`：生成阶段有界并发（保序、失败即停调度、进度回调）；预算按发起前预占，并发下不会超支。

## [0.3.0] - 2026-11-07

### Added

- `pcause compare <attrA> <attrB>`：归因结论迁移对比。实验签名（探针集 / 采样数 / 生成器 / 判定器 / kind）一致才允许对比，按「类型 + 旧行 + 新行」内容对齐改动块，输出不变 / 升级 / 降级 / 新增 / 消失与影响强度差值。

## [0.2.0] - 2026-11-07

### Added

- `--dry-run` 预估调用量与预算、预算耗尽时把未测完的块标为 `samplingInsufficient` / `unmeasured`。
- `--fail-on decisive|partial` CI 门禁（退出码 2）、`--json` / `--json-out` 稳定 JSON schema 与 `pcause schema` 导出。
- 采样噪声地板与校正后的 effect、`--verify` 异构模型第二意见。

## [0.1.0] - 2026-11-06

### Added

- 初始版本：`init` / `snapshot` / `list` / `diff` / `run` / `attribute` / `report` / `selftest`。
- 行级 LCS diff 拆分改动块（hunk）、逐块反事实回退、探针上的行为变化判定、Markdown / 独立 HTML 报告。
