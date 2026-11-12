# 多供应商中控台与网关：设计

- 日期：2026-11-11
- 修订：2026-11-11 06:40，按用户反馈**收缩范围**——中控台不管 chat（chat 仍归主设置），只负责 DSH 没有的能力；凭据与主设置共用同一个 credentials 存储。§0/§2/§3.1/§3.2/§3.4/§5/§7/§8 已同步。
- 触发：用户提出「组合使用」（Token Plan 决策 + 百炼 ASR/TTS + 百炼向量 + MiniMax），并要求「一个中控台」「可能需要网关」「与 DSH 自带 provider 管理联动」
- 范围：只做设计与可行性判断，**未改代码、未改配置、未申请 key**
- 前置阅读：[`qwen-platform-model-integration.md`](qwen-platform-model-integration.md)（千问两端点选型）、[`omni-modal-external-providers.md`](omni-modal-external-providers.md)（五条接缝）

## 0. 结论

**做「一个插件 + 一份数据」，不做「一个网关进程」；只有当出现跨厂商自动降级或非 DSH 客户端复用时，才把网关作为该插件的可选监听器打开。**
**范围收缩（2026-11-11 06:40 修订）：中控台只管 DSH 不具备的能力（向量/重排、ASR、TTS、决策、图像/视频），chat 与视觉继续由 DSH 自带的「设置 → 模型」管理；中控台不接管、不投影、不在 chat 环节插入任何一跳。**
**凭据不与主设置分家：两边写同一个 credentials 存储、同一套 ref 名，主设置里填过的 key，中控台直接认。**

| 判断 | 内容 | 依据 |
| --- | --- | --- |
| 中控台形态 | DSH 插件 `dsh-model-hub`：接入点注册表（一份真源）+ 能力绑定 + 面板；**不新增常驻进程、不新增端口** | 非 chat 能力本来就没有宿主，只能由插件承载 |
| 与 DSH 联动方式 | ①凭据复用同一个 `ctx.credentials`（`set/resolve/describe`，ref 共享）②能力解析面对插件开放 ③chat 侧完全不碰 | `credentials-local/src/index.ts:624-676`；`ui-settings-models/src/client/operations.ts:79` |
| 网关要不要 | **先不要**。chat 由 DSH 的 `llm-pi-ai` 直连；ASR/TTS/向量由各插件调 adapter | 多一个进程 = 多一跳、多一套鉴权/限流/日志；当前没有测量支持 |
| 何时升级为网关 | ①同一能力需要跨厂商自动降级且调用方不愿改 ②非 DSH 客户端（手机端、脚本）也要复用 ③需要统一审计/配额 | 触发条件写死在方案里，避免「先建后猜」 |
| 额度处理 | 只读展示 + 阈值告警 + 降级链，**不自建计费** | 四家计量模型不同（月 Credits / 后付费 / 5h+周双窗口 / 后付费），自建计费必然错 |
| 最小可用配置 | **只配 `DASHSCOPE_API_KEY` 一把 key，ASR/TTS/向量/重排四项全通**；Token Plan、MiniMax、硅基流动都是可选增强 | 用户要求「百炼最全，只配一个 API」；多配一家是被选项，不是前置条件 |

## 1. 组合 A 的现实：三家、四套协议、三种额度

| 供应商 | 端 key | 能提供 | 计费 / 额度 | 协议形状 |
| --- | --- | --- | --- | --- |
| 千问 Token Plan | `sk-sp-`（`token-plan.maas.qianwenaiapi.com`） | chat/视觉、决策、ASR 3.0、TTS 3.0、实时语音、图像/视频、内置工具 | Credits 月额度，订阅月重置；22:00–08:00 折扣 | OpenAI 兼容 + DashScope + `systemone` |
| 千问百炼按量 | `sk-ws-`（`dashscope.aliyuncs.com`） | 全量模型：ASR 3.1、CosyVoice、**embedding / rerank** | 后付费，无额度窗口 | OpenAI 兼容 + DashScope 原生 |
| MiniMax M Plan | 订阅 Key（与按量 Key **不通用**） | `MiniMax-M3.1-Flash`（1M、原生多模态）、TTS `speech-2.8-hd/turbo` + 音色复刻/设计、图像 H3、视频 H3（Explore 起） | **5 小时窗口 + 周窗口**双额度，首次使用时起算 | OpenAI 兼容 + Anthropic 兼容 + 自有 TTS 协议 |
| 硅基流动 | `sk-...`（`api.siliconflow.cn/v1`） | chat（`/v1/chat/completions`）、**embedding**（`/v1/embeddings`）、**rerank**（`/v1/rerank`）、**ASR**（`/v1/audio/transcriptions`）、**TTS**（`/v1/audio/speech`）、图像、视频、`/v1/models` 列表 | 后付费，无套餐窗口；有免费/低价模型，语音与向量按量 | **全部 OpenAI 形状**（含音频 multipart 与 `/v1/models`） |

四条硬事实，直接决定设计：

1. **MiniMax 没有 ASR**。接口概览只列语言/视频/图片/语音合成/音乐/文件管理；「声音模型」= TTS + 复刻 + 设计。ASR 只能来自百炼（或本地 SenseVoice）。
2. **Token Plan 也没有 embedding/rerank**（上一轮已核）。向量只有百炼按量一条路。
3. **三种额度模型互不相通**，且 `sk-sp-` / `sk-ws-` / MiniMax 订阅 Key / 硅基流动 Key 四把钥匙不能混用——这正是「key 容易散落」的根源。
4. **硅基流动是唯一「四缺全覆盖且全 OpenAI 形状」的一家**：向量、重排、ASR、TTS 都在 `api.siliconflow.cn/v1` 下，用同一把 Bearer；连 `/v1/models` 都有（可做零 token 的连通性探测）。代价是它不卖套餐、并且托管的是第三方开源模型（`BAAI/bge-m3`、`FunAudioLLM/SenseVoiceSmall`、`FunAudioLLM/CosyVoice2-0.5B` 等），上下线由平台决定。

能力矩阵（谁主谁备）：

| 能力 | 主 | 备 | 第三 | 落到哪个接缝 |
| --- | --- | --- | --- | --- |
| chat / 视觉 | Token Plan `qwen3.8-flash` | MiniMax `MiniMax-M3.1-Flash` | 硅基流动 `DeepSeek-V4.1-Flash` | `llm-pi-ai.providers`（**归主设置，中控台不碰**） |
| 决策 | Token Plan `decision-model-preview`（免费，可选） | — | — | 新工具/服务（`systemone`） |
| ASR | **百炼 `qwen-audio-3.1-asr-flash`** | 硅基流动 `FunAudioLLM/SenseVoiceSmall` | 本地 `sensevoice`（永远兜底） | `plugins/asr` 引擎 |
| TTS | **百炼 `qwen-audio-3.1-tts-flash` / CosyVoice** | 硅基流动 `FunAudioLLM/CosyVoice2-0.5B` | MiniMax `speech-2.8-turbo` | `plugins/voice` 外部线路 |
| 向量 | **百炼 `qwen3.7-text-embedding@512`** | 硅基流动 `Qwen/Qwen3-Embedding-0.6B@512` | — | `dsh-mempalace`（卡 384 维） |
| 重排 | **百炼 `qwen3-rerank`** | 硅基流动 `BAAI/bge-reranker-v2-m3` | — | `dsh-mempalace`（未接） |
| 图像 / 视频 | 百炼 |
| 文生图 / 图生图 | 百炼 `qwen-image` / `wanx`（待核 id） | Token Plan `qwen-image-3.0-pro` | 硅基流动 `/v1/images/generations` | `deliverables`（M4） |
| 全模态理解 | 百炼 `qwen-omni`（音频/视频 → 文本，待核 id） | — | — | 新工具（M4） |
| 实时语音 | — | — | — | 暂不做（见 §6.5） |

**「一把 key 原则」（用户定的产品要求）**：默认情况下用户**只配 `DASHSCOPE_API_KEY` 一把 key**，ASR / TTS / 向量 / 重排四项就应当全绿——百炼一家覆盖最全，其余接入点是可选增强（Token Plan 只为一个决策模型，硅基流动只为便宜与冗余）。这条同时是 M0 的验收标准：只填百炼 key，面板四项显示「已配置 + 连通」，一个红点都不许有。

代价：百炼成为主链路后，`dashscope-asr`（`/api/v1/services/aigc/multimodal-generation/generation`）与 `dashscope-tts`（`/api/v1/services/audio/tts/SpeechSynthesizer`）必须自己写 adapter，不能靠 OpenAI 形状白拿。硅基流动的价值因此变成**冗余与低价备线**，而不是实现捷径。

## 2. DSH 给了什么接缝（决定「联动」怎么做）

范围收缩后，中控台只需要两件事：**认得出 key**、**拿得到能力**。DSH 各给了一条现成的路。

| 事实 | 位置 | 含义 |
| --- | --- | --- |
| 凭据是一个全局服务：`resolve(ref)` / `describe(ref)` / `set(ref, value)` / `unset(ref)` / `listRecords()` / `modifyRecord()` | `credentials-local/src/index.ts:624-676` | 一份存储（`<DSH_HOME>/.credentials.yaml`），所有插件与 UI 共用 |
| 凭据解析顺序：托管文件 > 启动环境（含自然语言名）> 项目 `.env` > `$DSH_HOME/.env`，`describe` 会回传 `source` | `credentials-local/src/index.ts:624-643` | 面板能如实显示「文件里配的 / 环境变量来的 / 还没配」 |
| 主设置的「API Key」输入框就是调 `ctx.remote.credentials.set(ref, value)`；未显式写 `apiKeyEnv` 时服务端按 provider 名派生 ref | `ui-settings-models/src/client/operations.ts:79`；`ui-settings-models/src/client/store.ts:121,171-180` | **中控台只要用同一个 ref，主设置填过的 key 立刻可见，反之亦然** |
| `llm-pi-ai.providers` 是 `Volatile`，settings 可 live 写 | `llm-pi-ai/src/config.ts:222-229`；`settings/settings/src/index.ts:224,357` | 这条**留给 chat**，中控台不用它（见范围收缩） |

**结论**：中控台不发明密钥体系，也不接管 chat。它只做三件事——
① 认出需要哪些 ref（**按 DSH 的派生规则自动得出，不手写**）；
② 面板用 `credentials.describe(ref)` 显示状态，内联输入框直接调 `credentials.set(ref, v)`；
③ 其他插件通过中控台的解析面拿「能力 → 端点 + 模型 + ref」，自己再去 `credentials.resolve`。

这样「主设置里填 API」与「中控台里填 API」是同一个动作的两个入口，不存在第二份真相。

### 2.1 一把 key 的多个面（这就是要补的部分）

用户口径是对的：**一条 API，多个面**。DSH 只消费 chat 那一个面，其余面走不同路径——它们都在同一把 key 之下。

| 供应商 | 一个 ref（账号级） | chat 面（DSH 已在用） | 我们要补的面 | 同一把 key？ |
| --- | --- | --- | --- | --- |
| 百炼按量 | `DASHSCOPE_API_KEY`（provider id `dashscope` 派生） | `{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions` | `/compatible-mode/v1/embeddings`；ASR `/api/v1/services/aigc/multimodal-generation/generation`；TTS `/api/v1/services/audio/tts/SpeechSynthesizer` | **是**，同一 Bearer |
| Token Plan | `QWEN_TOKEN_PLAN_API_KEY`（provider id `qwen-token-plan` 派生） | `token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | `/compatible-mode/v1/systemone`（决策）；ASR/TTS 的 `api/v1/services/...` | **是** |
| MiniMax | `MINIMAX_API_KEY`（provider id `minimax` 派生） | `api.minimaxi.com`（OpenAI / Anthropic 兼容） | TTS `t2a_v2`（待核）；图像/视频 | **是**（订阅 key 与按量 key 是不同**值**，但同一个 ref 名） |

三条 ref 规则：

1. **ref 粒度 = 接入点（provider id），不是能力**。一把 key 覆盖多少个面，就写多少个 `capabilities`，`auth` 只有一个。
2. **ref 名不手写**：接入点 id 起成 DSH 里那个 provider id（`dashscope` / `qwen-token-plan` / `minimax`），ref 自动是 `<ID>_API_KEY`，与主设置完全一致（`deriveKeyRef`，`ui-settings-models/src/client/store.ts:125-127`）。注册表里 `auth` 可省略；只有在「该接入点没有任何 chat provider」时才写显式 ref。
3. **baseURL 要存完整，不是 host**。百炼的兼容端点现在带 Workspace：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`（官方向量文档示例），文档明写「各地域的 API Key 不同」——所以 ref 的实际粒度是 **(账号, 地域/Workspace)**，换地域就是换 key，注册表必须让 baseURL 与 ref 成对出现。

一个必须守住的边界：中控台**不写 `llm-pi-ai.providers`**。chat 的路由由用户在主设置里管理，中控台最多在面板上「只读展示」已配置的 provider 名称，避免两边互相覆盖。

## 3. 中控台设计（最简方案）

### 3.1 数据：一份注册表 + 一组绑定

`<DSH_HOME>/model-hub/registry.json`（**能力侧**唯一真源；chat 的真源仍是主设置。人可读、可 diff、可回滚）：

```jsonc
{
  "endpoints": {
    "qwen-token-plan": {          // 接入点 id = DSH provider id → ref 自动是 QWEN_TOKEN_PLAN_API_KEY
      "kind": "alibaba-token-plan",
      "baseURL": "https://token-plan.maas.qianwenaiapi.com",
      "quota": { "mode": "credits-monthly" },
      "capabilities": ["decision", "asr", "tts"]
    },
    "dashscope": {                // → DASHSCOPE_API_KEY，与主设置同名 provider 共用
      "kind": "alibaba-payg",
      "baseURL": "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com", // 必须带 Workspace；各地域 key 不同
      "quota": { "mode": "payg" },
      "capabilities": ["asr", "tts", "embedding", "rerank"]
    },
    "minimax": {                  // → MINIMAX_API_KEY
      "kind": "minimax",
      "baseURL": "https://api.minimaxi.com", // 待核
      "quota": { "mode": "dual-window", "windows": ["5h", "7d"] },
      "capabilities": ["tts"]
    },
    "siliconflow": {              // → SILICONFLOW_API_KEY
      "kind": "siliconflow",
      "baseURL": "https://api.siliconflow.cn/v1", // 全 OpenAI 形状，含 /v1/models 可做探测
      "quota": { "mode": "payg" },
      "capabilities": ["asr", "tts", "embedding", "rerank"]
    }
  },
  "bindings": {
    "asr":       ["dashscope/qwen-audio-3.1-asr-flash", "siliconflow/FunAudioLLM/SenseVoiceSmall", "local/sensevoice"],
    "tts":       ["dashscope/qwen-audio-3.1-tts-flash", "siliconflow/FunAudioLLM/CosyVoice2-0.5B", "minimax/speech-2.8-turbo"],
    "decision":  ["qwen-token-plan/decision-model-preview"],
    "embedding": ["dashscope/qwen3.7-text-embedding@512", "siliconflow/Qwen/Qwen3-Embedding-0.6B@512"],
    "rerank":    ["dashscope/qwen3-rerank", "siliconflow/BAAI/bge-reranker-v2-m3"]
  }
}
```

四条设计约束：

- **绑定是列表 = 降级链**，不是单值。空列表表示「该能力未启用」，显式失败而非静默跳过。
- **`endpoints.*.quota` 只描述形状，不记数值**。数值来自各控制台的只读接口（没有就不显示），中控台不推算。
- **能力名封闭枚举，且不含 `chat` / `vision`**：`decision / asr / tts / embedding / rerank / image.generate / image.edit / video.generate / omni.understand`。一旦配置里出现 `chat`，说明越界了，加载时直接报错而不是忽略。
- **`auth` 可省略**：省略即按接入点 id 派生；写了显式值则先读 `llm-pi-ai.providers.<id>.apiKeyEnv`（用户在主设置里手填过 ref 时以它为准）。不可解析的接入点视为 disabled，面板灰显并给出「去设置里填」的入口。

### 3.2 凭据：与主设置同一个存储

- 面板的输入框调 `ctx.remote.credentials.set(ref, value)`，与主设置「API Key」输入框是**同一个服务、同一份文件**。
- 主设置里已经填过的 ref，`describe` 返回 `configured: true, source: 'file' | 'env'`：面板显示「已配置（来自设置 / 环境变量）」并禁用输入，不重复写、不覆盖。
- **ref 由接入点 id 派生，不手写**：`provider id → <ID>_API_KEY`（`deriveKeyRef`，`ui-settings-models/src/client/store.ts:125-127`），所以接入点 id 必须和主设置里那个 provider id 一模一样。这是「共用一套储存」的唯一要求。
- 一个 ref 可被多个接入点共用（同一账号不同地域除外——地域不同 key 不同，要拆成两个接入点）。
- registry.json、日志、面板快照里**永不出现 key 明文**；连通性测试失败只留状态码与 error code。

一句话：**填 API 只有一个地方（credentials），中控台只是它的第二个入口。**

### 3.3 解析面：让 asr / voice / mempalace 只认「能力」

中控台提供两个内部面（沿用 `plugins/asr` 的 component token 范式，绑 127.0.0.1）：

- `GET /model-hub/resolve?capability=asr` → `[{ endpoint, model, baseURL, protocol, authRef, order }]`
- `POST /model-hub/invoke`（可选）→ 由 hub 代发一次请求，插件不碰 vendor 协议。

两种用法各有代价：`resolve` 让插件自己实现协议（每家一个 adapter，散落）；`invoke` 把协议收在 hub（插件只发 `{capability, input}`，但 hub 变成数据面，要处理上传/流式/超时）。**建议 M1 先用 `resolve`，等第二个插件要接同一能力时再上 `invoke`**——按「有第二个消费者才抽接口」的规则。

### 3.4 面板

一个设置分区（`settings.section`），四块：

1. **接入点**：id / kind / baseURL / 凭据状态（`credentials.describe` 给 `configured + source`，**不显示 key 任何片段**）/ 能力清单 / 最近一次连通性测试结果。
2. **能力矩阵**：行=能力（asr/tts/embedding/rerank/decision），列=接入点，格子=绑定的 `model`；点格子切主备，写回 registry 并立即生效（无投影步骤）。
3. **连通性测试**：每个接入点一次最小调用（asr 发 1 秒静音；tts 合成一个「啊」；embedding 发一个汉字），失败只显示状态码与 error code。
4. **额度**：能读到就显示，读不到显示「未提供」——**不猜**；窗口型额度必须带窗口语义（「本 5 小时窗口」）。

面板顶部固定一行说明：**chat 与视觉不在这里配，去「设置 → 模型」**——否则用户会以为中控台能管全部。

### 3.5 接全之后：形状与产物

「端点接全」的代价不是多几行配置，而是**能力不再都是同步一问一答**：

| 能力 | 输入 | 输出 | 形状 | 产物落点 |
| --- | --- | --- | --- | --- |
| `decision` | state + questions | `choice` / `confidence` | 同步，毫秒 | 无 |
| `asr` | 音频文件 / URL / Data URI | 文本（可选时间轴、说话人） | 同步，短音频；长音频要分段 | 无 |
| `tts` | 文本 + 音色 | 音频字节 | 同步（或流式） | voice 缓存目录 |
| `embedding` / `rerank` | 文本批量 | 向量 / 排序 | 同步 | 无 |
| `image.generate` / `image.edit` | prompt / 参考图 | 图片 URL 或 b64 | **同步与异步两种都有** | `model-hub/artifacts/` |
| `video.generate` | prompt / 参考图 | 任务 id → 成片 URL | **异步**：submit + poll + cancel，分钟级 | 同上 |
| `omni.understand` | 音频/视频 URL | 文本 | 同步但慢（秒级） | 无 |

三条因此必须写死：

1. **解析面返回 `shape: 'sync' | 'async'` 与 `media: { in, out }`**，插件据此决定是直接 `invoke` 还是先 `submit` 再轮询；hub 不假装所有能力都一样。
2. **异步能力要有任务簿**（id、状态、创建时间、产物路径、失败原因），面板能看到在跑什么、能取消；否则「生成到一半」永远说不清。
3. **产物必须有落点与上限**：图片/视频下载到 `model-hub/artifacts/<date>/<id>.<ext>`，单个大小上限与保留天数写进 registry；不做无界累积。

「一把 key 原则」仍然成立：百炼同时覆盖图像（`qwen-image`/`wanx`）、全模态（`qwen-omni`）与视频（`wanx` 异步任务），所以**接全之后，用户依然只需要 `DASHSCOPE_API_KEY`**。MOSS 家族见 §6.5。

## 4. 网关：现在不做，但要留接口

### 4.1 为什么现在不做

- 我们只有 **DSH 一个调用方**，而 DSH 已经能吃 `openai-completions`，chat 直连即可；多一跳只增加延迟与故障面。
- 非 chat 能力（asr/tts/embedding）的调用方是**我们自己的插件**，加一个 adapter 是一次性成本；网关省下的是「以后可能出现的第二个调用方」，属于「假想的未来灵活性」。
- 网关要自己实现：鉴权、限流、超时、重试、流式透传、上传转发、脱敏日志、用量记账——按同类开源项目（One-API / LiteLLM）规模，至少 1.5k 行 + 一套运维。

### 4.2 何时升级（触发条件，写死避免事后合理化）

- **T1**：同一能力需要「主挂自动切备」且**调用方不想改**（例如外部工具直接打 `baseURL`）。
- **T2**：出现 DSH 之外的调用方（手机端、脚本、IM 桥接进程）。
- **T3**：需要统一审计/配额/计费对账（多把 key 已多到人工数不清）。

### 4.3 如果要做

形态：hub 的可选 listener（同一个包、`gateway.enabled: false` 默认关），只实现三个端点：
`POST /v1/chat/completions`（透传 + 降级）、`POST /v1/embeddings`（归一 OpenAI 形状）、`POST /v1/audio/transcriptions`（归一）。
**不自建 UI、不自建计费、不代理图像/视频**（异步任务会让透传逻辑爆炸）。绑 `127.0.0.1` + 单独 token，绝不监听 0.0.0.0。

## 5. 落地阶段

| 阶段 | 内容 | 代价 | 验收 |
| --- | --- | --- | --- |
| **M0** | 只做 `registry.json` + 面板「接入点 / 凭据状态 / 能力矩阵」三块；不碰 chat | 1.5–2 人日 | **只填百炼一把 key 时，四项能力全绿**；主设置里填过的 key 在面板显示「已配置（来自设置）」，不重复要求；面板内联填的 key 在设置→模型的同 ref 上也能看到 `configured` |
| **M1** | `resolve` 面 + asr 插件加 `hub` 引擎（含 `dashscope-asr` 原生 adapter）；降级链（百炼→硅基流动→本地） | 2–3 人日 | 同一段 wav 走三条链路都有结果；主链路超时自动落到本地 |
| **M2** | voice 外部线路（`dashscope-tts` 主线 + 硅基流动 OpenAI 形状备线）+ 决策模型客户端（`systemone`） | 3–5 人日 | Live2D 用百炼音色说一句话；切到硅基流动，同一句仍能出 wav 并播放 |
| M3（条件） | 向量：百炼 `qwen3.7-text-embedding@512` + 384→512 迁移 | 3–5 人日 | 20 条中文 query 召回对照测，NDCG/命中率优于本地再谈迁移 |
| M4（条件） | 图像 / 全模态 / 视频接线：`image.generate`、`image.edit`、`omni.understand`、`video.generate`（异步任务簿 + 产物上限） | 4–6 人日 | 一句话生成一张图并落到 artifacts；一段 10 秒视频能查到任务完成；一段录音能被 omni 转成文字 |
| M5（条件） | 网关 listener | 5–8 人日 | 仅在 T1/T2/T3 出现时启动 |

## 6. 风险

1. **合规**：Token Plan 个人版「仅限编程/智能体工具中交互式使用，不可用于自动化脚本或应用后端」。中控台把它的能力供给 ASR/TTS 属于灰区；真正跑后台任务的应指向百炼按量 key。**这一点要在面板上标出来，不能默认静默混用。**
2. **数据授权**：Token Plan 个人版声明输入与生成内容用于服务改进；团队版不训练。个人陪伴对话不应路由到个人版——建议在绑定里给「私密会话」留一条显式例外（走本地或团队版）。
3. **三把钥匙**：`sk-sp-` / `sk-ws-` / MiniMax 订阅 Key 不能混用，且各自额度独立。中控台必须在接入点上标 `kind`，错误组合要在连通性测试里立刻报出来（401 是最常见的坑）。
4. **额度窗口**：MiniMax 是 5 小时 + 周双窗口，Token Plan 是月 Credits。中控台若做「剩余额度」展示，必须显示窗口语义（「本 5 小时窗口剩余 62%」），否则会被误读成「本月还剩这么多」。
5. **凭据入口重复**：主设置与中控台都能填 key。两边必须写同一 ref、读同一 `describe` 状态，否则会出现「这里显示没配对，那里显示已配对」。这也是把 chat 排除在外的理由之一：chat 的 provider 行由主设置独占，中控台不参与。
6. **单点**：registry 是文件，能力解析失败会直接表现为「ASR/TTS 不可用」，不会连带影响 chat。面板要显示 hub 自身健康状态。
7. **硅基流动托管的是第三方模型**：`SenseVoiceSmall`、`CosyVoice2-0.5B` 等上下线由平台决定（接口文档自己也写明「会定期变更，包括模型下线」）。绑定里必须永远保留本地 `sensevoice` 作为最后一跳，否则平台下线会直接把语音功能打掉。另外它的数据流向也是一家第三方，私密音频同样适用 D3。
8. **百炼单点**：主链路全押百炼后，除 ASR 有本地 `sensevoice` 兜底外，TTS/向量/重排都没有本地等价物——百炼限流或下架某个模型，功能就直接退化。保留硅基流动备线的意义在这里，不在价格。

## 6.5 MOSS 家族与 MOSS-Live：接不接

看了 [moss.cn/en/models/moss-live](https://www.moss.cn/en/models/moss-live)（上海模思智能，OpenMOSS 系）。

**MOSS-Live 是什么**：全双工实时交互**系统**——前台模型边听边说，后台模型异步推理/调工具，两者共享记忆与任务状态；支持语义打断（能分清真打断、附和、思考停顿）、多人对话中判断「这句话是不是对我说的」、实时视听理解、流式同传、以及按条件主动介入。评测口径里它在 FDB v1–v3 的全双工指标排第一，FDB v3 工具调用成功率 51%（并列最高），τ-Voice 多轮任务 57.93%（第二）。

**判断：本体不接，子模型可选。**

1. **MOSS-Live 不是「能力接缝」，是 session 级协议**：双向音频流 + 视频帧 + 打断语义 + 前后台任务协调，属于「实时语音会话产品」。接它等于另起一个语音管线项目，和 hub「一次请求换一次结果」的定位是两层。它真正对标的是 `qwen-audio-realtime`，也就是我们已判定「暂不做」的那一项（要 WS 音频管线 + 回声消除）。
2. **它的子模型才是可适配的能力**：`MOSS-Transcribe-Diarize`（带说话人分离的转写）、`MOSS-TTS` / `MOSS-TTS-Realtime` / `MOSS-VoiceGenerator`（音色克隆）、`MOSS-Image`（文生图）、`MOSS-SoundEffect`、`MOSS-VL` / `MOSS-VL-Realtime`、`MOSS-TTSD`、`MOVA`。这些都是一问一答形状，能直接挂到 `asr` / `tts` / `image.generate` 绑定上。
3. **它有一个别人没有的属性：开源权重**（OpenMOSS 在 GitHub 有实现）。这是唯一能对抗「百炼单点」的东西——把 `MOSS-TTS` 或转写模型跑在本机，就重新有了本地兜底；阿里、硅基流动、MiniMax 都做不到这一点。
4. **但顺序不能反**：它的 API 形状、价格、可用性都还没核（`platform.moss.cn` 需登录），现在接就是「先建后猜」。等百炼一条链跑通、且确实出现「TTS/向量没有本地兜底」的焦虑时，再评估 MOSS 的开源权重自托管——那比接它的云 API 更符合我们的风险结构。

一句话：**记进候选，不进 M1–M4 的路径。**

## 7. 未验证

1. 第三方插件能否直接调 `ctx.remote.credentials.set/describe`（`remote` 是 BFF 通道；插件服务端可能只能用 `ctx.credentials`）。两条路都试一次，取通的那条。
2. `ctx.credentials.describe` 返回的 `source` 在 `env` 与 `dotenv` 两种来源下是否足以让面板说清「在哪里配的」。
3. MiniMax 的 OpenAI 兼容 baseURL 与 M Plan 订阅 Key 是否同一端点（文档给的是 `platform.minimaxi.com` 与 `platform.minimax.cn` 两个域，需按控制台确认）。
4. 三家向量**都提供 512/1024，都不提供 384**（百炼 `qwen3.7-text-embedding` 256/512/768/1024；硅基流动 Qwen3-Embedding 64/128/256/512/768/1024）。mempalace 的 `EMBEDDING_DIM = 384` 硬编码必须改，且要选 256（省空间、贴近现状）或 512（质量更好）——对照测之后定。
5. 硅基流动语音与向量的**实际单价**（未抓到价格表）；`CosyVoice2-0.5B` 在 `/v1/audio/speech` 上的可用音色名与克隆流程；`SenseVoiceSmall` 的语种与标点表现。
6. 百炼 ASR 是否也提供 OpenAI 形状的 `/compatible-mode/v1/audio/transcriptions`（本仓库早前调研说是，需实测确认），否则百炼要走 DashScope 原生 adapter。
7. MiniMax 的 OpenAI 兼容 baseURL 与 M Plan 订阅 Key 是否同一端点（文档给的是 `platform.minimaxi.com` 与 `platform.minimax.cn` 两个域，需按控制台确认）。
8. Token Plan 决策模型在非 Responses 调用方式下的额度行为（免费是否长期）。
9. 面板能否读到任何一家的「剩余额度」（四家都未见公开余额 API；硅基流动有 `/v1/models` 但没有余额接口）。
10. 百炼图像/全模态/视频的确切模型 id 与形状：`qwen-image` 系列是同步还是异步任务、`wanx` 视频的 submit/poll 路径、`qwen-omni` 能否直接吃百炼 OSS URL 与本地上传。
11. MOSS 家族（`platform.moss.cn`）的 API 形状、鉴权、价格与限流——页面全是要登录的，未核；开源权重（OpenMOSS）能否在本机跑到可用速度也未测。

## 8. 待用户决策

- **D1**：中控台先做 M0（1.5–2 天，registry + 面板 + 凭据联动），还是先手工把 4 个能力接进各插件、面板推后？
- **D2**：ASR/TTS 的「主」定百炼按量还是 Token Plan 的 3.0？（质量 vs 免费额度）
- **D3**：是否接受「私密会话强制走本地/团队版」这条策略？
- **D4**：向量迁移（384→512）是否现在做对照测，还是等 M1 完成后再看？

## 9. 参考

- 千问 Token Plan 个人版模型清单：<https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-overview>
- Token Plan 接入概览（多模态端点）：<https://platform.qianwenai.com/docs/token-plan/best-practices/integration-overview>
- 决策模型接入：<https://platform.qianwenai.com/docs/token-plan/best-practices/decision-model>
- DSH 官方接入指南：<https://platform.qianwenai.com/docs/developer-guides/clients-and-developer-tools/deepseek-harness>
- MiniMax M Plan 概览（可用模型/额度）：<https://platform.minimax.cn/docs/m-plan/intro>
- MiniMax M Plan 用量规则（双窗口）：<https://platform.minimax.cn/docs/m-plan/usage-rules>
- MiniMax API 概览（无 ASR 的旁证）：<https://platform.minimax.cn/docs/api-reference/api-overview>
- 硅基流动：<https://docs.siliconflow.cn/docs/api/embeddings-post>（向量）、<https://docs.siliconflow.cn/docs/api/rerank-post>（重排）
- MOSS-Live：<https://www.moss.cn/en/models/moss-live>；模型家族：<https://www.moss.cn/en/models/moss-transcribe-diarize> 等；开源实现：<https://github.com/OpenMOSS>
- 仓库内：`deepseek-harness/packages/credentials/credentials-local/src/index.ts`（`resolve/describe/set/unset/listRecords`）、`deepseek-harness/packages/client/ui-settings-models/src/client/operations.ts:79`（主设置的 key 写入）、`plugins/asr/src/engine-registry.mjs`、`docs/architecture.md` §6.1
