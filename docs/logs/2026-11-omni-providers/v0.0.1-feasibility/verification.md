# 验证记录 v0.0.1-feasibility

> 只写事实：命令、预期、实际。本轮 `pwsh` 不可用，验证全部是静态阅读与官方文档抓取。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | 读 `packages/llm/llm/src/types.ts:230-237` | 模态词表只有 text/image | `ModelModalityMap { text; image }`，无 audio/video |
| 2 | 读 `packages/llm/llm-pi-ai/README.md:36-73` | providers 配置面存在且支持 apiKeyEnv | 已确认；三种协议无 Decisions |
| 3 | 读 `plugins/asr/src/engine-registry.mjs:1-15` | 引擎契约含 cloud 位置 | `location: 'host-local' | 'cloud'` 已定义 |
| 4 | 读 `plugins/voice/src/voice-tts.js:100-113` | TTS 只走 voxd 协议 | `POST ${url}/v1/speak/file` 写死 |
| 5 | 读 `plugins/voice/src/voice-packs.js:1203` | 云端 TTS 凭据是火山字段 | `appId/accessKey/resource/speaker` |
| 6 | 抓取 `help.aliyun.com/zh/model-studio/qwen3-asr-flash` | 价格与接口 | ¥0.00022/秒；HTTP；音频 ≤5 分钟/10MB |
| 7 | 抓取 `help.aliyun.com/zh/model-studio/qwen3-tts-flash` | 价格 | ¥0.8/万字符 |
| 8 | 抓取 `help.aliyun.com/zh/model-studio/qwen3-8-omni-flash` | 输入模态 | 文本、图片、音频、视频 → 文本 |
| 9 | 抓取 `docs.siliconflow.cn/docs/api/audio-transcriptions-post` | ASR 接口 | `POST /v1/audio/transcriptions`，≤1h/50MB |
| 10 | 抓取 `docs.siliconflow.cn/docs/api/audio-speech-post` | TTS 接口 | `POST /v1/audio/speech`，CosyVoice2/MOSS-TTSD |
| 11 | 抓取 `docs.siliconflow.cn/docs/api/systemone-post` | 决策接口 | Alpha、免费、`Kev-4b`/`SemIf` |
| 12 | 检查 `pi-ai` 分类器目录 | JEV 可达路径 | `typesafe-system-one` + `jev-latest`，baseURL api.typesafe.ai |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| `npm test` | `pwsh` 执行器在 temp-root 校验处直接失败，任何命令都跑不起来 | 修启动器 `localEnvironment` 并重启后 |
| 真实 API 调用（ASR/TTS/omni） | 本轮没有 key，且用户未授权申请 | 用户选定 D1/D2 后 |
| 百炼控制台账单价 | 价格页为 SPA，`web_fetch` 只拿到壳 | 用户在控制台核对或提供截图 |

## 反向验证

无（纯文档，不涉及行为）。
