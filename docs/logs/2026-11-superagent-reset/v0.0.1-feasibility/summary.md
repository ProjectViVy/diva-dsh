# Superagent 一键初始化：可行性结论（只调研，零改动）

- 问题：能不能在「设置 → 通用设置」加一个清除记忆/一次性初始化 superagent 的选项，并给它一个专用分区。
- 结论：**能做，不用碰上游三仓**。界面侧 `settings.section` 是 root 级 list slot，任何插件可注册一节（`slots.ts:57`；`ui-settings-account/index.ts:313`；`dsh-see-now` 早前就注册过）；也能只往「通用设置」里塞一行（`settings.general.item`）。
- 硬卡点一条：**真删必须在 host 停着时做**——`orchestrator.sqlite-shm` 由 host 持有（mtime = 11:02 启动时刻），master 会话日志正被 host 写（`cleanup-autodream.mjs:1-6` 就是这么写的）。所以点击只能是「排队」，执行放在下次 `npm start`。
- 推荐 A：新插件 `dsh-superagent-reset`（host prefix 路由 + client 设置分区）+ `scripts/lib/reset-superagent.mjs`（移到 `backups/`，可回滚）+ `start()` 里一步。备选 B：只做 `npm run reset:superagent` CLI（约 150 行、零 host 代码）。不推荐 C：改 patch 让 superagent 运行中自清。
- 顺手查到一个副作用要一起修：日常页的折叠分界存在 `localStorage`，清完历史后会指向不存在的 seq（不崩，但悬空）——`dsh-daily` 里加一行「最大 seq < 分界就丢弃」。
- 清掉 sqlite 不会换 master id（`runtime.ts:104` 用 stateDir 哈希兜底），所以日常页无需改认会话逻辑。
- 报告：`docs/research/superagent-reset.md`（含 D1–D6 决策清单）。
- 未验证：路由与分区的真实挂载（没写代码）；`connection.requestRejection` 在我们自己的 prefix 路由上是否同样可用（只在 laputa 里读过，未实测）；重置后 DSH 侧栏残留空会话条目的实际表现。
