# SnowLuma 接线盘点与统一网关接入方案

- 状态：只出方案，**未改任何代码**；待确认第 6 节的三个决策
- 日期：2026-11-10
- 问题来源：用户要求「看清 snowluma 现在的接线，评估能否改造成统一化网关，并接入 [dsh-im](https://github.com/xmanrui/dsh-im)」
- 关联：[个人持久化 Agent 总体架构](../architecture.md)、[SurfCore 功能迁移现状](../feature-restoration.md)、[vivy-tone 落地计划](vivy-tone-plan.md)

> 本文把两类事实分开写：
> **【实测】** 是我在本机读代码 / 读运行态得到的，可复现；
> **【上游声明】** 来自 dsh-im 的公开文档（README / CONTEXT.md / PROACTIVE_DELIVERY.md / package.json，抓取于 2026-11-10），**我没有读它的源码**，
> 按外部数据处理，不作为本项目事实。

---

## 0. 本次运行的实测事实

| # | 事实 | 怎么核实的 |
| --- | --- | --- |
| 1 | 当前 GUI `127.0.0.1:3082` 由 **dev 模式的 `dsh web`** 提供：`apps/cli/src/bin.ts --profile superagent-local --no-open`（PID 17356） | `Get-NetTCPConnection -LocalPort 3082` + `Win32_Process.CommandLine` |
| 2 | 真实 `DSH_HOME` 是 **`.artifacts/dsh-home`**，不是 `~/.dsh` | 进程环境变量 `DSH_HOME` |
| 3 | 该 profile 只有 `superagent-local` 一个；`~/.dsh/profiles` 下那个孤立的 `desktop` 与本会话无关 | 列目录 |
| 4 | profile 已挂：`dsh-superagent`、`surfcore`（指向渲染产物 `.artifacts/surfcore-adapter/bundle`）、`surfcore-local-qq-mode`、`dsh-surfcore-adapter`，以及 memory / voice / asr / laputa / mempalace / evolution / live2d 等 | `profiles/superagent-local/package.json` |
| 5 | **dsh-im 未安装**（`node_modules/@xmanrui` 不存在，profile 依赖里没有） | 列目录 + 读 manifest |
| 6 | 适配器 / 语音 / 记忆 / ASR **都在跑**（各有 `runtime.json` 指向 `127.0.0.1:3082`） | 读 `<DSH_HOME>/<组件>/runtime.json` |
| 7 | **SnowLuma 未启动**（3000/3001 无监听），**QQ 桥接未跑**（`<DSH_HOME>/surfcore/runtime.json` 不存在，3100 无监听） | 端口探测 + 发现文件 |
| 8 | surfcore 的 `config.json` **没有 `snowluma` 段**，且 `platforms.start = {qq:false, bili:false}` | 读 `.artifacts/dsh-home/surfcore/config.json` |

**结论先行**：这条 QQ 链路现在是**刻意休眠**的。所以本次评估是纯静态的，不存在"改坏了正在跑的 QQ"的即时风险；但也意味着**任何改动都无法在本次会话里做端到端验证**。

---

## 1. SnowLuma 现在是怎么接的

### 1.0 先澄清：SnowLuma 是什么，不是什么

这一节是为了消掉一个常见误解——**「SnowLuma 是 agent 的手机 / 是给 agent 的工具」两种说法都不准确**，而误解会直接导致架构判断错位。

**它是**：一个独立的第三方 QQ 自动化程序（Windows，从 `github.com/SnowLuma/SnowLuma/releases` 下载，`launcher.bat` / `SnowLuma.exe` 启动），
用真实 QQ 号扫码登录后，**把那个 QQ 账号暴露成一个标准的 OneBot v11 服务器**（HTTP `:3000` / WS `:3001`）。
许可为「源码可见非商业」（非 OSI 开源，§5.4 禁止程序化启停）。【实测：`config.example.json` 的 `snowluma.downloadUrl`、`LICENSE` §99–151】

**它不是**：

| 误解 | 实际 |
| --- | --- |
| 「agent 的手机」 | 它不给 agent 一个设备或运行时沙箱。它给的是一个**真实 QQ 身份**（一个号码），让 agent 在 QQ 生态里"存在"：能被 @、能进群、能收发。类比更准确的是**一张 SIM 卡 + 一条短信网关**。 |
| 「给 agent 一个工具」 | 它提供的是**一层协议**（约 13 个被用到的 OneBot action），不是工具。工具是 SurfCore 在 MCP 层包装出来的（见 §1.0.1）。 |
| 「agent 靠调工具翻聊天记录」 | **不成立**。桥接自己主动补历史并组织好上下文再唤醒 agent（见 §1.0.2）。 |

它完全不知道 LLM、agent、工具、DSH 的存在。它唯一的对外接口就是 OneBot v11 的 action/event。
**所以它在架构里的位置 = 一个协议驱动**，与 dsh-im 内部的 `@tencent-connect/qqbot-connector` 属于同一层。

#### 1.0.1 三层必须分清

```text
QQ 私有协议 ──[SnowLuma]──► OneBot v11 action/event        ← 层 1：原始 API（约 13 个被用到）
                                  │
                          [SurfCore 桥接]                   ← 层 2：会话状态、未读、唤醒、补历史
                                  │
                        MCP 工具（agent 真正看到的）         ← 层 3：qq_* 工具
```

**层 3 的实际工具清单**（[`mcp-snowluma-safe.js`](../../plugins/surfcore/src/mcp-snowluma-safe.js)，agent 只看得见这些）：

`qq_status` / `qq_list_groups` / `qq_get_group_members` / `qq_get_group_history` / `qq_send_group_message` /
`qq_reply` / `qq_send_private_message` / `qq_get_prompt` / `qq_get_context_snapshot` / `qq_get_unread_messages` /
`qq_get_recent_messages` / `qq_social_state` / `qq_mark_read` / `qq_close_conversation` / `qq_set_wake_config` /
`qq_send_burst` / `qq_send_message`

两个反直觉的点：

1. **这些工具主体不是"读历史"，是"发送 + 管会话状态"。**
2. `qq_get_unread_messages` / `qq_get_recent_messages` **不打 SnowLuma**，读的是桥接自己的
   `/api/socialV2/unread`（SurfCore 维护的未读队列）。真正打 `get_group_msg_history` 的只有 `qq_get_group_history`，
   而且被守卫限制在"仅封闭 agent（管理员私聊）模式可用"（[`mcp-snowluma-safe.js:462`](../../plugins/surfcore/src/mcp-snowluma-safe.js)）。

#### 1.0.2 历史消息到底谁在拉

**是桥接主动拉的，不是 agent 反复调工具。** [`bridge.js:14264`](../../plugins/surfcore/src/bridge.js) 的 `runHistoryCatchUp()`：

- 触发点：QQ 账号上线（`online`）、连接成功（`connect`）、手动检查；
- 动作：对白名单会话调 `get_group_msg_history` / `get_friend_msg_history`；
- 去重：`messageId` + 时间水位；
- 结果：并入**未读队列**，之后由唤醒机制组织成提示词投给 DSH Session。

**agent 醒来时看到的是已经整理好的上下文**，不是"自己去翻聊天记录"。
所以 SnowLuma 的角色是**补漏通道**（上线时漏掉的那批消息），不是 agent 的记忆。

真正的"记住以前发生过什么"是三层，SnowLuma 是其中最小的一层：

| 层 | 承载 | 作用 |
| --- | --- | --- |
| DSH Session 历史 | 本会话对话本身 | 当前上下文 |
| ActMem / 记忆卡 | 跨会话的衰减记忆（[architecture.md](../architecture.md) §2.3） | 长期关系与事实 |
| SnowLuma 的 QQ 历史 | QQ 服务端近期若干条 | **只用来补漏**，有速率限制，且"是否实现取决于运行时" |

**结论**：统一网关要统一的是层 2 与层 3 之间的那条缝，**不是 SnowLuma 本身**。
把 SnowLuma "改造成网关"是错位的——它已经是全网关里最简单、最不该动的那一段。


### 1.1 物理拓扑

```text
                     ┌─────────────────────────────────────────────┐
  QQ 消息 ──────────►│ SnowLuma（第三方专有运行时，OneBot v11）      │
                     │   WS   :3001  (token A —— 桥接主链路)        │
                     │   HTTP :3000  (token B —— 工具/发送)         │
                     └──────┬───────────────┬──────────────────────┘
                            │ WS 事件        │ HTTP 动作（13 种 action）
      ┌─────────────────────┴──┐   ┌────────┴───────────────────────────────┐
      │ ① src/bridge.js        │   │ ② src/mcp-snowluma-safe.js  （MCP）    │
      │  16,218 行 / 873 KB    │   │ ③ src/mcp-host-server.js   （只读探活） │
      │  330 行涉 SnowLuma     │   │ ④ dsh-surfcore-adapter/src/egress.mjs  │
      └───────────┬────────────┘   └────────┬───────────────────────────────┘
                  │ 运行期锚点补丁注入        │ 出站（唯一有账本的一条）
                  ▼                         ▼
   scripts/lib/surfcore-bridge-hooks.mjs ──► Superagent 编排器
                  │                          SourceKind: `surfcore`
                  │ InputEnvelope / Effect / Receipt
                  ▼
        <DSH_HOME>/surfcore-adapter/  (POST /internal/ingest 等)
```

**【实测】边界的实际位置**：

- `plugins/surfcore` 是 **git 子模块**（上游 `Mieksido/surfcore`），本仓库不能直接改它。所有对桥接的接线都只能经
  [`scripts/lib/surfcore-runtime-transform.mjs`](../../scripts/lib/surfcore-runtime-transform.mjs)（792 行）在 setup 时**渲染**出
  `.artifacts/surfcore-adapter/bundle`，靠 `import { … } from <hooksUrl>` 把能力注入。
- 这个 indirection 是本文所有"能不能重构"判断的前提：**新代码只能往 hooks 里长，不能用常规重构动桥接内部。**

### 1.2 四个独立的 SnowLuma 客户端

| # | 位置 | 端点引用 | token 自愈 | 出站账本 | 错误分类 |
| --- | --- | --- | --- | --- | --- |
| ① | [`bridge.js:15872`](../../plugins/surfcore/src/bridge.js) | 64 处 | ✅ **唯一有** | ❌ | `status/retcode` + 426 提示 |
| ② | [`mcp-snowluma-safe.js:57`](../../plugins/surfcore/src/mcp-snowluma-safe.js) | 6 处 | ❌ | ❌ | `status/retcode` |
| ③ | [`mcp-host-server.js:48`](../../plugins/surfcore/src/mcp-host-server.js) | 6 处 | ❌ | ❌ | 只读探活 |
| ④ | [`egress.mjs:89`](../../plugins/dsh-surfcore-adapter/src/egress.mjs) | 12 处 | ❌ | ✅ **唯一有** | `definite` / `gone` / unknown |

共享的只有 [`snowluma-conn.js`](../../plugins/surfcore/src/snowluma-conn.js)（234 行：读 `onebot_<uin>.json` 发现 HTTP/WS 两个不同 token + 探活），
而**它只被 ① 引用**（另有 `probe-snowluma-heartbeat.mjs`、`test-snowluma-conn.mjs` 两个脚本；②③④ 都**没有** import 它）。

### 1.3 三个已验证的结构问题

**问题 1：桥接是一个没写进任何文档的「token 中介」。**
换 QQ 账号后 token 会变（SnowLuma 的 OneBot 配置按账号分文件，且 HTTP 与 WS 的 token **不同**）。
`discoverSnowLumaConnection()` 能自愈，但只在桥接里；桥接连上后把 token **写回 `config.json`**（[`bridge.js:16039`](../../plugins/surfcore/src/bridge.js)），
②③④ 再从文件里读。于是：**桥接没起来或没连上 → MCP 工具 401，而报错只会说 `retcode 1401`，不会告诉你"桥接没跑"。**
这是一条隐式的写入依赖，属于 [架构文档 §6.1](../architecture.md) 所说的"隐式写路径"。

**问题 2：同一个 QQ 有三条发送路径。**

| 路径 | 位置 | 有会话守卫 | 有账本/对账 |
| --- | --- | --- | --- |
| WS `bot.sendGroupMessage` | [`bridge.js:8944`](../../plugins/surfcore/src/bridge.js) | ✅ `captureSendGuard` | ❌ |
| HTTP `onebotSend` | [`bridge.js:9170`](../../plugins/surfcore/src/bridge.js) | 部分 | ❌ |
| HTTP `sendQq`（适配器） | [`egress.mjs:116`](../../plugins/dsh-surfcore-adapter/src/egress.mjs) | ❌ | ✅ |

只有第三条满足架构不变量 6（每个外部副作用有 Effect + Receipt，未知结果不盲重试）。
`escapeCqText()` 在 [`bridge.js:691`](../../plugins/surfcore/src/bridge.js) 和 [`egress.mjs:35`](../../plugins/dsh-surfcore-adapter/src/egress.mjs) 各写了一遍——复制的信号。

**问题 3：11 个裸 `fetch(`${httpUrl}/…`)` 散在一个 16k 行的 `main()` 里。**

```text
2331  2406  2455  2524  4135  7284  9196  9227  9254  12602  14087
```

涉及 13 个 OneBot action（`get_msg` / `fetch_ptt_text` / `get_status` / `get_mini_app_ark` /
`get_group_msg_history` / `fetch_custom_face_detail` / `get_image` / `send_group_msg` …）。
每处自己判 `status === 'ok' && retcode === 0`，只有部分带 426（端口指错）提示，都不写账本。

---

## 2. "统一化网关"到底缺什么

### 2.1 插槽已经存在，不要新造

[`superagent/src/sources/kind.ts`](../../superagent/src/sources/kind.ts) 的 `SourceKind` 就是那个统一网关契约：

```text
kind / title / description
schema + fields           ← 配置与 UI 表单
scope()                   ← 监听与观察范围
channel.allowed/send/link ← 出站唯一出口
threadContext             ← 给评估读有界上下文
policy                    ← 谁有权发起工作
health[]                  ← 健康条目所有权
environment / find / repliesTo / refreshLabels
```

已有三个实现：`githubKind`、`feishuKind`、本仓库的 `surfcore` kind。
**所以"改造成统一网关"这个提法本身要找对层次**——把 SnowLuma 塞进 SourceKind 是错位的，SnowLuma 不是渠道，它是 QQ 的传输层。

### 2.2 三个层次，分开评估

| 层次 | 现状 | 该不该统一 | 判断 |
| --- | --- | --- | --- |
| **A. SnowLuma 传输层** | 4 个客户端、11 个裸 fetch、token 中介 | **该** | 真债；与接不接 dsh-im 无关，本身就该还 |
| **B. 编排器 SourceKind** | 已统一（github / feishu / surfcore） | 已完成 | 不要再叠一层网关 |
| **C. IM 渠道层（dsh-im）** | 未接 | 只能先接出站 | 详见第 3 节 |

**A 层真正值得做的不是"合并四个客户端"，而是把 token 所有权变成显式的**：
让 `snowluma-conn.js` 的自愈 + 落盘成为一个有名字的持有者（独立模块或组件），②③④ 向它要端点，
而不是依赖"桥接恰好把 token 写回了文件"。

**A 层不建议做的**：把桥接的 WS 主链路也搬进统一网关。它是一处、能跑，并且带断线闸门、
`status.good` 接收链路自评、`bot_status` 上下线边沿（[`bridge.js:15893`](../../plugins/surfcore/src/bridge.js)）——搬走是高风险低收益。

### 2.3 追加（2026-11-10）：为什么"IM 直接接主编排器"是对的

用户提出这个方向后我回查了内核（`intake.ts` / `model.ts` / `executor/dsh.ts` / `docs/001-domain.md`），
**结论比本文初稿写得更乐观**：主线编排器本来就是为"多来源对话"设计的，不是只能跑 GitHub 工单。

**机制 1：对话连续性不需要自己实现。**

```text
workerSessionId = (ticketId) => `worker-${ticketId}`     // executor/dsh.ts:24
```

**一个 Ticket 对应一个稳定的 worker Session**，不是每次投递新建会话。于是"一个 QQ 群 = 一个 Thread = 一个 Ticket = 一个 worker Session"，
对话上下文天然连续。

**机制 2：只有第一条消息要走评估，之后不走。**

[`core/intake.ts`](../../superagent/src/core/intake.ts) 的 `receive()`：

- 一条消息先按 `Subscription` 扇出到该 Thread 上所有活着的 Ticket（`thread.subscriptions`）；
- **扇出到了就不进 Eval**（`if (!this.owners(trigger).length) this.queueForEval(trigger)`）；
- 消息作为 `Input` 直接投进那个 Ticket 的 worker Session。

**机制 3：Ticket 结束不等于对话结束。**

[`docs/001-domain.md`](../../superagent/docs/001-domain.md) 的 Subscription 定义：
**"An ended Ticket keeps its Subscriptions … a person's message resumes it under the same Mandate, with no Eval or Decision"**。
人发的新消息会把结束的 Ticket 重新唤起来，**用同一份授权、不重新决策**，仍进同一个 worker Session。

**所以"IM 直接接编排器"能直接白拿五样东西**：统一 ingress（InputEnvelope）、统一 egress（`channel.send` + 账本）、
统一授权（Policy 一条规则管所有渠道）、统一恢复（Effect/Receipt）、主动行为统一（候选 → Policy）。
而且闲聊不会退化成"每条消息一张工单"——那是初稿里我的误判。

**但接之前必须先定三条规则，它们都不在内核里：**

| # | 问题 | 内核现状 | IM 下必须补的规则 |
| --- | --- | --- | --- |
| R1 | 一个 Thread 可能有**多个活票**，多个 worker 同时订阅 → 同一句话多份回复 | 内核**没有**"一 Thread 一活票"约束（`001-domain.md`：「It may have several Tickets」） | Policy 必须挡住：该 Thread 已有活票时不再接受新票 |
| R2 | 每个**新 Thread 的第一条消息**要走一次 Eval（模型调用）才算准入 | 设计如此 | 白名单内的私聊/群可让评估直接 accept，避免每建一个新会话都花一次评估 |
| R3 | 回复必须只走 `channel.send`，不能有第二条路 | 现在桥接还有 WS/HTTP 两条自己的发送路径 | 迁移期必须显式关掉其一，否则重演"双回复" |

**一个反直觉的成本**：IM 全接编排器意味着 **SurfCore 桥接在 ingress/egress 上失去存在意义**。
但桥接里还压着目的机制、chat 生物钟、主动搭话、黑名单、鱼群保护、语音包、表情包、B站动态与分享——
**省下的是协议层，付出的是状态迁移**。这正是 [`architecture.md`](../architecture.md) §16 阶段 5 的工作量，
也是 §18 里"SurfCore 保留平台调度和部分独立状态"两行反复出现的由来。

**推论**：真正该定的目标是「**让 IM 只是又一个 SourceKind**」，而不是「接 dsh-im」。
按这个目标，顺序应该是**先让 SurfCore 的 QQ/B站 变成纯 SourceKind，再往里加 IM**——
否则会长期停在"一个 SourceKind 什么都干"和"IM 是干净 SourceKind"并存的分裂状态。


---

## 3. dsh-im 的真实契约（【上游声明】）

### 3.1 它是什么

`@xmanrui/dsh-im` v5.10.0，MIT，一个 DSH bundle 插件（`dsh.bundle.patch`）。
内置 **13 个聊天渠道**（飞书 / 微信 / 钉钉 / 企业微信 / 企微应用 / QQ / Slack / Telegram / Discord / WhatsApp / iMessage / Matrix / 邮件），
外加一个 AI Office 连接器（不是聊天渠道）。

**它不是渠道适配器，是一层"IM 语义消息层"**：把各平台的输入归一成"语义消息"，把 Harness 输出按"呈现意图"用各平台原生动呈现。
**它的接法是：把 IM 会话直接绑定到 DSH Session，自己跑 turn**——也就是**绕开 Superagent 编排器**。

这决定了它的两种用法完全不同：接在编排器**上游**（当入口）需要它交出事件；接在**下游**（当出口）很容易。

### 3.2 它开放给同 Host 插件的能力

| 能力 | 可用范围 | 对统一网关的意义 |
| --- | --- | --- |
| `ctx.dshIm.send(botId, targetId, text, {format, signal})` | **9 渠道**（微信/飞书/钉钉/企微/QQ/Slack/Telegram/Discord/WhatsApp） | ✅ 可直接做成出站 `channel.send` |
| HTTP `POST /api/dsh-im/delivery/messages` | 同上（**无鉴权、无 CORS**，仅回环/可信网络） | ✅ 非插件进程也能用 |
| `sendChecked(…expectedFingerprint, expectedTargetDigest…)` | **仅飞书/Lark** | ✅ 比 SurfCore 现有出站更强的条件投递 |
| `consumeInbound(botId, {onEvent})` 独占收件 | **仅飞书/Lark**，且需 `consumerMode: external-consumer` | ✅ **唯一**能把入站交给编排器的口子 |
| `replyChecked` | 仅飞书/Lark | ✅ 沿校验过的原消息/话题回复 |
| `historyChecked` | 仅飞书/Lark | 给评估读有界上下文 |
| `describeConversation(sessionId)` / `…Sync` | 全渠道，**只读** | ✅ 反查会话→渠道/机器人/群/发言人 |
| 事件 `dsh-im/session-pre-bind`、`session-unbind` | 全渠道 | ✅ 天然的 Thread 绑定来源 |
| `listBots()` / `listTargets()` / `createTarget()` | 同 Host | ✅ 目标发现与注册 |

### 3.3 出站：今天就能接

写一个 `dsh-im` SourceKind，`channel.send` 调 `ctx.dshIm.send`。错误映射【上游声明】：

| dsh-im 错误码 | 语义 | 映射到 `EgressError` |
| --- | --- | --- |
| `unknown-bot` / `unknown-target` / `invalid-target` / `target-conflict` | 配置错，永远发不出去 | `gone`（清账本） |
| `bot-not-connected` / `target-rejected` | 明确没发出 | `definite`（清账本，可重试） |
| `delivery-failed` / `cancelled` | 结果不明 | unknown（记 `uncertain`） |
| `bad-request` | 调用方错 | `definite` |

**但有两个硬约束【上游声明】：**

1. **不返回 external message id**，也不保存投递历史、不生成 `idempotencyKey`。
   → `channel.query()` 只能返回 `unsupported`，**结果未知的 Effect 会永远停在待对账**。
   这符合架构不变量 6（不盲重试），但意味着 dsh-im 渠道**没有自动恢复能力**。
2. `{sent:true}` 只表示"平台接口接受了请求"，**不承诺送达或已读**。

**结论**：dsh-im 出站适合做**通知 / 日报 / 告警**这类低风险文本，不能承载需要送达保证的东西。

### 3.4 入站：今天接不了

【上游声明】除飞书/Lark 外，各渠道没有 `onEvent` 交出接口：dsh-im 把消息吃进自己的会话绑定里自己跑 turn。
**所以"让 dsh-im 的 QQ 收消息 → 交给 Superagent 编排"目前无法实现。**

要做得先给上游提需求：把 `consumeInbound` 从"飞书独占文本收件"泛化到 QQ/其它渠道。
**不要在本仓库里 hack 它的内部状态**——它会破坏它自己的「会话路由 / 语义消息」边界，且它迭代很快（已到 5.10.0）。

### 3.5 两个必须先定的冲突

**冲突 1：QQ 身份空间不兼容。**

| | SurfCore 的 QQ | dsh-im 的 QQ |
| --- | --- | --- |
| 账号形态 | 个人号（第三方客户端代收） | **QQ 开放平台官方机器人**（`@tencent-connect/qqbot-connector`） |
| ID | QQ 号 / 群号（纯数字 5–12 位） | `user_openid` / `group_openid` |
| 能力 | 全群消息、语音条、收藏表情、自定义卡片 | 必须被 @、看不到全群、能力受官方 bot 限制 |

**绝不能都塞进 `platform: 'qq'`。**
[`egress.mjs:53`](../../plugins/dsh-surfcore-adapter/src/egress.mjs) 的 `QQ_TARGET = /^\d{5,12}$/` 会把 openid 判成非法地址而**静默丢弃**。
必须用独立 platform 名（例如 `qqbot`）。

**冲突 2：第三个抢答的人。**
[适配器 README](../../plugins/dsh-surfcore-adapter/README.md) 已记着"SurfCore 控制台自身的 QQ 自发回复没被拦截，同时开会双回复"。
再加 dsh-im 的 QQ 会话绑定，同一个群理论上可能收到**两到三个**回复。

---

## 4. 三条路线对比（2026-11-10 按 §2.3 修订）

| | 内容 | 收益 | 成本 | 风险 | 回滚 |
| --- | --- | --- | --- | --- | --- |
| **A** | 收敛 A 层：token 所有权显式化 + 出站 HTTP 出口收进 hooks 一个模块 | 4 客户端 → 1；11 个裸 fetch 归一；消除隐式 token 中介；②③④ 不再依赖桥接副作用 | 2–3 人日 | **中**：碰桥接发送路径与 MCP，需跑全量测试 | 一步（transform 补丁可整段摘除 + hooks 加回旧函数） |
| **B1** | 新增 `dsh-im` SourceKind，**只做主动投递出口** | 立刻多 9 个渠道的通知/日报能力 | 1–2 人日 | **低**：新 kind，不动现有链路 | 删 kind 即回滚 |
| **B2** | **IM 全接主编排器**：dsh-im 的每个渠道都成为 SourceKind，入站与出站都走编排器 | 五统一全拿到（§2.3）；闲聊不退化成工单；对话连续 | **大**：需先补 R1/R2/R3（§2.3），且入站受上游阻塞 | **高**：同时动授权、发送、会话绑定 | 难，需分渠道灰度 |
| **C** | 让 dsh-im 的入站进编排器（= B2 的入站部分，单独做） | 真正统一入口 | 大 | **高**，且**上游阻塞**（除飞书外无 `onEvent`） | 不可控（依赖上游排期） |

> **B2 与 C 的区别**：C 是"只把入站接进来、出站仍走别处"——结果是控制链撕裂，最不该选。
> B2 是"入站+出站一起接"，才是 §2.3 推的形态。若只能先做一半，**先做出站（B1），不要先做入站（C）**。

**共同前置（两条都躲不掉）：**

1. dsh-im 声明的兼容版本是 `dsh 0.2.1-rc.2`，本机是 **`0.2.1-rc.5`**；且 rc.5 有 welcome 握手缺陷，靠
   `scripts/patch-dsh-session-guard.mjs` 对 `app.asar` 打的字节补丁绕过。安装前必须确认 dsh-im 不碰这两处补丁。
2. dsh-im 要装进**具体 profile**。本机真实的 profile 是 `superagent-local`（不是 README 里的 web/desktop），
   安装命令要改成 `dsh plugin --profile superagent-local add -w @xmanrui/dsh-im`，装完需重启这个 dev `dsh web` 进程。

---

## 5. 推荐顺序

**如果目标是"把 SnowLuma 接线收拾干净"（不管 dsh-im）：只做 A。**
这是本方案里唯一"无论如何都该做"的一条，且它的收益不依赖任何外部项目排期。

**如果目标是"多几个渠道能发通知"：A → B。**
先 A 把出站出口收敛（B 的 `channel.send` 正好落在同一个出口模块里），再 B 加 dsh-im kind。顺序反了会 B 跟着一起还债。

**如果目标是"IM 直接接主编排器"（§2.3，B2）：先定 R1/R2/R3 三条规则，再按 A → B1 → B2 分三步走。**
不要从入站开始（那正是 C，会得到控制链撕裂）。入站在飞书之外的渠道还卡在上游，先做出站能立刻验证 egress 与 Policy 是否正确。

**如果目标是"dsh-im 的 QQ 也能被 agent 处理"：先 C 的前置——给上游提 `consumeInbound` 泛化需求，拿排期，再决定。**
在拿到上游结论之前，任何本地实现都只是临时的 hack，会在下一个 dsh-im 版本失效。

**关于"先做 A 还是先做 B2"**：A 是 B2 的地基——B2 无论怎么接，出站最终都落在同一个出口模块上。
**跳过 A 直接做 B2，等于在四个客户端并存的地基上再叠一层 SourceKind**，违反路线守则第 5 条（不补屎山）。

**明确不建议：**

- 把桥接 WS 主链路搬进统一网关（高风险、无收益）。
- 本地 hack dsh-im 内部会话状态偷入站（破坏其边界，升级必炸）。
- 在 `plugins/surfcore` 里直接改代码（违反子模块只读约束，会被 setup 重渲染覆盖）。

---

## 6. 待决策

| # | 决策 | 选项 | 影响 |
| --- | --- | --- | --- |
| D1 | 这次的目标是哪一个？ | 只收拾 SnowLuma（A）／多几个通知渠道（A+B1）／**IM 全接编排器（A+B1+B2）**／要 dsh-im 入站（C） | 决定后续所有工作量 |
| D2 | dsh-im 的 QQ 是否要与 SurfCore 的 QQ **并存**？ | 并存（需新增 `qqbot` platform 名 + 双发送方仲裁）／只用其一 | 决定冲突 1、2 要不要现在处理 |
| D3 | 允许改 `scripts/lib/surfcore-*.mjs` + MCP 两个文件吗？ | 允许（A 可行）／不允许（A 降级为"只写文档 + 提上游 issue"） | A 的前置 |
| **D4** | 采纳 §2.3 的 R1：**一个聊天 Thread 同时最多一个活票**吗？ | 采纳（Policy 挡住，需写规则与测试）／不采纳（同群可能多份回复） | B2 的正确性前提 |
| **D5** | 目标是"接 dsh-im"还是"让 IM 只是又一个 SourceKind"？ | 后者（则先迁移 SurfCore 的 QQ/B站）／前者（则接受长期分裂状态） | 决定是否需要 §16 阶段 5 的状态迁移 |

---

## 7. 每个方案的验证清单（真正动手时照这个走）

**A 层验证**

1. `plugins/surfcore npm run test:audit`（当前基线全绿，改动后必须仍全绿）。
2. `plugins/surfcore npm run test:regressions`（碰协议/桥接必跑）。
3. 在 `DSH_HOME=.artifacts/dsh-home` 下删掉 `surfcore/runtime.json` 与 SnowLuma，只启 MCP：
   工具调用应报**"端点未就绪（桥接未运行）"**这类可行动错误，而不是 `retcode 1401`。
4. 换账号场景：改一个 `onebot_<uin>.json` 的 token，确认 ②③④ 都能自动跟上，且不再依赖桥接写文件。

**B 层验证**

1. 新增 kind 后 `dsh-superagent` 面板能看到该 Source 且能填 `botId` / `targetId`。
2. 只跑 `channel.send` 的正/负用例：`bot-not-connected`（停掉机器人）→ 应清账本可重试；
   `delivery-failed`（断网）→ 应变 `uncertain` 且**不自动重发**。
3. 确认 `platform` 用独立名（`qqbot`），并加一条断言钉住：openid 不会被 `QQ_TARGET` 正则吞掉。

**通用**

- 任何一步都先确认 `platforms.start = {qq:false, bili:false}` 的休眠状态没被意外打开——**不要在验证时真的往群里发消息**。

---

## 8. 架构图：现状 vs 改造后

### 8.0 先答一个前置问题："要改造 SurfCore 吗？"

**不改它的源码，改它外面的接线。** 这不是约定，是机制强制【实测】：

| 层 | 磁盘上的上游代码 | 运行时实际的代码 |
| --- | --- | --- |
| 桥接（`src/bridge.js` 等） | `plugins/surfcore`（pinned 子模块，**一字不改**） | [`surfcore-loader.mjs`](../../scripts/surfcore-loader.mjs) 的 `registerHooks({ load })` 在 **import 时替换模块源码**，补丁只活在**内存**里 |
| 插件面（面板 / host / 工具限制） | 同上 | [`surfcore-component-patch.mjs`](../../scripts/lib/surfcore-component-patch.mjs) 渲染到 `.artifacts/surfcore-adapter/bundle`（只读副本） |

两条硬约束证明"直接改源码"这条路是堵死的：

1. **锚点飘移即报错。** `replaceOnce()` 找不到锚点就抛 `The pinned SurfCore source no longer matches the local automation safeguards.`
2. **哈希漂移即拒跑。** `patched-manifest.json` 存 `sourceSha256`，源码变了会抛 `SURFCORE_PATCH_DRIFT`，要求重跑 setup。

**所以"改造"的真实改动面只有这 6 个文件（合计 1,815 行）：**

```text
  792 行  scripts/lib/surfcore-runtime-transform.mjs    ← 锚点补丁（主要战场）
  284 行  scripts/lib/surfcore-bridge-hooks.mjs         ← 注入桥接的能力
  130 行  scripts/lib/surfcore-component-patch.mjs
  128 行  scripts/surfcore-loader.mjs                   ← 内存打补丁的入口
  308 行  plugins/dsh-surfcore-adapter/src/egress.mjs
  173 行  plugins/dsh-surfcore-adapter/src/ingress.mjs
```

**另一条路：fork 上游。** `surfcore` 上游是 **MIT**（`plugins/surfcore/package.json` 的 `license: "MIT"`），所以 fork 并且改源码在法律上干净。
代价是要自己背 16k 行 `bridge.js` 的上游演进（该项目迭代很快），而现在的锚点补丁方案虽然丑，但**上游改了会立刻报错**，不会静默分叉。
**建议：继续用补丁；只有在 §16 阶段 5 决定"把状态搬进编排器"时才 fork，那时搬的是逻辑而不是补丁。**

### 8.1 现状架构

```text
┌─ 层1 平台驱动 ─────────────────────────────────────────────────┐
│   SnowLuma（QQ 个人号，扫码登录）      dsh-im：未安装           │
└──────────────────────┬────────────────────────────────────────┘
                       │ OneBot v11    WS:3001 / HTTP:3000
┌──────────────────────▼────────────────────────────────────────┐
│ 层2 传输 + 会话策略     ← 今天全部压在 SurfCore 里              │
│                                                                │
│  plugins/surfcore（上游 pinned 子模块，磁盘只读）               │
│  src/bridge.js   16,218 行                                     │
│   人格/角色/preset · 目的机制 · 主动搭话 · 未读 · 唤醒 · 补历史  │
│   语音 · 表情包 · 黑名单 · 鱼群保护 · B站生物钟/动态/分享        │
│   ── 改法：ESM load hook 在内存打补丁，磁盘一字不改 ──          │
│                                                                │
│  ★1 四个 SnowLuma 客户端，只有一个有 token 自愈                 │
│  ★2 三条发送路径，只有一条有账本                                │
│  ★3 qq_* MCP 工具让 agent 直接发送，绕过适配器的账本            │
└──────────────────────┬────────────────────────────────────────┘
                       │ ingestSurfcoreEvent / submitSurfcoreProactive
┌──────────────────────▼────────────────────────────────────────┐
│ 层3 控制平面   Superagent 编排器                                │
│   SourceKind：surfcore / github / feishu                        │
│   Intake → Eval → Ticket → Assignment → Effect → Receipt        │
└──────────────────────┬────────────────────────────────────────┘
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ 层4 执行 + 资产                                                │
│   DSH Session(worker-<ticketId>) · Laputa · ActMem · MemPalace  │
└───────────────────────────────────────────────────────────────┘
```

### 8.2 改造后架构

```text
┌─ 层1 平台驱动（退化为叶子，不持有任何业务状态）─────────────────┐
│   SnowLuma（个人 QQ）      dsh-im（13 渠道，含官方 QQ bot）      │
└────────────┬──────────────────────────────┬───────────────────┘
             │ OneBot v11                   │ ctx.dshIm.send
┌────────────▼──────────────────────────────▼───────────────────┐
│ 层2 传输   ← 真正改的就是这一层                                 │
│                                                                │
│  snowluma-transport（唯一端点 + token 所有者）                  │
│    发现 · 自愈 · 落盘 · call(action) · 错误三分类               │
│    ↑ bridge / mcp-safe / mcp-host / adapter 全部改用它          │
│                                                                │
│  SurfCore 桥接只留"会话策略"：未读 · 唤醒 · 补历史 · 黑名单      │
└──────────────────────┬────────────────────────────────────────┘
                       │ InputEnvelope（唯一入口）
┌──────────────────────▼────────────────────────────────────────┐
│ 层3 控制平面   ← 唯一出口，没有旁路                             │
│   SourceKind：surfcore-qq / surfcore-bili / dsh-im-qq / …       │
│   Policy 兜 R1（一 Thread 一活票）+ R2（白名单免 Eval）         │
│   channel.send 唯一出站，每条都有 Effect / Receipt              │
└──────────────────────┬────────────────────────────────────────┘
                       ▼
┌───────────────────────────────────────────────────────────────┐
│ 层4 执行 + 资产（不变）                                        │
└───────────────────────────────────────────────────────────────┘
```

### 8.3 逐层差异

| 层 | 现状 | 改造后 | 属于哪一步 |
| --- | --- | --- | --- |
| 1 平台驱动 | 只有 SnowLuma | + dsh-im（叶子） | **B1** |
| 2 传输 | 4 客户端 / 11 裸 fetch / 隐式 token 中介 | 1 个 transport，显式 token 所有权 | **A** |
| 2 会话策略 | 全在 16k 行 bridge 里 | 不动（发明文，留待阶段 5） | — |
| 3 入口 | 适配器 + MCP 两条 | 只剩适配器 | **A** |
| 3 出口 | 3 条，1 条有账本 | `channel.send` 唯一，全有账本 | **A → B1** |
| 3 策略 | 未处理多活票 | Policy 兜 R1 / R2 | **B2** |
| 4 执行与资产 | — | 不变 | — |

### 8.4 一张图看"改造后还剩什么没统一"

```text
        ┌─────────────────────────── 已统一 ───────────────────────────┐
        │  入站：InputEnvelope      出站：channel.send + Effect/Receipt │
        │  授权：Policy             恢复：对账                           │
        └───────────────────────────────────────────────────────────────┘
        ┌──────────────────── 仍留在 SurfCore（阶段 5 才搬）────────────┐
        │  目的机制 · 主动搭话 · 生物钟 · 鱼群保护 · 黑名单              │
        │  语音包 · 表情包 · B站动态/分享                                │
        └───────────────────────────────────────────────────────────────┘
```

**这张图是本文最重要的一页**：A + B1 + B2 做完，**统一的是管道，不是能力**。
SurfCore 里那些"像 agent 的东西"（目的、搭话、生物钟）仍然在桥接进程里，与编排器的 Ticket 调度**并行存在**。
要真正合并，得按 [`architecture.md`](../architecture.md) §16 阶段 5 走，而那是另一个量级的工程。

---

## 9. 要不要提给 SnowLuma 上游？（2026-11-10）

**结论：大部分不值得提，而且方向上有害。真正该提的是 dsh-im 上游，不是 SnowLuma。**

### 9.1 先把"归因"分清

代码里明确把限制归给 SnowLuma 的，只有这 4 条【实测，grep 全部注释】：

| # | 痛点 | 出处 | 该不该提 |
| --- | --- | --- | --- |
| 1 | `get_group_msg_history`「是否可用取决于 SnowLuma 是否实现」 | [`mcp-snowluma-safe.js:456`](../../plugins/surfcore/src/mcp-snowluma-safe.js) | ✅ **值得**（要的是能力与限流的**事实**） |
| 2 | `get_mini_app_ark` 的 appid 写死，桥接改不了 | [`bridge.js:9245`](../../plugins/surfcore/src/bridge.js) | ⚠️ 可提，但 B站小程序已下架，价值在缩水 |
| 3 | `record` 段没有增益字段 | [`bridge.js:1106`](../../plugins/surfcore/src/bridge.js)、[`voice-core.js:290`](../../plugins/surfcore/src/voice-core.js) | ❌ 本地已绕过 |
| 4 | 非标准 action（`fetch_ptt_text` / `fetch_custom_face_detail`）没有公开文档 | 代码依赖 | ✅ **值得**（纯文档，零耦合） |

**那几件"大件"不是他们的 bug，是我们的债**：HTTP token ≠ WS token、按账号分文件、
没有"我是谁"的免认证查询、`fetch_ptt_text` 这类自定义 action 不在 OneBot v11 规范里。
他们那样设计是为了多账号并存；我们因此写了 234 行的 `snowluma-conn.js` 发现器。
**他们改不改都不影响自己的产品。**

### 9.2 反直觉：对我们这种架构，"上游活跃"是负资产

补丁锁了 **9 个上游文件**：

```text
src/bridge.js · src/character-persona.js · src/bili-share-scheduler.js
lib/index.js · lib/scheduler.js · lib/align.js
tools/lib/msgfeed.mjs · tools/lib/state-paths.mjs · tools/commands/dm-await.mjs
```

`replaceOnce()` 锚点对不上直接抛错，`patched-manifest.json` 的 `sourceSha256` 变了抛 `SURFCORE_PATCH_DRIFT`。
**所以上游每改一次，我们都付一次"重跑 setup + 修锚点"的成本。**

**提需求的硬前置自查**：这个请求会不会改到上面这 9 个文件？
- 会 → 不提（或至少先评估迁移成本）。
- 纯追加（新增 action / 新增可选字段 / 补文档）→ 可以提。

### 9.3 更要命的是：这些正是我们计划让它退场的东西

按 §8.4，A + B1 + B2 之后，`get_mini_app_ark`（B站卡片）、`fetch_ptt_text`（语音转文字）、
`fetch_custom_face_detail`（表情包）—— 这三个恰好就是桥接里"生物钟 / 语音 / 表情包"所依赖的接口。

**为一个正在收缩的组件去求上游加接口，是在给废墟装修。**

唯一"换任何架构都还成立"的需求是 **#1 `get_group_msg_history` 的语义与限流**：
补历史是 QQ 数据访问本身，换成编排器照样需要。**要提就只提这一条。**

### 9.4 许可面的额外风险

[`LICENSE` §99–151](../../plugins/surfcore/LICENSE) 已经承认 §4(b)（"不得基于本软件开发/发布/分发另一个项目"）存在**两种读法**，
并明确指出：§2 的授权是**可撤销的**，EULA §8 允许著作权人**单方面更新条款**。

提公开 issue **不构成违规**（这不是分发或衍生），但会留下一条**公开可索引的关联记录**：
"这个项目依赖 SnowLuma 的协议"。**收益小，而这是唯一一个"提了可能反噬"的方向。**

若确实要接触，用**中性问法**问接口事实（"`get_group_msg_history` 的限流与返回上限是什么"），
**不要**提"请为 DSH/SurfCore 增加接口"——那是把我们的架构塞进一个非商业许可的第三方项目，既越界又制造耦合。

### 9.5 对比：该提的是 dsh-im

| | SnowLuma | dsh-im |
| --- | --- | --- |
| 提了能得到什么 | 几条接口事实 | **解锁一整个能力**（入站：`consumeInbound` 泛化） |
| 对我们成本 | 上游一改就要修锚点 | 无（不改它源码，只消费它的服务） |
| 许可风险 | 有（非 OSI + 可撤销 + §4(b) 歧义） | 无（MIT） |
| 结论 | 只提 1 条事实询问 | **值得正式提需求** |

### 9.6 什么时候提

**等 A 做完再提。** 理由：A 之后我们才知道自己到底还需要哪些 action。
在"四个客户端并存"的状态下提需求，结论必然过时——你会为一个即将被收敛掉的用法去要接口。

**行动清单：**

1. 现在：不提。
2. 做完 A 后：只提 `get_group_msg_history` 的语义与限流（中性问法）。
3. 任何时候都提：非标准 action 的文档化（对所有人有益，零成本，不承诺耦合）。
4. 永不提：为 DSH/SurfCore 定制的接口、会触碰 §9.2 那 9 个文件的改动。

---

## 10. 评估：「不如直接 fork 一个 dsh-im + snowluma？」

**结论：这个念头抓到了一个真问题，但 fork 不是它的解法。**

### 10.1 你抓到的真问题：编排器的 channel 契约太薄

[`superagent/src/sources/kind.ts:46–56`](../../superagent/src/sources/kind.ts) 的出站契约**全部内容**是：

```ts
interface SourceChannel<C> {
  allowed?(address, config): boolean
  send(host, message): Promise<'sent' | 'gone'>     // 纯文本
  link(address, links): ChannelLink
}
```

加上 `ThreadContext.read / images / image`。**没有**：审批、提问、产物/附件、卡片、按钮、
流式/消息编辑、打字状态、延迟交付、机器人命令。

而 dsh-im 的 `CONTEXT.md` 里为这些东西定义了**近 30 个领域概念**（Semantic Interaction、
Artifact + Artifact Provenance、Native Presentation、Deferred Delivery、Selection Presentation、
Explicit Fallback、Post-Interaction Rotation……）。

**所以"IM 直接接编排器"的真实代价是：交互能力从"原生按钮/卡片"退化成"文本暗号"**
（今天 SurfCore 就是这么做的：`🔐 agent 请求审批…回复「通过」或「拒绝」`）。
这是 dsh-im 真实的价值所在，不该被忽略。

### 10.2 但 fork 的量级被低估了

【实测：GitHub API 文件清单】`src/channels/shared/` 有 **约 95 个模块**，其中：

| 文件 | 大小 |
| --- | --- |
| `bot-workspace-store.mjs` | 134 KB |
| `text-harness-bridge.mjs` | 106 KB |
| `harness-client.mjs` | 103 KB |
| `workspace-command.mjs` | 51 KB |
| `session-nav-command.mjs` | 42 KB |
| `harness-approval.mjs` | 28 KB |

**光 QQ 一个渠道**就是 12 个文件，其中 `qq-bridge.mjs` 73 KB、`qq-controller.mjs` 22 KB。

而且：**dsh-im 没有"加渠道"的扩展点**——`docs/` 下没有任何 plugin/channel API 文档
（只有 `client-integration.md` 讲客户端）。要加渠道只能 fork 并改 `src/channels/`。

**这本身就是信号**：连它自己都没把"加渠道"做成可插拔的，说明这不是设计目标。

### 10.3 三个具体代价

| # | 代价 | 说明 |
| --- | --- | --- |
| 1 | **方向倒退** | dsh-im 的接法是「IM 会话 → DSH Session，自己跑 turn」，**绕开编排器**。fork 出 `snowluma` 渠道，QQ 就进了 dsh-im 的模型，**离统一网关更远**，与 §2.3 定的方向相反。除非新渠道也写成 external-consumer-only——那你还得写编排器侧的 SourceKind，比直接写 SourceKind 多一层。 |
| 2 | **维护成本转移而非消失** | dsh-im 是 v5.10.0、活跃迭代。fork 后每个上游版本都是冲突。**我们刚为了躲开这件事才决定不改 surfcore 源码**，fork dsh-im 把它请了回来。而且要从零重学 QQ 非标准边缘（SILK 语音条、`fetch_custom_face_detail`、`get_forward_msg`、`get_mini_app_ark`）——那些是 SurfCore 用 16k 行攒的。 |
| 3 | **许可暴露放大** | SnowLuma 是非商业 + §4(b)「不得基于本软件开发/发布/分发另一个项目」+ §2 可撤销 + EULA §8 可单方更新。SurfCore 一直小心**不打包、不分发**它。把 snowluma 渠道塞进 dsh-im 的**公开 fork**，等于把 §4(b) 的歧义从"匿名协议互操作"升级成"公开发布的另一个项目"，而 dsh-im 是 dshfind 分类第一、Top10 下载的高曝光项目。**风险等级完全不同。** |

### 10.4 更省力也更对的替代：把需求提给 dsh-im

一个请求同时解决两件事（这就是 §9.5 那条，现在多了第二个理由）：

1. **渠道可插拔**（让第三方能加渠道而不 fork）；
2. **`consumeInbound` 泛化**（让 QQ 等渠道能把入站交给外部消费者）。

两个都是"纯追加"，不碰我们已有的任何代码，且对上游自身也有价值（更多渠道、更干净的架构）。

### 10.5 但有一条变体成立：如果战略是"人在 IM 里聊天"，那就该换中心

这不是技术细节，是战略二选一：

| | **路线甲：编排器为中心** | **路线乙：dsh-im 为中心** |
| --- | --- | --- |
| IM 层 | 自己写 SourceKind（薄：文本 + 上下文） | dsh-im 现成（富：审批/产物/原生呈现/命令/延迟交付） |
| 授权与副作用 | Policy + Effect/Receipt 统一 | dsh-im 自己的会话绑定，**无统一账本** |
| QQ 接入 | SurfCore 桥接 → adapter | fork 加 snowluma 渠道 |
| 主要成本 | 你得重造 IM 交互层 | 你得维护 fork + 放弃统一副作用 |
| 适合 | **主动 agent**：自己跑任务，IM 只是收活与通知 | **对话 agent**：人在 QQ/微信里跟它聊 |

**注意：两条路都要碰上游**——甲的 `SourceKind` 在 `superagent` 子模块里（改它 = 给官方提 PR），
乙要 fork `dsh-im`。所以"要不要碰上游"**不是**区分标准，"改哪个上游"才是。

### 10.6 建议

**先回答一个战略问题，再决定 fork：这个 agent 的主体是"人在 IM 里跟它聊天"，还是"它自己跑任务、IM 用来收活和通知"？**

- 主体是**对话** → 路线乙本身合理，fork 是最短路径；但请做**私有 fork、不发布**，并接受"IM 没有统一 Effect/Receipt"。
- 主体是**干活** → 路线甲，别 fork；审批/提问用文本暗号即可接受，或后续再给 `SourceKind` 加 `interact()`。
- 两个都要 → 走 §10.4，先提需求；同时按 §4 的 A → B1 推进，**不要**在没定战略前 fork。

**最不该做的**：因为"fork 看起来省事"就现在动手。那会同时得到三重负担——没有统一授权、要维护一个 400 KB+ 的 fork、还放大了许可风险。

---

## 11. 各平台官方对"能对话 + 能主动"的支持到哪一步（2026-11-10 核实）

> 需求前提由用户给定：**「前提是官方支持」**。这句话本身就排除了一条路（见 §11.5）。
> 本节只记录**官方文档原文核实过**的数字；未核实的逐条标注，不猜。

### 11.1 先建立一个判断框架：官方"主动"分三档

各平台的反骚扰策略几乎都遵循同一个结构，**能不能主动，取决于你要主动碰谁**：

| 档 | 含义 | 官方态度 | 典型 |
| --- | --- | --- | --- |
| **A 档** 公开空间发言 | 机器人已被允许进入的群 / 频道 / 子频道里说话 | **普遍允许**，只限频不限权 | Telegram 群、Discord 频道、Slack 频道、飞书群、QQ 群 |
| **B 档** 触达已有对话关系的人 | 私聊一个**主动找过你**或**加过你**的人 | **半开放**，普遍有额度或时间窗 | QQ 1000 条/用户/天、微信 48h、WhatsApp 24h、Telegram 需用户先开口 |
| **C 档** 触达从未互动的人 | 私聊陌生人 / 冷启动拉新 | **几乎全封** | 所有平台 |

**推论：用户说的"agent 在世界里主动探索"，只要落在 A 档和 B 档，官方都支持；落在 C 档，任何平台都不行，不要设计这条路。**

### 11.2 QQ 官方机器人：本批次里"主动"额度最宽的一家（逐条核实）

来源：[QQ 机器人官方文档「消息收发概述」](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/overview.html)

**主动消息定义**：无任何条件即可触达。但——**用户可在 QQ 客户端关闭「允许主动发送」开关，关闭后主动消息一律发送失败。**

| 场景 | 主动消息配额 | 被动回复窗口 |
| --- | --- | --- |
| **单聊** | Bot 10/qps；单关系 20/qpm；**1000 条/用户/天** | 60 分钟内，每条可回 **4 次** |
| **群聊** | Bot 60/qpm；单关系 20/qpm；**1000 条/群/天** | 5 分钟内，每条可回 **5 次** |
| **文字子频道** | 默认每天每子频道 **20 条**；每天最多推 **2 个子频道** | 5 分钟 |
| **频道私信** | 每机器人每天对一用户 **2 条**；每天累计 **200 条** | 5 分钟 |

**另有一条专为"主动找回来"设计的能力——互动召回消息（`is_wakeup=true`）**：
用户主动对话后 **30 天内**可下发召回消息，分 **4 个周期**（当天 / 1–3 天 / 3–7 天 / 7–30 天），**每周期 1 条**。

**这条几乎是为"主动 agent"量身定做的**：它承认"人会走开"，并给出 4 个合规的"再敲一次门"的机会。

其他已核实的细节：`msg_type` 支持 0 文本 / 2 Markdown / 7 富媒体（需先上传拿 `file_info`，有 ttl）；
撤回限 2 分钟内；相同 `msg_id + msg_seq` 重发会失败，递增 `msg_seq` 可多次回复。

> **注意**：这与我前面基于 SnowLuma 的假设**方向相反**。个人号（SnowLuma）能出现在任意群、
> 任意好友会话里，但那是**非官方**通路；官方机器人只能进入"被添加"的空间，
> 却有**正式配额 + 卡片 + Markdown + 流式消息 + 审核事件**。用户给的"前提是官方支持"直接指向后者。

### 11.3 其余平台（按"对话 + 主动"组合排序）

| 平台 | 对话 | 主动私聊（B 档） | 主动群/频道（A 档） | 核实情况 |
| --- | --- | --- | --- | --- |
| **QQ 官方机器人** | ✅ 单聊 60min/4 次；群 5min/5 次 | ✅ **1000 条/用户/天** + 4 次召回 | ✅ 1000 条/群/天 | **官方文档逐条核实** |
| **飞书 / Lark** | ✅ | ⚠️ 应用机器人可主动发，需权限与可见范围；无"必须用户先互动"的硬规则 | ✅ 群内自由 | **部分核实**：自定义 webhook 机器人 **100 次/分钟、5 次/秒**（[官方 FAQ](https://open.feishu.cn/document/faq/breaking-change/webhook-v2-robot-exceeds-frequency-limit-management)）；应用机器人主动私聊的具体限制**未逐条核实** |
| **企业微信** | ✅ | ✅ 应用消息可推给可见范围内成员 | ✅ | **部分核实**：企业群发上限 = **账号上限数 × 200 人次/天**（[官方帮助](https://open.work.weixin.qq.com/help/wap/detail?docid=17363)）；群机器人 webhook **20 条/分钟**；单应用接口另有频率限制 |
| **Telegram** | ✅ | ❌ **bot 不能主动发起**（`403 Forbidden: bot can't initiate conversation with a user`） | ✅ 所在群/频道自由 | **官方 FAQ 核实**（[core.telegram.org/bots/faq](https://core.telegram.org/bots/faq)）；免费广播限速约 **30 条/秒**，超 429；付费提额需 100k Stars + 100k MAU |
| **微信（公众号/订阅号）** | ✅ | ❌ **客服消息仅 48 小时窗口** | ❌ 无群概念 | **官方页核实**（[发送客服消息](https://developers.weixin.qq.com/doc/subscription/api/customer/message/api_sendcustommessage.html)：用户产生交互后 48 小时内可发）。超出只能靠模板消息/订阅消息，且需用户主动订阅 |
| **Discord** | ✅ | ⚠️ DM 需共享服务器且用户允许 | ✅ 频道自由 | **本轮未核实** |
| **Slack** | ✅ | ⚠️ DM 需 `im:write` 且 bot 被安装 | ✅ 频道自由 | **本轮未核实** |
| **WhatsApp** | ✅ | ❌ **24 小时窗口**，超出只能发审核过的模板 | ❌ 无群 | **本轮未核实**（业界通行规则，未从官方页逐条核对） |
| **Matrix** | ✅ | ✅ 自建 homeserver 内机器人就是一个普通用户 | ✅ | **本轮未核实**（自托管，理论上无平台侧限制） |

### 11.4 对"对话 + 主动探索"这个组合的结论

**能同时满足两者、且官方明确允许的，按契合度排序：**

1. **QQ 官方机器人**——唯一一家把"主动"写成**明确数字配额**（1000/用户/天）并额外给了 4 次召回机会的
   C 端平台。对话窗口也够（单聊 60 分钟 / 4 次）。**如果用户群体在 QQ，这是正解。**
2. **飞书 / 企业微信**——主动能力同样宽松，但受众是同事/企业，不是"世界"。
3. **Telegram / Discord / Slack**——A 档自由、B 档受限，适合"在公开空间活动"，不适合"主动找人"。
4. **微信 / WhatsApp**——时间窗设计，只适合"客服式应答"，**不适合主动 agent**，别选。

**"主动探索"真正受限的不是平台，是我们自己的假设**：只要 agent 的活动落在
「已被邀请的空间」（群、频道、自己发的帖、公开内容平台），官方限制基本只剩频控，够用。

### 11.5 这条结论改写了前面章节的一个前提

前面 §1–§10 把 **SnowLuma（个人号）**当成 QQ 的唯一通路。但用户给的**前提是「官方支持」**：

| | SnowLuma 个人号 | QQ 官方机器人 |
| --- | --- | --- |
| 官方支持 | ❌ 非官方；EULA §5.4 禁止程序化启停；有风控 | ✅ 官方开放平台 |
| 主动消息 | 无官方概念，靠"像人一样发"，随时可能被判定违规 | ✅ **1000 条/用户/天**，白纸黑字 |
| 能进哪些地方 | 任意群、任意好友 | 只能被**添加**进的群，以及加过机器人的用户 |
| 富交互 | 靠自己拼（CQ 码、小程序卡片） | ✅ Markdown、卡片、流式消息、审核事件 |
| 许可 | 源码可见非商业，§4(b) 有歧义 | 官方协议 |

**结论：如果"官方支持"是硬前提，QQ 就该走官方机器人，SnowLuma 退为"非官方补充通路"。**

而 dsh-im **已经有官方 QQ 机器人渠道**（`@tencent-connect/qqbot-connector`）——
这意味着 §10.5 的"路线乙"或 §4 的 B1，**在 QQ 上用的就是合规通路**，不需要 SnowLuma。

### 11.6 待确认（本轮没查完的）

1. 飞书应用机器人**主动私聊**是否有隐性限额（如"用户 30 天未互动则收不到"）。官方 SPA 页面抓不到正文，需人工在浏览器里看。
2. Discord / Slack / WhatsApp / Matrix 的官方条文未逐条核对，上表 A/B 档判断基于通行规则，**落地前必须核**。
3. QQ 官方机器人"允许主动发送"开关的**默认值**未核实——若默认关闭，则主动能力需要用户侧配合，这一点对产品设计影响很大。
4. QQ 官方机器人的**类目/资质门槛**（个人认证 vs 企业认证的审核要求）未核实，只核到"两档频控数字相同"。




