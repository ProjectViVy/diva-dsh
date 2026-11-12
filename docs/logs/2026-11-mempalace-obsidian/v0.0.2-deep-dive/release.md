# 发布记录 v0.0.2-deep-dive

- 是否发布：否
- 不发布原因：纯文档 + 状态登记，无代码行为变化；按 `AGENTS.md` §6「不自动提交」，提交时机由用户决定。

## 发布步骤

1. 无。本轮不产生发布物，不涉及 `plugins/surfcore` 的发布三闸门。
2. 如需入库：`git add docs/research/mnemos-deep-dive.md docs/research/mempalace-obsidian-integration.md docs/logs/2026-11-mempalace-obsidian TODOLIST.md`，
   建议提交信息 `docs: deep-dive mnemos source and record the narrative-first pivot findings`。
3. `.workspace/mnemos/` 是参考克隆，**不入库**（`.workspace/` 已被 `.gitignore` 排除）；不要 `git add` 它。

## 发布后必做

- 需要重启的进程：**无**。文档不进入运行时路径。
- 用户可见的变化：无。
- 需要回头核对的信号：
  - mnemos 若发布 Obsidian 插件（ROADMAP v0.6.0 / README v1.3），深挖报告 §0 与 §8 的「无插件」「P3」两条必须重读；
  - mnemos 若补跑 v1.3.0 的 LongMemEval 并给出新范式数字，§7.3「新范式没跑基准」的结论作废，需要更新；
  - 若决定落地 §9 的笔记 schema，先在我们的导出器里做**只读**映射，不要引入写入路径。
