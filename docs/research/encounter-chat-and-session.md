# 相遇界面接入聊天输入框与 Session：预先调研

- 状态：调研结论，未改任何代码
- 日期：2026-11-06
- 调研对象：「相遇」面板（`plugins/dsh-live2d`）+ DSH Web 客户端的会话/composer/slot 机制 + superagent 的两个 agent preset
- 关联：[角色舞台 README](../../plugins/dsh-live2d/README.md)、[Superagent 003 Execution](../superagent/docs/003-execution.md)、[companion-mode-and-fish-tone](companion-mode-and-fish-tone.md)
- 本地取证：`deepseek-harness/packages/client/*`（DSH checkout）、`plugins/dsh-live2d`、`plugins/asr`、`superagent/cordis.patch.yml`

## 1. 结论摘要

1. **「相遇」现在完全不在会话体系里。** 它是 `main` 槽位的一个 keyed 面板（`scope: 'root'`，`plugins/dsh-live2d/src/client.js:288`），只有 canvas + 底栏，没有任何 session 绑定。要挂聊天，得由插件自己「开一条会话、绑一个引用、渲染会话内容」。
2. **DSH 已经有一套现成的「把某个会话嵌进别的地方」样板**：`ui-subagent` 的右侧栏聊天（`sidebar-chat/index.tsx:145`）。整件事 202 行：`retain` 一个会话引用 → `SessionProvider session={reference}` → `renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, { slots: { views } })`。官方正文和 composer 一起来，视图可换成本地组件。**这是相遇窗口最省的做法。**
3. **微信式输入框拿不到现成插槽。** DSH 默认 composer 里的「加号」不是槽位，是 `InputBar.tsx:452` 硬编码的命令菜单按钮；`conversation.composer.bar`（composer 本体）已被 `ui-conversation` 独占认领，`InputBar` 没有对外导出，`conversation.composer` 这条 chain 官方只允许「Remote 请求 pending 期间临时接管」。所以「语音按钮在左、按住说话、加号在右」只有两条路：**自建 composer**，或者**按 sessionId 永久接管 composer chain**（偏离官方纪律，见 §7 决策 2）。
4. **气泡样式不能靠占位实现。** 消息行的外观在 `ui-chat` 的 `MessageItem` + 哈希 CSS module 里；`conversation.chat.user.content`（factory）与 `conversation.chat.flow`（single）都已被 ui-chat 认领。可行路线是**注册一个新的 `conversation.view`**（自带气泡渲染），再在相遇窗口的本地 `views` 槽位里强制选中它——普通会话的 Chat 视图不受影响（`ui-trajectory` 就是这个模式）。
5. **「superagent 主执行器」有两个候选，必须先定。** superagent 在 `cordis.patch.yml` 里声明了两个 preset：`dsh-superagent-worker`（名字是「dsh-superagent 执行器」，工具最全、含读写 fs/subagent/web）和 `dsh-superagent-router`（「dsh-superagent 主 Session」，fs 只读、无 subagent/web/todo）。**你说「完全权限」，那更像 worker；但「主」字指向 router。** 这一条决定工具面，见 §7 决策 1。
6. **「完全权限」是另一根轴**，跟 preset 无关：它是 DSH 内置权限预设（`ui-permission-presets`，中文标签「完全权限」），按会话用 `/permission <preset>` 切换，或改通用设置里的默认值（只影响之后新建的会话）。
7. **语音可以直接复用 `dsh-local-asr`**：它已经有一整条链路和 HTTP 面 `POST /dsh-asr/api/asr/transcribe`（`plugins/asr/src/http.mjs:62`），相遇的「按住说话」只要自己采集 → base64 WAV → 调它即可，不必再养一套识别引擎。采集代码目前埋在 `asr/src/client.js` 里，没有导出（见 §5）。
8. **有一个必须先绕开的硬约束**：DSH 明确「不支持同一 Session 同时挂载多个可编辑 root」。相遇窗口渲染的会话如果同时被主面板打开，就是两个 composer 抢一个 draft 编辑器。§7 决策 2 的方案必须把这条算进去。

## 2. 现状：「相遇」是什么

| 面 | 位置 | 现状 |
| --- | --- | --- |
| 主面板 | `main` 槽位 keyed，`key: 'live2d'`（`src/client.js:288`） | Live2D 舞台：canvas + 底栏（状态点、复位、刷新） |
| 侧栏入口 | `sidebar.panellist`，`order: -10`，标签「相遇」（`src/client.js:289`） | 排在「插件」（order 0）上方；名字被 `dsh-vivy-studio/sidebar-core.js` 引用 |
| 设置板块 | `settings.section`，`order: 20`，标签「角色」（`src/client.js:292`） | 模型目录、已导入模型、档案摘要 |
| HTTP | `/dsh-live2d/api/*`（`src/http.mjs`） | `state` / `stage` 写视角 / `profile` / `library` / 模型素材 |
| 配置 | `$DSH_HOME/live2d/config.json`（0600） | `enabled` / `model` / `speechStyle` / `stage.views[模型名]` |

关键性质：

- **`main` 是 `scope: 'root'`**（`ui-layout/src/client/index.ts`），面板按 `panelInfo.activePanelId` 做 keyed 分派（`AppFrame.tsx:42`），所以切换面板会卸载当前面板组件。判断「相遇是否在前台」可以读根级 `panelInfo` hook（`ui-layout/src/client/index.ts:176`）。
- 插件 `dsh.client.inject` 目前是 `[]`（`plugins/dsh-live2d/package.json`）。要用 `ctx.sessions` / `ctx.uiConversation`，必须补 inject 并重建客户端 bundle + 重启 DSH。
- 已有测试盯着三个面和视角数学：`tests/live2d.test.mjs`（含「客户端注册三个面：相遇面板、侧栏入口、设置板块」等用例），改注册结构要同步改它。

## 3. DSH 的槽位地图（与本次相关的部分）

`main` 是 keyed/root；`shell.overlay` 是 list/root，**帧级浮层、默认点击穿透**（`ui-layout/src/client/index.ts:105`，渲染于 `AppFrame.tsx:249`）——这就是「可拖动的浮动聊天窗口」唯一合适的落点（ui-chat 的额度提示就挂在这里）。

composer 相关的槽位（定义在 `ui-conversation/src/client/contract/slots.ts`）：

| 槽位 | kind / scope | 谁占着 | 能不能为我们所用 |
| --- | --- | --- | --- |
| `conversation.content` | **Component Factory**，session-maybe | ui-conversation（`ConversationContent.tsx`） | ✅ 可被任意宿主实例化，`variant: 'embedded'`；本地槽位 `views` / `widthControls` 由调用方选组件 |
| `conversation.composer` | chain，session | 默认没条目（走 fallback） | ⚠️ 官方只允许 Remote 请求 pending 期间接管；但 owner currency 里有 `sessionId` |
| `conversation.composer.bar` | single，session-maybe | **ui-conversation（InputBar）独占** | ❌ |
| `conversation.input.left` | list，session | 空 | ✅ 可加控件（在左工具行） |
| `conversation.input.right` | list，session | 空 | ✅ 可加控件 |
| `conversation.input.activity` | single，session | `ui-local-asr` 的麦克风 | ⚠️ 只有一位，抢了会撞 ASR |
| `conversation.input.permission` / `.plan` / `.model` | single，session | 各自插件 | ❌（默认占位者已在） |
| `conversation.input.overlay` / `.dock` / `.attachments` | list/single，session | input-trigger / ui-attachment | 视需要 |
| `conversation.view` | list，session | ui-chat（`chat`）、ui-trajectory | ✅ 注册一个「气泡」视图 |
| `shell.overlay` | list，root | 额度提示、账户页等 | ✅ 浮动窗口 |
| `conversation.chat.*` | factory/single/keyed | ui-chat | ❌ 消息行外观改不动 |

默认 composer 的「加号」事实（`ui-conversation/src/client/skeleton/InputBar.tsx`）：

- `:452` 一个 `+` 按钮，`aria-label` 是「命令」，点开命令菜单；同处一个 hidden `<input type="file">` 负责附件（`:456-462`）。
- 工具行结构：`+` → 权限 → 计划 → `renderSlot('conversation.input.left')`（`:469`）。右侧：`renderSlot('conversation.input.right')` → 模型选择 → `conversation.input.activity` → Stop/Send（`:472-475`）。
- 也就是说，**默认布局是「加号在左」，不是微信的「加号在右」**，而且 `+` 与编辑器同属一个内部组件，插件无法只搬 `+`。

## 4. 会话接入：怎么开「这个特殊 session」

### 4.1 superagent 的两个 preset（事实）

`superagent/cordis.patch.yml`：

| preset id | 显示名 | 工具面 | 出处 |
| --- | --- | --- | --- |
| `dsh-superagent-worker` | dsh-superagent 执行器 | persona 段 + agent-instructions + shell(bash/pwsh，前台 5s 转后台) + fs(可读可写可编辑) + fs-search + jobs + skills + compaction + **delegation(subagent)** + todo + web(仅 search) | `:20-124` |
| `dsh-superagent-router` | dsh-superagent 主 Session | 只读 fs、无 subagent/web/todo/plan/goal/workflow，`complete` 提示词无 persona 段 | `:125-` |

两者都写着「不供手动选择」。`superagent/docs/003-execution.md` 的措辞：Executor Session 用 `dsh-superagent-worker`，**以操作者 OS 用户身份、不经审批地跑命令**；主 Session 用 `dsh-superagent-router`，工具面更小。

> 结论：**「完全权限」这句话与 worker 一致，与 router 矛盾**（router 连 fs 写都没有）。而「主执行器」四个字同时踩到两个名字。这是本次唯一必须先拍板的产品事实。

### 4.2 客户端建会话的 API（可用）

`api/session-controller` 的 client 面（`src/client/contract/sessions.ts`）：

- `ctx.sessions.create({ workspaceId?, cwd?, sessionId?, agentPreset? }): Promise<SessionId>`（`:88`）——**指名 preset**；同 id 的空白会话会被复用，已开始的不会被改动。省略 `workspaceId` 就是「默认工作区」。
- `ctx.sessions.retain(target, { source })` → `SessionReference`（给 `SessionProvider` 用）；`ctx.sessions.list` / `retainInfo` 可观察状态。
- `ctx.sessions.scope(id): AgentContext | undefined`（`:148`）——拿到会话作用域上下文，`scoped.get('conversation')` 就是该会话的 `IConversation`。
- `agentPreset` 是会话投影（`api/session-controller/src/agent.ts:367`），所以**能反查「哪个会话跑的是哪个 preset」**，相遇面板可以「找已有的特殊会话，找不到再建」。
- 模型：省略即可用默认（新会话默认值在设置里）。

### 4.3 权限：完全权限怎么落

`ui-permission-presets`：内置四个（仅可查看 / 工作区内修改 / 完全权限 / 自动审查-EXP）。当前会话通过命令切：该插件内部就是 `live.command('/permission ' + preset)`。通用设置里的那行只改「之后新建会话的默认值」。所以相遇的特殊会话有两条落地方式：建会话后自己提交一次 `/permission <preset>`，或者让使用者在设置里把默认值改成「完全权限」。

### 4.4 发消息的两条路

| 路线 | 调用 | 能力 | 代价 |
| --- | --- | --- | --- |
| A 官方提交面 | 会话标准道具 `inputActions.setDraft(text)` + `inputActions.submit()` | 命令裁决、附件、乐观回显、Queue/Steer 全部语义 | 需要该会话的官方 composer 已挂载（编辑器在位） |
| B 直发 | `ctx.sessions.scope(id).get('conversation').send(text)` | 一行把文本作为一轮 prompt 送进去（内部 `session.prompt([{type:'text',text}], 'queue')`，`ui-conversation/src/client/service.ts:211`） | 没有命令菜单/附件/回显；要自己读状态画气泡 |

（`IConversation` 还有 `cancel()` / `loadOlder()` / `updateQueue()`，见 `ui-conversation/src/client/service.ts:40-71`。）

## 5. 语音「按住说话」能复用什么

`dsh-local-asr` 已经把难的部分做完了：

- 浏览器侧：`MediaRecorder` 采集 → `OfflineAudioContext` 重采样 → 16k 单声道 PCM16 WAV（`plugins/asr/src/client.js` 顶部，`encodeWave` 等）。
- 识别：`POST /dsh-asr/api/asr/transcribe { audio: base64, language }` → 文本（`plugins/asr/src/http.mjs:62`）；还有 `/asr/catalog`（就绪状态、时长上限）、`/asr/prepare`（下模型）。
- 它挂的是 `conversation.input.activity`（`asr/src/client.js:329`）——**single 槽位**，相遇如果也想占这个槽位就会撞车；但相遇的麦克风在自己的 composer 里，不冲突。

因此「按住说话」= 自己的按钮 + 那 80 行采集代码 + 一个 HTTP 调用。采集代码没有导出，要么复制一份，要么提到 `plugins/_shared/`（或让 asr 端出一个可 `import('/dsh-asr/capture.mjs')` 的资源）。

## 6. 浮窗与气泡

### 6.1 浮动聊天窗口

- **落点**：`shell.overlay`（帧级、点击穿透、条目自己开 pointer-events）→ 可拖到任何位置、不被面板裁切；缺点是切走「相遇」后仍会显示，需要读 `panelInfo.activePanelId` 自己收起来。也可以退一步：窗口就放在相遇面板内部（`position:absolute`），代价是被面板边界裁切。
- **没有现成的可拖动窗口件**。DSH 里只有拖动相关的先例：`ui-dockkit/src/components/pointer.ts`、`ConversationWidthControls`（正文宽度拖拽条）、`AppFrame` 的侧栏拖拽。拖动/缩放/边界夹取要自己写（pointer capture + 视口夹取），几何可以照 `stage.views` 的样子存进插件自己的 `config.json`（每个角色一份）。
- **「扩大」**有两种语义：把浮窗最大化到面板大小；或者直接 `ctx.uiWorkspace.openSession(sessionId)` 把它当普通会话在主面板打开。

### 6.2 气泡

- ui-chat 的消息行、工具卡、分组、滚动都在 `MessageItem.tsx` + CSS module 里，没有槽位可换成气泡；`conversation.chat.user.content` 是一个 factory（已被 ui-chat 注册定义）、`conversation.chat.flow` 是 ui-chat 自己 `conversation.view` 注册声明的 children（**声明即认领**），第三方都无法改。
- **可行路线**：注册一个新的 `conversation.view`（如 id `bubble`，参照 `ui-trajectory/src/client/index.ts:79`），自带一个渲染组件；数据要么自己注册一个 View Definition/target，要么订阅已有的 `chat` target（`ctx.uiConversation.binding(id).target('chat')`，注意订阅即激活该 target）。然后**只在相遇窗口里**通过 `conversation.content` factory 的本地 `views` 槽位把它选上（`FixedChatConversationView` 的写法，`ui-subagent/src/client/sidebar-chat/index.tsx:110`），普通会话仍显示官方 Chat。
- 副作用：`conversation.view` 的注册项会进「视图标签栏 / 更多会话视图」菜单，即普通会话里也会多出一个气泡视图入口。可以接受（当作「气泡视图」开关），也可以只把它注册成相遇窗口专属——但后者需要更绕的写法，见 §7 决策 2。
- 数据可达性有一处需要实现时验证：ui-chat 用 `ctx.uiSession.provide({ hooks: ['chat'], resolve: binding => ({ hooks: { chat: chatSource(binding) } }) })`（`ui-chat/src/client/apply.ts:130`）把 `chat` 快照开成会话级标准源；第三方注册怎么声明并消费这个 hook（`inject` 里的 `hooks:` 隔间），要在写代码时对着 `ui-session/src/client/index.ts:566-597` 的装配逻辑确认一次。

## 7. 三个必须先拍板的设计决策

> **2026-11-06 已拍板**：决策 1 选 **B**（`dsh-superagent-router`）、决策 2 选 **A**（自建 composer）、
> 决策 3 选 **A**（新建专属会话并持久化 sessionId）。
> 决策 1 与「完全权限」的张力仍在：router 的工具面是只读 fs、无 subagent/web/todo/plan/goal；
> 权限预设那根轴可以给「完全权限」，但工具面由 preset 决定。要两者兼得就得上 C（加一条相遇专用 preset），
> 先按 B 走——preset 只是配置里的一个字符串，将来换它不影响其它部分。

### 决策 1：特殊会话跑哪个 preset？

- **A. `dsh-superagent-worker`（推荐）**：符合你说的「完全权限」（读写 fs、shell、subagent、web search），有 persona 段可挂汐的人格；代价是它就是「干活的执行器」，不是编排者。
- **B. `dsh-superagent-router`**：符合「主 Session」的字面，但它 fs 只读、无 subagent/web/plan/goal，「完全权限」做不到了（除非改 preset 或其配置）。
- **C. 两者都不是，另建一个相遇专用 preset**（在 superagent 或本仓库里加一条 `@deepseek-ai/dsh-agent-preset`），如果「相遇」既要人格、又要完全权限、又不想假装自己是工单执行器，这条路最干净，但多一份要维护的 YAML。

### 决策 2：微信式输入框怎么来？

| 方案 | 做法 | 得到 | 失去 | 风险 |
| --- | --- | --- | --- | --- |
| ① 自建 composer（推荐） | 自己的输入条（语音左 / 文本中 / 加号右），发送走路线 B（`scope().get('conversation').send`）或路线 A；官方 composer 不渲染 | 100% 自由的手感与气泡 | 命令菜单、附件语义、Queue/Steer、乐观回显要自己补 | 与官方行为长期分叉 |
| ② 官方 composer + 局部加件 | 用 `conversation.content` factory 的官方正文+composer，只在 `conversation.input.left/right` 加「语音」按钮 | 全部官方语义、成本最低 | **做不到微信布局**（加号在左、按住说话无法替换编辑器） | 产品形态与需求不符 |
| ③ 按 sessionId 永久接管 `conversation.composer` chain | selector 里判断 `owner.sessionId === 特殊会话` 才接管，组件自建 | 同一个会话在主面板和相遇窗口都是微信式；不改动别的会话 | 仍需自建完整 composer | 偏离官方「只在 pending 请求期间接管」的纪律；`owner.sessionId` 是否够用要确认 |

另外，无论选哪个，**浮窗里的会话如果同时在主面板打开，会出现两个可编辑 root**（DSH 明确不支持）。规避：浮窗默认不渲染官方 composer（等于选 ①/③），或在浮窗打开时禁掉主面板那一份。

### 决策 3：特殊会话是「找现成的」还是「自己建一条」？

- 自己建：`ctx.sessions.create({ agentPreset })` 一次，把 `sessionId` 落进插件配置（`$DSH_HOME/live2d/config.json`），之后复用；可以按 `agentPreset` 投影反查是否还在。
- 找现成的：如果想让相遇直接对着 superagent 正在用的主 Session/工单 Session 说话（例如 QQ 那头是同一条链），那就不该新建，而应该按 preset/工单去「认领」一条已有会话——**语义完全不同，需要你先说清楚想要哪种**。

## 8. 建议的落地顺序（待决策后执行）

1. **会话管道**：client inject 补齐（`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-session`、`@deepseek-ai/dsh-client-ui-chat`、`@deepseek-ai/dsh-client-ui-layout`）+ 宿主侧存 `chat.sessionId` / 浮窗几何；**先做一个最小验证**：相遇面板里嵌一个 `conversation.content`（官方正文+composer）接通会话，跑通「打字 → 回复」。这一步就能把 §7 决策 3 的坑先探出来。
2. **浮窗骨架**：`shell.overlay` 里的窗口 + 拖动/缩放/夹取 + 几何持久化 + 跟随 `panelInfo.activePanelId` 显示/隐藏。
3. **气泡视图**：注册 `conversation.view`，在相遇 occurrence 的本地 `views` 里强制选中。
4. **微信式 composer**：按决策 2 的结论实现；语音按钮先接 ASR（§5）。
5. **验收**：`node --test tests/live2d.test.mjs`（要同步新增用例）、`node preview-live2d/server.mjs` 真浏览器、`oil_ui_shoot` 留证据；注意本轮改动需要重启 DSH 才能验证（client bundle 要重建）。

## 9. 未验证 / 风险清单

- 「第三方插件能否 require `@deepseek-ai/dsh-client-ui-chat/client` 等」——机制上 `dsh.client.inject` 就是为此设计的（`dsh-client-modules`），但本仓库现有插件全是 `inject: []`，**没有先例**，属于第一次吃螃蟹。
- `chat` hook 的消费声明形式（§6.2）与 `owner.sessionId` 在 composer chain 里的可用性（§7 决策 2 方案③）都只在类型/文档层面确认过，运行时要验一次。
- 气泡视图会让普通会话的视图标签栏多一项（若无法只对相遇生效）。
- 相遇面板渲染的会话若同时在主面板打开 → 双可编辑 root 冲突。
- 「完全权限」与 preset 的关系：worker preset 的注释只说「以操作者身份不经审批跑」，实际审批仍由宿主的 approval policy（当前是 `ask`）与文件沙箱（当前 `workspace-write`）决定，需要建完会话后用 `/permission` 显式切一次才算数。

## 10. 落地进度（第一段已完成）

第一段只做「会话接得上、消息发得出」，微信式输入条与气泡留到下一段。

| 项 | 位置 | 状态 |
|---|---|---|
| 会话 id / preset / 浮窗几何的配置面 | `src/chat-window.mjs`（纯函数：夹取、规范化、写请求校验）、`src/store.mjs`（`chat` 段）、`src/index.mjs`（接线） | ✅ |
| `GET /api/state` 带 `chat`（含夹取上下限）、`POST /api/chat` 写回 | `src/http.mjs` | ✅ |
| panel 声明 session 子槽位、建/认会话、拿引用、卸载释放 | `src/client.js` 的 `main` 注册与 `EncounterPanel` | ✅ |
| 浮窗：拖动 / 缩放 / 铺满 / 收起，松手才落盘 | `EncounterChatFrame` | ✅ |
| 浮窗里渲染官方会话正文与输入条 | `EncounterChat` → `renderFactorySlot('conversation.content', { variant: 'embedded', phase: 'active', hero: false })` | ✅ |
| 客户端依赖边 | `package.json`：`dsh-api-session-controller` / `dsh-client-ui-conversation` / `dsh-client-ui-session` | ✅ |
| 用例 | `tests/live2d.test.mjs`：+2 条（配置面夹取与校验、面板建会话并包 Provider） | ✅ 23/23 |

实现时改掉的一处设计：浮窗**没有**放进 `shell.overlay`，而是 `.l2d-panel` 的孩子、与舞台区平级。
原因是舞台把拖动/滚轮/双击监听挂在 `canvas.parentElement`；浮窗若住在舞台区里，要么在聊天里拖一下
就带着角色转，要么得在浮窗根上 `stopPropagation` 掐掉指针事件——而 React 的合成事件挂在根容器上，
掐冒泡会连官方输入条的指针处理一起掐死。平级之后互不干扰，代价是浮窗跟随面板显隐（切走「相遇」就看不见），
这反而正好符合「相遇界面的聊天窗」这个定位。

## 11. 下一段（未开始）

1. **气泡视图**：注册一个新的 `conversation.view`，在 `EncounterChat` 的本地 `views` 槽位里强制选中它；
   普通会话仍显示官方 Chat（视图会在「更多会话视图」里多一个入口，需接受或再想办法隐藏）。
2. **微信式输入条**：语音在左 / 按住说话 / 加号在右；发送走 `sessions.scope(id).get('conversation').send(text)`。
   一旦自建 composer，就要自己补：命令裁决、附件、Queue/Steer、乐观回显——这几项是官方 composer 免费给的。
3. **按住说话**：复用 `dsh-local-asr` 的 `/dsh-asr/api/asr/transcribe`；采集代码（MediaRecorder → 16k PCM16 WAV）
   目前在 `plugins/asr/src/client.js` 里没有导出，要复制或提到 `_shared/`。
4. **验收**：重启 DSH（宿主改了 `http.mjs`/`store.mjs`/`index.mjs`，必须重启）→ 刷新页面 →
   打开「相遇」看浮窗、打字、确认会话 id 落到 `config.json`、拖动/铺满后再刷新看几何是否记住。
