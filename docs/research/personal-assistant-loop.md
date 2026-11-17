# 个人助手闭环：左栏持久记忆 + 右栏定期梳理

- 日期：2026-11-15 14:0x–15:0x（Asia/Shanghai）
- 性质：只读预研。**未改任何代码/配置/依赖、未重启服务**；只写 `docs/research/`、`docs/logs/`、`TODOLIST.md`。
- 触发（用户原话，2026-11-15 14:06）：*「个人助手的完整接线闭环。日常左边区域的聊天对话，需要持久化记忆，右侧，需要定期后台任务，梳理用户真正需要注意的和每天用户想要了解的东西。去整体进行一个调研工作，并把发现告诉我。如果说手头材料不够，也可以去 github 查看其他项目。」*
- 前置：`docs/research/daily-page-integration.md`（2026-11-14）已经定了「聊天区接 master、右栏四页」这条线；本轮只往前走一步——**记忆怎么存怎么读、右栏的产出由谁在什么时候做出来**。

---

## 0. 结论

**这两件事都不需要造新系统：本仓各已有半条链路，缺的是把它们接上，并且把「需要注意」和「想了解」拆成两种完全不同成本的作业。**

1. **左栏记忆已经在跑，而且是两条腿**。①**常驻**：衰减记忆卡（本轮实测 31 条）以 runtime context 注入包括 master 在内的所有会话（`plugins/memory/src/card-prompt.mjs:140-148`，本机 `cardInjection.enabled=true`）；②**每轮语义召回**：`dsh-mempalace` 从 `system-prompt/assemble` 瀑布里追加 4 条相关记忆（`plugins/dsh-mempalace/src/index.mjs:100-112`；默认 `recallTopK=4, recallMinScore=0.4, recallTimeoutMs=1200`，`config.mjs:28-32`）。这两条在 master 上都生效，因为 `complete:true` 只替换 `sections`、**`contexts` 保留**（`deepseek-harness/packages/core/system-prompt/src/index.ts:681-687`）。**你眼前这段「最近记得的」就是 recap 写进卡、再被注入的结果**——`recaps.jsonl` 本轮实测 31 条、全为 `trigger=auto`。真正缺的是三件：事实级抽取（现在只有整段总结）、模型主动检索（`memory_*` 工具在 master 被挡）、以及「日常」这个平台变体（卡只认 `qq`/`bili`，`card-prompt.mjs:40`）。
2. **右栏的两类产出绝不该用同一种机制**。这是本轮最重要的一条：
   - **「需要注意的」= 确定性规则扫描**：TODOLIST 的 NOW、superagent 待人工的工单、待审批的进化提案、失败的验证项。它不需要模型理解，只需要**被看见**；照 openmuse 的 Ideas 做法（正则规则 + 幂等 id + 证据 + 「接受即派活」），**零模型成本**。
   - **「想了解的」= 每天一次的模型编辑**：读兴趣清单 + 抓几个源 → 挑 3~5 条、写成人话、标出处。这部分必须过模型，但也只需要**一天一次**。
   把两者混成「每天跑一个 agent 出日报」，是把 90% 的工作交给了不需要模型的地方，既贵又不稳。
3. **推荐载体：插件式 check-in 作业（A2）**，不是往 master 会话里挂定时任务（A1）。AutoDream 已经把这个范式在本仓跑通了：`appReady` 就绪后 `setInterval(15min)` 巡检 → 命中条件才起一个独立会话（`plugins/dsh-evolution/src/dream.mjs:509-525`）。A2 = 同一套壳子，产物落盘 + 右栏读盘 + 左栏可选一句话。
4. **~~A1 仍然值得先跑一次~~（本条已作废，见下方「更正」）**。DSH 的 `schedule` 确实是现成的、持久化的、到期会恢复原会话跑一轮的调度器（`deepseek-harness/packages/schedule/schedule/src/runtime.ts:85-140`），**但它挂不进 master**：`schedule` 是 preset-owned（`deepseek-harness/packages/bundle/web-app/presets/cordis.patch.yml:38-39`），而 router preset 的注释明写「no subagents, web, file search or writes, todo list, questions to a person, presenting, plan mode, plugin manager, **scheduling**, goals or workflows」（`superagent/cordis.patch.yml:121-124`），master 的工具白名单里也没有 `schedule_*`（`superagent/src/app/sessions.ts:263`）。所以「一条 `schedule_create` 就能验证」是**错的**：要挂得先改 preset + 白名单（走 `patches/`），而且到期那轮会以 user 消息插进左栏。→ A1 从「零代码验证」降级为「要动补丁，且污染左栏」。
   **更正（2026-11-15 15:1x，子代理复核后自查）**：本报告初稿把 A1 写成零成本验证手段，是错的。同时补一条初稿漏掉的第四条路：**superagent 自带的 schedule 规则**（`patches/superagent-schedule.patch` 新增 `src/app/schedule.ts`：`everyMinutes` 槽位 → 每次 pass 检查 → 提交一条本地 trusted input，只有固定速率、无 cron，面板在 `superagent-schedule-panel.patch`）。它比 master schedule 更贴「后台作业」，但产物会走工单输入。
5. **三个硬卡点必须先答**（§5）：①`web_search` 在本机不可用（无 `DEEPSEEK_API_KEY`），「想了解」只能 `web_fetch` 抓**指定源**，不能自由检索；②master 的工具白名单是 `['skill','bash','read','read_image','job_output','job_list','job_kill']`（`superagent/src/app/sessions.ts:263`），**没有 web、没有 `schedule_*`、没有 `memory_*`**——记忆靠常驻卡与每轮召回「半通」，而「让她自己定时」今天根本不存在；③「你想了解什么」目前**没有任何画像来源**，第一版必须由你手填 3–5 个主题。

---

## 1. 口径与限制

- 「持久化记忆」= 三件合起来：**跨会话不忘**（不依赖对话历史还在不在）、**非逐字**（存事实/偏好，不存聊天记录）、**能按需读回**（随时取，不是每次重问）。
- 「定期后台任务」= 不需要人开口就发生，有固定节奏，有产物，失败了不会静默消失。
- 「需要注意的」= 有事在等你决定/处理，且**不处理会有后果**；「想了解的」= 你会有兴趣读，但不处理也没事。
- 方法与限制：本仓与两个本地参考项目用 `read`/`grep` 只读取证；外部项目本轮**没有搜索通道**（`web_search` 报 `DEEPSEEK_API_KEY` 缺失），全部结论来自**直接抓官方文档/README 原文**（`web_fetch`），访问日期 2026-11-15，均在 §7 附 URL。OpenMuse/OpenDots 只读源码，**未启动、未跑测试**。

---

## 2. 外部四家怎么做的（都是 2026-11 的现网代码/文档）

| 项目 | 记忆 | 定期梳理 | 关键事实（可查证） |
| --- | --- | --- | --- |
| **OpenMuse**（本地 `C:\Users\Administrator\Music\openmuse`，MIT） | 独立 `memories` 记录 `{id,text,source}`；写入只有两条路——模型主动调 `remember_fact`（`engine/conversation.ts:365-379`）、用户在 UI 手填（`engine/routes.ts:99-125`）；**没有对话后自动抽取**；**记忆不进 chat 的 system prompt**（只进 delegated task 的 prompt，`engine/model.ts:331,340`） | `maintain()` 60 秒循环（`engine/service.ts:75-77`）+ `TaskWorker` 1 秒轮询（`engine/worker.ts:47-55`）；**Ideas 用正则规则生成**（含 form/sign 的附件邮件、含 meet/schedule 的邮件、无里程碑的 goal），`slice(0,5)` 限量，`hash(语义key)` 幂等，**接受即幂等建任务**（`idea:${id}`），并把已失效的旧建议**反向撤回**成 dismissed（`engine/service.ts:561-644,645-725`）；monitor 失败按 2ⁿ 分钟退避、连败 5 次暂停（`:835-869`） | 无 cron、无「每天早上 8 点」；通知 `id=hash(key)`、`insertIfAbsent`，只增不减；前端 3 秒轮询单一 snapshot |
| **OpenDots**（本地 `C:\Users\Administrator\Music\OpenDots`，MIT） | 只有 owner 手写 `memories`，**agent 只读不写**；Automatic Learning 是托管服务、产出的是 skill 不是记忆 | 定时任务 = **interval 型定时回合**，`intervalSeconds ∈ [60s,1年]`，**必须挂在某条 thread 上**；到期由 1 秒 tick 的 Runner 抢 lease（180s）→ 往**原会话**注入一条带 `opendots:scheduled_task:` 前缀的 user 消息并跑一轮（`index.ts:85-88`）；lease 过期/权限变更 → `interrupted`，要求人工「Retry after review」 | 另有 `captures` 表按 thread 存「简报 + 来源」；无 cron、无事件触发 |
| **OpenBot**（CopilotKit，MIT，GitHub） | 托管在 CopilotKit Intelligence（闭源部分）；Automatic Learning 从**完成的会话**里采集证据 → 分析 → 产出 skill 候选 → **人工审批后发布** | **Routines**：15 分钟下限、每账号最多 20 条启用、**疲劳规则**（成功后第一次失败只发一条，连续 10 次失败自动关掉并说明）、**错过的窗口静默跳过不补跑**、服务进程每 30 秒自己扫（PG advisory lock 选主、按分钟键去重）、**以创建者的身份与权限运行**、结果当作普通 Bot 消息落在原频道；另有一类「check-in」= **只说不动手**、最多每小时一次 | 这是四家里唯一把「定时」的失败语义想透的 |
| **Khoj**（MIT） | 记忆/文档语义检索 | **Automations** = 保存一条 query + cron + 投递到邮箱（「个人简报 / 新闻摘要 / 事件提醒」） | 概念最轻：简报就是一条被定期执行的查询 |

### 从四家抽出来的 8 条硬规则（本轮建议直接采纳）

1. **定时作业必须绑一个归属**（thread / 会话 / 账号），否则「谁的东西、用谁的权限、结果回哪」全是模糊的（OpenDots 绑 thread，OpenBot 绑创建者）。
2. **错过就跳过，不补跑**（OpenBot）：机器关了两周，不欠你 14 份早报。
3. **疲劳规则优先于重试**（OpenBot）：失败一次说一次，连续失败就自己关掉；不要无限重试烧钱。
4. **频率下限 + 数量上限**是产品设计，不是限制（OpenBot 15 分钟 / 20 条）——防止一句话被模型解释成「每分钟一次」。
5. **「只说不动手」要单独成一类**（OpenBot check-in）：右栏简报就是这一类，它不该有派活权。
6. **建议流用规则生成、模型只负责执行**（OpenMuse）：规则便宜、可解释、幂等；模型贵且不稳。
7. **幂等键 = 语义哈希**（OpenMuse/OpenDots）：同一件事重复扫描不产出第二条。
8. **外部写操作结果未知就不重放**（OpenMuse `outcome_unknown`）：与本仓红线一致。

---

## 3. 本仓现状（带证据）

### 3.1 记忆设施：三层，都在，但各有缺口

| 设施 | 它做什么 | 证据 | 缺口 |
| --- | --- | --- | --- |
| **ActMem 衰减卡**（`plugins/memory`） | 三十来条记录的卡（本轮实测 31），`importance` 决定衰减速度，`owner` 标签决定进「和主人的记忆」，超 `forgetAfterDays` 彻底遗忘；有维护循环做衰减/压缩 | `.artifacts/dsh-home/memory/data/memory-card.json`（`records` **31** 条，58 KB，`updatedAt` 2026-11-15T06:03Z） | 容量固定；**只有 `qq`/`bili` 两个呈现变体**（`card-prompt.mjs:40`）；没有「日常」这一面 |
| **常驻注入**（`card-prompt.mjs`） | 以 runtime context（不是 system section）注入，order 130，内容哈希缓存防抖 | `card-prompt.mjs:26-32,109-113,140-148`；`memory/config.json` → `cardInjection.enabled=true` | 为什么是 context 不是 section：master 的 policy 段带 `complete:true`，section 会被整段丢掉（`superagent/src/app/sessions.ts:249`）——这条决定了「日常页的记忆呈现」也只能走 context |
| **每轮语义召回**（`plugins/dsh-mempalace`） | 每次装配从档案里检索 top-4 相关记忆（cosine ≥0.4、单条 ≤600 字、1.2 秒超时），从 `system-prompt/assemble` 瀑布追加成 **context** | `dsh-mempalace/src/index.mjs:100-112`；`config.mjs:28-32`；`contexts` 在 `complete:true` 下保留（`system-prompt/src/index.ts:681-687`） | 它的 POLICY **section**（`index.mjs:101-105`）被 `complete` 吞掉 → 记忆送进来了，但**没人告诉模型「什么时候该用」**；每次召回要走一次 query embedding，是热路径 |
| **recap 归队简报**（`plugins/dsh-actmem-recap`） | ≥3 轮、距上次 ≥2 轮、≥30 分钟 → 一次隔离 LLM 调用（不带工具、不带系统提示）→ 一个 JSON `{summary,next_action}` → 写 JSONL + 写卡（`scope:qq`、`importance:45`、只带 `recap` 标签） | `README.md:18-31,46-55,59-68`；`recaps.jsonl` **31** 条，全为 `trigger=auto`、`cardStored=true` | 只有整段总结，**没有事实级条目**；`importance 45` + 不带 `owner` → 约 60 天后被遗忘；没有读回接口（`README.md:133-137` 自述） |
| **记忆宫**（`plugins/dsh-mempalace`） | 长期归档 + 语义检索 + 知识图谱 + 隧道（`memory_search` / `memory_recall` / `memory_graph`） | 本会话工具即来自它 | 只读归档，**master 调不到**（见 3.2 白名单） |

**判断**：左栏「聊天有没有记忆」这件事，**在数据层早已是 yes**，在**可感知层**是半 yes（它会说起旧事，但说不清是什么时候记的、也查不回来），在**日常页呈现层**是 no。

### 3.2 调度设施：三条路，语义完全不同

| 路 | 语义 | 证据 | 适合什么 |
| --- | --- | --- | --- |
| **DSH `schedule`** | 归属某条会话的提醒；持久化在会话日志；到期由宿主定时器**恢复那条会话**、以 user 消息注入并 flush（`deliveryMode: 'host'`，`types.ts:261-269`）；最小间隔 60 秒；支持 `after/at/every/daily/weekly/cron` | `packages/schedule/schedule/src/runtime.ts:85-140`、`domain.ts:37` | 「早上 8 点在日常页跑一轮」——最省，但**它一定会在那条会话里跑一轮**，会占用左栏 |
| **插件级定时器**（AutoDream 范式） | `appReady.onReady` 后 `setInterval(15min)` 巡检 → 命中才起独立会话（`createWebhookSession` + 专用 preset），会话有自己的工具与权限 | `plugins/dsh-evolution/src/dream.mjs:14,509-525`、`dream-session.mjs:43-78` | **右栏作业**：隔离、可配模型、不污染聊天历史 |
| **superagent 治理链** | `trigger`（入站事件）→ `decision`（accept/ignore）→ `disposition`（fanout）→ `ticket` → worker 会话 | `.artifacts/dsh-home/state/superagent-local/orchestrator.sqlite`：`trigger` 7 行（含 `human:0` 的程序输入）、`decision` 3 行、`ticket` 1 行；`superagent/src/app/sessions.ts:232-268` | 「需要人决定的事」这条正式通道；**但自动请求默认可能被判 ignore**（本仓 `docs/research/autodream-auto-admission.md` 的教训） |

| **superagent 自带规则** | `patches/superagent-schedule.patch` 新增 `src/app/schedule.ts`：`everyMinutes` 槽位，每次 pass（2 秒一轮）检查到期就提交一条本地 trusted input | `patches/superagent-schedule.patch` 的 `Schedules` 模块与 `settings/schedule` 块；面板 `superagent-schedule-panel.patch` | **只有固定速率、没有 cron**；产物走工单输入，不是「告诉人」 |

**master 的能力边界（决定左栏能做什么）**：master 的工具被限制为 `skill/bash/read/read_image/job_output/job_list/job_kill`（`superagent/src/app/sessions.ts:263`）加上 superagent 自己的工具。**没有 `web_*`、没有 `schedule_*`、没有 `memory_*`**（`memory_*` 在 `plugins/dsh-mempalace/src/tools.mjs`，被这条 restrict 挡在外面）。worker 才有 `web_search/web_fetch` 等（同文件 `:61-62`）。`schedule` 本身也不在 router preset 里（`superagent/cordis.patch.yml:121-124` 的注释：「no … scheduling …」）。**所以「让她在聊天里自己记住」「让她自己排个期」今天都不是配置问题，是代码限制。**

### 3.3 右栏现状：肉眼可见的「没接线」

- `plugins/dsh-daily/index.js` 只有 12 行，**宿主半身是空的**：没有服务、没有路由、没有数据。
- `plugins/dsh-daily/client.js` 的 Today 卡是**写死的 demo**：文件自己注明「今天天气 / 每日推荐 是静态 demo，不是真实数据」（`client.js:110,152-167`），页脚写「本地演示 · 所有改动仅保存在当前页面」（`:112`）。
- 也就是说：**右栏今天连一条真数据都没有**。任何「定期梳理」的第一件事都是给它装一个数据源。

### 3.4 「需要注意」现成可扫的数据源（全都不需要模型）

| 源 | 位置 | 为什么算「需要注意」 |
| --- | --- | --- |
| TODOLIST 的 `## NOW` | `TODOLIST.md` | 里面全是「等用户执行」「待拍板」，就是当前等人的事 |
| superagent 工单 | `orchestrator.sqlite` 的 `ticket`（`open`/`active` 列）+ 面板 `GET /orchestrator/api/tickets` | 工单卡的状态本身就区分 `person/review`、`person/blocked`、`person/answer`（`superagent/src/app/resources.ts:25`） |
| 进化提案待审批 | `.artifacts/dsh-home/evolution/`（`pending_review` 状态，`dream.mjs:446-447`） | 没批就一直停着，属于「不处理就没结果」 |
| 会话里的 `goal` / `todo_write` | `packages/goal`、`packages/todo` | 目标到期/长期未动 |
| 已排期的提醒 | `schedule_list` | 今天/明天有什么被安排 |

---

## 4. 候选方案

### 4.1 左栏记忆（X）

| 编号 | 做法 | 成本 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| **X0** | 维持现状（recap 整段总结进卡） | 0 | 只记得「那阵子在干什么」，记不住「你偏好什么」 | 现状 |
| **X1** | **recap 契约加事实字段**：同一次调用输出 `{summary, facts:[{text,kind,importance}], next_action}`，facts 去重后进卡 | +0 次调用（同提示词多字段），几十行 | 模型可能把猜测写成事实 → 必须要求「只写用户明说或确认过的」 | **推荐** |
| **X2** | 独立「记忆整理」作业（每天读昨天对话 → 出画像更新） | +1 次调用/天 | 与 recap 重复；两套摘要会打架 | 并入右栏作业，不单立 |
| **X3** | 把 `memory_search` 开给 master | 改上游补丁 | 违反「上游只读」的默认做法；token 成本不可控 | 后置；先靠常驻卡 |

### 4.2 右栏定期梳理（Y）

| 编号 | 做法 | 成本 | 风险 | 说明 |
| --- | --- | --- | --- | --- |
| **Y1** | 在 master 里挂 `schedule`（每天 8:30）→ 到期自动跑一轮 → 内容直接出现在左栏 | **不是零代码**：要改 router preset + 工具白名单（`patches/`） | 打断左栏、污染历史、master 没有 web 工具、失败无隔离、reset 掉会话后任务全废 | 只当「到点能不能出东西」的实验，不作为方案 |
| **Y1b** | 用 superagent 自带的 `everyMinutes` 规则提交一条本地 input | 一次设置（面板/设置块），不改代码 | 只有固定速率；产物进工单，不是「告诉人」；与右栏没有接口 | 与 Y1 一样只作实验 |
| **Y2** | **插件 check-in 作业**：定时器 → 规则扫描（需要注意）→ 可选一次 LLM 编辑（想了解）→ 写产物文件 → 右栏读 | 1 个插件（~4 文件）+ 前端读一次 | 要定产物格式、要定失败语义 | **推荐** |
| **Y3** | superagent 触发器 → 工单 → worker 产出 | 走既有治理 | 简报会变成工单噪音；自动请求可能被 policy 忽略 | 不推荐 |
| **Y4** | 接一个现成的「日报」插件（如 `dsh-automation` / `dsh-bili-scroll` 的模式） | 一个依赖 | 别人的节奏与数据源未必合身；多一份凭据 | 备选，先不引 |

**推荐组合**：**X1 + Y2**。两条「先验证」的路（Y1 改 preset 挂 `schedule`、Y1b 用 superagent 的 `everyMinutes` 规则）都**不推荐**：前者要动补丁且必然在左栏插一条 user 消息，后者产物进工单、右栏读不到。真要「今天就看到东西」，最省的是 **Y2 的规则扫描部分先落地**（零模型、不碰任何会话），半小时内能让 Today 页第一次有真数据。

### 4.3 Y2 的形状（拍板后再实施，这里只给接口）

```
定时器（15 分钟巡检；每天只在设定时刻真做一次，错过就跳过）
   ├─ 规则扫描（零模型）→ attention[]：{key, title, why, source, action}
   └─ 若到点且今天是首次 → 一次 LLM → digest[]：{title, summary≤200字, url, why}
产物：$DSH_HOME/daily/brief/<YYYY-MM-DD>.json  （原子写：tmp+rename）
右栏：GET /dsh-daily/api/brief → Today 页渲染；「刷新」按钮手动触发一次
左栏：可选一行「今天的简报好了」——只说不动手（check-in 语义）
失败：连续 2 次失败写一条 `error` 进产物并在右栏显示；不重试、不静默
```

---

## 5. 卡点（按阻塞程度）

- **K1 检索不可用**：`web_search` 报 `DeepSeek search has no API key for "DEEPSEEK_API_KEY"`（本轮实测）。「想了解」只能走 `web_fetch` 抓**已知 URL**（HN / GitHub Trending / arXiv / 你的 RSS）。→ 需要一个**源清单**，不是「随便搜」。与 DV-UP-002 的结论互相印证：0.2.2 起缺凭据时这个工具会直接从模型面前消失。
- **K2 master 没有 web、没有 `schedule_*`、没有 `memory_*`**：白名单见 `superagent/src/app/sessions.ts:263`；`schedule` 也不在 router preset（`superagent/cordis.patch.yml:121-124`）。**但记忆是「半通」的**：常驻卡 + 每轮 top-4 召回都进得来，只是没有「何时该用」的说明（mempalace 的 POLICY section 被 `complete` 吞掉）。所以左栏不是「查不到」，是「查得到但不会主动查」。
- **K9 召回在热路径**：每条用户消息一次 query embedding，超时 1.2 秒（`dsh-mempalace/src/config.mjs:32`）；模型文件加载首轮还要多等（`modelLoadTimeoutMs` 60 秒上限）。离线时这段是纯延迟。
- **K10 调度没有测试兜底**：本仓 `tests/` 里 `tool-schedule` / `schedule_create` / `ctx.schedule` **0 命中**；上游 `packages/schedule/schedule/tests` 有 19 个 spec。任何「自己写个定时器」的方案都要自带失败语义测试。
- **K11 reset 会带走会话**：`dsh-superagent-reset` 是 rename 整个 master 会话目录（`plugins/dsh-superagent-reset/lib/reset.mjs`），会话上的任何 `schedule` 都会投递失败。所以「右栏作业」**不要挂会话**。
- **K3 兴趣画像无来源**：全仓没有任何「用户关注什么」的结构化存储。第一版必须手填；从对话里学属于 X2，第二轮再说。
- **K4 记忆卡只有两个呈现变体**：`card-prompt.mjs:40` 的 `PLATFORMS = new Set(['qq','bili'])`。日常页要第三种呈现 → 加 `daily` 分支（小改，但属于记忆插件行为变更）。
- **K5 右栏无宿主半边**：`dsh-daily/index.js` 是空 `apply`。要读数就得加 host 路由（照 `dsh-superagent-reset/index.js` 的三层校验写法）。
- **K6 定时语义选择**：`schedule` 会在会话里跑一轮（占用左栏），插件定时器不会（但没人在会话里「说话」）。两者不能混用同一套产物。
- **K7 成本叠加**：recap 已经每 30 分钟一次隔离调用（默认配置，本机 `recaps.jsonl` 31 条可证）。再加一个每天一次的 digest 是可以接受的；**再加「每 15 分钟跑一次模型」不行**。
- **K8 长期成本**：简报进会话历史就会进上下文。产物落盘、右栏读盘，**不要把整份简报写进会话**。

---

## 6. 决策清单（不拍板不实施）

| 编号 | 问题 | 选项 | 推荐 | 影响面 |
| --- | --- | --- | --- | --- |
| **D1** | 左栏记忆写到什么粒度 | X0 维持整段总结 / **X1 加事实字段** / X2 独立整理作业 | **X1** | `dsh-actmem-recap` 的 JSON 契约与提示词；不增调用次数 |
| **D2** | 左栏怎么「想起旧事」 | 现状（常驻卡 + 每轮 top-4 召回，模型不知道何时该用）/ **补一段使用说明**（用 context 投给 master，绕开 `complete` 吞 section）/ 给 master 开 `memory_*`（动上游补丁） | **补使用说明**；工具后置 | 前者零改动、中者一个小插件或改 laputa context、后者要 patch 且 token 不可控 |
| **D3** | 右栏作业载体 | Y1 master 内 schedule（要改 preset）/ Y1b superagent 规则 / **Y2 插件 check-in** / Y3 工单 | **Y2** | 新插件 + 右栏 host 路由；前两者都先污染左栏或工单 |
| **D4** | 「需要注意」由谁判断 | **规则扫描** / 每天一次模型判断 / 两者 | **规则扫描**（模型只在「想了解」出场） | 零模型成本 vs 每天一次 |
| **D5** | 「想了解」的频率与时刻 | 每天 1 次（早）/ 每天 2 次 / 每周 | **每天 1 次、时刻可配、错过跳过** | 成本与错过语义 |
| **D6** | 兴趣从哪来 | **手填 3–5 个主题** / 从对话学 / 两者 | **先手填**；学是第二轮 | 需要一个可编辑入口 |
| **D7** | 简报的落点 | 只右栏 / **右栏 + 左栏一行提示** / 右栏 + 桌面通知 | **右栏 + 左栏一行（可关）** | 左栏是否被「她主动说话」占用 |
| **D8** | 失败语义 | 重试 N 次 / **疲劳规则：说一次、连败关闭** / 静默 | **疲劳规则**（抄 OpenBot） | 会不会刷屏烧钱 |
| **D9** | 记忆卡要不要加 `daily` 变体 | 加 / 复用 `qq` | **加** | 记忆插件小改；决定日常页能不能显示「和主人的记忆」 |

**不拍板不实施**：以上 9 条任一未定，都不写代码。D1–D9 全部有默认推荐，你可以只回「按推荐来」或者逐条改。

---

## 7. 参考（访问日期均为 2026-11-15）

- OpenBot Routines（15 分钟下限、20 条上限、疲劳规则、错过跳过、以创建者身份运行）：<https://raw.githubusercontent.com/CopilotKit/OpenBot/main/docs/routines.md>
- OpenBot Automatic learning（证据 → 分析 → 候选 → 人工审批）：<https://raw.githubusercontent.com/CopilotKit/OpenBot/main/docs/automatic-learning.md>
- OpenBot README（Routines / Memory / proactive 的产品面）：<https://raw.githubusercontent.com/CopilotKit/OpenBot/main/README.md>
- Letta《Sleep-time Compute》（主 agent + 睡眠 agent 双体、睡眠时改写主 agent 的记忆块、频率可配）：<https://www.letta.com/blog/sleep-time-compute/>
- Khoj Automations（保存的查询 + cron + 投递）：<https://docs.khoj.dev/features/automations/>
- 本地参考项目：`C:\Users\Administrator\Music\openmuse`（MIT）、`C:\Users\Administrator\Music\OpenDots`（MIT）——只读源码，未运行。

### 未核实（不许当结论）

- OpenBot 的 Intelligence 记忆与 Automatic Learning 是**闭源托管服务**，能做到什么程度无法从本仓源码证明。
- OpenMuse / OpenDots 的运行期行为（调度是否真按文档走）未启动验证。
- 本仓 `schedule` 在**跨重启**后「错过的循环只补最近一次」的行为，只有代码注释与 spec（`packages/schedule/AGENTS.md` 的「Recurring tasks contribute only their latest missed occurrence」），**未在真机验证**。
- recap 在 master 会话上是否真的按「3 轮/30 分钟」触发过：JSONL 里 31 条是否包含 master 那条，**未按 session 全量统计**。
- **每轮召回是否真的进了 master 的请求**：结论来自「`complete` 只换 sections、contexts 保留」的代码读法与 profile 未覆盖默认值，**没有抓一份真实的 master 请求体核对**。
- master 会话上**从未成功挂过 `schedule`**：preset 与白名单两处都不允许，本机 `$DSH_HOME` 下也没有任何 schedule 存储文件（0 条任务）。

### 本仓取证补充（外部项目的对照之外）

- 记忆工具归属：14 个 `memory_*` / `knowledge_*` 在 `plugins/dsh-mempalace/src/tools.mjs:105-519`，`plugins/memory` 不注册任何模型工具（`src/index.mjs:18-44`）。
- 测试覆盖：记忆 13 个 `memory-*.test.mjs` + 8 个 `mempalace-*.test.mjs`；recap `tests/actmem-recap.test.mjs` 覆盖自动门槛与 `trigger=auto`；**调度 0 覆盖**；右栏 `tests/daily-client.test.mjs` 只测槽位与左栏对话，静态右栏无测试。
