# 更新日志

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)，格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

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
