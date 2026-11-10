# 发布说明

- 组件：`dsh-continual-harness` 0.3.3 → 0.3.4、`dsh-evolution`（源码，无版本号）
- 交付方式：源码修改 + 插件 `lib/` 重新构建（`tsc -p tsconfig.build.json`）；受管理的 `diva-dream` skill 已重新安装到 `$DSH_HOME/skills/diva-dream/SKILL.md`
- 生效条件：**重启运行实例**（`npm run stop && npm start`）。本会话由该实例托管，未代为重启。

## 行为变化（对外可感知）

1. 技能候选不再自动验证/发布；`/validate` 组件接口已移除，`/publish` 组件接口也已移除，发布只走面板 `POST /dsh-continual-harness/api/decide`。
2. Dream `execute` 的最终 phase 从 `validating` 变为 `awaiting_review`；技能候选状态为 `pending_review`，与人格候选一致。
3. 新增面板读取接口 `GET /dsh-continual-harness/api/pending`，返回待审候选正文与附件清单。
4. 进化面板新增「审批」标签（排在概览之后）：批准即发布（rank 390 立即对所有会话可见），拒绝即作废；AutoDream 标签只保留门槛、手动精炼与运行记录。
5. `harness_refine` 工具描述不再声称技能会自动验证后启用。

## 数据兼容

- `$DSH_HOME/harness/skill-owner` 下已有 published 版本与 `owner-state.json` 继续可读；旧发布记录带 `receiptId` 字段，新代码忽略它。
- 已暂存但从未决定的候选会出现在「审批」标签里，可以直接批准或拒绝。
- 已存在的 `$DSH_HOME/harness/skill-owner/validation-suite.json`（如有）不再被读取，可保留或删除（删除前先备份）。
- 无需数据迁移脚本；旧回执里的 `runnerEnvironmentDigest` 等字段不再参与任何判定。

## 后续

自动验证环境（隔离执行器 / Python 工作台）如何提供仍待决策：`TODOLIST.md` DV-EV-014。
