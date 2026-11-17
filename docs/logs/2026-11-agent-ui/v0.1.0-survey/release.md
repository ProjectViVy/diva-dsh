# Agent UI 协议调研 · v0.1.0-survey · 发布

- 形态：文档交付，无代码、无配置、无依赖变更；不上架、不部署。
- 交付物：
  - `docs/research/agent-ui-protocols.md`（调研报告，结论 + 三档口径 + 四个候选 + C1–C6 卡点 + D1–D6 决策 + 参考 + 未核实）
  - `docs/logs/2026-11-agent-ui/v0.1.0-survey/`（summary / verification / acceptance / 本文件）
  - `TODOLIST.md`：新增 `DV-DOC-014`（L0 决策闸门，`waiting-user`）
- 影响面：仅 `docs/` 与 `TODOLIST.md`；`deepseek-harness/`、`superagent/`、`plugins/surfcore/` 无改动，无 submodule 指针变化。
- 回滚：删除上述三处新增即可；`TODOLIST.md` 的 `DV-DOC-014` 块单独删除。
- 后续版本：拍板后按所选路线另开 `docs/logs/2026-11-agent-ui/v0.x.0-<route>/`，本目录不再修改。
