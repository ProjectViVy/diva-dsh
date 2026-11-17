# 日常页接入预研：Superagent 聊天面、三块布局、能力来源

- 日期：2026-11-14 18:40（Asia/Shanghai）
- 性质：只读预研。**未改任何代码/配置/依赖**；只写 `docs/` 与 `TODOLIST.md`。
- 用户已定的三件事：① 日常页的聊天区未来接 Superagent，**必须避免代码块与杂七杂八的工具调用**；② 页面分块 = Today / 任务 / 悄悄话；③ 只调研，不动代码。
- **分块决策的原话（2026-11-14 17:44:13，`session-52c2f98d-74b8-4644-8081-c160ec66361c` seq 773）**：*「页面分块我想的是：today（现在就是，主要是一天中 agent 提醒用户应该注意的事情，可能是新闻小卡片，或者是一些建议之类）任务（主要是主人的一些长期任务相关，例如说项目看板）悄悄话（在用户目标之外，agent 洞察发现用户的一些小贴士，同时也有可能是关于一些 agent 自身的改进的想法…主要关心的是 agent 的自主性。diva 是主体化框架，这是一个最符合核心理念的设计，在《心流》自主能力系统与《野兔》情绪系统上线之前，这个暂时不用理）」*。**补记（2026-11-15 15:4x）**：用户明确「记忆页不用留、能力页应该也不用」——现在页面上的 Today / 任务 / 记忆 / 能力 四页是照搬 OpenToday 原型（`plugins/dsh-daily/client.js:4-7`），不是本决策；15:5x 定稿为**三页 Today / 任务 / 悄悄话**，悄悄话先做占位（`docs/logs/2026-11-daily/v0.3.0-three-pages/`）。
- 方法与限制：本机 `read`/`grep` 取证；**外部网络本轮整体不可用**（`dsh-plugin.org` 等域名被解析到 198.18.0.0/15 保留网段，`web_fetch` 私网校验直接拒绝），因此插件生态盘点**零产出**，相关结论一律标「未核实」。

## 0. 结论

**聊天区不该重造一个聊天。日常页要的是「她对你说话」，不是「她的工作现场」。**

1. Superagent 自己已经有这条纪律，而且是**结构性**的：它的对外消息只有四类——`acknowledgement`（确认收到）、`answer`（回答）、`result`（结果）、`attention`（需要你决定），全部经 `Outbox` 按规则发送；执行细节（工具、diff、命令）从来不走这条通道。原话：*"It speaks only when a person must act or can use a result… It stays quiet while it works."*（`superagent/docs/000-philosophy.md:12`）
2. 所以「避免代码块和杂项」不是靠过滤，而是**不订阅那条流**。日常页的聊天区应该只显示：上面四类消息 + DSH 会话里的 `assistant` 文本。工具调用、思考链、命令回显在这一页**没有渲染入口**。
3. 三条可选路线，成本递增：
   - **A 只读**：读 Superagent 的面板 HTTP API（`/orchestrator/api/overview|tickets|ticket/<id>`），把「需要你决定的事」渲染成卡片；聊天区先接主会话的纯文本。**零改动上游，今天可做。**
   - **B 第三视图**：日常页注册自己的 Conversation View（`events.register({ target: 'daily', match: { 'user/message', 'assistant/message' } })` + 自己的 View builder），只把文本块渲染出来——DSH 正规扩展点，能流式显示，且结构上不含工具节点。**注意三个硬坑**：`assistant/message` 里 `kind: 'reasoning' | 'tool-call'` 的块必须滤掉、节点只能 `visibility: 'hidden'` 不能删、`assistant/live-chunk` 会被 `settle-assistant` 整批替换（详见 §3.6）。
   - **C 双向频道**：给 Superagent 加一个 `daily` Source 类型（官方 cookbook 支持的扩展点），让日常页成为它的第五个 Channel，收发四类消息。**最干净，但要维护 patch。**
4. 三块的数据来源：Today ← `schedule` 定时简报 + agent 写的卡片；任务 ← Superagent 的 tickets（项目看板）+ `todo_write`/`goal`（个人长期任务）；悄悄话 ← **暂缓**（等《心流》自主能力系统与《野兔》情绪系统上线，见 §5）。
5. `dsh-plugin.org` 18:20 后恢复可达：**检索本身不可用**（搜索/筛选/分页都是前端 JS，服务端只按 stars 吐每类前 12 条），但足以确认几件事——卡片渲染已有现成实现（`dsh-genui`），页面承载有现成服务（`dsh-better-sidebar` 的 `ctx.betterSidebar`），看板有现成实现（`dsh-taskboard`），资讯日报有现成范本（`dsh-bili-scroll`）；**可达样本里没有日历/RSS/天气/新闻聚合类插件**（不能断定不存在）。PEN/PENS 仍是「外设总线」，解决「agent 怎么操作外部应用」，不解决「日常页显示什么」。
6. **「接 supervisor」= 接 main Session 本身，它已经是 DIVA**（§3.7）：superagent main Session 挂载 `laputa:persona` + 记忆是项目目的（worker 不挂）；不需要第二个 supervisor，也不需要另建「DIVA 专用会话」。剩下的只是呈现问题（工具行不渲染）与「两个可编辑 root」的硬限制。另外「genui 只在日常生效」用全局安装做不到（全局系统提示 + 全局 DOM 观察），等价做法是**不装、把 spec 当线格式、渲染放日常页、规范按 scope 注入**（§3.8）。

## 1. 口径

- 「聊天区」= 日常页左栏，与用户对话的那一列。
- 「杂项」= 工具调用卡、命令回显、diff、文件读写、思考过程、失败重试日志。
- 「接 Superagent」= 用户在这页说的话进入 Superagent 的域，Superagent 的回答/结果/提问出现在这页。

## 2. Superagent 已有的「成果面」（证据）

### 2.1 四类对外消息

`superagent/docs/007-architecture.md` 的 `Replies` 部件写得很直白：*"Channel writes through the `Outbox`: the acknowledgement, the answer, the result and the attention message, each by the rule that allows it"*；同一文档的 `reply(request)` 也把它固化成枚举：**`acknowledgement` / `answer` / `result` / `attention`**。

这四类正好就是「日常页该出现的四件事」：收到了、答完了、交结果、请你决定。**没有任何一类是「我正在跑第 7 个工具」。**

### 2.2 「需要人」是它的一等公民

- 面板的第一问就是 *"Does anything need me now?"*（`005-panel.md:9`），第二个问题才是健康与历史。
- 原则里写着 *"Quiet by default. Healthy states take no extra space."*（`005-panel.md:57`）。
- 领域模型里 `Attention` 是明确定义的状态（`001-domain.md:101`：待人工决定）。

也就是说：日常页 Today 那一栏想表达的「今天该注意的事」，Superagent 已经有一份结构化答案。

### 2.3 可读的 HTTP 面

`superagent/src/app/http.ts:231` 起：要求 loopback（`host !== '127.0.0.1'` 直接抛错）、只挂在 Web 服务器的 `/orchestrator` 前缀下、只接受 `/orchestrator/api/`、并校验同源（`sameOrigin`：Host 必须是 `127.0.0.1:<port>` 或 `localhost:<port>`，且必须带 `x-orchestrator-request: 1`）。

可用路由里与本页直接相关的：

| 路由 | 用途 |
| --- | --- |
| `GET overview` | 需要人处理的事 + 24h 活动计数 |
| `GET tickets`、`GET tickets/:id` | 工单列表与详情（项目看板的原料） |
| `GET threads`、`GET threads/:key` | 会话线索 |
| `GET decisions` | 判定与理由（「她为什么这么做」） |
| `GET ticket/<id>/transcript`、`/result`、`/report/<assignment>` | 单个工单的执行记录与结果 |

**含义**：一个同源的浏览器页面直接 `fetch('/orchestrator/api/tickets', { headers: { 'x-orchestrator-request': '1' } })` 就能拿到数据，不需要新造桥。

### 2.4 扩展点是真的

`008-cookbook.md` 的「Add a Source」把新增一种 Source 的四个责任写全了（翻译事件、接收与授权规则、回复与上下文、轮询循环），并指明照 `src/sources/github.ts` 写。**「日常」作为第五个 Channel 走的是正规扩展点，不是改内核**——代价是要留在 `patches/superagent-*.patch` 里维护。

## 3. 聊天区的三条路线

| | A 只读面板 | B 第三方 Conversation View | C 新增 `daily` Source |
| --- | --- | --- | --- |
| 用户能看到什么 | 卡片（tickets/attention）+ 主会话纯文本 | 主会话的 user/assistant 文本，流式 | Superagent 四类消息 + 卡片 |
| 用户能说什么 | 能：`ctx.sessions.scope(id).conversation.send(text)`（已核实，见 §6 G4） | 能（它就是会话输入） | 能（成为 Trigger） |
| 工具噪声 | 结构上没有 | 结构上没有（View 只 match 两类事件） | 结构上没有（Channel 只有四类） |
| 改动面 | 只写日常页插件 | 日常页插件 + 注册 View/Definition | 日常页插件 + superagent patch |
| 上游风险 | 无 | 依赖 `uiConversation` 公开契约（D2 之后的预稳定 API） | 依赖 superagent 内部结构（Source 契约较稳，但仍是 patch） |
| 工期估计 | 1–2 天 | 3–5 天 | 5–8 天 |
| 主要风险 | 只能看不能聊，体验断裂 | 与内置 Chat 抢占 binding、流式与重放细节 | patch 漂移；Channel 地址语义要新设计 |

**推荐组合：A 先上（把「今天该注意的事」变成真卡片）→ B 补对话（日常页自己的安静视图）→ C 留到「她真的需要主动找你」那天**。理由：A 立刻让页面有内容，B 才是聊天区，C 的价值（四类消息的完整语义）在 A/B 之后才显现。

### 3.5 现成的噪声过滤写法（三个本地项目的实证）

这三个项目都解决过同一问题，可直接借形：

| 项目 | 写法 | 证据 |
| --- | --- | --- |
| openmuse | **工具消息根本不进流**：只渲染 `role === 'user' \| 'assistant'`；代码块降级为纯文本、图片降级为 alt | `apps/mobile/src/chat.tsx:486`、`assistant-response.tsx:20–38` |
| OpenDots | **通配渲染 + 默认 null**：`useRenderTool({ name: '*', render: ... })` 只给 `computer_*` 出卡，其余返回 `null`，未注册工具天然隐形 | `src/client/Chat.tsx:230–246` |
| openhanako | **单一谓词 + 两级折叠**：`CARD_BACKED_TOOL_NAMES` 一个 Set 决定「有卡就不显示调用」，工具组折叠成一行摘要，连续纯过程消息折成「忙活了一阵子 · N 个工具」 | `utils/tool-call-visibility.ts:5–36`、`ToolGroupBlock.tsx:34–67`、`process-fold.ts:200–257` |

对日常页的含义：**B 路线不用从零设计过滤**——照 OpenDots 的「未注册即隐形」+ openhanako 的「一个 Set 决定谁有卡」，就能做到「只有人话和卡片」。

### 3.6 DSH 侧的三种落地形态（已核到代码）

| 形态 | 做法 | 代价 | 证据 |
| --- | --- | --- | --- |
| ① 借官方壳 | `sessions.retain(target)` → `<SessionProvider>` → `renderFactorySlot('conversation.content', { variant: 'embedded' }, { slots: { views } })` | 最省（ui-subagent 的样板约 200 行）；但**默认渲染全部工具卡与推理**，只能靠 presentation mode 折叠，做不到「只出人话」 | `packages/client/ui-subagent/src/client/sidebar-chat/index.tsx:109,145–165`；本仓既有结论 `docs/research/encounter-chat-and-session.md:11–18` |
| ② 自建 target + View | `ctx.uiConversation.events.register({ kind, target: 'daily', match: { 'user/message': fn, 'assistant/message': fn }, start/update, buildViewNode })` + 自己的 View builder | 滚动/流式/空态全自己写；手写 JS 拿不到模块增强的类型 | `event-registry.ts:74–116`、`assembler.ts:907–915`；同族做法见 `ui-trajectory` |
| ③ 直接读事件流 | `retain` 后读 `binding.eventSource` 自己过滤 | 成本最低、证据最弱：该面注释只面向 Conversation 装配，业务插件能否长期依赖**未见授权**；且 `replace/prepend/append/settle-assistant` 四种变更都要自己扛 | `contract/events.ts:116–117`、`assembly.ts:112–138` |

②的关键细节（都会决定成败）：

- **「助手文本」不是一种事件**：`assistant/message` 的 content blocks 里 `kind` 是 `'text' | 'reasoning' | 'tool-call'`——只 match 事件不够，`buildViewNode` 里必须再按 `kind === 'text'` 过滤，否则工具名与参数原文会漏出来（`ui-chat/.../assistant.ts:59–63`）。
- **`user/message` 混着非人类输入**：`data.source.kind !== 'user'` 的要单独滤掉（`conversation-nodes/message.ts:66–110`）。
- **节点删不掉**：已物化的节点只能返回同 key 的 `visibility: 'hidden'`，直接删会抛错（`assembler.ts:986–998`）。
- **fallback 是全局单例**，已被 ui-chat 占用，日常页抢不到（`event-registry.ts:39–43`）。
- **流式是客户端瞬态事件** `assistant/live-chunk`，会被 `settle-assistant` 整批替换；按 seq 追加或按 key 永久缓存的视图必然重复或漏字（`contract/events.ts:98–106`、`assembly.ts:141–158`）。

### 3.7 「接入 supervisor 主编排」该接谁（2026-11-14 20:10，用户追加要求）

用户要求：日常页左栏接入 Superagent 的 **supervisor 主编排**；genui 若生效**只在日常**生效。据此重读了 Superagent 的角色与提示词机制。

**事实（证据）**

- Superagent 只有**两个角色**、且主编排是**单例**：`dsh-superagent-router` 给 main Session，`dsh-superagent-worker` 给执行器（`docs/006-deployment.md:15`、`docs/003-execution.md:29`）；启动时「ensures the main Session exists」（`docs/007-architecture.md:33`）。**没有 per-surface / per-channel 的编排实例概念。**
- 它的职责被提示词写死：**"The main Session only routes"**——只转发 Trigger 与路由事实，不做技术决定；**"The main Session does not wait"**，禁止 sleep 与长等待（`docs/004-prompts.md:77–78`）。手上 14 个工具全是 tickets / policy / prompts（`docs/007-architecture.md:492`）。
- 提示词**是全局可配置的**：三段团队段（communication / scope / delivery）+ 所有内建 part 可覆盖 + 版本化 + `orchestrator_prompts_save`（`docs/004-prompts.md:7,38`、`src/app/prompts.ts:13`）。**没有「哪个入口」这个维度。**

**结论：日常页该接的就是 main Session 本身——它早就是她了。不需要第二个 supervisor，也不需要另建一个「DIVA 专用会话」。**

口径（用户 2026-11-14 20:44 明确，已落 `docs/architecture.md:77` 注）：**superagent main Session 接 DIVA（人格 + 记忆 + 语气）是项目目的；worker Session 不接。**「独立人格」指的是另立一个身份，不是禁止挂人格。

| 问题 | 现状 | 应然 |
| --- | --- | --- |
| main Session 有无人格 | **有**。`dsh-laputa` 对每个顶层 agent 注入 `laputa:persona` + onboarding + `laputa_init`（`plugins/dsh-laputa/src/adapter.ts:70–113`）；门槛只看 `isTopLevelAgent`（`origin !== 'subagent' && delegationDepth === 0`，`top-level.ts:9–11`），superagent 建主会话不传 subagent 来源（`superagent/src/app/sessions.ts:138–147`） | 与意图一致，保留 |
| worker 有无人格 | **也有**（同一批注入，worker 同样是顶层会话） | **应排除**：执行器不该带着人格去改代码 |
| 编排纪律 vs 人格 | 两段并存：`laputa:persona` + 「The main Session only routes / does not wait」（`docs/004-prompts.md:77–78`） | 不矛盾，但措辞把身份窄化成「路由员」；应在提示词层改为「她是 DIVA，编排是她的职责之一」 |

由此，前面 A/C 两案的重估：

| 方案 | 判断 |
| --- | --- |
| **接 main Session（推荐）** | 符合原意：日常页说话的就是她。剩下的只是**呈现问题**——工具行/推理不渲染（§3.6 的 ② 自建视图）以及「两个可编辑 root」的硬限制 |
| 另建「DIVA 专用会话」 | 不取：那会变成两个她，且她不会自动知道 tickets |
| 新造第二个 supervisor | 不取：状态分裂 |

**要修的不是架构，是两处实现**：① laputa 的注入范围按 preset 收窄（保留 `dsh-superagent-router`，排除 `dsh-superagent-worker`）；② router 提示词的措辞（它现在是「只路由」，应改成「她负责编排」，用人格为主语）。

### 3.8 「genui 只在日常生效」能不能做到（同一轮核对）

**做不到「装了但只在日常渲」。** 装成插件后：(1) 宿主半把卡片写作规范注入**全局**系统提示（`.workspace/genui/src/plugin/index.ts:93`）；(2) 客户端半是**全局 DOM 观察者**，只排除侧栏/面板/工具行，没有按会话白名单（`.workspace/genui/src/client/dom-fence.tsx:196,199,210`）。

**可行的等价做法**：不全局装 genui；把它的 spec 当线格式，**渲染放在日常页**（薄渲染器），卡片写作规范按 scope 注入到日常会话——DSH 的 `systemPrompt.section()` 支持 scoped 注册（`packages/core/system-prompt/src/index.ts:471–486`），ActMem 已用过同一机制按 agent 分叉。代价：日常里只有我们实现的约 16 种内容节点，没有 3D/地图/图表交互族——但日常页本来也不该出现这些。

## 4. 页面三块与数据来源

| 块 | 用户原话 | 数据来源（现状可用的） | 卡片形态（对应上一份报告） |
| --- | --- | --- | --- |
| **Today** | 「一天中 agent 提醒用户应该注意的事情，新闻小卡片、建议」 | `schedule` 每日简报 + agent 写的 `insight` 卡 + Superagent `attention` + web 抓取的资讯 | `news_today`（links + text + image）、`alert`（text + actions） |
| **任务** | 「长期任务，例如项目看板」 | Superagent `tickets`（项目/工单维度）+ `todo_write`（个人短期）+ `goal`（会话目标） | `task_board`（table + progress + steps）、`task_card`（kv + progress） |
| **悄悄话** | 「目标之外 agent 的洞察、小贴士、自我改进想法；关心 agent 的自主性」 | **暂缓**：等《心流》自主能力系统与《野兔》情绪系统上线 | `insight`（quote + text + actions） |

「悄悄话」为什么先不做：它要的不是数据源，是**主体性**——agent 要能形成「我注意到了你没说的事」并承担说出来的后果。这属于《心流》的自主能力与《野兔》的情绪评估；在那之前做，只会得到一个「随机建议」栏目。

## 5. 能力接入现状盘点

### 5.1 本仓与 DSH 已有

| 能力 | 载体 | 对日常页 |
| --- | --- | --- |
| 定时提醒 | `packages/schedule`（Host-owned，到期以普通 follow-up 消息进入原会话） | Today 的「早安简报」就用它，不需要新调度器 |
| 会话内待办 | `packages/todo`（`todo_write`，随会话持久，组内无 UI） | 任务块的短期条目 |
| 会话目标 | `packages/goal` | 长期任务的另一来源 |
| 记忆 | `dsh-mempalace`、`dsh-local-memory` | 提醒的上下文（「上次你说…」） |
| 看屏幕 | `dsh-see-now` | Today 的「你屏幕上正在做的事」 |
| 语音 | `dsh-local-voice`、`dsh-local-asr` | 「悄悄话」的形态之一（以后） |
| 人格 | `dsh-laputa` | 说话风格 |

### 5.2 缺的

- **资讯源**：没有现成的新闻/订阅插件。最省的做法是 agent 在 `schedule` 任务里用 web 工具抓取并写成卡片，而不是引入聚合服务（省一个依赖、省一份凭据）。
- **项目看板**：Superagent 的 tickets 是「别人请她做的事」；「主人自己的长期项目」目前没有载体，要么新建一个 storage 域，要么先用 `goal`/`todo` 顶着。
- **第三方插件**：见 §5.4（18:20 网络恢复后已补查）。

### 5.4 社区插件（2026-11-14 18:20 补查，`dsh-plugin.org` 可达后）

站点是二次改写，能装与否以各自仓库 README 为准；以下按「对日常页有没有用」排。

| 插件 | 站点描述要义 | 对日常页 |
| --- | --- | --- |
| **dsh-bili-scroll**（1376★，2026-11-09） | 每天替你刷 B 站：按关键词搜、读完整字幕判断值不值得看、写 Markdown 摘要、@ 你 | **Today 资讯卡的现成范本**：定时抓取 → 判断 → 摘要 → 通知，正是「新闻小卡片」的形状 |
| **dsh-genui**（974★） | 回复内 `dsh-ui` 白名单 JSON，30+ 组件 + 动作回流 + 导出 | 回复内卡片直接复用（见 card-spec §2.5） |
| **dsh-visualize**（343★） | `visualize` 工具写 HTML 片段 → 沙箱 iframe 卡，无动作回流 | 逃生舱备选，暂不装 |
| **modlens**（4919★） | 给纯文本模型装眼睛：贴图得结构化 JSON（OCR/版式/语义） | 「悄悄话」日后看图的能力来源 |
| **dsh-im**（3506★）/ **dsh-qqbot**（577★，腾讯官方）/ **dsh-wechat**（428★） | IM 通道（飞书/微信/QQ/钉钉） | 与 DV-DOC-001「IM 统一网关」相关，属另一条线 |
| **dsh-better-sidebar**（5092★，v0.30.1） | 右栏工作台，暴露 `ctx.betterSidebar`（`registerTab` / `registerFileViewer`）让别的插件注册新页，另有 `sidebar_open` 工具 | 若「日常」想从 `main` 槽位换成右栏页，这是现成承载。**注意版本约束**：0.1.7 线须钉 `0.22.1`（peer `^0.1.7-rc.1`），caret 跨 minor 在 0.2.0 宿主会被启动兼容预检静默禁用 |
| **dsh-taskboard**（327★，`shengsheng90/…`） | SQLite + claim/review + 原生 Web UI + CLI 的任务看板 | 任务栏的另一种承载；与 Superagent tickets 二选一或并存（F4）。注意同名的 `cloader/dsh-taskboard`（83★）是另一款，别混 |
| **dsh-automation**（103★） | 按计划在**全新会话**里跑任务，Web/Agent 双管理日程，保留运行历史 | 与 `schedule` 能力重叠；差别在「开新会话跑」还是「在原会话投消息」，可作 Today 简报的调度备选 |
| **answer-me-with-html**（6249★，skill） | 模型只写 Markdown 草稿，由自带 CLI 渲成单页 HTML，省 ~7/8 输出 token | 「卡片正文由 agent 写、外壳由工具渲」的省 token 思路，可借 |
| **huashu-design**（29265★，skill） | 一句话出网页/原型/PPT/信息图，84 种风格库 + 设计评审 | 与「日常卡视觉」弱相关；它的风格库不适合纸墨，不建议直接引 |

结论：**资讯卡有现成范本（bili-scroll），页面承载有现成服务（better-sidebar），看板有现成实现（taskboard），回复内卡片有现成实现（genui）**——但没有任何插件提供「三栏日常页」本身，那一层仍然要做。

方法学提醒（子代理实测）：该站搜索/筛选/分页**都是前端 JS，服务端不过滤**（`?q=`、`?category=`、`?page=` 返回内容逐字相同），每类只 SSR 出按 stars 排序的前 12 条；`api.dsh-plugin.org` 的 JSON 端点取不到。所以「可达样本里没有 RSS / 日历 / 天气 / 新闻聚合 / 浏览器自动化」是**我看不到**，不是**不存在**；同样，我没有下「全站没有 A2UI 实现」这种结论。

### 5.3 PEN / PENS 在这件事里的位置

按本仓既有结论（`docs/research/pens-design.md`、`workbench-landscape.md` §10）：PENS = **应用接线总线 + 接线清单**，管的是「agent 怎么操作外部应用（Blender、浏览器、模拟器）」，明确不做视图层、不持状态、不管人格与记忆。

所以：**PEN 不解决「日常页显示什么」**；它解决的是「日常页里那张卡片能不能点开一个外部应用」。两者正交，别混。

## 6. 卡点

- **G1 会话归属**：日常页要显示「哪个会话」？用户在别处新建的会话、还是这页专用的常驻会话？这决定了 binding 是固定的还是可切的。
- **G2 两个可编辑 root 打架**：DSH 明确不支持同一 Session 同时挂载多个可编辑 root；草稿存在**持久化的 per-session store** 里（跨会话、跨刷新存活），两个 composer 会抢同一份草稿。所以日常页若也要输入，只能：a) 主面板不打开同一会话；b) 日常页用只读 composer（`SubagentReadOnlyComposer` 那种）；c) 日常页只做发送、不做常驻输入框。（本仓既有结论：`docs/research/encounter-chat-and-session.md:18,194`；`ui-conversation/src/client/contract/views.ts:19–25`）
- **G3 流式与重放**：`assistant/live-chunk` 是瞬态事件，`settle-assistant` 会整批替换成持久事件；窗口变更还有 `replace/prepend/append/settle-assistant` 四种，且 `revision` 不是 +1 时必须整窗重建。自建 View 只要按 seq 追加或按 key 永久缓存，就必然重复或漏字（`contract/events.ts:98–106`、`assembly.ts:112–158`）。
- **G4 写权限**：**已核实有入口**——`ctx.conversation.send(text)`（`ui-conversation/src/client/service.ts:53`）把一句话作为队列 turn 发进调用方 scope 的会话；未带 scope 时抛错并提示 `ctx.sessions.scope(id).conversation`（`service.ts:40` 附近）。同一服务还提供 `cancel()`、`loadOlder()`、`updateQueue()`，所以「日常页发一句话」不需要新的桥。
- **G5 四类消息的落地**：Superagent 现在把 acknowledgement/answer/result/attention 写回**原来的 Channel**（GitHub/Feishu），GUI 不是 Channel。要走 C 路线才有「写进日常页」这件事。
- **G6 上下文成本**：卡片与简报都进会话历史就会进模型上下文；Today 每天几条可能没事，但要在设计时定上限。

## 7. 决策清单（不拍板不实施）

| 编号 | 问题 | 选项 | 推荐 |
| --- | --- | --- | --- |
| F1 | 聊天区路线 | A / B / C / A→B→C | **A→B，C 以后再议** |
| F2 | 日常页绑定哪个会话 | 固定专用会话 / 跟随当前选中会话 / 可切换 | **固定专用会话**（「日常」就是一个房间） |
| F3 | Today 的资讯来源 | agent 抓取 / 借 bili-scroll 模式 / 引入第三方聚合 | **借 `dsh-bili-scroll` 的模式**（定时抓取 → 判断 → 摘要 → 通知），内容自己抓 |
| F4 | 任务块数据源 | Superagent tickets / 新建看板存储 / 两者并存 | **先 tickets，个人项目用 goal 顶** |
| F5 | 悄悄话是否先做 | 先做占位 / 完全不做 | **完全不做**（等心流/野兔） |
| F6 | 是否现在给 Superagent 加 `daily` Channel | 是 / 以后 | **以后**（等 A/B 跑通、需求明确） |

## 8. 未核实

- `dsh-plugin.org`：全站 24,681 条只看了 UI / Tools / Integrations 三类的第 1 页（各 12 条）+ 6 个详情页，**未穷举**；该站搜索/筛选/分页都是前端 JS，服务端不过滤，`api.dsh-plugin.org` JSON 端点取不到 → 无法做全站检索。`dshTarget` 字段在 4 个详情页里均未渲染，兼容状态只能给 verified/unconfirmed（且站点自称 confirmed 24681 / unverified 0，徽章没有区分度）。
- 上述插件**均未安装实测**（未改 profile、未重启宿主），「能装/能跑」仍以本地验证为准。
- OpenMuse / OpenDots / openhanako 三个本地参考项目的**运行期**行为（子代理只读源码，未启动、未跑构建）。
- 官方语义上有没有「只读 attach」开关：只确认了「替换 composer 成只读提示」这一种做法（`ui-subagent/src/client/SubagentReadOnlyComposer.tsx:19–30`）。
- Superagent 面板 API 在 GUI 同源下的实际调用（未起服务实测；`sameOrigin` 要求 Host 为 `127.0.0.1:<port>` 或 `localhost:<port>` 且带 `x-orchestrator-request: 1`）。
- 业务插件长期依赖 `SessionBinding.eventSource` 是否被允许（注释只面向 Conversation 装配，未见授权）。
- Superagent 创建会话的确切 API 行（只确认了 `resolveAgent` / `ensure` 路径与主会话 id 的持久化形态）。
