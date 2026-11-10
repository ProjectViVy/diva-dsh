# 验收步骤

前置：`npm run stop && npm start`（改动要重启才加载）。打开面板 `http://127.0.0.1:<端口>`（以 `npm run status` 为准）。

## A. 技能候选进入待审

1. 进化 → 手动精炼（AutoDream 标签），填当前会话，提交。
2. 等 Ticket 被接纳、Executor 执行 `execute`。
3. 切到进化 → **审批** 标签。预期：出现该候选，能看到技能 ID、正文、附件清单与摘要；没有候选时该标签显示「暂无待批技能候选」而不是空白。

## B. 拒绝

1. 在「审批」标签点「拒绝」。
2. 预期：该候选从列表消失并提示「已拒绝 <skill>」；重启后不再出现；技能列表里没有这个技能。

## C. 批准并发布

1. 在「审批」标签点「批准并发布」。
2. 预期：提示「已批准并发布 <skill> · v1」；该候选消失，下方「已发布的 harness 技能」出现该技能与版本号。
3. 新开会话，让模型执行该技能覆盖的任务：能命中该技能（`harness-owner` provider，rank 390）。
4. 重复批准同一候选：不产生第二个版本（一次批准只发布一次）。

## D. 授权边界

1. 未登录会话直接 `curl` `/dsh-continual-harness/api/decide`：预期 403/401（会话守卫），不写任何决定。
2. `POST` 不带 `origin`：预期 403 `HUMAN_REVIEW_REQUIRED`。
3. 带错误 `expectedBundleDigest`：预期 422「Reviewed digest does not match the staged candidate」。
4. 用组件 token 调 `/dsh-harness/internal/candidates` 暂存：可以；调不存在任何批准接口：`/validate`、`/publish` 均应 404。

## E. 人格路径不受影响

1. 人格 → 提案：旧候选仍可批准/拒绝；批准后新会话读新版本。

## 通过标准

A–E 全部符合预期，且 `$DSH_HOME/harness/skill-owner/decisions/` 下每次批准只有一条记录。
