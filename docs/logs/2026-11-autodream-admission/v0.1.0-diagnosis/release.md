# 交付 v0.1.0 AutoDream 定因

- 类型：只读调研（诊断 + 决策清单），无代码/配置变更。
- 交付物：
  - `docs/research/autodream-auto-admission.md`（新建）
  - `docs/logs/2026-11-autodream-admission/v0.1.0-diagnosis/`（summary / verification / acceptance / release）
  - `TODOLIST.md` 新增 DV-EV-018（决策闸门，`waiting-user`）
- 未触碰：`plugins/`、`patches/`、`superagent/`（只读）、`deepseek-harness/`（只读）、`.artifacts/` 下任何可写数据（sqlite 以 `readOnly: true` 打开）。
- 回滚：删除上述两个文档目录并撤销 TODOLIST 条目；无数据迁移、无残留进程。
- 下一版本：等 D1–D6 拍板后开 `v0.2.0-admission-fix`，届时才动 `dream.mjs` / `superagent-input.patch` / 面板。
