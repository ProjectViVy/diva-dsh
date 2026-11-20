# v0.2.0 世界网关 = 能力服务（ASR + TTS 统一供给）

主人 2026-11-18 07:04：「网关明确将其定位为某种服务——为外部组件提供……输入框的输入按钮特性
应该由语音输入统一管理，后面数字人的语音合成、语音识别都应该在这边进行统一管理……语音版块很多
还是没有清晰的标识，要明确可选究竟用的是本地语音包还是世界网关的包。」

## 一句话结论

世界网关从「合成一条线」升级成「一组能力方法」：`capabilityHub` 现在给
`speak('tts')` / `transcribe('asr')` / `status(cap)` 三个方法，识别与合成走**同一条进程内供给**；
语音识别多了第二个引擎「世界网关（千问）」，语音页把「现在用的是本地包还是世界网关」写在明面上。
**代码、测试、隔离实例端到端都过，只差重启 3082 一次让新代码进运行期。**

## 补记说明（先说实话）

本目录是 **2026-11-21 首次「全量上传」时补写的**。原会话（11-18 / 11-19）只留下 `TODOLIST.md`
条目与 `.artifacts/gw-verify/` 的现场日志，**没有落 `docs/logs/`**，而 TODOLIST 里的
`日志:` 已经指到这里——上传前把这个空链接补上，而不是让上游收下一份指不到的交付记录。

- **本次复跑过的**：三个套件（hub `tests/asr.test.mjs` 13/13、根 `tests/asr-gateway-engine.test.mjs`
  8/8、根 `tests/voice-settings-client.test.mjs` 22/22）与全量套件，见 `verification.md`。
- **只按当时记录引用的**：真 key 的端到端识别（3099 隔离实例）、3082 真面板观感。这两项本次
  **没有复跑**，理由写在各自的条目里，不冒充复跑结果。

## 做了什么

1. **网关侧（`plugins/capability-hub`）**：`speak.mjs` 新增 `createTranscribe`，与 `createSpeak`
   对称；`adapters/dashscope-asr.mjs` 走原生多模态路径（`/api/v1/services/aigc/multimodal-generation/generation`
   + `parameters.format/sample_rate`）；`http.mjs` 新增 `POST /dsh-capability-hub/api/asr`，
   请求体上限单独放宽到 12 MiB（16k/16bit 单声道 60 秒约 2.6 MiB base64，留足余量）；
   `index.mjs` 把 `transcribe` 一并 `ctx.provide('capabilityHub', …)`。
2. **识别侧（`plugins/asr`）**：新增第二个引擎 `src/engine-gateway.mjs`（id `gateway`，名称
   「世界网关（千问）」，`location:'cloud'`），通过 `ctx.inject(['capabilityHub'])` 取服务——
   用注入而不是 `ctx.get`，因为提供方可能比它晚就绪；`status()` 用 3 秒 TTL 快照，**不在面板轮询
   里发网络请求**；`transcribe()` 只做「规范 wav 读出来 → 交给网关 → 包成 AsrError」，不碰协议、凭据、
   缓存与审计（那些属网关或 service）。
3. **面板（`plugins/voice/src/client.js`）**：`ROUTE_PACK_ID` / `ROUTE_PACK_NAME` / `routeLabel` /
   `routePackId` 收成一处定义；总览写明「当前识别来源（云端/本机）」与「当前合成来源（具体到哪个包）」；
   语音包列表里当前线路那个包挂「当前合成来源」角标、其余挂「未使用」；识别页在引擎选择旁写出来源与就绪
   原因；并明确「SenseVoice 参数只对本机引擎生效」。顺手修掉真 bug：**dashscope 线路在总览被写成「本地合成」**。
4. **接线（根仓 `scripts/setup-capability-hub.mjs`）**：`asr` 插槽与 `tts` 共用同一把 key 与同一接入点，
   幂等接线；模型可用 `DSH_ASR_MODEL` 覆盖，默认 `qwen-audio-3.0-asr-flash`。

## 取舍

- **最简方案**：识别也走进程内服务，不新开进程、不新增依赖。备选是 asr 插件自己去 fetch 网关的 HTTP 面
  ——但服务端请求没有浏览器会话，必然 401（v0.1.4 已经踩过一次），所以不取。
- **为什么 12 MiB**：ASR 要把音频 base64 带上路由；网关既有的 64 KiB 上限是给 JSON 状态请求的，
  不改就只能识别半秒。放宽只对 `/asr` 这一条路由生效。
- **为什么不声明 `zh/en`**：语言提示还没验证能透传给上游，写上去等于假装支持。只声明 `auto`。
- **为什么 3 秒 TTL**：面板是秒级轮询，每次轮询打一次上游既慢又计费；3 秒足够跟上「刚填了 key」
  这类变化，又不会让面板一直停在旧状态。
- **实测偏慢就写进 pros/cons**：4.4 秒音频约 21 秒，这条写进引擎自述（`about.cons`），
  免得面板上看不出「为什么这么久」。

## 未验证（重启后要补）

1. **`/dsh-capability-hub/api/asr` 这条 HTTP 面的活体往返**：只有单元测试，面板真正走的是进程内路径。
2. **多语言提示透传**：`languages:['auto']` 是保守声明，没有用真上游验过 zh/en 提示是否被采纳。
3. **连续多次识别的限流与计费表现**：只做了单次端到端，没有压连续调用。
4. **3082 真面板观感**：四条来源标识只在渲染测试里过，没在真面板里看过。

## 日志

- `verification.md`：跑了什么、怎么跑的、失败过什么
- `acceptance.md`：重启后的验收清单
- `release.md`：影响面与回滚
- `evidence.md`：现场证据（路径 + 关键片段）
