# 卡片定义形式预研：让 agent 自己写「任何内容」

- 日期：2026-11-14 18:10（Asia/Shanghai）
- 性质：只读预研 + 方案设计。**未改任何代码/配置/依赖**；只写 `docs/` 与 `TODOLIST.md`。
- 上游决策（用户 2026-11-14 17:44）：卡片要能让 agent 自己创作、用于显示任何内容；候选为「OpenClaw 同款」与 A2UI，要求分析。
- 方法与限制：本机取证用 `read`/`grep`；外部证据来自 2026-11-13 同会话已抓取并留痕的内容（A2UI 官网、OpenClaw 退役提交、OpenMuse 源码）。**本轮外部网络整体不可用**（`dsh-plugin.org`、`a2ui.org`、`api.github.com` 均解析到 RFC 2544 保留网段 198.18.0.0/15，被 `web_fetch` 私网校验拒绝），因此涉及外部的条目一律标注「沿用 2026-11-13 证据，本轮未复核」。

## 0. 结论

**不做 A2UI，不做 OpenClaw 的 HTML 画布；做「内容块词汇表 + 卡型模板」，HTML 只留一个受控逃生舱。**

1. 「显示任何内容」不等于「任意布局」。日常页要的内容可以归成 **13 种内容形态**（文字、列表、键值、表格、指标、进度、步骤、时间线、图表、图片、链接、引用、行动），布局由宿主统一——这正好让视觉与 DIVA 纸墨一致，也让模型只做它擅长的事：挑形态、填内容。
2. A2UI 是「UI 协议」：它让模型决定**布局与组件树**，因此模型要同时回答「说什么」和「怎么摆」，出错率与 token 都更高，还要客户端 renderer + agent 侧编译校验 + action 回流三件套（前轮已评估，DSH 零支持）。
3. OpenClaw 同款（HTML / MCP App）表达力最强，但它 2026-10-23 自己把 A2UI 套件整套退役后保留的正是这条路——**这条路是「第三方 App 的画布」，不是「每天出现的信息卡」**：HTML 自带样式会破坏纸墨一致性，体积与安全面都大（8KB vs 几百 KB）。
4. 预制卡不是另一种方案，而是词汇表的一种用法：`kind`（卡型）= 固定块组合 + 语义；agent 既可以选卡型填参（L1），也可以自由组块（L2）。
5. 这不是纸上方案：本机 `openhanako` 已把「工具 → 内容块（服务端投影）→ 组件（客户端注册表）」跑通（§2.4），并另开一条 agent 写 HTML 的受控通道。我们要做的是把它的块换成更小更稳的 13 种内容形态，把 HTML 通道推迟到第二阶段。
6. **修订（18:20，网络恢复后）**：DSH 社区已有两个现成实现——`dsh-genui`（fence 里的白名单 JSON、30+ 组件、动作回流、明列支持 `0.2.1-rc.5`）与 `dsh-visualize`（沙箱 HTML 卡、无动作回流）。所以 E1 的真问题变成「复用哪个 + 自研哪一层」，新增 **E9 / E10**（见 §5），本文的页面卡结论不变。

## 1. 口径：什么叫「agent 自己创作卡片」

分四级，先定级再谈方案：

| 级别 | agent 的自由度 | 需要的机制 | 日常页是否需要 |
| --- | --- | --- | --- |
| L1 选卡填参 | 从固定卡型里选一个，填参数 | 卡型注册表 + props schema | 需要（基线） |
| **L2 组块** | 从固定块里选若干，填内容与顺序 | 块词汇表 + 文档 schema | **需要（主力）** |
| L3 写布局 | 决定行列、宽度、嵌套 | 布局 DSL 或 UI 协议 | 不需要 |
| L4 写代码 | 写 HTML/CSS/JS | 沙箱 iframe + CSP | 仅第三方逃生舱 |

「显示任何内容」在 L2 就到顶了：内容是数据，形态是有限的；L3/L4 买到的是「布局自由」，代价是视觉一致性与安全。

## 2. 三个候选的解剖

### 2.1 A2UI 式（协议）

- 形态：wire 消息（`createSurface` / `updateComponents` / `updateDataModel` / `action`）+ catalog 约束 + renderer SDK；组件是平铺列表 + id 引用，允许数据绑定 `{"@path": ...}`。
- 优点：跨端、有标准、有校验、第三方可复用组件目录；UI 更新是增量消息，适合长生命周期界面。
- 代价（前轮已取证）：客户端要 renderer（React/Lit/Angular…）、agent 侧要 catalog→skill 生成与编译校验、动作要回流；DSH `0.2.1-rc.5` 三档全无。
- 对本页的判断：**过度设计**。本页只需要「卡片」，不需要「可增量更新的界面」；引入协议等于为一个页面背一整套跨端契约。

### 2.2 OpenClaw 同款（HTML / MCP App 画布）

- 证据（2026-11-13 抓取，本轮未复核）：OpenClaw 2025-12-17 接入 A2UI（`cdb5ddb`），2026-10-23 以 `refactor(canvas)!: retire A2UI widgets and content-kind hooks (#182109)` 整套退役（`6f88c26`），提交里写明保留 *"HTML, native plugin widgets, and MCP Apps"*。
- 形态：agent（或插件、或 MCP server）给出 HTML/JS，宿主在沙箱里渲染成一块画布。
- 优点：**表达力无上限**；模型对 HTML 极熟；第三方生态直接可用（MCP Apps）。
- 代价：样式自带 → 与纸墨/主题脱节；体积大（几十到几百 KB，且要进会话历史就要模型可见）；安全面大（脚本、外链、资源加载）；移动端/桌面端行为不一致。
- 对本页的判断：**只做逃生舱**。日常卡片是「每天很多张、要求快和一致」的东西，HTML 是「一个 App 一块画布」的东西。

### 2.3 内容块式（本文推荐）

- 形态：`CardDoc = { kind, blocks[], actions[], meta }`；`blocks` 是**平的**内容块列表（不分行列、不嵌套），每块一种内容形态，渲染器把它画成 DIVA 纸墨下的标准组件。
- 与 A2UI 的关系：同样「JSON 描述 + 宿主渲染」，但词汇从「UI 控件」抬到「内容形态」，模型不必懂布局；与 OpenClaw 的关系：同样是「宿主给画布」，但画布是固定的、内容是数据的。
- 关键性质：**新增一种块 = 一次发版；新增一张卡片 = 零发版**（只要它由已有块组成）。这正是「agent 自己创作」与「构建期客户端」之间的唯一交点。

### 2.4 第四个参考：openhanako 的三段式（最近的先例）

本机 `C:\Users\Administrator\Music\openhanako`（Electron 桌面 agent）把这件事做成了三段流水线，是目前最接近「我们要的」实现：

1. **服务端投影**：`server/block-extractors.ts:15` 一张 `BLOCK_EXTRACTORS`（键=工具名，值=把工具结果折成内容块），统一入口 `extractBlocks` 在 `:421`，未注册工具返回空数组；直播与历史回放走同一入口（`routes/chat.ts:1308`、`routes/sessions.ts:1579`）。
2. **中间 schema**：`ContentBlock` 判别联合（`chat-types.ts:227–292`），客户端只认块类型。
3. **客户端注册表**：`block-renderers.ts:11–15` 的 `Record<string, FC<{block}>>`，未注册块 `return null`（`AssistantMessage.tsx:288–291`）。

它另外开了两条「任何内容」的通道：`show_card`（agent 写 HTML 片段 → 宿主包壳 → `iframe sandbox="allow-scripts"`，CSP 16 条锁死联网/子框架/表单，`cards.ts:22–39`）与 `hana_card_guide`（把一份 400 行的设计手册作为工具返回值注入，让模型按宿主词汇表写卡）。**结论：块流水线 + 受控 HTML 逃生舱是已被实现过的组合，不是纸上方案**；我们要做的是把它的「块」换成更小更稳的 13 种内容形态，把逃生舱推迟。

### 2.5 修订（2026-11-14 18:20，网络恢复后补查）：社区已经有两个实现

代理关闭后 `dsh-plugin.org` 恢复可达，补查到两个**直接相关**的现成插件，它们分别把「声明式卡片」与 §2.2 的「HTML 画布」两条路都实现过了：

| | dsh-genui | dsh-visualize |
| --- | --- | --- |
| 仓库 | `omdsh-dev/dsh-genui`（npm `@changfenhuang/dsh-genui`） | `nagi-ovo/dsh-visualize` |
| 许可 / 体量 | MIT / 974★ / v0.16.0 / 2026-11-11 推送 | BSD-3-Clause / 343★ / 2026-11-08 推送 |
| 形式 | 模型在回复里写 ` ```dsh-ui ` fence，内容是**严格白名单 JSON**，客户端渲成可交互组件 | 模型调 `visualize(path, title?, mode?)` 写一段 **HTML 片段**，Web UI 在**沙箱 iframe** 里渲染 |
| 表达力 | 30+ 组件：stat / table（排序筛选、bar/ring/spark）/ timeline / diff / steps / file tree / callout / echart（20 预设 + 原生 option）/ plot（函数图 + 滑块实时重绘）/ mermaid / 3D / carousel / 音视频 / KaTeX / quiz / map / 会话 dock | 任意 HTML/CSS/JS：模拟器、图表、对比面板、UI 稿 |
| 动作回流 | **有**：带 `action` 的控件把事件打包回模型；连续拖动做 trailing-edge 防抖 | **没有**：README 明写「卡片内的按钮目前不能向主对话发消息」 |
| 安全 | 白名单 JSON、零脚本注入、禁收集密码；同轮校验失败把诊断回灌模型自纠 | 不透明源 iframe + CSP 禁网/禁子页/禁表单，只允许固定 CDN 静态资源 |
| 持久化 | 会话内指纹 LRU 200 块；跨会话 replay 明确**不做**（重置更自然） | 从**已持久化的工具结果**恢复卡片，不依赖原文件仍在 |
| DSH 版本 | `^0.2.0-rc.1 \|\| ^0.2.1-rc.1 \|\| ^0.2.2-alpha.2`，且 `check:host-api dsh-v0.2.1-rc.5` 明列 rc.5 | 站点标 verified，未给 dshTarget |
| 资产化 | 可导出独立 `.html` 与 `.genui.json`；提供 `@changfenhuang/dsh-genui/embed`（`GenuiBlock` / `processGenuiSpec`）供别的 React 宿主内嵌 | 片段文件 + 持久化工具结果 |

（站点页面是 dsh-plugin.org 的二次改写，README 是一手来源；以上以 README 为准，站点只用于发现。）

**对 §0 结论的影响**：

1. 「agent 自己创作卡片」在 DSH 上**已经有人做完**，两种范式各一个：genui = 声明式 JSON（精神上接近 A2UI，但用 fence 承载、没有跨端协议负担）；visualize = HTML 逃生舱（与 OpenClaw 同款）。**所以 E1 的真问题不再是「自研哪种」，而是「复用哪个 + 自研哪一层」。**
2. genui 的词汇比本文的 13 块大得多（30+），且已有动作回流、同轮纠错、主题链、导出。自研 13 块剩下的价值只有两处：**视觉与纸墨一致**、**能放在页面列里而不是只活在回复里**。
3. genui 是「回复内」形态：卡片属于某条 assistant 消息。日常页三栏要的是「页面级卡位」，两者不同层——但它有 `panel: true` / `/panel` 的**会话 dock 面板**，是最接近页面的形态，值得实测。
4. visualize 的「按钮不能回话」正好印证本文 C4：**动作回流是难度分界线，不是可选装饰**。

**修订后的推荐（对应新增 E9/E10）**：

- **页面卡（Today / 任务 / 悄悄话）自研块词汇表**：视觉与布局归属明确，且这块本来就小。
- **回复内卡不重复造**：复杂图表/交互优先复用 genui；只想要「可交互但不必回话」的 HTML 逃生舱时，visualize 更省。
- **可选第三条**：日常页用 `@changfenhuang/dsh-genui/embed` 渲染同一份 `dsh-ui` 规范，一鱼两吃——代价是耦合第三方组件库与主题链，**未验证**。

### 2.6 对照表

| 维度 | A2UI | OpenClaw HTML/MCP App | 内容块（推荐） |
| --- | --- | --- | --- |
| 表达力 | 高（布局+组件） | 最高（任意） | 中高（13 种形态 + 组合） |
| agent 生成质量 | 中（要懂布局） | 中（要懂安全边界） | **高**（只挑形态） |
| 单卡 token | 中 | 高 | **低**（几百字节） |
| 视觉一致性 | 中（依赖 catalog 实现） | **差**（自带样式） | **高**（宿主统一） |
| 安全面 | 中 | **大** | **小**（无代码无样式） |
| 工程量 | 大 | 中 | **小**（一个渲染器） |
| 持久化/重放 | 要存 surface 状态 | 存 HTML（大） | 存 JSON（小） |
| 跨端 | 强 | 弱（WebView 差异） | 无诉求（DSH 只有 Web 栈） |

补充一行证据：openhanako 的 `ContentBlock` 判别联合有 15 种块（`chat-types.ts:227–292`），其中 `settings_confirm` 用 `cardType: 'toggle'|'list'|'text'` 让**同一张卡由数据决定控件形态**——这是「块词汇表」路线的现实上限：块可以带一点形态参数，但仍在固定枚举内。

## 3. 推荐设计

### 3.1 三层

```
kind（卡型，语义层）：news_today / task_board / insight / digest / alert …
blocks（内容块，形态层）：13 种，平铺、可重复、有顺序
doc（文档，载体层）：{ v, id, kind?, title?, tone?, blocks[], actions[], meta }
```

- **卡型**决定「这张卡是什么」（尺寸、默认块、语义色、图标），由宿主注册；agent 可省略 `kind` 直接给 `blocks`（自由卡）。
- **块**是唯一允许 agent 自由组合的层。
- **doc** 是持久化与渲染的单位。

### 3.2 块词汇表（首批 13 个）

| 块 | 用途 | 关键 props |
| --- | --- | --- |
| `text` | 一段话 | `text`, `size`(sm/md/lg), `tone` |
| `list` | 条目列表（可勾选） | `items[{text, done?, meta?}]`, `ordered?` |
| `kv` | 键值对（详情/元信息） | `items[{k, v}]` |
| `table` | 表格（对比、看板行） | `columns[]`, `rows[][]`, `align?` |
| `metrics` | 指标组（身体信号那种） | `items[{label, value, unit?, delta?, trend?}]` |
| `progress` | 进度条 | `value`, `max?`, `label?` |
| `steps` | 步骤格/流程 | `items[{label, state}]` |
| `timeline` | 时间线（安排、历史） | `items[{time, title, body?, state?}]` |
| `chart` | 柱/折线 | `type`, `series[{name, points[{x,y}]}]`, `axis?` |
| `image` | 图片/封面 | `src`, `alt`, `fit?`（`src` 限附件或白名单） |
| `links` | 来源/参考链接 | `items[{label, href, meta?}]` |
| `quote` | 引用/原文摘录 | `text`, `cite?` |
| `actions` | 行动按钮 | `items[{id, label, style?, payload?, confirm?}]` |

不做的块：`html`（进逃生舱）、`form`（第一期不做输入）、`video/map`（长尾，走逃生舱或后续加块）。

### 3.3 CardDoc schema（草案）

```ts
type Tone = 'plain' | 'info' | 'ok' | 'warn' | 'danger' | 'brand'

type Block =
  | { t: 'text'; text: string; size?: 'sm' | 'md' | 'lg'; tone?: Tone }
  | { t: 'list'; items: { text: string; done?: boolean; meta?: string }[]; ordered?: boolean }
  | { t: 'kv'; items: { k: string; v: string }[] }
  | { t: 'table'; columns: string[]; rows: string[][]; align?: 'left' | 'right' }
  | { t: 'metrics'; items: { label: string; value: string; unit?: string; delta?: string; trend?: 'up' | 'down' | 'flat' }[] }
  | { t: 'progress'; value: number; max?: number; label?: string }
  | { t: 'steps'; items: { label: string; state: 'done' | 'now' | 'todo' }[] }
  | { t: 'timeline'; items: { time: string; title: string; body?: string; state?: 'done' | 'now' | 'todo' }[] }
  | { t: 'chart'; type: 'bar' | 'line'; series: { name: string; points: { x: string; y: number }[] }[]; axis?: { y?: string } }
  | { t: 'image'; src: string; alt: string; fit?: 'cover' | 'contain' }
  | { t: 'links'; items: { label: string; href: string; meta?: string }[] }
  | { t: 'quote'; text: string; cite?: string }
  | { t: 'actions'; items: { id: string; label: string; style?: 'primary' | 'quiet'; payload?: Record<string, string | number>; confirm?: string }[] }

interface CardDoc {
  v: 1
  id: string
  kind?: string                 // 省略即自由卡
  title?: string
  subtitle?: string
  tone?: Tone
  blocks: Block[]
  meta?: { source?: string; at?: string; author?: 'agent' | 'user' | 'system' }
}
```

### 3.4 约束与降级

- 硬限制：`blocks ≤ 24`、单块条目 ≤ 50、单字符串 ≤ 2000 字符、文档 ≤ 8KB、块不嵌套（结构上不可能递归）。
- 未知块 / 字段越界 / 校验失败 → **降级为 `text` 块**（把原文或关键字段打出来），不抛错、不白屏。
- `image.src` 只允许 `attachment:` 引用与白名单 https；`links.href` 只允许 http(s)。
- 不含任何样式字段；颜色只通过 `tone` 语义枚举。

### 3.5 主题映射

`tone` 六值映射到纸墨的语义色（墨、蓝、绿、赭、朱、品牌渐变），由渲染器决定具体色值；**agent 不能指定颜色、字号、圆角**。这样换肤、深色模式、纸墨调整都只改渲染器一处。

### 3.6 动作面

- `actions` 只回传 `{ id, payload }`，宿主白名单校验后**回流成用户输入**（与 A2UI 的 `action` 同构，但词汇封闭、可枚举，成本低）。
- 不做：任意 JS、外链跳转以外的副作用、表单提交。
- turn 生命周期问题（是否开新 turn）单列为决策项 E6。

### 3.7 资产化

- **模板**：`kind` 自带默认块与写作提示，agent 用 `card_emit({ from: 'news_today', data })`。
- **自由卡**：agent 用 `card_emit({ blocks })`。
- **保存**：`card_save` 把 doc 存进 storage 域（id + `v` + `meta.createdBy`），可列举、可复用、可用户编辑。
- **渲染历史**：优先内联快照（文档随事件走，历史不漂移）；引用 id 仅用于「复用/收藏」。

### 3.8 agent 生成质量

- 给 agent 一份「卡片写作指南」（skill 或系统提示片段）：每种块的一句话说明 + 3–4 个 few-shot + 「不超过 6 块」「标题像人话」之类的硬规则。
- 校验失败时回 **可读错误**（哪块、哪个字段），让 agent 自己修一次——这是把「模型会写错」变成「模型能修好」的关键，比事后人工改便宜。

## 4. 卡点

- **C1 新增块型是发版**：客户端是构建期产物（`pnpm` 打包 → `/plugins` 分发），块词汇表扩容需要改插件并重启宿主。这是词汇表路线的固有成本，靠「13 块够用 + 逃生舱」控制。
- **C2 文档的模型可见性**：卡片文档若随工具结果进会话，会进模型上下文（几百字节到 8KB）。要么接受（限制 8KB），要么引入只展示、可重放、**不进模型上下文**的事件——后者需要新的 session 事件类型与 SDK 投影。
- **C3 逃生舱的安全面**：iframe 沙箱、CSP、资源白名单、postMessage 协议，任一没做好就是 XSS/数据外泄。第一期可以完全不装逃生舱。
- **C4 动作回流**：卡片按钮要变成「用户说了一句话」，涉及 turn 生命周期（是否新开一轮、能否打断在跑的 turn）。这是全链路里唯一的真难点——现成的 `dsh-visualize` 就卡在这里（README 明写按钮不能回话），而 `dsh-genui` 花了整条「双向 action event loop + 防抖」才做到。
- **C5 长尾内容**：视频、地图、实时股票、交互式表单不在 13 块里；要么加块，要么走逃生舱，要么降级为链接。第一期建议「降级为链接」。

## 5. 决策清单（不拍板不实施）

| 编号 | 问题 | 选项 | 推荐 | 影响面 |
| --- | --- | --- | --- | --- |
| E1 | 卡片定义形式 | A2UI / OpenClaw HTML / 内容块 | **内容块** | 决定后续全部工作量 |
| E2 | 是否装 HTML 逃生舱 | 第一期装 / 以后再说 / 不装 | **以后再说**（先不装） | 安全面与工程量 |
| E3 | 首批块范围 | 13 个 / 砍到 8 个 | 13 个（`chart`、`image` 可延后） | 渲染器工作量 |
| E4 | 卡片文档落点 | 工具结果内联 / 独立展示事件 / storage | **内联（≤8KB）+ storage 供复用** | 上下文成本与可重放性 |
| E5 | 是否要卡型（kind） | 只要自由块 / kind+自由块 | **kind + 自由块** | agent 生成质量 |
| E6 | 动作回流 | 只读（第一期）/ 按钮回流 | **第一期只读，E6 另议** | turn 生命周期 |
| E7 | 主题自由度 | tone 枚举 / 允许颜色 | **tone 枚举** | 换肤与深色 |
| E8 | 生成质量手段 | 只靠 schema / 加写作指南 + few-shot | **加指南 + few-shot** | token 与首次成功率 |
| E9 | 回复内卡片是否复用 `dsh-genui` | 复用 / 自研同名能力 / 不用 | **先装来试，页面卡仍自研** | 省下 30+ 组件与动作回流 |
| E10 | 是否装 `dsh-visualize` 作逃生舱 | 装 / 不装 | **不装**（无动作回流；需要时再说） | 安全面与维护面 |

## 6. 参考

- A2UI v1.0 与消息集（2026-11-13 抓取，本轮未复核）：https://a2ui.org/concepts/messages/ ；发布公告 https://developers.googleblog.com/a2ui-10-build-delightful-fast-reliable-agentic-experiences/
- OpenClaw 退役提交（2026-11-13 抓取，本轮未复核）：https://github.com/openclaw/openclaw/commit/6f88c26dcf823a6d5c99a6053316829edc1a6512
- 本仓前轮报告：[agent-ui-protocols.md](agent-ui-protocols.md)、[agent-ui-widgets-port.md](agent-ui-widgets-port.md)
- 本仓现有派发机制：`deepseek-harness/packages/client/ui-tool/README.md`（`tool.call.toolview` 按 wire tool name 注册 + generic 兜底）
- 社区插件（2026-11-14 18:20 访问，一手来源为仓库 README）：
  - dsh-genui https://github.com/omdsh-dev/dsh-genui （条目页 https://dsh-plugin.org/plugins/omdsh-dev/dsh-genui ）
  - dsh-visualize https://github.com/nagi-ovo/dsh-visualize （条目页 https://dsh-plugin.org/plugins/nagi-ovo/dsh-visualize ）
