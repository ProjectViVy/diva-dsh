# 验收单 v0.0.1-feasibility

## 本轮的验收（已完成）

- [x] `docs/research/omni-modal-external-providers.md` §0 给出五条路径的可行性结论
- [x] §2 两家能力表每条都有官方 URL 或仓库行号
- [x] §3 每条路径写明工作量、落点文件、不采用备选方案的理由
- [x] §7 未验证项逐条可补
- [x] §8 决策点收敛为 D1–D5

## 下一阶段验收（用户拍板后）

### A. 对话路由（0.5 人日）

- [ ] `cordis.patch.yml` 新增 `bailian` / `siliconflow` 两条 route，`apiKeyEnv` 指向 `.credentials.yaml`
- [ ] 重启后模型选择器出现两家模型
- [ ] 各发一条图片 + 一条文本，流式返回正常
- [ ] 错误路径：删掉 key 后请求返回 `MISSING_CREDENTIAL`，不是 500

### B. ASR 云端引擎（1–2 人日）

- [ ] `plugins/asr` 面板出现 `openai-asr` 引擎，`engine` 可切换
- [ ] 用同一段 16k 单声道 wav，云端识别与本地 `sensevoice` 结果都可读
- [ ] 401/429/超时分别映射为可读错误码，不冒充「模型没准备好」
- [ ] 断网时自动/手动回退本地引擎，不抛裸错误
- [ ] `node --test tests/asr-*.test.mjs` 全绿（含新引擎替身）

### D. 媒体理解工具（2–3 人日）

- [ ] 工具能接收本地路径或 URL，返回文本并进会话日志
- [ ] 视频/音频超限时明确报错（大小、时长、格式）
- [ ] 不新增 harness 公开模态；`ModelModalityMap` 不变

### C. TTS 外部线路（2–3 人日）

- [ ] `voice.tts.route` 新增外部线路，设置页可选
- [ ] 合成音频能被 `wavDurationMs` 或 ffprobe 正确取时长
- [ ] 缓存与限流沿用现有逻辑；key 不落 `config.toml`
- [ ] 断网/超时有可读错误，不静默发空音频

### E. 决策 / JEV（待 L3）

- [ ] 明确选型：OpenRouter `openai-decisions` / api.typesafe.ai / 硅基流动 alpha
- [ ] 一次最小探针（约 80 题）拿到真实延迟与准确率，再谈接入
