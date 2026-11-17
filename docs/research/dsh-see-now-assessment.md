# dsh-see-now 评估：它能不能补上「让 diva 看见世界」的感知层

- 日期：2026-11-13 04:05（Asia/Shanghai）；04:12 补记（模型模态已补并实测读图）
- 对象：`SAOS-3624/dsh-see-now`；**05:35 起 canonical 改为 `vivy-dsh/dsh-see-now`（fork，`main@1d98dd5`，无 tag）**；npm `0.2.2`，源码 `0.2.3`（tag `v0.2.3`，2026-11-11），Apache-2.0
- 性质：只读评估。**未安装、未改本仓代码**；04:12 发起过一次 `read_image` 视觉请求（三张 README 图），用于验证模型层。验证计划见 §5。
- 方法：读源码 / README / CHANGELOG；核对 DSH `0.2.1-rc.5` 的接缝；对照本仓 `DV-DOC-006`、`DV-DOC-008`、`workbench-landscape` D-003。

> **04:12 补记**：用户已在 profile 给 `deepseek-v4.1-flash` 补上 `input: [text, image]`，本轮 `read_image` 实测成功（调试窗 / 逐场景 / 悬浮窗三张图均读到）。C1 的「模型层拒收」已解除；下面保留原始分析，C1 改为「`read_image` 层已验证，待 `see_now` 端到端复验」。新增 C7：可读性与空画布。
>
> **05:25 补记**：用户拍板安装并归入 `VIVY心核`。v0.2.3 已落地 `plugins/dsh-see-now/`，profile 已接线，客户端新增侧栏入口（order 16）；插件测试 500/479/0。运行期待一次重启验收，见 `docs/logs/2026-11-see-now/v0.2.0-install/`。
>
> **05:40 补记**：用户改线到 `vivy-dsh/dsh-see-now`，以 `main@1d98dd5` 为准。已改为 submodule；本地侧栏补丁存 `patches/see-now-vivy-core.patch`，由 `scripts/setup-see-now.mjs` 幂等应用；插件测试 503/482/0。该 main 比 tag v0.2.3 多 pack 的 `maxCrop` 改动（默认一格不裁），对 C7 的可读性有利，但仍待端到端看真实画面。
>
> **06:30 补记**：入口已按用户决定改为 `VIVY心核 → 我看到了` 管理面板，移除 `settings.section`；面板含总览/会话/记录/配置/隐私，`/api/see-now/lifecycle` 管 start/stop/window/clear。插件测试 510/489/0/21 skip；运行期 start/stop 与动作流水已验证，真实出图/token 未验。详见 `docs/logs/2026-11-see-now/v0.3.0-vivy-core/`。

## 0. 结论（先看这一段）

**有。它是「看见世界」这一环目前最缺、也最难自己造的一块；但它只是眼睛和耳朵，不是世界。**

- 它把 always-on vision 的三个生死点——**抓得到、只传变化、成本可控**——做成了产品，而不是 demo。静止屏幕几乎不出图、一镜到底按运动量取帧、硬切幻灯片每切一次留一帧；一张图塞 4–8 帧，价格按一张算。
- 它正好落在我们已经拍过的架构判断上：视觉不进 chat 模态、走工具（`DV-DOC-006` §0 第 4 条）；世界网关不接管 chat/vision（`DV-DOC-008`）；世界感知留在宿主核，壳只给帧与状态（`workbench-landscape` D-003）。**它不是竞品，是缺件。**
- 对我们的增量不是「多一个截图工具」，而是：diva 从「你贴给她看」变成「她陪你一起看」。悬浮窗 + `say` + 系统声转写 + 常驻循环，第一次让「陪看」成为可以长开的会话形态。
- 但它**不提供**理解（视觉模型）、记忆（看过什么）、人格/身体（Live2D）、我们自己的声音链路。它补的是感知层；剩下三层仍是 diva-dsh 的活。
- 当前仓库的硬前提**已在 04:12 解除**：`superagent-local` 的 `deepseek-v4.1-flash` 已声明 `input: [text, image]`，本轮 `read_image` 实测成功，端点确实收图。剩下的是「`see_now` 交付链路」的端到端复验，不是模型层。
- 推荐：先走 A（当天可验：link 安装 `v0.2.3` + `/seenow` 跑静态/视频两段；模型模态 04:12 已完成），再走 C（一周做声音、听觉、身体+记忆三座桥）。**不要先塞进 `third-party/` 的 pin 体系**：它没有 `dsh.compatibility.dshReleases`，也没有 `lib/`，会被本仓 `inspectThirdPartyPlugin` 直接拒。

### 这一环的分解

| 这一环 | 谁来做 | see-now 的位置 | 本仓现状 |
| --- | --- | --- | --- |
| 感知：屏幕 / 摄像头 / 视频 → 帧；系统声 → 文字 | see-now | **直接给**，连续流 | 没有 |
| 理解：看懂画面里发生了什么 | 视觉模型 | 不提供 | 当前模型 text-only |
| 记忆：看过什么、和谁看、记住多少 | ActMem / MemPalace | 不提供 | 有，但没接 |
| 表达：说、表情、身体 | `plugins/voice` + `dsh-live2d` | 提供 `say` 通道 | 有，需要 adapter / 桥 |

一句话：**它让 diva 睁眼；要让她「记得和你一起看过」，还差三座桥。**

## 1. 它到底是什么（证据，不是印象）

- 版本：源码 `0.2.3`（`package.json`），npm 上只有 `0.2.2`（registry `latest`，tarball 87 文件）；tag `v0.2.3` 指向 `7270d85`，`main` 已在其后继续提交。CHANGELOG 顶部自己标了「0.2.3 从来没发出去过」。
- 采集：`src/capture.js` 用 ffmpeg 抓屏（Windows `ddagrab`/`gdigrab`、macOS `avfoundation`、Linux `xdg-desktop-portal` + PipeWire），也支持摄像头与本地视频文件；`src/listen.js` 在 Windows 走 WASAPI 回环（支持按进程，失败退整机），不是只认麦克风。
- 选帧：`src/cuts.js` 在 64×36 网格上算 HSV 加权差，带运动补偿、未来帧确认、背景模型；区分「硬切」与「积分运动」，硬切每切一次留一帧，一镜到底攒够运动量才出帧。
- 拼图：`src/pipeline.js` + `src/pack.js` 做档位、DP 装箱、4×4 画布；`src/tokens.js` 按宿主 42px patch 网格算 token，宽度故意不对齐 16:9（798/1050/1260/1596），音频条塞进行高余量里，**加条不加钱**。
- 循环：`src/loop.js` 用 `agent.followup`（机器叫醒，排下一轮）和 `agent.steer`（用户插话，下一 step 就到）；`see_now({action:"watch"})` 是阻塞调用，默认最多 300 秒，攒够一张提前返回；工具超时 900 秒。
- 历史治理：`src/index.js` 写 `image/offload` 事件（默认 300 张触发 / 保留 100 张），把老图换成占位文本；README 把 `maxRequestImageBytes`（默认 20 MiB）与「省略会打掉前缀缓存」讲得很清楚。
- 接缝（与 rc.5 核对过）：`ctx.inject(['tools','attachments','sessionController'])`、`attachments.saveImage`、`sessionController.resolveAgent`、`agent.followup/steer`、`session.snapshotEvents()`、`commands`、可选 `webServer`；浏览器半身用 `window.__ModuleLoader__.load`，与 rc.5 的 client module loader 同协议。
- 工程形态：自带测试、CI、安装/发布守卫、插件失败落盘日志（`~/.dsh/see-now/plugin-error.log`）；注释大量记录的是「为什么」和踩过的坑，不是流水账。**这不是周末玩具。**

我没有复现它的主观效果：本轮模型不能读图（见 C1），README 里的调试窗/悬浮窗截图也读不了。下文对「效果」的判断来自代码、文档与架构核对，不来自亲眼所见；这一点保留给你实测。

## 2. 为什么它对我们是「缺件」

1. **它替我们做了最难的部分。** 持续抓屏本身不难；难的是「只传值得看的帧」「把多帧压成一张」「长会话不让图把上下文撑爆」。这三件事它都有测量、有失败复盘、有回滚开关。自己造一个同水平的，按它的 CHANGELOG 密度，至少是一周以上的高强度工作。
2. **它和我们的既有结论同向。** `DV-DOC-006` 的判断是：音频/视频不要进 harness 模态词表，**新增「媒体理解工具插件」**；see-now 对屏幕/摄像头/视频正是这个形状。`DV-DOC-008` 明确「不接管 chat/vision」；视觉不该塞进世界网关的五个插槽。`workbench-landscape` D-003 说「图像/视频输入与理解属于核，PEN 只提供帧与状态」；see-now 只交帧，理解留给宿主，边界干净。
3. **它把「陪看」做成了产品闭环。** 不是「调一次工具拿一张图」，而是「常驻 + 叫醒 + 说 + 听」：模型说 `say`，悬浮窗显示并念出来；用户打字插话走 `steer`；系统声转文字按「一句听到哪儿算完」的节奏喂给模型。这个闭环正是陪伴型 agent 缺的「在场感」。
4. **它给「她自己探索世界」留了接口，但不等于那个。** 摄像头、视频文件、区域模式、逐场景模式让它能看的不止桌面；但它是「你给她看」，不是「她自己出去看」。后者要靠 browser-use / computer-use / PENS 那条线，see-now 可以作为帧源，不能替代。

## 3. 卡点（按阻塞程度排序）

### C1 视觉模态：`read_image` 层已解除，待 `see_now` 端到端复验

- 04:12 前：DSH 的 `llm-pi-ai` 对未声明模态的模型默认 `['text']`（`deepseek-harness/packages/llm/llm-pi-ai/src/config.ts:80`）；本 profile 的 `opendesign` / `deepseek-v4.1-flash` 没写 `input`，`read_image` 在 provider I/O 之前就被拒，报错 `model "deepseek-v4.1-flash" does not declare image input`。
- 04:12：用户补上 `input: [text, image]`，本轮 `read_image` 连读三张 README 截图成功。**模型层已通，端点确实接受图片。**
- 机制保留：`input` 是「端点能力的声明」，不是探测；换模型/换 provider 时要重新声明并重新探针。
- 还剩一步：`see_now` 出图 → `attachments.saveImage` → tool result image → llm 请求，这条链上的图片大小、压缩、`maxRequestImageBytes` 与 tool result 渲染要跑一次真实 `see_now` 才能算通；不要拿 `read_image` 的通过直接推导它。

### C2 打包形状与本仓 third-party pin 不匹配

- 本仓 `scripts/lib/third-party.mjs:104-112` 要求：`dsh.compatibility.dshReleases` 覆盖当前 DSH 版本，且存在 `lib/index.js`、`lib/client.js`。see-now 两者都没有：`package.json` 只有 `dsh.bundle` / `dsh.client`，入口是 `src/index.js`，客户端是手写 `client.js`，没有构建产物。
- 它本来面向 `dsh plugin add` 的 npm 安装方式，和我们的「submodule + pin + build」不是一套。可选：① 上游补兼容元数据与 `lib/` 构建；② 本仓按「本地插件」接线，不放进 `third-party/`；③ 在 `third-party.mjs` 加一条有文档的例外（只对 source-entry 插件）。**建议先 ②**，上游稳定后再谈 ①/③。

### C3 环境：Windows 基本齐，Python 未验

- `ffmpeg` 在 PATH：`C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe`；插件也支持 `DSH_FFMPEG_PATH` / `FFMPEG_PATH` / `DSH_FFMPEG_DIR`。
- 路径尊重 `$DSH_HOME`（`src/binaries.js:34`、`src/tuning.js:213`），本仓 `.artifacts/dsh-home` 可用，不会硬找 `~/.dsh`。
- 悬浮窗需要 Python + Tk + `mss`/`Pillow`/`numpy`（`python-imageio` 路径），本机 Python 3.13 存在，但沙箱下 `python -c "import ..."` 被命名管道拒绝，**未验证**；核功能不依赖悬浮窗。
- 「听声音」只有 Windows（WASAPI）；macOS 需要 BlackHole 类虚拟声卡，本版未做；Linux portal 首次授权有差异。跨平台不是这一版的卖点。

### C4 隐私与同意：这是连续抓屏，不是单张截图

- 它抓的是整个屏幕（或用户框选的区域），画面里可能有密码、私信、财务页；插件没有 OCR/敏感内容过滤，也没有按应用排除。
- 它给了显式开关、区域选择、悬浮窗可见性、`stop`，这是好的；但对「一个常驻陪伴」来说还不够。建议产品默认：**陪看模式显式开启 + 常驻指示器 + 一键停 + 默认不把帧写进记忆，只写摘要**；敏感窗口先做快捷键/一键暂停，自动识别（按应用/密码管理器）以后再说。

### C5 成本：编码便宜，历史才贵

- README 的账算得很细：`low` 档 798×462 = **222 token/张**，4–8 帧同价；静止屏幕 20 秒才一张兜底。这是真的省。
- 但一张 798×450 PNG 约 130 KB，base64 后约 173 KB；`maxRequestImageBytes` 默认 20 MiB ≈ 120 张。默认 15–40 秒一张，**一小时就会撞线**；省略老图会改写会话历史、打掉前缀缓存。插件用 `image/offload` 提前省，但「省」本身也要重算一段上下文。
- 结论：它适合「陪看一段」，不适合「24 小时常开」。产品上应把「陪看」做成有开始/结束的会话，而不是默认常驻。
- 另外，README 的 token 数学按宿主 DeepSeek-V4 的 42px patch 网格；如果视觉模型换成 qwen/MiniMax，单价与网格不同，要重算，不能直接套 222。

### C6 成熟度：五天做出的 0.2.x，很强，但也意味着会变

- 0.2.3 未发 npm，`main` 还在动；音频仅 Windows；mac/Linux 路径较新；`snapshotEvents()` 是宿主 deprecated 但唯一可用的口子，未来 rc 升级可能动它。
- 采用时 **pin tag（建议 `v0.2.3`）**，不要跟 `main`；把「上游变更」当常规维护成本，而不是一次性集成。

### C7 可读性与空画布：看视频够，读屏幕小字不够（04:12 补记）

- 实测三张图：悬浮窗的文案是具体的（「黑底上一团白色的放射星芒」「depth map 右下角探进来一个深色的剪影——像猫的耳朵和脑袋挡住了镜头」），说明「模型真的在看」。调试窗也把「为什么留这一帧」摊开了：分数时间线、留帧/切点、占屏比、216 token 预估、页码——这是飞行记录仪，不是 demo UI。
- 但逐场景图里 4 帧拼 2×2，每格约 400×225；源视频只有 800×450，画面已经发糊。**看视频/看发生了什么够，读文档、代码、小字不够。** 这不是 bug，是 `low` 档的取舍：默认值服务「陪看」，不服务「阅读」。
- 建议加一个「阅读模式」：1–2 帧、`quality` 提到 `high`/`ultra`、`maxCrop:0`、尽量只抓 region；并让 `status` 报「这张图每格实际多少像素」。成本会涨（560/860 token/张），但读字场景值得。
- 另一个可见问题：逐场景图只用了上半张画布（「占用 50%」），下半张是空的，token 却按整张算。如果是为了固定档位/页码，至少要在 `status` 里把「内容占比」说清；如果不需要，裁到内容区能让每格大一倍，或省一半 token。
- `1/8` 角标在 4 帧的图上不好读：是「第 1 页/共 8 页」还是「帧 1/8」？建议改成明确文案，否则用户会怀疑参数没生效。

## 4. 决策清单（D1–D5，不拍板不实施）

| 编号 | 要拍的 | 选项 | 推荐 | 影响面 |
| --- | --- | --- | --- | --- |
| D1 | 「看见世界」第一版指什么 | A 陪你看见你的屏幕；B 她自己探索世界；C 两条并行 | **A 先做**，B 另立条目 | 决定 see-now 是主角还是帧源 |
| D2 | 感知前端自研还是采用 | A 采用 see-now；B 自研最小 capture→sheet；C 先用截图工具手工验证 | **A**（Apache-2.0，省一周以上） | 依赖上游节奏；换来成熟流水线 |
| D3 | 视觉模型走哪条 | A 给 opendesign 模型声明 image；B 新增 qwen3.8-flash 视觉路由；C MiniMax 等 | **A 已于 04:12 实测通过**；换模型再探 | 一行配置 vs 新 provider + key |
| D4 | 隐私默认 | A 显式陪看会话 + 指示器 + 区域 + 不落帧；B 默认常驻 + 全屏 | **A** | 产品信任；影响默认体验 |
| D5 | 集成深度 | A 只接工具；B + 声音/听觉；C + Live2D/记忆；D 上游化 | **A 当天 → C 一周 → D 稳定后** | 工作量 0.5 天 / 1–2 天 / 1 周 |

## 5. 推荐实施顺序（A → C → D）

### A. 当天验证（不改本仓代码，只动 profile 与本机 checkout）

1. ✅ **已完成（04:12）**：profile 已给 `opendesign.models[deepseek-v4.1-flash]` 加 `input: [text, image]`，`read_image` 实测通过。
2. 把 see-now 固定到 `v0.2.3` 的 checkout（放 `.workspace/see-now-v0.2.3` 或独立目录，不要 `main`）；`npm run stop` 后 `dsh plugin --profile superagent-local add link:<path>`；`npm start`。
3. 新会话跑 `/seenow`：先 2 分钟静止文档，再 2 分钟视频/幻灯片；记录出图张数、每张 token、CPU、端到端时延；`see_now({action:"status"})` 不应有 error。**这一步同时是 C1 的端到端复验。**
4. 通过后再做 C；若读屏幕小字发糊，先开「阅读模式」（C7）再谈别的。

### C. 一周做出「diva 的陪看」

- **声音**：写一个 `voice.json` adapter（`attach(api)`，约 50 行）转调 `plugins/voice` 的合成接口 / capability-hub 的 TTS 插槽；`api.emitSpoken` 的时机按 `examples/voice-say-mac.mjs` 的规矩来。
- **听觉**：`plugins/asr` 目前只暴露自己的 HTTP，不注册 `ctx.speechToText`；see-now 优先宿主 `speechToText`、否则读 `$DSH_HOME/asr.json` 的 OpenAI 兼容服务。两条路选一条：给 ASR 插件加一个 `speechToText` provider，或写一个 `asr.json` 兼容小桥。**不要**直接改 see-now 的 `listen.js`。
- **身体+记忆**：在 `say` / 每张 sheet 交付时发一个本仓事件，让 `dsh-live2d` 做视线/表情；每 N 张或 `/seenow stop` 时把「这一段时间看了什么」写成一条 ActMem 摘要（不写帧、不写原文），让下次会话能召回。这是把「看见」变成「记得」的关键一跳。

### D. 稳定后再上游化

给 see-now 提 `dsh.compatibility.dshReleases` + `lib/` 构建（或与本仓约定 source-entry 例外），再按 `third-party/pins.json` 的方式 pin；同时把 `snapshotEvents()` 的依赖列为上游风险。

## 6. 验收（A 阶段跑完看这四条）

1. 模型能说出**只有画面里才有**的变化（不是从文字上下文猜的）。
2. 2 分钟静止屏幕 ≤ 1 张兜底图；切窗口/播视频时按变化出图。
3. 一张图的 token 与所选模型/档位的实测一致；一小时陪看的 credits 可估算、可接受。
4. CPU/内存可接受；`say` 能被听到；`stop` 后不再抓屏；敏感内容不出现在日志里。

## 7. 参考

- <https://github.com/SAOS-3624/dsh-see-now>（README、CHANGELOG、源码；访问 2026-11-13）
- <https://registry.npmjs.org/dsh-see-now/latest>（0.2.2；访问 2026-11-13）
- <https://api.github.com/repos/SAOS-3624/dsh-see-now/tags>（v0.0.2–v0.2.3；访问 2026-11-13）
- 本仓：`docs/research/omni-modal-external-providers.md` §0、`TODOLIST.md` DV-DOC-008（世界网关）、`docs/research/workbench-landscape.md` D-003
- DSH：`packages/llm/llm-pi-ai/src/config.ts`（`DEFAULT_INPUT`）、`packages/compaction/compaction-image-offload/`、`packages/attachment/attachment-local/src/index.ts`（`saveImage`）
- 本地 checkout：`.workspace/dsh-see-now/dsh-see-now-main/`（main@1d98dd5，用于本次只读核对）
