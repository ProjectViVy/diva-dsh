# v0.1.4 语音包 / 世界网关 端到端证据

本文件只放可复核的事实，不含任何凭据。

## 版本

| 项 | 值 |
| --- | --- |
| 日期 | 2026-11-18 |
| 语音插件 | `plugins/voice`（工作区未提交） |
| 世界网关插件 | `plugins/capability-hub`（工作区未提交） |
| Node | v24.14.1 |

## 1. 接线产物

`.artifacts/dsh-home/voice/packs/voice-dashscope/config.toml`

```toml
[engine]
endpoint = "http://127.0.0.1:3082/dsh-capability-hub/api"
```

`.artifacts/dsh-home/capability-hub/registry.json` 的 tts 插槽：

```json
{"enabled":true,"kind":"dashscope","baseURL":"https://llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com","model":"qwen3-tts-flash","authRef":"DASHSCOPE_API_KEY","note":""}
```

`.artifacts/dsh-home/voice/config.json`：

```json
{"voice":{"tts":{"route":"dashscope","enabled":true,"endpoints":{"dashscope":"http://127.0.0.1:3082/dsh-capability-hub/api"},"character":"Cherry"}}}
```

## 2. 包列表（真实 stateDir）

```
{"id":"voice-local","installed":false,"external":false,"running":false,"port":8765}
{"id":"voice-cloud","installed":false,"external":false,"running":false,"port":8767}
{"id":"voice-dashscope","installed":true,"external":true,"running":false,"port":null,
 "gateway":{"ok":false,"status":401,"error":"网关返回 401：{\"ok\":false,\"code\":\"AUTH_REJECTED\"}"}}
```

`running:false` 是对的：3082 跑的是**旧代码**，还没有 `/tts` 与 health 里的插槽信息；
`401` 是网关对未带会话的请求的正常回答。重启后这个字段应变为 `ok:true`。

## 3. 端到端（假上游，不是真百炼）

用本地 HTTP 替身扮 DashScope：`aigc/multimodal-generation` 回 OSS 链接，`/audio.wav`
回一段 `data` 长度被写成 `0x7fffff0` 的 wav。

```
route = dashscope   aiEnabled = true   character = "Cherry"
endpoints.dashscope = http://127.0.0.1:29967
gateway saw: ["/tts"]
synthesize ok: durationMs = 800   cached = false
wav header declared data len = 38400   actual = 38400
```

要点：请求确实打到 `/tts`（不是 `/v1/speak/file`）；畸形 wav 头落盘前已被修成
声明长度 = 实际长度。

## 4. 网关 `/tts` 的协议契约

请求：

```http
POST /dsh-capability-hub/api/tts
Content-Type: application/json

{"text":"你好","voice":"Cherry"}
```

成功响应：

```http
HTTP/1.1 200
content-type: audio/wav
content-length: 48044
x-duration-ms: 1000
x-tts-model: qwen3-tts-flash
x-tts-voice: Cherry
```

失败：

| 状态 | code | 含义 |
| --- | --- | --- |
| 400 | `EMPTY_TEXT` | 文本为空 |
| 409 | `NOT_ENABLED` | tts 插槽没启用 |
| 501 | `NO_ADAPTER` | 该接入点类型还没有适配器 |
| 502 | `SYNTHESIS_FAILED` | 上游失败（消息里带百炼原始 code/message） |

凭据只在服务端从 registry 的 `authRef` 取，不出现在请求体、URL 或响应里。

## 5. 百炼侧调用形状（承接 v0.1.3）

1. 先试 `POST {host}/api/v1/services/aigc/multimodal-generation/generation`，
   body `{model, input:{text, voice, language_type:"Chinese"}}`，读 `output.audio.url` 或 `.data`。
2. 失败再试 `POST {host}/api/v1/services/audio/tts/SpeechSynthesizer`，
   body `{model, input:{text, voice}}`，读 `output.audio.data`（base64 wav）。

`baseURL` 里如果带 `/compatible-mode/v1`，会先剥掉再拼原生路径。

## 6. 真实合成（真 key，隔离实例 3099）

宿主 3082 供参考：pid 9884，启动于 2026-11-17 20:27，本轮全程未重启（uptime 425 分钟时仍在跑旧代码）。

| 入口 | 命令 | 结果 |
| --- | --- | --- |
| 网关 | `POST /dsh-capability-hub/api/tts` | 200，`audio/wav`，153644 字节，`x-duration-ms: 3200` |
| 语音插件 | `POST /dsh-voice/api/voice/preview` | 200，`audio/wav`，88364 字节 |
| 缓存 | 同文本第二次 | 18ms，字节一致 |
| 长度随文本 | 2 字 / 84 字 | 400ms / 18800ms，sha256 不同（排除复用旧音频） |

wav 校验（第一个样本）：RIFF/WAVE 合法、24kHz 单声道 16bit、声明长度 == 实际长度、
RMS −22.4 dB、峰值 0.496、非静音。

## 7. 测试

定向套件 **263 项 / 261 通过 / 0 失败**（2 skip）。

全量 `node --test tests/*.test.mjs`：**1484 项 / 1473 通过 / 1 失败 / 10 skip**。
唯一失败是 `tests/memory-actmem.test.mjs`「records, updates and restores from another subject are rejected」，
断言 `(await service.backups())[0]` 有值却在 `join()` 处收到 `undefined`。

归属判断（可复核）：该测试文件与它被测的 `plugins/memory-actmem` 本轮均未修改
（`git status --short tests/memory-actmem.test.mjs` 无输出），单独跑该文件同样失败，
故判定为既有问题、与本次改动无关，本轮未修。

## 8. 面板级验收（隔离实例 3099，修复「跑不起来」之后）

同一套 profile 与真实 `DSH_HOME`，只把端口改成 3099；用启动日志里的一次性 token 换会话
cookie，模拟浏览器调用面板会打的接口。原始输出：

```
=== GET /dsh-voice/api/voice/packs ===
status=200
pack: name=世界网关语音包 installed=True running=True external=True enabled=False
gateway: ok=True ready=True model=qwen3-tts-flash
endpoint: http://127.0.0.1:3082/dsh-capability-hub/api

=== POST /dsh-voice/api/voice/packs/test ===
status=200 elapsed=9228ms
{"ok":true,"ms":9208,"bytes":115244,"seconds":2.4,"duration":2.4}

=== POST /dsh-voice/api/voice/preview ===
试听 -> 200 3072ms ct=audio/wav bytes=119084

=== POST /dsh-voice/api/voice/packs/start ===
{"ok":true,"already":true,"gateway":{"ok":true,...,"tts":{"capability":"tts","ready":true,"model":"qwen3-tts-flash","kind":"dashscope"}}}

=== POST /dsh-voice/api/voice/packs/stop ===
{"ok":true,"already":true,"external":true}
```

修复前后对比（同一动作）：

| 动作 | 修复前 | 修复后 |
| --- | --- | --- |
| 打开语音页 | `running: false`、`external: false`、无 `gateway` 字段 → 显示「已安装 · 已停止」 | `running: true`、`external: true`、`gateway.tts.ready: true` |
| 测试合成 | 按钮灰（`client.js` 在 `!pack.running` 时禁用）；直接调接口得 `400 合成失败：HTTP 401` | 200，115244 字节，2.4 s |
| 试听 | 接口本身可用（不经面板判据） | 200，`audio/wav`，119084 字节 |

定向套件（含新增探活与 `status` 的用例）：**270 项 / 268 通过 / 0 失败**（2 skip）。

> 这三处修在插件源码里，宿主需重启才生效；05:07 那个 3082 进程加载的仍是修复前的代码。


