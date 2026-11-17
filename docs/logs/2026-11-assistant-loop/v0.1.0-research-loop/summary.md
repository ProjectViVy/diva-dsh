# v0.1.0 个人助手闭环：左栏持久记忆 + 右栏定期梳理（只读预研）

- 状态：已交付（调研报告），**零代码改动**
- 范围：`docs/research/personal-assistant-loop.md`（新建）；证据来自本仓源码、`.artifacts/dsh-home` 只读探测、两个本地参考项目、四个外部项目的官方文档
- 验证：本文件 `verification.md` 逐条给命令与输出摘要
- 未验证：OpenMuse/OpenDots 运行期行为；`schedule` 跨重启的错过语义；recap 是否按 session 全量覆盖到 master
- 下一步：DV-UI-014（等 D1–D9 拍板）
- 回滚：`git status` 无代码改动；只删 `docs/research/personal-assistant-loop.md` 与本日志目录即可回到调研前

## 改了什么

只写文档，不改行为。报告回答四件事：

1. **左栏记忆现在到哪一步**：ActMem 衰减卡（30 条）已以 runtime context 常驻注入 master；`recap` 每 3 轮/30 分钟把「人看得见的对话」归纳进卡（本机 JSONL 30 条，最后一条 2026-11-15T04:45:54Z）。缺事实级抽取、缺日常页读回入口、缺 `daily` 呈现变体。
2. **右栏为什么必须拆成两种作业**：「需要注意的」用确定性规则扫描（零模型、幂等、带证据）；「想了解的」每天一次模型编辑（带出处）。混成「每天跑 agent 出日报」是最贵且最不稳的做法。
3. **三条调度路线的语义**：DSH `schedule`（到期恢复原会话跑一轮）/ 插件定时器（AutoDream 范式，隔离）/ superagent trigger→ticket（治理链），外加 superagent 自带的 `everyMinutes` 规则。推荐插件定时器承载右栏。
4. **九个待拍决策 D1–D9**，全部带推荐项与影响面。

### 更正（报告初稿发出后，15:1x 自查）

子代理的逐项盘点回来后，改了两处**实质错误**：

- **A1 不是零代码验证**。初稿说「一条 `schedule_create` 就能验证」，错。`schedule` 是 preset-owned，router preset 的注释明写不含 scheduling（`superagent/cordis.patch.yml:121-124`），master 工具白名单也没有 `schedule_*`（`superagent/src/app/sessions.ts:263`）。要挂必须改 preset + 白名单。
- **读回面不止常驻卡**。初稿漏了 `dsh-mempalace` 的每轮语义召回（`system-prompt/assemble` 瀑布追加 context，topK=4 / minScore=0.4 / 1.2s，`dsh-mempalace/src/index.mjs:100-112`、`config.mjs:28-32`）。它在 master 上生效，因为 `complete:true` 只替换 sections、contexts 保留（`deepseek-harness/packages/core/system-prompt/src/index.ts:681-687`）。所以 D2 从「要不要读回」改成「补一句使用说明」。
- 数量校正：卡 31 条、`recaps.jsonl` 31 条（初稿写 30，是采样时刻的实数，几分钟后就长了一条）。
- 补一条初稿没有的路：`patches/superagent-schedule.patch` 的 `everyMinutes` 规则（固定速率、无 cron、产物进工单）。

## 影响面

- 用户可见：无（没有部署、没有重启、没有改 profile）。
- 数据：无写入。`.artifacts/tmp/probe-orchestrator*.mjs` 是本轮为读 sqlite 写的只读探针，属 `.artifacts/` 本地缓存（不入库），可随时删。
- 依赖方：无。

## 未验证

- OpenMuse / OpenDots 只读源码，未启动、未跑测试：「它怎么调度」是读代码得出的，不是观测到的运行行为。
- `packages/schedule` 的「循环任务只补最近一次」来自包内 AGENTS.md 与 spec，**未在真机复现**。
- recap 的 30 条 JSONL 只抽样看了最后一条，**未按 session 统计**是否覆盖 master 会话。
- 外部四家的运行期表现（OpenBot 的 routines 扫描是否真按文档跑）未实测，只有官方文档原文。

## 备注

- 取舍：本轮**没有**建议引入任何第三方插件或服务。四家外部项目里有三家的核心能力（OpenBot 的 Intelligence 记忆与 Learning、CopilotKit Threads）是闭源托管服务，抄不了；能抄的是失败语义与建议流形状，都是纯逻辑。
- 与本仓既有结论的关系：`daily-page-integration.md` 的 F1–F6 未推翻，本轮只是把 F3（Today 的资讯来源）具体化成了「规则扫描 + 每日一次编辑」，并补上了记忆这一面。
- 后续观察点：D3 若选 Y2，右栏第一次有真数据；D1 若选 X1，recap 的防御边界（只写用户明说的事）是首个要验证的点。
