# v0.0.1-model-selection 千问AI平台选型评估：我们该接哪些模型

- 状态：已交付（**纯文档，未改任何代码、配置或 profile**）
- 范围：`docs/research/qwen-platform-model-integration.md`（新建）；`TODOLIST.md`（登记 DV-DOC-003）；本日志目录
- 验证：见 `verification.md`（8 次文档抓取 + 6 处仓库只读核对，全部有实际输出）
- 未验证：见下「未验证」段
- 下一步：`DV-DOC-003`，等用户回答 D1–D4
- 回滚：删除 `docs/research/qwen-platform-model-integration.md` 与本日志目录；未触碰任何代码或配置

## 改了什么

行为层面：**没有变化**。本轮只产出文档与状态登记，未修改代码、配置、profile、子模块，也未申请任何 key 或充值。

文档新增的内容（供下次会话直接复用）：

1. **平台事实**：对话端点是 `https://maas.qianwenaiapi.com/compatible-mode/v1`（OpenAI 兼容），
   另有 Anthropic / Responses / DashScope 三套协议；按量 key `sk-ws-` 与 Token Plan key `sk-sp-`
   **不互通**；每模型约 100 万 token 免费额度、90 天、只抵实时推理。
2. **与百炼的关系**：模型 ID 高度同名（`qwen3-asr-flash`、`text-embedding-v4`、`cosyvoice-v3.5`），
   但 base_url / key / 账单 / 额度是另一套 → 两份文档不能混抄。本文是
   `omni-modal-external-providers.md` 的续篇，五条接缝结论可复用。
3. **选型结论**（P0–P3 + 不接清单）：
   - P0 `qwen3.8-flash`（0.8 / 2.7 元每百万 token，1M 上下文、图像/视频输入、内置联网搜索）
   - P1 `qwen-audio-3.1-asr-flash`（0.8 / 2.7；≤5 分钟、支持说话人分离、方言覆盖最全）
   - P2 `qwen3.8-omni-flash`（音视频理解，0.8 / 2.7）与 `qwen-audio-3.1-tts-flash` + `voice-enrollment`
   - P3 暂缓 `qwen3.7-text-embedding-flash`（0.125 元/M token，256–1024 维）
   - 不接：图像/视频/3D/数字人/音乐/翻译/角色扮演/OCR/GUI/Deep Research，逐条给了理由
4. **为什么 P3 暂缓**：`memory_store.mjs` 硬校验 384 维、无 provider 抽象、需重建虚表 + 全量回填，
   且走 API 等于「全部记忆文本外发」；用户此前已叫停过一次。先做 20 条中文 query 召回对照测再定。
5. **今天实测到的现成缺口**：`web_search` 工具报 `no API key for "DEEPSEEK_API_KEY"`；
   平台的 `enable_search` 可以在不新增搜索 key 的前提下补上，但计费是另一条。

## 影响面

- 用户可见行为：无。
- 数据：无写入。
- 性能：无。
- 依赖方：无。
- 重启要求：**无**（纯文档）。

## 未验证

1. 所有价格均为文档页「原价」，不含活动折扣；未在控制台核对。
2. 未申请 key，因此延迟、首 token 时间、`enable_search` 质量、图像消息形状全部未实测。
3. ASR 只给了 token 单价，文档未给「每小时音频 = 多少 token」的折算率，无法换算真实时价。
4. `qwen-audio-3.1-tts-flash` 的单价与返回音频格式/采样率未抓到（直接影响 `wavDurationMs`）。
5. `qwen3.8-omni-flash` 的音视频单价与长视频延迟未实测（文档只给 token 价）。
6. 本地 SenseVoice 与云端 ASR 在同一批真实语音消息上的字错率差距未测。

## 备注

- 本轮**没有**提交（按 AGENTS.md §6「不自动提交」）。
- 四条待决策（D1–D4）写在文档 §8；其中 D1（只做 P0 还是 P0+P1）决定下一轮工作量，
  D4（要不要做召回对照测）决定记忆子系统要不要动 schema。
- `pwsh` 本轮完全不可用（沙箱 temp root 仍在工作区内，即 `DV-OPS-001` 的已知问题，**需重启生效**），
  因此所有核对都走 `read`/`grep`/`glob`/`web_fetch`，没有跑任何命令。
