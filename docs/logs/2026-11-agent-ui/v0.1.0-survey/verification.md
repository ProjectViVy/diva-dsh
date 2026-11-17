# Agent UI 协议调研 · v0.1.0-survey · 验证记录

只记录本轮实际跑过的命令与抓取，以及预期 vs 实际。外部内容一律标注访问日期 2026-11-13。

## V1 本仓是否已有 A2UI

| 项 | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 上游全仓 | `grep` pattern `A2UI|a2ui|agent-to-ui|Agent2UI|a2ui\.org`，path `deepseek-harness/` | 无命中则不支持 | **No matches found** |
| 全仓（含插件/脚本/文档） | 同上，path 仓根 | 无命中或仅误报 | 1 处误报：`stage-app/vendor/pixi.min.js`（压缩字符串） |
| 依赖 | `node_modules` 下查 `@a2ui*` 目录（checkout / 仓根 / `.artifacts/dsh-home` 递归） | 无目录 | **无输出** |
| profile | 读 `.artifacts/dsh-home/profiles/superagent-local/package.json` 与 `cordis.patch.yml` | 无 a2ui 包 | 18 个包，无 a2ui；patch 仅 webserver/superagent/ui-settings-general/ui-theme/llm-pi-ai/default-model |
| MCP Apps | `grep` `ui://|mcp-app|MCP App|rich content|iframe.*sandbox.*mcp`，path `deepseek-harness/packages` | 无宿主实现 | 仅 `packages/acp/acp/tests/content.spec.ts:61` 的「ACP rich content codec」测试名，非 MCP Apps |

## V2 外部事实（web_fetch）

| 目标 | URL | 结果 |
| --- | --- | --- |
| A2UI 主页 | https://a2ui.org/ | 200，v1.0，renderer 列表与「Built in」名单 |
| 首次公开公告 | https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/ | 200，日期 **DEC. 15, 2025** |
| 1.0 公告 | https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/ | 200，日期 **NOV. 11, 2026**，作者 Vishal Motwani；合作方 Atlassian / Alation / Bloomberg / ByteDance；「Gemini or Claude」托管 MCP Apps |
| 消息集 | https://a2ui.org/concepts/messages/ | 200，`createSurface` / `updateComponents` / `updateDataModel` / `deleteSurface` / `action` / 函数 RPC |
| SDK | https://a2ui.org/concepts/sdks/ | 200，core / agent（Python·TS·Dart）/ renderer 三层 |
| 落地名单 | https://a2ui.org/built-with-a2ui/ | 200，Alation、ByteDance Lynx（2026-06 发布 renderer，支持 0.9）、Atlassian Jira、Gemini Notebook、Gemini Enterprise（0.9.1）；**无 OpenAI** |
| OpenClaw 仓库 | https://api.github.com/repos/openclaw/openclaw | 200，created_at `2025-11-24T10:16:47Z`，TypeScript，394,406 stars |
| OpenClaw 首次 A2UI 提交 | https://api.github.com/search/commits?q=repo:openclaw/openclaw+a2ui&sort=committer-date&order=asc | 200，最早一条 `cdb5ddb`，`2025-12-17T11:35:06+01:00`，`feat(macos): add Canvas A2UI renderer`；total_count 189 |
| OpenClaw 退役 | 同上，`order=desc` | 200，`6f88c26`（2026-10-23）`refactor(canvas)!: retire A2UI widgets and content-kind hooks (#182109)`；随后 `83f7287`（2026-10-24）与另一条收尾 |
| OpenClaw 版本 | https://raw.githubusercontent.com/openclaw/openclaw/main/package.json | 200，`version: 2026.11.3` |
| OpenMuse 仓库 | https://api.github.com/repos/CopilotKit/openmuse | 200，TypeScript，6.4k stars，created 2026-09-15 |
| OpenMuse 依赖 | raw `apps/mobile/package.json`、根 `package.json` | 200；RN 0.81.5 / Expo 54 / @copilotkit/react-native 1.70.1 / AG-UI 0.0.59；**无 @a2ui** |
| OpenMuse A2UI 提交 | https://api.github.com/search/commits?q=repo:CopilotKit/openmuse+a2ui | 200，**total_count: 0** |
| OpenMuse 组件 | raw `apps/mobile/src/ui.tsx` | 200，12 个原语，RN 原生组件 + StyleSheet |
| OpenMuse 生成式 UI | raw `docs/demos/jev-generative-ui.md` | 200，`present_choices` + Jev（TypeSafe System One）决定是否出卡片与排序 |

## V3 检索限制（影响结论强度）

- `web_search` 首次调用即失败：`DeepSeek search has no API key for "DEEPSEEK_API_KEY"`。→ 改用 `web_fetch`。
- DuckDuckGo HTML 首查成功，第二次起返回反爬验证码（HTTP 202 + duck 图片选择）。Mojeek 同样要求 JS。
- Bing 可用（`setlang=en`），但结果以 a2ui.org 自身与日文教程为主，无 OpenAI 相关条目。
- deepwiki、grep.app 返回 429 / Vercel 安全校验，未采用。
- 结论：**否定类判断（ChatGPT 未接入）只能表述为「公开可查范围内无证据」**，不能表述为「确定没有」。

## V4 未做

- 未安装 `@a2ui/*`，未跑官方 Quickstart（需要 Python server + React client）。
- 未实测 DSH 客户端插件的动态加载路径（未新增任何 client half）。
- 未对 OpenClaw 退役做源码级复盘（只读 commit 信息）。
