# OpenMuse UI 移植评估 + 小卡片资产化设计（v0.2）

- 日期：2026-11-13 05:15（Asia/Shanghai）
- 上游决策（本轮已定）：**不接 A2UI**；任何实践先尝试移植 OpenMuse 的 UI 识别；需要一个以 Superagent 为聚焦主体的新页面（待用户补充）；小卡片既可预制、也可自做，且**要能保存为资产**。
- 性质：只读调研 + 方案设计。**未改任何代码/配置/依赖**；只写 `docs/` 与 `TODOLIST.md`。
- 方法：读 OpenMuse 源码（raw 文件）与 `docs/EXPERIENCE.md`；对照本仓 `deepseek-harness` 的 `ui-tool`、`ui-primitives`、`storage`、`context`、`client-modules` 的真实契约。
- 访问日期：外部链接均为 2026-11-13。

## 0. 结论

**「移植 UI 识别」可行，但要移植的是模式与设计，不是代码；「小卡片资产化」的关键约束不是存储，而是 DSH 的客户端是构建期产物 + 工具结果模型可见。**

1. **DSH 已经有同构的识别机制**：`tool.call.toolview` 按 wire tool name 注册的 keyed slot + generic 兜底（[ui-tool](../deepseek-harness/packages/client/ui-tool/README.md)），与 OpenMuse 的 `useRenderTool({ name, render({args, result, status}) })` 是同一套思路。**没有可搬的框架**，缺的是卡片集合、设计语言和「屏幕上下文」。
2. **不能搬代码的三条硬理由**：① OpenMuse 是 React Native（`View/Text/Pressable` + `StyleSheet`），DSH Web 是 React DOM + CSS Modules + `--dsw-*` tokens，且明确禁止组件库与 Tailwind；② `ui.tsx` 的视觉可以照搬，实现必须重写；③ 把 react-native-web 塞进 DSH 只为一个卡片岛，收益抵不过体积与样式体系冲突。
3. **小卡片资产化 = 固定原语词汇表 + JSON 文档 + 可重放引用**。客户端组件是 `pnpm` 构建期产物（`lib/client.js` 由 `/plugins` 分发、惰性加载），agent 不可能在运行时编译新组件；「自做一套」只能是**在已注册的词汇表里组合**，组合结果存成 JSON 资产。
4. **一个此前没被点出的卡点**：工具结果是模型可见的（`tool/result` 进会话历史）。把整份 widget 文档塞进工具结果，会同时污染上下文与 KV 缓存。要「资产化卡片」，正确形状是**一条只用于展示的可重放事件**（可重建、不进模型上下文），或工具结果只带 `widgetId` 引用。
5. 工作量：只做「预制卡 + 内联文档」1–2 天量级；做到「可保存资产 + 面板管理 + 用户编辑」3–5 天量级（单插件）。

## 1. 口径

「UI 识别」在本文指四步闭环：**工具调用/结果 → 选中一个卡片类型 → 填充数据 → 渲染（含 loading/失败态）→ 用户动作回流**。不包含「模型自由生成布局」。

## 2. OpenMuse 的三层解剖（证据）

### 2.1 注册表：工具名 → 渲染函数

`apps/mobile/src/chat.tsx` 的 `WorkspaceTools()` 里一次性注册 6 个 `useRenderTool`：

| 注册名 | 说明文案 | 渲染 |
| --- | --- | --- |
| `search_mail` | Show the agent checking the mailbox | `MailToolCard search` |
| `read_mail_thread` | Show the email the agent read | `MailToolCard` |
| `search_web` | Show public web search progress and sources | `SearchToolCard` |
| `browse_web` | Follow the agent as it reads a webpage | `BrowserToolCard url={args.url}` |
| `use_desktop` | Show the agent working on the computer's desktop | `DesktopToolCard toolCallId` |
| `present_choices` | Show prepared choices for the conversation | `JevToolCard` |

- 参数 schema 统一是 `const displayParameters = z.record(z.string(), z.unknown())`——**展示用 schema 故意宽松**，真正的校验在服务端工具。
- 渲染签名是 `render({ args, result, status, toolCallId })`，`status !== "complete"` 即加载态。**卡片拿的是原始工具结果，没有中间展示 schema**。
- 未注册的工具走 `useRenderToolCall` 的通用形态；这与 DSH「未注册 Tool 名走 generic card」完全一致。

### 2.2 卡片：6 个专用 + 线程产物

`mail-tool-card.tsx`(8.5KB)、`browser-tool-card.tsx`(14KB)、`desktop-tool-card.tsx`(8.8KB)、`search-tool-card.tsx`(11.5KB)、`jev-tool-card.tsx`(8.9KB)、`thread-artifacts.tsx`（`FileThreadCard` / `TaskThreadCard`），另有 `agent-ui.tsx`(66KB) 的 `ArtifactCard` 家族。

### 2.3 决策与上下文

- `present_choices` 出一组候选（带 source 标题/URL）→ **Jev（TypeSafe System One）** 决定「出卡片还是回文字」并给每个候选打分排序（`docs/demos/jev-generative-ui.md`）；选中后 `confirmedJevSelection` 记录，`latestJevPanelId` 保持面板一致。
- `useAgentContext({ section, mode })`：把「用户现在在哪个屏幕、什么模式」作为上下文喂给模型——**UI 反向告诉 agent 自己在看什么**。
- 持久化靠 AG-UI 消息 + 重放：重载后旧卡片与最终选择仍在，旧选择控件被禁用。

### 2.4 视觉语言（`docs/EXPERIENCE.md`）

「airy canvas、灰/天蓝区分的消息气泡、大触控目标、圆角输入与导航胶囊、克制的 artifact 边框」；邮件/浏览器/PDF 预览显示**真实工具结果**，不做二次美化。

## 3. 映射：哪些是已有的，哪些要新写

| OpenMuse | DSH 对应 | 差距 |
| --- | --- | --- |
| `useRenderTool` 注册表 | `tool.call.toolview` keyed slot（按 wire tool name） | **无**，机制同构 |
| `render({args,result,status})` | `ToolCallOwnerProps`：`callId`/`toolName`/`phase`+`block`/`cwd`/`home`/`loadImage`/`openFile`/`inspect` | 参数略丰富，无差距 |
| 通用兜底 | generic `ToolRow`；「Unsupported or ambiguous input falls back to flattened Tool text」 | **无** |
| 输出型卡片 | `ui-primitives` 的 terminal / read / diff / search / web 卡 | 缺「业务卡」形态（邮件/浏览器/对比） |
| `useAgentContext(屏幕)` | `context/` 组（runtime context，model-visible 且可重放） | 缺「当前页面」这一条 |
| 重放后卡片仍在 | Session log 派生（`tool/call`、`tool/result`）→ Client 从原始事件派生卡片 | **无**，本就是 DSH 的原则 |
| Jev 决策模型 | 无 | 需自建（可先用规则，不必上外部付费服务） |

一句话：**框架层没有要移植的；要移植的是「卡片的种类」「设计语言」「屏幕上下文」「选择闭环」。**

## 4. 移植清单（按性价比排序）

### P0 设计语言 → tokens（半天）

把 `ui.tsx` 的调色板翻成语义 token，落到 `--dsw-*` + CSS Modules：

| OpenMuse | 值/用途 | DSH 落点 |
| --- | --- | --- |
| `canvas` `#FCFCFC` | 页面底色 | surface 语义 token |
| `card` `#FFFFFF` / `line` `#EEEEF0` | 卡片与分隔 | surface/border 语义 token |
| `text` `#11191C` / `muted` `#697176` | 正文/次要 | text 语义 token |
| `blue` `#C8E7FF` / `blueDark` `#1473C8` | 主按钮、强调 | accent 语义 token |
| `sky` `#EDF7FD` / `green` `#E3F3E8` / `lavender` `#F0EEFA` / `orange` `#FDF0DF` | 图标底、状态 | info/success/neutral/warning 语义 token |
| 圆角 23（卡）/24（按钮）/19（输入）、字号 15/14/11/10、按钮 min-height 42 | 尺寸刻度 | tokens 的 radius / font / control 刻度 |

规则：**不引入 react-native-web**；样式只走 CSS Modules + tokens（`packages/client/AGENTS.md` 的样式纪律）。

### P1 原语补位（1 天）

DSH `ui-primitives` 已有 Button / Menu / Modal / Tooltip / Toast / 图标 / Markdown / 输出卡；OpenMuse 的 `Card`、`Sheet`、`CheckRow`、`Empty`、`ErrorNotice`、`SectionHeading`、`LinkRow`、`Chip` 没有对应物。
落点二选一：① 放进新 widget 包（快，但不可复用）；② 提升到 `ui-primitives`（慢，但符合「控件只能在那里共享」的规则）。**先 ①，稳定后再提升**。

### P2 卡片集合（1–2 天，主要成本在 host 数据）

按价值排序：对比/选择卡（最像"界面"）→ 搜索来源卡 → 浏览器进度卡 → 邮件线程卡 → 桌面操作卡。每张卡需要：host 工具结果结构 + client 卡片 + loading/失败态。**卡片的形状由工具结果决定，所以这项工作是先设计工具，不是先设计界面。**

### P3 屏幕上下文（半天）

一个 context 插件：把当前 `section`（以及模式）作为 runtime context 注入，走 DSH 既有的 model-visible、可重放通道。好处是模型知道"用户在哪个页面"，能主动提议卡片；坏处是每步多一段上下文，要控制在几十 token 内。

### P4 选择闭环（1 天，不含模型）

`present_choices` 式工具 + 服务端排序。**先规则排序（来源数、关键词命中、用户偏好），不接 TypeSafe**；Jev 的价值在"是否出卡片"这个二分类，DSH 用自家模型一次调用也能做，但要接受延迟和成本。

### 明确不移植

RN 运行时、`react-native-web`、`@copilotkit/react-native`、Jev 的外部服务依赖、AG-UI 传输（DSH 自己的 session/event 已覆盖）。

## 5. 小卡片 / 小组件资产化（本报告核心）

### 5.1 三种形态，只有第二种能「自做 + 保存」

| 形态 | 是什么 | 能否 agent 自做 | 能否存为资产 | 结论 |
| --- | --- | --- | --- | --- |
| preset | 编译期卡片，按工具名注册 | 否 | 否（代码） | 作基线 |
| **composed** | JSON 文档 + 固定词汇表，运行时解释 | **是** | **是** | **推荐** |
| code | 运行时下发组件代码 | 是 | 是 | **不做**（构建期、安全） |

### 5.2 词汇表（建议首批 12 个）

只允许「布局 + 展示 + 一个动作」，全部不接受 `style` / `className` / HTML：

`Box`、`Row`、`Column`、`Text`、`Heading`、`Badge`、`Divider`、`Image`（受控来源）、`Link`（受控协议）、`Table`、`Chart`（bar/line）、`Button`（带 action）。

可选延后：`Form`（输入框类）、`Timeline`、`Progress`。
每个词汇 5–8 个 props，且 props 只有 enum / string / number / 上述节点的数组。

### 5.3 WidgetDoc 草案

```json
{
  "schemaVersion": 1,
  "id": "w_01J...",
  "title": "Aquarium trip · exhibits",
  "origin": "composed",
  "root": {
    "t": "Card",
    "children": [
      { "t": "Heading", "text": "Rocky Shore", "level": 2 },
      { "t": "Text", "text": "Hands-on bat-ray touch pool" },
      { "t": "Table", "columns": ["Exhibit", "Fit"], "rows": [["Kelp Forest", "0.62"], ["Rocky Shore", "0.91"]] },
      { "t": "Button", "label": "Use Rocky Shore", "action": { "id": "pick", "payload": { "id": "rocky" } } }
    ]
  }
}
```

硬限制（解释器强制执行，越界即降级为通用文本）：深度 ≤ 8、节点 ≤ 200、单字符串 ≤ 2000 字符、链接仅 http(s)、动作只允许 `id + payload`。

### 5.4 存在哪里

| 方案 | 落点 | 优点 | 缺点 |
| --- | --- | --- | --- |
| 内联（随工具结果） | session log | 零基础设施、天然可重放、内容与当时一致 | 模型可见、占上下文与缓存 |
| **storage-domain** | `ctx.storageDomain` 新建 `widget` 域（key=id，value=doc+meta） | 可复用、可列举、可编辑 | 需要一次读取 RPC；资产会变 |
| 文件目录 | `storage-json` 每 unit 一个 JSON 文件 | 用户可手改、可备份 | 同上，且需路径治理 |

推荐组合：**渲染走「内联快照」（保证历史不变、无读取失败），收藏/复用走 storage 域（`widget` 域存 doc + `createdBy`/`createdAt`/`schemaVersion`/`version`）**。资产目录落在 `$DSH_HOME` 内，不入库。

### 5.5 渲染路径

```
agent 调 widget 工具（compose 或 save）
  → 校验（Zod + 词汇表 + 限制）
  → 生成快照快照（inline）或 save 返回 widgetId
  → 会话里出现一条「展示事件」
  → client 插件按词汇表解释渲染（未知节点 → 降级）
  → 用户点 Button → action{id,payload} → host 校验 → 回流成用户输入
```

### 5.6 谁能创作

- **agent**：`widget_compose`（从 preset 模板或空开始组合）、`widget_save`（落 storage）、`widget_render`（渲染一个已存 id）。
- **用户**：面板里改 JSON / 表单化编辑（后置）。
- preset 同时充当**模板**：`widget_compose({ from: "comparison-table", data: ... })`。

### 5.7 降级与版本

- 未知词汇 / 超限 / 校验失败 → 落回 generic 文本（DSH 已有该规则，不要新造）。
- `schemaVersion` 高于解释器 → 只读展示 + 提示；低于 → 迁移函数（一个 v0→v1 就够）。

## 6. 卡点

- **C1 组件是编译期产物**：「自做一套」只能是组合，不能是代码。任何「agent 写组件」的方案都会撞上 `pnpm bundle` + `/plugins` 分发。
- **C2 工具结果模型可见**：widget 文档若随工具结果进历史，会进模型上下文（还打 KV 缓存）。要么接受（小文档），要么引入一条**只展示、可重放、不进模型上下文**的事件——这需要新的 session 事件类型与 client 派生。
- **C3 资产会变**：id 引用 + 资产可编辑 = 历史卡片内容漂移。用「内联快照优先、id 仅用于复用」规避。
- **C4 Web 客户端没有 URL 路由**：`packages/client/web` 与 `apps/web` 源码里没有应用级路由（只有测试里的 `route` mock）。所谓「新页面」= sidebar section + slot 组合，不是新 URL。
- **C5 动作回流**：DSH 只有 `ask_user_question` / 审批两条；卡片按钮需要一条受控回流（同 A2UI 的 action 问题，但词汇表更小、可枚举，成本低）。
- **C6 决策模型**：Jev 是外部付费服务；DSH 先用规则 + 自家模型，别引入依赖。

## 7. 决策清单（续 §5 的 D1–D6）

| 编号 | 问题 | 选项 | 推荐 |
| --- | --- | --- | --- |
| D7 | 小卡片形态 | preset-only / preset+composed（资产）/ 再加用户编辑 | **preset+composed** |
| D8 | 资产存储 | 内联 only / storage-domain / 文件目录 / 内联快照 + storage 复用 | **最后一种** |
| D9 | widget 文档是否要独立「展示事件」 | 复用 tool result / 新增 log-only 事件 | **先复用 tool result，文档限制在 2–4KB；超限再上事件** |
| D10 | 词汇表首批 | 12 个（见 §5.2） | 按需砍到 8 个 |
| D11 | 是否做屏幕上下文注入 | 做 / 不做 | **做**（P3，成本最低、收益直接） |
| D12 | 新页面（Superagent 聚焦） | 待用户描述 | 等 §8 |

## 8. 待用户补充（新页面）

到位后需要回答的问题：① 主体是「Superagent 的运行态」还是「它的产出物」；② 与现有 Chat/Activity 的关系（替换还是并列）；③ 卡片出现在页面里还是对话里；④ 是否需要 URL 可分享（DSH 无路由，需另做）。在此之前不出页面方案。

## 9. 未核实

- OpenMuse 的 `browser-tool-card` / `desktop-tool-card` 内部如何与 worker 实时流对接（只读了注册表与文件名，未读实现）。
- `ArtifactCard` 家族的完整种类（`agent-ui.tsx` 66KB 未逐行读）。
- DSH 的 `storage-domain` 在本 profile 是否已启用（`dsh-base` 是否挂载 `ctx.storageDomain`）。
- 新增「只展示事件」对 session 格式版本与 SDK 投影的影响（未评估）。
- 2–4KB 的 widget 文档对 KV 缓存的实际影响（未实测）。
