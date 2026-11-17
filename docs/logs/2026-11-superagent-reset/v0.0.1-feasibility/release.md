# 发布说明

## 变更

- 新增 `docs/research/superagent-reset.md`：可行性报告（现状盘点 / 三条候选 / 五个卡点 / D1–D6 决策清单）。
- 新增本日志目录（四件套）。
- `TODOLIST.md`：决策闸门加一条（等拍板，不含实施）。

## 代码

无。零改动，`git status` 里没有新的被跟踪文件变化（本目录与 `docs/research/` 属文档，按仓库惯例随下一下提交批次走）。

## 注意

- 结论里「必须停机」不是保守，而是观测到的：`orchestrator.sqlite-shm` 的 mtime 就是 host 启动时刻，文件由 host 持有；master 会话日志同时在被追加。
- 「清空历史」后 master id 不变（stateDir 哈希兜底），所以日常页不用改，但 `localStorage` 里的折叠分界要顺手丢弃，否则悬空。
