# v0.4.0 验收步骤（重启后执行）

前置：`npm run stop && npm start`，浏览器硬刷新；打开「进化 → 审批」。人格相关步骤要求人格已初始化（六个文件非空），当前 `.artifacts/dsh-home/laputa/default` 若仍全为 0 字节，跳过 E 并在验收记录里写 N/A。

## A. 审阅材料完整

```powershell
node .artifacts/audit/stage-acceptance-candidate.mjs --tag review
```

- 「待批技能候选（1）」出现 `acceptance-probe-skill`，时间是刚刚。
- 元信息含 `acceptance-ticket`、`acceptance-subject`、`acceptance-review`。
- 展开 `SKILL.md`：基线为空时应全是 `+` 行；展开「附件全文（1）」能看到 `scripts/probe.sh` 与 `echo review`。
- 说明文字不再只说「正文」，应有「逐行差异与附件全文」。

## B. 拒绝

点「拒绝」。

- 顶部提示「已拒绝 acceptance-probe-skill」。
- 待批列表清空；「已处置（1）」出现一条「已拒绝」；「已发布的 harness 技能」没有该技能。

## C. 批准 + 原子性（核心回归）

`first` 必须在没有任何发布时暂存；`stale-b` 与 `stale-a` 必须在 v1 之后、v2 之前暂存，否则基线对不上。

```powershell
node .artifacts/audit/stage-acceptance-candidate.mjs --tag first
```

- 批准 `first`：提示「已批准并发布 acceptance-probe-skill · v1」，「已发布」出现 v1。

```powershell
node .artifacts/audit/stage-acceptance-candidate.mjs --tag stale-b
node .artifacts/audit/stage-acceptance-candidate.mjs --tag stale-a
```

- 两个候选的基线都是 v1（面板上「基线」不是「新建」）。
- 批准 `stale-a`：v2。此时 `stale-b` 的基线仍是 v1。
- 批准 `stale-b`：应返回 422「Skill baseline conflict」，**该候选仍留在待批**，「已处置」里没有它。
- 刷新页面：`stale-b` 仍可重试；不存在「已批准但消失」的候选。

## D. 回滚入口

- 在「已发布」的 v2 行点「回滚到上一版」→ 出现确认文案「回到 v1 的待批候选」→「确认生成回滚候选」。
- 提示「已生成回滚候选（目标 v1）」；待批出现新候选；**live 仍是 v2**。
- 批准该候选 → v3，内容回到 `first` 那一版。

## E. 人格（需已初始化）

1. 「人格 → 提案」走手动精炼产生提案 → 批准：应看到「已发布 rN」，概览不再显示「有未发布修改」，`IDENTITY.MD` 等草稿内容与 live 一致。
2. 手改草稿 `IDENTITY.MD` 后再批准另一个提案（先刷新基线）：应失败于「draft changed」或保留草稿并提示「草稿里有未发布的人工编辑，本次没有覆盖」。
3. 把草稿改回某个旧版本内容后点「发布草稿」：应 409，提示 `DRAFT_STALE`，并建议用「版本 → 回滚」。

## F. 记录与设置

- 「进化 → 进化记录」空态出现「当前没有运行时生产者……技能审批记录在『审批』页的『已处置』……」。
- 设置页不再有「全局变更需人工确认」开关；「自动进化」分组消失。
- 「已处置」中已发布条目没有「重试发布」按钮；如果构造出「已批准未发布」（历史遗留），按钮存在且点击后补发。

## G. 清理

```powershell
node .artifacts/audit/cleanup-acceptance-state.mjs          # 先看 dry-run 计划
node .artifacts/audit/cleanup-acceptance-state.mjs --yes
npm run stop; npm start
```

- 清理会把 live 指针、publication、key、候选/决定/版本目录与 stage-key 移入
  `.artifacts/dsh-home/harness/skill-owner/.trash-acceptance-<ts>/`，并在其中留一份 `owner-state.backup.json`。
- 重启后确认技能列表与「已发布」里不再有 `acceptance-probe-skill`。

## 通过标准

A–D、F、G 全过；E 在已初始化人格时全过，未初始化则记 N/A 并保留单测结论。任何一步出现「批准了但看不到结果」即为不通过。
