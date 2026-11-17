# v0.1.0 「初始化 Superagent 会话」做成设置项

## 起因

用户先问「能不能一次性初始化 superagent、给它一个专用分区」（`docs/research/superagent-reset.md`，只调研未动手），随后在日常页看到十来条 Dream/refine 汇报残留，选了「删整条 master 会话」。手动脚本（`.artifacts/dsh-home/reset-master-session.mjs`）已经能把事办了，但要他记三条命令、每次都手打。

于是定稿：**把这件事做成一行动作**，位置是「更多 → 设置 → 通用设置」。这就等于把研究里的 D1 判成「通用设置一行」、D6 判成「新插件」，D3 维持「ActMem 不动」，D4 维持「排队到下次启动」。

## 为什么只能排队

搬移的目标是 `session.v4.jsonl.zstd`、`superagent-reset` 的投影缓存和洞察缓存，前两个正是 host 打开着的文件；`orchestrator.sqlite` 连 `-shm` 都被它持着。运行中 rename 会搬出一个半截状态。所以按钮只写标记，执行点放在 `scripts/vivy-dsh.mjs` 的 `start()`：`pruneLogs()` 之后、`spawn` 之前——那一刻 host 一定没起来。

零依赖的处理办法还有一个：不做 host 路由，让用户在设置里「复制一条命令自己去跑」。那不算插件，且用户已经否掉了这种手感。

## 做了什么

| 文件 | 作用 |
| --- | --- |
| `plugins/dsh-superagent-reset/lib/reset.mjs` | 排队标记、目标盘点、rename 进 `backups/reset-<时间戳>/`、结果落盘 |
| `plugins/dsh-superagent-reset/index.js` | `/dsh-superagent-reset/api` 的 status/queue/cancel，三层校验 |
| `plugins/dsh-superagent-reset/client.js` | 注册 `settings.general.item`，两段式确认、排队态、上次结果回显 |
| `plugins/dsh-superagent-reset/{package.json,cordis.patch.yml,README.md}` | 本地 bundle 的壳 |
| `scripts/vivy-dsh.mjs` | `start()` 里消费标记（`pendingRequest` → `applyReset`） |
| `scripts/lib/component-setup.mjs` | `componentPackages()` 加上本插件，交给 `npm run setup:components` 注册 |
| `tests/superagent-reset.test.mjs` | 11 例：盘点、排队、搬移成功/失败、路由确认与拒绝、注册形状 |

同一轮还补了 `dsh-daily` 的过期分界处理（`v0.2.2-stale-fold`）：会话被重建后 `seq` 从头数，本地那条折叠分界会把新的一段吞掉。

## 取舍

- **最简方案**：设置页一行 + 排队标记 + 启动器一步。没有 CLI（`npm run reset:superagent`），没有「立刻重启」按钮，没有 sqlite 档位。依据：用户要的是「别让我记命令」，CLI 对这件事没有增量；立刻重启会让我杀掉正在说话的这条会话。
- **一个备选**：只做 CLI（研究里的方案 B，约 150 行、零 host 代码）。更省，但不满足「放在设置里」。
- **没做的**：`settings.section` 独立分区（研究里的「专用分区」）。一行已经够用，独立分区要多写一个页面壳，且和「通用」里其它偏好条目离得更远。

## 已知边界

- 只清会话与缓存；工单、设置、提示词、记忆卡、人格都不动。想连 sqlite 一起回出厂，得另开一档——那是另一个所有者的数据。
- 残留还会再长：master 这一条会话既是编排日志又是聊天窗。日常页过滤 relay 回复（上一轮的方案 B）仍未做。
