# SurfCore 上游现状调研（Mieksido/surfcore）

> 纯调研，未改任何代码、配置与子模块。观测时间：2026-11-13 02:50–03:10（Asia/Shanghai）。
> 上游：<https://github.com/Mieksido/surfcore>；本仓对应 `plugins/surfcore`（只读子模块）。

## 0. 结论（先看这段）

1. **上游很活跃，且分了两条线**：`main` 稳定线停在 **v0.8.9**（2026-11-06）；`dev` 线昨天（2026-11-12）连发 5 个预发布，最新 `v0.8.9-dev.6`，是**整架构重写**（`kernel/` `runtime/` `packs/` `ui/`），不是补丁。
2. **我们钉在 v0.8.6**（子模块 `59ec3066`）。到稳定线 v0.8.9 之间是 3 个稳定版、累计 **351 文件 / +33240 −1160**。
3. **整体升级的代价已实测，不是估算**：9 个锚点渲染文件里有 **3 个断裂**（`src/bridge.js`、`plugins/surfcore/lib/index.js`、`plugins/surfcore/lib/scheduler.js`），另外 6 个原样可用。断裂不是「可能要改」，是 renderer 直接抛 `SURFCORE_PATCH_DRIFT`。
4. **dev 线现在不可接**：包里已删除 `src/bridge.js`、旧 UI、旧 QQ/B站/桌宠运行代码，DSH 入口 `index.js` 是骨架（只打一行日志、不启动内核），上游自己写明「后端仍未接线」「不宣称架构接管成功」。
5. **推荐 R1（不动作）**：维持 v0.8.6，把「要不要吃 v0.8.7–0.8.9 的修复」交给 §8 的 D1 拍板；真要吃就走一轮独立重锚（范围限定 3 个文件 + 语义复核），不要顺手挑版本。

**一句话**：上游没停，stable 值得吃、dev 还不能跟；现在动手的唯一硬成本是 3 处锚点重写，最大风险是测试基线本身不绿（§9-F3）。

## 1. 调查口径与限制

- **口径**：「上游」= `Mieksido/surfcore` 仓库本身；「我们」= 本仓 `plugins/surfcore` 子模块 + `scripts/lib/surfcore-*.mjs` 锚点补丁 + `plugins/dsh-surfcore-adapter`。
- **方法**：GitHub REST API（`/releases`、`/commits`、`/branches`）取发布说明与分支头；本地子模块 git 对象做 diff（本地 clone 已有 `origin/main` = `0ce8580`，无需联网）；用本仓真实 renderer 对 v0.8.9 源码跑漂移探针。
- **已知限制**：
  - `web_search` 未使用（直接调 GitHub API），故没有社区二手资料，**结论全部来自上游一手发布说明与本地 git 对象**。
  - `plugins/surfcore/lib/index.js` 的探针只覆盖 `renderHostSource` 一层；`renderHostBootSource` / `renderHostWorkdirSource` 未导出，未单独验证（§4 已标注）。
  - 按只读纪律**没有**跑 `npm run setup:surfcore` 与 `npm run test:audit`；这两项属于拍板后的验证计划（§10）。

## 2. 上游两条线的现状

| 通道 | 引用 | 时间 | 内容 |
| --- | --- | --- | --- |
| `main`（stable） | `0ce85800` = tag `v0.8.9` | 2026-11-06 | 旧架构的收尾修复版，`/releases/latest` 指向它 |
| `dev` | `af0ded7c` = tag `v0.8.9-dev.6` | 2026-11-12 | 新架构完整包（502 文件清单），预发布，不进 `latest` |

### 2.1 稳定线版本时间线

- `v0.8.6`（2026-11-01，我们钉的版本）
- `v0.8.7`（2026-11-02）— 上游自述「0.8.6 以来全部 dev 的累积发布，**74 个提交、约 105 个文件**」
- `v0.8.8`（2026-11-02）— 补 `/dsh/follow-default` 代理路由 + 同类漏代理的静态测试
- `v0.8.9`（2026-11-06）— 向量记忆全链路、会话滚动重做、SnowLuma 脱离 DSH Job、更新器进度与锁

### 2.2 dev 线是什么（关键判断）

`v0.8.9-dev.6` 发布说明的原文要点：

- **包含**：`kernel/`（113 文件，含测试）、`runtime/`、`packs/`（qq / bilibili / web / desktop-pet）、`ui/`（面板源码 + 构建产物）、`tools/`、`docs/`、DSH 入口（`package.json` / `client.js` / `index.js` / `cordis.patch.yml`）、`release/install-manifest.json`。
- **不含**：旧 `src/bridge.js`、旧 UI、旧 QQ/B站/桌宠运行代码、`video/`、`state/`、任何配置或密钥。
- **边界（原文）**：「**后端仍未接线**：`index.js` 目前是骨架（只打一行日志，不启动内核）。所以 QQ / B站 / 记忆 / 语音这些功能**不会真的跑**，UI 里相关页面会显示后端不可用。」
- 交付方式：内容来自用户提供的 dist 包，只改了版本号并生成清单——即**不是**在 `main` 上逐提交演进，而是整包替换。

前序 dev.2–dev.5 也都在反复强调「不宣称架构接管成功」「旧包不会被自动删除」。

## 3. 我们这边钉在哪、怎么钉的

- 子模块指针：根仓库 `ls-tree` = `59ec3066f7d42a0452fae01f170c9a8484d5dbe5`（= `v0.8.6`），`.gitmodules` 里 `shallow = true`。
- 构建期补丁：`scripts/lib/surfcore-component-pins.json` 记录 `patchVersion: 4`、子模块 commit 与 **9 个文件的 `sourceSha256`**。
- 双重硬校验（`scripts/lib/surfcore-component-patch.mjs`）：
  - `verifyPinnedCommit()`：子模块 HEAD 与 pins 里的 commit 不一致 → 直接抛 `SURFCORE_PATCH_DRIFT`；
  - `renderTarget()`：sha256 不一致 → 抛 drift；锚点找不到恰好一次 → 抛 drift。
  - **没有静默降级路径**：换版本必然在 `npm run setup:surfcore` 阶段红，不会带着错补丁跑起来。这是好设计，也是升级成本可预测的原因。
- 集成模型（`docs/architecture.md` §12）：子模块只读 → 构建期锚点补丁只连「事件入口 + 发送入口」→ 业务状态、游标、外部 ID 全在 `plugins/dsh-surfcore-adapter`。

## 4. 实测漂移：v0.8.6 → v0.8.9

- 全量 diff：**351 files changed, 33240 insertions(+), 1160 deletions(-)**。
- 9 个锚点文件里 **5 个有改动**，4 个逐字节未变。

| 锚点文件 | v0.8.9 变化 | 探针结果 | 首个断裂锚点 |
| --- | --- | --- | --- |
| `src/bridge.js` | +1881 行 | **DRIFT** | `function purposePersonaText() {` → 已改名 `function purposeContextBlocks() {` |
| `plugins/surfcore/lib/index.js` | +1007 行 | **DRIFT**（仅测 `renderHostSource` 层） | `const lower = launcher.toLowerCase(); if (lower.endsWith('.bat')` |
| `plugins/surfcore/lib/scheduler.js` | +261 行 | **DRIFT** | `const L = limitsNow()` |
| `plugins/surfcore/tools/lib/msgfeed.mjs` | +46 行 | OK | — |
| `src/character-persona.js` | +26 行 | OK | — |
| `src/bili-share-scheduler.js` | 无变化 | OK | — |
| `plugins/surfcore/lib/align.js` | 无变化 | OK | — |
| `plugins/surfcore/tools/commands/dm-await.mjs` | 无变化 | OK | — |
| `plugins/surfcore/tools/lib/state-paths.mjs` | 无变化 | OK | — |

结论：**重锚面 = 3 条渲染链（bridge 6 个 label、host 3 个 label、scheduler 3 个 label）**，不是全仓 9 个。剩余的 6 个只受 sha256 重钉影响，不需要改代码。

## 5. v0.8.7–v0.8.9 里和我们重叠的部分（选摘，供拍板判断）

不是全部 changelog，只挑会与现有补丁/adapter 语义打架或互补的条目：

| 上游变化 | 版本 | 与我们的关系 |
| --- | --- | --- |
| 多群记忆隔离、记忆互通圈、`conversationKey` 去重 | 0.8.7 | 与 `bridge-memory-context` / `bridge-session-memory` 锚点语义正面重叠，重锚时必须逐条复核，不能机械对齐 |
| 记忆卡 `recent` 上限 8→12、`firstMet`/`pinned` 拆分、`forget` 语义 | 0.8.7 | 与 ActMem 记忆卡投递存在双写风险 |
| `web_search` 认 DSH 0.2.x `.credentials.yaml` 的 `records` 结构、Search API 直连 | 0.8.7 | 我们侧无对应实现，属纯收益 |
| DSH 0.2.1-rc.5 兼容：B站新会话补 `agentPreset`、模型目录 fallback | 0.8.7 | 与我们跑在 rc.5 的现状直接相关 |
| `/dsh/model`、`/dsh/effort` 代理（0.8.7）、`/dsh/follow-default`（0.8.8） | 0.8.7–0.8.8 | 宿主路由，与 adapter 的路由白名单要对齐 |
| 向量记忆全链路（本地 bge/qwen3 + 四家云端 embedding）、会话滚动重做 | 0.8.9 | 与 `plugins/memory` 的职责边界需要重新划线（architecture.md §9 原则 6） |
| 更新器：进度、`applyGeneration` ABA 防护、清单校验 | 0.8.9 | 我们不用上游更新器（子模块 + setup 自管），无影响 |

## 6. 候选方案

### A. 维持 v0.8.6，只观察（推荐）
- 是什么：不动子模块指针，本条只留记录与触发条件。
- 代价：0；风险：继续吃不到 0.8.7–0.8.9 的修复（尤其 rc.5 兼容与 web_search）。
- 触发条件（出现任一即重启评估）：QQ/B站 出现只有 0.8.7+ 才修的问题；DSH 再升级导致 rc.5 兼容层失效。

### B. 整体升到稳定 v0.8.9，一轮重锚
- 是什么：子模块指针 59ec3066 → 0ce8580，`patchVersion` 4 → 5，重写 3 条渲染链 × 12 个 label，重跑 pins/测试。
- 代价：3 个文件的锚点重写（bridge.js 的 6 个 label 是主要工作量，1881 行 diff 里锚点可能多处位移）+ 语义复核（§5 前两行）+ 重跑 `setup:surfcore` 与 `test:audit`。
- 风险：语义重叠导致「补丁能打上但行为错了」——比锚点断裂更贵，因为不会被测试自动抓住。

### C. 跟 dev 线
- **不可行**：`src/bridge.js` 已不在包里，9 个锚点文件中 6 个失去宿主；host 是骨架，adapter 没有后端可接。真跟等于放弃锚点补丁 + 重写 adapter 到 `kernel/` 契约，那是新项目，不是升级。

### D. 只移植单点修复（如 web_search Search API / rc.5 兼容）
- 上游是整包发布，没有独立 patch 通道；单点移植=手工搬代码进我们的 `surfcore-*.mjs`，等于把上游代码抄进补丁层，与「上游只读 + 补丁只连出入口」的边界冲突。仅在 A/B 都不成立时考虑。

## 7. 卡点

- **F1 锚点断裂 3 处**（实测，§4）→ 影响 B。
- **F2 语义重叠**：0.8.7 的多群记忆隔离与我们的 memory 锚点同域 → 影响 B，需人工复核，非机械重锚。
- **F3 测试基线本身不绿**：`DV-TEST-001` 记录「根全量 151 fail、Harness 2 fail、SurfCore audit 未完成」。在这种基线上升级，**失败无法归因**——分不清是升级引入的还是本来就坏。这是 B 的最大风险。
- **F4 dev 线没有可接面**（§2.2）→ 排除 C。
- **F5 子模块工作区现有 9 个未提交改动**（即 setup 渲染产物，`git status` 显示 `M`）：升级前必须先确认这些是可重生成的产物、且旧指针可回退，否则重渲染会盖掉现场。

## 8. 决策清单（不拍板不实施）

**D1｜稳定线是否升级？**
- 选项：A 维持 v0.8.6（推荐）/ B 升 v0.8.9 / D 单点移植。
- 推荐 A 的理由：当前没有「只有新版能解」的已知故障；而 B 的语义复核（F2）与测试基线（F3）成本高于它带来的收益。
- 影响面：选 B 则动子模块指针 + pins + 3 个渲染文件 + adapter 路由复核。

**D2｜若升，是否接受「重锚 + 语义复核」一整轮（预估 3 文件）？**
- 选项：接受（推荐）/ 只机械重锚（不接受）/ 分两批（先 host+scheduler，后 bridge）。
- 推荐：接受；机械重锚在 F2 上必踩。

**D3｜dev 线怎么处理？**
- 选项：只观察 tag（推荐）/ 订阅 release 通知 / 彻底放弃。
- 推荐只观察：整包替换式发布，架构未定型，任何现在写的适配都会被下一包推翻。

**D4｜是否先清 DV-TEST-001 再做 B？**
- 选项：先清再升（推荐）/ 不等基线就升 / 只清 surfcore 相关那部分。
- 推荐先清（或至少让 `test:audit` 有可信基线），否则升级验收不可证伪。

## 9. 参考（访问日期均为 2026-11-13）

- <https://github.com/Mieksido/surfcore>（仓库首页，HTTP 200）
- <https://api.github.com/repos/Mieksido/surfcore/branches>（`main` = 0ce8580、`dev` = af0ded7）
- <https://api.github.com/repos/Mieksido/surfcore/releases>（v0.8.9-dev.6 至 v0.8.8-dev.2 的发布说明）
- <https://api.github.com/repos/Mieksido/surfcore/releases/tags/v0.8.7>（0.8.6→0.8.7 累积 changelog）
- <https://api.github.com/repos/Mieksido/surfcore/releases/tags/v0.8.8>
- <https://api.github.com/repos/Mieksido/surfcore/commits>（`main` 头 0ce85800 = `release: v0.8.9`）
- <https://api.github.com/repos/Mieksido/surfcore/commits?sha=dev>（`dev` 头 af0ded7 = `v0.8.9-dev.6 新架构完整包（硬切）`）

## 10.5 按特性与修复排序（v0.8.7 / 0.8.8 / 0.8.9 全量 changelog 归类）

> 排序两个维度：**对我们的价值** × **取得成本**。成本只有两种：落在锚点断裂面（`src/bridge.js` / `lib/index.js` / `lib/scheduler.js`，需重锚 12 个 label），还是落在既有/新增的独立模块（换 pin 即得，0 锚点成本）。
> 依据：`CHANGELOG.md`（v0.8.9 tag，含 0.8.7/0.8.8 全文）+ `src/` 文件清单 + 逐文件 `cat-file -e` 比对 v0.8.6/v0.8.9。

### 先看一条硬事实：钉点之后新增了 8 个模块，全部在断裂面之外

| 新模块 | 引入版本 | 作用 |
| --- | --- | --- |
| `src/command-spam.js` | 0.8.7 | 群刷屏纯 `#` 短指令过滤 |
| `src/safe-text.js` | 0.8.7 | 截断不劈开 emoji，发送前 wellFormed 兜底 |
| `src/schema-values.js` | 0.8.7 | schemastery volatile 拆包（修 `[object Object]`） |
| `src/dsh-model-follow.js` | 0.8.7 | 跟随 DSH `modelCatalog.default` |
| `src/wake-batch.js` | 0.8.7 | 唤醒有界批量 |
| `src/session-rollover.js` | 0.8.9 | 会话滚动（按当前轮上下文计） |
| `src/vector-memory.js` | 0.8.9 | 向量记忆 |
| `src/embedding-packs.js` | 0.8.9 | embedding runtime/云端包 |

对照：`web-search.js`、`dsh-health.js`、`v2-wait.js`、`group-policy.js`、`bili-memory.js`、`state-acl.mjs` 在 v0.8.6 已存在（本次只改内容）。

**含义**：越靠近「新模块」的修复越便宜；越靠近 `bridge.js` 的越贵——而 `bridge.js` 是唯一承载「事件入口 + 发送入口」的主轴，所以**功能价值高的条目多数恰好落在贵的那一侧**。

### P0 — 会直接坏或已经坏的环境适配（6 条）

| # | 特性/修复 | 版本 | 落点 | 成本 |
| --- | --- | --- | --- | --- |
| 1 | B站新会话补 `agentPreset`（优先 standard/default），避免 turn 直接 blocked | 0.8.7 | `lib/scheduler.js` | **断裂面** |
| 2 | 默认 provider/model 不可用时按模型目录 fallback 一次 | 0.8.7 | `lib/scheduler.js` | **断裂面** |
| 3 | `web_search` 认 DSH `.credentials.yaml` 的 `records` 结构 + Search API 直连 + auto 回退链 | 0.8.7 | `src/web-search.js` | 模块级 |
| 4 | 语音 preset 第 16 条写死「语音默认关闭」；`VOICE_DISABLED`/`VOICE_TOOL_DISABLED` 带 hint | 0.8.7 | preset + `bridge.js` | 混合 |
| 5 | 出站 outbox：连接类发送失败入队、上线补发（10 分钟去重 / 60 条 24h / 12 次上限） | 0.8.7 | `bridge.js` | **断裂面** |
| 6 | 桥接先监听再收紧 state ACL，启动等待放宽到 30s（语音/向量不再误报未安装） | 0.8.9 | `bridge.js` | **断裂面** |

判断：我们跑在 DSH 0.2.1-rc.5，第 1、2 条是**环境适配**而非新功能——rc.5 一旦收紧，B站 会话会被直接 blocked。这是 P0 里最硬的。

### P1 — 行为正确性，日常能感知（11 条）

| # | 特性/修复 | 版本 | 落点 | 成本 |
| --- | --- | --- | --- | --- |
| 7 | QQ @ 判断改看原始 at 段、`self_id` 缺失回退 `selfUserId`（修「同条消息 @ 别人就漏唤醒」） | 0.8.7 | `bridge.js` | 断裂面 |
| 8 | 群刷屏纯 `#` 短指令不再唤醒（主人/@/引用 放行） | 0.8.7 | `command-spam.js` | 模块级 |
| 9 | `qq_wait_for_messages` 积压立即返回 + 有界批量（20 条/4000 字，折叠给 `foldedCount`） | 0.8.7 | `v2-wait.js` + `bridge.js` | 混合 |
| 10 | emoji 不劈开 + wellFormed 兜底（修桌宠/测试对话/主动搭话 400） | 0.8.7 | `safe-text.js` | 模块级 |
| 11 | schemastery volatile 拆包（设置页 `[object Object]`） | 0.8.7 | `schema-values.js` | 模块级 |
| 12 | 体检读 `bridge.snowluma` 运行态，区分 `bridge-down`/`bridge-error`/`bridge-not-running` | 0.8.7 | `dsh-health.js` | 模块级 |
| 13 | B站 @ 一级评论补 `root=source_id`，`resolveLatestReply` 按 source rpid 找 | 0.8.7 | `bili-memory.js` + `bridge.js` | 混合 |
| 14 | B站 监听时间窗支持跨午夜 + 全角归一 | 0.8.7 | `bridge.js` / `lib/scheduler.js` | 断裂面 |
| 15 | B站 生物钟新会话用 `workspaceId` 归组（不再只传 cwd） | 0.8.7 | `lib/scheduler.js` | 断裂面 |
| 16 | 黑话学习 `waitLearnerTurn` 永远超时（waiter 先于 prompt 注册） | 0.8.7 | `slang-learner.js` | 模块级 |
| 17 | 非多模态模型不再向 ACP 塞 image block；取图失败用 summary 文字兜底 | 0.8.7 | `sticker-lib.js` + `bridge.js` | 混合 |

### P2 — 与我们已建能力正面冲突，吃了会打架（7 组）

| # | 特性 | 版本 | 冲突点 |
| --- | --- | --- | --- |
| 18 | 多群记忆隔离 + 记忆互通圈 + `conversationKey` 去重 | 0.8.7 | 我们已把记忆投递委托给 ActMem（`bridge-memory-context`/`bridge-session-memory`、`awaitMemoryContext`）。上游这套是它自己的记忆库；要吃只能整体回到 SurfCore 记忆，与 architecture.md §9 原则 6 相反 |
| 19 | 记忆卡 `recent` 上限 8→12、`firstMet`/`pinned` 拆分、`forget` 语义 | 0.8.7 | 我们的补丁已把记忆卡换成 `plugins/memory` 的 card-engine（`memoryCardPromptBlock` 被替换），上游改的是被我们绕开的那份 |
| 20 | `persona.tone.md` 不再回落核心、拆分不再报 `layer is not defined` | 0.8.7 | 与 `plugins/dsh-vivy-tone`（写 Superagent 语气块）构成两套语气机制，需先定谁是唯一真相 |
| 21 | `/dsh/model`、`/dsh/effort`、`/dsh/follow-default` 代理路由 | 0.8.7–0.8.8 | 服务于上游设置页；我们若不用它的设置页则是死代码 |
| 22 | 向量记忆全链路（bge/qwen3/bge-m3 + 四家云端 embedding） | 0.8.9 | 与 `plugins/memory` 职责重叠；且要装 runtime 包（自带 Ollama CPU），体积与第二套索引都在我们的架构之外 |
| 23 | 会话滚动重做（按当前轮上下文、20/50/80 万阈值） | 0.8.9 | 与 DSH 侧上下文管理与我们的 memory 路线重叠 |
| 24 | 更新器 / 一键启动 / SnowLuma 隐藏启动 / 桌宠安装 / Electron 下载 / 设置页 UX / 备份轮转 / 花费与额度 | 0.7–0.8.9 | 全部属于上游宿主壳自管能力；我们用子模块 + `setup` 自管，完全不经过 |

### P3 — dev 线（只观察）

`kernel/` `runtime/` `packs/` `ui/` 四件套。当前 `packs/` 只有 qq / bilibili / web / desktop-pet 四个目录，契约未定型、后端未接线；等它自己说「能跑」再评估。

### 排序的用处与边界（重要）

- **用处**：① 决定「值不值得为整包付一次重锚」；② 重锚时哪些语义必须人工复核（P2 六组）；③ 判断 dev 线何时值得跟。
- **边界**：排序**不能**把升级拆成可单独购买的单元。上游按层发布，P0/P1 的价值大多挂在 `bridge.js` 上；想只吃第 3、8、10、11、12、16 条（纯模块级），前提是 `bridge.js` 的调用点也随之更新，而调用点就在断裂面里。这就是「按特性排」之后仍要付整包代价的原因。
- 结论：**P0 六条里 4 条在断裂面**，所以「要不要吃 P0」等价于「要不要重锚 bridge.js」。一旦决定重锚，P1 的模块级条目顺带就到手；P2 六组必须显式排除，否则是行为回退。

## 10. 拍板后的验证计划（现在不跑）

| 阶段 | 命令 | 判据 |
| --- | --- | --- |
| 1. 重锚后静态 | `npm run setup:surfcore` | 无 `SURFCORE_PATCH_DRIFT`，生成 `patched-manifest.json` |
| 2. 补丁单测 | `node --test tests/surfcore-*.test.mjs` | 4 个测试文件全绿 |
| 3. 上游自检 | `cd plugins/surfcore && npm run test:audit` | 有可信基线后对比数字 |
| 4. 活体 | `npm run stop && npm start` + 重启桥接 | 左上角面板出现、QQ/B站收发一条、adapter `/proactive` 有回执 |
| 5. 回滚证据 | `git -C plugins/surfcore checkout 59ec3066` + pins 回 4 | 能一键退回 v0.8.6 |
