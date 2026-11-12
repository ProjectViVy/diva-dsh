# 发布记录 v0.0.1-feasibility

- 是否发布：否
- 不发布原因：纯文档评估，无代码行为变化；按 `AGENTS.md` §6「不自动提交」，提交时机由用户决定。

## 发布步骤

1. 无。本轮不产生发布物，不涉及 `plugins/surfcore` 的发布三闸门。
2. 如需入库：`git add docs/research/obsidian-mempalace-feasibility.md docs/logs/2026-11-obsidian-mempalace TODOLIST.md`，
   建议提交信息 `docs: assess Obsidian-to-MemPalace indexing and note write-back`。

## 发布后必做

- 需要重启的进程：**无**。文档不进入运行时路径。
- 用户可见的变化：无。
- 需要回头核对的信号：
  - 若走 A 路线实施 M0，`archive.mjs` 的 `PROJECTS` 白名单**不要动**——笔记域不经过归档；
  - 若未来 ActMem 或插件升级改了 `memories` 表结构，§5 的「同库不同表」前提要重新确认；
  - 若默认嵌入模型换成多语模型，`vec_memories` 必须全量 reindex，否则新旧向量空间混用会污染排序。
