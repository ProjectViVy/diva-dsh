# OpenMuse UI 移植 + 小卡片资产化 · v0.2.0-port · 验证记录

只记录本轮实际读过的文件与关键行，外部访问日期 2026-11-13。

## V1 OpenMuse 源码（raw.githubusercontent.com，main 分支）

| 文件 | 结论 |
| --- | --- |
| `apps/mobile/src/chat.tsx`（36KB） | `WorkspaceTools()` 注册 6 个 `useRenderTool`：`search_mail`、`read_mail_thread`、`search_web`、`browse_web`、`use_desktop`、`present_choices`；`displayParameters = z.record(z.string(), z.unknown())`；`render({args,result,status,toolCallId})`，`status !== "complete"` 为加载态；`useAgentContext({section, mode})` 把屏幕喂给模型 |
| `apps/mobile/src/ui.tsx`（12KB） | `colors` 12 色 + `StyleSheet` + 12 原语（Button/IconButton/Card/Chip/Field/Empty/ErrorNotice/Sheet/CheckRow/SectionHeading/LinkRow/Mascot）；圆角 23/24/19，字号 15/14/11/10，按钮 min-height 42 |
| `docs/EXPERIENCE.md` | 视觉语言：airy canvas、灰/天蓝气泡、大触控目标、圆角胶囊、克制 artifact 边框；预览显示真实工具结果 |
| `docs/demos/jev-generative-ui.md` | `present_choices` + Jev（TypeSafe System One）决定出卡片/回文字并排序；重载后历史卡片仍在、旧选择禁用 |
| `apps/mobile/package.json`、根 `package.json` | RN 0.81.5 / Expo 54 / `@copilotkit/react-native` 1.70.1 / AG-UI 0.0.59；无 `@a2ui/*` |
| `git/trees?recursive=1` | 卡片文件清单：`mail-tool-card` `browser-tool-card` `desktop-tool-card` `search-tool-card` `jev-tool-card` `thread-artifacts` `agent-ui` |

## V2 本仓契约（只读）

| 文件 | 取证 |
| --- | --- |
| `deepseek-harness/packages/client/ui-tool/README.md` | 「atomic Tool views are keyed by wire Tool name and registered by their owning business packages；Unregistered Tool names use the generic card」；注册示例 `ctx.slots.register({ name:'tool.call.toolview', key:'<wire tool name>' }, BusinessToolRow)`；owner props 含 `callId`/`toolName`/`phase`+`block`/`cwd`/`home`/`loadImage`/`openFile`/`inspect` |
| `deepseek-harness/packages/client/ui-primitives/README.md` | 输出卡已有 terminal/read/diff/search/web；渲染不可信模型输出时「dropping raw HTML, restricting links」 |
| `deepseek-harness/packages/client/modules/README.md` | client 插件由 `dsh.client` 声明 → 宿主组 boot graph → `/plugins` 分发 → 浏览器惰性加载；bundle 是构建产物（`lib/client.js`） |
| `deepseek-harness/packages/client/AGENTS.md` | 样式纪律：CSS Modules + `--dsw-*`，无字面色、无组件库、无 Tailwind；tool 卡「derive in the Client from raw call/result events」；未知/畸形数据落 generic |
| `deepseek-harness/packages/storage/README.md` | `ctx.storage`（backend 选择）+ `ctx.storageDomain`（schema 校验、变更通知的 KV 域）；`storage-json` 每 unit 一个 JSON 文件 |
| `deepseek-harness/packages/context/README.md` | context 组：model-visible、可重放；`harness-dev-context` 是「运行时上下文不污染 system prompt」的现成范例 |

## V3 路由检查

| 检查 | 命令 | 实际 |
| --- | --- | --- |
| client 侧路由 | grep `location\.pathname|pushState|hashchange|useSearchParams`，path `deepseek-harness/packages/client` | **No matches found** |
| apps/web 路由 | grep `Router|route|pathname`，include `*.ts*` | 250+ 命中全部是 Playwright/测试的 `page.route` 与 URL 断言，无应用级路由 |

结论：Web 客户端是单文档、状态驱动（sidebar section / 面板），新增「页面」不是新增 URL。

## V4 未做

- 未读 `agent-ui.tsx`(66KB)、`browser-tool-card.tsx`、`desktop-tool-card.tsx` 的实现（只读注册表与文件清单）。
- 未试装任何包、未写原型、未跑 `npm test`。
- 未确认本 profile 是否挂载 `ctx.storageDomain`。
