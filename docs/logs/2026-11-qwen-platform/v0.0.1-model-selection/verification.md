# 验证记录 v0.0.1-model-selection

> 只写事实：命令/工具、预期、实际。禁止只写「通过」。
> 本轮为**纯文档交付**，无代码行为变化；验证形式是「抓官方文档 + 只读核对仓库接缝」。
> 注意：`pwsh` 本轮不可用（`Windows ACL temp root must be outside the workspace`，`DV-OPS-001` 未生效），
> 因此全部核对走 `read` / `grep` / `glob` / `web_fetch`。

## A. 官方文档（全部 HTTP 200，2026-11-11）

| # | 抓取 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `/docs/developer-guides/getting-started/introduction` | 拿到端点与旗舰模型 | `base_url=https://maas.qianwenaiapi.com/compatible-mode/v1`；示例 `qwen3.8-max`；兼容 OpenAI SDK |
| 2 | `/docs/api-reference/preparation/api-key.md` | 确认端点与双 key | 按量 `sk-ws-`（早期 `sk-`）/ Token Plan `sk-sp-`；**两套 key 与端点不可混用**；Promise 套餐不抵扣按量 |
| 3 | `/docs/developer-guides/getting-started/text-generation-models.md` | 模型矩阵 | 3.8/3.7/3.6/3.5 三代在售；`qwen3.8-flash` 1M/128k、图像+视频输入、函数调用、内置工具、结构化输出全 ✓；第三方含 `deepseek-v4.1-flash-1017`、`glm-5.3`、`kimi-k3` |
| 4 | `/docs/models/qwen3-8-flash.md` | 单价与上下文 | 输入 0.8 / 输出 2.7 / 缓存命中 0.1（元每百万 token）；输入上限 991808、输出 131072、思维链 262144 |
| 5 | `/docs/models/qwen3-8-max.md` | 旗舰单价 | 输入 12 / 输出 36 / 缓存命中 1.5；2.4T MoE；快照 `qwen3.8-max-0902` |
| 6 | `/docs/models/qwen3-7-plus.md` | 中档单价 | ≤256k：2 / 8；256k–1M：6 / 24；RPM 30000 / TPM 5,000,000 |
| 7 | `/docs/developer-guides/speech/speech-to-text-models.md` | ASR 选型 | `qwen-audio-3.1-asr-flash` ≤5 分钟/2GB、说话人分离 ✓、方言覆盖最全；`qwen3-asr-flash` 标注 OpenAI 兼容、≤10MB；`filetrans` ≤12 小时/2GB；`streaming` 走 WebSocket |
| 8 | `/docs/models/qwen-audio-3-1-asr-flash.md` | ASR 单价 | 输入 0.8 / 输出 2.7（元每百万 token），RPM 600 |
| 9 | `/docs/developer-guides/speech/tts-models.md` | TTS 选型 | `qwen-audio-3.1-tts-flash` 低延迟 + 复刻 + 设计 + 指令控制；`qwen3-tts-flash` 仅系统音色；`voice-enrollment` 10–20 秒样本复刻 |
| 10 | `/docs/developer-guides/getting-started/embedding-models.md` | 向量选型 | `qwen3.7-text-embedding-flash` 256/512/768/1024 维、128k、201 语言；**无 384 维档**；重排 `qwen3.7-text-rerank`（500 文档/30k） |
| 11 | `/docs/models/qwen3-7-text-embedding-flash.md` | 向量单价 | 0.125 元/M token；RPM 24000 / TPM 1,000,000 |
| 12 | `/docs/models/qwen3-8-omni-flash.md` | 全模态 | 文本/图片/音频/视频 → 文本；1M 上下文；113 语言；`use_multichannel`；0.8 / 2.7 |
| 13 | `/docs/developer-guides/text-generation/role-playing.md` | 角色扮演 | `qwen-plus-character` 32768 上下文、单价 0.8 / 2；`qwen-flash-character-2026-02-26` 262144 / 0.18 / 1.5；表中无函数调用能力 |
| 14 | `/docs/resources/free-quota.md` | 额度规则 | 每模型约 100 万 token、90 天；只抵实时推理，不含批量与内置工具；Token Plan key 不消耗免费额度 |
| 15 | `/docs/developer-guides/security-compliance/model-filing.md` | 合规 | 算法备案与大模型备案表齐全（通义/万相/DeepSeek/GLM/Moonshot/MiniMax…），页脚指向 `terms.alicdn.com` 服务协议 |

## B. 仓库接缝（只读）

| # | 读取 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml:17-33` | 确认现有 provider | **只有** `opendesign` / `openai-responses` / `https://amr-link.open-design.ai/v1` / `deepseek-v4.1-flash`；`agent-default-model` 指向它 |
| 2 | `plugins/asr/src/engine-registry.mjs:1-25` | 确认云端可用性 | 契约只有 `info/status/prepare/transcribe/dispose`，`location` 允许 `'cloud'`；但文件内**无任何内置引擎** |
| 3 | `plugins/asr/README.md:111-121` | 当前引擎清单 | 只有 `sensevoice`（host-local）；README 明写「新增引擎注册进 registry 即可，面板自动列出」 |
| 4 | `plugins/voice/src/voice-tts.js:90-113` | 确认 TTS 协议 | 只发 `POST {baseUrl}/v1/speak/file`，body `{text, format:'wav', sr:24000, ...}`；**无 model/voice 卡槽外的 provider 概念** |
| 5 | `plugins/dsh-mempalace/src/store/memory_store.mjs:68-70` | 确认维度约束 | `if (this.embeddingDim !== EMBEDDING_DIM) throw new Error('... must be 384 ...')`；`chunk.mjs:6` 定死 `EMBEDDING_DIM = 384` |
| 6 | `plugins/dsh-mempalace/src/config.mjs:14-15`、`store/embeddings.mjs:48-87` | 确认向量引擎 | `Xenova/all-MiniLM-L6-v2` + `@huggingface/transformers` 本地 pipeline；**没有 HTTP provider 抽象** |
| 7 | 本会话 `web_search` 调用 | 确认检索现状 | 返回 `Error: DeepSeek search has no API key for "DEEPSEEK_API_KEY"` → 搜索工具当前不可用 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 真实 HTTP 调用（延迟/首 token/看图/`enable_search`） | 未申请 key，且本轮明令「不申请 key」 | 用户拍板 D1 后，一次 curl 即可 |
| ASR 实际时价 | 文档只给 token 单价，未给音频 token 折算率 | 拿到 key 后跑 10 分钟音频看账单 |
| TTS 返回格式与采样率 | 文档未写 `qwen-audio-3.1-tts-flash` 的响应格式 | 同上 |
| 中文召回对照测（本地 vs flash embedding） | 需改 schema 才能跑全量；本轮只评估不实施 | 用户同意 D4 后，先做离线 20 条 query 对照 |
| `pwsh` 任何命令 | 沙箱 temp root 仍在工作区内（`DV-OPS-001` 需重启生效） | 重启 DSH 后 |

## 反向验证

- 未做。本轮无代码改动，无可回滚行为；回滚路径 = 删除 `docs/research/qwen-platform-model-integration.md` 与 `docs/logs/2026-11-qwen-platform/`。
- 已确认本轮写入仅限 `docs/` 与 `TODOLIST.md`；未触碰 `plugins/`、`superagent/`、`deepseek-harness/`、任何 profile 或密钥文件。
