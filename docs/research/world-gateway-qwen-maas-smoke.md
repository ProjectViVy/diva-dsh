# 世界网关 · 千问系接入点冒烟：ASR / TTS / 向量 到底怎么说话

- 日期：2026-11-17
- 触发：主人给出一把 `sk-ws-` key 与接入点 `https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，要求「在世界网关中接入千问系列模型，主要测 ASR / TTS / 向量」
- 范围：**只实测，不改运行时代码、不改插槽配置**
- 脚本：`scripts/probe-world-gateway.mjs`（本轮新增）
- 证据：`docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/`

## 0. 结论

| 能力 | 在这把 key 上 | 形状 | 实测 |
| --- | --- | --- | --- |
| 模型列表 | ✅ `GET /models` 200，182 个 | OpenAI 兼容 | `probe-final.json` `.models` |
| **向量** | ✅ **能算**，且可指定维度（1024 / 512 都验过） | OpenAI 兼容 `POST /embeddings` | §2 |
| **TTS** | ✅ **能合成**，但**不在 compatible-mode 上** | 原生 `POST {host}/api/v1/services/aigc/multimodal-generation/generation` | §3 |
| **ASR** | ✅ **能识别**，前提是**音频用 URL 传**；用 base64 传会被本机代理掐断 | 原生同一条路径 + `parameters.format/sample_rate` | §4 |
| 全模态（顺带） | ❓ 没测出来（两次都网络断） | 兼容 chat + `input_audio` | §5 |

一句话：**三项都能跑通，但没有一项走「OpenAI 兼容」那条最顺的路**——TTS/ASR 得打 `{host}/api/v1/...`，ASR 还要求音频以 URL 形式给。

> 2026-11-17 22:1x 修订：本文草稿前一版写过「这把 key 上根本没有非实时 ASR」，是**错的**。真相是 `/compatible-mode/v1/audio/transcriptions` 不存在（404），而原生路径配合 **URL 输入**是好的；之前所有 base64 请求都断在传输层，被误读成了「服务端不提供」。§4 有对照组。

## 1. 接入点事实（2026-11-17 实测）

| 项 | 事实 |
| --- | --- |
| 兼容模式根 | `https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` |
| 原生（DashScope）根 | 同一个 host，去掉 `/compatible-mode/v1`：`https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com/api/v1/...` |
| `llm-0jydim7…` 是什么 | 业务空间专属域名（文档口径 `{WorkspaceId}.cn-beijing.maas.aliyuncs.com` 的实例化），比 `dashscope.aliyuncs.com` 新 |
| key 形态 | `sk-ws-` 前缀，`sha256[:12]` 记在证据里；**全文档不出现明文** |
| 本机网络 | 必须经 `HTTPS_PROXY=http://127.0.0.1:7890`。DNS 解析到 `198.18.0.4`（代理软件 fake-ip）；**直连会 TLS 握手失败**，`Invoke-WebRequest` 不加 `-Proxy` 一律失败。间歇性 `ECONNRESET` / `UND_ERR_CONNECT_TIMEOUT`，同样的请求重跑就过——这是本机链路抖动，不是服务端限流。 |

## 2. 向量（embedding）：可用

OpenAI 兼容 `/embeddings` 即可，四种组合都返回 200、L2 范数≈1（已归一化）：

| 模型 | 默认维度 | 可指定 | 20 条/批 | 单行上限 | 单价（元/千 token） |
| --- | --- | --- | --- | --- | --- |
| `text-embedding-v4` | 1024 | 64…2048 | 10 | 8192 | 0.0005 |
| `qwen3.7-text-embedding` | 1024 | 256…2560 | 20 | 128000 | 0.0005 |
| `qwen3.7-text-embedding-flash` | 1024 | 256/512/768/1024 | 20 | 128000 | **0.000125** |

- `dimensions` 参数实测生效：`qwen3.7-text-embedding-flash` + `dimensions: 512` → 4 条全是 512 维。
- 计费按 prompt token（4 条短句 = 26（v4）/ 84（qwen3.7）token）。

**对我们的意义**：`docs/research/qwen-platform-model-integration.md` §3.5 曾判断「没有一个维度是 384」，这条仍然成立——但**维度可以现选**，真正卡住的不是维度而是 `dsh-mempalace` 里 `embeddingDim === 384` 的硬校验与「全量记忆外发」。**最省的做法**：先不换库，用 `qwen3.7-text-embedding-flash@512` 做 20 条中文 query 的召回对照测；测不出差距就不动 schema。**备选**：直接全量重建到 512 维——一次性成本约 ¥1.25/千万 token，但要改虚表、全量回填，且把全部记忆文本送出本机，必须做成显式开关。

## 3. TTS：可用，但**不走兼容模式**

| 试法 | 结果 |
| --- | --- |
| `POST /compatible-mode/v1/audio/speech`（OpenAI TTS 形状） | **404**，接入点不提供 |
| `POST /compatible-mode/v1/chat/completions` + `modalities:['text','audio']` + `audio.voice` | 400 `invalid_parameter_error`：**The voice property is required.**——它认这个开关，但 `audio.voice` 这层不是它要的位置 |
| `POST /api/v1/services/aigc/multimodal-generation/generation`（`qwen3-tts-flash`，`input.voice=Cherry`） | ✅ **200**，返回 `output.audio.url`（OSS 链接）；`data` 为空 |
| `POST /api/v1/services/audio/tts/SpeechSynthesizer`（`qwen-audio-3.1-tts-flash`，`input.voice=longanhuan_v3.1`） | ✅ **200**（**前一轮报过 `InvalidParameter: url error`，复跑两次都成功**——那条报错不可复现，可能是抖动期返回的误报） |

实测音频：24000 Hz、单声道、16-bit PCM，4.2 秒左右（`qwen3-tts-flash` 4.24 s / `qwen-audio-3.1-tts-flash` 4.16 s）。

两件必须记住的坑：

1. **WAV 头长度不对**。百炼把流式写出的字节直接当响应体，`RIFF` 与 `data` 的长度字段是 `0x7FFFFFFF - 60` 这类流式写值（实测 `data` 声明 2147483547 字节、实际 211200）。播放器会以为这是一段 12 小时的音频。**拿到的字节要先按实际长度重写头再算时长**（探测脚本里 `repairWav` 就是这个）。
2. **协议形状不是 OpenAI**。`plugins/voice` 只认 voxd 的 `POST /v1/speak/file`，要接这条线等于新增一个「DashScope TTS 客户端」，不是改个 baseURL 的事。

## 4. ASR：可用，但必须「URL 输音频」

### 4.1 正确的形状

```http
POST https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
Authorization: Bearer <sk-ws-...>
Content-Type: application/json

{ "model": "qwen-audio-3.0-asr-flash",
  "input": { "messages": [ { "role": "user", "content": [
      { "type": "input_audio", "input_audio": { "data": "https://...mp3" } } ] } ] },
  "parameters": { "format": "mp3", "sample_rate": "16000" } }
```

返回 `{"output":{"sentence":{...逐词 begin_time/end_time...},"text":"欢迎使用阿里云。"},"usage":{"duration":2}}`。

### 4.2 清单里到底有哪些 ASR

`GET /models` 可见：`qwen-audio-3.0-asr-flash`、`fun-asr-flash-2026-06-15`、`qwen3-asr-flash-realtime`（实时）。
**`qwen3-asr-flash` 不在清单里**；`qwen-audio-3.1-asr-flash` 也不在，但它**实际能调**（见 4.3），说明 `/models` 不是权限白名单。

### 4.3 实测（同一段 2 秒官方示例 `welcome.mp3`，句子是「欢迎使用阿里云。」）

| 模型 | HTTP | 转写 | 延迟 |
| --- | --- | --- | --- |
| `qwen-audio-3.0-asr-flash` | 200 | **欢迎使用阿里云。**（正确） | 9.9 s（抖动大，另一次 9.1 s） |
| `fun-asr-flash-2026-06-15` | 200 | 关于使用阿里云。（首词错） | 0.6 s |
| `qwen-audio-3.1-asr-flash` | 200 | 关于使用阿里云。（首词错） | 1.3 s |

**样本只有一个 2 秒句**，这不足以给模型排序——「首词错」很可能只是这一句的边界效应。要选模型得拿真人录音跑。

### 4.4 没走通的形状（都记下来，免得下一个人再试一遍）

| 试法 | 结果 |
| --- | --- |
| `POST /compatible-mode/v1/audio/transcriptions`（multipart） | **404**。兼容模式不提供该路由（三个模型都 404） |
| 原生路径 + `content:[{"input_audio":{"data":"data:audio/wav;base64,..."}}]`（无 `type`） | 3 字节假音频 → 干净 400（形状被接受）；**真 wav 的 base64（≥ 数十 KB）→ 传输层必断** |
| 原生路径 + `content:[{"type":"input_audio",...}]` + 真 wav base64 | 同上，必断 |
| `https://example.invalid/a.wav` | 400，返回空 `sentence` 结构——形状对、文件取不到 |

### 4.5 为什么 base64 一定断（对照组）

| 请求体 | 大小 | 结果 |
| --- | --- | --- |
| 纯 JSON，`model:'does-not-exist-xyz'` | < 1 KB | 404 `Model not exist.` |
| 3 字节 base64 | < 1 KB | 400 |
| TTS wav 的 base64 | ~290 KB | 5/5 传输层断 |
| **不可解析的 800 KB 填充 base64** | ~781 KB | **3/3 传输层断** |

同样的体积、与音频内容无关 → **断的是本机代理链路（`HTTPS_PROXY=127.0.0.1:7890`），不是服务端拒收。** 所以：
- 接 ASR 的适配器，**优先支持 URL 输入**（服务端自己取音频，请求体几百字节）；
- 要传本地小音频文件，得先在无代理环境验证一次 base64 通不通。

## 5. 全模态（顺带一测，不在本轮靶心）

兼容 chat 是否接受 `input_audio` 内容块，决定「能不能用 omni 一条路同时办听写」。
本轮 `qwen3.8-omni-flash` 与 `qwen3.5-omni-flash` 各试两次，**全部传输层断**（base64 大请求体，见 §4.5），**没有任何结论**。
若后续在无代理环境跑通，`qwen3.8-omni-flash` 可作「临时替代 ASR」的路径，但**计费与独立 ASR 是两条**，讨论见 `docs/research/qwen-platform-model-integration.md` §5 第 6 条。

## 6. 落到世界网关要动什么（只是判断，本轮不动）

| 能力 | 插槽现状 | 要动的东西 | 代价 |
| --- | --- | --- | --- |
| embedding | `kind=dashscope`，baseURL 默认 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com` | **只填参数**：baseURL = 本 host 的 `/compatible-mode/v1`，模型 `qwen3.7-text-embedding-flash`，凭据写 `DASHSCOPE_API_KEY` | 0（面板操作） |
| tts | 同上 | `baseURL` 填兼容根**无用**；适配器按「主机根 + `/api/v1/...` + `input.voice`」说话，还要修 wav 头 | 新 adapter |
| asr | 同上 | 同形 + `parameters.format/sample_rate`；**优先 URL 输入**，base64 需无代理环境复验 | 新 adapter + 一次无代理复验 |

**最简方案**：三合一写一个 dashscope 适配器（asr/tts/embedding 同一把 key、同一个 host，只是路径与形状不同），顺便把 `invoke` 补上——没有它，面板永远没法「测试连接」。

**但先要解决一个语义歧义**：插槽的 `baseURL` 在 `kind=dashscope` 下现在默认是**主机根**，而 embedding 实际要的是**兼容根**（`/compatible-mode/v1`）。两个能力要不了一个值。**备选**：让适配器固定认定「填主机根，路径自己拼」。不先定这个，写出来的 adapter 一定对不上面板。

## 7. 未验证 / 待决策

1. 三个 ASR 模型在**真人录音**（噪声/方言/专有名词）上的字错率、单价、限流——本轮只有一个 2 秒官方示例。
2. 本地音频走 base64 的 ASR 形状：被本机代理挡住，需要**关代理**复验一次。
3. 兼容 chat 的 `modalities:['text','audio']` 正确参数位置（`output_audio`？`input.audio`？），以及全模态吃 `input_audio` 的结果——两次都传输层断，零结论。
4. TTS 音色的主观听感（样本已落盘，要人耳）。
5. **D1**：ASR 选 `qwen-audio-3.0-asr-flash`（稳定可用）还是开通 3.1（说话人分离/方言）？先拿真人录音测再定更稳。
6. **D2**：embedding 对照测（20 条中文 query，本地 MiniLM vs `qwen3.7-text-embedding-flash@512`）现在做，还是等记忆换库方案定了再做？
7. **D3**：写 dashscope 三合一适配器？写之前先定「`baseURL` 填主机根还是兼容根」。
