# v0.2.0 影响面与回滚

## 改了哪些文件

**`plugins/capability-hub`（独立仓 `word-gateway`）**

| 文件 | 改动 |
| --- | --- |
| `src/adapters/dashscope-asr.mjs` | 新增：`transcribeWithDashscope`（原生多模态路径、data URL 形状、`format`/`sample_rate`、网络层失败重试一次、HTTP 错误不重试） |
| `src/speak.mjs` | 新增 `createTranscribe`（与 `createSpeak` 对称：插槽未启用 409、无适配器 501、空音频 400、缺凭据 502、上游错误 502 且保留原文）；`createStatus` 改为 `speakers ?? transcribers` 任一存在即可 |
| `src/http.mjs` | 新增 `POST /dsh-capability-hub/api/asr`，`ASR_BODY_LIMIT = 12 MiB`（只对这一条路由生效）；`readBody(req, limit)` |
| `src/index.mjs` | `ctx.provide('capabilityHub', { speak, transcribe, status })`；`registerHubHttp(…, speak, transcribe)` |
| `tests/asr.test.mjs` | 新增：13 项（插槽未启用 / 空音频 / 缺凭据 / 无适配器 / 参数透传 / 上游错误 / 空文本不算失败 / data URL 形状钉死 / 返回体提取顺序 / 路径与参数 / 网络重试 / HTTP 错误不重试 / 无 key 不发请求） |

**`plugins/asr`（独立仓 `dsh-local-asr`）**

| 文件 | 改动 |
| --- | --- |
| `src/engine-gateway.mjs` | 新增：`createGatewayEngine`（id `gateway`、`location:'cloud'`、`languages:['auto']`；`status()` 3 秒 TTL 快照、`prepare()` 无资产、`transcribe()` 只读规范 wav 并交给网关） |
| `src/index.mjs` | `ctx.inject(['capabilityHub'])` 订阅网关服务；注册第二个引擎；dispose 时按序取消订阅 |

**`plugins/voice`（独立仓 `dsh-local-voice`）**

| 文件 | 改动 |
| --- | --- |
| `src/client.js` | `ROUTE_PACK_ID` / `ROUTE_PACK_NAME` / `routeLabel` / `routePackId` 收成一处；总览写清识别与合成的当前来源；语音包列表加「当前合成来源」/「未使用」角标；识别页在引擎旁写来源与就绪原因；SenseVoice 参数卡标注只对本机生效；修掉 dashscope 线路被显示成「本地合成」 |

**根仓库**

| 文件 | 改动 |
| --- | --- |
| `scripts/setup-capability-hub.mjs` | 新增 `asr` 插槽幂等接线（`ASR_MODEL`/`ASR_BASE`，可用 `DSH_ASR_MODEL` / `DSH_ASR_BASE_URL` 覆盖），与 tts 共用 key 与接入点 |
| `tests/asr-gateway-engine.test.mjs` | 新增：8 项（云端来源与 languages / 网关没挂载 / 插槽未启用的原因透传 / 就绪带模型名 / 参数透传 16k / 上游错误保留原文 / 整个不可用给排查提示 / 临时音频读不到报音频无效） |
| `tests/voice-settings-client.test.mjs` | 新增 1 条：总览把当前来源写清楚（识别引擎点名、合成线路指到具体语音包） |
| `TODOLIST.md` | DV-VOICE-004 转 waiting-user；新增 DV-VOICE-005（默认策略待拍板） |

## 运行时状态（`.artifacts/`，不入库）

- `.artifacts/dsh-home/capability-hub/registry.json`：`asr` 插槽 `enabled:true`、`kind:dashscope`、
  `model:qwen-audio-3.0-asr-flash`、`authRef:DASHSCOPE_API_KEY`（与 `tts` 同基线）。
- `.artifacts/dsh-home/asr/config.json`：`engine` 被写成 `gateway`——**这是 3099 隔离实例测试时
  写进共享 DSH_HOME 的**，不是发货默认值。想退回本机：语音页「识别」页把引擎切回
  `SenseVoiceSmall（本地）`，或直接改这个字段。
- `.artifacts/gw-verify/`：探针脚本与日志（`asr-probe.log` / `hub-asr.log` / `asr-engine.log` /
  `labels.log` / `setup.log` / `instance.out.log` / `speech16k.wav` / `transcribe-body.json`）。

## 回滚

四层都能单独退：

1. **只想不再用它**（最轻）：语音页「识别」页把引擎切回 `SenseVoiceSmall（本地）`。
   网关引擎留在列表里不影响任何东西。
2. **退掉接线**：把 `registry.json` 的 `asr.enabled` 改回 `false`（或网关面板里关掉 asr 插槽），
   识别侧会自动报「插槽没启用」，不会静默降级。
3. **退掉代码**：
   - `plugins/asr`：`git -C plugins/asr checkout -- src/index.mjs && rm src/engine-gateway.mjs`
   - `plugins/capability-hub`：`git -C plugins/capability-hub checkout -- src/http.mjs src/index.mjs src/speak.mjs
     && rm src/adapters/dashscope-asr.mjs`
   - `plugins/voice`：`git -C plugins/voice checkout -- src/client.js`
   - 根仓：`git checkout -- scripts/setup-capability-hub.mjs && rm tests/asr-gateway-engine.test.mjs`
4. **退掉整轮**：本轮提交在三个插件仓与根仓各是一条 commit，`git revert` 那条即可；
   根仓的 revert 还要把三个 gitlink 指针一起退回。

## 风险

- **花钱**：识别按音频时长计费（阿里云百炼收取）。默认引擎在本机仍是 `sensevoice`，
  只有显式选了「世界网关（千问）」才会产生费用——但 `.artifacts/dsh-home/asr/config.json`
  现在被测试写成了 `gateway`，**这台机器重启后会默认用网关识别**。不想花钱先做回滚第 1 步。
- **慢**：4 秒音频约 21 秒（含一次传输重试），长音频按比例更长；面板会一直等，不会假装完成。
- **单点**：网关没起、插槽没开、key 失效、断网，四种都会让识别直接失败——失败是**明确报错**，
  不会静默回落到本机引擎（这是有意的：静默降级会让人以为音频没上传）。
- **本机代理**：大请求体偶尔被掐断，适配器在网络层失败时重试一次；两次都断就是明确失败。
