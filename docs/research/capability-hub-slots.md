# 综合能力网关：现状与第一批插槽

- 日期：2026-11-11
- 定位：`provider-hub-and-gateway.md` 的**实施篇**。那边管「谁有什么、怎么选」；这里管「第一批接什么、插槽长什么样」。
- 状态：设计与选型，**未写代码、未改配置**
- 一句话：这不是网络网关，是**能力经纪人**——把 DSH 没有宿主的六类能力，按统一插槽接给插件用。

## 1. 一屏现状

### 1.1 已经定下来的事

| # | 决定 | 依据 |
| --- | --- | --- |
| 1 | 中控台**不管 chat**，chat 归「设置 → 模型」 | 用户拍板；能力枚举出现 `chat` 即加载报错 |
| 2 | **百炼为主**：一把 `DASHSCOPE_API_KEY` 打通 ASR/TTS/向量/重排/图像/全模态 | 百炼覆盖最全；用户要求「只配一个 API」 |
| 3 | 凭据**共用 DSH 的 credentials**，ref 由 provider id 派生 | `deriveKeyRef`，`ui-settings-models/src/client/store.ts:125-127` |
| 4 | **不做网关进程**；网关是插件的可选 listener，触发条件 T1/T2/T3 | 只有一个调用方，加进程只增故障面 |
| 5 | 另三家是**可选增强**：Token Plan（决策）、MiniMax（音色）、硅基流动（冗余/低价） | 只在缺能力或缺兜底时启用 |
| 6 | 首批能力：媒体转录、媒体生成、结构化判定、向量 | 见 §3 |

### 1.2 四家 + 一个候选家族能提供什么

完整对照见 `provider-hub-and-gateway.md` §1；这里只记「与首批相关的」：

| 供应商 | ASR | TTS | 向量 | 重排 | 决策 | 图像/视频 | 全模态 | 实时 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 百炼按量（**主**） | 3.1 | qwen-audio / CosyVoice | qwen3.7 | qwen3-rerank | — | qwen-image / wanx | qwen-omni | — |
| Token Plan | 3.0 | 3.0 | ✗ | ✗ | ✓ 免费 | ✓ | — | ✓ qwen-audio-realtime |
| MiniMax | ✗ | speech-2.8 | ✗ | ✗ | ✗ | ✓ | — | — |
| 硅基流动 | SenseVoice | CosyVoice2 | bge-m3 / Qwen3-Emb | bge-reranker | alpha | ✓ | — | — |
| MOSS（候选） | Transcribe-Diarize | TTS / TTS-Realtime / VoiceGenerator | ✗ | ✗ | ✗ | Image | VL | **Live**（全双工） |

注：**实时语音/全模态不只阿里有**——qwen 与 MOSS-Live 都能做。所以「实时」是「选谁、什么时候做」的问题，不是「没人提供」的问题。

## 2. 网关的边界

**做什么**：把「能力 → (端点, 模型, 凭据, 限额)」解析成可调用对象，并承担降级、错误分类、产物落盘。

**不做什么**：不代理 chat（DSH 直连）、不自建计费、不做协议路由（每个适配器自己说话）、不监听公网。

## 3. 第一批候选能力（选 4 项）

评分口径：**价值**（现在有没有人要）／**复用面**（existing seam 能不能直接吃）／**阻塞项**（有没有前置迁移）。

| 能力 | 价值 | 复用面 | 阻塞项 | 结论 |
| --- | --- | --- | --- | --- |
| `asr` 媒体转录 | 高：语音输入、会议、IM 语音条 | **现成**：`plugins/asr` 引擎注册表，加一个引擎自动出现在面板 | 无 | **第一批** |
| `tts` 媒体生成 | 高：Live2D 说话是产品主功能 | 中：`plugins/voice` 只认 voxd 协议，要加外部线路 | 无（但必须新增客户端） | **第一批** |
| `decision` 结构化判定 | 中高：Superagent 路由、Evolution 判定 | 低：没有宿主，要新工具 | 需要 Token Plan 第二把 key | **第一批**（形状代表「纯文本→结构化」） |
| `embedding` 向量 | 高：记忆召回 | 低：mempalace 硬编码 384 | **有**：维度迁移 | **第一批，但只做「能算」，不做「换库」** |
| `rerank` 精排 | 中：等召回可用后再谈 | 低 | 依赖 embedding 先跑 | 第二批 |
| `image.generate` / `video.generate` | 中：创作需求 | 低 | 异步任务簿 + 产物上限 | M4 |
| `omni.understand` | 中：语音/视频备忘录 | 低 | 无 | M4 |

选这四项的理由：它们恰好覆盖**三种输入输出组合 + 两种语义**——媒体进/文本出（asr）、文本进/媒体出（tts）、文本进/结构化出（decision）、文本进/向量出（embedding）。插槽只要能容纳这四种，剩下的 rerank / image / video / omni 都只是同一套形状的变体，不需要再改核心。

`embedding` 的「只算不换库」是关键取舍：能力先落地，用它做 20 条中文 query 的召回对照测，**测完再决定要不要动 mempalace 的 schema**。这样能力可用性与数据迁移两件事解耦。

## 4. 基础插槽设计

四个插槽，缺一个都要改核心。

### 4.1 插槽一：能力规格（capability spec）

封闭枚举，每项声明自己的形状。**新增能力 = 加一条 spec + 至少一个 adapter 支持它**，否则加载报错。

```js
// capabilities.mjs
export const CAPABILITIES = {
  asr:        { input: 'audio',  output: 'text',   shape: 'sync', media: { in: ['bytes','url'], out: null },       limits: { maxBytes: 10*1024*1024, maxSeconds: 300, timeoutMs: 60_000 } },
  tts:        { input: 'text',   output: 'audio',  shape: 'sync', media: { in: null, out: 'bytes' },               limits: { maxChars: 4000, timeoutMs: 60_000 } },
  decision:   { input: 'object', output: 'object', shape: 'sync', media: { in: null, out: null },                   limits: { maxQuestions: 16, timeoutMs: 15_000 } },
  embedding:  { input: 'text[]', output: 'vector[]', shape: 'sync', media: { in: null, out: null },                 limits: { maxItems: 25, maxChars: 8000, timeoutMs: 30_000 } },
  rerank:     { input: 'text[]', output: 'ranked', shape: 'sync', media: { in: null, out: null },                   limits: { maxDocs: 100, timeoutMs: 30_000 } },
  'image.generate': { input: 'text', output: 'image', shape: 'either', media: { in: null, out: 'bytes' },           limits: { timeoutMs: 180_000 } },
  'video.generate': { input: 'text', output: 'video', shape: 'async',  media: { in: null, out: 'bytes' },           limits: { timeoutMs: 900_000 } },
  'omni.understand':{ input: 'av',   output: 'text',  shape: 'sync', media: { in: ['url','bytes'], out: null },     limits: { maxSeconds: 600, timeoutMs: 120_000 } },
}
```

规格只写**形状与限额**，不写供应商差异。供应商差异全部下沉到 adapter。

### 4.2 插槽二：适配器（adapter）

一个 `kind` 一个模块，导出三个东西：

```js
// adapters/dashscope.mjs
export const kind = 'dashscope'
export const supports = ['asr', 'tts', 'embedding', 'rerank', 'omni.understand']
export async function invoke({ capability, model, input, baseURL, auth, signal }) {
  // 返回 { output, usage?, raw? }；失败抛 CapabilityError(kind, detail)
}
```

规矩：

1. **adapter 不读凭据**。`auth` 由 hub 从 `credentials.resolve(ref)` 取出后传入——这样 adapter 天然无法把 key 写进日志或产物。
2. **adapter 不校验限额**。限额在 spec 里，hub 调用前统一拒绝；否则每个 adapter 会写一套不一样的。
3. **异步三件套要么全有要么全无**：`submit/poll/cancel`；`shape: 'async'` 的能力缺任何一个，加载即报错。
4. **未注册的 kind 直接失败**（fail loud），不做「未知 kind 就用默认协议」的猜测。

第一批只需要两个 adapter：`dashscope.mjs`（百炼原生：asr/tts/embedding）与 `systemone.mjs`（Token Plan 决策）。

### 4.3 插槽三：绑定（binding）

```jsonc
{ "bindings": {
    "asr":       ["dashscope/qwen-audio-3.1-asr-flash", "local/sensevoice"],
    "tts":       ["dashscope/qwen-audio-3.1-tts-flash"],
    "decision":  ["qwen-token-plan/decision-model-preview"],
    "embedding": ["dashscope/qwen3.7-text-embedding@512"]
}}
```

列表顺序 = 降级顺序。**但降级要按错误分类走**：

| 错误类 | 例子 | 是否降级 | 理由 |
| --- | --- | --- | --- |
| `auth` | 401、ref 未配置 | **否，立即停** | 换供应商只会把 401 变成另一个 401，还会掩盖配置错误 |
| `limit` | 429、配额尽、并发上限 | 是 | 换一家真能继续 |
| `vendor` | 5xx、超时、内容安全拒绝 | 是（除安全拒绝） | 同上；安全拒绝单独记 `policy`，不降级（换个模型重试等于绕过审核） |
| `input` | 文件过大、格式不支持 | 否 | 同一份输入换谁都会错 |

这套分类是插槽的一部分，不是实现细节——它决定「降级」什么时候是帮忙、什么时候是掩盖问题。

### 4.4 插槽四：消费面（consumer surface）

插件只有两种拿法，按语言/进程边界选：

1. **同进程**：`ctx.capabilityHub.resolve(cap)` / `.invoke(cap, input)`（Cordis 服务，插件 `inject: ['capabilityHub']`）。
2. **跨包/跨进程**：`GET /capability-hub/resolve?capability=asr`、`POST /capability-hub/invoke`，沿用 `plugins/asr` 的 component token 范式，绑 `127.0.0.1`。

两个面的返回结构必须一致（同一个序列化形状），否则会出现「面板能跑、插件跑不通」。

## 5. 插件骨架

> 现状（2026-11-11，v0.1.0-slots）：只落地了**插槽与面板**——`capabilities.mjs` / `registry.mjs` / `http.mjs` / `client.js`。
> `adapters/`、`service.mjs`、异步任务簿都还没建，`invoke` 不存在。交付记录见 `docs/logs/2026-11-world-gateway/v0.1.0-slots/`。

```
plugins/capability-hub/           # 独立仓，按 AGENTS.md §1 落在 plugins/
  src/
    capabilities.mjs              # 4.1 规格表 + 校验
    registry.mjs                  # endpoints/bindings 读写 + resolve + 降级
    errors.mjs                    # 4.3 的错误分类与可降级判定
    adapters/dashscope.mjs        # 百炼原生（asr/tts/embedding）
    adapters/systemone.mjs        # Token Plan 决策
    service.mjs                   # ctx.capabilityHub
    http.mjs                      # 第 2 种消费面 + component token
    panel.mjs                     # 设置分区：接入点/凭据/能力矩阵/任务簿
  tests/
    spec.test.mjs                 # 规格校验：未知能力、缺 submit
    degrade.test.mjs              # auth 不降级、limit 降级
    dashscope.adapter.test.mjs    # 用录制响应，不打真网
```

`registry.json` 落在 `<DSH_HOME>/capability-hub/registry.json`（人可读、可 diff）。

## 6. 第一批验收（三件事，缺一不算完）

1. **一个 key 全绿**：只配 `DASHSCOPE_API_KEY`，面板里 asr / tts / embedding 三项显示「已配置 + 连通」。
2. **端到端一条链**：录一段中文语音 → `asr` 出文本 → `tts` 出 wav → 能播放。中间不碰任何 chat 模型。
3. **降级真的会动**：把百炼的 key 改成错的 → 面板立刻标红并提示「去设置填」，**而不是**静默切到本地或硅基流动（验证 `auth` 不降级）。

## 7. 明确不做

| 不做 | 原因 |
| --- | --- |
| 实时语音会话（qwen-realtime / MOSS-Live） | session 级协议，要 WS 音频管线 + 回声消除，是独立项目 |
| 代理 chat | DSH 已直连，多一跳只增故障面 |
| 自建计费/额度推算 | 四家计量模型不同，算必错 |
| 公网监听 | 只有本机调用方 |

## 8. 未验证

1. 百炼 `qwen-audio-3.1-asr-flash` 的**文件直传**是否接受本地文件（还是必须先传 OSS/Data URI），决定 asr adapter 要不要带上传步骤。
2. `qwen-omni` 吃本地上传音频的方式（URL vs Data URI vs file id）。
3. `systemone` 的 `confidence` 分布是否稳定到能设阈值（需要跑几十次真实路由问题才知道）。
4. "本地 `sensevoice`" 是否能被 `capabilities` 抽象容纳（它的进程模型与 HTTP adapter 不同，可能要走 `local` kind 分支）。
5. 效果未知：`qwen-audio-3.1-tts-flash` 中文音色是否适合 Live2D 陪伴场景（主观，要试听）。

## 9. 待决策

- **E1**：插件命名用 `capability-hub` 还是沿用 `model-hub`？（我倾向 `capability-hub`，因为它确实不管模型了）
- **E2**：第一批要不要把 `decision` 放进来——它需要第二把 key，破坏「只配一个 API」的纯度，但它是唯一免费的推理面。
- **E3**：`local/sensevoice` 作为 `asr` 兜底，是走 `kind: 'local'` 的 adapter，还是让 `plugins/asr` 在 hub 不可用时自己兜底？（后者更省，但把降级逻辑放进了消费者）

## 10. 在线模型动态刷新（评估，2026-11-11）

### 10.1 结论

**可行，但先分清它能解决什么**：

- 能：省掉手抄模型 id——用户不必再去文档里找 `qwen3.7-text-embedding` 这种串。
- 不能：判断「哪个 id 是 ASR / 向量模型」。四家的 `/models` 都只回 id 列表，**没有 capability 标签**；按名字猜（含 `asr`、`embedding`）就是猜。

所以它的定位是**候选提示**，不是自动配置；手填必须永远可用。

### 10.2 与现有 catalog 的关系

`src/catalog.mjs` 已经在做候选了，只是来源是**宿主注册表**：decision / omni 从 `llm` 里取与接入点同名的 provider 的模型清单，asr / tts / embedding 如实返回「宿主没有这类注册表，手填」。

在线刷新等于给这三项补一个**外部来源**，并把 decision / omni 扩到「provider 没配、但 key 在」的情形。两边可信度不同：

| 来源 | 新鲜度 | 语义正确性 | 离线 |
| --- | --- | --- | --- |
| 宿主注册表（现有） | 取决于「设置 → 模型」配了什么 | 高（DSH 自己解析过） | 可用 |
| 在线 `/models`（本次评估） | 高 | 低（只有 id） | 不可用 |

建议并列显示并标明出处，而不是二选一。

### 10.3 实测：哪些接入点真有列表（不带 key，只看路由是否存在）

| 接入点 | 探测 | 结果 | 结论 |
| --- | --- | --- | --- |
| 硅基流动 | `GET /v1/models` | 401 `Token is invalid.` | 有 |
| 百炼 · 兼容模式 | `GET /compatible-mode/v1/models` | 401 缺 key | 有 |
| 百炼 · 原生 | `GET /api/v1/models` | 401 `InvalidApiKey` | 有 |
| MiniMax | `GET /v1/models` | 401 缺 key | 有 |
| 千问 Token Plan | `GET /v1/models` | **404** | 无 |

（同一轮还确认插件在跑：`GET /dsh-capability-hub/api/state` 返回 401 `AUTH_REJECTED`，说明路由已挂上。）

### 10.4 两条路线，建议先 B 后 A

- **A 在线拉取**：`GET {baseURL}/models`，动态、无需维护，但无语义、Token Plan 没有、离线不可用。
- **B 内置候选种子**：新增 `src/candidates.mjs`，按 `(kind, capability)` 放一组已知 id（如 `dashscope` + `asr` → `qwen-audio-3.1-asr-flash`），静态、有语义、离线可用，但会随厂商更新而过期。

| | 新鲜度 | 语义 | 离线 | 维护 | 成本 |
| --- | --- | --- | --- | --- | --- |
| A | 高 | 低 | ✗ | 无 | 约 4h |
| B | 低 | 高 | ✓ | 每次上新模型手动加 | 约 2h |

**先做 B**：它让首屏就有正确候选，且不引入任何出网；**A 作为增量**：解决「厂商出了新模型」，并合并进同一份候选列表、标注「来自接入点」。

> 2026-11-11 更新：B 已落地（`v0.1.2-preset-candidates`，含 `scripts/explore-endpoints.mjs` 核对脚本）；A 仍未做。

### 10.5 若做 A：最简设计

1. **一条路由**：`POST /dsh-capability-hub/api/models/refresh { capability }`——服务端用 `ctx.credentials.resolve(authRef)` 取 key，`GET {baseURL}/models`，只回 `{ ok, ids, fetchedAt }`，**key 永不回浏览器**。
2. **缓存独立成文件**：`<DSH_HOME>/capability-hub/models-cache.json`，不进 `registry.json`（registry 是「人可读、可 diff 的配置」，混进过期缓存会让 diff 噪音化）。
3. **面板**：与现有「从 N 个候选填入」取词器合并，多一个「刷新模型」按钮；成功后标「12 个 · 3 分钟前」。
4. **失败语义分三类**：`404` → 「该接入点不提供模型列表，请手填」；`401` → 「凭据未配置或无效」；超时 → 保留旧缓存。
5. **约束**：`baseURL` 含 `{WorkspaceId}` 占位符时直接拒绝并提示替换；仅 `https://`；同一插槽 60 秒内不重复请求；打开面板不自动刷。

### 10.6 风险

1. **兼容模式列表可能不含原生 ASR/TTS 模型**：`/compatible-mode/v1/models` 大概率只列 chat/embedding 兼容模型，而 `qwen-audio-3.1-asr-flash` 走原生协议。需带 key 实测；设计上不依赖列表。
2. **Token Plan 无列表**：已实测 404，走「请手填」分支，不是错误。
3. **baseURL 变体**：Workspace 子域写错是 404，与该接点无列表要区分（同时显示 `baseURL` 与 `fetchedAt`）。
4. **首次真实出网**：hub 从「纯本地」变成「会带 key 发请求」，README 要写清；key 只在该次请求的内存里。

### 10.7 工作量

B 约 2 小时（数据 + 候选合并 + 测试）；A 约 4 小时（route、cache、UI、3 条 mock 测试）。

### 10.8 另一种读法（要区分）

「在线模型动态刷新」也可以指**主设置的 chat provider 模型列表**（`llm-pi-ai.providers[].models`）从 `/v1/models` 拉取后写回。可行，但要写 `llm-pi-ai` 的配置，属于「管 chat」——与本网关边界冲突，应作为 DSH 上游或独立插件议题。
