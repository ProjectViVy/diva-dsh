# verification · v0.3.0

## 验证了什么

| 项 | 方法 | 结果 |
| --- | --- | --- |
| 两仓功能面 | 5 个子代理只读盘点，逐条 `路径:行号` | ✅ 完成，交叉引用可复核 |
| 本机外部应用 | `Test-Path` 实测 Blender/ComfyUI/剪映/RetroArch/Minecraft/OBS | ✅ 全部未安装 |
| 本机工具链 | `node -v` / `python --version` / `uv --version` | ✅ v24.14.1 / 3.13.12 / 0.11.7 |
| DSH MCP 桥约束 | 读 `mcp-client/README.md` + `src/index.ts` | ✅ 命名/超时/指令上限/空 scope/task 未实现 |
| 租约做法 | 子代理读 DSH jobs/approval、grok-build、Alife、本仓架构 | ✅ 有实现证据（带行号） |
| 四宿主 MCP 端到端 | `server-everything` + 临时配置隔离 | ✅ 能连 4/4；Codex 调通；Claude/pi 卡凭证 |

## 没有验证的

- 任何工作台实例的实际运行（全部为读代码/读文档）。
- 淋雨家 MCP 开关的真实生效方式。
- 任何游戏、Blender、ComfyUI 的实际接线。
- PENS 自身的任何运行时（其仓库尚无实现）。
- Claude Code 与 pi 的实际工具调用（既有凭证 401，按约束未改用户配置、未交互登录）。

## 口径声明

- 子代理报告中「判断」与「事实」已分别标注；本日志未把 C 级判断升格为事实。
- 「生态没人做租约过期」是 4 个实现的抽样结论，不是全域普查。
