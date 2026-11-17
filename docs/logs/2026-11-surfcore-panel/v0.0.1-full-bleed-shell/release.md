# 发布记录 · v0.0.1-full-bleed-shell

- 发布形态：无独立发布物。改动是根仓库 `scripts/lib/surfcore-panel.mjs` 的外壳 CSS，经 `ensureSurfcoreAdapter` 写进 `.artifacts/surfcore-adapter/bundle/surfcore-panel.client.js`（生成物，不入库）。
- 上游：`plugins/surfcore` 子模块零改动，指针未动。
- 版本号：未升。父仓库没有为面板样式维护独立版本；本条日志目录名即交付标识。
- 提交：未提交（按仓库规则，用户说提交才提交）。
- 回滚：`git checkout -- scripts/lib/surfcore-panel.mjs docs/architecture.md`，再重建 bundle 并硬刷新。
- 生效：重建 bundle 后新页面即生效，实测不需要重启 DSH；重启也安全（无状态、无迁移）。
