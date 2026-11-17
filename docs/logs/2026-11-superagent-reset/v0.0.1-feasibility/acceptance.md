# 验收清单

本阶段没有运行期交付，没有可点的东西。验收对象只有决策：`TODOLIST.md` 决策闸门里那条的 D1–D6。

拍板后另开实施条目，届时按下面验收（此处只先写下来，不执行）：

## 若选 A（设置分区 + 排队执行）

1. 设置导航出现「Superagent」一节，与 模型/账户/插件 并列，点在它上面能只刷右侧内容。
2. `GET /status` 报的数字与磁盘一致（sqlite 大小、会话目录数）。
3. 点「排队」后本页显示已排队；`npm run start` 之前重启浏览器仍是已排队（标记在磁盘）。
4. `npm start` 的输出里有一行说明搬了哪些东西、搬到 `backups/reset-<stamp>/`。
5. 起来之后：日常页 master 为空、不再出现 AutoDream 旧汇报；侧栏那条会话在但空。
6. 想回滚：把 `backups/reset-<stamp>/` 里的东西 rename 回去，再 `npm start`，历史回来。
7. 「全初始化」档：工单/评估/触发/提示词修订都没了（`orchestrator.sqlite` 被搬走）；重启后板是空的、提示词回到默认。

## 若选 B（只 CLI）

1. `npm run reset:superagent -- --dry` 只打印目标，不动文件。
2. `npm run reset:superagent` 在 host 停着时成功、在 host 跑着时拒跑（探活）。
3. 搬完 `npm start`，其余同上。
