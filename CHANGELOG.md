# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

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
