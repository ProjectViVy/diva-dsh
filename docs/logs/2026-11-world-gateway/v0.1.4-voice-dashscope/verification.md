# v0.1.4 验证记录

## 1. 先建基线，再判断是谁弄坏的

改完第一次跑 `tests/voice-plugin.test.mjs` 有 **21 个失败**。这时候不能直接改测试——
得先知道哪些是本来就坏的。

做法：`git show HEAD:src/<file> > baseline-<file>`（工作区里 4 个文件都是修改过的），
把基线换进去重跑：

```
基线：156 项，10 失败
```

那 10 个失败全是本机 Windows 语义导致的**既有问题**，与本次改动无关：

```
✖ independent voice library lists project audio without following symlinks
✖ voice worker shutdown stops only the processes launched by the plugin
✖ voice pack management refuses a symbolic-link pack directory
✖ cloud configuration recovers after the process exits between voice and credential writes
✖ cloud configuration retains the completed update after a process exit before cleanup
✖ cloud configuration recovery refuses to overwrite an external edit
✖ cloud pack status and startup report a damaged recovery record instead of missing credentials
✖ reference audio refuses a symbolic link to a file outside the voice pack
✖ voice import cleanup refuses symbolic-link sources
✖ voice synthesis refuses a cache directory that is a symbolic link
```

沙箱不允许 `git stash`（`error: cannot create standard input pipe for update-index: Permission denied`），
所以基线是用 `git show` 导出的副本手工换回去的；换回前把改动过的 4 个文件备份到
`.artifacts/voice-backup/`。

**这一步救了一次自己**：换回基线时发现我的 `voice-packs.js` 里有一段重复注释和一处
未定义调用（`gatewayConfigured` 写了但删掉了），如果直接对着「21 失败」调测试，会把
真 bug 掩盖过去。最后选择**照着基线重新逐条应用改动**，而不是在 21 失败的基础上一处处打补丁。

## 2. 三个真 bug

| 现象 | 根因 | 修法 |
| --- | --- | --- |
| `probePort(null)` 抛 `ERR_MISSING_ARGS`（3 个测试挂掉） | 世界网关包 `port: null`，但 `statusOne` / `activate` 等处仍无条件探端口 | `probePort` 开头挡住非正整数端口；`activate` 的循环跳过 `external`/无端口包 |
| `synthesizeToFile` 对网关 404 | 路径写死 `/v1/speak/file`，网关是 `/tts` | `synthesizeToFile` 收 `speakPath`，`service.mjs` 按线路传 |
| 百炼 wav 时长算出来 44739241 ms | 流式 wav 头里 `data` 长度是占位值 | 新增 `repairWavHeader`，只改畸形头，正常 wav 返回同一个 Buffer |

前两个是端到端探针抓出来的，不是读代码看出来的——所以这一步不能省。

## 3. 测试本身的坑（记下来免得下次再踩）

- **`node --test` 在本沙箱跑不了**：`spawn EPERM`。改为**直接 `node tests/x.test.mjs`**，
  并用 `cmd /c` 包一层重定向；`$out = & node ...` 会因命名管道被拒而失败。
- **日志文件被占用**：Edge/编辑器句柄会让 `> log 2>&1` 静默失败，结果读到的是**上一轮**的
  旧日志（一度让我以为测试没变化）。每次换新文件名。
- **假上游的端口不能在 handler 里读闭包变量**：`ds.base` 在 `listen()` 之后才被赋值，
  handler 里读到空字符串，URL 变成相对路径，表现成 502。用一个外层 `let base = ''`
  在 listen 之后赋值。
- **测试里 `SLOT.baseURL` 必须是假上游地址**：一开始忘了替换，真的去连 `https://placeholder`。

## 4. 最终结果

```
tests/voice-plugin.test.mjs            156 项  154 通过  0 失败  (2 skip)
tests/voice-core.test.mjs                6 / 6
tests/voice-policy.test.mjs              6 / 6
tests/voice-settings-client.test.mjs    21 / 21
tests/voice-send-pipeline.test.mjs      15 / 15
tests/voice-registration.test.mjs        6 / 6
tests/capability-hub-setup.test.mjs      5 / 5（新增）
plugins/capability-hub/tests/
  candidates 5/5 · catalog 5/5 · client-render 5/5 · http-catalog 4/4
  http-tts 7/7（新增） · registry 7/7
```

4 个改动过的源文件 `node --check` 全部 exit 0。

## 5. 端到端（假上游）

```
route = dashscope   aiEnabled = true   character = "Cherry"
endpoints.dashscope = http://127.0.0.1:29967
gateway saw: ["/tts"]
synthesize ok: durationMs = 800   cached = false
wav header declared data len = 38400   actual = 38400   ← 畸形头被修好
```

假上游故意回 `data` 长度 = `0x7fffff0` 的 wav，落盘后声明长度等于实际长度。

## 6. 真实环境写入了什么

- `.artifacts/dsh-home/voice/packs/voice-dashscope/config.toml`
  （`[engine] endpoint = "http://127.0.0.1:3082/dsh-capability-hub/api"`）与 `.installed`
- `.artifacts/dsh-home/capability-hub/registry.json`：`tts` 插槽
  `enabled: true, kind: dashscope, model qwen3-tts-flash, baseURL llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com`
- `.artifacts/dsh-home/voice/config.json`：`route: dashscope`、`enabled: true`、
  `endpoints.dashscope`、`character: "Cherry"`（原文件备份在
  `.artifacts/voice-backup/voice-config.bak.json`）

**没有写入任何凭据**：`.credentials.yaml` 的 `refs` 里没有 `DASHSCOPE_API_KEY`，
仓库里也不存在 `sk-ws-` 开头的值（会话缓存里只剩这个前缀字面量）。

## 7. 真实进程验证（隔离实例，不碰 3082）

单元测试全绿之后仍然有一个 bug 是测试抓不到的，所以在独立实例上真跑了一遍。

**怎么隔离**：复制 `profiles/superagent-local` → `profiles/gw-verify`，只把 `cordis.patch.yml`
里的 `port: 3082` 改成 `3099`（`node_modules` 用 junction，不拷贝），然后用
`node --import tsx/esm apps/cli/src/bin.ts --profile gw-verify --no-open` 启动。
**3082 全程未动**（验证前后都确认在监听）。

CLI 没有 `--port` 参数——端口写死在 cordis patch 里，第一次尝试传 `--port 3099` 时
webserver 仍去绑 3082，报 `EADDRINUSE`，那次实例启动失败。记下来省得下次再试。

**鉴权**：网关要求会话，`/?token=<launch token>` 会 303 到一个 `dsh-auth-*` cookie，
带着它才能访问 `/dsh-capability-hub/api/*`。裸调用是 401，符合设计。

### 抓到的真 bug：`ctx.credentials.get` 不存在

```
HTTP 400  {"ok":false,"code":"REJECTED","error":"ctx.credentials.get is not a function"}
```

DSH 的 credentials 服务暴露的是 **`resolve(ref) → { value, source }`**，没有 `get`。
我的单测替身写的是 `get`，所以 7 个测试全绿——**替身和真实接口不一致，测的是替身**。

修了两处：`http.mjs` 改用 `resolve`（每次现解析，不缓存，凭据换了不用重启）；
`http-tts.test.mjs` 的替身改成 `resolve` 并注明为什么不能随手改。

顺带发现第二个问题：凭据检查排在空文本检查前面，导致空文本返回 502 而不是 400。
已调成「先验请求（免费）→ 再读凭据 → 再打上游」。

### 修完之后的实测

| 用例 | 结果 |
| --- | --- |
| `GET /state` | 200，tts 插槽 `enabled:true / qwen3-tts-flash` |
| 空文本 | 400 `EMPTY_TEXT` |
| 插槽关掉 | 409 `NOT_ENABLED` |
| 无凭据 | 502 `缺少凭据：DASHSCOPE_API_KEY 还没填` |
| **假 key** | 502 `合成失败：aigc：连不上百炼：fetch failed；SpeechSynthesizer：百炼返回 401：Invalid API-key provided.` |

最后一条是决定性的：**假 key 一路穿到了阿里云**，百炼原样回了 401。这说明凭据读取、
URL 拼接、两条协议回退、上游错误透出，在真实进程里全都工作。真 key 只差一步。

> 注：验证时往真实 `DSH_HOME` 的凭据存储写了一把假 key，验完已 `clear`。
> 事后核对 `.credentials.yaml` 内容与验证前逐字节一致（546 字节，`refs` 只有
> `OPENDESIGN_API_KEY`），只有 mtime 变了。

## 8. 真 key 实测（2026-11-18 02:5x）：上游拒绝，链路本身是通的

主人 02:52 在世界网关面板填了 `DASHSCOPE_API_KEY`（`sk-sp-` 前缀，114 字符，已核对
与粘贴值逐字符一致、无截断）。用隔离实例 3099 实测：

```
POST /dsh-capability-hub/api/tts  {"text":"你好呀，世界网关的语音包已经接好了。","voice":"Cherry"}
→ 502  elapsed=1633ms
  合成失败：aigc：百炼返回 401：Invalid API-key provided.
           ；SpeechSynthesizer：百炼返回 401：Invalid API-key provided.
```

为排除「是我的 URL 拼接错了」这种可能，绕开网关直接用这把 key 打了三个端点：

| 端点 | 结果 |
| --- | --- |
| `llm-0jydim7clhzcop0h.cn-beijing.maas.aliyuncs.com` | 401 `InvalidApiKey` |
| `dashscope.aliyuncs.com` | 401 `InvalidApiKey` |
| `dashscope-intl.aliyuncs.com` | 401 `InvalidApiKey` |

**结论**：不是代码问题、不是地址问题、不是代理问题——这把 key 本身不被百炼接受。
`InvalidApiKey` 是阿里云返回的原始 code，带着它自己的 `request_id`。

对照：本轮之前实测通过 200 的那把 key 是 `sk-ws-` 前缀、115 字符；现在这把是 `sk-sp-`
前缀、114 字符。**前缀和长度都不同，像是另一种 key 或另一个工作空间的凭证。**
`sk-ws-` 那把已经不在仓库和会话缓存里了（只剩前缀字面量）。

仍然可以确定的是：凭据读取 → URL 拼接 → 两条协议回退 → 上游错误原样透出，全都在真进程里
工作（假 key 那次也是拿到 401，只是那次我们已知它是假的）。**只差一把能通过校验的 key。**

## 9. 修复之后：真 key 打通，并抓到第二个真 bug

主人换了 key（`sk-ws-` 前缀、116 字符）。先绕开网关直连百炼：**200**，返回 OSS 音频链接，
`usage.characters = 4`。key 可用。

网关 `POST /tts` 也是 **200**：

```
status=200  content-type=audio/wav  bytes=153644  x-duration-ms=3200
wav: RIFF/WAVE 24kHz mono 16bit  声明长度 == 实际长度  RMS −22.4dB  峰值 0.496（不是静音）
```

### 第二个真 bug：语音插件调网关必然 401

但走**语音插件自己**的试听接口时失败：

```
POST /dsh-voice/api/voice/preview  {"id":"voice-dashscope",...}
→ TTS 服务返回 401：会话未通过验证
```

原因不是配置：网关的 HTTP 面要求浏览器会话（`connection.requestRejection`），而语音插件是
**服务端**发起的请求，没有 cookie——这条路在架构上根本走不通，不是把 key 填对就能解决的。

**修法**：网关把合成能力作为进程内服务暴露（`ctx.provide('capabilityHub', { speak })`），
语音插件用 Cordis 的方式订阅（`ctx.inject(['capabilityHub'], ...)`，与同文件里接
`orchestrator` 是同一写法），命中时把一次 `fetch` 转成一次进程内调用；拿不到服务就退回 HTTP。
两个入口共用 `speak.mjs` 一份实现，不会出现「面板能合成、插件不能」的分裂。

修的过程中我自己制造并修掉了一个 bug：编辑时在 `synthesizeToFile({...})` 里留下了
`fetchImpl: ... , fetchImpl,` 两个同名键，后者覆盖前者，于是**静默退回 HTTP**、继续 401，
而且没有任何报错。这正是那种「看起来改完了其实没生效」的坑。

修复后实测（干净代码，无诊断日志）：

| 入口 | 结果 |
| --- | --- |
| 网关 `POST /tts` | 200，`audio/wav`，153644 字节，3200ms |
| 语音插件 `POST /voice/preview`（进程内） | 200，`audio/wav`，88364 字节 |
| 二次调用（同文本） | 18ms 命中缓存，字节一致 |
| 时长随文本变化 | 2 字 → 400ms；84 字 → 18800ms，sha256 不同 |

最后一行是特意做的：两次请求字节数撞巧一样，必须排除「把上一次的音频又发回来」。

### 新增测试

`tests/voice-gateway-inprocess.test.mjs`（4 项）盯住这条链路：`fetchImpl` 写成「一旦被调用
就失败」，只要实现悄悄退回 HTTP，测试立刻红——不用等真机上冒出一句难懂的 401。
其中一条还断言「网关线路不会退回本机 voxd 端口」。

## 10. 未验证

1. **3082 真面板的观感**：第三条线路的下拉项、地址输入框、试听按钮只在渲染测试里过，
   没在真浏览器里看过。隔离实例 3099 起来过，但没开浏览器看。
2. **重启后的 3082 里 `voice-dashscope` 经 DSH 插件加载链路挂载**：本轮隔离实例用的是
   同一套 profile 与真实 `DSH_HOME`，`dsh-capability-hub` 与 `dsh-local-voice` 都真实加载了，
   服务注入也生效（诊断日志确认 `hub=object`），但真 3082 要等你重启才算数。
3. **浏览器里点「试听」按钮**：接口层已实测 200，但按钮 → 播放这一段没点过。

> 示例音频没有留：合成的 wav 里是真实人声，属于一次性验证产物，不入库。

## 11. 重启之后「跑不起来」：三个根因

主人 05:07 重启后反馈「跑不起来」。查下来是三处独立的错，都在**面板到进程内**这条路上；
合成本身没问题——所以之前接口层的验收全绿，一进面板就露馅。

### 11.1 探活走 HTTP，永远 401 → 面板永远显示「已安装 · 已停止」

`probeGateway()` 去 fetch 网关的 `/health`。两个问题叠在一起：

1. 网关根本没有 `/health` 这个路由（只有 `/state`、`/resolve`、`/catalog`、`/slot`、
   `/credential`、`/tts`）。
2. 就算有，那也是**服务端**发出的请求，没有浏览器会话，一定被会话校验拒成 401。

后果不只是显示错误：`client.js` 里「测试合成」按钮在 `!pack.running` 时是禁用的，
所以那个按钮是灰的——这正是「跑不起来」的直接观感。

**修**：网关把就绪状态也作为服务暴露（`capabilityHub.status()`），语音插件的探活改问进程内，
拿不到服务才退回 HTTP。判据（插槽启用 / 有适配器 / 凭据填了）本来就在进程里，不必绕一圈 HTTP。

### 11.2 `manifests()` 的合并顺序把语音包的完整定义吃掉了

`service.mjs` 会往 `cfg.voicePacks.manifests` 塞一条 `{ id: 'voice-dashscope', url }`。
而 `manifests()` 原来是先合并这条补丁、再判断「要不要加网关包」：

```js
for (const m of extra) byId.set(m.id, { ...byId.get(m.id), ...m })   // 先占住 id
if (byId.size && !byId.has(GATEWAY_PACK.id) && gatewayEndpointOf(cfg)) byId.set(...)  // 永远不执行
```

`byId.get(m.id)` 此时是 `undefined`，于是补丁把 id 占住，`external: true`、名称、音色全没了；
随后 `!byId.has()` 已为假，完整定义再也加不进来。结果这个包被当成「本地包但端口是空的」，
`probePort(null)` 直接判死。

**修**：先放完整定义，再让补丁覆盖字段。补丁只该补 `url`，不该抹掉定义。

### 11.3 「测试合成」自己又 fetch 了一次

`packs.test()` 对网关包拼了 `${endpoint}/tts` 直接 fetch——同一个 401 病。
**修**：命中进程内服务时直接调 `speak`，并复用 `wavDurationMs` 算时长。

### 11.4 修完之后的实测（隔离实例 3099，真 key）

| 面板动作 | 接口 | 结果 |
| --- | --- | --- |
| 打开语音页 | `GET /voice/packs` | `running: true`、`external: true`、`gateway.tts.ready: true`、`model: qwen3-tts-flash` |
| 测试合成 | `POST /voice/packs/test` | 200，115244 字节，2.4 s |
| 试听 | `POST /voice/preview` | 200，`audio/wav`，119084 字节 |
| 启动 / 停止 | `POST /voice/packs/{start,stop}` | 200 `{already:true}` / `{already:true, external:true}` |

定向套件 270 项 / 268 通过 / 0 失败（2 skip）。

> 这三处都改在插件源码里，**需要再重启一次**才生效：05:07 那个进程跑的是修复前的代码。


