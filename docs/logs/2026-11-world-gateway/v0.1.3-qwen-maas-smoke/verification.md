# 验证

全部是本轮**真实出网**的结果（2026-11-17 20:46–22:1x），不是推断。

## 做了什么

```powershell
$env:QWEN_WS_KEY='<key>'          # 只在 shell 环境里，没写进任何文件
$env:PROBE_TIMEOUT_MS='60000'
node scripts/probe-world-gateway.mjs --key-env QWEN_WS_KEY `
  --samples docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/samples `
  --audio-url 'https://dashscope.oss-cn-beijing.aliyuncs.com/audios/welcome.mp3' `
  --out docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/probe-final.json
```

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 鉴权 | `GET /compatible-mode/v1/models` → 200，182 个模型 | `probe-final.json` `.models` |
| 向量 · `text-embedding-v4` | 200，4 条，1024 维，‖v‖=1 | `.capabilities.embedding[0]` |
| 向量 · `text-embedding-v4` + `dimensions:512` | 200，4 条，**512 维** | `.capabilities.embedding[1]` |
| 向量 · `qwen3.7-text-embedding-flash` | 200，4 条，1024 维 | `.capabilities.embedding[2]` |
| 向量 · `qwen3.7-text-embedding-flash` + `dimensions:512` | 200，4 条，**512 维** | `.capabilities.embedding[3]` |
| 向量 · `qwen3.7-text-embedding` + `dimensions:1024` | 本轮网络断（前面几轮成功过 1024 维） | `.capabilities.embedding[4].net` |
| TTS · `/compatible-mode/v1/audio/speech` | **404**（不提供） | `.capabilities.tts[0]` |
| TTS · 兼容 chat + `modalities:['text','audio']` | **400** `invalid_parameter_error: The voice property is required.` | `.capabilities.tts[1]` |
| TTS · 原生 `aigc/multimodal-generation` · `qwen3-tts-flash` | **200**，203564 字节 wav，4.24 s，头已修 | `.capabilities.tts[2]` + `samples/tts-native-aigc-qwen3-flash.wav` |
| TTS · 原生 `audio/tts/SpeechSynthesizer` · `qwen-audio-3.1-tts-flash` | **200**，199724 字节 wav，4.16 s，头已修 | `.capabilities.tts[3]` + `samples/tts-native-synthesizer-qwen-audio.wav` |
| ASR · `qwen-audio-3.0-asr-flash`（URL 输入） | **200**，转写「欢迎使用阿里云。」，2 s，9.9 s | `.capabilities.asr[1]` |
| ASR · `fun-asr-flash-2026-06-15`（URL 输入） | **200**，「关于使用阿里云。」（首词错） | `.capabilities.asr[0]` |
| ASR · `qwen-audio-3.1-asr-flash`（URL 输入） | **200**，「关于使用阿里云。」（首词错） | `.capabilities.asr[2]` |
| ASR · `/compatible-mode/v1/audio/transcriptions` | **404**（兼容模式不提供该路由） | `.capabilities.asr[3]` |

## 对照组（用来区分「服务端问题」和「本机链路问题」）

| 请求 | 请求体 | 结果 | 说明 |
| --- | --- | --- | --- |
| 原生 ASR，`model:'does-not-exist-xyz'`，URL 形状 | < 1 KB | **404 `Model not exist.`** | 路由存在、鉴权通过 |
| 原生 ASR，`qwen-audio-3.0-asr-flash`，`https://example.invalid/a.wav` | < 1 KB | **400**（返回 `sentence` 空结构） | 形状被接受 |
| 原生 ASR，同模型，`data:audio/wav;base64,QUJD`（3 字节假音频） | < 1 KB | **400** | base64 形状也被接受 |
| 原生 ASR，真 TTS wav 的 base64（约 290 KB 体） | ~290 KB | 连续 5 次 `ECONNRESET`/`UND_ERR_SOCKET`/握手超时 | **断在传输层** |
| 原生 ASR，`does-not-exist-xyz` + 800 KB 纯填充 base64 | ~781 KB | 连续 3 次传输层断 | **与音频内容无关，只与体积有关** |
| 同一个 URL 形状，换成公开 mp3 URL | < 1 KB | **200**，转写正确 | 服务端能自己取到音频 |

结论：**「base64 大请求体失败」是本机代理链路的问题，不是百炼拒收。** 关掉 `HTTPS_PROXY` 之后没再试（不想把整条链路搞成直连），留给下一轮。

## 没验证到的

- 全模态 `qwen3.8-omni-flash` / `qwen3.5-omni-flash` 的 `input_audio`：两次都传输层断，**没有任何结论**。
- 本地音频走 base64 的 ASR：被上面的代理问题挡住。
- 真实录音（噪声/方言/专有名词）的识别质量：本轮只有一个 2 s 官方示例。
- TTS 音色的主观听感：样本已落盘，要人耳听。

## 环境副作用

- 只在 `docs/logs/.../samples/` 写了 4 个 wav、在 `docs/logs/.../` 写了 `probe-final.json`。
- `registry.json`、插件代码、profile、宿主进程：**一个都没动**。
- key 只在 PowerShell 进程环境变量里出现过；`probe-final.json` 里只有 `prefix/length/sha256[:12]`。
