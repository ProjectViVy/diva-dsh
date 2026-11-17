# 模思（MOSS）接入世界网关：预接线

- 日期：2026-11-18
- 范围：`plugins/capability-hub`（世界网关）的**接线**。不写适配器、不发真实推理请求。
- 触发：主人 2026-11-18「将 platform.moss.cn 的模型页与 MOSS-Live 参考接入，先做预制接线保证能力，后面再进行实际应用开发」。
- 相关：`capability-hub-slots.md`（网关定位与插槽）、`provider-hub-and-gateway.md` §6.5（MOSS 家族取舍）、`world-gateway-qwen-maas-smoke.md`（千问实测）。
- 交付：`docs/logs/2026-11-world-gateway/v0.1.5-moss-prefab/`。

## 1. 结论

1. 模思作为第五个接入点 `moss` 接入，API 主机 **`https://api.mosi.cn`**（不是 `api.moss.cn`），
   凭据引用名 `MOSS_API_KEY`，与「设置 → 模型」共用 DSH 的凭据存储。
2. 四条能力预接线：`asr`（转写 / 多说话人转写）、`tts`（TTS / TTSD / 音色生成）、
   `omni`（MOSS-VL 图/视频理解）、`realtime`（**MOSS-Live 全双工**，新增的第六个插槽）。
3. 两条能力**不接**并写明原因：`embedding`（模思没有向量模型）、`decision`（Nex N2.6 是 chat，
   归 DSH「设置 → 模型」）。文生图 `moss-image-*` 不在网关的能力枚举里。
4. 实时语音从「纯占位卡」升级成插槽：`wss://api.mosi.cn/v1/realtime`，只存接入参数；
   WS 管线（含浏览器不能带 `Authorization` 头、需要服务端代理）留给应用开发轮。
5. 这一轮**没有模思适配器**：`tts` 插槽选 `moss` 会如实返回 `501 NO_ADAPTER`，不假装能合成。

## 2. 已核实的事实（2026-11-18，本机直连）

| 事实 | 证据 |
| --- | --- |
| 文档站 | `platform.moss.cn`（`/en/docs/**` 英文、`/docs/**` 中文），另有给 LLM 的 `https://platform.moss.cn/llms.txt` |
| `platform.mosi.cn` 是同一个站 | 302 → `platform.moss.cn`；文档正文里的示例主机却写 `api.mosi.cn` |
| API 主机 | `api.mosi.cn`：`GET /v1/models` 带无效 key 回 403 `iam api key auth failed`（`error.code=102111001`） |
| `api.moss.cn` 不是 API | `GET /v1/models` → 404 |
| 路由存在性 | `/v1/audio/speech`、`/v1/audio/transcriptions`、`/v1/responses`、`/v1/realtime` 带无效 key 都回 403 鉴权错；`/v1/definitely-not-a-route` → 404 |
| 鉴权 | HTTP 一律 `Authorization: Bearer <API Key>`；Messages / Count Tokens 用 `x-api-key` + `anthropic-version: 2023-06-01` |
| OpenAI 兼容 | `base_url` 填 `https://api.mosi.cn/v1` 即可用 Chat Completions 形状 |
| 文档承载 | Nuxt SSR；正文在 `data-pagefind-body` 里，静态抓取可读（HTML 里直接有全文） |

没有真 key，所以**模型清单没有经过 `/v1/models` 核对**；候选 id 全部来自官方模型页
（`/en/docs/models` 与各模型页），快照号同样来自那里。`MOSS_API_KEY` 目前不在本机凭据里。

## 3. 模型 → 能力映射

| 模型 id | 能力 | 上游端点 | 备注 |
| --- | --- | --- | --- |
| `moss-transcribe-1.0` | `asr` | `POST /v1/audio/transcriptions` | 音频 → 文本；支持 multipart file / file_id / url / audio_url，**不支持 `audio_data`** |
| `moss-transcribe-diarize-pro` | `asr` | 同上 | 带说话人与时间戳，单文件最长 60 分钟 |
| `moss-tts-1.5-flash` | `tts` | `POST /v1/audio/speech` | 推荐；支持流式与 `[pause X.Ys]`；`language` 用完整英文名（如 `Chinese`） |
| `moss-tts-1.0-pro` | `tts` | 同上 | 非流式，不支持 pause 语法 |
| `moss-ttsd-1.0` | `tts` | `POST /v1/audio/speech/speakers` | 双说话人对话语音，`speakers` + `segments` |
| `moss-voice-generator-1.0` | `tts` | `POST /v1/audio/voice/generations` | 文本 + 声音描述 → 语音 |
| `moss-vl-1.0`（Beta） | `omni` | `POST /v1/responses` | 图/视频 + 文本 → 文本；每次 ≤5 图或 1 视频，不吃音频 |
| `moss-live-1.0`（Beta） | `realtime` | `WSS /v1/realtime?model=moss-live-1.0` | 全双工音频 + 实时视频帧 → 语音 + 文本；快照 `moss-live-1.0-2026-11-02` |
| `moss-vl-realtime-1.0`（Beta） | —（未接） | `WSS /v1/realtime` | 实时视频理解、只回增量文本；与语音 Realtime 不是同一协议，不塞进 `realtime` 插槽 |
| `moss-image-base-1.0` / `-sft-1.0`（Beta） | —（未接） | `POST /v1/images/generations` | 网关还没有 `image.generate` 能力，留到加能力时一起做 |
| `nex-n2.6` | —（chat） | `/v1/chat/completions`、`/v1/responses`、`/v1/messages` | 语言模型，归「设置 → 模型」，不进世界网关 |

TTS 的 `voice_id` 必填，来自 `GET /v1/audio/voices`（或控制台音色卡），本网关的插槽不存音色——
音色是调用参数，与千问 TTS 的处理一致。

## 4. MOSS-Live 的接线要点（为应用开发留的钩子）

- 地址：`wss://api.mosi.cn/v1/realtime?model=moss-live-1.0`（`model` 必填，`user` 可选且
  `memory_scope=user` 时必填）；另有时延/同传路径 `/v1/realtime/interpret?model=…&source=…&target=…`。
- 鉴权在 WebSocket 握手的 `Authorization` 头里；**浏览器原生 `WebSocket` 不能设这个头**，
  所以真正的客户端必须走服务端代理或集成适配器。这是我们将来实现时的第一道工程约束。
- 会话流程：连上 → `attach_session`（可带 `session_id` 续会话、`memory_scope`、`delegation`）→
  `session.update` / `change_voice` / `media.configure` → 持续上传音频/视频帧 → 收
  `input.transcript.done` / `output.transcript.done` / `response.ended`，可随时打断。
- 限额：同一个用户同时只允许 **1 条**会话连接；平台满载时可能开不了新会话。
- 后台委派（`delegation.type = 'client'`）把复杂推理/长任务交回我们自己的后端，模型在任务执行期间继续与用户说话——
  这条和 Superagent 的工单/长任务结构最接近，是将来接「她一边说话一边干活」的入口。
- 工具调用：Live 原生支持客户端函数工具（`session.update.session.tools`），**与 OpenAI Chat 的
  `tools` 不是同一层，也不能直接套 OpenAI Realtime SDK**；形状、异步任务与差异见
  `moss-live-tool-calling.md`。

## 5. 落地方式（代码）

| 位置 | 改动 |
| --- | --- |
| `src/capabilities.mjs` | `KINDS` 加 `moss`；`KIND_BASE.moss = https://api.mosi.cn`；`CAPABILITIES` 加 `realtime`（`transport: 'websocket'`）；新增 `defaultsFor(capability, kind)`（基址 + 该接入点首个候选） |
| `src/registry.mjs` | 校验按能力区分协议：`realtime` 必须 `wss://`，其余必须 `https://`；换 `kind` 且未给基址/模型时填该接入点的预制值；这一家没有这类模型时模型为空、保存被拒 |
| `src/candidates.mjs` | `LIST_BASE.moss`、`DEFAULT_MODEL.realtime`、模思展示名与四条能力的候选（按推荐顺序） |
| `src/catalog.mjs` | `realtime` 的说明；`能力@接入点` 级说明（`embedding@moss` 没有向量模型、`decision@moss` 属于 chat） |
| `src/client.js` | 接入点列表加「模思 · MOSS API」；切接入点时带出该家基址与首个候选；实时语音卡只列模思、基址自动填 `wss://…`；删掉旧的「实时语音（未接入）」占位卡 |
| `scripts/explore-endpoints.mjs` | 支持 `MOSS_API_KEY`，把模思纳入 `/models` 对账 |

面板里远程模型核对仍靠 `node plugins/capability-hub/scripts/explore-endpoints.mjs --check`
（需要 key）。没有 key 时脚本只报告「有列表接口/无列表接口」。

## 6. 明确不做（这一轮）

1. 不实现任何模思适配器（asr / tts / omni 的请求形状、错误码、异步任务簿都留到应用轮）。
2. 不实现 MOSS-Live 的 WS 客户端、音频管线、回声消除、打断处理。
3. 不把 Nex N2.6 写进 DSH 的 chat provider（那是「设置 → 模型」的事，需要一次 profile 配置变更）。
4. 不接文生图 / 实时视频理解：能力枚举里还没有它们，加能力要连带加适配器与产物落盘，超出「接线」。
5. 不发起真实推理请求——本轮没有可用 key，也不该拿「接线完成」冒充「能力验证通过」。

## 7. 下一步（应用开发轮的入口）

- 有 `MOSS_API_KEY` 后：`explore-endpoints.mjs --check` 核对候选 → 启用 `tts`/`asr` 插槽 → 先做 `asr` 或 `tts` 适配器里的一个，别两个一起。
- MOSS-Live：先写服务端代理（Node `ws` + 握手带 Authorization），再在代理上做「文本/语音双向」最小闭环；
  浏览器侧只连本机代理，不直连模思。
- 音色：先用 `GET /v1/audio/voices` 拉一遍，再决定要不要把 `voice_id` 存进插槽（当前按调用参数处理）。
- 价格与限流：模型页给了单价与并发限制，接入计费/预算前需要再核一遍官方「请求限制」页。
