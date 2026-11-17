# AutoDream 自动精炼为什么没跑起来：门槛通过、准入忽略

> 调查日期：2026-11-13（Asia/Shanghai）｜纯只读调研，未改代码/配置/数据
> 现象：进化 → AutoDream 面板显示「自动精炼：开启 · 满足启动条件」，新增会话 18 / 5、去重一手证据 3071 / 10，最近检查 = 最近尝试 = 2026/11/13 00:52:08，但最近完成精炼停在 2026/11/11 15:31:21。

## 0. 结论

**自动精炼到了，但被 Superagent 的准入（Eval）判成 `ignore`，所以没创建 Ticket，也没进入 Dream 执行器。**

1. `dsh-evolution` 的启动检查**通过了门槛**（18 会话 / 3071 条去重一手证据 / 已过 24h 冷却），并在 00:52:08 成功向 Superagent 提交了一个 Input（`3ed7d8de…`）。面板「最近尝试」就是这个时间——它确实尝试了。
2. 自动请求以 `human: false` 提交（`plugins/dsh-evolution/src/dream.mjs:200`），所以准入强度是 **inferred**（`patches/superagent-input.patch:394`），要走 Policy 的「规则 + accept 模式」评估。
3. 本部署的 Policy **从没配置过**：`policyVersion = 9fbbf9a0…` 正好等于**内置默认策略**（规则只有 `copy`/`visual`，accept 模式 `observe`）。实测哈希一致，见 §2.4。
4. 00:52:23（提交后 15 秒）主会话模型记录 `kind: ignore`，原因 `ignoredFromCard` + 原话「matches neither enabled rule (copy, visual)」，fanout 为空 → 无 Ticket → 无 Assignment → Dream 从未开始（`decision` 表 `97813868…`）。
5. 之后没有任何回写或重试：进化侧的请求永远停在 `status: submitted`，面板不显示「被忽略」，也没有告警。**所以看起来像「没触发」，实际是「被拒且无声」。**

即使当时把 accept 模式改成 `auto` 也救不了：`copy`/`visual` 两条规则都匹配不上这类工作，评估必然 `noRuleMatched`；而且 `directionAllowed()` 还要求 `implementation_requested=true` + 目标已定，Dream refine 请求很容易被判 `directionUnsettled`（`superagent/src/policy.ts:40-58`）。

## 1. 口径与限制

- 只读：仅读本仓源码/文档、`.artifacts/dsh-home` 下的 JSON 与 `orchestrator.sqlite`（`readOnly: true`）；没有改任何文件、没有重跑实例、没有改 Policy。
- 时间：容器里存的是 UTC（`toISOString`），本文按 UTC+8 换算成面板时间；两处都给。
- 「触发」的定义：门槛通过 + Input 提交成功。本文按此判定为「触发了但被拒」。
- 未核实项集中在 §7。

## 2. 证据链

### 2.1 门槛确实通过（manifest 原文）

`.artifacts/dsh-home/evolution/dream/subject_9a005bfc…/manifest.json`：

```json
{"enabled":true,"cooldownHours":24,"minSessions":5,"minPrimaryEvents":10}
lastCheck: {"at":"2026-11-12T16:52:08.762Z","eligible":true,"reason":"eligible","sessionCount":18,"primaryEventCount":3071}
lastAttemptAt: 2026-11-12T16:52:08.766Z
lastCompletedAt: 2026-11-11T07:31:21Z
consumed: 370   requests: 5   runs: 3
```

`16:52Z = 本地 00:52`，与面板一致；`eligible:true` 说明 `dreamGate()`（`dream.mjs:114-123`）三条都过了。

### 2.2 自动请求已提交（不是没发出去）

最近一条请求：`dream_385f4b24…`，`mode=automatic`，`status=submitted`，`inputReceipt={"outcome":"stored"}`，`snapshot.refs=3071`、`sessions=18`。

之前 4 条都是 `manual`（`human:true`），其中 2 条跑成了 run（一条 completed、一条 blocked 于 DV-EV-016 的授权错配）。

### 2.3 Superagent 侧收到了，但判了 ignore

`orchestrator.sqlite`：

| 表 | 关键行 |
| --- | --- |
| `trigger` | `3ed7d8de…`，`human:false`，`layer:evolution`，`actor:autodream`，at `16:52:08.786Z` |
| `disposition` | `3ed7d8de…`，`fanout: []`，`evalId: 180e8d7d…` |
| `decision` | `97813868…`，`kind: "ignore"`，`strength: "inferred"`，at `16:52:23.523Z` |
| `ticket` | 全库只有 1 张 `c0674ee2…`，`ended.by:executor`、`ended.at: 2026-11-11T07:31:39Z`（= 本地 15:31:39），inputs 里**没有** `3ed7d8de…` |
| `effect` | 0 行 |

decision 的 reason 原文：

```json
[{"code":"ignoredFromCard"},
 {"code":"said","values":{"text":"Inferred candidate: an identical dream-refine run request for dream_385f4b24 with no mention of the ended ticket. It matches neither enabled rule (copy, visual) — it is a DIVA dream refine execution, not a wording or visual fix."}}]
```

`ignoredFromCard` 是 `superagent/src/core/evals.ts:290` 给「凭候选卡片直接忽略、未经规则研判」补的标记；这条路在 `superagent/docs/002-authorization.md:87` 有明确定义。

### 2.4 Policy 是内置默认值（关键一环）

decision 的 `policyVersion = 9fbbf9a0cf77f5da1785bc7d03d13b0b`。用 `superagent/src/core/ids.ts:3` 的 `key()` 现场计算默认策略：

```
key('mandate-v3', JSON.stringify({ rules: DEFAULT_RULES, mode: 'observe', sources: {} }))
= 9fbbf9a0cf77f5da1785bc7d03d13b0b   ← 与 decision 完全一致
```

`DEFAULT_RULES`（`superagent/src/policy.ts:62-65`）只有两条：

- `copy` — Copy fixes（拼写/措辞/标点/既有翻译）
- `visual` — Visual fixes（局部间距/对齐/溢出/样式，且目标已定）

`eval.mode` 默认 `observe`（`policy.ts:84`）：即使匹配上，也只记「would accept」，不会接单。

结论：**这套部署的 Policy 从未被配置**（orchestrator 的 `kv` 里没有任何 settings 快照，`store.settings()` 因此落到 `SettingsSchema.parse({})` 的默认值）。

### 2.5 为什么手动能成、自动不能

`dream.mjs:200`：

```js
human: mode === 'manual'
```

- 手动 → `human:true` → patch 里 trusted source 的 `strength: 'explicit'`（`superagent-input.patch:394`）→ 显式请求，按 dispatch 直接路由，**不受规则与 accept 模式影响**（`docs/002-authorization.md:87` 最后一句）。11/11 那次 15:31 完成就是这么来的。
- 自动 → `human:false` → `machineGate()`（`superagent-input.patch:397`）→ inferred candidate → 必须过 Policy 规则。

`docs/autodream.md:5` 已经写明这层依赖：「满足条件只会提交普通 Superagent Input。自动请求的 `human` 为 `false`；Policy 可以拒绝或延迟。」——所以这不是实现 bug，而是**默认策略下必然失败**的设计缺口。

## 3. 根因分级

| 级 | 根因 | 证据 |
| --- | --- | --- |
| 直接 | 自动 Input 是 inferred，被判 `ignoredFromCard`，无 Ticket | decision `97813868…` |
| 结构 | Policy 从未配置，只有 `copy`/`visual` 两条规则 + `observe` 模式，这类工作永远匹配不上 | policyVersion = 默认哈希 |
| 结构 | 自动精炼依赖「inferred → 规则评估 → accept」，而 Dream refine 不是「拼写/视觉修复」，语义上无法用现有规则授权 | `policy.ts:62-65`、`directionAllowed` |
| 可观测 | 被忽略后进化侧不回写：`requests[].status` 永远 `submitted`，无 reason、无告警，面板首页也不显示 | `dream.mjs:194-205` 无回写；`client.js:951-956` |
| 可观测 | 请求记录从不写 `ticketId`（只有 run 有），面板恒显示「Ticket 尚未接纳」 | `dream.mjs:239` vs `client.js:965` |
| 调度 | 只在 appReady 检查一次，无常驻轮询；本次 00:52:08 就是一次启动检查 | `dream.mjs:372-388`、`docs/autodream.md:3` |
| 去重 | 相同 `snapshotDigest + instructionsDigest` 的请求会直接返回旧条目，不重投（除 `filtered`）；证据不变时重启也无效 | `dream.mjs:192-193,198` |

## 4. 候选方案

### 方案 A：自动请求改走 explicit（最小改动）

`dream.mjs:200` 改成 `human: true`（或只在 `mode === 'automatic'` 时也置真）。

- 是什么：复用已验证的手动路径，显式请求直接路由，绕开规则评估。
- 代价：1 行 + 文档；无新依赖。
- 风险：语义失真——把机器输入标成「人提的」。实际副作用（`executor/dsh.ts:38`、`intake.ts:43`、`replies.ts:44/58/78`）多数需要 `trigger.channel`，`local` 源没有 channel，所以不会真发消息；但 worker 提示词会把它当「人的请求」，且人类 trigger 能 resume 已结束 Ticket。provenance 仍记 `actor:autodream`，可追溯。

### 方案 B：给 Input 加显式准入字段（推荐）

在 `patches/superagent-input.patch` 里加一个受信层的强度覆盖（例如 `explicit: true`，仅 `local` 源且 `layer ∈ {evolution, schedule}` 生效，默认行为不变），`dream.mjs` 提交时带上。

- 是什么：把「谁写的」(`human`) 与「准入强度」(`explicit`) 解耦，保持语义诚实。
- 代价：patch 一处 + 插件一行 + 该 patch 的测试；需要 `npm run setup` 重渲染补丁并重启。
- 风险：动的是授权面，必须写清「仅受信本地层可用」，否则 external 源可以自称 explicit —— 用白名单收口。

### 方案 C：配 Policy：加规则 + `auto` 模式（不改代码）

在「Superagent → 设置 → Policy」加一条覆盖进化请求的规则，并把 accept 模式改 `auto`。

- 代价：0 代码，纯配置。
- 风险：高。`assessmentOutcome()` 要求 `directionAllowed()`（`implementation_requested=true`、目标已定、无需设计决策），Dream refine 大概率被判 `directionUnsettled`；即便通过仍依赖主会话模型每次判断，结果不稳定；而 `observe` 模式下永远只记 would-accept。

### 方案 D：承认自动不可用，只留手动

面板把「自动精炼」降级为「提示 + 一键手动」，或明确标注「当前策略下自动请求会被忽略」。

- 代价：0。风险：不满足「自动精炼：开启」的预期。

### 附带修（与 A/B/C/D 无关，建议无论如何做）

- **F1 回写结果**：提交后用 `disposition`/`decision` 反查（或定时一次），把 `status` 写成 `ignored`/`rejected` 并附 `reason`；面板在「最近尝试」旁显示「上次尝试被忽略：ignoredFromCard」。这是把「无声失败」变可见的最低成本改动。
- **F2 回写 ticketId**：`claim()` 拿到 ticket 后把 `run.ticketId` 写回 `requests[]`，面板的「Ticket 尚未接纳」才有意义。
- **F3（可选）到期检查**：像 `schedule` 那样挂到既有 `Passes.pumpOnce`，而不是新增定时器（`docs/architecture.md:287` 已有先例）。

## 5. 卡点（编号对应方案）

- **K1**：inferred 强度决定了自动请求必须过规则，而现有规则语义上不可能覆盖 refine（→ A/B/C）。
- **K2**：Policy 是默认值，等于「自动精炼在这套部署上从未真正可运行」（→ A/B/C，需先拍板承认这是配置缺口还是设计缺口）。
- **K3**：改动若落在 `human` 上，会连带影响 worker 提示词、resume、ack 语义（→ 方案 A 风险项；方案 B 无此副作用）。
- **K4**：忽略结果不回写，用户无法从面板判断「已提交但被拒」（→ F1）。
- **K5**：只在启动检查一次 + 去重，导致「重启也没用」的直觉是对的（→ F3；但不修也能用，取决于是否接受「等下次启动且证据变化」）。

## 6. 决策清单（不拍板不实施）

| 编号 | 决策 | 选项 | 推荐 | 影响面 |
| --- | --- | --- | --- | --- |
| D1 | 自动精炼怎么过准入 | A / B / C / D | **B**（快解可用 A 临时解锁） | `patches/superagent-input.patch`、`dream.mjs`、Policy 页 |
| D2 | 是否接受「机器输入 = 显式请求」的语义 | 是（A）/ 否（B） | 否 | 授权语义、worker 提示词、resume/ack |
| D3 | 是否先修可观测（F1/F2） | 先修 / 与 D1 同批 / 不修 | **先修 F1** | `dream.mjs` 状态机、`client.js` 面板、可能新增一次 disposition 查询 |
| D4 | 自动检查是否常驻（F3） | 保持仅启动 / 挂 `Passes` 到期 / 加定时器 | **保持仅启动**，先修 D1 再看 | 调度、`dsh-evolution` 与引擎耦合 |
| D5 | `docs/autodream.md:5` 的措辞 | 保持 / 补「默认策略下必然被忽略」 | 补 | 文档 |
| D6 | 是否把 Policy 配置纳入 `npm run setup` 基线 | 是 / 否 | 待 D1 定后再说 | 部署可重复性 |

## 7. 未核实

1. 主会话模型当时看到的候选卡片全文与完整提示词（只拿到了 decision 里的 `said` 摘要）；如需逐字复盘，要翻 orchestrator 会话日志。
2. 方案 B 的 patch 测试面（`superagent/tests/core-engine.spec.ts` 里 gate/admission 相关断言）需要在实施时逐条核对，本轮未跑。
3. `Passes` 到期驱动接入点（F3）的改动量未评估。
4. 若用户此前在面板里配过 Policy 又回滚过，`settings-version:*` 可能留有历史；本轮 `kv` 里未见任何 settings 快照，判定为「从未配置」，但没查 `settings-before-9` 之类的遗留键。

## 8. 参考

- 本仓：`plugins/dsh-evolution/src/dream.mjs:8,114-123,173-206,360-388`；`plugins/dsh-evolution/src/client.js:939-968`；`docs/autodream.md:3,5`；`patches/superagent-input.patch:187,394,397`；`docs/architecture.md:287`
- Superagent 源码（只读）：`superagent/src/policy.ts:62-65,84,40-58`；`superagent/src/core/evals.ts:290`；`superagent/src/core/ids.ts:3`；`superagent/docs/002-authorization.md:87`；`superagent/src/app/store.ts:184-197`
- 运行时数据：`.artifacts/dsh-home/evolution/dream/subject_9a005bfc…/manifest.json`；`.artifacts/dsh-home/state/superagent-local/orchestrator.sqlite`（`trigger` / `disposition` / `decision` / `ticket` / `effect` / `kv`）
- 访问日期：2026-11-13
