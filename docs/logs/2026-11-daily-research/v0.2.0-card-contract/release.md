# 卡片契约决策 · v0.2.0-card-contract · 发布

- 形态：文档交付 + 一份只读克隆。无代码、无配置、无依赖变更；未安装、未部署。
- 交付物：
  - `docs/research/card-contract-decision.md`（决策建议 D-A…D-F）
  - `docs/logs/2026-11-daily-research/v0.2.0-card-contract/`（四件套）
  - `.workspace/genui`（第三方仓库克隆，仅供研究；`.workspace/` 不参与构建、不入库）
- 影响面：仅 `docs/`、`TODOLIST.md` 与 `.workspace/`；`plugins/`、`.artifacts/dsh-home/`、上游三仓零改动。
- 回滚：删除决策文档与本日志目录；删除 `.workspace/genui`；`DV-DOC-016` 条目按需回退。
- 后续：用户拍板后另开实施条目（`DV-UI-xxx`），本目录只读保留。
