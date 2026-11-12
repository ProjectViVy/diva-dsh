# 千问AI平台（platform.qianwenai.com）选型评估：我们该接哪些模型

- 日期：2026-11-11
- 触发：用户给出 <https://platform.qianwenai.com/docs/developer-guides/getting-started/introduction>
- 范围：只做选型与代价判断，**不写代码、不改配置、不申请 key、不充值**
- 口径：能不能接、接在哪、值不值得、代价多少；价格以文档页原价为准，落地前以控制台为准
- 关系：本文是 [`omni-modal-external-providers.md`](omni-modal-external-providers.md) 的**续篇**。那篇评的是阿里云百炼（`dashscope.aliyuncs.com`）与硅基流动；这篇评的是**另一套端点**（`maas.qianwenaiapi.com`），五条接缝的结论可复用，但 key、端点、账单**不互通**。

## 0. 结论

**这个平台能力面比百炼更宽，但对我们真正稀缺的只有四样：能看图的对话主干、云端语音识别、音视频理解、以及一条能替代已损坏 `web_search` 的内置联网搜索。** 其余（图像/视频/3D/数字人/音乐/翻译/角色扮演）都不该现在接。

> **2026-11-11 06:16 修订**：用户已持有 Token Plan 并决定接入。§0–§9 是「按量付费」口径；
> **订阅口径的模型清单、端点差异与风险见 §10**——那里有几个结论会覆盖本表（尤其是「别买 Token Plan」作废、
> 决策模型免费、向量模型不在套餐内）。

| 优先级 | 接什么 | 模型 | 落点 | 工作量 | 判断 |
| --- | --- | --- | --- | --- | --- |
| **P0** | 对话/视觉主干 + 内置联网搜索 | `qwen3.8-flash`（兜底 `qwen3.7-plus`） | `llm-pi-ai.providers` 新增一条路由 | 0.5 人日 | **先做**，只改配置，一次性验证 key / 网络 / 看图 / 检索 |
| **P1** | 云端语音识别 | `qwen-audio-3.1-asr-flash`（OpenAI 兼容档用 `qwen3-asr-flash`） | `plugins/asr` 新增 `openai-asr` 引擎 | 1–2 人日 | **第二做**，接缝本来就为云端预留；本地 SenseVoice 留作默认兜底 |
| **P2** | 音视频内容理解 | `qwen3.8-omni-flash` | 新工具插件（`media_understand`） | 2–3 人日 | 有明确需求再做；**不要动 harness 模态词表** |
| **P2** | 语音合成 / 声音复刻 | `qwen-audio-3.1-tts-flash` + `voice-enrollment` | `plugins/voice` 新增外部线路 | 2–3 人日 | 只有「确定要换音色」才做；现在 voxd 是可用的 |
| **P3（暂缓）** | 记忆向量 / 重排 | `qwen3.7-text-embedding-flash` + `qwen3-rerank` | `dsh-mempalace` 的 `EmbeddingService` | 3–5 人日 | **卡在 384 维硬约束**与「全量记忆外发」两件事上；曾被叫停一次，先拿中文召回实测说话 |
| 不接 | 图像/视频/3D/数字人/音乐/翻译/GUI-Plus/Deep Research | — | — | — | 与「陪伴型持久 Agent」的主链无关，或成本/合规不划算 |

一句话取舍：**P0 用来验证「这家能不能长期用」，P1 用来解决真痛点，其余等需求逼到眼前再说。**

## 1. 平台事实（2026-11-11 核实）

| 项 | 事实 | 出处 |
| --- | --- | --- |
| 纯文本/多模态对话端点 | `https://maas.qianwenaiapi.com/compatible-mode/v1`（OpenAI 兼容）；另有 Anthropic 兼容、Responses、DashScope 原生四套协议 | 文档「获取 API Key」「OpenAI Chat」 |
| 两套 key 不互通 | 按量付费 `sk-ws-`（早期 `sk-`）走按量端点；Token Plan `sk-sp-` 走套餐专属端点，**不能混用**，套餐也不抵扣按量账单 | 文档「获取 API Key」FAQ |
| 免费额度 | 每个模型独立约 100 万 token，90 天；**只抵扣实时推理**，不含批量与内置工具 | 文档「免费额度」 |
| 模型代际 | 文本已到 Qwen3.8（`qwen3.8-max` / `qwen3.8-flash` / `qwen3.8-2.4t-a95b`），3.7/3.6/3.5 仍在售 | 文档「文本生成与视觉理解」 |
| 第三方直供 | 同一 key 可调 `deepseek-v4.1-flash`、`glm-5.3`、`kimi-k3`、`MiniMax-M3.1-Flash` 等；含 `/` 的模型需先在控制台开通 | 文档「模型价格」「第三方模型」 |
| 合规 | 算法备案与大模型备案齐全（含通义、DeepSeek、GLM、Moonshot 等） | 文档「模型备案信息公示」 |

**关键差异（相对百炼）**：模型 ID 几乎同名（`qwen3-asr-flash`、`text-embedding-v4`、`cosyvoice-v3.5` 都在），但 base_url、key 前缀、账单、额度体系是另一套。**两份文档不能混抄**，配置里要显式写端点。

## 2. 我们现在的接缝（决定「能接多快」）

| 接缝 | 现状 | 加一个云端模型要动什么 |
| --- | --- | --- |
| `llm-pi-ai.providers` | 只有一条 `opendesign`（`openai-responses`，`deepseek-v4.1-flash`） | 加一段 YAML + 一条 `apiKeyEnv`；**零代码** |
| `plugins/asr` 引擎注册表 | 只有本地 `sensevoice`（`engine-registry.mjs` 五件事契约） | 新文件 `engine-openai-asr.mjs`，面板自动列出 |
| `plugins/voice` TTS | 只认 voxd 的 `POST /v1/speak/file`（返回 wav + `X-Duration-Ms`） | **协议不通**，要新增外部线路客户端 |
| `dsh-mempalace` 向量 | `Xenova/all-MiniLM-L6-v2`，**384 维写死**（`store/memory_store.mjs:69-70` 直接抛错），无 provider 抽象 | 维度可配 + vec 表重建 + 全量回填 + 失败降级 |
| 凭据面 | `dsh-credentials-local` → `<DSH_HOME>/.credentials.yaml`，`apiKeyEnv` 引用 | 一个 key 多处复用，禁止散落 |
| 联网检索 | `web_search` 工具今天实测报错：`no API key for "DEEPSEEK_API_KEY"` | 平台侧 `enable_search` 可绕过，但**是另一条计费** |

## 3. 逐能力评估

### 3.1 对话主干：`qwen3.8-flash`（P0）

| 模型 | 上下文/输出 | 价格（元/百万 token，进/出） | 备注 |
| --- | --- | --- | --- |
| `qwen3.8-max` | 1M / 128k | 12 / 36 | 旗舰，2.4T MoE；只在难任务上开 |
| `qwen3.8-flash` | 1M / 128k | **0.8 / 2.7** | 缓存命中 0.1；图像/视频输入、函数调用、结构化输出、联网搜索全有 |
| `qwen3.7-plus` | 1M / 64k | 2 / 8（≤256k） | 视觉-语言 + GUI 能力更强 |
| `qwen3.5-flash` | 1M / 64k | 0.2 / 2 | 更便宜，能力弱一档 |
| `qwen-flash` | 1M / 32k | 0.15 / 1.5 | 老一代，仅成本敏感场景 |

对我们的价值不在「比 DeepSeek 强」，而在三件本地主链没有的事：

1. **原生图像/视频输入**（DSH chat 模态只有 `text | image`，视频进不来对话，但图片可以）。
2. **内置联网搜索**（`enable_search`）——今天 `web_search` 就是因为缺 key 而不可用，这条能在不引入新 key 的情况下补上「查实时信息」。
3. **一条便宜的第二路由**：主路由挂了能切；也方便做 A/B（同一提示词两家跑）。

**代价**：0.5 人日，纯配置。**风险**：内置搜索与「外部搜索工具」重复计费，只能二选一，别两条都开。

### 3.2 语音识别：`qwen-audio-3.1-asr-flash`（P1）

| 档 | 模型 | 形态 | 限制 | 价格 |
| --- | --- | --- | --- | --- |
| 短音频（主力） | `qwen-audio-3.1-asr-flash` | HTTP，URL/Base64 | ≤5 分钟 / 2GB，**支持说话人分离** | 0.8 / 2.7（元/M token） |
| OpenAI 兼容档 | `qwen3-asr-flash` | HTTP **OpenAI 兼容** | ≤5 分钟 / 10MB，情感识别 | 同上 |
| 长音频 | `qwen-audio-3.1-asr-flash-filetrans` | HTTP 异步 | ≤12 小时 / 2GB | 控制台 |
| 实时 | `qwen-audio-3.1-asr-flash-streaming` | WebSocket | 音频流式，热词 + Prompt 上下文 | 控制台 |

推荐 `qwen-audio-3.1-asr-flash`：中文方言覆盖最全（含粤语、吴语、闽南语、客家话及各官话口音），短语音一次请求就够，正好对上 IM 语音消息与输入框麦克风两种入口。`qwen3-asr-flash` 留作「只想要 OpenAI 形状」时的替代。

**为什么值得**：本地 SenseVoice 在噪声、方言、专有名词上会掉字；云端按 token 计费，日常量级是「角」级。
**代价**：1–2 人日（新引擎 + 测试替身）。**保留本地兜底**，断网不等于哑巴。

### 3.3 音视频理解：`qwen3.8-omni-flash`（P2）

`qwen3.8-omni-flash`：输入文本/图片/音频/视频 → 输出文本，1M 上下文，113 种语言方言，`use_multichannel` 可开空间音频，价格 0.8 / 2.7（元/M token）。

它是**唯一**能回答「这段视频/录音里发生了什么」的路径，因为 DSH 的对话路由永远只接受 `text | image`。正确做法是写一个工具（`media_understand({ path | url, question })`），把音视频作为内容块传给 omni，把结果作为工具结果落进会话——不扩模态词表。

**边界**：能做内容理解/情绪/摘要，**不能**做听歌识曲（那是指纹检索，得另接服务）。
**代价**：2–3 人日。**注意**：omni 的音频输入与单独 ASR 是两条计费路径，同一段语音别既转写又理解。

### 3.4 语音合成 / 声音复刻（P2）

| 模型 | 定位 | 自定义音色 | 指令控制 |
| --- | --- | --- | --- |
| `qwen-audio-3.1-tts-flash` | 实时交互、低延迟 | 复刻 + 设计 | ✓（情感/语速/风格） |
| `qwen-audio-3.1-tts-plus` | 有声书、配音，音质优先 | 复刻 + 设计 | ✓ |
| `cosyvoice-v3.5-plus/flash` | 音色库丰富，质量高 | 复刻 + 设计 | ✓ |
| `qwen3-tts-flash` | 低延迟流式 | **仅系统音色** | — |
| `voice-enrollment` | 声音复刻：10–20 秒样本生成定制音色 | — | — |

对我们真正的诱惑是 **`voice-enrollment`**：给 Live2D 角色一个固定、专属的音色，而不是在系统音色里挑一个像的。

**但代价最高**：`plugins/voice` 只认 voxd 协议（`POST /v1/speak/file`、wav、24kHz、`X-Duration-Ms`），云端 TTS 是「WebSocket/HTTP + 多格式 + 需实测采样率」。要么在插件里加外部线路客户端，要么起本地适配进程（长期多一个常驻进程，不划算）。**结论：不急，等「音色」成为明确需求再做。**

### 3.5 向量与重排（P3，暂缓）

| 模型 | 维度 | 上下文 | 价格（元/M token） |
| --- | --- | --- | --- |
| `qwen3.7-text-embedding-flash` | 256 / 512 / 768 / 1024（默认 1024） | 128k，201 种语言 | **0.125** |
| `qwen3.7-text-embedding` | 256…2560 | 128k | 更高（控制台） |
| `text-embedding-v4` | 64…2048 | 33k | — |
| `qwen3.7-text-rerank` | 文本重排，500 文档 / 30k token | — | — |

**这是唯一能治「中文语义检索不稳」的药**（本地 MiniLM 是多语言小模型，中文长尾召回确实弱）。但没有一个维度是 384：

- `memory_store.mjs` 硬校验 `embeddingDim === 384`，改维度就要**重建 `vec_memories` 虚表 + 全量回填 + 旧库迁移**；
- 走 API 意味着**全部记忆文本外发**，这与「记忆本地优先」的架构取向冲突；
- 用户此前已就「向量 API」叫停过一次（见记忆卡 2026-11-10）。

**因此：先拿 20 条中文 query 做召回对照测（本地 vs flash），测不出差距就不动。** 若真要动，最省的做法是 `qwen3.7-text-embedding-flash` @ 512 维 + `qwen3-rerank` 二段重排，并且把「外发」写进显式开关而不是默认值。

### 3.6 刻意不接的

| 能力 | 模型 | 为什么不接 |
| --- | --- | --- |
| 图像生成 / 编辑 | `qwen-image`、`wan2.7/2.6`、`z-image` | Live2D 是预渲染资产，生成图进不了骨骼；真要做封面/表情包再说 |
| 视频生成 / 数字人 | `wan*-t2v`、`emo`、`liveportrait`、`animate-anyone` | 与实时舞台冲突（我们已有 Live2D 渲染链） |
| 3D / 世界模型 | Tripo、HappyOyster | 无场景 |
| 音乐生成 | Fun-Music | 无场景 |
| 翻译 | `qwen-mt-*`、`livetranslate` | 主链中文为主；真要跨语言，聊天模型够用 |
| 角色扮演 | `qwen-plus-character`（32k，无函数调用）、`qwen-flash-character-2026-02-26`（262k） | 听上去最像「陪伴」，但它**不能调工具**，接进来只能当纯聊天分支；我们的陪伴是「有手的 Agent」，降级成话痨是退步。等真有「只想闲聊、不干活」的入口再评 |
| OCR / GUI | `qwen3.5-ocr`、`gui-plus` | 等桌面操控（GUI Agent）需求立项再评 |
| 深度研究 | `qwen-deep-research`（54 / 163 元/M） | 贵两个数量级；我们的「主动探索」走工具 + 搜索更省 |

## 4. 成本估算（按日常量级，单位人民币）

| 项 | 假设 | 估算 |
| --- | --- | --- |
| 对话（flash） | 每天 50 轮、每轮 3k 进 / 500 出 | ≈ 4.5M 进 / 0.75M 出每月 → **≈ ¥6/月** |
| 对话（plus） | 同上 | ≈ ¥17/月 |
| 视觉（每张图） | 1600 万像素上限，按 `h×w/1024 + 2` 计 | 单张约 1–2k token → 角级 |
| ASR | 文档按 token 计费，**未给音频 token 折算率** | 待实测（百炼口径约 ¥0.79/小时音频，可作上限参考） |
| 向量（全量重建） | 10M token | **≈ ¥1.25**（一次性） |
| TTS | 文档未给 `qwen-audio-3.1-tts-flash` 单价 | 待查控制台 |
| omni | 音视频按 token | 待控制台 |

结论：**这个平台在我们这个量级上不是成本问题，是「愿不愿意多一个依赖」的问题。** 唯一需要注意的是内置联网搜索与批量接口不走免费额度。

## 5. 风险与坑

1. **双平台同名**：百炼（`dashscope.aliyuncs.com`）与本平台（`maas.qianwenaiapi.com`）模型 ID 高度重合，key 与账单完全不同；配置里必须显式写端点，别靠默认值。
2. **双 key 体系**：`sk-sp-`（Token Plan）与 `sk-ws-`（按量）不互通。我们这种低频按量场景**不要买 Token Plan**，否则等于两套对账。
3. **免费额度陷阱**：每模型 100 万 token 且只覆盖实时推理；用它做长跑基准会突然开始扣费。建议先开「额度用尽即停」。
4. **模型生命周期**：`latest` 与日期快照是不同模型、各自计费与额度。配置里写快照（可复现）还是别名（自动升级）要一次定死。
5. **隐私**：语音、图片、视频上云；向量方案更是「全部记忆文本外发」。必须逐项显式同意，不能默认开。
6. **重复计费**：内置 `enable_search` 与外部 `web_search` 工具、omni 音频输入与独立 ASR，都是「两条路同一件事」，只能选一条。
7. **限流**：`qwen3.8-max` 走动态限流（按消费档位给 TPM）；`qwen-audio-3.1-asr-flash` RPM 600。批量转写要排队而非并发轰炸。

## 6. 推荐路线（多·快·好·省）

**最简方案：P0 → P1，两刀。** 都不改架构，只复用既有接缝：

1. **P0（0.5d）**：`llm-pi-ai.providers` 加 `qwen` 路由（`api: openai-completions`、`baseURL: https://maas.qianwenaiapi.com/compatible-mode/v1`、`apiKeyEnv: QWEN_API_KEY`），模型填 `qwen3.8-flash`；一次最小验证：纯文本、带图、`enable_search` 各一次。**这一步同时回答「这家能不能长期用」与「要不要留这条备用路由」。**
2. **P1（1–2d）**：`plugins/asr` 加 `openai-asr` 引擎（`baseURL + model + apiKeyEnv` 三参数区分供应商），默认仍 `sensevoice`；用一段带方言/噪声的 wav 做 A/B，能量化再决定是否改默认。

**备选：只做 P0。** 如果你现在的痛点是「检索坏了」而不是「语音不准」，那把 P0 的 `enable_search` 先接上、ASR 继续用本地，投入 0.5 天就能结束本轮。

**不做**：P2 的 TTS/omni 与 P3 的向量，除非出现具体场景（换音色、要理解视频、中文召回被实测证明不达标）。理由：它们都要改插件内部实现或数据 schema，回归面比「加一段 YAML」大一个量级，而收益尚未被任何一次实测证明。

**依据**：先做单位成本最低、可逆性最强的两件事，用真实账单与延迟回答「值不值得继续」；把「要不要换音色/换向量引擎」这类一次性重决策留到有对照数据之后。

## 7. 未验证

1. `qwen3.8-flash` 在本机网络下的真实延迟与首 token 时间（未申请 key）。
2. `enable_search` 的实际检索质量，以及它与外部搜索工具的成本对比。
3. ASR 的音频 token 折算率（文档只给 token 单价，没给「每小时音频 = 多少 token」）。
4. `qwen-audio-3.1-tts-flash` 的单价与返回音频的格式/采样率（直接影响 `wavDurationMs` 与现有缓存逻辑）。
5. omni 音视频理解的单价与长视频延迟。
6. 本地 SenseVoice 与 `qwen-audio-3.1-asr-flash` 在真实语音消息上的字错率差距（需同一批音频对照）。
7. 本平台是否支持 DSH 现有 `openai-responses` 之外的 `openai-completions` 图像消息形状（需一次 curl 验证）。

## 8. 待用户决策

- **D1**：只做 P0（0.5 天，验证 + 顺手补联网搜索），还是 P0+P1（再加云端 ASR）？
- **D2**：对话主干用 `qwen3.8-flash`（0.8/2.7，便宜）还是 `qwen3.7-plus`（2/8，看图/GUI 更强）？还是两条都配、按任务切？
- **D3**：语音识别要不要改默认引擎，还是「云端只做手动切换、默认仍本地」？
- **D4**：向量/重排是否同意先做「20 条中文 query 召回对照测」再决定（**不先改代码**）？

## 9. 参考


- 平台概览：<https://platform.qianwenai.com/docs/developer-guides/getting-started/introduction>
- 获取 API Key（端点与双 key）：<https://platform.qianwenai.com/docs/api-reference/preparation/api-key>
- 文本生成与视觉理解（模型/上下文/功能矩阵）：<https://platform.qianwenai.com/docs/developer-guides/getting-started/text-generation-models>
- 模型价格总表：<https://platform.qianwenai.com/docs/developer-guides/getting-started/model-prices>
- 语音识别选型：<https://platform.qianwenai.com/docs/developer-guides/speech/speech-to-text-models>
- 语音合成选型：<https://platform.qianwenai.com/docs/developer-guides/speech/tts-models>
- 向量与重排选型：<https://platform.qianwenai.com/docs/developer-guides/getting-started/embedding-models>
- `qwen3.8-flash` 单价：<https://platform.qianwenai.com/docs/models/qwen3-8-flash>
- `qwen3.8-max` 单价：<https://platform.qianwenai.com/docs/models/qwen3-8-max>
- `qwen3.8-omni-flash`：<https://platform.qianwenai.com/docs/models/qwen3-8-omni-flash>
- `qwen3.7-text-embedding-flash`：<https://platform.qianwenai.com/docs/models/qwen3-7-text-embedding-flash>
- `qwen-audio-3.1-asr-flash`：<https://platform.qianwenai.com/docs/models/qwen-audio-3-1-asr-flash>
- 角色扮演：<https://platform.qianwenai.com/docs/developer-guides/text-generation/role-playing>
- 免费额度：<https://platform.qianwenai.com/docs/resources/free-quota>
- 仓库内：`.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml`、`plugins/asr/src/engine-registry.mjs`、`plugins/voice/src/voice-tts.js`、`plugins/dsh-mempalace/src/store/memory_store.mjs`、`docs/research/omni-modal-external-providers.md`

---

## 10. Token Plan 口径（2026-11-11 06:16 追加）

前提变化：用户**已持有 Token Plan 个人版**并决定接入。本节按订阅口径重写选型，覆盖 §0 的按量结论。

### 10.1 先回答两个具体问题

| 问题 | 答案 | 依据 |
| --- | --- | --- |
| **向量模型在 Token Plan 里吗？** | **不在。** 个人版与团队版的模型清单里没有任何 embedding / rerank 模型 | 个人版、团队版「支持的模型」表逐行核对 |
| **决策模型在 Token Plan 里吗？** | **在，而且限时免费、不消耗 Credits** | 个人版模型清单列 `decision-model-preview`；概述页 Tip 明写「限时免费」 |

推论：**向量要走另一条按量 key（`sk-ws-`），决策模型不用额外花钱。**

### 10.2 套餐能给的能力（个人版，逐项核对）

| 能力 | 模型 | 备注 |
| --- | --- | --- |
| 文本 / 推理 | `auto`、`qwen3.8-max`、`qwen3.8-flash`、`qwen3.7-max`、`qwen3.7-plus`、`qwen3.6-flash` | `auto` 按内容自动匹配底层模型 |
| 第三方文本 | `glm-5.3`、`glm-5.2`、`deepseek-v4-pro`、`deepseek-v4-pro-0813`、`deepseek-v4-flash-0731`、`deepseek-v4.1-flash`、`deepseek-v4.1-flash-1017` | 与我们现有 `deepseek-v4.1-flash` 同名，可无缝对比 |
| 视觉理解 | `qwen3.8-max`、`qwen3.8-flash`、`qwen3.7-plus`、`qwen3.6-flash`、`deepseek-v4.1-flash(-1017)` | 图片进对话 |
| 语音合成 | `qwen-audio-3.0-tts-plus` | **只有 3.0 的 plus**，没有 `tts-flash` / `cosyvoice` |
| 语音识别 | `qwen-audio-3.0-asr-flash` | **只有 3.0，非实时**；没有 3.1、没有 `filetrans`、没有 `streaming` |
| 实时语音对话 | `qwen-audio-3.0-realtime-plus` | WebSocket |
| 图像生成 | `qwen-image-3.0-pro`、`wan2.7-image`、`wan2.7-image-pro` | — |
| 视频生成 | `wan3.0-video`、`happyhorse-1.1-t2v/i2v/r2v` | 异步，完成任务后集中结算 Credits |
| 决策 | `decision-model-preview` | 限时免费 |
| 内置工具（Responses API 自动触发） | `web_search`、`web_search_image`、`image_search`、`web_extractor`、`code_interpreter` | **按 Credits 抵扣**，不占免费额度 |

团队版另有 `kimi-k2.7-code / k2.6 / k2.5`、`glm-5.1 / 5`、`MiniMax-M2.5`、`qwen3.6-plus`、`qwen-image-2.0(-pro)`；**决策模型文档写明「仅支持个人版」**。

### 10.3 端点与协议（与按量不是同一套）

| 能力 | 端点 | 协议形状 |
| --- | --- | --- |
| 文本 | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1` | OpenAI Chat Completions（`api: openai-completions`） |
| 文本（Anthropic 工具） | `https://token-plan.maas.qianwenaiapi.com/apps/anthropic` | Anthropic Messages |
| 决策 | `POST /compatible-mode/v1/systemone` | TypeSafe System One（`state` + `questions`） |
| 语音识别 | `POST /api/v1/services/aigc/multimodal-generation/generation` | DashScope：`input.messages[].content[].input_audio`，**不是** OpenAI `/audio/transcriptions` |
| 语音合成 | `/api/v1/services/audio/tts/SpeechSynthesizer` | DashScope |
| 图像生成 | `/api/v1/services/aigc/multimodal-generation/generation` | DashScope |
| 视频生成 | 提交 `/api/v1/services/aigc/video-generation/video-synthesis`，查询 `/api/v1/tasks/{id}` | 异步轮询 |
| 实时语音 | `wss://token-plan.maas.qianwenaiapi.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-plus` | WebSocket |

key 必须是 `sk-sp-`。**注意**：`token-plan.maas.qianwenaiapi.com` 与按量的 `maas.qianwenaiapi.com` 是两个主机名，配错直接 401。

### 10.4 决策模型：这次真能用，而且免费

`decision-model-preview` 是 TypeSafe System One 分类器：一次前向，带 `questions`（`choice` / `noul` / `score` 三种）返回

```json
{"answers":{"c1":{"type":"choice","choice":"spam","confidence":0.94,"probabilities":{"spam":0.94,"pass":0.06}}},
 "usage":{"input_tokens":125},"latency_ms":52.9}
```

不生成文本，所以**延迟与成本跟输出长度无关**（示例 52.9 ms）。限制：问题数 ≤16、`choice` 选项 ≤255、`score` 等级 2–255、上下文 64k；不支持流式 / Function Calling / 联网搜索。

对我们的四个落点（按价值排序）：

1. **Superagent 路由**：一条 ticket 该进哪个 agent / 哪个来源，用 `choice` + `confidence` 阈值分流，比让对话模型「顺手判一下」稳。
2. **Evolution 候选判定**：skill/persona 候选「该提升 / 该压回 / 该问人」，`confidence < 阈值` 就转人工，正好接现有的审批面板。
3. **MemPalace 归档归类**：proposal/decision/incident 该进哪个 room，`choice` 直接给答案。
4. **Live2D JEV**：`docs/research/live2d-jev-two-paths.md` 的结论是「缺决策消费端」；现在免费给了 System One 协议模型，pi-ai 本身自带 `typesafe-system-one` 分类器，**只差一个薄消费端**。

风险：`-preview` 且「限时免费」，不能做长期唯一依赖；免费期结束自动转 Credits 计费。

### 10.5 官方已经写了 DSH 的接入方式

文档「DeepSeek Harness」页直接给出了 `cordis.patch.yml` 片段（与本仓库结构一致）：

```yaml
- id: llm-pi-ai
  config:
    providers:
      qianwen-token-plan:
        apiKeyEnv: DASHSCOPE_API_KEY
        api: openai-completions
        baseURL: https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1
        models:
          - id: auto
          - id: qwen3.8-flash
          - id: qwen3.7-plus
          - id: deepseek-v4.1-flash
```

两个坑：① 该端点**不提供 `GET /models`**，UI 里点「Fetch available models」会 401/404，模型 ID 只能手填；
② 新增 provider 必须重启 DSH 才在模型选择器里出现。

### 10.6 必须知道的六条限制

1. **使用范围（最关键）**：套餐「仅限在编程工具和智能体工具中交互式使用，不可用于自动化脚本、自定义应用程序后端或任何非交互式批量调用」。DSH 本身在官方工具列表里，**交互式使用没问题**；但 IM 网关的定时轮询、主动探索、批量归档属于灰区，可能被判违规封 key。
2. **个人版数据授权**：使用期间「模型输入及生成内容将用于服务改进与模型优化」；团队版才明确不训练。→ **私密陪伴对话与个人记忆不要走个人版**。这条比「向量上不上云」更硬。
3. **并发**：Lite 1–2 / Essential 2–3 / Standard 3–4 / Pro 6–8 个 Agent。DSH 多会话并发会撞上限。
4. **代际落差**：ASR 只有 3.0（3.1 的说话人分离、更多方言不在清单）；TTS 只有 `tts-plus`（不是低延迟的 `tts-flash`）。§3.2/§3.4 里按 3.1 做的估算要下调。
5. **夜间折扣**：22:00–08:00，`qwen3.8-max/flash` 4 折、deepseek 系 5 折。我们本来就活跃在深夜。
6. **Credits 不透明**：单次消耗由模型 / token / 思考模式 / 工具调用动态决定，只有控制台用量统计能看；多模态单次消耗显著高于文本。

### 10.7 修订后的路线

| 优先级 | 做什么 | 代价 | 说明 |
| --- | --- | --- | --- |
| **P0′** | 把 Token Plan 接进 DSH（照 §10.5 的官方 YAML） | 0.5 小时 | 一次验证三条：纯文本、带图、Responses 内置 `web_search` |
| **P1′** | 决策模型薄客户端（`systemone`） | 1 天 | 免费期最划算；先接 Superagent 路由这一处，不做通用框架 |
| P1″ | ASR 云端引擎 | 1–2 天 | 模型换成 `qwen-audio-3.0-asr-flash`，形状是 DashScope 而非 OpenAI，引擎名宜叫 `dashscope-asr` |
| P2′ | 图像/视频生成 | 2–3 天 | 只在做封面/表情包时接 |
| 暂缓 | 向量 / 重排 | — | **不在套餐**，要另开按量 key，且与 384 维 + 记忆外发冲突 |
| 不做 | realtime 语音对话 | — | 要 WS 音频管线 + 回声消除，投入远大于收益 |

一句话：**套餐已经把「对话 + 视觉 + 联网搜索 + 决策」四件事打包好了，P0′ 值得今天就做；向量仍然要单买，ASR 是 3.0 版、可用但不惊艳。**
