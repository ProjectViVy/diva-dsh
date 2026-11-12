# v0.1.0 Dream 候选 staging：绑定 requestId + baseline 走 POST

## 现象

一次手动 refine 在 Dream 执行器里跑完了分析（6 张事实卡、50 条 coverage、1 个技能候选
`diva-research-to-decision`），但：

- `dream_refine plan` 提交即报 `Exact skill entry absent from frozen Dream plan`，计划已冻结；
- 之后两次 `dream_refine execute` 都返回 `Candidate staging incomplete; retry the frozen plan`；
- `baseline` 一直返回 `Unknown Laputa owner operation`，人格候选无法构造；
- 仓库无改动，无发布。

## 根因（两处，都在 staging 链路上）

1. **漏传 `requestId`（主因，技能候选卡死）**
   `dream.mjs` 的 `plan()` 把候选交给 owner 时只带 `ticketId`，不带 `requestId`；
   harness / Laputa 再转发给 `/dream/authorize` 时同样没有该字段。
   而 `authorize()` 用
   `(!requestId || item.id === requestId) && ticket.inputs.some(...)` 解析请求：
   缺失 requestId 时退化为「该 Ticket 拥有的第一个 Dream Input」。
   该 Ticket（`c0674ee…`）在 2026-11-10 就拥有两个 Dream Input（见
   `docs/dream-executor.md`「The tool」），今天这次是新 Input，于是授权命中旧请求 → 其 run 的
   frozen plan 里没有这个 skill 条目 → `Exact skill entry absent`。
   `plan()` 顶部那次 authorize 是带 requestId 的（工具绑定过），所以计划本身冻结成功；
   只有 owner 侧这次丢失绑定 —— 与「计划已冻结、staging 失败、execute 缺 ownerCandidateId」
   的观测完全一致。

2. **baseline 用了 GET（人格候选一条都构造不出来）**
   `dream.baseline` 调用 `owner('laputa', '/baseline')` 时没传 body，而
   `callComponent` 对 `body === undefined` 发 **GET**；`plugins/dsh-laputa/internal.mjs`
   只处理 `POST /baseline`，其余方法/路径一律 `Unknown Laputa owner operation`。
   所以无论重启与否，人格候选都拿不到 revision/digest。

3. **baseline 投影丢字段（修完路由仍构造不出人格候选）**
   `dream-tool.mjs` 的 `baseline` 分支只保留 `persona.revision/digest`，而 Laputa 返回的是
   `{revision, draftDigest, …}` —— 人格候选必需的 `expectedDraftDigest` 被丢掉；
   同时它按 `value.skills.skills` 取技能列表，而真实 harness owner 的 `status()`
   返回的是**数组**（publication 列表），于是技能基线永远是空数组。

## 改动

| 文件 | 改动 |
| --- | --- |
| `plugins/dsh-evolution/src/dream.mjs` | staging 两个 owner 调用都带 `requestId: auth.requestId`；`baseline` 传 `{}`（POST） |
| `plugins/dsh-evolution/src/dream-tool.mjs` | baseline 投影：保留 `draftDigest`；同时接受数组与旧包装形状的技能列表 |
| `plugins/dsh-continual-harness/src/skill-owner.ts` | `SkillCandidateInput` 增可选 `requestId`（透传，不参与资产摘要） |
| `plugins/dsh-continual-harness/src/skill-owner-runtime.ts` | `/dream/authorize` 转发 `requestId`（有值才带） |
| `plugins/dsh-continual-harness/lib/types/skill-owner-runtime.js` | 本地构建产物，按 tsc 格式手写同一行（`lib/` 被 .gitignore 忽略；重启后应重新 build） |
| `plugins/dsh-laputa/internal.mjs` | `authorizeStage` 转发 `requestId`（有值才带） |
| `plugins/dsh-evolution/tests/dream.test.mjs` | 新增 1 条：staging 带绑定 requestId；baseline 以 `{}` body 调用 |
| `plugins/dsh-evolution/tests/dream-tool.test.mjs` | baseline 断言 `draftDigest`；fixture 补该字段 |
| `plugins/dsh-laputa/tests/internal.spec.ts` | 期望的 authorize 载荷补 `requestId` |
| `docs/dream-executor.md` | 记录「owner 也要保持绑定」与 baseline 为何必须 POST |

## 取舍

- **最简方案**：只补透传 + 修调用方法，共 4 个源文件、零新接口。
- **备选（未采用）**：让 `authorize()` 在「无 requestId 且匹配到多个请求」时直接拒绝
  （更早暴露同类错误），但会收紧所有调用方契约，且 `scripts/dream-refine.mjs` 之外还有未知调用面，
  本轮不动；若再次出现同型错配，再升级为硬校验。

## 未完成 / 未验证

- 本轮 `pwsh` 仍被「临时根在工作区内」拒绝（DV-OPS-001 待重启），**没有跑任何测试**。
- 失败的那次 run 仍停在 `blocked`；计划体没有落盘，无法在修复后复用，需要重跑一次 refine。
- 技能候选本身没有经过人工审批，也没有发布。
