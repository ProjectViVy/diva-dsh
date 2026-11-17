# v0.1.5 · 模思（MOSS）预接线

2026-11-18。世界网关从「四个接入点 / 五个能力」扩到「五个接入点 / 六个能力」，把模思的模型页与
MOSS-Live 参考接成可保存的插槽。**只接线，不实现适配器、不发真实推理请求。**

## 目标

主人 2026-11-18 03:03：「将 platform.moss.cn 的模型页与 MOSS-Live 参考接入，先做预制接线保证能力，
后面再进行实际应用开发。」——先把「接哪家、用哪个模型、用哪把 key」记下来，应用开发轮直接读。

## 做了什么

1. **接入点 `moss`**：API 主机 `https://api.mosi.cn`（文档站是 `platform.moss.cn`；
   `api.moss.cn` 404）。凭据引用名按规则派生为 `MOSS_API_KEY`。
2. **四条能力预接线**：`asr`（转写 / 多说话人转写）、`tts`（TTS 1.5 Flash / 1.0 Pro / TTSD / 音色生成）、
   `omni`（MOSS-VL，图/视频理解）、`realtime`（MOSS-Live 1.0，新增的第六个插槽）。
3. **`realtime` 插槽**：旧的面板「实时语音（未接入）」占位卡删除，换成真插槽：
   `wss://api.mosi.cn/v1/realtime` + `moss-live-1.0` + `MOSS_API_KEY`，只记录接入参数。
4. **按能力区分协议**：`realtime` 的基址必须是 `wss://`，其余能力必须是 `https://`。
5. **换接入点带出默认值**：切到模思时，基址、首个候选、凭据名一起换；
   这一家没有这类模型（模思没有向量）时模型为空、保存被拒，不会把百炼的 id 留在模思端点上。
6. **面板**：接入点列表加「模思 · MOSS API」；实时语音卡只列模思；`能力@接入点` 级说明
   （`embedding@moss`、`decision@moss`）在没候选时直接说清为什么。
7. **核对脚本**：`explore-endpoints.mjs` 支持 `MOSS_API_KEY`，把模思纳入 `/models` 对账。

## 为什么这样做

- **为什么用 `api.mosi.cn`**：文档正文的示例主机、`llms.txt`、以及直连探测都指向它；
  `api.moss.cn` 是 404，`platform.mosi.cn` 只是文档站的另一个域名（302 到 `platform.moss.cn`）。
- **为什么 `realtime` 是插槽不是适配器**：网关的插槽只管「绑定」；全双工会话要常驻 WS、打断语义与
  音频管线，是应用轮的事。把它存成插槽，才能让下一轮直接 `resolve('realtime')` 拿到
  地址/模型/凭据，而不是再猜一遍。
- **为什么模思没有 `decision` 候选**：Nex N2.6 是语言模型，按仓库既有边界归「设置 → 模型」，
  世界网关不管 chat；硬塞进决策插槽等于偷偷开一条 chat 旁路。
- **为什么 `tts` 选模思会 501**：`speak.mjs` 只有 dashscope 适配器；如实报「没有适配器」
  比编一个没验证过的请求形状好。这是「接线完成」与「能力验证通过」的分界。
- **备选方案**（未选）：把 `realtime` 保持成纯说明卡、只加 `moss` 接入点。省几十行，
  但下一轮还得重新决定地址与模型落在哪，违背「预制接线」的目的。

## 证据

- 研究记录：`docs/research/moss-world-gateway-wiring.md`（API 面、模型映射、MOSS-Live 协议要点、探测结果）。
- 测试：capability-hub 六个测试文件 **37 pass / 0 fail**；根仓两套相关测试 13 pass。
- 探测（无 key）：`api.mosi.cn` 的 `/v1/models`、`/v1/audio/speech`、`/v1/audio/transcriptions`、
  `/v1/responses`、`/v1/realtime` 全部 403 鉴权错，随机路径 404——主机、路由、鉴权层都在。
- 详见 `verification.md`；重启后的面板验收见 `acceptance.md`。

## 未验证

1. **没有真 key**：模思候选 id 全部来自官方模型页，没有用 `/v1/models` 核对过。
2. **没有适配器**：`tts`/`asr`/`omni` 的请求形状、错误码、异步任务都没跑过。
3. **没有 WS 客户端**：MOSS-Live 的握手、`attach_session`、音频帧、打断都没实测。
4. **3082 真面板**：宿主还跑着旧代码，六张卡与新下拉要重启一次才能看到。

## 下一步

1. 主人 `npm run stop && npm start` → 按 `acceptance.md` 走六步。
2. 有 `MOSS_API_KEY` 后：写进「世界网关 → 任一插槽 → 保存凭据」，
   然后 `node plugins/capability-hub/scripts/explore-endpoints.mjs --check` 核对候选表。
3. 应用开发轮先做一条能力（建议 `tts` 或 `asr`），MOSS-Live 另起一条（服务端 WS 代理优先）。
