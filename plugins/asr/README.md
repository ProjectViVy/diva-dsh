# dsh-local-asr

`dsh-local-asr` 负责 DSH 中的**语音识别（ASR）**：把一段录音变成文字。

它从 DSH Harness 的实验性语音输入四件套移植而来 —— `speech-to-text`（服务定义）、
`speech-to-text-sensevoice`（本地 SenseVoice 推理）、`api-speech-to-text`（浏览器消费端）、
`client-ui-voice-input`（麦克风控件）—— 并**照 `dsh-local-voice` 的组织形式重写**：
自己持有配置、状态目录、引擎生命周期与面板，不依赖 `@deepseek-ai/dsh-experimental-*`。

## 与语音模块（dsh-local-voice）的对应关系

| 语音模块 | 本模块 | 说明 |
| --- | --- | --- |
| 文字 → 语音（合成） | 语音 → 文字（识别） | 方向相反，其余同构 |
| 语音包 `voice-local` / `voice-cloud` | 识别引擎包（当前只有 `sensevoice`） | 引擎可插拔，id 唯一 |
| voxd 外部进程（8765/8767） | SenseVoice 子进程（stdio 协议） | 都是「插件管生命周期、进程只做推理」 |
| 模型在语音包内 | 模型按内容寻址下载 + sha256 校验 | 参考官方 assets 清单，但自己落地 |
| `$DSH_HOME/voice/` | `$DSH_HOME/asr/` | 状态布局同构 |
| `/dsh-voice/api` + `/dsh-voice/internal` | `/dsh-asr/api` + `/dsh-asr/internal` | 面板面 + 组件面 |
| 面板页 `sidebar.panellist` id=`voice` | 面板页 `sidebar.panellist` id=`asr` | 同一个 slots 机制 |
| 发送编排（prepare/commit/abort） | 识别编排（prepare/transcribe） | 一步到位：录音进来，文字出去 |
| 语音模块无输入框控件 | `conversation.input.activity` 麦克风 | DSH 输入框的工具槽（单占用） |

**边界（本模块不做）**：不发任何消息、不碰 QQ/B 站网络、不写会话事件。识别结果交给
调用方（Web 输入框）决定怎么用；插件只保证「这段音频对应什么文字」。

## 状态布局

默认根目录来自 `DSH_HOME`，可用 `DSH_ASR_STATE_DIR` 覆盖（必须是绝对路径）：

```text
DSH_HOME/asr/
├── config.json        # asr 段：引擎选择、限制、缓存、审计、引擎参数
├── models/            # 已校验的 ONNX 资产（按引擎 id + 精度分目录）
│   └── sensevoice/int8/{model.int8.onnx, tokens.txt, silero_vad.onnx, ready.json}
├── cache/             # 识别缓存（内容寻址，可整目录删除）
├── tmp/               # 交给子进程的临时 wav，识别结束即删
├── data/
│   ├── ledger.json    # 限流时间戳，插件是唯一写入方
│   └── audit.jsonl    # 识别审计
└── runtime.json       # 组件面 IPC 地址与令牌（0600）
```

## 配置

`config.json` 的 `asr` 段：

- `enabled`：识别总开关，默认 `true`（模块本身只服务本机 Web 输入框，不对外发东西）。
- `engine`：当前引擎 id，默认 `sensevoice`。
- `limits`：`maxSeconds`(120) / `maxBytes`(8MiB) / `maxPerMinute`(6) / `maxPerHour`(120)，
  0 表示不限；超限在推理前拒绝，不占额度、不写审计为失败。
- `cache`：`enabled`(true) / `maxEntries`(200)，按 WAV 内容的 sha256 命中。
- `audit`(true)：是否写 `data/audit.jsonl`。
- `sensevoice`：`precision`(`int8`|`fp32`)、`threads`、`segmentSeconds`、`vadThreshold`、
  `minSpeechSeconds`、`minSilenceSeconds`、`vadOnsetPaddingSeconds`、`idleTimeoutMs`、
  `prepareTimeoutMs`、`inferenceTimeoutMs`、`maxPending`、`modelSources`。
- `ui`：面板展示相关（`language` 默认 `auto`）。

`precision=fp32` 会下载约 938MB 的模型；默认 `int8` 约 239MB，识别效果对本用途足够。

## 音频契约

推理侧只吃**规范 WAV**：16kHz、单声道、PCM16。这不是挑剔，而是让子进程不必做重采样，
也保证「上传什么就识别什么」。浏览器侧一律先重采样到 16k 单声道再上传。

两条通道对「不合规」的容忍度不同（有意为之）：

| 通道 | 非 16k / 双声道 PCM16 | 非 PCM / 非 16 位 / 损坏 |
| --- | --- | --- |
| 面板 `/dsh-asr/api` | **拒绝**（400，文案说清当前采样率/声道） | 拒绝 |
| 组件 `/dsh-asr/internal` | **自动归一**后识别，响应与审计带 `converted: { fromRate, fromChannels }` | 拒绝 |

理由：面板的音频是我们自己的浏览器代码产的，严格能抓 bug；组件通道的上游（例如 QQ 桥接把
SnowLuma `get_record?out_format=wav` 的结果喂进来）音频格式不归我们定，拒收等于整条链断裂。
归一方式是确定性的：双声道取平均下混 + 线性插值重采样到 16k，不引入随机与抖动
（`src/audio.mjs` 的 `normalizeWave()`）。要强制严格，内部通道传 `acceptCanonicalOnly: true`。

## 面板 API

前缀 `/dsh-asr/api`，只接受本机 Host、同源写请求，并经过 DSH `connection` 会话校验。

```text
GET  /asr/catalog                          # 引擎列表、当前选择、录音限制、准备状态
GET  /asr/prepare                          # 准备进度快照（面板轮询）
GET  /asr/rules / POST /asr/rules          # 读/写配置
GET  /asr/status                           # 运行态：worker、模型、最近一次识别
GET  /asr/audit?limit=20                   # 最近识别审计（1~200 条）
POST /asr/prepare                          # 下载/校验模型（幂等，可并发合流）
POST /asr/prepare-cancel                   # 取消准备（已下载文件保留）
POST /asr/transcribe                       # { audio(base64), language? } → { text, ... }
POST /asr/self-check                       # 分阶段自检
```

## 组件内部 API

前缀 `/dsh-asr/internal`，仅回环地址，请求头 `x-component-token` 必须等于
`$DSH_HOME/asr/runtime.json` 的令牌：

```text
GET  /health /catalog /prepare /progress /status /rules
POST /transcribe /prepare /cancel-prepare /rules /self-check
```

`POST /transcribe` 同时接受 `{ audio: <base64 WAV> }` 和 `{ path: <绝对 .wav 路径> }`；
后者是给同机组件省一次 base64 编码用的，仍然会被复制进 `tmp/` 再交给子进程，且不做路径白名单
（能读到组件令牌的进程本来就是这个用户）。`audio` 可以是任意 PCM16 WAV（见上面的音频契约），
非规范形态会被归一；返回体里会多一个 `converted` 字段说明从什么格式转来的。

将来若有别的组件（例如 QQ 入站桥接）要把语音转成文字，走这一面，不要直接读状态目录。

## 引擎包

引擎实现一个最小接口：`info`（id/名称/语言/位置）、`prepare()`（准备资产）、
`status()`（就绪度）、`transcribe()`（推理）。当前只有一个：

| id | 名称 | 位置 | 依赖 |
| --- | --- | --- | --- |
| `sensevoice` | SenseVoiceSmall | host-local | `sherpa-onnx-node`（含 ONNX Runtime 原生库）+ 模型资产 |

新增引擎（例如云端 HTTP 识别）时，注册进 `src/engine-registry.mjs` 即可，面板与
内部 API 自动列出；`engine` 配置项切换到新 id。

## 输入框麦克风

界面入口只有两处，都在 Web 端：

- **DSH 设置 → 语音**：由 `dsh-local-voice` 的客户端提供唯一的 `settings.section`，负责识别开关、
  语言、限额、缓存、SenseVoice 参数、下载源、模型准备、最近识别、进程诊断、自检与试听。
- **输入框工具栏的麦克风**（`conversation.input.activity`）：本插件的客户端只注册这个槽位。
  点一下开始录音，再点一下结束并识别，结果插入光标处。录音期间工具栏会展开成
  「取消 · 计时/电平 · 停止」；`Esc` 取消，超过 `limits.maxSeconds` 自动停。

本插件不再注册 `main` 或 `sidebar.panellist`，左侧栏没有「语音识别」面板。

两个刻意的选择：

1. **插入是「先占位、后校验」**：录音开始时 `captureInsertion()` 记下光标位置，
   识别回来再 `insertText(text, span)`。期间草稿被改过或输入框被锁住，插入会失败 ——
   此时**不覆盖你的字**，而是把结果挂起，等你点「插入」再放进去。
2. **失败不编造文字**：识别失败、超限、模型没准备好都只给提示，绝不往输入框塞占位文本。
   录音本身在浏览器侧重采样成 16k 单声道 PCM16（`OfflineAudioContext` + `MediaRecorder`），
   与音频契约一致。

## 接线与启用

本模块是**项目侧插件**，通过 profile bundle 加载：

1. `scripts/lib/component-setup.mjs` 的 `componentPackages` 里登记了
   `['dsh-local-asr', plugins/asr]`；
2. profile（`.artifacts/dsh-home/profiles/superagent-local`）的 `dependencies` 里是
   `link:.../plugins/asr`，`dsh.profile.bundles` 里有 `dsh-local-asr`；
3. 插件自己的 `sherpa-onnx-node` 装在 `plugins/asr/node_modules`（`pnpm install`），
   由子进程按文件位置解析，不走 DSH 主进程；
4. **改动 profile bundle 后必须重启 DSH 才会加载**。重启后一条命令确认（推荐）：

```sh
node scripts/check-asr-mount.mjs        # 文件层前置 + 实时探活 + 结论，退出码 0=挂上了
```

它做的事：先体检 profile 依赖 / bundles / 软链 / patch id 四项文件层前置，再探
`/dsh-asr/api/asr/status`、`/dsh-asr/internal/health`，并用 `/dsh-voice/...` 做对照。判据是
**401 = 挂上了**（DSH 会话中间件先拦，线上正常态）、**404 = 没挂上**、**503 = 挂了但
`connection` 服务缺失**。注意真实路由带 `/asr` 这一节：探 `/dsh-asr/api/status` 永远 404，
别据此以为没挂。只想手打也行：

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3082/dsh-asr/api/asr/status   # 401 = 已挂载
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3082/plugins/dsh-local-asr/client.js?rev=1
```

## 与官方实验性 Bundle 的关系

官方 `@deepseek-ai/dsh-experimental-voice-input-bundle` 提供同一件事（Web 麦克风 → 文字），
但它随包默认禁用、把识别放在 `ctx.speechToText` 注册表里、模型落在
`$DSH_HOME/speech-to-text/`。本模块与它**功能重叠、状态目录分离、互不依赖**：

- `conversation.input.activity` 是 `kind: 'single'` 的槽位，同一时刻只能有一个占用者，
  所以**两个都启用会互相抢位**；要用本模块就不要再启用官方 Bundle。
- 本模块的 provider id 只在自己的注册表里唯一，和官方的 `sensevoice-local` 不会冲突。

## 测试

```sh
node --test tests/asr-*.test.mjs
```

测试使用隔离状态目录、本地 HTTP 替身和假的子进程协议，不下载真实模型、不访问网络。
`tests/asr-client.test.mjs` 在 `node:vm` 里加载客户端产物，只验证注册到哪些槽位与初始渲染。
`tests/asr-audio-normalize.test.mjs` 用现场合成的正弦 WAV 验证归一（44.1k 双声道 → 16k 单声道）
与两条通道的容忍度差异；`tests/asr-registration.test.mjs` 守着「这个包真的被 profile 挂上」这件事
（componentPackages 条目、package.json 的 bundle/client 契约、patch 里的 id、以及活的 profile 里
依赖与 bundles 同时存在）——单测全绿但插件没挂上，是踩过的坑。

`tests/asr-mount.test.mjs` 用假 ctx + 真 HTTP 把 `apply()` 跑一遍：两个前缀都挂上、
`runtime.json` 写着真实端口与 64 位令牌、内部通道的令牌/Origin/未知路径守卫都拦得住、
模型没下载时给的是 `ASR_MODEL_MISSING` + 提示（而不是一句 failed）、卸载后路由与发现文件都清掉。
它守的是「handler 能跑」和「插件真的被挂上」之间的那道缝 —— 面板探活 404 而单测全绿那次就卡在这里。

`tests/asr-sensevoice-e2e.test.mjs` 是默认跳过的真机用例：真的加载模型、真的拉子进程、
用 macOS `say` 现场合成一句中文再识别。模型准备好之后这样跑：

```sh
DSH_ASR_E2E=1 node --test tests/asr-sensevoice-e2e.test.mjs
```
