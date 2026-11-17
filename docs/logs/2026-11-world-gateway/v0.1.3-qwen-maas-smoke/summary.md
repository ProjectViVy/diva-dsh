# v0.1.3-qwen-maas-smoke 世界网关 × 千问接入点：ASR / TTS / 向量 实测

- 时间：2026-11-17 20:46–22:1x（Asia/Shanghai）
- owner：lead
- 触发：主人给出 `sk-ws-` key 与 `https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，要求「世界网关中接入千问系列模型，主要测 ASR / TTS / 向量」
- 范围：**只实测**。没有改 `plugins/capability-hub`、没有写 `registry.json`、没有改 profile、没有重启宿主
- 新增：`scripts/probe-world-gateway.mjs`（一次性探测脚本，可重复用）、`docs/research/world-gateway-qwen-maas-smoke.md`

## 结论（一句话）

**三项都能跑通，但没有一项走「OpenAI 兼容」那条最顺的路。**

| 能力 | 可用 | 形状 | 实测结果 |
| --- | --- | --- | --- |
| 向量 | ✅ | `POST /compatible-mode/v1/embeddings` | 5 组里 4 组 200（第 5 组是网络抖动）；`dimensions` 生效：1024 / 512 都真实返回 |
| TTS | ✅ | `POST {host}/api/v1/services/aigc/multimodal-generation/generation`（`qwen3-tts-flash`）与 `/api/v1/services/audio/tts/SpeechSynthesizer`（`qwen-audio-3.1-tts-flash`） | 两条都 200，直接回 wav（24kHz/单声道/16bit）；`/compatible-mode/v1/audio/speech` 404 |
| ASR | ✅（**URL 输入**） | 同上原生路径，`content:[{type:'input_audio',input_audio:{data:<url>}}]` + `parameters.format/sample_rate` | 三个模型都 200：`qwen-audio-3.0-asr-flash` → 「欢迎使用阿里云。」（正确）；`fun-asr-flash-2026-06-15`、`qwen-audio-3.1-asr-flash` → 「关于使用阿里云。」（首词错；只有一个 2 秒样本，不足以下结论） |
| 兼容模式 ASR 路由 | ❌ | `POST /compatible-mode/v1/audio/transcriptions` | 404（该接入点不提供） |

## 两个必须记住的坑

1. **本机代理会掐断带音频 base64 的大请求体。** 经 `HTTPS_PROXY=127.0.0.1:7890` 时，凡请求体带 base64 音频（WAV 几十 KB 起）的请求一律在传输层断（`ECONNRESET` / `UND_ERR_SOCKET` / 握手超时），**同样大小的非音频请求体也一样断**——所以这不是服务端拒收。ASR 因此改走「公开 URL」形状，一次成功。要用本地音频，得先关代理再跑。
   - 对照组：`https://example.invalid/a.wav` 这种 URL 形状 → 干净 400；`does-not-exist-xyz` 模型 → 干净 404。说明路由与鉴权都正常，唯一变量是请求体大小。
2. **百炼 TTS 直接返回 wav 字节时，头里的长度字段是流式写值。** `data` 声明 2147483547 字节、实际 211200（另一条 203520）。不修头，播放器会以为是 12 小时的音频。脚本里的 `repairWav` 按实际长度重写；修完 4.24 s / 4.16 s，与文本长度吻合。

## 证据

| 文件 | 内容 |
| --- | --- |
| `probe-final.json` | 最后一轮完整证据（models 182 个 / embedding 5 组 / tts 4 种形状 / asr 3 模型 + 兼容路由 / omni 两条） |
| `samples/tts-native-aigc-qwen3-flash.wav` | `qwen3-tts-flash` + Cherry 合成，4.24 s，头已修 |
| `samples/tts-native-synthesizer-qwen-audio.wav` | `qwen-audio-3.1-tts-flash` + `longanhuan_v3.1` 合成，4.16 s |
| `samples/tts-roundtrip-cherry.wav` | 同一段文本另一次合成（4.4 s），用于 ASR 试听素材 |
| `samples/asr-tone-dialect.wav` | 自己合成的正弦音（不是人声）——**只用来证明接口通不通，不能评识别效果** |

key：只记了 `prefix: "sk-ws-"`、`length: 115`、`sha256[:12]: 7522eb55d85d`；仓库里没有明文。

## 未验证

1. 本地音频走 base64 的 ASR 形状（被本机代理挡住）——关代理后需要重跑一次才算验证。
2. 全模态 `qwen3.8-omni-flash` / `qwen3.5-omni-flash` 吃 `input_audio`：两次都网络断，**没有拿到任何结论**。
3. 兼容 chat 的 `modalities:['text','audio']` 正确参数位置（服务端报 `The voice property is required.`，说明它认这个开关但位置不对）。
4. 三个 ASR 模型在**真实录音**（噪声、方言、专有名词）上的字错率；本轮只有一个 2 秒的官方示例音频。
5. TTS 换音色的主观听感（要主人自己听 `samples/*.wav`）。

## 下一步（等主人定）

- **D1**：ASR 用清单里现成的 `qwen-audio-3.0-asr-flash`（首词准确），还是去控制台开通 `qwen-audio-3.1-asr-flash`（有说话人分离/方言保留，但本轮首词错）？
- **D2**：向量对照测（20 条中文 query，本地 MiniLM vs `qwen3.7-text-embedding-flash@512`）现在做吗？做了才知道要不要动 mempalace 的 384 维硬校验。
- 要不要给 `plugins/capability-hub` 写 dashscope 适配器（asr/tts/embedding 三合一）？写完 `invoke` 就有了，面板上的「测试连接」才有着落。
