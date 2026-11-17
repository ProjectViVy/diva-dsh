# 验证记录 v0.1.0（只读预研）

本轮不改代码，验证的全部目的是「报告里的每条事实可复现」。下面每条按 命令 → 预期 → 实际 记。

## 1. 记忆链路的现状

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1.1 | `read .artifacts/dsh-home/memory/config.json` | 看 `cardInjection` 是否开启 | `{"memoryCard":{"notifyOwner":false},"cardInjection":{"enabled":true},"memory":{}}` → **开启** |
| 1.2 | 用 node 读 `memory/data/memory-card.json` 的顶层键 | 卡里有记录与维护时间 | `records` 数组 **30** 条；`updatedAt=2026-11-15T06:03:36.672Z`；`lastDecayDate=2026-11-15` |
| 1.3 | `grep CARD_CONTEXT_ORDER / PLATFORMS plugins/memory/src/card-prompt.mjs` | 投递顺序与平台变体 | `CARD_CONTEXT_ORDER=130`；`PLATFORMS=new Set(['qq','bili'])`（:40）→ **无 daily** |
| 1.4 | `grep platform: constant` 同上 | 是否 runtime context 而非 section | `systemPrompt.context({name:'actmem:card',order:130,interpolate:false})`（:140-148） |
| 1.5 | `wc -l .artifacts/dsh-home/actmem-recap/recaps.jsonl` + 读末行 | 有自动简报 | **30 行**；末行 `at=2026-11-15T04:45:54.510Z, session-52c2f98d…, turn=33, trigger=auto` |
| 1.6 | `read plugins/dsh-actmem-recap/README.md:18-31,46-55,133-137` | 调度门槛、落点、已知缺口 | 门槛 3 轮/2 轮/30 分钟；写 JSONL + 卡（`scope=qq,importance=45`）；自述「无读回接口」 |

## 2. master 的能力边界

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 2.1 | `read superagent/src/app/sessions.ts:262-264` | master 工具白名单 | `tools.restrict({allow:['skill','bash','read','read_image','job_output','job_list','job_kill']})` → **无 web、无记忆检索** |
| 2.2 | 同文件 `:61-62` | worker 有哪些 | `WORK_TOOLS` 含 `write/edit/glob/grep/bash/pwsh/web_search/web_fetch/skill/todo_write/subagent…` |
| 2.3 | 同文件 `:249` | 为什么记忆只能走 context | master 的 policy section 带 `complete: true` |

## 3. 调度设施

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 3.1 | `read deepseek-harness/packages/schedule/schedule/src/runtime.ts:85-140` | 到期怎么交付 | 扫 due → `sessionController.resolveAgent(sessionId)` → `agent.followup(userMessage{source:'schedule'})` → `sessions.flush` → 提交/推进 |
| 3.2 | `grep MIN_EVERY_INTERVAL_SECONDS` | 频率下限 | `domain.ts:37 = 60` |
| 3.3 | `read types.ts:261-270` | 交付语义 | `deliveryMode:'host'`；注释「Reminder delivery never leaves the owning session」 |
| 3.4 | `grep DREAM_CHECK_INTERVAL_MS plugins/dsh-evolution/src/dream.mjs` | 插件定时器多长 | `15 * 60 * 1000`；`appReady.onReady` → `setInterval(tick)`（:509-525） |
| 3.5 | 只读探针 `.artifacts/tmp/probe-orchestrator.mjs` 跑 `orchestrator.sqlite` | superagent 有哪些表 | `trigger` 7 / `trigger_thread` 7 / `decision` 3 / `disposition` 7 / `ticket` 1 / `effect` 0 / `kv` 20 / `thread` 1 / `context_snapshot` 3 |
| 3.6 | 第二个探针 dump 行 | trigger 里有没有程序输入 | 7 条中 2 条 `human:false` → **程序可以注入 trigger** |

## 4. 右栏现状

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 4.1 | `read plugins/dsh-daily/index.js` | 宿主半边做了什么 | 全文 12 行，`apply(){}` 空实现 → **无服务、无路由** |
| 4.2 | `grep 示例 / FOOT_TODAY plugins/dsh-daily/client.js` | 卡片是不是真数据 | `:110` 注释「示例卡是静态 demo」；`:112` 页脚「本地演示」；`:152-167` 两张示例卡 |
| 4.3 | `read .artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml` | 日常页有没有配置 | 只有 webserver/superagent/settings/theme/llm/model/dsh-context/laputa，**无 daily 相关项** |

## 5. 外部与工具

| # | 操作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 5.1 | `web_search`（4 条 query） | 可用 | **失败**：`DeepSeek search has no API key for "DEEPSEEK_API_KEY"` → 改 `web_fetch` |
| 5.2 | `web_fetch raw.githubusercontent.com/CopilotKit/OpenBot/main/docs/routines.md` | 200 | HTTP 200，15 分钟下限/20 条上限/疲劳规则/错过跳过等条款在文内 |
| 5.3 | `web_fetch …/docs/automatic-learning.md` | 200 | HTTP 200，证据→分析→候选→人工审批 |
| 5.4 | `web_fetch https://www.letta.com/blog/sleep-time-compute/` | 200 | HTTP 200（原文页尾 © 2026，文章日期 APR 21 2025） |
| 5.5 | `web_fetch https://docs.khoj.dev/features/automations/` | 200 | HTTP 200，automations = 定时查询 + 邮件投递 |
| 5.6 | 只读扫 `C:\Users\Administrator\Music\openmuse`、`…\OpenDots` | 读到记忆与后台任务实现 | 见报告 §2；关键行号：openmuse `engine/service.ts:75-77,561-644`、`engine/worker.ts:47-55`、`engine/model.ts:331,340`；OpenDots `index.ts:85-88`、README 关于 schedules 的说明 |

## 6. 更正轮追加的验证（15:1x）

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 6.1 | `read plugins/dsh-mempalace/src/index.mjs:100-113` | 召回是不是每轮自动 | `section({name:'mempalace:policy'})` + `child.on('system-prompt/assemble', … recall.contribute(accepted, agent))`（:100-112） |
| 6.2 | `grep recall.* config.mjs` | 召回默认值与预算 | `recallInjectionEnabled:true, recallTopK:4, recallMinScore:0.4, recallMaxChars:600, recallTimeoutMs:1200`（:28-32） |
| 6.3 | `read deepseek-harness/packages/core/system-prompt/src/index.ts:681-687` | complete 会不会连 context 一起吞 | 只替换 `sections: [completeSection]`，`contexts` 原样返回 → **卡与召回都保留，section 被吞** |
| 6.4 | `read superagent/cordis.patch.yml:121-124` | router preset 是否含 scheduling | 注释原文「…plugin manager, scheduling, goals or workflows. No persona…」→ **不含** |
| 6.5 | `Get-ChildItem patches` | 有没有现成的定时补丁 | 有 `superagent-schedule.patch`（39 KB）与 `superagent-schedule-panel.patch`（41 KB）；前者含 `src/app/schedule.ts`、`everyMinutes`、`settings/schedule` 块 |
| 6.6 | `grep memory_* tools.mjs` | 记忆工具归属 | 14 个工具在 `plugins/dsh-mempalace/src/tools.mjs:105-519`；`plugins/memory/src/index.mjs:18-44` 只接 http/internal/cardPrompt/maintenance，**无工具注册** |
| 6.7 | 实测卡与 JSONL 行数 | 数量 | `memory-card.json` 31 条 / 58 KB；`recaps.jsonl` 31 条、31/31 `trigger=auto`、`cardStored=true` |

## 7. 未做的验证（诚实清单）

- 没有启动 OpenMuse / OpenDots，没有跑它们的测试 → 「它们怎么调度」是读代码的结论。
- 没有在真机验证 `packages/schedule` 的「错过只补最近一次」（只有包内 AGENTS.md 与 spec 文本）。
- 没有抓一份真实的 master 请求体，核对「每轮 top-4 召回」是否真的进了 prompt（结论来自 `system-prompt` 的 complete/contexts 分支读法 + profile 未覆盖默认值）。
- 没有按 session 统计 recap 是否覆盖 master（只看总数与末条）。
- 没有验证「Hours 级」的 `schedule` 在宿主重启后是否正确重算下一次触发点。
