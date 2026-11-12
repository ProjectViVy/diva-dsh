# 验收清单

重启后逐条确认；任一条不成立，按 `release.md` 回滚。

## A. 构建与测试

- [ ] `pnpm -C plugins/dsh-continual-harness build` 退出码 0（`lib/types/skill-owner-runtime.js` 含 `requestId` 转发）。
- [ ] `node --test tests/dream-evolution.test.mjs` 全绿，含新增的
      `staging binds the request id through the owner and sends the baseline as a POST body`。
- [ ] `pnpm -C plugins/dsh-laputa test` 全绿（`internal.spec.ts` 期望载荷含 `requestId`）。

## B. 真实链路

- [ ] 触发一次手动 refine，worker 仍只有 `skill` / `dream_refine`（DV-EV-015 一并验收）。
- [ ] `baseline` 返回 `persona.revision` / `persona.draftDigest` **以及非空技能列表**，不再出现
      `Unknown Laputa owner operation`。
- [ ] `plan` 返回 `phase: planned`，**不再**出现
      `Exact skill entry absent from frozen Dream plan`。
- [ ] `execute` 返回 `completed`，候选状态 `pending_review`。
- [ ] 「进化 → 审批」出现本次候选；批准后 worker 侧可见（与 v0.3.4 验收一致）。

## C. 边界

- [ ] 同一 Ticket 上再触发一次 refine（制造第二个 Dream Input），staging 仍绑定新请求，
      不报 `Exact skill entry absent`。
- [ ] 人格候选：`baseline` 可用后能构造 persona candidate，并落到 Laputa 面板待批；
      `execute` 之后**没有**任何自动发布。

## 已知非目标

- 不复活本轮已 blocked 的那次 run（计划体没有落盘，无法复用），重跑即可。
- 不在本轮加「多请求必须显式 requestId」的硬校验（见 summary 的取舍）。
