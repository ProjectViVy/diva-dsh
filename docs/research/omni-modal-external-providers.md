# 外置全模态 Provider 可行性：阿里云百炼 / 硅基流动

- 日期：2026-11-11
- 范围：只做可行性判断，**不写代码、不改配置、不申请 key**
- 结论口径：能不能接、接在哪、代价多少、风险在哪
- 官方资料核实日期：2026-11-11；价格随官方调整，落地前以控制台为准

## 0. 结论

**能接，但「全模态」必须拆成五条独立的接缝，不能指望一个 provider 配置全包。**

| 能力 | 接在哪 | 工作量 | 结论 |
| --- | --- | --- | --- |
| 文本 / 图片对话 | `llm-pi-ai` 的 `providers`（配置级） | 0.5 人日 | **先做这个**，零代码验证 key 与网络 |
| 语音识别（ASR） | `plugins/asr` 的引擎注册表 | 1–2 人日 | **第二做**，接缝最干净，成本约 ¥0.8/小时音频 |
| 语音合成（TTS） | `plugins/voice` 的 TTS 线路 | 2–3 人日 | 要做，但需新增外部线路客户端，不能只改 URL |
| 音频 / 视频进对话 | 新增媒体理解工具插件 | 2–3 人日 | **不要动 harness 模态词表**；用工具而非 chat 路由 |
| JEV 决策 | 独立决策客户端（pi-ai classifier 或自研） | 2–4 人日 | 两家都不是 JEV；真 JEV 仍走 TypeSafe / OpenRouter |

关键判断：

1. **DSH 的 chat 模态只有 `text | image`**（`packages/llm/llm/src/types.ts:230-237`），所以 `qwen3.8-omni-flash` 的「音频/视频输入」**进不了现有 LLM 路由**。硬扩词表要动类型、pi-ai 转换、投影与会话持久化，成本远高于写一个工具。
2. **ASR 是性价比最高的一刀**：`plugins/asr` 的引擎契约本就是为云端 HTTP 预留的（`src/engine-registry.mjs:1-15`），加一个 `openai-asr` 引擎即可同时吃百炼与硅基流动——两家的识别接口都是 OpenAI 形状。
3. **TTS 不能只配 endpoint**：`plugins/voice` 只认 voxd 的 `/v1/speak/file` 协议（`src/voice-tts.js:100-113`），云端语音包是火山引擎专用字段（`src/voice-packs.js:1203` 的 `appId/accessKey`）。换百炼/硅基流动要么在插件里加外部线路客户端，要么起一个本地适配进程；后者多一个常驻进程，不划算。
4. **JEV 与这两家无关**：百炼 `decision-model-preview` 与硅基流动 `/v1/systemone` 都是「结构化决策」协议，但都不是 OpenRouter 上那个 `typesafe/jev-1.14`。真 JEV 已有更近的路：pi-ai 自带 `typesafe-system-one` 分类器（模型 `jev-latest`，baseURL `https://api.typesafe.ai/v1/`），只是 DSH 还没挂分类器消费端。
5. **「视频音乐识别」要拆语义**：如果是「看懂视频/音频里发生了什么」→ 百炼 omni 可以做（Chat Completions 传音视频，出文本）；如果是「识别这是哪首歌」→ 两家都没有听歌识曲/指纹检索，需要 ACRCloud 这类专门服务或「omni 描述 + 联网搜索」的间接方案。

## 1. 现状：DSH 里已有的五个接缝

### 1.1 LLM 路由（可直接复用）

`@deepseek-ai/dsh-llm-pi-ai` 的 `providers` 字典就是全部配置面：每个键是路由名，可声明 `api`（`openai-completions` / `openai-responses` / `anthropic-messages`）、`baseURL`、`apiKeyEnv`、`models[]`。`apiKeyEnv` 是凭据引用，不把 secret 写进配置文件（`packages/llm/llm-pi-ai/README.md:36-73`）。

现有 profile 只挂了一条 `opendesign` 路由（`.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml:17-33`）。

### 1.2 凭据面（key 的长期归宿）

`dsh-credentials-local` 默认把 key 存到 `<DSH_HOME>/.credentials.yaml`，解析顺序：文件 > 启动环境 > 项目 `.env` > `$DSH_HOME/.env`（`packages/credentials/credentials-local/README.md:69-79`）。`ctx.credentials.resolve(ref)` 可供插件读取，文件权限只保护到 OS 用户级——**agent 工具进程与你是同一用户，所以它挡不住 agent 自己读**（同文件 line 12）。

这是「一个 key 多处用」的正确落点：百炼/硅基流动各存一条，chat 路由与 ASR 引擎都通过 `apiKeyEnv` / `credentialRef` 解析，不额外发明密钥文件。

### 1.3 ASR 引擎（为云端预留）

`plugins/asr/src/engine-registry.mjs` 的契约只有五件事：`info` / `status` / `prepare` / `transcribe` / 可选 `dispose`；`info.location` 明确允许 `'cloud'`。当前只注册了本地 `sensevoice`（`plugins/asr/README.md:111-121`）。加云端引擎不需要动 service、HTTP 面与面板。

### 1.4 TTS 线路（协议是锁死的）

`plugins/voice` 把 TTS 分为 `local`（voxd `127.0.0.1:8765`）与 `cloud`（云端语音包 `127.0.0.1:8767`）两条线路，客户端只发 `POST /v1/speak/file`，期望拿回 wav 并按 `X-Duration-Ms` 取时长（`src/voice-tts.js:100-113`）。云端语音包的凭据字段是 `appId/accessKey/resource/speaker`（`src/voice-packs.js:1203`），即火山引擎专用，不是通用 HTTP TTS。

### 1.5 决策 / JEV（没有消费端）

pi-ai 1.1.0 自带四个分类器协议：`openai-decisions`、`typesafe-system-one`、`cloudflare-workers-ai-system-one`、`llama-cpp-classify`（`node_modules/@earendil-works/pi-ai/dist/types.d.ts:19`），其中 `typesafe` 的目录里就有 `jev-latest`（`dist/providers/data/typesafe.json`）。但 `dsh-llm-pi-ai` 只调度 chat 模型，分类器模型被显式排除在配置目录之外（`src/catalog.ts:171`）。所以 JEV 今天仍然没有可用的宿主消费端；`docs/research/live2d-jev-two-paths.md` 的结论（需专门客户端）依旧成立。

## 2. 两家 provider 的能力对照（2026-11-11 核实）

### 2.1 阿里云百炼（DashScope / Model Studio）

| 能力 | 模型 | 接口 | 关键限制 | 价格 |
| --- | --- | --- | --- | --- |
| 文本/图片对话 | `qwen3.8-max`、`qwen3.7-plus`、`qwen3.8-flash`、`deepseek-v4-pro` 等 | OpenAI 兼容 `https://dashscope.aliyuncs.com/compatible-mode/v1` | 按地域分离，key/域名/模型列表不能跨地域混用 | 控制台 |
| 全模态理解 | `qwen3.8-omni-flash` | Chat Completions / Responses；输入文本、图片、音频、视频，输出文本 | 1M 上下文；`use_multichannel` 开空间音频；113 种语言/方言 | 见模型价格页 |
| 语音识别 | `qwen3-asr-flash` | HTTP，文档标注 **OpenAI 兼容**；支持 URL / Base64 / 本地绝对路径 | ≤10MB 且 ≤5 分钟；RPM 100 | **¥0.00022/秒 ≈ ¥0.79/小时** |
| 长音频识别 | `qwen-audio-3.1-asr-flash-filetrans` / `fun-asr` | HTTP，公网 URL，异步 | ≤2GB / ≤12 小时；可开说话人分离 | 控制台 |
| 语音合成 | `qwen3-tts-flash`、`qwen-audio-3.1-tts-plus/flash`、`cosyvoice-v3.5` | WebSocket / 非实时 HTTP / 实时 | 17 种音色；支持方言、指令控制、声音复刻 | `qwen3-tts-flash` **¥0.8/万字符** |
| 结构化决策 | `decision-model-preview` | 决策模型 API（非 chat） | 文本输入，65k 上下文，结构化决策输出 | **限时免费** |
| 图像/视频生成、3D | wan / happyhorse / Tripo | 各自异步 API | 与对话链路无关 | 控制台 |

来源：<https://help.aliyun.com/zh/model-studio/get-api-key>、<https://help.aliyun.com/zh/model-studio/asr-model>、<https://help.aliyun.com/zh/model-studio/qwen3-asr-flash>、<https://help.aliyun.com/zh/model-studio/tts-model>、<https://help.aliyun.com/zh/model-studio/qwen3-tts-flash>、<https://help.aliyun.com/zh/model-studio/qwen3-8-omni-flash>、<https://help.aliyun.com/zh/model-studio/decision-model-preview>。

### 2.2 硅基流动（SiliconFlow）

| 能力 | 模型/接口 | 关键限制 | 价格 |
| --- | --- | --- | --- |
| 对话（OpenAI/Anthropic 双协议） | `https://api.siliconflow.cn/v1`；`deepseek-ai/DeepSeek-V4.1-Flash`、`zai-org/GLM-5.3-Flash`、`Qwen/Qwen3.5-35B-A3B` 等 | 图片输入有专门指南；**没有音视频进对话的公开文档** | 例如 V4.1-Flash ¥2/¥8 每百万 token；GLM-5.3-Flash ¥0.8/¥2.8 |
| 语音识别 | `POST /v1/audio/transcriptions`，multipart；`FunAudioLLM/SenseVoiceSmall`、`TeleAI/TeleSpeechASR` | ≤1 小时且 ≤50MB | 语音分栏价格页未抓到，落地前查控制台 |
| 语音合成 | `POST /v1/audio/speech`；`FunAudioLLM/CosyVoice2-0.5B`、`fnlp/MOSS-TTSD-v0.5` | 支持 `voice`/`references` 声音克隆、流式、mp3/opus/wav/pcm | 同上 |
| 结构化决策 | `POST /v1/systemone`（TypeSafe 协议）；`Kev-4b`、`SemIf` | **Alpha**，官方明示可能调整或停用；目前免费 | 免费（若收费另行通知） |
| 视频生成 | `POST /v1/video/submit`、`/v1/video/status` | 生成，不是视频理解 | 控制台 |
| 嵌入 / 重排 | `/v1/embeddings`、`/v1/rerank` | — | 控制台 |

来源：<https://docs.siliconflow.cn/docs/api/audio-transcriptions-post>、<https://docs.siliconflow.cn/docs/api/audio-speech-post>、<https://docs.siliconflow.cn/docs/api/systemone-post>、<https://www.siliconflow.cn/pricing>。

### 2.3 对「JEV」的专门结论

- 硅基流动的 `/v1/systemone` 是 TypeSafe 的 System One 协议，但模型是 `Kev-4b` / `SemIf`，**不是** JEV；alpha 条款也写明了可能停用。
- 百炼 `decision-model-preview` 是另一套结构化决策模型，**文本输入**，与 JEV 的 choice/noul/score/box 语义相近但不是同一 endpoint，不能直接复用 Soullink 的 JEV 适配器。
- 真 JEV 今天最干净的路是 pi-ai 自带的 `typesafe-system-one`（`jev-latest`），省掉自己写 Decisions 适配器；它仍然需要一个「分类器消费端」插件，DSH 还没有。

## 3. 五条集成路径与代价

### A. 对话路由（配置级，0.5 人日）

在 profile 的 `llm-pi-ai.providers` 里加 `bailian` 与 `siliconflow` 两条路由，`apiKeyEnv` 指向凭据文件里的引用。文本与图片立即可用；音频/视频仍进不来。

- 需要：两条 key、两段 YAML、一次重启、一次最小对话验证。
- 不碰代码，风险最低；但这也说明它**解决不了用户提的 ASR/TTS/视频/音乐**。

### B. ASR 云端引擎（1–2 人日）

新增 `plugins/asr/src/engine-openai-asr.mjs`，实现 `info/status/prepare/transcribe`：

- 百炼：`qwen3-asr-flash`（OpenAI 兼容 HTTP；具体路径以官方《语音识别 API 参考》为准，见 §7 未验证）。
- 硅基流动：`/v1/audio/transcriptions` + `FunAudioLLM/SenseVoiceSmall`，multipart 上传。
- 同一份实现用 `baseURL + model + apiKeyEnv` 区分供应商；本地 `sensevoice` 保留为离线兜底。
- 面板自动列出新引擎；`engine` 配置切换；`prepare()` 对云端是空操作。
- 失败必须可读：沿用现有 `errors.mjs` 的错误码风格，不要把 401 说成「模型没准备好」。

代价：约 150–250 行（含测试替身），不新增原生依赖，不改状态目录布局。

### C. TTS 外部线路（2–3 人日）

两条路，推荐前者：

1. **插件内新增「外部 HTTP」线路**：在 `voice-tts.js` 旁加一个 `openai-tts` 客户端（`POST {baseURL}/audio/speech`，`response_format: wav`），把结果写成现有缓存文件；`voice.tts.route` 从 `local|cloud` 扩成三值，配置增加 `provider/model/voice` 与 key 引用。
2. **本地适配进程**：起一个小服务把 voxd 协议翻译成百炼/硅基流动，插件零改动。多一个常驻进程、一套健康检查，长期成本更高。

难点不在 HTTP，而在格式与时长：百炼 `qwen3-tts-flash` 返回的音频格式、采样率需实测；`wavDurationMs` 只认 RIFF/WAVE，mp3 需要 ffprobe 兜底（插件已依赖 ffprobe）。另外，现有云端语音包的 key 存在 `config.toml`，与凭据面是两套；新线路应统一走 `.credentials.yaml`。

### D. 媒体理解工具（2–3 人日）

新增插件 `plugins/media`（或并入现有插件），提供一个工具，例如 `media_understand({ path | url, question })`：

- 内部调 `qwen3.8-omni-flash` 的 Chat Completions，把音频/视频作为内容块传入，返回文本。
- 工具结果自动进会话日志，满足「模型可见 ⟺ 可回放」；不需要改 `ModelModalityMap`，也不需要 pi-ai 内容转换。
- 与「音乐识别」的边界：能做「这段音频是什么风格/在讲什么/情绪如何」，**不能**做「这是哪首歌」；后者需另接指纹服务，建议单列需求。

备选（不推荐）：扩展 harness 模态词表并在 pi-ai 转换里加 audio/video 块。跨 `llm`、`llm-pi-ai`、会话持久化与投影，回归面大，收益只是「让 omni 看起来像普通模型」。

### E. 决策 / JEV 客户端（2–4 人日，依赖是否重启 L3）

- 若只要「结构化决策」：写一个薄客户端，按 provider 配 `openai-decisions`（OpenRouter）或 `typesafe-system-one`（api.typesafe.ai），复用 pi-ai 分类器；硅基流动 `/v1/systemone` 只适合实验，alpha 不宜进主链路。
- 若沿用现有 Soullink 参考实现：仍要自研 Decisions 适配器（`docs/research/live2d-jev-two-paths.md` §3.3 已论证），且没有任何实测数据。
- 这层与 ASR/TTS 无耦合，建议等 L2 表演规则落地后再排期。

## 4. 成本估算（按 2026-11-11 官方价）

- ASR：`¥0.00022/秒`。每天 30 分钟语音 ≈ `¥0.40`；每月 ≈ `¥12`。100 小时 ≈ `¥79`。
- TTS：`qwen3-tts-flash` `¥0.8/万字符`。每条 120 字 ≈ `¥0.0096`；每天 200 条 ≈ `¥1.9`。
- 对话：以硅基流动 V4.1-Flash 为例 `¥2/¥8` 每百万 token；日常对话量级下是「元级/月」，不是主要成本。
- 媒体理解（omni）：按 token 计费，视频按帧/时长折算，**未抓到单价**；要等控制台账单页确认后再估。
- 隐性成本：跨地域 key 分离、RPM 限制（`qwen3-asr-flash` 100 RPM）导致的排队与重试，比单价更容易影响体验。

## 5. 风险与限制

1. **密钥面扩大**：从「只有 chat key」变成 chat + ASR + TTS + 媒体 + 决策五类。统一进 `.credentials.yaml` 并用 `apiKeyEnv`/`credentialRef` 引用，禁止散落在插件配置、语音包 `config.toml` 与代码里。
2. **地域锁定**：百炼不同地域的 key、域名、模型列表不能混用；新加坡/北京价格不同。配置里要显式写地域，不要靠默认。
3. **Alpha 条款**：硅基流动 `/v1/systemone` 明确「可能调整或停用」；百炼 `decision-model-preview` 是预览且限时免费。都不能作为长期唯一依赖。
4. **模型生命周期**：两家都会定期上下线模型（文档原文「定期变更」）。配置要能一处改模型名，不要把模型 id 写死在代码。
5. **格式/采样率**：ASR 侧现有工程已把「规范 WAV」做成契约（`plugins/asr/README.md:61-76`）；云端引擎可以放宽，但 TTS 侧 wav/mp3 的时长与响度处理需要实测，不能假设。
6. **网络与离线**：现有 ASR/TTS 都是本机进程，断网可用；接云后要保留本地兜底，否则「断网 = 哑巴」。
7. **合规**：语音与视频可能含个人信息；上传第三方前要明确告知与最小化（例如只传片段、不落盘），这一点在文档里没有现成机制，属于产品决策。
8. **重复计费**：omni 的「音频输入」与单独 ASR 是两条计费路径；同一段语音不要既走 ASR 又走 omni，除非确实需要语义理解。

## 6. 推荐路线（最简方案 + 一个备选 + 依据）

**推荐：A → B → D → C → E 的顺序，先配置后代码，先离线兜底后云。**

1. **A（0.5d）**：加两条 chat 路由，验证 key 与网络；这是所有后续路径的前置。
2. **B（1–2d）**：`openai-asr` 引擎，百炼 `qwen3-asr-flash` 优先（便宜、OpenAI 兼容、支持本地路径），硅基流动同实现可切；保留 `sensevoice` 兜底。
3. **D（2–3d）**：媒体理解工具，覆盖「视频/音乐内容理解」；明确不做听歌识曲。
4. **C（2–3d）**：TTS 外部线路，等 B/D 证明 key 与网络稳定后再动 voice 插件。
5. **E**：等 L2 表演规则就绪后再评估；不要为了「全模态」先做决策层。

**备选：先做 C 的本地适配进程**，让 voice 插件零改动跑通外部 TTS。适合「只想尽快听到云端音色」的场景；缺点是长期多一个进程要维护，且错误面被藏在适配层里。

**依据（多·快·好·省）**：每条路径都复用现有接缝（引擎注册表、TTS 线路、工具系统），不新增协议层、不改 harness 核心类型；先做单位成本最低、回归面最小的 A/B，把「值不值得继续」用真实账单与延迟回答，再决定 C/D 的投入。

## 7. 未验证 / 待拍板

1. `qwen3-asr-flash` 的 OpenAI 兼容路径与鉴权细节（文档标注兼容，但未实测；需一次 curl）。
2. 百炼 `qwen3.8-omni-flash` 的音视频输入计费单价与延迟（价格页未抓到表格）。
3. 硅基流动语音分栏价格、`/v1/systemone` 的真实延迟与质量（alpha）。
4. `qwen3-tts-flash` 返回格式与采样率、中文长文本断句质量。
5. 「视频音乐识别」到底指「内容理解」还是「听歌识曲」——决定 D 是否够用。
6. 是否需要「一个 provider 配置层」统一管理两家（而不是散在 `llm-pi-ai`、asr、voice 三处）。当前最简做法是三处各自读 `credentialRef`，共享同一份 `.credentials.yaml`；抽公共层要等到第三处真正重复时再做。

## 8. 待用户决策

- D1：先做 A（配置级 chat 路由）验证 key，还是直接跳到 B（ASR 引擎）？
- D2：ASR 首选百炼还是硅基流动？（建议百炼 `qwen3-asr-flash`，价格与兼容性都占优）
- D3：TTS 接受「voice 插件加外部线路」还是「本地适配进程」？
- D4：「视频/音乐识别」的验收口径是「描述内容」还是「识别曲名」？
- D5：key 是否统一存 `.credentials.yaml`（推荐），还是允许各插件自己的配置文件？

## 9. 参考

- 百炼获取 API Key（含地域与 Base URL）：<https://help.aliyun.com/zh/model-studio/get-api-key>
- 百炼语音识别选型：<https://help.aliyun.com/zh/model-studio/asr-model>
- 百炼 `qwen3-asr-flash`（价格 ¥0.00022/秒）：<https://help.aliyun.com/zh/model-studio/qwen3-asr-flash>
- 百炼语音合成选型：<https://help.aliyun.com/zh/model-studio/tts-model>
- 百炼 `qwen3-tts-flash`（¥0.8/万字符）：<https://help.aliyun.com/zh/model-studio/qwen3-tts-flash>
- 百炼 `qwen3.8-omni-flash`（音视频输入 → 文本）：<https://help.aliyun.com/zh/model-studio/qwen3-8-omni-flash>
- 百炼 `decision-model-preview`（限时免费）：<https://help.aliyun.com/zh/model-studio/decision-model-preview>
- 硅基流动语音转文本：<https://docs.siliconflow.cn/docs/api/audio-transcriptions-post>
- 硅基流动文本转语音：<https://docs.siliconflow.cn/docs/api/audio-speech-post>
- 硅基流动 TypeSafe 决策（Alpha）：<https://docs.siliconflow.cn/docs/api/systemone-post>
- 硅基流动价格页：<https://www.siliconflow.cn/pricing>
- 仓库内：`packages/llm/llm-pi-ai/README.md`、`packages/credentials/credentials-local/README.md`、`plugins/asr/src/engine-registry.mjs`、`plugins/voice/src/voice-tts.js`、`docs/research/live2d-jev-two-paths.md`
