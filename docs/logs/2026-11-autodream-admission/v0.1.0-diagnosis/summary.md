# v0.1.0 AutoDream 自动精炼「没触发」定因：门槛通过、准入忽略

- 状态：已交付（**纯只读调研，未改代码/配置/数据**）
- 范围：新建 `docs/research/autodream-auto-admission.md`；本目录四件套；`TODOLIST.md` 增 DV-EV-018（决策闸门）
- 验证：见 `verification.md`（只读 manifest/JSON + `node:sqlite` 只读查 `orchestrator.sqlite` + 复算 policyVersion）
- 未验证：主会话模型当时的完整提示词与卡片全文；方案 B 的 patch 测试面；`Passes` 接入量
- 下一步：等用户就 `docs/research/autodream-auto-admission.md` §6 的 D1–D6 拍板
- 回滚：删除报告与本日志目录，撤销 TODOLIST 条目

## 改了什么

1. 新增调研报告，结论先行：**自动精炼触发了，被 Superagent 准入判 `ignore`**。
   - 证据链：manifest `lastCheck.eligible=true`（18 会话 / 3071 引用，本地 00:52:08）→ Input `3ed7d8de…` 提交成功 → 15 秒后 `decision 97813868…` 记 `kind:ignore`、`ignoredFromCard`、fanout 空 → 全库唯一 Ticket 早在 11/11 15:31 结束，inputs 不含该 Input → 无 run、`lastCompletedAt` 不动。
   - 结构原因：`policyVersion 9fbbf9a0…` 经复算等于**内置默认策略**（规则只有 `copy`/`visual`，模式 `observe`），说明 Policy 从未配置；自动请求 `human:false` → inferred，必须过规则，而 refine 语义上匹配不上。
   - 对照：手动 refine 是 `human:true` → explicit，绕开规则，所以 11/11 那次能跑完。
   - 另记 4 条次级缺口：忽略结果不回写（面板永远 `submitted`）、`requests[].ticketId` 从不回写、只在 appReady 检查一次、同快照去重导致「重启也无效」。
2. 给出方案 A/B/C/D + 附带修 F1–F3 与 D1–D6 决策清单，**未实施任何一条**。

## 影响面

- 用户可见：新增一份诊断报告与一个决策闸门条目。
- 数据/性能/依赖：无。未改 `.artifacts/`（仅只读打开 sqlite，`readOnly: true`）。
- 重启要求：无。

## 未验证

1. 主会话评估时的完整提示词与候选卡片（只拿到 decision 的 `said` 摘要）；
2. 方案 B（Input 显式强度字段）在 `superagent/tests` 的回归面；
3. F3 若挂到 `Passes.pumpOnce` 的改动量；
4. `settings-before-9` 等遗留键是否留有更早的 Policy 历史（本轮 `kv` 无任何 settings 快照，按「从未配置」判定）。

## 备注

- 取舍：只做定因与决策清单，不动代码（`diva-research-to-decision`）；最小可用快解是 A（1 行），推荐是 B（语义诚实）先修 F1（让失败可见）。
- 反例意识：没有把「面板显示满足条件」当作「已执行」；结论完全落在 `decision` 表与 policyVersion 复算上。
