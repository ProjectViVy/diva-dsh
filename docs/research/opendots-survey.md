# OpenDots 调研：它能不能让 Superagent 更贴近生活

- 状态：调研结论，未改任何代码
- 日期：2026-11-05
- 调研对象：[CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots)
- 关联：[个人持久化 Agent 总体架构](../architecture.md)、[Superagent 提示词](../superagent/docs/004-prompts.md)、[000 Philosophy](../superagent/docs/000-philosophy.md)
- 本地取证：`/tmp/opendots-probe`（浅克隆，commit `d4214af`，2026-11-03）

## 1. 结论摘要

1. **OpenDots 不是可以装进 Superagent 的组件**，它是一个独立的自托管应用模板：Node 24 + React/Vite + Hono + CopilotKit Intelligence + TanStack AI，约 13.6k 行 TypeScript（`src/`）、57 个测试文件的 Vitest 套件。它的 agent loop 属于 CopilotKit 的 `BuiltInAgent`，不是 DSH 的 Session/Agent loop，没有可复用的运行时接口。
2. **它的"生活感"不在提示词里，在界面上。** 它的 Dot 提示词只有一段（`src/server/dot-agent.ts:364`），内容同样是工具纪律、权限、审批、引用来源——和我们的工作提示词一样"工程味"。让人觉得像伙伴的是另外几样东西：Spaces（共同文档）、通话、审批卡、定时任务、每 Dot 的持久电脑、头像。
3. **因此"让 Superagent 更贴近生活"不该从重写内置提示词入手。** 提示词可以覆盖（`superagent/docs/004-prompts.md`），但同一段 `runtime/shared` 同时服务 GitHub 工作票；而且 004 明确写着覆盖"不改变 gate、Mandate、工具检查"——权限与副作用仍由代码和 Policy 决定。把工作提示词改成温柔散文，只会得到"一个说话更软的工作机器人"。
4. **我们缺的不是 agent 核心，是三个面**：① 一个给人看的、可编辑的"共同生活空间"（OpenDots 的 Spaces）；② 一套生活语义的 Policy/Schedule/说话时机（我们的 Schedule、InputEnvelope、Effect/Receipt 都已经具备，缺的是生活类的默认规则与类型区分）；③ 一个以陪伴为目的的界面与语音面（面板形象、通话、友好审批卡）。
5. **推荐路线**：保持 `architecture.md` 已确认的边界不变，把生活做成 personal 模式下的 **Source + Policy + Effect + 面板投影**（架构 8.3 已经写明"个人对话、平台消息、主动行为和进化都可以复用 Ticket 生命周期，但在类型、Policy 和界面上明确区分"）。OpenDots 只作为**参考实现与 UX 蓝本**，不建议长期并存。

## 2. OpenDots 是什么（事实）

| 项 | 事实 |
| --- | --- |
| 仓库 | `CopilotKit/OpenDots`，MIT（Copyright (c) Atai Barkai） |
| 定位 | "Always-on AI coworkers that move between text, calls, and Slack"，自托管模板，非托管产品 |
| 创建 | 2026-09-29（约 5 周新），最近 push 2026-11-04，6411 stars / 933 forks / 74 open issues |
| 栈 | Node ≥24、React 19、Vite 8、Hono 4、CopilotKit 1.75、AG-UI、TanStack AI、zod 4、Playwright（浏览器服务）、TipTap（文档编辑器） |
| 数据 | SQLite 存页面、工作区、任务元数据；**对话历史存在 CopilotKit Intelligence**（托管云或本地 Docker），模板本身没有独立会话库 |
| 硬依赖 | 对话必须配置 Intelligence；本地评估版需 Docker Desktop（≥4 CPU / 12 GiB RAM / 40 GiB 磁盘）、CopilotKit 账号、免费 Developer 计划的 30 天可续评估许可 |
| 遥测 | 默认开启（`COPILOTKIT_TELEMETRY_SAMPLE_RATE=1`），可用 `COPILOTKIT_TELEMETRY_DISABLED` / `DO_NOT_TRACK` 关闭 |
| 模型 | OpenAI 兼容（`OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL`），可指向自建端点 |
| 其它服务 | 浏览器服务（Playwright 容器）、OpenBot 电脑（容器 supervisor）、Composio（真实邮箱/日历）、Speech（通话）、Parallel（联网研究）、Slack（Channels SDK） |
| 成熟度 | 自称 alpha，单 owner 起点；多用户、共同编辑、文件上传、交互式嵌入都未包含 |

### 2.1 它的 agent 核心有多薄

`src/server/dot-agent.ts:364` 一段字符串就是全部人格层：

> `You are ${dot.name}, a specialist Dot in OpenDots. Role instructions: ${dot.instructions}\nBe conversational and thoughtful. … Preferences: ${JSON.stringify(memories)} … Current time: …`

配套是 `BuiltInAgent`（TanStack AI）+ 工具白名单 + `maxIterations(5|10)`。所谓"每个 Dot 不同"，就是 `name` 与 `instructions` 两个字段的插值；记忆就是一批用户手写的偏好字符串（1–2000 字，`store.saveMemory`）。

**这条事实很重要**：如果我们想要的是"更像人的对话"，OpenDots 没有提供我们还没有的东西。它提供的是**围绕这段对话搭出来的生活场景**。

## 3. OpenDots 里真正"贴近生活"的原语，与我们的对应物

| OpenDots 原语 | 它解决什么 | 我们已有的 | 缺口 |
| --- | --- | --- | --- |
| **Spaces / Pages**：可搜索文档库 + 可视化编辑器 + 版本检查 | 一个不走 ticket/PR 的共同生活空间（笔记、计划、清单、共同写作） | MemPalace（归档与知识，**只读**）、DSH 文件、Ticket 目录 | **没有面向人的、可编辑的"生活空间"** |
| **Dot 配置**：名字 + role instructions + 每 Dot 工具/研究/记忆/应用权限 | 可配置的具名伙伴，权限按伙伴收窄 | Laputa（人格唯一事实源，有 revision/CAS/回滚）、DSH Subagent/Agent 注册表 | 人格与"任务域权限"绑定的配置面；Superagent 角色目前只有 orchestrator/worker |
| **Memory**：用户手管的偏好清单，注入提示词，可增删改 | 透明、可编辑、可预测的偏好 | ActMem（衰减/关系/revision，强得多）、MemPalace | 面向用户的"轻量偏好"交互；OpenDots 的简单模型可作为面板交互参考，不应成为第二记忆源 |
| **Scheduled tasks**：在原会话里按间隔重复执行，可暂停/重试 | 定时主动与例行陪伴 | Superagent `settings.schedule`（每槽一次 → `schedule` 层 Input → Policy 决定是否成 Ticket） | **机制已有**；缺生活类默认规则与"什么时候该开口"的表达 |
| **Approve & save / Approve & run 卡** | 代你动手前先确认 | 审批策略、Effect/Receipt、语音 `commit-send` fail-closed | **语义已有**；缺面向生活的友好审批卡（QQ/面板）与"哪些生活动作必须问"的清单 |
| **Dot computer**：每 Dot 独立浏览器 profile + 文件 + shell，跨重启保留，人可接管 | 一个"自己的房间"和可托付的工具 | DSH Workspace/Session、experimental 的 computer-use 插件 | 每伙伴的持久私人空间与"人接管"界面 |
| **Calls**：WebRTC 实时语音 + 双方字幕 + 计时 + 最小化 + 通话回执 | 陪伴的语音面 | `dsh-local-voice`（TTS，已收口到 Effect）、`dsh-local-asr`（STT） | 实时双向连续对话、字幕、通话回执与通话态界面 |
| **Slack channel** | 在既有聊天软件里出现，带 workspace/user 白名单 | QQ/B站经 `dsh-surfcore-adapter`（E5 已落地，profile 注册待用户执行） | 已具备，且 QQ 比 Slack 更贴个人生活 |
| **Automatic Learning**：会话证据 → 候选 → 人工审阅发布 → 作为 skill 下发 | 从相处中长能力，且有人工闸门 | Evolution（Evidence/Proposal/Validation/Publication）+ continual-harness + `harness_refine` | 机制已有；缺"生活偏好"类候选的归属与默认审批档位 |
| **Mascot**：按 identity 哈希得到稳定形象与状态 | 身份的可视连续性 | `dsh-vivy-studio`（DIVA 皮肤）、参考仓库 surfpet 桌宠 | DSH 面板里的伴侣形象与状态位 |
| **AG-UI 流式工具卡** | 过程可见、可介入 | DSH Web GUI | 已具备 |

一句话：**九项里有六项我们已经具备或已有更强的实现，真正空着的是"共同生活空间"和"陪伴界面/语音面"。**

## 4. 我们的 Superagent 为什么现在不像生活伙伴（事实）

不是语气问题，是领域与策略问题：

- **原则本身是反打扰的**：`000-philosophy.md` 的"Take as little human attention as possible, and give as much value as possible"；"It speaks only when a person must act or can use a result"。对工作这是美德；对陪伴，这条原则要求的是"你不看我也没事"。
- **发言被硬约束**：`replies.md:27` "100 words is a hard ceiling"；`communication.md` 规定"IM 是投递通知，不是工作汇报"、"不要身份开场白"、"未完成的进展留在内部"。
- **角色只有两个**：`orchestrator`（只路由，不做技术判断，不等消息）与 `worker`（在 ticket 目录里写代码、开 PR、跟进 CI 与评审）。没有"聊天/陪伴"这个角色。
- **输出通道是工作通道**：`orchestrator.md:14` "Act only as the deployment's GitHub account"；Channel 的回执语义是"结果可用/需要人行动"。
- **但底座已经准备好了**：`E1-S1` 的 `personal` 模式让 GitHub 变成可选来源；`E1-S3` 有了通用 `InputEnvelope`；`E1-S5` 有了 Schedule；`E5-S1/S3` 有了 QQ/B站边缘适配器与主动候选；`E3-S1` 有了人格版本化；`E2-S1` 有了 ActMem 写入口。**架构 8.3 已经把"个人对话复用 Ticket 生命周期，但在类型/Policy/界面上区分"写成了方向。**

所以问题不是"能不能"，而是"把生活表达在架构的哪一层"。

## 5. 可行的方式与形式

下面五种形式互不排斥，按"离内核多远"排序。

### 形式 A：只改说话方式（提示词 / Policy 文本层）

- 做法：用 `orchestrator_prompts_save` 覆盖部分 `runtime/*`，或在 Policy 里加生活类规则，让 personal 模式下的表达更松弛。
- 成本：小时级，可逆。
- 限制（必须知道）：004 明确"覆盖不改变 gate、Mandate、工具检查"；同一段 `runtime/shared` 同时服务工作票，改语气会波及 GitHub 场景；100 字上限、沉默策略、`human_action` 机制都不受提示词影响。
- 结论：**可以做，但只能做"语气与措辞"，做不出"陪伴"。** 适合作为其它形式的收尾，不适合当主线。

### 形式 B：把"生活"做成一等公民的 Source + Policy + Effect（贴合现有架构，推荐）

- 做法：
  1. 生活对话来源（QQ 已有；未来本地桌面/手机端）作为 Source，事件照旧转 `InputEnvelope`。
  2. Policy 增加生活语义：区分 `life` / `work` 两类触发；生活类允许"主动开口"的规则（例如到点问候、连续多日沉默后的关心），工作类保持现行严格策略。
  3. 生活类 Ticket 用不同的交付语义：结果即"回复某人"，不是 PR；这是 8.3 说的"在类型、Policy 和界面上明确区分"。
  4. 生活类副作用（发消息、打电话、代下单、改日历）统一走 Effect + Receipt，高风险动作进审批卡。
- 成本：中等（1–2 周量级），完全落在既有模式里，不新增概念。
- 风险：Policy 变复杂；需要明确"生活 Ticket 谁批准、失败怎么恢复"。
- 这是唯一能让"生活"和"工作"共用一套可审计控制链的做法。

### 形式 C：借 OpenDots 的形状做 DSH 界面（体验层）

- 做法：照它的三个形状做 DSH 面板——① 伴侣卡片（稳定形象 + 状态 + 通话入口）；② 生活空间（可编辑文档，含共同笔记/计划）；③ 友好审批卡（"要我用你的账号发这封邮件吗：通过 / 拒绝 / 改一下"）。
- 成本：3–7 天量级（插件 + client 面板），不动控制链。
- 注意：生活文档必须有一个所有权答案。按现行不变量，天然归属是"原文件系统是内容事实源，MemPalace 只做索引"或"新资产所有者 + 版本化"。**不能又变成一个平行事实源。**

### 形式 D：把 OpenDots 跑起来当"生活面"（不推荐长期并存）

- 做法：独立进程、独立数据、独立人格与记忆（Intelligence），与我们的 QQ 链路并行。
- 代价：它有自己的 Dot 人格（违反架构不变量 4）、自己的对话记忆（平行事实源）、自己的控制链（违反不变量 6/7），而我们没有 subject_id、ActMem、Laputa、Effect/Receipt 的接缝。
- 还多两个现实问题：对话历史在 CopilotKit 的 Intelligence 里（托管云或本地 Docker），遥测默认开；alpha、5 周新库、接口可能变。
- 结论：**可以本地跑一遍用来"体验"和抄形状，但不该成为长期并存的生活面。** 若真要，只能把它降级成"只负责界面、把动作交回 Superagent"的边缘层，那基本等于重写它的 agent 部分。

### 形式 E：把它的 agent 内核移植进 DSH（不可行）

- 它的 loop 是 CopilotKit `BuiltInAgent` + TanStack AI + Intelligence threads；我们的是 DSH Session/Workspace/Cordis。移植等于重写 DSH 的 Agent loop，而架构 3.2 明确把"重写 DSH 的 Session、Agent loop、Workspace 或技能加载器"列为非目标。

### 建议的组合

**C（界面形状）+ B（控制链生活化）+ 少量 A（说话时机与语气）**，OpenDots 只当参考实现（D 仅用于体验验证）。理由：B 让"生活"可审计、可恢复、不新增事实源；C 是用户真正能感受到的差别；A 成本极低但不能单独立项。

## 6. 下一步（仍然不改代码）

1. **亲眼看一遍**（可选，需要 Docker + CopilotKit 账号）：不配置 Intelligence 也能创建 Spaces / 写页面；要聊天需本地 Intelligence（12 GiB 内存预算）。目的只有一个：确认"生活感"到底来自哪里，值不值得抄。
2. **只读两个文件**：`src/server/dot-agent.ts`（第 340–395 行，看完它的"人格"有多薄）与 `src/client/` 下的 `Chat.tsx` / `CallView.tsx` / `Mascot.tsx`（看形状）。
3. **先定三个归属问题**，它们决定后面所有设计：
   - 生活文档谁拥有？（MemPalace 只读 vs 新资产所有者）
   - 生活日程谁触发？（建议复用 Superagent Schedule，不新增定时器）
   - 生活副作用走哪条 Effect？（建议复用 `voice`/`reply` 同类机制）
4. **写一份《personal 模式生活策略》提案**：生活 Policy 规则集（什么时候该主动开口）、默认 Schedule 规则、说话长度与频道策略、必须审批的生活动作清单。
5. **确认原则的改写**：`000-philosophy` 的"人必须行动才有价值"要补一条"人愿意在，本身就有价值"，但要保留"不制造依赖、不刷存在感"的底线——否则陪伴会立刻退化成打扰。

## 7. 风险清单

| 风险 | 说明 |
| --- | --- |
| 数据与依赖 | OpenDots 的对话历史在 CopilotKit Intelligence；本地版需 Docker + 账号 + 30 天评估许可；遥测默认开 |
| 成熟度 | 5 周新库、alpha、74 open issues、自称 single-owner 起点；接口与数据结构可能变 |
| 栈不兼容 | React/CopilotKit/AG-UI vs DSH/Cordis 插件；没有可复用的 runtime 组件，只能抄形状与代码片段 |
| 架构冲突 | 直接并存会引入第二人格源、第二记忆源、第二控制链，撞上 `architecture.md` 第 17 节不变量 4/6/7 |
| 哲学冲突 | "最小化人的注意力"与"陪伴"目标相反；合并时最容易的失败形态是"工作通知刷进私人聊天" |
| 许可 | MIT，可借鉴代码，但需保留版权与许可声明（我们仓库已有 NOTICE 机制） |

## 8. 来源

- [OpenDots 仓库](https://github.com/CopilotKit/OpenDots)（README、docs/SETUP.md、docs/CONNECTIONS.md、docs/COMPUTERS.md 均来自本仓库 commit `d4214af`）
- [OpenDots GitHub API 元数据](https://api.github.com/repos/CopilotKit/OpenDots)（stars / forks / 创建时间 / 许可）
- 本地：`docs/architecture.md`、`superagent/docs/004-prompts.md`、`superagent/prompts/*.md`、`plugins/*/README.md`
