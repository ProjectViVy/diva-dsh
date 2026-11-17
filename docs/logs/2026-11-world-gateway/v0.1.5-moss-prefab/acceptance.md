# 验收 · v0.1.5（模思预接线）

前置：代码已改，宿主还跑着旧 bundle。`npm run stop` → `npm start`，然后硬刷新设置页。
本轮**不需要**填任何 key，也不需要联网；下面全部是「插槽与面板」的验收。

1. **分区与计数**：设置 → 世界网关，出现 **6** 张卡（最后一张是「实时语音」），
   计数是「已启用 0 / 6」，页面里没有 `[data-slot-error]`，旧的「实时语音（未接入）」虚线占位卡已消失。
2. **接入点有模思**：任一能力卡的「接入点」下拉里出现「模思 · MOSS API」。
3. **切模思自动换基址与模型**：把 `asr` 的接入点改成「模思 · MOSS API」→ 基址变成
   `https://api.mosi.cn`，模型变成 `moss-transcribe-1.0`，模型下拉有 2 个候选
   （`moss-transcribe-1.0`、`moss-transcribe-diarize-pro`），凭据引用名变成 `MOSS_API_KEY`。
4. **TTS 候选**：`tts` 切模思 → 模型 `moss-tts-1.5-flash`，下拉 4 个候选
   （1.5 Flash / 1.0 Pro / TTSD / 音色生成）。
5. **缺能力如实说**：`embedding` 切模思 → 模型被清空，没有候选下拉，说明写着
   「模思没有向量模型」；此时点保存应被拒并显示「模型名不能为空」。
   （`decision` 切模思同理，说明写着 Nex 属于 chat。两者都不会静默保存一个错配置。）
6. **实时语音插槽**：最后一张卡是「实时语音」，接入点下拉只有「模思 · MOSS API」一项，
   基址 `wss://api.mosi.cn/v1/realtime`，模型 `moss-live-1.0`，凭据引用名 `MOSS_API_KEY`，默认未启用。
7. **持久化**：把 `asr` 填成模思并保存 → 重启宿主后仍是模思；`GET /dsh-capability-hub/api/state`
   里有 `realtime` 插槽，`GET /api/resolve?capability=realtime` 在未启用时返回 `not_enabled`。

判定：1–7 全过即通过。第 3 步若基址没变，先看面板拿到的 `/api/catalog` 是否成功——
失败时候选为空、但接入点仍会切（基址由前端表带出）。

**明确不在本轮验收范围**：真实转写 / 合成 / 图像理解 / 实时对话（没有适配器、没有 key、
没有 WS 客户端），以及 `explore-endpoints.mjs --check`（需要 `MOSS_API_KEY`）。
