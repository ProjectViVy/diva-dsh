# v0.2.2 过期折叠分界作废

## 做了什么

用户发现日常页里还摆着十来条 Dream/refine 汇报（`dream_*` 候选、`worker_report`、`worker_attention`、`ticket_ended`，以及每轮那句「没有投递通道，只能在这里说」）。核对 master 会话日志后确认：那是第 1–10 轮（seq 42–236）的编排汇报，第 11–13 轮（seq 259–284）是他本人的三句话。

用户选定「删整条 master 会话」（备份到 `backups/20261115-master-session/`，需停 host 执行）。这条路径会留下一个隐患：日常页的折叠分界按会话 id 存在 `localStorage`，会话被重建后 seq 从头数，旧分界指向一条不存在的消息。若不处理，新会话的前几条会被当成「更早的」收起来。

所以本轮只改一处：**分界比整条会话最后一条还大时作废**，并从 `localStorage` 抹掉。

## 为什么不在日志里挖洞

用户原话是「手动删除处理一下」，但日志要求 `seq` 连续（`deepseek-harness/packages/core/session/src/surface.ts:518` 直接抛 `session event seq N is not contiguous`）。挖掉 seq 42–236 就得把后面 60 多条事件重编号，连带校验边界与引用；为一个几百 KB 的会话手改唯一真源，风险不对等。真正的「整段删除」只有「删整条会话」这一种形态——正是用户选的那条。

## 改动

- `plugins/dsh-daily/client.js`：`ChatPane` 里算 `lastSeq`，`stale = lastSeq < fold`；作废时 `setFold(null)` 并 `writeFold(id, null)`；`splitThread` 用 `boundary`（过期即 `null`）。
- `tests/daily-client.test.mjs`：新增「分界指向已不存在的消息时作废」。

## 留下的东西

- `.artifacts/dsh-home/reset-master-session.mjs`：一次性搬移脚本（`--dry` 可试跑），只在 host 停着时动手，端口还在监听就拒绝执行。
- 残留还会再来：master 这一条会话既是编排日志又是聊天窗，superagent 每投一次工单结果都会上墙。彻底治法是让日常页不上墙 relay 触发的回复（上一轮方案 B），本轮未做。
