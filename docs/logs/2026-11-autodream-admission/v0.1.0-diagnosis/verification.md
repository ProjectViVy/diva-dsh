# 验证记录 v0.1.0 AutoDream 自动精炼定因

> 只写事实：命令、预期、实际。本轮为只读调研，没有代码改动。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `grep -r "满足启动条件\|去重一手证据" plugins/` | 定位面板文案来源 | `plugins/dsh-evolution/src/client.js:943,953`；门槛字段来自 `dream.lastCheck` |
| 2 | 读 `plugins/dsh-evolution/src/dream.mjs` 全文 | 拿到门槛与提交逻辑 | `dreamGate()` 114-123；`request()` 173-206；`startup()` 360-366；`startDreamOnce()` 370-388 |
| 3 | `ConvertFrom-Json` 读 `…/evolution/dream/subject_9a005bfc…/manifest.json` | 当前门槛判定与请求清单 | `lastCheck{at:2026-11-12T16:52:08.762Z, eligible:true, sessionCount:18, primaryEventCount:3071}`；`lastCompletedAt 2026-11-11T07:31:21Z`；requests 5（1 automatic）/ runs 3 |
| 4 | `node:sqlite` 只读打开 `orchestrator.sqlite`，查 `trigger` | 该 Input 是否入队 | `3ed7d8de…`，`human:false`，`layer:evolution`，`actor:autodream`，`16:52:08.786Z` |
| 5 | 同上，查 `disposition` | 是否产生 fanout | `fanout: []` + `evalId 180e8d7d…`（走了 Eval，未建 Ticket） |
| 6 | 同上，查 `decision` | 判定结果与理由 | `97813868…` `kind:"ignore"`、`strength:"inferred"`、reason `ignoredFromCard` + `said("… matches neither enabled rule (copy, visual) …")`，at `16:52:23.523Z` |
| 7 | 同上，查 `ticket` / `effect` | 是否有 Ticket 接纳 | ticket 仅 1 张 `c0674ee2…`，`ended.at 2026-11-11T07:31:39Z`、outcome `completed`，inputs 不含 `3ed7d8de…`；effect 0 行 |
| 8 | 同上，查 `kv` | 是否存过 settings 快照 | 只有 prompt/input/session 类键，**无 settings 快照** → `store.settings()` 落默认值 |
| 9 | `node -e` 复算 `key('mandate-v3', JSON.stringify({rules: DEFAULT_RULES, mode:'observe', sources:{}}))` | 与 decision.policyVersion 比对 | `9fbbf9a0cf77f5da1785bc7d03d13b0b`，与 decision 完全一致 → 默认策略 |
| 10 | 读 `superagent/src/policy.ts:40-65,84` | 规则与模式语义 | `DEFAULT_RULES` 只有 `copy`/`visual`；`eval.mode` 默认 `observe`；`directionAllowed()` 另有硬门槛 |
| 11 | `Select-String patches/superagent-input.patch -Pattern human` | 自动 Input 的准入强度来源 | `:394` `trigger.human ? 'explicit' : 'inferred'`；`:397` 非 human 走 `machineGate` |
| 12 | 读 `docs/autodream.md:3,5` | 设计意图写明 | 第 3 行：「启动就绪后检查一次…没有常驻轮询」；第 5 行：「自动请求的 `human` 为 `false`；Policy 可以拒绝或延迟」 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 主会话评估的完整提示词/卡片 | 需翻 orchestrator 会话事件流，本轮只取结构化结论 | 用户要求逐字复盘时 |
| 方案 B 的 patch 回归 | 拍板前不改代码 | D1=B 时 |
| 改后再触发一次自动精炼 | 需要重启实例并造 5 会话/10 证据增量 | D1 实施后 |
| `settings-before-9` 等遗留键 | 本轮只读当前 `kv`；如怀疑历史回滚可再查 | D1 拍板时顺带 |

## 反向验证（可选）

无代码改动。反向检查做了两处：①确认不是门槛失败（`eligible:true` 且 `lastAttemptAt` 有值）；②确认不是 Input 投递失败（`inputReceipt.outcome=stored`、`trigger` 表有行）。两者都排除后，结论只能落在 `decision:ignore`。
