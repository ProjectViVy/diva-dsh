# 重启后验收 · v0.1.0-plan-repair

前提：`npm run stop && npm start`（或 `npm run restart`）+ 浏览器硬刷新。代码直接以源码加载，
无构建、无迁移；技能已安装到 `$DSH_HOME/skills/diva-dream/SKILL.md`。

## A1 引用错误可定位

1. 面板「进化 → AutoDream」点「手动精炼」（或等自动触发）；
2. 在精炼会话里让它提交一份**故意少写候选 `refs`** 的计划；
3. 期望：错误里出现 `Candidate #0 (skill:<id>) has no refs array; a candidate must cite
   covered ids, e.g. event:<64 hex>`，并且**计划没有冻结**（可改完重交）。

## A2 抄写错误被修好

1. 让精炼提交一份 `event:<序号>:<64hex>`（序号取自 evidence 行首的 `seq=`）的计划；
2. 期望：提交成功，回话里出现 `repairedRefs`（>0），`status` 里 `plan` 的 refs 是规范形式。

## A3 零候选立即结案

1. 让精炼提交「事实卡 + coverage + 0 候选」的计划；
2. 期望：`plan` 回话 `next` 是「No candidates: the run is settled here…」；面板 run 直接显示
   **精炼完成**，不需要 `execute`，也不出现「受阻 / 超时」；
3. 立刻再发起一次精炼：不应得到 `in_progress`（精炼位已释放）；若是自动模式则应为 `cooldown`。

## A4 候选进审批

1. 让精炼提交一份带 `refs` 的技能候选，并按回话调用 `execute`；
2. 期望：面板「审批」出现待批条目，run 显示**精炼完成**；不调用 execute 时回话明确提示
   「不调 execute 会一直占位到 deadline」。

## 判定

- A1–A4 全过 → `TODOLIST.md` 的 DV-EV-021 改 `done`，把实测输出补进本文件；
- 任一不过 → 保持 `doing`，按失败点回到 `summary.md` 的根因表定位，不要先改文档。
