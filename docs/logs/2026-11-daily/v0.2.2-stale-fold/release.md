# 发布与回滚

## 影响面

- 运行时：无（纯客户端半边，刷新即生效；本轮没有改 host 侧）。
- 数据：本轮**没有**搬任何东西；搬移要等用户在 host 停着时跑 `reset-master-session.mjs`。
- 仓库：`plugins/dsh-daily/` 在根仓库未跟踪，改动不进 git 索引；`tests/daily-client.test.mjs` 已跟踪。

## 回滚

- 只撤本次改动：删除 `client.js` 里 `ChatPane` 的 `stale`/`boundary` 相关四行与那个 effect，恢复 `splitThread(thread, fold)`；删掉测试里那一例。或从 `.artifacts/dsh-daily-backup/20261115-before-genui/` 覆盖回 genui 之前版本（更早的口径，会一起丢掉「新建聊天」）。
- 撤回搬移：把 `backups/20261115-master-session/` 下的三样按原路径搬回。
- 只撤「新建聊天」：见 `docs/logs/2026-11-daily/v0.2.1-folded-chat/acceptance.md` 末尾的六处删。

## 没做的

- 日常页过滤 relay 回复（上一轮的方案 B）：残留会随新的工单汇报再长出来，本轮按用户选择只删一次。
- 清理 `dream-e67a8723…` 会话与 `work/refine-dream-evidence-c0674ee29a6b/`：`cleanup-autodream.mjs` 里有，本轮没动，需要时另行执行。
