# 发布记录 v0.0.1-survey

- 是否发布：否
- 不发布原因：纯文档 + 状态登记，无代码行为变化；按 `AGENTS.md` §6「不自动提交」，提交时机由用户决定。

## 发布步骤

1. 无。本轮不产生发布物，不涉及 `plugins/surfcore` 的发布三闸门。
2. 如需入库：`git add docs/research/mempalace-obsidian-integration.md docs/logs/2026-11-mempalace-obsidian TODOLIST.md`，
   建议提交信息 `docs: survey MemPalace/Obsidian integrations and propose a read-only plugin route`。

## 发布后必做

- 需要重启的进程：**无**。文档不进入运行时路径。
- 用户可见的变化：无。
- 需要回头核对的信号：
  - 若决定走 A 路线，先复核 `http.mjs` 是否已有本机 token 通道（当前没有），再开实施条目；
  - 若 mnemos 发布 Obsidian 插件（roadmap v1.3 / v0.6.0），§5 的「未开工」结论必须重读；
  - 若上一轮记忆里的项目确认为其他仓库，§2.3 与 §3 需替换，不沿用旧结论。
