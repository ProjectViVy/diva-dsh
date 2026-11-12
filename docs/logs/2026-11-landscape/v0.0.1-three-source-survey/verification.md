# 验证记录 v0.0.1 三源工作台调研

> 只写事实：命令、预期、实际。本轮为纯文档调研，没有可跑的代码验证。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git clone https://github.com/mashanglinyu/luanyujia-workbench .workspace\luanyujia-workbench` | 落地并可读 | 成功；HEAD `ee87f1c`（2026-11-04），224 文件 / 44.55 MB，工作区干净 |
| 2 | `git clone https://github.com/ProjectViVy/pens .workspace\pens` | 落地并可读 | 成功；HEAD `bf76d55`（2026-09-29），3 个跟踪文件 |
| 3 | `git -C .workspace\luanyujia-workbench rev-list --count HEAD` | 提交数 | 73 |
| 4 | `git -C .workspace\pens log --format='%h %ad %s' --date=short` | 提交历史 | 2 条，同日 2026-09-29（初始化 + 决策记录） |
| 5 | `git -C .workspace\reference\Alife remote -v` / `log -1` | 确认来源与 HEAD | `BDFFZI/Alife` · `0707f04` 2026-11-01 · 585 文件 / 5.4 MB（浅克隆） |
| 6 | `git -C .workspace\reference\grok-build remote -v` / `log -1` | 同上 | `xai-org/grok-build` · `2bdd1d6a` 2026-09-29 · 4515 文件 / 140.6 MB |
| 7 | `Invoke-RestMethod https://api.github.com/orgs/ProjectViVy/repos?per_page=100` | 组织仓库目录 | 返回 10 个公开仓（diva-dsh / agent-diva / laputa / agent-vivy / vivy-whitepaper / hare / vivy-bundle / pens / agent-diva-docs / .github） |
| 8 | `Get-Content .gitmodules -Raw` | 确认 submodule 数与来源 | 19 项：3 上游（superagent、deepseek-harness、plugins/surfcore）+ 15 本地（含 stage-app）+ 1 第三方（third-party/dsh-context） |
| 9 | 读 `docs/architecture.md`（1–160 行 + §2 全部） | 六条核心决策可引用 | 已读，报告 §3 逐条转述 |
| 10 | 读淋雨家 7 个关键文档（README/总纲/_索引/00-核心机制/08-五步法/12-源码照搬/记忆约定） | 结构与机制可复述 | 已读，报告 §4 与 §2.3 引用 |
| 11 | 读 PENS 3 个文件全文（README 33 行 / DECISIONS 144 行 / REFERENCES 37 行） | 逐条决策可引用 | 已读，报告 §5 全文解读 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 淋雨家 Electron 外壳在 `0.2.1-rc.5` 上启动 | 需 `npm install`（Electron 体积大）+ 一个 DSH 引擎副本，且会占用端口 3083；本轮只做调研 | 用户拍板 D1=C 时再跑 |
| 淋雨家 `场景记忆.mjs list/check` | 需工作台数据目录，本机没有 | 同上 |
| mnemos 安装与 `pytest` | 已有 `mnemos-deep-dive.md` 结论，本轮不重复 | 用户要求落地时 |
| Alife 编译运行 | .NET 10 + Windows 宿主，非本轮目标 | 需要 IM 网关参考实现时 |
| grok-build 编译运行 | 185 万行 Rust，非本轮目标 | 不需要 |
| 淋雨家「免费 AI 桥」实机 | 需要网页版 AI 账号与会话 | 用户提出接入需求时 |

## 反向验证（可选）

无代码改动，未做。报告 §11 末单列「未核实项」6 条，作为对「结论边界」的自检。
