# 验证记录 v0.0.1-design

> 本轮为纯文档交付；验证形式 = 官方文档抓取 + 上游源码只读核对。
> `pwsh` 不可用（工作区 TMP，DV-OPS-001 待重启），未跑任何命令。

## A. 官方文档

| # | 抓取 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | Token Plan 概览 | 套餐形态 | Credits 统一计量；个人/团队；接入工具列表含 DeepSeek Harness |
| 2 | Token Plan 个人版 | 模型清单与额度 | Lite/Essential/Standard/Pro = 39/79/139/312 元，20k/45k/80k/200k Credits；清单含决策模型但不含 embedding |
| 3 | Token Plan 团队版 | 团队差异 | 150/550/1298 元每席位；多 kimi/glm-5.1/MiniMax-M2.5；**决策模型仅个人版** |
| 4 | 个人版快速开始 | 端点 | `https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1`；`sk-sp-` |
| 5 | 接入概览 | 多模态端点 | 决策 `/compatible-mode/v1/systemone`；ASR/图像 `api/v1/services/aigc/multimodal-generation/generation`；TTS `api/v1/services/audio/tts/SpeechSynthesizer`；实时 `wss://.../api-ws/v1/realtime` |
| 6 | 决策模型接入 | 协议与限制 | TypeSafe System One；questions ≤16；choice ≤255；64k；示例 52.9 ms / 125 tokens |
| 7 | 决策模型 API | 返回结构 | `answers.{choice,probabilities,confidence}`；不支持流式/FC/搜索/结构化输出 |
| 8 | 语音识别接入 | Token Plan ASR 形状 | 仅 `qwen-audio-3.0-asr-flash`；DashScope `input_audio` Data URI；≤5 分钟 |
| 9 | DSH 接入指南 | 官方是否支持 | 有专页；给出 `llm-pi-ai.providers.qianwen-token-plan` 完整 YAML；`GET /models` 不支持 |
| 10 | MiniMax M Plan 概览 | 可用模型 | 文本仅 M3.1 Flash；图片 H3 Image；视频 H3（Explore 起）；声音模型可用 |
| 11 | MiniMax 用量规则 | 额度模型 | 5 小时 + 周双窗口；两个窗口独立刷新；图片/视频只受周窗口 |
| 12 | MiniMax API 概览 | 是否有 ASR | **无 ASR**：语言/视频/图片/语音合成(含复刻/设计)/音乐/文件/工具 |
| 13 | MiniMax 语言模型 | 协议 | Anthropic SDK（推荐）+ OpenAI SDK；M3.1-Flash 1M 上下文、原生多模态 |
| 14 | 百炼「向量化」文档（help.aliyun.com/zh/model-studio/embedding） | 同一把 key 是否有 embedding 面 | 有：`POST {WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/embeddings`，`Authorization: Bearer $DASHSCOPE_API_KEY`，模型 `qwen3.7-text-embedding`；另有 DashScope 原生 `/api/v1/services/embeddings/text-embedding/text-embedding` |
| 15 | 同上 | baseURL 形态与 key 粒度 | baseURL 带 `{WorkspaceId}`；文档明写「各地域的 API Key 不同」→ ref 实际粒度是 (账号, 地域/Workspace) |
| 16 | 硅基流动 `/v1/embeddings`（docs.siliconflow.cn/docs/api/embeddings-post） | 是否有 embedding 面 | 有：OpenAI 形状；`BAAI/bge-m3`(8192 ctx)、`Qwen/Qwen3-Embedding-*`；`dimensions` 仅 Qwen3 系列支持，可选 64/128/256/512/768/1024(0.6B)…，**无 384** |
| 17 | 硅基流动 `/v1/rerank` | 是否有重排 | 有：`BAAI/bge-reranker-v2-m3`、`Qwen/Qwen3-Reranker-*`，`query`+`documents`+`top_n` |
| 18 | 本仓库 `docs/research/omni-modal-external-providers.md:70-85` | ASR/TTS 形状与模型 | ASR `/v1/audio/transcriptions`(multipart，SenseVoiceSmall)、TTS `/v1/audio/speech`(CosyVoice2-0.5B，支持克隆/流式)、`/v1/systemone` 为 alpha（Kev-4b/SemIf，非 JEV） |

## B. 上游源码（只读）

| # | 位置 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `llm-pi-ai/src/config.ts:222-229` | provider 是否运行时可换 | `providers: Volatile<Record<string, PiAiProviderProfile>>`；注释明写「empty = dormant settings-driven posture，settings 一给就挂路由」 |
| 2 | `llm-pi-ai/src/index.ts:130-140` | settings 地址 | `settingsNs = fiber.entry.options.id`；`settingsPath: ['providers', provider]` |
| 3 | `llm-pi-ai/src/config.ts:193` | key 如何存 | `apiKeyEnv?: CredentialRef`（只存引用，不存明文） |
| 4 | `settings/settings/src/index.ts:224` | 谁能写 | 服务 `inject: ['configEditor','profileContext']` |
| 5 | `settings/settings/src/index.ts:357-390` | 写入语义 | `replace(ns, section, expectedRevision)` → `configEditor.edit(entry, (raw, inherited) => …)` |
| 6 | `settings/settings/src/index.ts:326` | 是否实时 | descriptor `applies: 'live'` |
| 7 | `settings/settings/tests/configuration.spec.ts:209` | 并发保护 | `changed during reload` 会抛错 |

## B2. 凭据链路（范围收缩后新增，2026-11-11 06:40）

| # | 位置 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `credentials-local/src/index.ts:624-632` | 是否有统一解析 | `resolve(ref)`：托管文件 → 启动环境 → `.env` 兜底，返回 `{value, source}` |
| 2 | `credentials-local/src/index.ts:634-643` | 能否显示状态 | `describe(ref)` 返回 `{configured, source: 'file'|'env'|'dotenv', writable}` |
| 3 | `credentials-local/src/index.ts:645-654` | 能否写入 | `set(ref, value)` / `unset(ref)`，写托管文件 |
| 4 | `ui-settings-models/src/client/operations.ts:79` | 主设置怎么存 key | `ctx.remote.credentials.set(ref, value)` —— 与中控台同一个服务 |
| 5 | `ui-settings-models/src/client/store.ts:125-127` | ref 怎么派生 | `deriveKeyRef` = `${provider.toUpperCase().replace(/[^A-Z0-9]+/g,'_')}_API_KEY`；UI 从不询问环境变量名 |
| 6 | `credentials-local/src/index.ts:656-676` | 是否有 list/modify | `listRecords()` / `modifyRecord()` / `readRecord()` |
| 7 | `ProviderEditor.tsx:272-274` | 显式 ref 会不会被覆盖 | 仅当 `apiKeyEnv` 尚未存在时才写入派生 ref；已有显式 ref 保持不变 |

结论：中控台用**显式 ref**调同一个 `credentials` 服务即可与主设置互通，不需要也不应该自建密钥存储。



## 跑不了的验证

| 项 | 原因 |
| --- | --- |
| 第三方插件能否调 `ctx.remote.credentials.*` / `ctx.credentials.*` | 需要写一个最小插件并重启；本轮只做设计 |
| `describe` 的 `source` 在 env/dotenv 下是否够用 | 需真机各配一次 |
| MiniMax 实际 baseURL / M Plan Key 可用性 | 无 key，且文档未给完整 baseURL |
| 三家余额 API 是否存在 | 文档中均未见 |

## 反向验证

- 未做（无代码改动）。回滚 = 删除文档与本目录。
- 本轮写入仅限 `docs/` 与 `TODOLIST.md`。
