# openhanako 的规则类内容：哪些能搬到这边，怎么生效

- 日期：2026-11-15 ｜ 触发：主人 16:1x「openhanako 里面是不是有一些可以借鉴的规则类内容，我们能不能把这些规则看看怎么在这边生效」
- 口径：只读调研，**未改任何代码/配置**。样本 = 本机克隆 `C:\Users\Administrator\Music\openhanako`，`package.json` 版本 **0.450.0**。
- 结论长度：先看第 1 节，能拍板就直接看第 6 节的 D1–D6。

## 1. 结论

**有，而且不是零散的。** hanako 把「规则」写成了 system prompt 里的 **10 个固定小节**（工具纪律、行动纪律、网页工具优先级、记忆使用规则、输出契约、子代理协作…），一条条是可直接抄的短句。

**能生效，不需要动上游源码。** 我们这一侧 master 的提示词是**数据驱动的版本化配置**（`superagent/prompts/*.md` + 团队三段 + skills，管理面保存即生成新版本，下一个模型请求就吃新版本），所以：

- 常驻的 3–5 条短规则 → 写进 prompt 覆盖或团队段，**管理面里改，不重启、不写代码**。
- 长的细则（记忆抽取、子代理协作） → 做成 **skill**，master 按需 `skill` 加载，不占常驻 token。
- 需要跟代码状态联动的 → 插件 `systemPrompt.section`（这条要写代码，最后才考虑）。

**最值钱的三条**（我的排序，理由在 §4）：① 行动纪律（先诊断再换方向 + 可逆性判断）；② 记忆使用规则（记忆无声参与、不许说「我记得」）；③ 输出契约（每轮必须有面向用户的正文，不能只想着不说完）。

**最容易被忽略的一条**：`agents.example.md` 里的**文风硬规则**（少用破折号、不用「总的来说」收尾、回避「不是…是…」句式）——它比任何架构规则都更快影响日常对话的手感，而且现在就能用。

## 2. 调查口径与限制

- 读过并逐段引用：`core/agent.ts` 的 `buildSystemPrompt()`（1245–1554 行，系统提示词组装）、`lib/yuan/hanako.md`（人格层 MOOD）、`lib/agents.example.md`、`lib/pinned.example.md`、`core/provider-prompt-patches.ts`、`lib/memory/prompts/fact-extraction.ts`（前 45 行）。
- 只扫过标题/未细读：`lib/approval-gateway.ts`、`lib/diary/*`、`lib/memory/prompts/{dream,compile,rolling-summary}.ts`、`lib/fresh-compact/policy.ts`、`skills2set/`、`packages/**`。这些可能还有规则，**不能当成没有**。
- **没有跑 hanako**，也没有实测这些规则对它自己的效果；下面说的「可借鉴」是文本层面的判断，不是效果证明。
- hanako 的 prompt 是运行时拼的（同一份代码里有 zh/en 双份），行号会对不上它的其他版本；引文以当前克隆为准。

## 3. 我们这边的「规则位」在哪（这是能不能生效的关键）

master 的系统提示词 = `composePrompt(config, 'orchestrator', environment, policy)`，拼接顺序见 `superagent/src/app/prompts.ts:102-119`：

| # | 段 | 来源 | 谁能改 |
| --- | --- | --- | --- |
| 1 | `runtime/shared` | `superagent/prompts/shared.md` | 覆盖（overrides） |
| 2 | `runtime/orchestrator` | `superagent/prompts/orchestrator.md` | 覆盖 |
| 3–5 | `communication` / `scope` / `delivery` | `superagent/prompts/team/*.md` | **团队段，纯文本** |
| 6–8 | `subscriptions` / `replies` / `dispatch` | `superagent/prompts/*.md` | 覆盖 |
| 9 | `runtime/admission` | `superagent/prompts/admission.md` | 覆盖 |
| 10 | `runtime/handoff` | `superagent/prompts/handoff*.md` | 覆盖 |
| 11 | `runtime/environment` | 生成（环境变量） | 不可改 |
| 12 | `runtime/policy` | 生成（接单规则，`settings.policy.rules`） | 设置页「接单规则」 |

三点事实：

- **版本化**：`Prompts` 存的是编号版本（`Versions<PromptVersion>`），管理面保存后 master 的 `promptFor(agent, …)` 在下一个模型请求就取新版，**不重启 host**。这一条决定了「改规则 = 改数据，不是改代码」。
- **`runtime/policy` 不是通用规则位**：它是**接单规则**（写清能接什么活、谁审 PR），不是行为纪律，别往里塞。
- **我们现在的 master 提示词几乎全是「派活/交付」**：`shared.md` 847 字节讲路由，`orchestrator.md` 1037 字节讲接单、`team/communication.md` 9726 字节全在讲「PR 就绪才发 IM」。**日常闲聊、工具纪律、行动纪律、记忆口径，一条都没有。** 这正是 hanako 那堆规则能填的洞，也是左栏日常对话现在容易「像派活接口」的根因之一。

## 4. 可借鉴清单（按价值排序，标注落点）

| # | hanako 规则（原文要点） | 位置 | 我们这边落点 | 判断 |
| --- | --- | --- | --- | --- |
| 1 | **行动纪律**：方案失败先读错误、查假设、做针对性修复；不盲目重试、不因一次失败放弃；按可逆性与影响面决定要不要先问人 | `core/agent.ts:1471-1478` | `runtime/shared` 覆盖 或 `scope` 段 | **直接抄，几乎无成本**。和 DIVA 人格「结果未知不假装成功」同向 |
| 2 | **记忆使用规则**：记忆是内化背景，只在对方提到相关内容时无声参与；**禁止「我记得」「你之前说过」「根据记忆」**；记忆可能过时，当前对话优先 | `core/agent.ts:1343-1361` | `runtime/shared` 覆盖 | **强烈建议**。ActMem 现在把记忆塞进上下文，但没有一条规则管它「怎么说出口」 |
| 3 | **输出契约**：每轮回复必须含面向用户的正文，不许只输出内部思考就结束 | `core/agent.ts:1333-1336`；DeepSeek 特化版在 `core/provider-prompt-patches.ts` | `runtime/shared` 覆盖 | **强烈建议**。我们用的就是 DeepSeek，「想了想没说」是真实故障模式 |
| 4 | **文风硬规则**：少用破折号；不用「总的来说/希望对你有帮助/如你所见」收尾；非必要不用「不是…是…」 | `lib/agents.example.md` | laputa 人格（DIVA 口吻）或 `communication` 段 | **立刻可做**，零架构风险。要和现有 `vivy-tone` 插件对齐，别写两套 |
| 5 | **工具使用纪律**：多工具能成一件事时选最省最不扰的那个；看文件用 read/grep，改源码用 edit，别用 shell 重定向改源码 | `core/agent.ts:1395-1404` | `runtime/shared` 覆盖 | 可抄，但要按我们的工具名改写（我们没有 `find/ls`，有 `bash/read/glob/grep`） |
| 6 | **网页工具优先级**：先 web_search 找 URL → web_fetch 取正文 → 只有需要登录/交互/JS 渲染才上浏览器；前两者够用禁止启浏览器 | `core/agent.ts:1481-1486` | `runtime/shared` 覆盖 | 我们的 master 白名单里**没有 web_search/web_fetch**（只有 `skill/bash/read/read_image/job_*`），抄了也是死规则 → 见 §5 卡点 C1 |
| 7 | **子代理协作**：目标已知就用直接工具，别为简单任务开子实例；预计 >3 次查询的探索才委派；子实例可续接（threadId）、label 只展示；满了自己决定关哪个 | `core/agent.ts:1441-1454` | `runtime/shared` 覆盖（改写） | 我们有 Agent Teams（`spawn_teammate`/`send_message`/`wait_agent`），语义接近但**续接身份是 target 不是 threadId**；照抄会误导，需改写 |
| 8 | **记忆抽取规则**：「以后遇到类似任务该怎么做」→ 进经验库/技能，**不进记忆事实**；事实必须原子、带时间、标签 2–5 个 | `lib/memory/prompts/fact-extraction.ts` | ActMem 的抽取提示词 | 这条正好补我们记忆架构的边界（记忆 vs 经验 vs 技能）。但要动 ActMem 提示词，属于它的 owner 范围 |
| 9 | **日期口径**：「你的一天从 04:00 开始，04:00 前的对话属于前一天」 | `core/agent.ts:1549-1551` | 我们的 Today 通道 / 记忆分日 | **正好咬合**我们现在这条 today 围栏通道：文件名 `<YYYY-MM-DD>.html` 用哪种「日」得定 |
| 10 | **cache 分界线**：静态前缀在前、会漂移的（记忆/时间）放末尾，保护跨会话 prompt cache 命中 | `core/agent.ts:1273-1287` | 我们的 `composePrompt` 顺序 | 我们已经是「固定段在前、environment/policy 在后」，**方向一致**；但 ActMem 注入位置我还没核 |
| 11 | **MOOD 区块**：每轮先输出 `<mood>`（Vibe/Sparks/Reflections/Will）再说话 | `lib/yuan/hanako.md` | DIVA 人格 | **不建议抄**：每轮多几百 token 且改的是表达外形，不是规则；我们的 B 通道（她做界面）已经占了「表达」那一格 |

**不适用（依赖 hanako 自己的工具集，搬来是死规则）**：SessionFile/stage_files/fileId 那整段（`core/agent.ts:1406-1421`）、可见 UI 上下文 `current_status ui_context`（1423-1430）、本机应用控制 `computer`（1457-1468）、主动技能获取 `learn_skills/install_skill`（1488-1504）。这 4 条占它规则量的大约 1/3——**说明它的规则和我们不是一个产品形态**：它是桌面个人助手，我们是「派活 + 日常表达」。

## 5. 卡点

- **C1｜master 的工具白名单里没有网络工具。** `superagent/src/app/sessions.ts:263` 的 allow 是 `['skill','bash','read','read_image','job_output','job_list','job_kill']`。所以 hanako 的「网页工具优先级」对 master 无效；要用得先决定给不给（这是权限扩张，得主人点头），或者让 worker 去查（worker 有 work tools）。
- **C2｜规则写多了会挤爆常驻前缀。** hanako 的常驻规则合计约 2.5–3k token；我们 master 现在的提示词只有 ~1.5k token 左右（打包后）。全抄进去等于把提示词翻倍，每轮都付。→ 必须分层：**3–4 条短的常驻，长的进 skill**。
- **C3｜口径冲突要主人拍。** hanako 说「永远别让对方感觉到记忆存在，禁止说『我记得』」；DIVA 人格说「不假装记得没记住的事，记不清就说记不清了」。两条在同向（记忆当背景），但在「记忆存在时怎么开口」上口径不同。不能我替主人选。
- **C4｜改了提示词会影响 worker 侧的手感。** `runtime/shared` 是 **BOTH**（master 和 worker 共用）。往 shared 里塞日常表达规则，worker 也会读到——可能让 worker 变得话多。**要么只改 `runtime/orchestrator`，要么接受 worker 也读**。
- **C5｜「04:00 的一天」是产品决定，不是技术决定。** 我们今天的 today 文件按浏览器本地日期取名；hanako 那种夜猫子口径会改变「今天」的含义。
- **C6｜我没法证明这些规则对 DIVA 有效。** 抄规则是文本工作，效果只能靠重启后实聊观察；现在还没有任何 A/B 手段。

## 6. 决策清单（不拍板不动手）

- **D1｜要不要抄「行动纪律」+「输出契约」进 `runtime/shared`？**
  - A（推荐）：两条都进 shared，各 3–4 句，按我们的工具名改写。
  - B：只进 `runtime/orchestrator`，worker 不读（避免 C4）。
  - C：都不进，先观察现状。
  - 影响面：master 与 worker 的常驻提示词，+约 200 token。
- **D2｜记忆口径怎么定？** A（推荐）抄 hanako 的「无声参与 + 禁止『我记得』」，再加一条「确实记不清就直说」（把两条并起来）；B 只保留 DIVA 原有口径；C 现在不动。
- **D3｜文风硬规则放哪？** A（推荐）进 laputa 人格（DIVA 口吻），和 `vivy-tone` 对齐；B 进 `communication` 团队段（但那段是给 IM 交付用的，语义不合）；C 不做。
- **D4｜长细则（子代理协作、记忆抽取边界）做成 skill 还是常驻？** A（推荐）skill，master 需要时 `skill` 加载；B 常驻（贵）；C 不做。
- **D5｜要不要给 master 开网络工具（C1）？** A 不开，查资料交给 worker；B 开 `web_search`/`web_fetch` 给 master（权限扩张）；C 待定。
- **D6｜「一天从 04:00 开始」要不要采纳（C5）？** A 采纳并改 today 文件名口径；B 保持 00:00；C 只写在提示词里、不改文件口径（会不一致，不推荐）。

**推荐一次到位的最小集**：D1-A + D2-A + D3-A + D4-A。四条加起来约 +400 常驻 token、0 行代码、0 次重启（管理面保存即生效），能同时改善「日常对话像接口」和「想了不说」两个现存毛病。D5/D6 单独拍。

## 7. 参考

- 本机克隆 `C:\Users\Administrator\Music\openhanako`（`package.json` v0.450.0，本地只读，未跑）
- `core/agent.ts`（`buildSystemPrompt` 1245–1554）
- `lib/yuan/hanako.md`、`lib/agents.example.md`、`lib/pinned.example.md`、`core/provider-prompt-patches.ts`、`lib/memory/prompts/fact-extraction.ts`
- 我们这边：`superagent/src/app/prompts.ts`（`composePrompt` 102–119）、`superagent/src/app/context.ts`、`superagent/prompts/**`、`superagent/src/app/sessions.ts:244-264`
- 上游项目页 https://github.com/liliMozi/openhanako （未联网核对，按包内自述）
