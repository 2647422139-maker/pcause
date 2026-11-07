# pcause 快速开始

> 30 秒理解 + 60 秒跑起来。原理、命令全表与限制见 [README](../README.md)。

## 一句话

改完提示词效果变好，但不知道是**哪一句**起的作用？pcause 把新版逐块回退、在同组测试输入上重跑、再用异构模型判定输出是否发生实质变化，测出每处改动的真实影响——不是猜。

## 60 秒体验（零 Key、零网络）

前提：Node.js ≥ 20（`node -v`；推荐 LTS）。本包**尚未发布到 npm**，所以先用仓库入口：

```bash
git clone https://github.com/2647422139-maker/pcause.git
cd pcause
node src/cli.mjs demo
```

它会用内置的「旧/新提示词 + 3 个探针」，以 mock 生成器 + 启发式判定跑一次完整归因：不联网、不需要 API Key、不写你的工作区（产物在系统临时目录）。输出会告诉你哪块改动决定性、哪块无影响，以及报告路径（Markdown + HTML）。

机器可读结果：`node src/cli.mjs demo --json`（stdout 只有 JSON）。

发布到 npm 之后，同样的体验可以写成 `npx pcause demo`。

## 用你自己的提示词

```bash
node src/cli.mjs init                                     # 初始化 .pcause/ 工作区
node src/cli.mjs snapshot v1 --file old-prompt.md         # 旧版提示词
node src/cli.mjs snapshot v2 --file new-prompt.md         # 新版提示词
node src/cli.mjs attribute --old v1 --new v2 --probes probes.jsonl --dry-run   # 先看预估消耗
node src/cli.mjs attribute --old v1 --new v2 --probes probes.jsonl \
  --provider deepseek --model deepseek-flash --judge deepseek --verify doubao \
  --samples 3 --min-samples 2 --early-stop --concurrency 4
```

`probes.jsonl` 一行一条测试输入（支持 `.jsonl` / `.json` 数组 / 纯文本一行一条）。真实模型调用需要 `DEEPSEEK_API_KEY`（环境变量或 `~/.dsh/.credentials.yaml`）；豆包复核通道复用桌面版登录，无需 Key。

## 常见问题

| 现象 | 原因与处理 |
| --- | --- |
| `node: command not found` 或语法报错 | Node < 20。升级到 LTS：`node -v` 应 ≥ 20 |
| `npx pcause` 提示 404 | 本包还没发布到 npm。请用 `git clone` + `node src/cli.mjs ...` |
| `npx` 拉到旧版本 | npx 有本地缓存：`npx --yes pcause@latest --version`，或清缓存后重试 |
| `git clone` 卡住/失败 | 网络问题：换镜像或代理；也可以直接下载仓库 ZIP 解压后 `node src/cli.mjs demo` |
| 真实归因报 `PCAUSE_EMPTY_OUTPUT` | 模型把预算耗在思考内容上；加大 `--max-calls`/降低 `--samples`，或换非思考模型 |
| 报告里某块「采样不足」 | 预算被提前耗尽：提高 `--max-calls`，或减少探针/采样数；「采样不足」不等于「无影响」 |

### Windows 路径提示

pcause 的路径参数支持含空格、含中文的绝对/相对路径；反斜杠与正斜杠都认。如果路径里有空格，用引号包一下最稳：

```powershell
node src/cli.mjs snapshot my-prompt --file "C:\我的 提示词\v1.md"
```

超过 260 字符的长路径也已纳入回归测试（Windows 10+ / Node 20+ 可正常读写）。

报 bug 前先跑：`node src/cli.mjs doctor --issue`（发布后 `npx pcause doctor --issue`）——它会直接生成一段可粘贴进 issue 的 Markdown（四段结构 + 自检输出，不含密钥）；只看自检用 `node src/cli.mjs doctor`——它会输出 pcause/Node/平台/工作区/通道可用性，**不含密钥**，把整段贴进 issue 即可。

找不到答案时：先看[常见问题 FAQ](faq.md)（联网/花费/0% 含义/两次结论不同/CI 接入都在里面）。

`node src/cli.mjs help`、README 的 [错误码自查表](../README.md#41-出错时怎么办错误码与自助排查v19)，或提 issue 并附上 `node src/cli.mjs version` 与报错原文。
