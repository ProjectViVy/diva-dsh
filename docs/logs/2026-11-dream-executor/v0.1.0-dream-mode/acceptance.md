# 验收清单

重启后逐条确认，任一条不成立就回滚（见 release.md）。

## A. 工具集

- [ ] 触发一次手动 refine，等 Ticket 进入运行中。
- [ ] 打开该 worker 会话的工具面板：只有 `skill`、`dream_refine`，以及 Executor 自带的 Ticket 工具
      （ack / 报告）。**没有** `pwsh`、`bash`、`write`、`edit`、`read`、`subagent`。
- [ ] 同一实例里的普通工单（非 Dream）仍然是完整工具集——补丁只对 Dream 生效。

## B. 运行链路

- [ ] `claim` 返回每会话的引用条数，且不含材料正文。
- [ ] `evidence`（不带参数）列出会话；带 `session/offset/limit` 返回一页引用；带 `ref` 返回单条全文。
- [ ] `plan` 返回 `phase: planned`，`execute` 返回 `completed` 且候选为 `pending_review`。
- [ ] 「进化 → 审批」出现本次候选，可批准/拒绝。
- [ ] Ticket 报告里不再出现「先跑 CLI」之类的描述（Input 正文已经改了）。

## C. 边界

- [ ] 在 Dream 会话里要求它执行命令或写文件：模型应当回答没有这些工具，而不是执行。
- [ ] 用非 worker 会话（主会话）调用 `dream_refine`：应报「only serves a Dream refinement worker Session」。
- [ ] 构造一个 `dream_` 之外来源的工单去调 `dream_refine`：应被 `authorize()` 拒绝（Ticket 不拥有该 Input）。

## D. 回归

- [ ] 「进化 → 概览 / 审批 / AutoDream」三个标签都能打开。
- [ ] 技能候选批准发布后 worker 侧可见（与 v0.3.4 验收一致）。

## 已知非目标

- 不做自动验证、不做自动发布；DV-EV-014 的 Python 验证环境决策仍未定。
- 不给 Dream 提供写文件能力：需要落盘的话走候选，不走工作区。
