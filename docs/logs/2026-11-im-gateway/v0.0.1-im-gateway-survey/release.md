# 发布记录 v0.0.1-im-gateway-survey

- 是否发布：否
- 不发布原因：纯文档 + 状态登记，无代码行为变化；且按 `AGENTS.md` §4「不自动提交」，提交时机由用户决定。

## 发布步骤

1. 无。本轮不产生发布物，不需要走 `plugins/surfcore` 的发布三闸门（`release-manifest` / `--verify-ref` / 归档核对）。
2. 如需入库：`git add docs/research/im-gateway-unification.md docs/logs/2026-11-im-gateway TODOLIST.md`，
   建议提交信息 `docs: survey SurfCore/SnowLuma wiring and IM gateway options`。

## 发布后必做

- 需要重启的进程：**无**。文档不进入任何运行时路径。
- 用户可见的变化：无。
- 需要回头核对的信号：
  - 若后续按方案动手，先复核 `TODOLIST.md` 的 `NOW` 指向是否仍是本条目；
  - 若期间 DSH 从 `0.2.1-rc.5` 升级，方案里 §10.2 关于 `app.asar` 补丁与 dsh-im 兼容性的结论需要重算；
  - 若 dsh-im 发布新版本，§3.2 的能力矩阵（尤其 `consumeInbound` 是否已泛化到飞书之外）必须重读，不看旧结论。
