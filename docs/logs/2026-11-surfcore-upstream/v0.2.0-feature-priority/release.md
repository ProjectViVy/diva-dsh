# 发布记录 v0.2.0

- 是否发布：否
- 不发布原因：纯调研文档；无代码、无配置、无子模块指针改动。

## 发布步骤

无。

## 发布后必做

- 需要重启的进程：无
- 用户可见的变化：`docs/research/surfcore-upstream-status.md` 多一节 §10.5；TODOLIST `DV-UP-001` 的下一步补了排序指针
- 需要回头核对的信号：
  - 上游 changelog 若把 `agentPreset` / `bridge-down` 一类条目回填到 0.8.10（即承认 0.8.7 没修透）→ P0 的判断要重排；
  - `packs/` 若开始出现第五个目录且 `index.js` 不再是骨架 → dev 线从 P3 升档。
