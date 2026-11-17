# Agent UI 协议调研：A2UI 值不值得接，DSH 该走哪条路

- 日期：2026-11-13 04:45（Asia/Shanghai）
- 性质：只读调研。**未安装任何 `@a2ui/*`、未改代码/配置/依赖**；本机只读 `deepseek-harness/` 源码、profile 清单与工具目录。
- 方法：`web_fetch` 抓官方文档、A2UI 站点、GitHub API（仓库 / commit / contents）与原始文件；本机用 `grep` / `pwsh` 取证。`web_search` 不可用（缺 `DEEPSEEK_API_KEY`），细节见 §1。
- 外部链接访问日期：全部为 2026-11-13。

## 0. 结论

**A2UI 是真协议、有真实落地，但不是 DSH 现在该接的东西。四条证据指向同一判断：先做「受控卡片」，不要做协议。**

1. DSH 当前（`0.2.1-rc.5`，profile `superagent-local`）**零 A2UI 支持**：全仓 `a2ui` 零命中、无 `@a2ui/*` 依赖、无声明式 UI 通道（§2.2）。这是取证结果，不是判断。
2. A2UI 的形态是**协议 + 两侧 SDK**，不是组件库。「支持它」= 同时改宿主（消息生产与持久化）、客户端（渲染器）、回流（action → 用户输入）三处（§2.1、§3-D）。
3. **最强的反向证据来自实践者**：OpenClaw 在 A2UI 开源后 **2 天**就接上（2025-12-17），做了 10 个月、停在 0.8，**2026-10-23 整套退休**，把「可交互 UI」让回 HTML + 原生 widget + MCP Apps（§2.3.1）；CopilotKit 自己的产品 OpenMuse **没有用 A2UI**，用的是手写卡片 + 决策模型（§2.3.3）。
4. 「ChatGPT 最近接入 A2UI」**查不到证据**；A2UI 官方口径里能托管它的第三方助手是 Gemini 与 Claude（经 MCP Apps）（§2.3.2）。

**推荐：B（受控卡片 schema）起步，C（MCP Apps）作为战略选项，D（自建 A2UI 插件）不做。** 见 §5 D2。

## 1. 调查口径与限制

先定义「支持 A2UI」，否则讨论会漂移。本文用三档判定：

| 档位 | 含义 | 判定证据 |
| --- | --- | --- |
| L1 协议 | 宿主能生产并持久化 A2UI wire 消息（`createSurface` / `updateComponents` / `updateDataModel` / `action`） | 有消息类型或 session event，且有校验 |
| L2 渲染 | 客户端能按 catalog 把 surface 画成原生控件 | 有 renderer 包或插件，`@a2ui/*` 在依赖里 |
| L3 闭环 | 用户 `action` 能回流成下一轮 agent 输入，且卡片可重放 | 有回流通道 + 历史恢复 |

截至 2026-11-13，DSH 在 L1 / L2 / L3 **全无**。

限制：

- `web_search` 工具不可用（缺 `DEEPSEEK_API_KEY`）；DuckDuckGo 多次触发反爬，最终以 Bing 检索页 + GitHub API + 官方文档为主。**因此「没搜到」不等于「不存在」**，涉及否定结论的条目单列在 §7。
- OpenClaw 的 commit 检索口径是「提交信息含 `a2ui`」，命中 189 条，这是**下限**，不含未在提交信息中出现的改动。
- 未安装任何 A2UI 包、未跑官方示例；对「渲染效果 / 延迟」的判断来自官方文档与第三方实现说明，不是亲手实测。

## 2. 现状盘点

### 2.1 A2UI 是什么（v1.0，2026-11-11）

一句话：**agent 用 JSON 描述界面，客户端用自己注册的组件画出来；模型永远不产出可执行代码。**

- 归属：Google 开源（2025-12-15 公开），现由 `a2ui-project/a2ui` 维护，Apache-2.0；2026-11-11 发布 1.0（首个稳定版）。
- 三层 SDK：core（协议模型与 surface 状态）、agent（catalog → skill 生成 + 模型输出编译校验；Python / TypeScript / Dart）、renderer（React / Lit / Angular / Flutter / SwiftUI / Jetpack Compose）。
- 消息集（[Messages](https://a2ui.org/concepts/messages/)）：
  - 下游：`createSurface`、`updateComponents`（**平铺列表 + id 引用**，不是嵌套树）、`updateDataModel`、`deleteSurface`、`callRendererFunction`、`agentFunctionResponse`
  - 上游：`action`（带 `userMessage` 与 `context`）、`callAgentFunction`、`rendererFunctionResponse`
- 两个关键约束：
  - **catalog 是护栏**：app 注册哪些组件，agent 就只能用哪些；越界在编译期被拒。
  - **数据绑定**：`{"@path": "/outbound/price"}`；用户在本地改值不上行，只有 `action` 回落给 agent。
- 传输无关：SSE / AG-UI / A2A / MCP 都可承载。

### 2.2 DSH 现状：L1 / L2 / L3 全无（本机取证）

| 检查 | 结果 |
| --- | --- |
| `deepseek-harness/` 全仓 grep `A2UI|a2ui` | **0 命中** |
| checkout 与 profile 是否有 `@a2ui/*` | **无**：`superagent-local/package.json`（18 个包）、`cordis.patch.yml`、`node_modules` 均无 |
| Web 客户端渲染模型 | 60+ 个 `ui-*` 包，每个是确定的 React 组件；`ui-renderer` 只做 slot 绑定，没有「按 JSON 建组件树」的通用渲染器 |
| 人机交互原语 | `ask_user_question`、审批卡、`exit_plan_mode`、`present`（文件卡）、todo / plan 面板——schema 封闭，模型不能决定布局 |
| 新增渲染类型的唯一入口 | 注册 `ConversationNodeDefinition + keyed renderer`（`deepseek-harness/docs/architecture.md:157`），即写插件 |
| MCP 侧 | `packages/mcp/` 只消费 tools / resources；全仓无 `ui://`、无 MCP Apps 宿主 |

结论：DSH 是「固定原语 + 编译期插件」的 UI 模型，与 A2UI 的「运行时下发 + 目录约束」是两种范式。

### 2.3 生态证据（三条，方向一致）

#### 2.3.1 OpenClaw：最早接入，也最早放弃

| 时间 | 事实 | 出处 |
| --- | --- | --- |
| 2025-12-15 | Google 公开 A2UI | 官方博客 |
| 2025-12-17 | `feat(macos): add Canvas A2UI renderer`（仓库建于 2025-11-24，开源后第 2 天） | commit `cdb5ddb` |
| 2025-12 → 2026-10 | 累计 189 条含 a2ui 的提交；实现到 **0.8**（10-21 提交仍提「v0.8 renderer custom element」） | GitHub commit 检索 |
| **2026-10-23** | `refactor(canvas)!: retire A2UI widgets and content-kind hooks (#182109)`：删两套 renderer、路由、构建管线与 `registerBoardWidgetContentKind`；**BREAKING**，存量 widget 由 Doctor 备份后删除；board schema → protocol v5 | commit `6f88c26` |
| 2026-10-24 | 两个收尾提交（退役残留不再把 Git 安装判成 dirty） | `83f7287` 等 |

退役提交里唯一一句「为什么」是**保留了什么**：*"Preserve HTML, native plugin widgets, and MCP Apps."* 动机没写（见 §7）。但结果明确：**A2UI 1.0（11-11）发布时，它已经不在车上了。**

#### 2.3.2 ChatGPT / OpenAI：查不到接入

- [Built with A2UI](https://a2ui.org/built-with-a2ui/) 名单：Alation、ByteDance Lynx、Atlassian Jira、Gemini Notebook、Gemini Enterprise——**没有 OpenAI**。
- A2UI 1.0 博客列的合作方：Atlassian、Alation、Bloomberg、ByteDance；提到能托管 A2UI 的第三方助手是「**Gemini 或 Claude**」（经 MCP Apps）。
- OpenAI 自己的路线是 ChatKit / Apps SDK（MCP + HTML / iframe），与 A2UI 的声明式 JSON 是两套架构。

#### 2.3.3 OpenMuse（CopilotKit 自家产品）：手写卡片，不上协议

- 技术栈：Expo 54 + React Native 0.81.5 + React 19.1，一套代码跑 iOS / Android / Web（`react-native-web` 0.21）；**无任何 UI 组件库**。
- 组件：`apps/mobile/src/ui.tsx` 一个文件 12 个原语（Button / IconButton / Card / Chip / Field / Empty / ErrorNotice / Sheet / CheckRow / SectionHeading / LinkRow / Mascot），全部落在 RN 原生 `View / Text / Pressable / TextInput / ScrollView / Modal / Image` 上。
- 对话：CopilotKit **headless**（`@copilotkit/react-native` 1.70.1）+ AG-UI 事件流，画面自己画。
- 富结果：按工具名硬编码的卡片（`mail-tool-card`、`browser-tool-card`、`desktop-tool-card`、`search-tool-card`、`jev-tool-card`）；「生成式」体现为 `present_choices` 填候选 + **Jev（TypeSafe System One）** 决定是否出卡片、怎么排序。
- `a2ui` 相关提交 **0 条**，依赖里没有 `@a2ui/*`。

讽刺之处在于：CopilotKit 是 A2UI 生态的积极推动者（playground、`@a2ui/react`），但它自己拿得出手的产品级应用**没有用它**。

## 3. 候选方案

### A. 维持现状（固定工具 + 固定卡片）

- 是什么：每要一种新界面就加一个工具 + 一个卡片。
- 怎么接：不改。
- 代价：0。
- 风险：工具数量线性膨胀；「同一份数据换种展示」无法表达。

### B. 受控卡片 schema（**推荐起步**）

- 是什么：工具结果里带一个受约束的展示描述，例如 `{ "card": "comparison", "props": { "items": [...], "highlight": 1 } }`；客户端用 **card registry** 渲染，props 用 Zod 校验，卡片集合是白名单。
- 怎么接：一个插件内即可完成（host 侧卡片 schema + client half 组件 + 注册表）；模型只能**选卡片 + 填值**，不能自定布局。
- 代价：小（一个约定 + 一张注册表 + 若干卡片组件）。
- 风险：卡片集合会增长；schema 演进要版本化。
- 与 DSH 既有约束的关系：不新增 model-visible 输入（工具结果本来就有），不需要新 session event，不碰上游三仓。

### C. MCP Apps 路线（战略选项）

- 是什么：让 Web 客户端能托管 MCP App（`ui://` 资源 + iframe 沙箱 + postMessage 桥），第三方 server 自带 HTML / JS 界面。
- 怎么接：客户端新增沙箱宿主与 CSP；`packages/mcp` 侧暴露 app 资源。A2UI-over-MCP 也能顺带进来。
- 代价：中到大（沙箱、跨端一致性、持久化、权限）。
- 风险：iframe 沙箱的安全与体验；DSH 桌面端走同一 Web 栈，行为必须一致。

### D. 自建 A2UI 插件

- 是什么：host 侧工具发 wire 消息并持久化；client half 用 `@a2ui/react` 挂 surface；`action` 回流成用户输入。
- 怎么接：三处都要动（§1 的 L1 / L2 / L3）；还要为 UI 消息引入一条可重建的事件。
- 代价：大（协议、catalog、双向绑定、回流、历史重放）。
- 风险：**与两条实践者的选择相反**；收益主要是「标准化 / 跨端复用」，而 DSH 目前没有跨端 UI 诉求（Web 与桌面同一栈）。

## 4. 卡点（按阻塞程度）

- **C1 DSH 没有声明式 UI 通道**（证据见 §2.2）。任何「让模型画界面」的方案都必须先补 L1，绕不过。
- **C2 客户端插件是构建期产物**：client half 要 `pnpm` 构建，`dev:web` 才热更；渲染器不能「运行时下载」，只能随 profile 安装。影响 C / D 的迭代速度。
- **C3「Model-visible ⟺ logged」**：UI 消息若进模型上下文，必须有对应 session event 可重建；若只做展示（推荐），应 log-only 或干脆不落库。这是 D 的主要隐藏成本。
- **C4 动作回流只有两条**：`ask_user_question` 与审批。A2UI 的 `action` 需要一个通用的「客户端动作 → 用户输入」通道，涉及 turn 生命周期（是否开新 turn）——D 的设计难点。
- **C5 MCP Apps 未支持**：`packages/mcp` 无 `ui://`、无宿主；C 的全部工作量都在这里。
- **C6 生态信号不利**：OpenClaw 退役、OpenMuse 不采用。在拿到自己的真实需求前，不该为标准化付成本。

## 5. 决策清单（不拍板不实施）

| 编号 | 问题 | 选项 | 推荐 | 影响面 |
| --- | --- | --- | --- | --- |
| D1 | 目标场景是什么？ | ① 现有工具结果更好看 ② 任意第三方 UI ③ 两者都要 | **①** | 决定走 B 还是 C |
| D2 | 路线 | A / B / C / D | **B 起步，C 预留，D 不做** | 插件 vs 客户端沙箱 |
| D3 | 若 B：第一批卡片 | 图表 / 对比 / 表单 / 时间线 / 其他 | 由真实需求定；先做「现在只能用文字回答」的场景 | 组件集合 |
| D4 | 模型是否有「选卡片」的自由度 | ① 工具即卡片（模型无权选）② 工具返回 enum 卡片名 + props | **②** | 提示词与 schema 校验 |
| D5 | 安全边界 | props 是否允许任意 URL / HTML | **URL 白名单 + 禁止 HTML** | 渲染器与 XSS 面 |
| D6 | 若 C：是否接受 iframe 沙箱 | 接受 / 只支持自家组件 | 视 D1 结果 | 客户端架构 |

## 6. 参考（访问日期均为 2026-11-13）

- Google 公告（2025-12-15）：https://developers.googleblog.com/introducing-a2ui-an-open-project-for-agent-driven-interfaces/
- A2UI 1.0（2026-11-11）：https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/
- a2ui.org：主页 / [Overview](https://a2ui.org/concepts/overview/) / [Messages](https://a2ui.org/concepts/messages/) / [SDKs](https://a2ui.org/concepts/sdks/) / [Built with A2UI](https://a2ui.org/built-with-a2ui/)
- OpenClaw 首次接入：https://github.com/openclaw/openclaw/commit/cdb5ddb2da0b0b3ed3af4f953ffbceea8411f868
- OpenClaw 退役：https://github.com/openclaw/openclaw/commit/6f88c26dcf823a6d5c99a6053316829edc1a6512
- OpenClaw 收尾：https://github.com/openclaw/openclaw/commit/83f72876551ff04dca89d184500f8667783ad8c4
- OpenMuse：https://github.com/CopilotKit/openmuse 的 `apps/mobile/package.json`、`apps/mobile/src/ui.tsx`、`apps/mobile/README.md`、`docs/demos/jev-generative-ui.md`
- 本仓：`deepseek-harness/docs/architecture.md:157`、`deepseek-harness/packages/client/`、`deepseek-harness/docs/tool-catalog.md`

## 7. 未核实

- OpenClaw 退役的真实动机（commit 只写了保留什么，没写为什么）。
- OpenClaw 是否曾升到 A2UI 0.9 / 1.0（退役早于 1.0 发布，推断未升，未见版本声明）。
- ChatGPT 是否通过 MCP Apps 间接渲染 A2UI（未查 OpenAI 对 MCP Apps 的支持状态）。
- DSH 客户端插件从 profile 动态加载的完整链路（依据 profile 插件的 `dsh.client` 声明与 HMR 说明推断，未跑实测）。
- A2UI 1.0 的 TS agent SDK 与 DSH 工具管线 / 事件模型的兼容性（未试装）。
- A2UI 渲染的实际性能与 catalog 演进成本（无实测）。

---

> 后续（2026-11-13 05:15）：用户已定「不接 A2UI」。OpenMuse UI 识别移植与小卡片/小组件资产化方案见 [agent-ui-widgets-port.md](agent-ui-widgets-port.md)。
