# pcause 更新摘要（归档）

> 本文件收录 README 中移出的各版本更新摘要，按时间倒序。
> 机器可读的版本变更见 [CHANGELOG.md](../CHANGELOG.md)；最新摘要见 [README](../README.md#更新日志)。

## v1.19 更新摘要

报 bug 时最贵的不是修，而是来回追问环境。

- 新增 `pcause doctor [--json]`：一条离线命令输出 pcause 版本、Node 版本、平台、当前工作区（是否初始化/快照与归因数）、插件配置、DEEPSEEK_API_KEY 是否可用（只显示来源，不显示内容）、豆包桥接是否找到、git 分支与是否干净，并给出可执行的下一步建议。
- 新增 GitHub issue 模板：`bug_report.yml`（先跑 doctor 并粘贴输出、必填命令/报错/期望/实际、限定不截图与不放密钥、按「程序问题 / 结论异常 / 环境」分类）、`feature_request.yml`（动机与方案）、`config.yml`（快速开始与 demo 报告入口）。
- 修正 `isInitialized()`：此前只看工作区根目录是否存在，用户随手建一个空目录就会被当成已初始化；现在以 `prompts/` 与 `attributions/` 存在为标志。
- 新增 11 项自测（doctor 文本/JSON、密钥不落屏、未初始化提示、模板结构与必填项、help 登记），总自测 241 项。

## v1.18 更新摘要

首页该先让人跑起来，再讲历史。此前 18 个版本的「更新摘要」堆在正文之前，真正的「它解决什么问题 / 快速开始」被推到 200 行之后。

- 历史摘要整体迁入本文件，README 只留一行指向归档与 [CHANGELOG](../CHANGELOG.md)。
- 新增「60 秒体验」区块并置顶：一句话定位、唯一前提（Node ≥ 20）、可复制的 `git clone` + `node src/cli.mjs demo`、真实输出缩略（标注「示意」），并说明**本包尚未发布到 npm**，避免直接 `npx` 失败。
- 修正重复章节号：v1.12「npm 发布演练」保持 `4.4`，v1.17「发布到 npm」改为 `4.5`。
- 新增 [quickstart.md](quickstart.md)：60 秒体验 + 自己的提示词命令骨架 + 常见报错排查表。
- 新增 9 项自测，总自测 230 项。

## v1.17 更新摘要

发布到 npm 之前，能自动检查的部分不再靠人肉清单。

- 新增 `scripts/release-check.mjs`（`npm run release:check`）：一条命令跑完发布前的自动化检查——发布元数据（name/version/bin/files/type/engines/license）、bin 入口与 shebang、repository/homepage/bugs、工作区是否干净、当前提交是否已推送、`v<version>` 标签是否尚未占用、`npm pack --dry-run` 清单必含/禁含、preflight、pack-check，以及（联网时）npm 登录状态与 registry 上是否已存在该版本。
- **边界要诚实**：`npm publish` 本身要登录与 2FA，脚本不会替你发布。它会打印 5 步人工清单：`npm login` → `npm publish --access public` → `npm view pcause version` 核对 → 空目录 `npx pcause@latest demo` 装包验证 → 打标签并推送。
- 支持 `--offline`（跳过网络检查，CI/无网环境可跑）、`--skip-tests`、`--skip-pack`、`--json`；未登录 npm 只警告、不算失败——发布前检查不该因为「还没登录」就失败。
- 新增 9 项自测（git 状态解析、登录状态解析、人工步骤版本代入、离线跳过网络、JSON 可解析等），共 **221/221 项**通过。

## v1.16 更新摘要

第一次体验不该先要 API Key。

- 新增 `pcause demo`：内置一套「旧版/新版提示词 + 3 个探针」的演示数据，用 `mock` 生成器 + 启发式判定在本地跑一次完整归因，**不联网、不需要 API Key、不改动当前工作区**（产物全部写到系统临时目录）。
- 输出可直接看懂：哪一块改动决定性（100%）、哪一块纯属备注（0%），并列出一份 Markdown / HTML 报告路径。
- `pcause demo --json` 输出机器可读结果（纯 JSON 走 stdout，进度日志不污染解析）；跑完把临时工作区路径告诉你，可以继续 `pcause report`、`pcause compare` 等命令研究。
- 新增 7 项自测：demo 无需 init 即可跑、JSON 不被日志污染、恰好 3 个改动块、结论为「2 决定性 + 1 无影响」、产物在系统临时目录、Markdown/HTML 真的落盘、人类可读输出含下一步提示。

## v1.15 更新摘要

CI 的可复现性：不再追 `ubuntu-latest` / `windows-latest` 这类浮动标签，改为固定显式镜像，消除「同一 commit 两次跑结果不同」的迁移噪音。

- 矩阵改为 `ubuntu-24.04` + `windows-2022`（Node 20/22；Node 24 仍只在 Ubuntu 上前瞻）。
- 为什么不用 `windows-2025`：它内部仍在滚动 VS 版本，预装工具变动更频繁；`windows-2022` 绑定 VS2022，对零依赖 Node CLI 更稳。
- 关键澄清（豆包提醒）：**固定标签 ≠ 固定镜像快照**。GitHub 仍会在同一标签内滚动更新预装工具，pin 只能挡住「跨 OS 大版本迁移」，挡不住镜像内的小幅 drift。
- 升级节奏写进 workflow 注释：① 关注 `actions/runner-images` 的 deprecation/brownout 公告；② 需要新预装工具或安全修复时，在独立 PR 里把标签换成候选版本、跑绿再合并，而不是等 EOL 救火。
- 新增 3 项自测：矩阵必须是固定标签、不得出现 `*-latest`、workflow 注释必须写清 pin 原因与升级节奏。

## v1.14 更新摘要

把自己的 CI 捡干净：`actions/checkout@v4` / `actions/setup-node@v4` 已在 GitHub 官方告警里被强制跑在 Node 24 上（Node 20 弃用），升级到 `@v5` 并**验证告警真的消失**，而不是只看「CI 绿了」。

- 升级 `actions/checkout@v5`、`actions/setup-node@v5`（两者都跑在 Node 24 运行时；要求 runner ≥ v2.327.1，GitHub 托管 runner 天然满足，自托管才需要注意）。
- `setup-node@v5` 默认会在检测到 `packageManager` 字段时自动开 npm 缓存。本项目零依赖、无 lockfile，缓存毫无收益，因此显式写 `package-manager-cache: false`，避免将来有人加了字段后缓存行为悄悄变化。
- `node-version` 仍由矩阵下发（`${{ matrix.node }}`），矩阵本身不变：Node 20/22 × ubuntu/windows + Node 24 仅 ubuntu 前瞻。
- 新增 5 项自测守住 CI 配置：必须用 v5、不得残留 `checkout/setup-node@v4` 及更老版本、Node 版本仍来自矩阵、显式关闭自动缓存；README 必须记录本版本。
- 验证方式：提交后看新 run 的 **Annotations** 面板（不再有 Node 20 deprecated 黄色注解），并在原始 job 日志里搜索 `Node.js 20 is deprecated` 确认零命中。

## v1.13 更新摘要

跨平台兼容：把「Windows 上路径 / 中文 / 换行」这类只在别人机器上炸的问题，变成每次都跑的离线测试。

- **读入层统一归一化**：新增 `src/encoding.mjs`（`stripBom` / `normalizeNewlines` / `normalizeText` / `readTextFile`）。所有文本入口（提示词文件、探针 `.jsonl`、插件配置 `pcause.config.json`）在「读文件之后、业务逻辑之前」剥离 UTF-8 BOM、把 CRLF 与孤立 CR 统一成 LF，避免幽灵 hunk、指纹漂移、BOM 让 `JSON.parse` 直接失败。
- **diff 不再被换行差异污染**：`splitLines` 走同一套归一化，同一份提示词用 CRLF 保存或用 LF 保存，得到**完全相同**的 hunk；旧实现只是替换 CRLF，BOM 仍会变成第一个字符差。
- **真实 bug**：`pcause snapshot <id> --file <path>` 的「文件存在性守卫」在某次行级脚本改写中被整行误删，导致文件明明存在也永远报 `PCAUSE_NOT_FOUND`。已修复，并加两条回归测试（存在的文件能读、文件确实不存在时仍正确报错）。
- **路径形态**：测试覆盖 `PCAUSE_HOME` 与提示词文件位于「带空格 + 中文」的目录下的完整链路（init → snapshot → list），以及中文路径工作区的快照读取。
- 自测 **197/197**（新增 12 项：BOM 剥离、换行归一、组合归一、CRLF+BOM 读文件、BOM JSON、CRLF+BOM `.jsonl` 探针、CRLF 不产生幽灵 hunk、中文空格路径 init、snapshot --file 回归、落盘归一化、中文路径 list、缺文件报错回归；v1.14 起为 212/212）。

## v1.12 更新摘要

发布演练：不再只相信「本地 `npm test` 绿了」，而是**真的打一个包、装进一个空的临时项目、用用户的方式运行它**。

- 新增 `scripts/pack-check.mjs`（`npm run pack-check`）：`npm pack` → 独立空目录 `npm install ./pcause-x.y.z.tgz` → 通过 `node_modules/.bin/pcause` 这个 shim 跑 `version` / `help`，再直接 `node` 跑包内 CLI，两条路径都要通。
- **真的抓到了 bug**：`package.json` 的 `files` 白名单漏了 `scripts/`，而 `package.json` 的 `preflight` 脚本又引用了 `scripts/preflight.mjs` —— 本地没事，装完 `npm run preflight` 会找不到文件。演练当场失败，修复后 10/10 通过。
- 顺带校验：发布包必须含 `src/cli.mjs` / `schema/` / `examples/` / `docs/` / `CHANGELOG.md` / `LICENSE` / `scripts/`；绝不能含 `.pcause/`、`test/`、`.github/`、`node_modules/`；安装包里的 bin 必须有合法 shebang（`.gitattributes` 已强制 `.mjs` 用 LF，避免 Windows 下 CRLF 破坏 `#!`）。
- 名字可用性：`npm view pcause` 返回 404，说明 `pcause` 这个包名还没有被占用（真要发布仍需 `npm login` + `npm publish`，本仓库未执行发布）。
- 自测 **185/185**（新增 11 项：路径归一、必含清单、缺文件/混入检测、shebang 兼容 LF/CRLF、演练 10/10、独立目录安装、shim 与直连云；v1.13 起为 197/197）。

## v1.11 更新摘要

持续集成：把「本地能过」升级成「每个平台、每个 Node 版本都能过」，并且不再靠人工记得跑。

- **矩阵**：Node 20 / 22 × Ubuntu / Windows 共 4 个组合，外加 Node 24 在 Ubuntu 上的前瞻验证（避开 Windows + 24 偶发的 runner 不稳定）；`fail-fast: false`，一个组合失败不影响其他组合出结果。
- **离线即可验证**：CI 里跑 `npm test`（离线自测）、`node scripts/preflight.mjs --no-tests`（版本 / badge / 链接 / 文件一致性）、`npm pack --dry-run`（发布白名单）；**不需要任何密钥，不联网调模型**。
- **按需触发**：push 到 `main`、所有 PR、手动 `workflow_dispatch`；`permissions: contents: read` 最小权限；`concurrency` 让 PR 上的新推送取消旧运行，而 `main` 上的运行保留便于追踪。
- **零依赖不做缓存**：没有 lockfile / node_modules，加缓存只有开销没有收益。
- 踩过的坑（豆包建议采纳）：`node --version` 这类步骤是日志噪音，删掉；Node 24 全平台铺开性价比低；`npm pack --dry-run` 不校验 `exports`，本仓库只暴露 `bin` 所以足够。
- 状态徽章：README 顶部新增 CI badge，点开即最近一次矩阵运行。
- 自测 **174/174**（新增 12 项：workflow 存在、触发规则、矩阵版本与平台、最小权限、并发策略、三步检查、无密钥引用、无 tab 缩进、README CI badge 与 v1.11 记录；v1.12 起为 185/185）。

## v1.10 更新摘要

发布前自检（`npm run preflight`）：把「对外可见的信任点」一次性校验掉，避免发版时 README / 版本 / CHANGELOG 互相打架。

- **版本一致性**：`package.json` 版本 = CHANGELOG 最新**已发布**条目（正确跳过 `[Unreleased]`），并检查 CHANGELOG 覆盖初始版本。
- **badge 不说谎**：默认真跑一遍离线自测，把 README 里的 `selftest-N/N` 和实际通过数逐字比对；同时扫描 README 里残留的旧总数（防止更新时漏改）。
- **链接不悬空**：README 的本地链接目标必须存在；带 `#锚点` 的 Markdown 链接会用 GitHub 风格 slug 校验标题真实存在（HTTP 外链不做联网检查，保持离线）。
- **承诺文件齐全**：`docs/demo-*`、`schema/`、`examples/`、`LICENSE` 等 README 里承诺存在的文件必须都在；`package.json` 的 `files` 白名单必须覆盖 `src/schema/examples/docs`；`bin` 入口能跑 `version` / `help`。
- 用法：`npm run preflight`（默认含自测，约数秒）；`node scripts/preflight.mjs --no-tests --quiet` 只做静态检查。失败时逐项列出原因并退出码 1。
- 自测 **162/162**（当时计数；新增 9 项：版本解析跳过 Unreleased、badge 两种写法解析、自测输出解析、本地链接提取、标题 slug、本仓库 preflight 通过；v1.11 起为 174/174）。

## v1.9 更新摘要

可诊断轮：不再只给「✖ 出错了」，而是给**能自助排查的两行**（错误码只用于诊断，退出码 0 / 1 / 2 语义不变）。

- **统一错误出口** `src/errors.mjs`：所有运行错误带稳定错误码，例如 `PCAUSE_NOT_FOUND`（文件/快照/归因不存在）、`PCAUSE_INPUT`（探针文件格式错）、`PCAUSE_KIND`（`--kind` 拼错）、`PCAUSE_NO_DIFF`（两份提示词没差异——这是正常结果，明确说明）、`PCAUSE_PLUGIN`（未知 provider）、`PCAUSE_ENV`（缺 Key / 找不到豆包桥接）、`PCAUSE_REQUEST`（模型请求失败，多半可重试）、`PCAUSE_EMPTY_OUTPUT`（思考模型把预算用光）、`PCAUSE_INTERNAL`（内部不一致，建议反馈）、`PCAUSE_UNKNOWN_COMMAND`。
- **报错只写 stderr、stdout 零污染**：默认输出「✖ [PCAUSE_xxx] 一句话原因」+「提示：下一步怎么做」；`--json` 输出的 stdout 仍然可以直接 `JSON.parse`。
- **调试开关**：`PCAUSE_DEBUG=1` 才追加堆栈（默认隐藏内部细节）；`--help` 新增「出错时的诊断」与 `PCAUSE_CONFIG` / `PCAUSE_DEBUG` 说明。
- 自测 **153/153**（新增 12 项：码格式、堆栈开关、未初始化 / 缺探针 / 未知 provider / 无差异 / 未知命令的码与退出码、stdout 不被污染、help 披露调试开关；v1.10 起为 162/162，v1.11 起为 174/174）。

```text
✖ [PCAUSE_NOT_FOUND] 找不到探针文件：nope.jsonl
  提示：探针文件支持 .json 数组、.jsonl 或纯文本一行一个输入；检查路径与拼写
```

## v1.8 更新摘要

工程化 / 可发布轮：让「安装、发版、追溯」三件事规范化（不改任何判定与采样逻辑）。

- **发布元数据补齐**：`repository` / `bugs` / `homepage` / `keywords` / `engines`（Node ≥ 20）。
- **`files` 白名单**：发布包只含 `src/`、`schema/`、`examples/`、`docs/`、README、CHANGELOG、LICENSE；本地 `.pcause/` 工作区、测试脚本与 `pcause.config.json` 不会被打进包。
- **CHANGELOG.md**：按 Keep a Changelog 轻量格式记录 0.1.0 → 0.8.0 的全部变更；发版时同步版本号。
- **演示产物刷新**：`docs/demo-report.{md,html}` 与 `docs/demo-attribution.json` 用当前模板重新导出（含「判定维度」「采样策略」「采样披露」行）。
- 自测 **141/141**（新增 9 项：engines、files 白名单、元数据、CHANGELOG 覆盖与版本同步、README 入口、LICENSE；v1.9 起为 153/153）。

## v1.7 维护轮更新摘要

首次使用者的三处「预期错位」被提前拦住（功能不变，只改提示与文档；`version` 改为从 `package.json` 读取，避免再出现硬编码版本号）：

- **预算单位显式化**：正式运行前先打印一行 `计划：N 个改动块 × P 个探针 × 每探针 S 次 → 预计 ≤X 次模型调用（预算 Y）`，并紧跟一句「预算单位是模型请求次数，不是 token 或金额；命中缓存会少于预估」。自适应采样同时给出调用量区间，不再让人以为 `--max-calls` 是金额。
- **kind 的大白话对照**：README 明确 `--kind` 描述的是提示词在系统中的**位置**（任务提示词 / 系统提示词 / Agent 指令），不是给输出打业务标签；选错会让判定维度错配。
- **compare 的预期锁定**：README 与 `--help` 都写明它不做「两次回答谁更好」的打分对比，只回答「同一个改动块的影响这次是否还成立」。
- **零 Key 上手路径**：快速开始增加 `--provider mock` 的离线跑通命令，装完先看报告长什么样，再决定是否接真模型。
- 自测当时为 **132/132**（v1.8 起为 141/141）。

## v1.6 更新摘要

`--kind` 从「报告元标签」升级为**判定维度适配**：判定器按归因对象类型换用不同的判定重点（`--kind prompt` 的判定提示词逐字不变，历史行为与缓存不受影响）。

- **system（系统提示）**：看「守不守规则」——角色边界、安全拒答、工具与权限约束、输出格式刚性、上下文隔离；同时要求把「规则内的合理变通」「异常分支返回错误文本」「拒答措辞差异」判为无行为变化。
- **agent（Agent 指令）**：看「活有没有干对」——任务达成度、工具调用策略、终止条件、状态与上下文延续、副作用风险；并明确多步探索 / 多次工具调用本身不算失败。
- 判定维度同时写进 Markdown / HTML 报告的「判定维度」行，审阅时知道这一轮用的是哪套眼镜。
- 判定提示词按 kind 分流后，模型通道的内容寻址缓存天然按 kind 分开，不会串用。
- 自测当时为 **126/126**（v1.7 起为 132/132）。

```bash
pcause attribute --old start-v1 --new start-v2 --probes probes.jsonl \
  --kind system --provider deepseek --judge deepseek --verify doubao --samples 2
```

## v1.5 更新摘要

采样支持**自适应提前停止**：`--early-stop` + `--min-samples <n>`。先测 min 次；只有当「未校正的原始变化率落在 10%~70% 的含糊区间」或「噪声地板 ≥15%」时才补采样到 `--samples` 次，清晰为 0 / 1 的块直接停止。

```bash
pcause attribute --old triage-v1 --new triage-v2 --probes examples/probes.jsonl \
  --provider deepseek --model deepseek-flash --judge deepseek --verify doubao \
  --samples 3 --min-samples 2 --early-stop --concurrency 4
```

- **省调用**：清晰块的判定在 min 次采样时就已稳定，不必为每一块都付出满采样成本；`--dry-run` 会给出调用量「下限（全部提前停止）～上限（全部补采样）」。
- **不引入循环反馈**：停止判断只用**未校正的原始变化率**，噪声校正在采样决策之后进行（用校正值做决策会让方差更大的估计反过来影响采样）。
- **阈值固定、不事后调**：含糊区间 10%~70%、噪声地板 15% 写死在 `src/sampling.mjs`，避免「看结果再调阈值」。
- **如实披露**：报告与 `--json` 写明采样策略、哪些块提前停止、哪些块补采样、每块实际采样次数（`samplesUsed` / `extended`），并提示截断偏倚风险。
- 自测当时为 **113/113**（v1.6 起为 126/126）。

## v1.4 更新摘要

新增 **Provider / Judge 插件注册表**：在项目根放一个 `pcause.config.json`，就能把自建或私有通道接进归因循环——记账、缓存、预算、报告与内置通道走同一套核心逻辑。

```json
{
  "provider": { "echo-system": { "module": "./plugins/echo-system-provider.mjs", "options": { "prefix": "" } } },
  "judge":    { "exact":       { "module": "./plugins/exact-judge.mjs",       "options": {} } }
}
```

```bash
pcause attribute --old review-v1 --new review-v2 --probes examples/probes.jsonl \
  --provider echo-system --judge exact --config ./pcause.config.json
```

插件契约只有两个方法：

- Provider：`export default function (options) → { generate({ system, user, ctx }) → Promise<string> }`
- Judge：`export default function (options) → { judgeBatch(pairs, ctx) → Promise<[{ changed, reason }]> }`

`ctx` 只含只读的 `{ kind, name, configFile, options }`，不暴露核心状态。**预算与缓存由核心统一负责**：一次 `generate` / 一个判定批次记 1 次调用，插件内部不要自行重试放大调用量；插件名不能覆盖 `mock / deepseek / doubao / heuristic` 等内置通道；只加载配置里显式声明的本地模块，不做远程加载。可运行示例见 [`examples/plugins/`](examples/plugins/) 与 [`examples/pcause.config.example.json`](examples/pcause.config.example.json)（离线、确定性）。自测现为 **94/94**（新增 14 项插件断言：注册、加载、缓存、预算、错误路径、CLI 集成）。

## v1.3 更新摘要

生成阶段支持**有界并发**：`--concurrency <n>`（默认 1）。

- **快而可控**：归因最耗时的是「探针数 × 采样数 × (1 + 改动块数)」次生成。`--concurrency 4` 让最多 4 个请求同时在飞，单轮耗时通常降到 1/2~1/3，并打印完成进度。
- **预算仍是硬上限**：`--max-calls` 在**发起请求前预占**，并发再高也不会超支；代价是预算紧张时可能比串行更早停下（报告把未测完的块标为「采样不足」，不会误当「无影响」）。
- **顺序不变、可复现**：每个任务按 `(探针序号, 采样序号)` 固定落位，并发与否得到同一份结论；任一请求失败会立即停止调度新任务，不会雪崩式烧钱。
- **重跑不重复花钱**：所有请求走同一份内容寻址缓存（`.pcause/cache`），中断后重跑只补没跑完的采样点。
- 自测新增 11 项并发断言（并发上限、结果保序、失败停止调度、并发下预算不超支、CLI 接受该参数），现为 **80/80**。

## v1.2 更新摘要

新增 **`pcause compare <attrA> <attrB>`：归因结论迁移对比**。同一处提示词改动，两轮实验的结论从「无影响」变成「决定性」了吗？交给两轮实验、各自带噪声校正的结论去回答，而不是靠回忆。

- **签名一致性校验（默认拒绝）**：对比前校验探针集合、每探针采样次数、生成器（名称/模型/温度）、判定器与复核器、归因对象类型；任一不同（如两次实验换了模型或采样数）就报错退出，避免把「实验条件差异」误读成「因果结论变化」。确需对比时用 `--allow-incompatible`，输出会明确标注结论仅作参考。
- **按内容对齐改动块**：h1..hn 是按顺序编号的，提示词插入一行就会整体错位；compare 用「类型 + 旧行 + 新行」内容做主键对齐，只比较同一个改动块的前后结论。
- **迁移状态一目了然**：不变 / 升级 / 降级 / 新增 / 消失，附影响强度差值（pt）、`verdictChanged` 标记、Markdown 与 `--json` 两种输出，适合放进版本发布说明或 CI 的回归检查。
- 演示产物：[`docs/compare-demo.md`](docs/compare-demo.md)、[`docs/compare-demo.json`](docs/compare-demo.json)（两次真实实验：签名一致，3 个改动块结论全部不变）。

## v1.1 更新摘要

围绕「让结论更可信、让 CI 能接入、让机器能消费」做了四项加固（判定与采样内核逻辑不变）：

- **`--kind prompt|system|agent`**：标注归因对象类型，报告首页固定展示三条免责声明（假设 / 约束 / 泛化），并按类型静态提示假设可信度（系统提示、Agent 指令为「较低」）。
- **`--dry-run` 预演**：不读 API Key、不发任何请求，只预估调用次数与预算是否够；运行中预算耗尽时不再静默中止，而是把未测完的改动块标为 `sampling_insufficient` / `unmeasured`。
- **`--fail-on decisive|partial` CI 门禁**：命中则退出码 2；采样不足的块不参与门禁，避免把「样本不够」误当「破坏性变更」而错误阻断流水线。
- **稳定机器可读输出**：`--json` / `--json-out` 输出符合 `schema/attribution.schema.json`（draft-07，核心字段冻结，插件数据只能放 `extensions`），`pcause schema` 可直接导出 schema。

---
