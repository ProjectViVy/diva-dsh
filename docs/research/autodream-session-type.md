# AutoDream 独立会话类型（「自动精炼模式」）调研

- 状态：调研结论（§5.1 已补最终决策与落地结果）；调研时未改任何代码
- 日期：2026-11-13
- 调研对象：DSH agent preset（「模式」）机制、Superagent 建会话的方式、dsh-evolution 的 Dream 链路
- 关联：[autodream.md](../autodream.md)、[dream-executor.md](../dream-executor.md)、[autodream-auto-admission.md](autodream-auto-admission.md)（上一轮准入诊断）

## 0. 结论

1. **可行，而且这是本仓已经走过的路。** DSH 的「模式」就是 agent preset：一条 `@deepseek-ai/dsh-agent-preset` 行，config 只有 `id / name / description / order / plugins`
   （`deepseek-harness/packages/preset/agent-preset/src/index.ts:16-23`）。标准（普通）、创造、极简、PTC 四条内置模式都是
   `packages/bundle/web-app/presets/*.patch.yml` 里的同一种声明。当前 profile 运行时实际注册了 **8 条** preset，其中两条
   （`preset-qq-chat`、`preset-qq-chat-v2`）是本部署自己的，说明「新增一个模式」在这里是常规操作，不是吃螃蟹（证据见 §2.1）。

2. **Superagent 能当执行器，不是因为它特殊，而是因为它就是一个 DSH 插件。** 它用
   `ctx.sessionController.create({ sessionId, workspaceId, agentPreset })` 建会话（`superagent/src/app/sessions.ts:138-155`），
   用 `agent.followup()` 投喂消息（`superagent/src/app/delivery.ts:66-85`），再把会话装饰成工单执行器。
   **dsh-evolution 是同一层插件，同一套 API 对它开放**；它现在唯一的缺口是 `inject` 里没有 `sessionController`
   （`plugins/dsh-evolution/src/index.mjs:11`）。所以「autodream 模式」不需要新机制，只需要 evolution 自己建会话。

3. **「autodream 模式」= dsh-evolution 自己声明一条 preset + 自己建/自己喂/自己收尾。** Ticket 与准入可以整体退出这条链路：
   Dream 不是「派给 executor 的活儿」，它不碰仓库、不需要工单授权、也不该经过 Policy。副产物是
   `patches/superagent-dream.patch` 可以退役，少一个要随上游升级维护的补丁。

4. **三处硬耦合必须拆，否则只是「换了个 preset 名字」。**
   - ① `dream.mjs#authorize` 用 Superagent HTTP 查 Ticket 活性（`dream.mjs:211-218`）；
   - ② `dream-tool.mjs` 从会话 id `worker-<ticketId>` 反推 Ticket（`dream-tool.mjs:45-49`）；
   - ③ Dream 正文经 `/orchestrator/api/inputs` 投递（`dream.mjs:200`），也就是上一轮诊断里被准入吞掉的那一步。

5. **推荐两步走（多·快·好·省：先证明机制，再拆耦合）。**
   - 第一步（小，约半天）：声明 `dsh-autodream` preset，让 Superagent 的 dream 工单用这个 preset 建会话（Ticket 暂留）。
     目的只有一个：证明 preset 能挂载、`dream_refine` 在该会话里可达。失败面小，回滚只需删一行 YAML。
   - 第二步（约 1–2 天）：摘掉 Ticket，evolution 自己 `create + prompt`，授权改成「journal run + 会话身份」。
     两步之间每一步都能单独验证，不会出现「同时换 preset 和授权模型、出错定位不了」。
   - 备选：一步到位（只做第二步）。少一次改动，但首次运行时 preset 挂载、工具面、授权三件事同时变化，出问题成本高。

6. **不建议 C（独立 profile / 子进程）。** 收益只有 OS 级隔离，而 Dream 会话已经无 shell、无写文件工具（`docs/dream-executor.md:28-41`）；
   代价是新的 profile 引导、DSH_HOME 会话存储争用、进程与启动预算。不划算。

## 1. 调查口径与限制

- **「独立会话类型」的判定标准**（本文用它衡量候选）：① 在 preset 注册表里有自己的 id 与名字；② 会话确实以该 preset 创建
  （投影 `agentPreset` 可反查）；③ 驱动方是 dsh-evolution，不是 Superagent 的工单执行器；④ 工具面由预设 + 显式限制共同决定。
  四条都满足才算「模式」，只满足 ①② 只是「换了个壳」。
- **只读**：只读了源码、profile 配置、运行时 Inspect 与既有日志；没有改代码、配置、数据，也没有重启实例。
- **未实测的都在 §7 单列**，不混进结论。

## 2. 现状盘点

### 2.1 「模式」在 DSH 里是什么

| 事实 | 出处 |
| --- | --- |
| preset 行 config = `{ id, name, description, order, plugins }`；`plugins` 是子插件列表 | `packages/preset/agent-preset/src/index.ts:16-23` |
| 新建 preset 或覆盖内置 preset 都是 bundle 补丁：插一行 `@deepseek-ai/dsh-agent-preset` | `packages/preset/agent-preset-registry/README.zh.md:48` |
| 内置四条：standard（标准模式）、cordis（创造模式）、minimal（极简模式）、ptc | `packages/bundle/web-app/presets/{standard,cordis,minimal,ptc}.patch.yml` |
| preset 行**没有**「从选择器隐藏」的字段 | `superagent/cordis.patch.yml:18-19` 注释 |
| 建会话可指名 preset；空白会话复用时会写入 `agent-preset/selected` | `packages/api/session-controller/src/types.ts:288-305`、`packages/api/session-controller/README.md:44` |

运行时实际的 preset 注册表（`cordis_inspect_query` → host `Config.listConfigs`，`name: @deepseek-ai/dsh-agent-preset`，2026-11-13 01:4x）：

```text
preset-standard / preset-ptc / preset-minimal / preset-cordis        ← 原厂四条
dsh-superagent-worker-preset / dsh-superagent-router-preset          ← superagent 的两条
preset-qq-chat / preset-qq-chat-v2                                   ← 本部署自己的一条
```

> 注意两个命名偏差：用户说的「普通模式」在产品里叫**标准模式**（id `standard`）；「极简模式」= `minimal`；「创造模式」= `cordis`。

### 2.2 Dream 现在的链路

```text
appReady（一次）
  → dreamGate（enabled/cooldown/minSessions/minPrimaryEvents）
  → 快照冻结（scanDreamEvidence，过滤 worker-/orchestrator-/dream-/eval- 前缀会话）
  → POST /orchestrator/api/inputs { layer:'evolution', human: mode==='manual' }
  → Superagent 准入：human:false → machineGate → inferred → Policy（默认 copy/visual、observe）→ ignore
  → （应然）Ticket → worker 会话 worker-<ticketId>（preset dsh-superagent-worker）
  → patches/superagent-dream.patch 把工具收窄到 ['skill','dream_refine']
  → dream_refine claim/evidence/plan/execute → 候选进审批面板
```

上一轮已证明：**③ 之后的整条链一次都没跑成过自动的那一支**（自动 Input 被 `ignoredFromCard` 吞掉，只有手动 refine 走 explicit 成功过）。
本轮的判断补充一点：**问题不在「准入规则没配」，而在「Dream 本来就不该走准入」**——准入是为「要不要把这件事派给执行器」设计的，
而 Dream 不是派活，是自省。

Dream 会话本身的事实：

- 会话 id 固定 `worker-<ticketId>`，preset 是 `dsh-superagent-worker`（`WORKER_PRESET`，`superagent/src/app/sessions.ts:48,145`）。
- 工具面由补丁 `patches/superagent-dream.patch` 的 `DREAM_TOOLS = ['skill','dream_refine']` 收窄（`docs/dream-executor.md:28-41`）。
- **preset 本身不是工具边界**：profile/root 注册的工具对 preset 会话仍然可见，所以 superagent 还要在 `workOnly` 里
  `tools.restrict({ allow })`（`superagent/src/app/sessions.ts:283-297`）。新方案同样要有这一步，只是它可以由 evolution 自己拥有。

### 2.3 dsh-evolution 已经具备什么、缺什么

| 面 | 现状 |
| --- | --- |
| bundle 层 | 有：`dsh.bundle.patch = ./cordis.patch.yml`（`plugins/dsh-evolution/package.json:14-17`），当前只 insert 自己一行 |
| 数据 | 有：journal（`requests / runs / candidates / consumed / lastCheck / lastAttemptAt / lastCompletedAt`） |
| 快照与材料 | 有：`scanDreamEvidence`、`dream.evidence`（分页） |
| 审批 | 有：候选走 `harness /candidates`、`laputa /candidates/stage`，人审后由 owner 发布 |
| 工具 | 有：`dream_refine` 已注册在插件作用域（root 可见） |
| inject | `webServer, connection, configEditor, workspaceRegistry, sessionPersistence, appReady, tools`（`index.mjs:11`）——**缺 `sessionController`（建会话）、`agents`（取 agent 投喂）** |

## 3. 候选方案

### A. evolution 自建 `dsh-autodream` preset 并自己驱动会话（推荐终局）

- **是什么**：`plugins/dsh-evolution/cordis.patch.yml` 里插入一条 `@deepseek-ai/dsh-agent-preset`（id `dsh-autodream`，名字「自动精炼」）；
  evolution 在闸门通过后 `sessionController.create({ sessionId: 'autodream-<requestId>', cwd/workspaceId, agentPreset: 'dsh-autodream' })`，
  投喂同一段 Dream 正文，等 `dream_refine execute` 或 agent idle 收尾。
- **怎么接**：§4 的 K1–K6 全部要改；`dream.mjs` 的 `request()` 把 `api('inputs')` 换成会话创建 + 投递；`authorize()` 不再查 Ticket；
  `dream-tool.mjs` 的会话 id 正则换成 `autodream-<requestId>`；`primaryEvidence` 的前缀过滤加 `autodream-`。
- **代价（估算）**：preset YAML ~20 行；`dream.mjs` 授权/投递重构 ~60–90 行；新增 ~80–120 行的「会话驱动」模块（建、投、等、失败收尾）；
  `dream-tool.mjs` ~20 行；测试重写 `tests/dream-tool.test.mjs` 的绑定夹具；文档 3 处；退役一个补丁。
- **风险**：① 首次把「会话生命周期」握到 evolution 手里，失败/重试语义要自己兜；② preset 里引用的包解析基未在本层实测（§7）；
  ③ 会话会出现在侧栏列表里（可接受，见 K7）。

### B. 只把执行器换成 preset，Ticket 保留（推荐第一步）

- **是什么**：声明同一个 preset；`superagent/src/app/sessions.ts` 的 `ensure()` 按角色选 preset（worker / router / **dream**），
  Dream 工单用 `dsh-autodream` 建会话。Ticket、准入、重试全部不动。
- **怎么接**：`ensure` 加一个角色映射（~15 行），`DshExecutor` 传角色；准入仍需修（上一轮报告方案 B），否则会话依然不会建。
- **代价**：最小，~40 行 + 一行 YAML；`superagent-dream.patch` 可以同时退役（工具面改由 preset 声明 + 一条 restrict）。
- **风险**：Dream 仍然是「Superagent 的子执行器」，与用户要的「独立会话类型」只差一步；但它把「preset 能否挂载、工具是否可达」
  这唯一的未知先验证掉，且回滚只是删一行。

### C. 独立 profile / 独立进程

- **是什么**：新增 `autodream` profile，由 launcher 或 evolution 用 `dsh --profile autodream` 起一个只含 Dream 组合的进程。
- **怎么接**：新 profile 目录、引导脚本、与主进程共享 DSH_HOME 的会话存储、IPC 回传结果。
- **代价**：一个数量级的运维面（profile 引导、进程数、启动预算、写锁争用）。
- **风险**：DSH_HOME 内同一 Session 的写者唯一性、跨进程 subject/journal 一致性都要重新论证。
- **结论**：不推荐。隔离收益在 Dream 已经没有 shell 的前提下很小。

### D. 维持现状，只修准入（上一轮报告方案 B）

- 让自动 Input 以显式强度进入、生成 Ticket、跑现有 worker preset + 补丁。
- 优点：改动最小，当天可跑通；缺点：Dream 永久绑定在「工单执行器」语义上，且继续依赖一个要随上游维护的补丁。
- 定位：**兜底**，不是方向。

| 方案 | 改动量（估算） | 得到 | 失去 | 风险 |
| --- | --- | --- | --- | --- |
| A | 中（~1–2 天） | 真正的独立「自动精炼模式」 | Ticket 现成的重试/阻塞语义要自己实现 | 中（授权与生命周期自持） |
| B | 小（~半天） | preset 上线、补丁可退、A 的地基 | Dream 仍是工单执行器 | 低 |
| C | 大 | OS 级隔离 | 简单性 | 高（进程/HOME/锁） |
| D | 小 | 当天能跑 | 方向错误，补丁继续维护 | 低 |

## 4. 卡点（按实施顺序）

- **K1 授权凭据**：`authorize()` 现在靠 `GET /orchestrator/api/tickets/<id>` 证明「这是活的、被授权的 Dream」。摘掉 Ticket 后，
  凭据只能是「journal 里的 run + 该会话就是本次 run 的会话」。建议：`dream_refine` 只接受会话 id `autodream-<requestId>`，
  并且该 request 的 run 处于 `planning` 且未被终结；subject 仍用 `/orchestrator/api/subject` 校验（subject 是安装级身份，与工单无关）。
- **K2 会话 id 解析**：`dream-tool.mjs:45-49` 的 `/^worker-(...)$/` 与 `dispose` 绑定表要一起换；`dream.mjs:70,99` 的
  `^(?:worker-|orchestrator-|dream-|eval-)` 过滤必须加 `autodream-`，否则精炼会话会进下一轮的证据池。
- **K3 投递面**：`dream.mjs:200` 的 `api('inputs', …)` 是准入入口，必须换成本地会话投递。superagent 的做法是
  `agent.followup(freezeMessage(...))`（`delivery.ts:66-85`）；evolution 是 JS 插件，最小实现是用 `ctx.get('sessionController')`
  建会话后取 `agent`，按同样方式投递一次（幂等键 = requestId），或用客户端面 `conversation.send`（宿主侧不适用，需验证）。
- **K4 完成与失败**：Ticket 现在提供 `paused / ended / retry-health / blocked`。摘掉后要落到 journal：
  `run.phase` 增加 `failed/aborted`，`request.status` 增加 `ignored/failed`，并让面板显示「上次尝试」的原因（这正是上一轮 F1）。
- **K5 工具面**：preset 不是边界（§2.2）。A/B 都要在会话上 `tools.restrict({ allow: ['skill','dream_refine'] })`，
  并且 fail-safe 方向与现在一致：`dream_refine` 不在就只剩 `skill`，绝不回落到工作工具集。
- **K6 触发**：现在只在 `appReady` 检查一次（`docs/autodream.md:3`）。独立会话后加定时检查的成本很低（一个 `ctx.effect` 定时器），
  是否加是产品决策（D4），不是技术卡点。
- **K7 可见性/清理**：新会话会出现在侧栏与会话列表（preset 名会显示）。可选：跑完归档、或标题带日期便于识别；不建议隐藏（没有该字段）。
- **K8 会话标题与模型**：会话需要有可读标题（如「AutoDream 2026-11-13」）；模型沿用全局默认即可（`agent-default-model`），
  也可像 superagent 那样按角色 seed 一个（`role-models.ts:15-44`），属可选项。

## 5. 决策清单

- **D1 方向**：A（两步）/ 一步到位 / B（只换 preset）/ C（独立进程）/ D（只修准入）。
  **推荐：B → A 两步。** 影响面：B 决定 preset 归属与工具面；A 决定授权模型与生命周期归属。
- **D2 preset 归属与命名**：放在 `plugins/dsh-evolution/cordis.patch.yml`（与功能同仓，随插件升级），id `dsh-autodream`，
  名字「自动精炼」，`order: 92`（排在 superagent 的 90/91 之后），描述里写明「不供手动选择」。备选：放 profile 覆盖层（不入库，不推荐）。
- **D3 授权凭据**：`autodream-<requestId>` 会话 + run 状态（推荐）；备选：签发一次性 run token 写进 journal（更严格，但多一份要维护的状态）。
- **D4 触发**：仅 appReady（现状）/ 加定时检查 / 面板手动按钮。**推荐：A 落地后加定时检查**，否则「最近检查」永远停在启动时刻。
- **D5 会话可见性**：留在列表（推荐，可点开看模型到底怎么想的）/ 跑完归档 / 不处理。
- **D6 补丁退役**：B 阶段**保留**（已实施：工具面权威仍在补丁，preset 不是边界）/ 留作兜底直到 A 完成；A 再把 `tools.restrict` 搬到 evolution 后退役。
- **D7 工具面**：`skill + dream_refine`（推荐，与现状一致）/ 再加 `todo_write` 方便多步计划（增益有限，多一个可写状态）。

**不拍板不实施。**

### 5.1 最终决策（2026-11-13，已实施）

用户在读完 §3 后拍板「B 计划好，执行；A 不是我的本意」，随后在 B 的验证阶段改口：「不能加载 superagent 链路……流程是 时间到 → 准备语义 → 启动 autodream 精炼模式 → 提交人工审批」，并要求「按 dsh-webhook 新方案处理、旧代码旧决策作为第一交付原则、不残留死代码」。因此本条按一步到位落地，与上面的推荐不一致之处以本节为准：

| 项 | 拍板结果 | 与 §5 原推荐的差异 |
| --- | --- | --- |
| D1 方向 | **一步到位（直接做 A）**，B 的中间态只保留为历史日志 | 原推荐「B → A 两步」 |
| D2 preset 归属 | `plugins/dsh-evolution/cordis.patch.yml`，id `dsh-autodream`，名字「自动精炼」 | 一致（`order` 实际取 profile 里的行内声明） |
| D3 授权凭据 | **冻结请求 + 会话身份**：`request.agentSessionId === execution.agent.id`；owner IPC 回调只带 `requestId` | 原推荐 `autodream-<requestId>` 会话命名 + run 状态；实际会话 id 用 `dream-<uuid>`，正好被证据扫描的排除正则覆盖 |
| D4 触发 | appReady + **每 15 分钟**定时检查 | 一致（原推荐 A 之后加） |
| D5 会话可见性 | 留在列表，标题 `自动精炼/手动精炼 YYYY-MM-DD HH:MM` | 一致 |
| D6 补丁退役 | **立即退役**：`superagent-dream.patch` 移到 `.artifacts/retired/`，清单 12 → 11 | 原推荐 A 完成后再退役；实际与 A 同批完成 |
| D7 工具面 | `skill` + 会话内注册的 `dream_refine` | 一致；`dream_refine` 不再是全局工具 |
| 建会话方式 | **照抄上游 webhook 五步**（`dream-session.mjs`），不注册 webhook 路由、不伪造 `VerifiedWebhookDelivery` | 原方案没说清；备选方案因伪造 `kind:'webhook'` 来源被否 |
| 投递方式 | 手写 `UserMessage` 交给 `agent.followup()` | 原 §7 担心需要 `freezeMessage`；实测 `Agent.followup` 直接 `send(input,'next-turn',true)`，无运行时校验 |

实施与本决策的完整记录见 [docs/logs/2026-11-autodream-native/v0.1.0/](../logs/2026-11-autodream-native/v0.1.0/summary.md)。

## 6. 若选「B → A」的实施顺序（供拍板后执行）

> 本节是 §5 原推荐的两步走顺序，**未按此执行**——实际按 §5.1 一步到位。保留为历史记录；真实落地顺序见
> [docs/logs/2026-11-autodream-native/v0.1.0/summary.md](../logs/2026-11-autodream-native/v0.1.0/summary.md)。

1. **B-a**：`cordis.patch.yml` 加 `dsh-autodream` preset（先把 superagent 现有 worker 的工具清单瘦身成 Dream 需要的：`skill-filesystem`、`tool-skill`、`tool-result-pruner`）。
2. **B-b**：`sessions.ts` 的 `ensure()` 按角色选 preset；`DshExecutor` 传 `dream` 角色；会话上 restrict 到 `['skill','dream_refine']`。
3. **B-c**：删 `patches/superagent-dream.patch`（清单、测试、文档同步），跑 `npm run build:bundle` + `npm test`；重启后手动 refine 一次验证候选仍能落到审批面板。
4. **A-a**：`index.mjs` 加 `sessionController`、`agents` 注入；新增会话驱动模块（create / prompt / await / fail）。
5. **A-b**：`dream.mjs` 去掉 `api('inputs')` 与 `authorize` 的 Ticket 查询，改 run + 会话身份；`primaryEvidence` 前缀过滤加 `autodream-`。
6. **A-c**：`dream-tool.mjs` 换会话 id 解析与绑定；面板显示「会话 → 打开」「上次尝试结果」。
7. **A-d**：测试与文档（`docs/dream-executor.md`、`docs/autodream.md`、`docs/architecture.md` 的会话表）；定时检查（若 D4 通过）。

## 7. 未验证

- **preset 会话上能否直接 `agent.ctx.tools.restrict`**：superagent 在 host 侧对 agent 做（`sessions.ts:293`），evolution 同为插件，推断可行，未跑。
- **dsh-evolution 的 bundle 层里引用 `@deepseek-ai/dsh-tool-skill` / `skill-filesystem` 的解析基**：superagent 的同层引用可用，但那是它自己的层；未实测。
- **最小投递实现**：superagent 依赖 `@deepseek-ai/dsh-llm` 的 `freezeMessage`；JS 插件能否只用 `ctx` API 完成等价投递未实测。
- **会话归档/删除接口**：`sessionController` 是否有 archive（README 提到 unarchived 成员，未确认写接口）。
- **自动会话在 Web UI 里点开的表现**（composer、标题、preset 标签）未实测。
- **定时检查的实现代价**：未做，仅指出可行。
- 本文所有改动量均为估算，标注为估算，不是测量。

## 8. 参考

- `deepseek-harness/packages/preset/agent-preset/src/index.ts:16-23`（preset config 字段）
- `deepseek-harness/packages/preset/agent-preset-registry/README.zh.md:48`（preset 只能由 bundle 补丁声明）
- `deepseek-harness/packages/bundle/web-app/presets/{standard,cordis,minimal,ptc}.patch.yml`（原厂四条）
- `deepseek-harness/packages/api/session-controller/src/types.ts:288-305`、`README.md:44`（建会话可指名 preset）
- `superagent/cordis.patch.yml:20-27,125-131`（worker/router preset 声明）；`:18-19`（preset 无隐藏字段）
- `superagent/src/app/sessions.ts:48,138-155,283-297`（建会话、选 preset、restrict）
- `superagent/src/app/delivery.ts:66-85`（幂等投递的实现）
- `plugins/dsh-evolution/package.json:14-17`、`cordis.patch.yml:1-3`、`src/index.mjs:11`（evolution 的 bundle 层与注入面）
- `plugins/dsh-evolution/src/dream.mjs:70,99,200,207-233`（Ticket 耦合点）
- `plugins/dsh-evolution/src/dream-tool.mjs:45-49,102`（会话 id → Ticket）
- `patches/superagent-dream.patch`、`docs/dream-executor.md:23-41`（当前工具面收窄方式）
- 运行时 Inspect：`cordis_inspect_query` host/Config `listConfigs(name=@deepseek-ai/dsh-agent-preset)`，2026-11-13 01:48（8 条 preset）
- 上一轮诊断：[autodream-auto-admission.md](autodream-auto-admission.md)（准入为何吞掉自动 Input）
