# v0.0.1-feasibility 外置全模态 Provider（百炼 / 硅基流动）

- 状态：已交付（**纯文档，未改代码/配置，未申请任何 key**）
- 范围：`docs/research/omni-modal-external-providers.md`（新建）；`TODOLIST.md`（登记）；本日志目录
- 验证：见 `verification.md`（官方文档逐条抓取 + 仓库接缝逐条带行号）
- 未验证：`qwen3-asr-flash` 的 OpenAI 兼容路径、omni 音视频单价、硅基流动语音价格、TTS 返回格式
- 下一步：用户回答 §8 的 D1–D5；默认先做 A（配置级 chat 路由）→ B（ASR 引擎）
- 回滚：删除报告与本日志目录即可；未触碰运行时

## 改了什么

行为层面**没有变化**。本轮只回答「两家外置 provider 能不能接、接在哪、代价多少」。

五个结论：

1. **chat 模态只有 text|image**（`packages/llm/llm/src/types.ts:230-237`），百炼 omni 的音视频输入进不了现有路由；要接就写工具，别扩 harness 词表。
2. **ASR 接缝最干净**：`plugins/asr/src/engine-registry.mjs` 的契约本就含 `location: 'cloud'`，加一个 OpenAI 兼容引擎即可同时吃百炼与硅基流动；百炼 `qwen3-asr-flash` ¥0.00022/秒。
3. **TTS 不能只改 endpoint**：`plugins/voice` 只认 voxd `/v1/speak/file`，云端语音包凭据是火山引擎专用字段（`src/voice-packs.js:1203`）；需新增外部线路客户端或本地适配进程。
4. **JEV 与两家无关**：硅基流动 `/v1/systemone` 是 TypeSafe 协议但模型为 `Kev-4b/SemIf` 且 alpha；真 JEV 在 pi-ai 里有 `typesafe-system-one`（`jev-latest`），但 DSH 没有分类器消费端。
5. **「音乐识别」要拆语义**：内容理解 omni 可做；听歌识曲两家都不提供，需指纹服务或「描述 + 联网搜索」间接方案。

推荐顺序 A（0.5d）→ B（1–2d）→ D（2–3d）→ C（2–3d）→ E（等 L3）。

## 影响面

- 用户可见行为：无。
- 数据：无。
- 性能：无。
- 依赖方：无。
- 重启要求：**无**（纯文档）。

## 未验证

1. `qwen3-asr-flash` 文档标注「HTTP（OpenAI 兼容）」，但未实测路径与鉴权；需一次 curl。
2. 百炼 `qwen3.8-omni-flash` 的音视频 token 计价与延迟（价格页表格未抓到）。
3. 硅基流动语音分栏价格与 `/v1/systemone` 实际质量（alpha）。
4. `qwen3-tts-flash` 返回音频格式/采样率；`wavDurationMs` 只认 RIFF，mp3 需 ffprobe 兜底。
5. 本轮 `pwsh` 执行器不可用（见「备注」），所有验证均为静态阅读与官方文档抓取，未运行任何命令。

## 备注

- **环境问题（与本轮交付无关但影响验证）**：本机 `pwsh` 全部失败，根因是启动器把 `TMP/TEMP/TMPDIR` 指到工作区内（`scripts/lib/source.mjs:31-33`），而 Windows ACL 沙箱要求临时根在工作区外（`packages/sandbox/sandbox-local/src/index.ts:404`）。修法在启动器，需重启，不在本轮动。
- `more-faster-better-economical` skill 调用失败：它只存在于仓库 `skills/`，从未安装到 `$DSH_HOME/skills`（那里只有 `diva-dream`），而仓库 `skills/` 不是 DSH 的扫描根。本轮改为直接读 `skills/more-faster-better-economical/SKILL.md`。
- 按 `AGENTS.md` §6「不自动提交」，本轮未提交。
