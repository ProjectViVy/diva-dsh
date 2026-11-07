# 个人持久化 Agent 总体架构

- 状态：目标架构，核心边界已确认，按迁移阶段实施
- 日期：2026-11-03
- 适用范围：本仓库内的 DSH、Superagent、SurfCore、Laputa、ActMem、MemPalace、持续进化组件及其外部系统适配器

## 1. 文档目的

本仓库已经具备会话执行、任务编排、人格、活跃记忆、长期记忆、技能进化和外部平台接入等组件。当前问题不再是组件数量不足，而是组件之间存在重复事实源、重复调度、隐式写路径和不一致的身份归属。

本文定义目标架构，统一回答以下问题：

1. 谁是自主 Agent 的控制核心。
2. 每类数据由谁唯一拥有。
3. 活跃记忆如何衰减、维护关系并归档为长期知识。
4. 人格、记忆、知识和 Skill 如何通过进化链路更新。
5. 外部输入、主动行为和副作用如何形成可恢复链路。
6. Superagent、SurfCore 与 Evolution 重叠时如何划分职责。

本文描述目标状态，不把现有插件已经具备的能力误认为架构已经落地。实施必须遵守第 16 节的迁移顺序和第 17 节的架构不变量。

## 2. 核心决策

### 2.1 一个控制核心

Superagent 是自主 Agent 的控制与编排核心，统一管理输入接纳、授权、任务、执行分配、外部副作用、回执和恢复。

Superagent 不是人格正文、记忆内容或所有领域数据的集中数据库。Laputa、ActMem、MemPalace、DSH Session 和 Skill 所有者继续保存各自领域的权威数据。

GitHub 是可选的 Source/Channel，不是启动前置条件。未配置 GitHub 时，Superagent 以 `personal` 模式运行个人对话、记忆和 QQ/B站链路；配置 GitHub 后进入 `github` 模式。仓库与 CLI 只配置其中一项时仍是配置错误，不以降级掩盖。

### 2.2 一个人格核心

Laputa 是人格的唯一权威来源，拥有身份、使命、关系、边界及其他正式人格文档，以及这些内容的版本、来源、更新和回滚记录。

人格不授予工具权限，不改变审批要求，也不替代 Superagent 的 Policy。

### 2.3 一个活跃记忆事实源

ActMem 就是高级记忆卡系统，是活跃记忆的唯一事实源。它在记忆卡之上原生支持衰减、重要度、关系、会话状态、合并、更正、归档和活跃召回。

所有新的个人记忆先进入 ActMem。其他插件不得另建与 ActMem 平行的活跃记忆事实源。

### 2.4 一个长期归档与知识仓库

MemPalace 是所有记忆归档后的长期储存仓库，同时承担电脑级知识库索引和长期知识沉淀。

对于归档记忆，MemPalace 是长期内容与检索的权威来源。对于电脑原文件，原文件系统仍是内容事实源，MemPalace 只拥有派生索引、来源定位和知识关联。

### 2.5 一个进化子系统，不另立控制主链

Evolution 负责证据、候选、领域验证和资产发布记录，不负责建立与 Superagent 重叠的输入接纳、任务调度、并发、外部 Outbox 或恢复主链。

Evolution 与 Superagent 发生职责重叠时，以 Superagent 主链为准。Evolution 任务必须由 Superagent 编排，资产实际提交仍由对应所有者完成。

### 2.6 逻辑统一，物理分库

架构不要求把所有数据合并进一个数据库。需要统一的是身份键、版本、所有权、写路径、回执和查询投影，而不是物理存储格式。

## 3. 架构范围与非目标

### 3.1 范围内

- 个人对话、主动行为和跨平台任务。
- 持久任务、定时唤醒、执行恢复和外部副作用。
- 人格、活跃记忆、长期知识、经验和 Skill 的版本化使用。
- ActMem 到 MemPalace 的归档。
- 人格、知识、记忆和能力的自主进化。
- QQ、B站、GitHub、Feishu、语音、本地工具和电脑知识索引。
- 与上述能力相关的管理界面、审计和配置。

### 3.2 非目标

- 把 Superagent、SurfCore 和 DSH 合并成一个代码库。
- 重写 DSH 的 Session、Agent loop、Workspace 或技能加载器。
- 建立一个包含所有数据的全局数据库或全局 Recap 单例。
- 让 Superagent main Session 或某个 worker Session 成为独立人格。
- 让模型通过提示词绕过授权、审批或资产所有者直接写入。
- 以管理页面改名代替控制链、数据所有权和恢复语义改造。

## 4. 术语

| 术语 | 定义 |
| --- | --- |
| Subject | 同一个持久个人 Agent 的逻辑主体，不代表永久在线进程 |
| Superagent | 控制核心，拥有任务与外部副作用生命周期 |
| DSH | 执行运行时，提供 Workspace、Session、Agent、Jobs、工具和模型循环 |
| Laputa | 人格资产所有者 |
| ActMem | 带衰减和关系的高级记忆卡，活跃记忆事实源 |
| MemPalace | 归档记忆仓库、长期知识存储和电脑级知识索引 |
| Evolution | 证据、候选、验证和发布记录的所有者 |
| Ticket / Task | Superagent 的控制任务；现有 Ticket 是其实现基础 |
| Assignment | Task 与具体 DSH 执行 Session 的绑定 |
| Effect | 已持久化的外部副作用意图 |
| Receipt | 外部执行、资产发布或适配器处理的事实回执 |
| ContextSnapshot | 一次模型操作固定使用的身份、记忆、能力和 Policy 版本集合 |
| Evidence | 用于记忆维护或进化的不可变事实引用 |
| Proposal | 对人格、记忆、知识或能力的候选变更 |
| Publication | 经资产所有者提交的新版本及对应回执 |

## 5. 总体结构

```text
 QQ / B站 / GitHub / Feishu / 用户 / Schedule / Wake / 本地工具
                              │
                    Edge Source / Channel Adapter
                              │
                  InputEnvelope │ Effect / Receipt
                              ▼
┌──────────────────────────────────────────────────────────┐
│                    Superagent 控制平面                    │
│ Intake → Admission → Ticket → Assignment                  │
│        → Effect → Outbox → Receipt → Recovery             │
│ 拥有：主体绑定、任务、授权、审批、副作用、回执与恢复         │
└──────────────────────────────────────────────────────────┘
          │                    │                     │
          ▼                    ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│ DSH 执行平面      │  │ Laputa 身份平面   │  │ Evolution 进化平面 │
│ Session / Agent  │  │ 人格正文与版本     │  │ Evidence          │
│ Workspace / Jobs │  │ 来源 / 更新 / 回滚 │  │ Proposal          │
│ Tools / Skills   │  │ 不拥有权限与任务   │  │ Validation        │
└──────────────────┘  └──────────────────┘  │ PublicationRecord │
          │                                  └───────────────────┘
          ▼                                            │
┌─────────────────────────────────────────────────────┤
│                 记忆与知识资产平面                    │
│                                                     │
│  新个人记忆 → ActMem 活跃记忆卡                      │
│                     │ 衰减 / 关系 / 合并 / 更正       │
│                     ▼ ArchiveIntent                 │
│              MemPalace 长期归档与知识索引             │
│                                                     │
│  DSH Session 保存原始执行事实，不被记忆或进化改写      │
└─────────────────────────────────────────────────────┘

 Policy / 权限 / 隐私 / 预算 / 审批 / 审计 / 版本钉住贯穿所有层
```

## 6. 唯一事实源与数据所有权

“唯一事实源”按数据域落实。每类事实只能有一个权威写者，其他组件保存引用、派生投影或明确标识的副本。

| 数据域 | 唯一事实源与写者 | 其他组件可以保存 |
| --- | --- | --- |
| 主体与控制绑定 | Superagent | 各组件保存 `subject_id` 引用 |
| 人格 | Laputa | 带版本的只读上下文快照 |
| 活跃记忆、衰减和关系 | ActMem | 有界召回投影、归档引用 |
| 归档记忆与长期知识 | MemPalace | 检索结果、索引引用 |
| 电脑文件内容 | 原文件系统 | MemPalace 索引、摘要、hash 和来源位置 |
| 原始执行历史 | DSH Session | 只读证据引用和派生投影 |
| 任务、授权、审批与 Assignment | Superagent | 只读状态投影 |
| 外部副作用与回执 | Superagent 及对应外部系统 | 适配器游标、外部 ID、审计视图 |
| 进化证据、候选和验证 | Evolution | Superagent 保存任务关联与结果引用 |
| Skill 正式版本 | Skill 所有者 | Evolution 保存验证和发布记录 |
| 界面展示状态 | 各领域所有者 | 面板只保存临时草稿和查询状态 |

### 6.1 禁止的平行事实源

- MemPalace 不得通过独立 `identity` 文件成为第二人格来源。
- continual-harness 的 `memory` 条目不得成为 ActMem/MemPalace 之外的正式记忆库。
- continual-harness 的 `prompt` 条目不得成为 Laputa 之外的影子人格。
- SurfCore 不得长期持有与 ActMem 重复的可写记忆卡副本。
- 面板不得直接改写底层文件来绕过所有者 API。
- Evolution 不得复制 Superagent 的 Ticket、Effect 或 Outbox 状态作为第二控制账本。

## 7. 主体身份与版本

### 7.1 身份键

`subject_id` 是个人 Agent 在生态中的稳定归属根。Superagent 拥有主体与控制绑定，Laputa、ActMem、MemPalace 和执行记录通过它关联到同一主体。

`subject_id` 只表达归属，不意味着全局 Recap、单一活跃任务或永久在线进程。

| 标识 | 所有者 | 用途 |
| --- | --- | --- |
| `subject_id` | Superagent 主体绑定 | 关联同一逻辑主体 |
| `persona_id + persona_revision` | Laputa | 固定人格版本 |
| `workspace_id` | DSH | 文件与工作范围归属 |
| `session_id + agent_id` | DSH | 具体运行时与执行历史 |
| `ticket_id / assignment_id` | Superagent | 控制任务与执行绑定 |
| `effect_id / receipt_id` | Superagent | 外部副作用和对账 |
| `memory_id + revision` | ActMem | 活跃记忆版本 |
| `archive_id` | ActMem | 归档幂等键（`arch_<记录id>_r<revision>`），重试与恢复期间稳定 |
| `knowledge_id` | MemPalace | 长期知识定位 |
| `evidence_id / proposal_id` | Evolution | 证据与候选变更 |
| `skill_id + publication_id` | Skill 所有者 | 固定能力版本 |
| `policy_version` | Superagent | 固定授权与审批依据 |

所有跨域记录至少携带 `subject_id`、`schema_version` 和 `provenance`。外部内容还必须保留来源系统与外部标识。

### 7.2 ContextSnapshot

每次模型操作必须绑定不可变的 ContextSnapshot，至少包含：

- `subject_id`、`ticket_id`、`session_id`。
- `persona_id + persona_revision`。
- 当前 Recap 或其他派生上下文的投影版本。
- 本次使用的 ActMem 卡片及 revision 集合。
- 本次 MemPalace 查询、结果引用和索引版本。
- `skill_publication_id`。
- `policy_version`。
- 必要的电脑文件来源与内容 hash。

运行中的重试继续使用原 ContextSnapshot。只有声明的新操作边界才能选择新版本，禁止任务执行中静默切换人格、记忆或 Skill。

当前实现（E3-S1）：Laputa 的 `persona_revision` 已由不可变 revision 和 `current.json` 指针提供。每个 top-level agent 在安装时固定 live revision；发布和回滚只移动指针，新会话才采用新版本。

Recap 只能是从当前任务和 ActMem 生成的可重建投影，不是独立记忆事实源。

## 8. Superagent 控制主链

### 8.1 控制职责

Superagent 统一拥有：

1. 外部与内部输入的持久接纳和去重。
2. 主体绑定、准入、授权和审批。
3. Ticket/Task、Assignment 和执行状态。
4. 定时、主动行为、进化和维护任务的控制编排。
5. Effect、Outbox、Receipt、取消、重试、恢复和对账。
6. Policy、预算和并发控制。

DSH 负责真实模型与工具执行，资产服务负责各自数据提交。Superagent 不直接解释或复制其正文。

### 8.2 通用输入模型

以下来源统一转换为 InputEnvelope：

- 用户直接对话。
- GitHub、Feishu、QQ、B站事件。
- Schedule、Wake 和延迟依赖完成。
- 主动行为候选。
- EvolutionRequest。
- ActMem 整理、归档和 MemPalace 索引维护请求。

InputEnvelope 至少包含 `subject_id`、`source_id`、`external_event_id`、去重键、载荷或载荷引用、接收时间和来源元数据。

定时器和主动行为只产生 Trigger，不得直接调用外部插件执行动作。

### 8.3 从 GitHub 领域模型到个人 Agent 控制模型

现有 Trigger、Thread、Decision、Ticket、Assignment、Effects 和 Outbox 是目标架构的实现基础。GitHub 应逐渐成为一种 Source/Channel，而不是控制模型的中心假设。

改造应优先泛化配置、来源、执行环境和展示语义，不为了改名而重写已有持久状态机。个人对话、平台消息、主动行为和进化都可以复用 Ticket 生命周期，但在类型、Policy 和界面上明确区分。

第一步是把 GitHub 从部署前置条件降为可选 Source：`Deployment` 区分 `personal` 和 `github` 两种模式，未配置 GitHub 时 setup 正常完成、GitHub 轮询不启动、`gh` 兼容层和 GitHub 凭据助手不写入，面板显示“个人模式”。部分 GitHub 配置仍报错，不以自动降级掩盖配置错误。后续 Source/Channel 通过同一 `SourceKind` 契约接入，不再让任何单一平台成为控制模型的前提。

### 8.4 执行与并发

- 同一 Ticket 的状态变更和输入交付保持顺序。
- 不同 Ticket 可以并行执行。
- 同一资产所有者的写入通过串行队列或 CAS 保证版本一致。
- 运行中的 Assignment 使用固定 ContextSnapshot。
- Superagent 的恢复语义以持久记录为准，不以模型声称或进程内状态为准。

## 9. ActMem：活跃记忆系统

### 9.1 拥有的数据

ActMem 拥有全部活跃个人记忆，包括：

- 记忆卡正文、标题、来源和创建时间。
- 重要度、清晰度、衰减和置顶状态。
- 人物、实体、话题及其关系。
- 会话话题、成员印象、待说事项和近期经历。
- 合并、更正、遗忘和归档状态。
- 活跃召回、注入预算和隐私范围。

### 9.2 写入规则

- 所有新的个人记忆先写入 ActMem。
- MemPalace 不再独立自动捕获每轮对话并形成第二活跃记忆库。
- Evolution 只能通过 ActMem API 提交经批准的活跃记忆变更。
- 外部平台适配器只能提交带来源的记忆候选或原始事件，不能直接修改召回状态。
- ActMem 的整理、衰减和合并必须保留来源、操作记录和恢复信息。

只读召回可以并行查询 ActMem 与 MemPalace，再在查询投影中合并结果；活跃与归档写路径仍按所有权分别串行处理。

2026-11-04 落地：MemPalace 删除自动捕获与 `mempalace:wakeup` 注入；启动迁移备份 `config.json`，把 `identity.txt` 移入 `archive/` 并写 `migration.json`；`/wakeup` 改为只读 `/recent-memory`，不进入系统提示。

2026-11-04 E2-S4 落地：记忆面板收敛为投影，只保留概览、记忆卡和设置；概览中的“归档出站”只读显示待投递、冲突、已确认、无效与最近错误，归档浏览、归档搜索和归档容量上限不再出现在面板。MemPalace 记忆页同样改为只读归档与检索，新增/删除入口移除，面向个人的写入只能经 ActMem。面板只读不改变归档投递与内部回执流程。

2026-11-04 E3-S2 + E4-S4 落地：ContextSnapshot 按 Assignment 冻结提示词 revision、skills/policy/执行环境摘要、可组装到的系统提示 section 摘要与 owner section 摘要，只存摘要，记忆召回正文和知识正文不复制进快照；worker Session 按“显式 KV revision → 快照 pin → 当前版本”读取提示词，master Session 不受影响。快照在 worker 收到任何消息之前捕获；捕获失败会让该 Assignment 直接失败，而不是让它无快照继续运行。Ticket 详情页的“执行追踪”是该快照、Receipt 与 Evolution 记录的只读投影，不写任何记录。MemPalace 的长期知识经 `knowledge_commits` 账本版本化（独立 `knowledgeId`、`commitKey` 幂等、`expectedRevision` CAS、四项必过检查、回滚追加新修订且历史保留），Evolution 只通过所有者接口 `publish-knowledge` / `rollback-knowledge` 发布或回滚知识，通用 `/publish` / `/rollback` 拒绝 MemPalace。

2026-11-04 E1-S5 + E4-S2 + E5-S3 落地：Schedule 规则保存在 `settings.schedule`，只在既有 `Passes.pumpOnce` 内检查（kick effects → closing 检查 → Schedule → Engine 到期评估），不新增定时器；每个到期槽位最多提交一次 `schedule` 层本地 trusted Input，首次见到规则、间隔变化或时钟回拨都重新基线化，暂停或关闭时不产生输入、恢复后不补历史槽。EvolutionRequest 以 `evolution` 层本地 trusted Input 进入 Engine，并在同一次工具调用内显式 accept 为 Ticket，不直接创建 Ticket。continual-harness 不再注册插件级自动精炼驱动，何时精炼由 Superagent 编排器决定；旧 profile 的 `autoRefine` / `auditReviews` 仍被接受但不启动任何评审。SurfCore 的目的投递、chat 主动搭话、社交主动开话题与 reserved2 `proactiveCheck` 四条路径统一转发为 `wake` 层、`human: false` 的主动候选，经 `dsh-surfcore-adapter` 的 `/proactive` 进入 Superagent，由 Policy 决定是否成为 Ticket；晨间问候仍是 SurfCore 侧的固定日程问候，不在迁移范围内。为完成转发，本批只改 `scripts/lib/surfcore-*` 的四个文件（含 `patchVersion` 3→4），`plugins/surfcore/` 子模块保持只读，运行时重渲染需后续 `setup:components` 或重启。

2026-11-04 E1-S6 + E4-S5 + E3-S4 落地：Schedule 面板可增删改规则并对已保存规则手动运行一次，手动运行仍走同一条 `Inputs.submit` 路径、消费当前槽位，重复点击返回 `duplicate`，不新增定时器。Evolution 面板的“进化记录”页只读消费既有 `/records`、`/proposal`、`/publication` GET 端点，按 Ticket 浏览四类记录，不提供写入、发布或回滚。Laputa revision manifest 增加可选 `source: { actor, note? }`（`panel`/`tool`/`command`/`bootstrap`），旧 manifest 无该字段时照常读取，损坏来源判 `revision_state_corrupt`；面板在版本历史与详情显示来源。

2026-11-04 E2-S5 + E4-S6 + E3-S5 落地：MemPalace 退役手工记忆写、删除与日记写的公开面——删除 `memory_save`、`memory_delete`、`memory_diary_write` 三个工具（17 → 14）、`POST /memories`、`POST /memories/delete`、`POST /diary` 三个路由与 `/mempalace save` 命令，三者返回 404；`GET /diary`、`memory_diary_read`、`memory_check_duplicate` 与知识图谱的显式写入保留，store 层 `store()`/`delete()`/`diaryWrite()` 只服务导入、迁移与维护。新增唯一只读端点 `GET /knowledge/commits`（`assetScope`/`asset_scope` 可选、`limit` 1–200 默认 50、按 `created_at DESC, rowid DESC` 稳定排序），面板知识页底部以只读卡片展示账本，不提供发布或回滚。Laputa 增加 `retainRevisions`（默认 0 = 不限）：发布/回滚在创建新版本前逐个校验待清理候选，候选损坏即中止；新版本与 `current.json` 指针提交后才删除多余目录并 fsync，当前版本永不被清理，no-op 发布与 bootstrap 不触发清理；`/status` 与面板概览显示 `revisionRetention`。

### 9.3 记录信封与 revision

- 记忆卡在 `meta.actmem` 保存 `schemaVersion`、`subjectId`、`createdAt` 和 `migratedAt`；主体 ID 只能来自 `DSH_SUBJECT_ID` 或 Superagent 的本机只读主体 API，插件不得自行生成。
- 每条记录携带 `subjectId`、`revision`、`provenance`（`source`、`at`，可选 `externalId` / `actor` / `note`）和 `relations`（`related`、`follow-up`、`contradicts`、`merged-from`）。
- 新建记录 `revision = 1`；正文、标题、归属、置顶、重要度或关系的有效修改递增 revision；重复写入、召回、衰减、压缩和派生初遇状态重算不递增。
- 写入前校验记忆卡与记录的主体归属；跨主体写入、更新的 ActMem schema 和不合法关系一律拒绝。旧卡首次写入时先备份，再补 `meta.actmem` 与记录主体；迁移幂等。
- 所有活跃记忆写入（外部事件、手动增删改、合并、维护摄取、恢复）都经 `service.actmem` facade，面板与模型工具不得绕过。

## 10. MemPalace：长期归档与电脑级知识库

### 10.1 归档记忆仓库

MemPalace 接收 ActMem 及其他合法来源的历史记忆归档，保存：

- 归档正文和结构化属性。
- 原始 `memory_id`、来源、时间和 `archive_id`。
- 归档时的人格、关系和上下文引用。
- 长期语义索引、全文索引和知识关联。
- 更正、替代和再次归档的历史关系。

归档后的长期内容以 MemPalace 为准。ActMem 只保留退出活跃召回所需的最小归档引用，不长期维持第二份可写完整档案。

### 10.2 电脑级知识索引

MemPalace 可以索引本地文档、代码、笔记和其他明确授权的知识源，保存：

- 来源路径或定位符。
- 内容 hash、索引版本和解析状态。
- 摘要、分块、向量、全文索引和知识关系。
- 访问范围、隐私标签和排除规则。

原文件仍是文件内容的事实源。文件变化时，MemPalace 使旧索引失效并重新构建，不得把旧索引当作当前文件内容。

### 10.3 ActMem 到 MemPalace 的归档协议

归档是保管权转移，不是永久双写。

```text
ActMem 选择待归档记忆
        ↓
生成 archive_id、内容快照和 digest
        ↓
持久化 ArchiveIntent
        ↓
MemPalace 幂等接收、写入并建立索引
        ↓
返回 ArchiveReceipt
        ↓
ActMem 标记已归档并退出活跃召回
```

要求：

1. `archive_id` 在整个重试和恢复过程中保持稳定。
2. MemPalace 按 `archive_id + digest` 去重，不同内容使用同一标识时返回冲突。
3. ActMem 未收到提交回执前，不撤销活跃版本。
4. 中断后先按 `archive_id` 查询 MemPalace 实际状态，再决定补写回执或继续归档。
5. 归档失败不得把原记忆当作已丢失或已归档。
6. 索引可重建，归档正文不得被索引重建过程改写。

实现说明（E2-S2）：

- 传输走组件内部 IPC：MemPalace 提供 `POST /archive` 与 `POST /archive/status`，公开面板 API 不暴露归档写入口。
- `archive_id = arch_<记录id>_r<revision>` 由 ActMem 铸造；`digest = sha256(canonical_json({ schema_version, subject_id, archive_id, content, meta }))`，两侧共用 `plugins/_shared/archive-contract.mjs`，MemPalace 按收到的字段重算，不接受调用方自证。
- MemPalace 复用 `memories` 表，新增 `archive_id`、`archive_digest`、`subject_id`、`archive_meta` 四列与 `(archive_id, chunk_index)` 部分唯一索引；归档行标记为 `source = 'actmem-archive'`。`reindex` 只重算向量，不改写归档正文。
- ActMem 从 `memory-card-full.jsonl` 的持久化偏移生成 ArchiveIntent（首次启动从 EOF 开始，不回填存量）；投递前先查 `/archive/status`，回执写入 `archive-outbox/receipts.jsonl` 后才删除意图；不同 digest 的冲突项移入隔离目录，永不自动重试。
- 未拿到回执前，本地 `fullArchivedAt` 只代表本地归档完成，投递状态由 `archiveOut` 单独投影；本地 JSONL 在 E2-S3 前保留为安全网。

## 11. Evolution：资产变更链路

### 11.1 与 Superagent 的生命周期区分

Superagent Ticket 管任务生命周期：是否接纳、何时运行、由谁执行、是否取消、如何恢复。

Evolution Proposal 管资产变更生命周期：改变什么、依据什么、验证是否通过、是否发布、如何回滚。

两者通过 `ticket_id + proposal_id` 关联，不互相复制状态。

```text
EvolutionRequest
        ↓
Superagent 接纳并创建进化任务
        ↓
DSH 执行 Evolution Engine
        ↓
Evidence → Proposal → Validation
        ↓
目标资产所有者 CAS 提交
        ↓
PublicationReceipt 回写 Superagent 任务
```

continual-harness 现有的独立自动精炼调度，如与 Superagent 重叠，应逐步退化为由 Superagent 调用的进化执行能力。

### 11.2 证据

Evidence 只能来自已提交或可独立核查的事实，例如：

- DSH Session 中的输入、模型操作和工具结果。
- Superagent Ticket 结果和外部 Receipt。
- 用户明确纠正、评价和反馈。
- ActMem 中带来源的记忆变更。
- MemPalace 中带来源的归档与知识冲突。
- Skill 调用版本和实际执行结果。

Evidence 保存不可变引用、原始 ContextSnapshot 和 provenance。原始 Session、外部回执和归档正文不得为了适应进化结论而被改写。

Recap、Dream 输出和模型自评只能作为派生材料，不能独立充当事实或成功证据。

### 11.3 候选与正式资产

| 候选类型 | 正式资产所有者 | 发布前最低验证 |
| --- | --- | --- |
| 人格 | Laputa | 基线版本、差异、来源、语义检查、回滚能力 |
| 活跃记忆 | ActMem | 去重、关系与隐私检查、活跃召回验证 |
| 长期知识 | MemPalace | 来源、冲突、归档完整性和检索验证 |
| Skill | Skill 所有者 | 冻结源码与环境、固定基线和留出集测试 |
| 行为 Prompt | 对应 preset/prompt 所有者 | 权限范围、行为回归和版本固定 |
| Subagent | Agent/preset 注册所有者 | 身份、工具范围和行为回归 |

在对应正式所有者尚未具备版本化写入能力前，候选只能保持 Proposal 状态，不得通过直接写文件激活。

### 11.4 验证与审批

Superagent Eval 判断任务是否应被接纳；Evolution Validation 判断资产变更是否应被发布。两者不得混为一个评分。

- 人格初期默认需要人工批准。
- 低风险知识更新可以按配置自动发布。
- Skill 必须通过隔离测试和基准验证。
- 高权限 Prompt、Subagent 和全局能力按高权限资产管理。
- 同一生成链不得同时负责出题、评分和批准。
- 审批、拒绝、取消和失败都必须持久化。
- 自动发布频率、预算和适用范围必须可配置，不得另设隐藏硬编码小上限。

### 11.5 发布与回滚

资产所有者按 `expected_base_revision` 执行 CAS 提交。基线已变化时，候选必须重新验证，不得覆盖他人更新。

回滚生成一个新版本，不删除历史，也不承诺撤销已经发生的外部副作用。运行中的任务继续使用原版本，新任务在明确边界采用回滚后的版本。

**当前实现（E3-S1）**：Laputa 的工作目录是草稿，`$DSH_HOME/laputa/.state/<personaId>/revisions/rNNNNNN/` 保存不可变 revision，`current.json` 是 live 指针。发布同时校验 `expected_base_revision` 与草稿内容摘要；回滚复制目标 revision 生成新 revision（记录 `parent` 与 `restoredFrom`），再把草稿恢复为目标内容。revision、manifest 与指针写入均使用同目录临时文件、fsync 和原子 rename；发布、回滚和 bootstrap 由 fail-fast 文件锁串行化，损坏的 revision 状态不会静默回退。运行中的 top-level agent 固定在启动时的 revision，`/laputa reload` 只刷新调用方会话；版本来源已由 E3-S4 写入 manifest（`source.actor` + 可选 note），保留策略由 E3-S5 落地（`retainRevisions`，默认 0 不限）。

**当前实现（E4-S1）**：Evolution 开始持有自己的记录存储。`.artifacts/dsh-home/evolution/evolution.db`（可用 `DSH_EVOLUTION_STATE_DIR` 改位置）内是 `evidence`、`proposal`、`validation`、`publication` 四张 append-only 表：行只追加，状态转移写成同 id 的更高 `version` 行，更新或删除历史由库级触发器直接拒绝。候选正文不入库，只保存内容 digest、一行说明和可回溯的 `refs` 定位符；发布记录只保存目标所有者返回的版本引用，不保存资产字节，因此进化库不会成为第二份正文仓库。`ticket_id` 是关联文本，proposal 与 publication 必填、evidence 可空，库里不复制 Superagent 的任务生命周期。发布必须绑定一条与该候选摘要相符且 `verdict=passed` 的验证，一条验证只能支撑一次发布；回滚写入 `purpose=rollback` 的新发布记录并保留全部历史。尚未具备版本化写入能力的所有者（MemPalace、Skill、行为 Prompt、Subagent）在存储层就被拒绝发布，候选只能保持 Proposal。读写全部经过本地回环 API，面板仍是只读消费方。真实的所有者 CAS 提交、harness 精炼交由 Superagent 编排，以及记录与运行结果的对账仍属于后续 Story。

## 12. 外部系统与 SurfCore 改造

### 12.1 边缘适配器职责

QQ、B站、GitHub、Feishu、语音和其他外部系统适配器只负责：

- 协议转换、认证和平台限流。
- 外部事件 ID、游标和传输状态。
- 将外部事件转换为 InputEnvelope。
- 将 Effect 转换为平台动作。
- 返回外部 ID、结果或未知状态。
- 执行来源专属隐私和范围检查。

适配器不拥有全局人格、ActMem、MemPalace 或 Ticket，不自行建立绕过 Superagent 的自主行为主链。

### 12.2 外固化链路

```text
外部事件 / 用户输入 / Schedule / Wake
        ↓
持久 InputEnvelope + 去重键
        ↓
Admission / Policy / Approval
        ↓
Ticket + Assignment + ContextSnapshot
        ↓
DSH 执行或 EffectIntent
        ↓
Outbox → Edge Adapter → 外部系统
        ↓
Receipt / external_id / unknown
        ↓
恢复、对账、审计和经验证据
```

每个 Effect 必须有稳定幂等键。执行结果不明时，先通过外部 ID、平台查询或适配器专属对账确认事实，禁止盲目重试。

只读工具可以由 DSH 直接执行；具有外部副作用的工具必须进入 Effect/Receipt 链。

2026-11-04 E4-S3 落地：continual-harness 的写入收敛为 `skill`。`prompt`、`memory`、`subagent` 的直接 create/update 被拒绝并返回所有者名称（Laputa/Superagent 提示词、ActMem、Superagent Agent 注册表）；删除旧条目与回滚重放仍允许。状态投影和系统提示只注入 `skill`，harness 不会成为这些类别的第二事实源。正式 Proposal 持久化仍留给 E4-S2。

### 12.3 SurfCore 能力归位

| SurfCore 能力 | 目标归属 |
| --- | --- |
| 记忆卡、衰减和关系 | ActMem |
| 全量记忆归档 | 迁移到 MemPalace |
| QQ/B站事件与发送 | Superagent Source/Channel Adapter |
| 主动搭话和目的机制 | Proactive Trigger + Superagent Policy |
| 定时任务 | Superagent Schedule/Trigger |
| 语音合成与发送 | Effect Adapter |
| 平台配置、凭据和健康 | 对应 Adapter |
| 管理页面 | 领域所有者的查询与操作投影 |

SurfCore 与 Superagent 的高级改造不是增加双向直接调用，而是让 SurfCore 的平台能力进入统一控制链，并取消重复调度和重复记忆状态。

首个完整外部闭环是 QQ + B站，围绕 SurfCore 收口：

- `plugins/surfcore` 子模块保持只读，构建期锚点补丁只连接事件入口和发送入口，不承载业务状态。
- 新增 `plugins/dsh-surfcore-adapter/` 作为唯一边缘适配器，持有游标、外部 ID、平台配置和传输状态。
- 入站事件转换为 `InputEnvelope` 交给 Superagent，出站发送成为带 `effectId`/`idempotencyKey` 的 Effect，并以 Receipt 回写结果。
- 社交记忆不直接写入 ActMem 或 MemPalace；由 Superagent 写入 ActMem，归档经 ActMem → MemPalace 协议完成。
- 主动搭话与目的机制不再是 SurfCore 的独立主链：E5-S3 之后 SurfCore 只生成候选并经组件 IPC 转发，是否成为 Ticket 由 Superagent Policy 决定。

语音现有的 prepare/commit/abort 语义可映射为 Effect 的准备、提交和中止；外部投递事实仍以 Receipt 为准。

2026-11-04 E5-S2 落地：语音 `commit-send` 经 `voice` Effect 投递并记录 `externalId` 回执；已由 SurfCore 发送的路径只写 `external` 回执，不注册 deliverer。同一 token 重复 commit 复用首次结果；`retryUnknown: false` 使 `unknown` 结果不自动重投；`abort-send` 拒绝在途与终态。

2026-11-04 E5-S3 落地：SurfCore 的四条主动路径（目的投递、chat 模式主动搭话、社交观望期主动开话题、reserved2 `proactiveCheck`）改为调用 `submitSurfcoreProactive`，由 `dsh-surfcore-adapter` 封装为 `wake` 层、`human: false` 的 Input，携带 QQ `channel.thread` / `channel.address`，去重键为 `proactive:<kind>:<key>:<slot>:<hash16>`。被 Policy 忽略的候选只留下 Decision，不产生 Ticket；这比“每个主动行为都有 Ticket”更保守，准入决定仍完全由 Policy 做出。目的路径转发失败会回退 `countToday` 并重排，chat 路径删除待发送记录，social 与 proactive check 丢弃候选等下一轮。晨间问候是固定日程问候，仍由 SurfCore 负责，不经过该通道。SurfCore 自身的频率与概率配置继续生效。

## 13. 一致性、恢复与失败语义

### 13.1 不使用跨库分布式事务

Superagent、DSH、ActMem、MemPalace、Laputa 和 Skill 所有者不依赖一个跨库原子事务。跨域操作通过稳定 ID、持久意图、幂等提交、回执和对账完成。

### 13.2 原始事实、派生投影与正式资产

- DSH Session 和外部 Receipt 是原始事实，不原地改写。
- Recap、搜索索引和面板视图是派生投影，可以按版本重建。
- 人格、活跃记忆、长期知识和 Skill 是正式资产，只能由所有者版本化提交。
- 投影损坏不导致原始事实被覆盖；资产提交失败不伪装成投影成功。

### 13.3 崩溃恢复

- 任务恢复以 Superagent 持久状态为准。
- 模型操作恢复以 DSH 已提交记录和冻结 ContextSnapshot 为准。
- 外部结果不明时先对账，不直接重放副作用。
- 归档中断按 `archive_id` 对账。
- 资产发布中断按 `publication_id` 查询目标所有者，再补写回执。
- 部分成功必须明确显示，不得把未知结果报告为成功或空状态。

### 13.4 回滚边界

资产回滚只影响后续上下文，不回写原始证据，不删除外部平台已经产生的消息、文件或其他副作用。需要补偿外部副作用时，必须创建新的 Effect。

## 14. 安全、隐私与治理

1. Laputa 人格内容不改变权限、审批和安全规则。
2. Policy 由 Superagent 版本化拥有，审批不能隐藏在提示词中。
3. 自动捕获、主动行为、自动进化和外部发送分别配置，不因其中一个开启而默认开启其他能力。
4. ActMem 和 MemPalace 的召回必须遵守来源、平台、会话和隐私范围。
5. 电脑知识索引必须有明确目录范围、排除规则和凭据保护，不默认索引整个磁盘。
6. 平台凭据由对应适配器管理，不进入人格、记忆正文或进化证据。
7. 跨平台公开与私聊数据隔离，公开共享必须显式启用。
8. 自产内容必须保留 provenance，未经独立核查不得提升为外部事实。
9. 所有自动化预算、并发、频率和范围均可配置并进入审计。
10. 用户能够暂停自主行为、停用进化、撤销未执行 Effect，并对正式资产执行版本回滚。

## 15. 查询、界面与可观测性

面板是领域状态的投影，不是额外事实源。

| 界面 | 主要展示与操作 |
| --- | --- |
| Superagent | 主体、任务、审批、Effect、Receipt、恢复、主动行为和系统健康 |
| 人格 | Laputa 当前版本、差异、来源、历史和回滚 |
| ActMem | 活跃记忆卡、衰减、关系、合并、召回预览和归档状态 |
| MemPalace | 归档记忆、长期知识、电脑索引、来源和检索 |
| Evolution | Evidence、Proposal、Validation、Publication 和失败原因 |
| 连接与设置 | Source/Channel、Policy、隐私、预算和自动化开关 |

Laputa 面板当前实现（2026-11-04，E3-S3）：概览页显示 live revision 与草稿是否待发布；文件页编辑草稿；版本页读取 `GET /dsh-laputa/api/revision?revision=N` 返回的 manifest 与服务端有界行级差异（`from` 为当前 live，`to` 为所选历史版本），回滚复用 `POST /dsh-laputa/api/rollback` 并生成新 revision。面板不读取文件系统、不直接写文件，也不通过版本接口接收六份完整文件正文。

一次操作应能关联查看：输入、Ticket、ContextSnapshot、执行 Session、外部 Receipt、产生的 Evidence，以及后续 Proposal/Publication。

界面不得把“尚未执行”“执行中”“结果未知”和“已成功”合并为同一种完成状态。

## 16. 迁移阶段

### 阶段 0：冻结架构边界

- 确认本文的事实源、ID、版本和写路径。
- 为跨域记录补充 `subject_id`、`schema_version` 和 provenance。
- 建立所有权与禁止平行事实源的边界测试。

### 阶段 1：建立通用控制骨架

- 在保留现有 Ticket 状态机的基础上，泛化 GitHub 专属假设。
- 建立 SubjectBinding、通用 InputEnvelope 和 Effect/Receipt 关联。
- 将 Schedule、主动行为和 EvolutionRequest 纳入 Superagent 编排。
- GitHub 从启动前置条件改为可选来源；未配置时以 `personal` 模式运行。
- 保证移除 GitHub 配置后，个人对话、记忆和维护任务仍能运行。

### 阶段 2：收敛记忆事实源

- 完成 QQ + B站经 SurfCore 的收发闭环；社交记忆统一写入 ActMem。
- 将独立记忆插件明确升级为 ActMem 活跃记忆所有者。
- 将 ActMem 现有全量归档迁移到 MemPalace。
- 实现幂等归档协议和中断对账。
- 停止 MemPalace 对个人对话的独立双写捕获，将新个人记忆统一送入 ActMem。
- 移除 MemPalace 的独立人格权威，只保留知识索引和归档职责。

### 阶段 3：固定人格与上下文版本

- 为 Laputa 增加 revision、来源、CAS、发布和回滚。
- 为模型操作建立 ContextSnapshot。
- 将 ActMem、MemPalace、Skill 和 Policy 版本纳入操作记录。
- 保证重试冻结版本，新操作显式选择版本。

### 阶段 4：收敛 Evolution

- 将 continual-harness 的独立自动调度接入 Superagent。
- 保留 Evidence、Proposal、Validation 和 PublicationRecord。
- 将 `memory`、`prompt`、`subagent` 条目区分为候选或迁移到正式所有者。
- 先复用 Skill 发布能力，再实现 MemPalace 知识目标，最后开放 Laputa 人格自动更新。

### 阶段 5：迁移外部适配器与界面

- 在 QQ/B站闭环之后，迁移语音和其余外部系统及主动行为。
- 取消重复调度、双写和插件间直接可写调用。
- 将各面板改为领域投影，打通任务、记忆、进化和外部回执的关联查询。

迁移必须保留可验证备份。过渡双写只能用于有明确截止条件的迁移校验，不得成为长期架构。

## 17. 架构不变量与验收标准

1. 每条新的个人活跃记忆只能由 ActMem 提交。
2. 每条已归档记忆的长期内容只能以 MemPalace 为权威来源。
3. MemPalace 的电脑文件索引可以重建，且不替代原文件事实源。
4. Laputa 是唯一人格事实源，其他组件不得注入第二套人格正文。
5. 每个自主行为都有 Superagent Ticket 和可追踪的准入依据。
6. 每个外部副作用都有 Effect 和最终 Receipt，未知结果不得盲重试。
7. 每个 Evolution 任务都由 Superagent 编排，没有第二套独立控制主链。
8. 每次资产变更都有 Proposal、Validation 和 PublicationRecord。
9. 每次模型操作都能恢复其 ContextSnapshot 和资产版本。
10. 原始 Session、Evidence 和 Receipt 不被后续记忆或进化结论改写。
11. 插件不得绕过所有者 API 直接写入其他领域的数据文件。
12. 停用 Evolution 不影响 Superagent 控制、ActMem 和 MemPalace 的基本读写。
13. 移除 GitHub 配置不影响个人对话、记忆、主动行为和电脑知识索引。
14. 重启后，任务、归档和外部副作用可以恢复并对账，不产生重复提交。
15. 回滚只生成新资产版本，不伪造历史或撤销外部事实。
16. 面板只展示领域投影，不成为第二业务数据库。

## 18. 当前实现与目标的主要差异

| 当前实现 | 目标改造 |
| --- | --- |
| Superagent 主要围绕 GitHub 仓库与 Ticket | 泛化为个人 Agent 的 Source 中立控制核心 |
| 独立记忆插件同时持有活跃卡片和全量归档 | ActMem 持有活跃记忆，归档保管权转交 MemPalace |
| MemPalace 已停止自动捕获并归档 identity.txt，记忆页改为只读归档投影；手工记忆写/删除/日记写已退役（E2-S5），公开写面只剩显式知识图谱写入；知识版本账本可在面板只读查看（E4-S6） | 新个人记忆进入 ActMem；人格归 Laputa；MemPalace 负责归档和知识索引，面板只做投影 |
| Laputa 已具备草稿、不可变 revision、CAS 发布与回滚；版本来源已记录（E3-S4，manifest 的 `source.actor` + 可选 note 并在面板显示）；保留策略已落地（E3-S5，`retainRevisions`，默认 0 不限） | 保留窗口、来源与回滚目标语义保持一致 |
| continual-harness 只写 `skill`；`prompt`/`memory`/`subagent` 直写被拒绝；E4-S2 起插件不再注册自动精炼驱动，`harness_refine`/`/refine`/`harness_wrapup` 仅在显式调用时执行 | 统一由 Superagent 编排，非 Skill 条目分流到正式所有者；自动精炼的时机同样归编排器，插件保留能力与兼容键 |
| 语音发送已接入 `voice` Effect，未知结果不自动重投；SurfCore 自有发送路径只写 external 回执 | 外部投递事实统一以 Receipt 为准，重复发送由幂等键与回执去重 |
| Evolution 已落地四类记录的存储与本地 API；`OWNERS.mempalace.versionedWrite = true`，`publish-knowledge` / `rollback-knowledge` 经 MemPalace 内部 IPC 提交与回滚并记录 owner 版本引用，通用 `/publish` / `/rollback` 拒绝 MemPalace；精炼时机已交还编排器；记录面板只读浏览（E4-S5）已可按 Ticket 查看四类记录与提案/发布历史 | 其余所有者同样经真实 CAS 发布并回写 Publication 结果 |
| E1-S5 已落地 `settings.schedule` 与 `Schedules`：规则在既有 pass 循环内检查，每个到期槽位最多一次 `schedule` 层本地 trusted Input，暂停/关闭不提交、不补历史槽；`orchestrator_evolution_request` 以 `evolution` 层 Input + 显式 accept 在一次调用内建 Ticket。E1-S6 已补面板表单与“立即运行”，手动运行消费当前槽位 | Schedule 与 EvolutionRequest 都进入统一控制链 |
| E5-S3 已把 SurfCore 四条主动路径改为 `wake` 层、`human: false` 的候选转发，由 Policy 准入；被忽略的候选不产生 Ticket，晨间问候仍由 SurfCore 负责；`plugins/surfcore/` 未改写，只改 `scripts/lib/surfcore-*` 四个文件并等待运行时重渲染 | 主动行为完全由 Proactive Trigger + Policy 表达；固定的日程问候与平台限频配置仍留在适配器 |
| SurfCore 保留平台调度和部分独立状态 | 平台能力逐渐成为 Superagent 边缘适配器 |
| E3-S2 已按 Assignment 写不可变 ContextSnapshot（schema 13 的 `context_snapshot` 表）：只存提示词 revision、skills/policy/执行环境/工具/section 摘要与 owner section 摘要；E2-S3 之后 ActMem 不再注册系统提示 section，`owners.actmem` 为 `absent` | 同样按 Assignment 冻结，但资产正文不入快照；记忆召回与知识正文由所有者按快照中的摘要追溯 |
| E5-S4 已落地为 Ticket 详情页内的只读“执行追踪”节：逐条展示 Receipt 原始状态，经 `GET /dsh-evolution/api/records?ticket_id=` 读取 Evolution 记录，不 import 插件源码、不写记录 | 目标是统一的关联查询投影；本 Story 未新增顶层标签，也不替代各面板的领域视图 |
| SurfCore 保留平台调度和部分独立状态 | 平台能力逐渐成为 Superagent 边缘适配器 |
| 面板按现有插件边界展示 | 按控制、身份、活跃记忆、长期知识和进化领域投影 |

## 19. 现有实现参考

- [Superagent 当前架构](../superagent/docs/007-architecture.md)
- [Superagent 执行模型](../superagent/docs/003-execution.md)
- [ActMem 当前载体：独立记忆插件](../plugins/memory/README.md)
- [MemPalace 当前插件](../plugins/dsh-mempalace/README.md)
- [continual-harness 当前插件](../plugins/dsh-continual-harness/README.md)
- [Laputa 当前插件](../plugins/dsh-laputa/README.md)
- [actmem-recap 当前插件](../plugins/dsh-actmem-recap/README.md)
- [SurfCore 功能迁移现状](feature-restoration.md)
- [项目开发计划](superpowers/plans/vivy-dsh-ecosystem/index.md)
- [Wave 0 可执行计划](superpowers/plans/vivy-dsh-ecosystem/wave-0-boundaries-and-contracts.md)
- [E1-S1 可执行计划](superpowers/plans/vivy-dsh-ecosystem/e1-s1-github-optional.md)

这些链接描述实现基础；发生差异时，以本文已确认的目标边界为后续改造依据，并同步更新本文，而不是让实现与文档长期分叉。
