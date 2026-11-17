# 验收标准 — v0.1.0 B（`dsh-autodream` 模式）

## A. 本轮已可判定

| # | 验收项 | 判定 |
| --- | --- | --- |
| A1 | `plugins/dsh-evolution/cordis.patch.yml` 声明 `dsh-autodream`，名字「自动精炼」、`order: 92` | 通过（`tests/dream-preset.test.mjs`） |
| A2 | 该 preset 不含 shell/fs/jobs/web 工具，含 skills 与 compaction | 通过（同上） |
| A3 | 补丁把 Dream 工单的会话建为 `dsh-autodream`，并在 `agent-preset/selected` 时重选 | 通过（同上，断言 `workerPreset`） |
| A4 | 补丁保留 `DREAM_TOOLS = ['skill','dream_refine']` 与 Dream 触发判定 | 通过（同上） |
| A5 | 补丁能在 11 个既有补丁之后应用并构建 | 通过（`npm run build:bundle` exit 0） |
| A6 | 产物里确实有新逻辑 | 通过（`superagent/lib/index.js` 含 `dsh-autodream`、`workerPreset`） |
| A7 | `superagent/` 工作树干净 | 通过（`git status --porcelain` 空） |
| A8 | 既有失败与本改动无关 | 通过（还原两个改动文件后同样 4 条失败） |

## B. 重启后才能验收（下一轮的检查单）

1. **B1 预设注册**：`cordis_inspect_query` host/Config `name=@deepseek-ai/dsh-agent-preset` 返回 9 条，含 `dsh-autodream`，`name` 为「自动精炼」。
2. **B2 挂载**：面板发一次手动精炼，Ticket 进入 running，且**不**出现 `agent-preset/invalid` / `preset … failed to mount`。
3. **B3 会话身份**：`worker-<ticketId>` 的会话日志出现 `agent-preset/selected` = `dsh-autodream`；在 UI 打开该会话后仍是它（不被守卫改回 worker）。
4. **B4 工具面**：该会话首个 `request/header` 的工具清单恰为 `skill`、`dream_refine`（无 fs/shell/web）。
5. **B5 业务闭环**：`dream_refine claim → evidence → plan → execute` 走通，候选出现在「进化 → 审批」，状态与今天一致。
6. **B6 自动那支不变**：自动检查仍被准入忽略（记录在 `decision` 表），**这是预期**，不按回归处理。

## C. 回滚验收

还原 `patches/superagent-dream.patch` 与 `plugins/dsh-evolution/cordis.patch.yml` → `npm run build:bundle` → `npm run restart`；预设列表回到 8 条，Dream 会话回到 worker preset。无数据迁移。
