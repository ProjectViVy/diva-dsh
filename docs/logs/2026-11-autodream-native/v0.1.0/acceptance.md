# 运行期验收（v0.1.0，需重启）

前置：`npm run restart`（会终止承载当前会话的 DSH 进程，由用户执行）。重启后浏览器硬刷新（面板代码在 `src/client.js`，服务端会重新下发）。

## A. 模式注册

- [ ] **A1** 「模式」选择器里出现 9 条 preset，新增一条显示为「自动精炼」。
  依据：`plugins/dsh-evolution/cordis.patch.yml` 的 `@deepseek-ai/dsh-agent-preset` 行（id `dsh-autodream`，order 60）。

## B. 普通会话没有被放宽

- [ ] **B1** 在普通会话里问「你有没有 dream_refine 工具」→ 回答没有；工具清单里也没有。
  依据：`dream_refine` 只在 launcher 的会话作用域注册，不再是根注册的全局工具。

## C. 手动精炼

- [ ] **C1** 「进化 → AutoDream」点「创建手动精炼」→ 不报 `EVOLUTION_*`，`/dream` 里出现一条 `status: running` 的请求，带 `agentSessionId: dream-…`。
- [ ] **C2** 该会话标题为 `手动精炼 YYYY-MM-DD HH:MM`，在会话列表里能打开。
- [ ] **C3** 会话首个请求的可用工具恰为 `skill` + `dream_refine`（没有 `read/write/edit/bash/pwsh/web_*/subagent/todo_write`）。
- [ ] **C4** 会话自行走完 `claim → evidence → baseline → plan → execute`，面板「请求与运行」显示进度；`/dream` 在 `execute` 后状态变为 `completed` 或仍是 `running` 直到本次轮次结束。
- [ ] **C5** 候选进入「进化 → 审批」待批列表，与旧链路一致（来源显示为 `来源请求 <requestId>`）。

## D. 自动精炼

- [ ] **D1** 把冷却改为 0（门槛可留默认）→ 等最多 15 分钟（或重启触发首次检查）→ `/dream` 出现 `mode: auto` 的请求，会话标题 `自动精炼 …`，id 形如 `dream-<uuid>`。
- [ ] **D2** 该会话 id 被证据扫描排除：下一次精炼的 `claim` 里不出现上一个 `dream-…` 会话。
- [ ] **D3** Superagent 里没有任何新 Input / Ticket（`/inputs`、工单列表无新增）——说明链路已彻底脱离准入。

## E. 失败面

- [ ] **E1** 把 `dsh-autodream` 的 preset 行临时注释掉 → 手动精炼返回 `failed`，`lastError` 说明 preset 解析失败，且没有半成品会话（回滚生效）。
- [ ] **E2** 把 `skill` 从工具面去掉（在 preset 里禁用对应插件）→ 请求 `failed` 而不是退回不受限的工具面。
- [ ] **E3**（可选）杀掉正在跑的 Dream 会话进程 → 2 小时后该请求变 `timed_out`、运行 `blocked`，门槛恢复可触发。

## F. 冷却

- [ ] **F1** 精炼结束后立刻触发检查 → 被冷却挡住，`/dream` 显示 `冷却中`，不新建会话。
