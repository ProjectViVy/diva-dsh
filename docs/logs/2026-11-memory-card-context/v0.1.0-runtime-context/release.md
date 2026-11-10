# 发布记录 v0.1.0

- 是否发布：否
- 不发布原因：`dsh-local-memory` 是本地源码插件（`private: true`，不发布 npm），通过 profile 的 `cordis.patch.yml` 装载；生效方式是重启本地 DSH 实例。

## 发布步骤

1. `npm run stop`
2. `npm start`
3. 确认 `npm run status` 里实例已起，再用 `acceptance.md` 验收。

## 发布后必做

- 需要重启的进程：本地 DSH（`superagent-local` profile）。
- 用户可见的变化：记忆卡从系统提示词移到 `Current runtime context` 快照；router 主 Session 首次能看到卡。
- 需要回头核对的信号：快照条数是否随卡内容变化增长过快（观察几天）；`includeRuntimeContext` 被关掉的 agent 是否丢卡。
