# 发布说明 — v0.1.0 B（`dsh-autodream` 模式）

## 交付物

| 文件 | 性质 |
| --- | --- |
| `plugins/dsh-evolution/cordis.patch.yml` | 修改：声明 `dsh-autodream` preset（skill + compaction，无工作工具） |
| `patches/superagent-dream.patch` | 重写：Dream 工单用 `DREAM_PRESET` 建会话并在被重选时保持；保留工具收窄 |
| `docs/dream-executor.md` | 修改：新增「The preset」、两条 Limits |
| `docs/autodream.md` | 修改：流程图与正文标注自动精炼模式 |
| `tests/dream-preset.test.mjs` | 新增：4 条护栏 |
| `docs/logs/2026-11-autodream-preset/v0.1.0-b/` | 新增：本四件套 |
| `TODOLIST.md` | 修改：DV-EV-019 状态与阶段记录 |

## 生效方式

1. `npm run build:bundle`（已执行，exit 0；产物 `superagent/lib/` 已含新逻辑）
2. `npm run restart` —— **必做**，否则运行中的进程仍是旧 bundle 与旧 profile。
3. 刷新页面；「进化 → 概览 → 精炼」发一次手动精炼做冒烟。

## 用户可见变化

- 预设/模式列表多一条「自动精炼」（不供手动选择，描述里已写明）。
- Dream 会话改在该预设下运行；候选、审批、面板文案、Ticket 语义均不变。
- 自动检查仍走 Superagent Input → 准入；**准入未修，自动那支照旧可能被忽略**（见 `docs/research/autodream-auto-admission.md`）。

## 兼容性 / 风险

- 若 profile 未重启，`dsh-autodream` 不存在 → 手动精炼的 launch 会以 `agent-preset/not-found` 失败并在 Ticket 上可见（fail loud，不静默降级）。
- 系统提示词仍是 superagent 的 worker 版本；工作流由 Input 文本与 `diva-dream` skill 表达。属 B 的已知瑕疵，A 才搬。

## 回滚

还原两个文件 → `npm run build:bundle` → `npm run restart`。无数据迁移、无残留状态；已产生的 Dream 会话留在 `.artifacts/`（不入库）。

## 已知限制

见 `summary.md` §未验证：运行时的 preset 挂载、会话 preset、工具清单、候选闭环都还没验；本轮已验到「补丁可构建、产物含新逻辑、静态护栏成立」为止。
