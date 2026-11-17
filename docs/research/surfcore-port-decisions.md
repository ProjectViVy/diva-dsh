# SurfCore → DIVA 移植决策记录

> 定调：用户 2026-11-13 03:12 的 11 条口径（逐条映射见 §1）。本文只做调研与排序，**未改任何代码**。
> 上游依据：`Mieksido/surfcore` v0.8.9 的 `src/vector-memory.js`（全文读过）、`CHANGELOG.md` v0.8.7–v0.8.9、`src/` 模块清单。
> 本仓依据：`plugins/dsh-mempalace/`（memories 表、vec0 虚表、embeddings 服务）、`plugins/memory/`（ActMem 卡、`bili-memory.recallBlock`）、`plugins/capability-hub/`（embedding 插槽设计）、`docs/research/{qwen-platform-model-integration,provider-hub-and-gateway,capability-hub-slots}.md`。

## 0. 决策台账（2026-11-13 定案，已生效）

> 状态口径：**已定案** = 用户明确表态，后续会话按此执行，不得自行翻案；**不采纳** = 明确排除，不再讨论。
> 要翻案只有一条路：用户给出新的明确决定。翻案时在本表追加行，不删旧行。
> 绑定条目：`TODOLIST.md` DV-UP-002。

| 编号 | 决策 | 处置 | 状态 | 复盘触发条件（只有出现才重开） |
| --- | --- | --- | --- | --- |
| D1 | 向量记忆只搬**管线**（分空间索引 / 四段打分召回注入 / 敏感闸门 / fail-closed 校验），**不搬引擎**（本地 Ollama runtime、四家云端 embedding、网盘分发包） | 采纳 | 已定案 | 20 条中文 query 对照测显示本地 384 维全面落后于 512 维 |
| D2 | **做多模型独立索引空间**，并作为接入 512 维的前置（P0-1） | 采纳 | 已定案 | `sqlite-vec` 无法同库多维度 → 改「一空间一库文件」，决策本身不变 |
| D3 | 只读向量库**不抄它的 UI**；补的是**采集广度 + 自动想起**（P1） | 采纳 | 已定案 | — |
| D4 | 向量记忆**保持默认启用**（不做 opt-in）；只吸收它的三条 fail-closed 原则（P0-2） | 部分采纳 | 已定案 | — |
| D5 | **会话滚动不引入**（先观测上下文占用） | 不采纳 | 已定案 | 出现「上下文被迫截断导致失忆」的实测案例 |
| D6 | **多群记忆隔离 + 互通圈不纳入**（破坏 VIVY 主体性） | 不采纳 | 已定案 | 出现「群友隐私不能被别群看到」的真实诉求 → 改走写入侧来源标注 + 检索侧可见性过滤，仍不切库 |
| D7 | QQ 功能/指令增强/修复**不单独移植**，随整包升级顺带 | 不采纳（单独移植） | 已定案 | 出现 P0 级 QQ 故障且等不到整包升级 |
| D8 | 同 D7（第 8 条口径一致） | 不采纳（单独移植） | 已定案 | 同 D7 |
| D9 | **语音全部排除**（已走 DSH `voice` Effect） | 不采纳 | 已定案 | 语音改回 SurfCore 侧承载（当前无此计划） |
| D10 | 模型与设置：**不接** `/dsh/model`、`/dsh/effort`、`/dsh/follow-default` 代理；仅保留「`reasoningEffort` 不支持则重试一次」 | 部分采纳 | 已定案 | — |
| D11 | 安装/更新/UI：**不接代码**；只吸收 3 条工程教训（清单从 git 对象生成、校验读被校验目录自己的清单、锁要代数 + 安装失败回滚 profile） | 部分采纳 | 已定案 | — |

**明确排除清单（与上表重复者以表为准）**：多群记忆隔离与互通圈、语音全部、云端四家 embedding 生搬、本地 Ollama runtime 包、模型代理三路由、更新器/一键启动/SnowLuma/桌宠安装/网盘弹窗/备份轮转/花费页、记忆卡 `recent`·`firstMet`·`forget` 语义、人格 `persona.tone.md` 层。

## 0.1 结论速览

| 档 | 条目 | 为什么是这个档 |
| --- | --- | --- |
| **P0** | ① MemPalace 多索引空间 + 维度可配 ② embedding 空间校验/fail-closed ③ MemPalace 自动召回注入 | 三件事互为前置，且**完全不碰 `bridge.js`**（全在 `plugins/` 内），成本可估、可回退 |
| **P1** | ④ 采集广度（B站/桌宠进宫殿）⑤ 中文召回对照测 ⑥ 只读向量库视图补「来源分栏」 | 收益明确但要等 P0 出数据；④ 依赖现有 `bili-memory` 契约 |
| **P2** | ⑦ QQ 修复/指令增强（整包升级时顺带）⑧ 会话滚动（出现实测问题再议）⑨ `reasoningEffort` 容错 | 单点移植要么违反上游只读边界，要么与 DSH 现有上下文管理冲突 |
| **不纳入** | 多群记忆隔离与互通圈、语音全部、云端四家 embedding 生搬、本地 Ollama runtime 包、`/dsh/model` `/dsh/effort` 代理、更新器/一键启动/SnowLuma/桌宠安装/网盘弹窗、记忆卡 `recent`/`forget` 语义、人格 tone 层 | 与主体性/现有实现正面冲突，或纯属上游壳自管 |

## 1. 定调映射（逐条）

| # | 用户口径 | 处置 |
| --- | --- | --- |
| 1 | 向量记忆完整链路，我们留了槽点，要移植回来用于长期记忆 MemPalace；云端 embedding 我们做得更好，不生搬硬套 | **移植管线 4 件，不移植引擎 3 件**（§2.1） |
| 2 | 多模型独立索引空间，调研现状 | 现状：单一 384 维硬编码，**无空间概念**（§2.2）→ 升 P0 前置 |
| 3 | 只读「向量记忆库」，判断谁更好 | **我们闭环更强，他们采集更广**；不抄 UI，抄采集（§2.3） |
| 4 | 一键启动可勾选 + 自检不过不切换；我们默认启用，不生搬 | 保留默认启用；**只吸收 fail-closed 三原则**（§2.4） |
| 5 | 会话滚动重做，讲讲啥意思 | 机制解释 + **建议不引入**（§2.5） |
| 6 | 多群记忆隔离 + 互通圈，没必要，破坏 VIVY 主体性 | **拒绝**，理由入档（§2.6） |
| 7 | QQ 功能/指令增强/修复，不影响核心链路可移植 | 落点全在 `bridge.js` → 只在整包升级时获得（§2.7） |
| 8 | 应该也不影响主链路 | 同上（§2.7） |
| 9 | 语音彻底解耦了，不管 | 全部排除（§2.8） |
| 10 | 模型与设置，你觉得有必要再说 | 不接；只留 1 条容错（§2.9） |
| 11 | 安装/更新/UI，看哪些有必要 | 不接代码，只吸收 3 条工程教训（§2.10） |

## 2. 逐条调研

### 2.1 向量记忆完整链路（第 1 条）

**上游是什么**（读 `src/vector-memory.js` 全文得出的机制，不是猜）：

| 层 | 做法 |
| --- | --- |
| 记录 | `vector-memory.jsonl`，append-only，独立于叙事记忆卡，不复制不迁移 |
| 索引 | `vector-memory-index/<space>.json` + `.bin`，**按 `modelSpace` 一空间一文件**（如 `bge-m3@1024-f16-v1`、`bge-m3@1024-cloud-v1`）；先写 bin 再写 manifest，读者见 manifest 时 bin 必完整 |
| 写入方 | 只有插件宿主；QQ 桥接只读，不写任何向量文件 |
| Embedding | 外部 HTTP 服务（runtime 包自带 Ollama CPU），发现文件 `~/.dsh/surfcore/embedding-service.json`，也支持 `serviceUrl` + Bearer |
| 入库前 | `redactVectorText()`：密钥/密码/手机号/32+ 长串替换；`SENSITIVE_RE`（政治、时政、明星、股市…）整条标记 `sensitive`，**检索时直接跳过** |
| 打分 | `0.65·余弦 + 0.15·词法(bigram) + 0.10·重要度 + 0.10·新近度(exp(-天/60))`，阈值 `minScore 0.4`，`topK 4` |
| 注入 | `【想起的旧事】` + 最多 600 字 + 页脚「这些是可能相关的旧事，不是当前事实；记不清就说记不清，不要编」 |
| 规模控制 | `maxRecords 5000`、每 tick 最多编码 256 条、`batchSize 32`、`timeoutMs 30s` |

**我们现状**（`plugins/dsh-mempalace`）：

- 已有：SQLite `memories` + `vec0(embedding float[384])` + FTS5 关键字回退 + 零向量降级（`embedded=0`，检索 `mode=keyword`）+ `/reindex` 只重建向量不改正文 + 归档幂等（`(archive_id, chunk_index)` 部分唯一索引）+ 分块（`chunk_index`/`parent_id`）。
- 已有近似物：`plugins/memory/src/bili-memory.mjs:848` 的 `recallBlock()`——**B站记忆已经在做「触发词 + 词法 + 新近度」的自动注入**，只是没有向量。
- 缺：① 自动召回注入（宫殿目前只有工具调用，不会「想起」）；② 多模型空间；③ 维度可配（384 写死）；④ 空间不匹配的显式校验。

**要移植的 4 件**（都是逻辑，不是代码搬运）：

1. **分空间索引**：`model_space` 标识 + 一空间一索引，切模型不重建、可并存；
2. **召回打分与注入**：余弦 + 词法 + 重要度 + 新近度四段加权，阈值过滤，注入块带「不是当前事实」口径（这条与我们的记忆卡纪律天然一致）；
3. **敏感闸门**：敏感内容标记后不参与检索（我们已有 `privacy.mjs` + `redactForMemory`，需要接到检索侧）；
4. **fail-closed 校验**：`vector.model-space-mismatch` 式显式报错 + 不可用即降级 FTS，绝不静默换空间。

**不移植的 3 件**：本地 Ollama runtime 包、四家云端 embedding 适配、`packLinks/packShareUrl` 那套网盘分发（我们走 `capability-hub` 的 `embedding` 插槽，已定「只算不换库」）。

**落点预估**：`plugins/dsh-mempalace/src/store/{memory_store,chunk,embeddings}.mjs`、`src/config.mjs`、`src/service.mjs`、`src/client.js`；`plugins/memory/src/bili-memory.mjs`（把 `recallBlock` 泛化成走宫殿检索）。

### 2.2 多模型独立索引空间（第 2 条）——现状调研

**现状（证据）**：

- `plugins/dsh-mempalace/src/store/chunk.mjs`：`EMBEDDING_DIM = 384` 写死；
- `memory_store.mjs:68-70`：`if (this.embeddingDim !== 384) throw`；
- `memory_store.mjs:200`：`CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[384])`——**单表、单空间**；
- `memories` 表**没有 model 列**（列：id/content/hash/project/topic/source/timestamp/session_id/importance/chunk_index/parent_id/embedded/archive_*）；
- 换模型 = 全量 `reindex`，新旧向量不能混（`docs/research/obsidian-mempalace-feasibility.md` 已写明这条坑）。

**上游做法**：一空间一文件 + manifest 记 `model/modelSpace/dimension/count`，读取时校验 `manifest.modelSpace === space`，不匹配就 `vector.model-space-mismatch` 报错，而不是拿旧向量凑合。

**结论**：我们不是「做得差一点」，是**根本没有这个维度**——一旦接 `capability-hub` 的 512 维（百炼 `qwen3.7-text-embedding` 只有 256/512/768/1024，没有 384），就必须先解决「两个空间能不能共存」。

**三个方案**：

| 方案 | 做法 | 代价 | 风险 |
| --- | --- | --- | --- |
| A（推荐） | 分表：`vec_memories_<space>` + `memories` 加 `model_space` 列 | 建表/迁移/查询都要带空间名；检索只查当前空间 | 多空间并存时「搜哪个」要显式；旧数据默认空间名 |
| B | 单表加 `model_space` 列，检索时 over-fetch 再过滤 | 改动最小 | sqlite-vec 不支持过滤，候选集截断会漏；分数不可比 |
| C | 不动，换模型即全量重建 | 零改动 | 永远只有一个可用的向量空间，多模型无法并存 |

### 2.3 只读「向量记忆库」（第 3 条）——谁更好

| 维度 | SurfCore | 我们（MemPalace） |
| --- | --- | --- |
| 视图 | 最近记录 + 语义搜索，每条标「已向量化/关键字」 | 同样的「向量后端状态 + 已向量化/关键字」徽标 + 重建缺失向量按钮（`client.js:276,339,846,866`） |
| 结构 | 扁平记录流 | 项目 → 话题 → 计数树、隧道、知识图谱、时间线（`memory_taxonomy/graph/tunnel`） |
| 真实性 | jsonl 是唯一真源，索引可重建 | 同上（`reindex` 只重算向量） |
| 幂等 | `id` 去重 + `textHash` 增量 | `(archive_id, chunk_index)` 部分唯一索引，digest 冲突返回冲突不写 |
| 采集广度 | QQ 群/私聊/桌宠/自己 + B站 video/comment/dynamic **自动成流** | 主要靠 ActMem 退色归档 + B站记忆，**自动流较弱** |
| 自动想起 | 有（注入 `【想起的旧事】`） | 无（只能工具调） |

**判断**：**闭环我们更强**（结构化、可重建、幂等、多视图），**他们更强在采集广度与自动想起**。所以第 3 条不是「照抄他们的库」，而是把「广度 + 想起」补进我们的库。

### 2.4 默认启用 vs 勾选（第 4 条）

- 上游：`enabled: true` 默认，但一键启动里可勾选；runtime 自检不过**不切换记忆方式**（宁可不生效，也不悄悄换库）。
- 我们：定位不同——记忆是主体的一部分，**默认启用是对的**，不做 opt-in。
- 但「自检不过不切换」这条原则我们**部分缺失**：我们有零向量降级（写了零向量、回退 FTS），却没有「模型/空间变了」的显式拒绝——现在换 `embeddingModel` 会重建，但**跨空间混用不会被拦**。
- 结论：保留默认启用；吸收 3 条：自检不过不切库、空间不匹配显式报错、降级要可见（`mode=keyword` 已有，面板要显示原因——`embedding_error` 已有）。

### 2.5 会话滚动（第 5 条）——它是什么，为什么建议不做

**它是什么**：一个 DSH 会话的上下文是有上限的。SurfCore 的做法是——当上下文快满时，**不是在原会话里删旧消息，而是换一个新会话**接着聊：把上一段的「交接块（handoff）」写进新会话开头，旧会话归档不再读。

- `[9]` 之前：用**累计账单 token** 判断（`rolloverTokens: 80000`）→ 花了多少钱 ≠ 上下文有多满，所以经常误触发；
- `[9]` 改成看**当前这一轮的上下文**；默认**关闭**；手动开启要弹窗确认「会重置上下文、可能遗忘前文、缓存要重建」；阈值按模式 20/50/80 万；
- P0 修复：到阈值**只在下一轮投递前**换会话，当前这轮回复不会因为 token 轮换丢掉；
- 跨重启持久化计数/交接块/pending；更新锁加 ABA 防护。

**为什么建议我们不引入**：

1. 我们的「连续感」靠 ActMem 记忆卡 + 会话记忆（`session-memory.mjs`）+ 上下文快照（`context-snapshot.mjs`），会话滚动会**再叠一层遗忘**，与主体性优先的路线相反；
2. 换会话 = 缓存全丢，成本是钱；我们目前没有「上下文爆掉」的实测证据；
3. 我们已有第三方 `dsh-context` 面板可观测上下文占用——**先观测，再决定**，比先装机制便宜。

**结论**：P2，进观察；只有当出现「上下文被迫截断导致失忆」的实测案例才重开。

### 2.6 多群记忆隔离 + 互通圈（第 6 条）——拒绝

用户口径：破坏 VIVY 主体性原则。技术上同意：

- 上游做法是「记忆默认按群隔离，同圈群互看，私聊记忆永不进群」——本质是**把一个人格切成 N 份上下文**；
- 我们 `docs/architecture.md` 的原则是「一个主体、一份记忆、平台只是入口」，ActMem 已按 owner/项目/话题组织，不按群切；
- 一旦按群隔离，「她在 A 群记得的事在 B 群想不起来」会直接变成人设事故。

**结论**：不纳入。若将来出现「群友隐私不能被别群看到」的真实诉求，正确做法是在**写入侧**做来源标注 + 检索侧做可见性过滤，而不是切库。

### 2.7 QQ 功能/指令增强/修复（第 7、8 条）

清单里的条目（`@` 判断、`wait` 有界批量、outbox 补发、短指令过滤、safe-text、工具晚注册限制、`fetchHistory` 顺序、sticker 文字兜底、tool-error 误判、群成员缓存、权限页、tool 结果 1M→64k 等）**落点几乎全在 `bridge.js`**（979 KB，也是三个断裂面文件里最大的一个）。

且注意一个细节：`safe-text.js` / `command-spam.js` / `wake-batch.js` 虽然是**新增独立模块**，但**调用点在 `bridge.js`**——所以「只搬模块」拿不到行为，搬了也是死代码。

**结论**：P2，**不单独移植**；整包升级时顺带。若将来必须单点，优先级：`safe-text`（修 400，纯函数、回归面最小）> `command-spam`（纯判定）> `v2-wait`（有界批量，动到等待语义，风险最大）。

### 2.8 语音（第 9 条）

我们已把语音走 DSH `voice` Effect（architecture.md §12.5），SurfCore 的语音包安装/诊断/总闸那一整套是它自己的子进程体系，**两套并存只会打架**。全部排除。

### 2.9 模型与设置（第 10 条）

- `/dsh/model`、`/dsh/effort`、`/dsh/follow-default` 是**它自己设置页的代理路由**，我们不用它的设置页 → 不接；
- 唯一值得抄的通用健壮性：**模型不认 `reasoningEffort` 时去掉参数重试一次**（我们 `capability-hub`/`decision` 插槽会遇到同类问题）；
- 「保存只标记已保存/待确认，不宣称已生效」这条与我们 DV-DOC-008 的教训同构，作为纪律记录即可，无需代码。

### 2.10 安装 / 更新 / UI（第 11 条）

代码一律不接（我们用子模块 + `setup` 自管，更新器/一键启动/SnowLuma/桌宠安装/网盘弹窗全部无关）。**只吸收 3 条被别人用血换来的教训**：

1. **发布清单从 git 对象生成，不是工作区**（他们被 Windows CRLF 坑了三次；我们 `DV-OPS-002` 也有同类症状）；
2. **校验必须读被校验目录自己的清单**，缺清单直接拒绝（`release-manifest --verify` 的 0.8.9 修正）；
3. **锁要有代数（ABA 防护）**：旧任务不能清掉新任务锁；`dsh plugin install` 后要核对 bundles 并**自动回滚 profile**，别让插件被连坐。

## 3. 优先级表

| 档 | 条目 | 成本 | 前置 | 验收 |
| --- | --- | --- | --- | --- |
| P0-1 | MemPalace 多索引空间（方案 A 分表）+ `model_space` 列 + 维度可配 | 2–3 人日 | 无 | 同一库内 384 与 512 两空间共存；检索只查当前空间；旧数据自动落默认空间 |
| P0-2 | 空间校验 + fail-closed（`embedding.model-space-mismatch` / 降级可见） | 0.5 人日 | P0-1 | 故意配错空间 → 明确报错且不写库；模型不可用 → `mode=keyword` 且面板显示原因 |
| P0-3 | MemPalace 自动召回注入（四段打分 + `【想起的旧事】`口径 + 敏感闸门） | 1–2 人日 | P0-2 | 一句含旧事的问法能召回 ≤4 条；敏感记录不出现；注入块带「不是当前事实」 |
| P1-4 | 采集广度：B站/桌宠记录进宫殿（复用 `bili-memory.recallBlock` 的触发词思路） | 2 人日 | P0-1 | B站看过的视频可被语义检索到；重复投递幂等 |
| P1-5 | 中文召回对照测（本地 MiniLM 384 vs 百炼 512，20 条 query） | 0.5 人日 | P0-1 | 出 NDCG/命中率对比表，**用数据决定是否换 512** |
| P1-6 | 只读向量库视图补「按来源/平台分栏 + 未向量化计数」 | 0.5 人日 | P0-1 | 面板能看出哪类记录没进向量 |
| P2-7 | QQ 修复/指令增强 | 整包升级成本 | 重锚 `bridge.js` | 随 DV-UP-001 |
| P2-8 | 会话滚动 | 高 | 出现实测失忆案例 | 不装 |
| P2-9 | `reasoningEffort` 不支持则重试一次 | 0.2 人日 | 无 | 模型报参数不支持 → 自动重试成功 |

## 4. 依赖顺序（为什么 P0 是这个顺序）

`P0-1 → P0-2 → P0-3`：没有分空间就没法接 512 维；没有空间校验，接错空间会污染库且不报错；有了正确的空间和校验，自动召回才有可能取到对的向量。**P1-5 的对照测必须在 P0-1 之后**，否则测的是「384 单空间」而不是「换不换引擎」。

## 5. 未核实

- ~~MemPalace 的 `sqlite-vec` 版本是否支持动态维度建表（`vec0(embedding float[512])` 需实测）~~ → **已核实（2026-11-13）**：`sqlite-vec 0.1.9` 同库可并存 `float[384]` 与 `float[512]` 两张 `vec0` 表，重开多次仍按表 `MATCH`；跨维度写入/查询由引擎拒绝。见 `tests/mempalace-spaces.test.mjs`。
- `plugins/memory/src/bili-memory.mjs` 的 `recallBlock` 是否已在生产被调用（读到定义，调用点未核）；
- DSH 0.2.1-rc.5 自身是否有上下文压缩/自动收割机制（`docs/architecture.md` 无相关条目，需查 `deepseek-harness/`）；
- 上游 `session-rollover.js` 的交接块格式（只读了 changelog 描述，未读实现）；
- ~~我们的 `memories` 表当前行数与向量维度分布（未跑 SQL，属运行态数据）~~ → **已核实（2026-11-13）**：线上 `.artifacts/dsh-home/mempalace/memories.db` 为 7 行、`float[384]` 单表 `vec_memories`，迁移后 7/7 入 `memory_spaces`，备份 `memories-2026-11-12T20-07-35-838Z.db` 已落盘。
- 云端模型 `qwen3.7-text-embedding` 的实际维度与是否接受 `dimensions`（未拿到 key，未实测；`text-embedding-v4` 支持 2048/1536/1024/768/512/256 为文档值）。
