# v0.2.0 现场证据

本文件只放可复核的事实，不含任何凭据。所有路径相对仓库根。

## 1. 证据在哪

| 文件 | 是什么 |
| --- | --- |
| `.artifacts/gw-verify/asr-probe.log` | 2026-11-18 07:17 上游形状探针：裸 base64 / data URL / 3.0 三组结果 |
| `.artifacts/gw-verify/probe-asr-base64.mjs` | 上面那组探针的脚本（不是测试，是现场工具） |
| `.artifacts/gw-verify/hub-asr.log` | 网关侧 `tests/asr.test.mjs` 输出：13/13 |
| `.artifacts/gw-verify/asr-engine.log` | 引擎侧 `tests/asr-gateway-engine.test.mjs` 输出：8/8 |
| `.artifacts/gw-verify/labels.log` | 面板标识 `tests/voice-settings-client.test.mjs` 输出：22/22 |
| `.artifacts/gw-verify/setup.log` | `npm run setup:capability-hub` 输出：tts + asr 两个插槽都已启用 |
| `.artifacts/gw-verify/instance.out.log` | 3099 隔离实例启动日志（3082 全程未动） |
| `.artifacts/gw-verify/speech16k.wav` | 端到端用到的 16 kHz 规范音频（148524 字节） |
| `.artifacts/gw-verify/transcribe-body.json` | 端到端 `POST /asr` 的请求体（含音频 base64，体积大，不要直接打开） |
| `.artifacts/gw-verify/engine.json` | 端到端时 `asr.engine` 的取值：`{"engine":"gateway"}` |

## 2. 上游形状（`asr-probe.log` 原文摘要）

```
wav=docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/samples/tts-roundtrip-cherry.wav bytes=222764 b64=297020
A 裸串 · 24k [try=500] 48095ms status=500 transcript=""
B data URL · 24k [try=ok] 21260ms status=200 transcript="你好，我是diva。这是一条语音合成冒烟测试。"
C 裸串 · 24k · 3.0 [try=500] 78008ms status=500 transcript=""
```

结论（钉进 `tests/asr.test.mjs` 的那条用例）：**音频必须是 `data:audio/wav;base64,…` 这种 data URL 形状**，
裸 base64 串会被服务端判 500，且失败前会白等 48–78 秒。

## 3. 接线产物（`setup.log` 原文）

```
voice-dashscope: 已接线 → http://127.0.0.1:3082/dsh-capability-hub/api
capability-hub: tts 插槽已启用（dashscope / qwen3-tts-flash）
capability-hub: asr 插槽已启用（dashscope / qwen-audio-3.0-asr-flash）
```

## 4. 端到端（3099 隔离实例，按 2026-11-19 的记录引用）

- `GET /dsh-asr/api/asr/catalog` → 200，`engine: "gateway"`，列表项含
  `gateway / 世界网关（千问） / cloud / ready=true / qwen-audio-3.0-asr-flash`。
- 踢引擎后 `POST /dsh-asr/api/asr/transcribe` → 200，转写「你好，我是Diva。这是一条语音合成冒烟测试。」
  与原文一致，耗时约 21.7 s。
- **这条没有在 2026-11-21 补记时复跑**：复跑要重启 3082 或再起一个隔离实例并消耗真 key 的额度，
  这次只做上传核对，不做运行期验证。`instance.out.log` 是那次的启动日志，不含请求日志
  （DSH 默认不记录 HTTP 请求）。

## 5. 复跑（2026-11-21 上传轮，本次真跑）

| 套件 | 结果 |
| --- | --- |
| `plugins/capability-hub/tests/asr.test.mjs` | 13 / 13 / 0 |
| `tests/asr-gateway-engine.test.mjs` | 8 / 8 / 0 |
| `tests/voice-settings-client.test.mjs` | 22 / 22 / 0 |

明细与全量套件见 `verification.md`。

## 6. 不含凭据

本文件与同目录其余文档都不含 key、baseURL 里的 workspace 域名或任何 token；`registry.json` 里的
`authRef` 只是**引用名**（`DASHSCOPE_API_KEY`），值在宿主的 credentials 里。
