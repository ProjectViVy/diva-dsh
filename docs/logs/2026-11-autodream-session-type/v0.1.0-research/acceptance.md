# 验收标准 — v0.1.0 AutoDream 独立会话类型调研

## A. 本轮（调研交付）的验收

| # | 验收项 | 判定 |
| --- | --- | --- |
| A1 | 报告能回答「autodream 模式能不能做」 | 能，§0.1–0.2 + §3.A |
| A2 | 报告说清「模式」在这套系统里的实体与技术形态 | §2.1，含运行时 8 条 preset 的 Inspect 证据 |
| A3 | 说清 Dream 现在被什么卡住、要拆哪几处 | §0.4 三处耦合 + §4 K1–K8，均带行号 |
| A4 | 给出候选方案与取舍依据，而不是单一主张 | §3 A/B/C/D + 对比表 |
| A5 | 给出决策清单，用户能直接拍板 | §5 D1–D7，每条含推荐与影响面 |
| A6 | 未验证项单独列出，不混进结论 | §7 |
| A7 | 没有改动代码/配置/数据 | `git status` 只应出现 `docs/`、`TODOLIST.md` |
| A8 | 只读也留痕 | `verification.md` 21 条证据 + 1 条失败记录 |

## B. 拍板后（实施）的验收草案

> 只有 D1 选定后才适用；两阶段各自可独立验收。

### B 阶段（只换 preset，Ticket 保留）

1. `cordis_inspect_query` 的 preset 列表出现 `dsh-autodream`（`total` 从 8 变 9）。
2. 一次手动 refine 产生的会话，其投影 `agentPreset === 'dsh-autodream'`，工具列表只有 `skill` + `dream_refine`（用 `cordis_inspect_query` host/Tool 或会话内工具清单核对）。
3. 该会话能完成 `claim → evidence → plan → execute`，候选在「进化 → 审批」面板出现，状态与今天一致。
4. `patches/superagent-dream.patch` 若同时退役：`npm run build:bundle` 退出码 0，`node --test tests/*.test.mjs` 全绿。
5. 失败方向仍 fail-safe：禁用 `dsh-evolution` 时，Dream 会话只剩 `skill`，不会回落到工作工具集。

### A 阶段（摘掉 Ticket，evolution 自驱动）

6. 自动检查通过后，`journal.requests[]` 出现 `autodream-` 会话 id，且 `sessionController` 能解析到该会话。
7. 该会话 `dream_refine` 可 `claim/plan/execute`（授权走 run + 会话身份），全程不出现 Superagent Ticket。
8. 面板显示「上次尝试：已完成 / 被忽略（原因）/ 失败（原因）」；不再出现永远 `submitted` 的请求。
9. `primaryEvidence` 不把 `autodream-*` 会话当证据（造一个自动 run 后，再触发一次自动 run，证据里不应出现前者）。
10. 重启后不重复创建同一 request 的会话（幂等键 = requestId）。

## C. 明确不验收（本轮）

- 独立 profile/子进程（方案 C）的任何行为。
- 定时检查（D4）——未拍板前不实现。
- 会话归档/清理（D5）。
