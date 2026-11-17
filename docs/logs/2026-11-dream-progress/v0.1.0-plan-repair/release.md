# 交付与回滚 · v0.1.0-plan-repair

## 改动面

`plugins/dsh-evolution`（独立仓）：

- `src/dream.mjs` —— `normalizePlanRefs`、`planDefect`、`plan()` 零候选结案、`maintain()` 记账
- `src/dream-tool.mjs` —— `lineOf`、evidence note、plan 的 `next`、`repairedRefs`
- `tests/dream.test.mjs`（+6 例）、`tests/dream-tool.test.mjs`（+2 例）

根仓：

- `skills/diva-dream/SKILL.md`（并已安装到 `.artifacts/dsh-home/skills/diva-dream/SKILL.md`）
- `TODOLIST.md`（DV-EV-021）、`docs/logs/2026-11-dream-progress/v0.1.0-plan-repair/`

## 生效方式

1. `npm run stop && npm start`（插件常驻进程，源码加载，无构建步骤）；
2. 浏览器硬刷新；
3. 技能不需要重装（已写入 `$DSH_HOME`）。

不需要 `npm run setup`：`node_modules`、profile 注册、submodule 指针均未变化。

## 兼容性 / 迁移

- journal 与快照格式零变化；`run.planRepairs` 是新增可选字段，旧 manifest 直接可读。
- `requests[].status` 的语义只在「deadline 已到且 run 已终态」这一支发生变化：由
  `timed_out` 变为 `completed` / `completed_rejected`，不再写超时错误、不再 dispose 会话。
- 公开行为变化：零候选计划不再需要 `execute`；`evidence` 行前缀由 `[193]` 变为 `seq=193`。

## 回滚

```powershell
git -C plugins/dsh-evolution checkout -- src/dream.mjs src/dream-tool.mjs tests/dream.test.mjs tests/dream-tool.test.mjs
git checkout -- skills/diva-dream/SKILL.md
node -e "Promise.all([import('./scripts/lib/dream-skill.mjs'),import('./scripts/lib/vivy.mjs')]).then(([s,v])=>s.installDreamSkill(process.cwd(),v.home()))"
npm run stop && npm start
```

回滚不丢数据：本轮 `run_9954bfd6` 从未 `execute`，coverage 未被消费，同一批 5007 条证据仍可重跑
（自动模式需等冷却结束，手动模式不受限）。

## 未覆盖（下一轮候选）

1. 非空 plan 但从不 `execute` 的 2 小时空转 —— 需要会话结束钩子；
2. ref 短别名（彻底消灭 64 位抄写与压缩失忆）；
3. 快照规模与 2h 时限不匹配（5007 refs / 26 会话）；
4. 人格候选 baseline 缺 `expectedBaseRevision` / `files`（在 Laputa 侧）；
5. `skills/diva-dream/SKILL.md` 第 11–16 行仍是 DV-EV-019 之前的 Ticket/Input 措辞
   （现在只有 request，没有 Ticket），与本轮改动无关，未动。
