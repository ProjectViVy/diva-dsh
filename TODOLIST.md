# TODOLIST

> 跨会话唯一「当前任务」事实源。字段与规则见 `AGENTS.md` §1–§2。
> 只写状态，不写设计（→ `docs/`），不写历史（→ `docs/logs/`）。
> 完成项移出活跃区，进 `Archive Index` 指向的归档文件。
> 协议来源：[docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md](docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md)
> 更新时间：2026-11-17 (Asia/Shanghai)

## NOW（≤40 行、≤3 条；没有就写「无」，不要编）

- [ ] **DV-VOICE-004 世界网关=能力服务（ASR+TTS 统一供给）已实现、真 key 验过，只差重启生效** `sev-P1`
  状态: waiting-user（代码、测试、隔离实例端到端全过；**要重启 3082 一次**）｜ 详见 `## 活跃` 的完整条目
  下一步：`npm run stop && npm start` → 语音页「识别」引擎选「世界网关（千问）」→ 输入框麦克风说话，应出文字。

- [ ] **DV-VOICE-005 把世界网关语音包做成 diva 的默认语音能力** `sev-P2`
  状态: blocked-on-decision（默认策略二选一待主人拍板）｜ owner: lead ｜ Scope: plugins/capability-hub/src、plugins/asr/src、plugins/voice/src、scripts/setup-capability-hub.mjs、docs/logs/2026-11-world-gateway/v0.2.x-default-voice/、TODOLIST.md
  已确认的硬约束：世界网关 = 百炼账号的 key + **该账号自己的** workspace 域名 + 联网 + 按量计费。别人要用只能填他自己的 key，**不能打包我们的 key**；所以「其他用户一进来就能用」= 一进来就默认走网关 + 缺 key 时明确告诉他缺什么，而不是我们替他付钱。详见 `## 活跃` 的完整条目。
  下一步：主人选默认策略（A 网关优先+失败回退本地 / B 纯网关、缺 key 就明说不可用），再改默认值与提示。

- [ ] **DV-UI-022 今日卡契约 v2：卡片可带 genui nodes，11 节简报按新格式重写** `sev-P2`
  状态: waiting-user（代码、内容、隔离实例验证完成；**宿主 route 改了，要重启 3082 一次**）｜ owner: today-v2 ｜ 开始: 2026-11-16 23:43 ｜ 完成: 2026-11-16 23:5x ｜ Scope: plugins/dsh-daily/index.js、plugins/dsh-daily/client.js、tests/daily-today.test.mjs、tests/daily-client.test.mjs、.artifacts/dsh-home/today/2026-11-16.json、TODOLIST.md、docs/logs/2026-11-daily/v0.10.0-today-nodes/
  目标：主人 2026-11-16 23:5x「不错。我觉得要按照这类规范来。再试试看吧。」——今日卡从「标题+正文」扩成可带一棵 genui `nodes`（复用左栏 `renderSpec`，不写第二套），旧格式继续按标题+正文显示；把主人那份 11 节简报按新格式写回今天的卡文件。
  进度：宿主 `parseCards` 认可选 `nodes`（数组 / ≤40 节点 / ≤6 层 / 单串 ≤2000；坏树整卡丢，未知类型交渲染器）；客户端 `cardsOf`/`daySection` 把 nodes 原样塞进 card items，`renderSpec` 未改；11 张卡写入 today，旧 `2026-11-15` 四张卡不动。
  验证：daily-today 21/21；daily-client 55/51/0/4；`npm test` 1472/1462/0/10、exit 0（任务基线 1450；工作树另含 user-plugins +13，本轮 +9）；真 Chrome 隔离实例 3083（独立 DSH_HOME，3082 没碰）证据截图 `today-v2-01-nodes-and-legacy.png`（新卡 badges 3 / chartRows 2 + 旧卡同屏）、`today-v2-02-all-cards.png`（11 卡）、`-03-briefing-{mid,bottom}.png`；页面错误 0、横向溢出 false。
  下一步：主人 `npm run stop && npm start` 后 Ctrl+F5 → 日常右栏 Today 应看到 11 张带徽标/表格/图表/步骤/时间线的卡；历史 `11 月 15 日` 4 张旧卡仍是标题+正文。验收清单见 acceptance.md。
  未验证：3082 重启后的真面板观感；窄窗 <1080px 的换行；worker 自动写 nodes（提示词仍只教 title/body，触发链未接）。
  日志：docs/logs/2026-11-daily/v0.10.0-today-nodes/

## 活跃

- [ ] **DV-SETUP-002 启动器 stop/status 杀不到控制记录之外的 DSH 进程** `sev-P3`
  状态: todo（2026-11-17 00:1x 安装 dsh-oil-ui 时暴露；2026-11-19 从 NOW 挪到活跃，P3 不占 NOW）｜ owner: 待认领 ｜ Scope: scripts/vivy-dsh.mjs、scripts/lib/vivy.mjs、tests/source-runtime.test.mjs、TODOLIST.md
  现象：3082 上有 DSH 服务在跑（先后是 PID 32236、17496），但 `npm run status` 报 `pids: []`、`health: null`、`manually_stopped: true`，`npm run stop` 打印 stopped 却什么也没杀；`npm start` 会撞「An existing service answers at 3082」。
  原因：stop 只按控制文件记录的 pid（`processes()` = 记录 pid 且 serving）杀进程；不由 launcher 启动的实例没有记录，被当成「没有服务」。
  下一步：stop/status 在记录为空但端口有应答时，按端口与命令行识别同 profile 的服务并明确列出（不自动杀）；重启前给出可执行提示，避免「以为停了其实没停」。

- [ ] **DV-VOICE-004 世界网关定位为「能力服务」：ASR + TTS 统一供给，语音版块标清来源** `sev-P1`
  状态: waiting-user（代码、测试、隔离实例端到端全过；**要重启 3082 一次**）｜ owner: lead ｜ 开始: 2026-11-18 07:05 ｜ 完成: 2026-11-19 00:3x ｜ Scope: plugins/capability-hub/src、plugins/asr/src、plugins/voice/src/client.js、scripts/setup-capability-hub.mjs、tests/*、docs/logs/2026-11-world-gateway/v0.2.0-capability-service-asr/、TODOLIST.md
  目标：主人 2026-11-18 07:04「网关明确将其定位为某种服务——为外部组件提供……输入框的输入按钮特性应该由语音输入统一管理，后面数字人的语音合成、语音识别都应该在这边进行统一管理……语音版块很多还是没有清晰的标识，要明确可选究竟用的是本地语音包还是世界网关的包。现在我们在收世界网关接入能力，所以 asr tts 都需要真实能在语音版块接入。」——三件事：①能力服务化（asr/tts 都从 `capabilityHub` 取，消费者不各自直连上游）；②语音版块把「来源」写在明面上（本地包 / 世界网关）；③网关真能跑 ASR，并在语音版块的识别里可选。
  已定事实（本轮实测）：base64 音频必须用 **data URL** 形状（`data:audio/wav;base64,…`）才被接受，裸 base64 串返回 500；兼容模式 `/audio/transcriptions` 是 404；ASR 走 `/api/v1/services/aigc/multimodal-generation/generation` + `parameters.format/sample_rate`。实测 4.64s 中文 wav → 200，转写与原文一致，耗时约 21.7s。ASR 面板规范音频是 16kHz/16bit/单声道，故 `sample_rate: '16000'`。四字头的 3.0 首词正确、3.1 首词错，故 asr 默认模型取 `qwen-audio-3.0-asr-flash`。
  进度：①`capabilityHub` 现在给 `speak('tts')` / `transcribe('asr')` / `status(cap)` 三个方法（新增 `adapters/dashscope-asr.mjs`、`createTranscribe`、`POST /api/asr`、路由体上限 12MB）；②`plugins/asr` 新增第二个引擎 `gateway`（id `gateway`，名称「世界网关（千问）」，`location:'cloud'`，`languages:['auto']`——语言提示尚未验证透传，就不写 zh/en 假装支持），走 `ctx.inject(['capabilityHub'])` 进程内调用，`status()` 用 3 秒 TTL 快照向网关要就绪度；③语音面板四处标清来源，并修掉「dashscope 线路在总览被写成本地语音包」的真 bug；④`scripts/setup-capability-hub.mjs` 幂等接线 `asr` 插槽（与 tts 共用 key/baseURL，模型可用 `DSH_ASR_MODEL` 覆盖）。
  验证：hub `tests/asr.test.mjs` 13/13；引擎 `tests/asr-gateway-engine.test.mjs` 8/8；面板标识 `tests/voice-settings-client.test.mjs` 22/22；隔离实例 3099 端到端：`GET /dsh-asr/api/asr/catalog` 列出 `gateway / 世界网关（千问） / cloud / ready=true / qwen-audio-3.0-asr-flash`，踢引擎后 `POST /dsh-asr/api/asr/transcribe` 返回 200、「你好，我是Diva。这是一条语音合成冒烟测试。」、21.7s。
  下一步：主人 `npm run stop && npm start` → 语音页「识别」选「世界网关（千问）」→ 输入框麦克风说话应出文字；未验证项见 summary.md。
  未验证：`/dsh-capability-hub/api/asr` 这条 HTTP 面的活体往返（只做了单元测试，进程内路径才是面板真正走的）；多语言提示透传；连续多次识别的限流与计费表现。
  日志：docs/logs/2026-11-world-gateway/v0.2.0-capability-service-asr/
  追加（2026-11-21 07:0x，上传轮）：日志目录当时没落盘，本轮补了四件套 + evidence；补记时复跑三个套件全绿，全量 1495/1485/0/10 exit 0。上传核对抓到两处测试回归并修掉：`tests/capability-hub-setup.test.mjs` 仍断言「脚本不碰 asr 插槽」（脚本已改成接线 asr）、`tests/asr-mount.test.mjs` 的假 ctx 没有 `inject`（插件新增 `ctx.inject`，缺它会让 apply() 抛错且测试进程挂住）。代码已随本轮提交推到上游，记录见 docs/logs/2026-11-workspace-upload/v0.6.0-full-sync/。

- [ ] **DV-VOICE-005 把世界网关语音包做成 diva 的默认语音能力（新装用户进来就有声音）** `sev-P2`
  状态: blocked-on-decision（默认策略二选一待主人拍板）｜ owner: lead ｜ 开始: 2026-11-19 00:41 ｜ Scope: plugins/capability-hub/src、plugins/asr/src、plugins/voice/src、scripts/setup-capability-hub.mjs、docs/logs/2026-11-world-gateway/v0.2.x-default-voice/、TODOLIST.md
  目标：主人 2026-11-19 00:41「之后看看能不能将这个世界网关语音包作为 diva 默认的，这样就不用一启动然后发现没有语音输入输出能力了，其他用户一进来就能够启用 diva 的语音能力。」
  已确认事实：①**这台机器实际上已经是默认**——`$DSH_HOME/voice/config.json` 的 `voice.tts.route=dashscope`、`$DSH_HOME/asr/config.json` 的 `asr.engine=gateway`；但 asr 那条是 2026-11-19 我在 3099 隔离实例测试时写入**共享 DSH_HOME** 的结果（当次只隔离了 profile 与端口，没隔离 home），不是发货默认值，已在 summary 里如实记录；②**发货默认值仍是** `route=local`（要下载安装本地包）+ `ASR_DEFAULTS.engine='sensevoice'`（要下载模型）；③硬约束：世界网关 = 百炼账号的 key + 该账号自己的 workspace 域名 + 联网 + 按量计费，**别人要用只能填他自己的 key**，不能打包我们的 key，否则等于把账号送出去。
  可做（按价值排序）：1) 新装默认 `route=dashscope`、`asr.engine=gateway`（不下载任何东西，填一把 key 就有声）；2) 未就绪时在总览顶部明说缺什么（缺 key / 缺 baseURL / 401 / 无网），并给直达入口——链已经通了（`capabilityHub.status` → 引擎 `status()` → 面板），只差把它抬到最显眼位置；3) 回退：网关不可用时落回本地包（`pickFallbackRoute` 已存在，但只认 local/cloud，判据要加 dashscope 未就绪）；4) `npm run setup` 读 `DASHSCOPE_API_KEY` / `DSH_*_BASE_URL`，有就自动接线、没有就打印「填 key 即用」；5) 文档与 `config.example` 写清「自带 key」。
  待拍板：A 网关优先 + 失败自动回退本地（不容易一启动没声音，但用户可能听不出是谁在说）；B 纯网关，缺 key 就明说不可用（更诚实，符合「不假装成功」，但新装没配 key 时确实没有语音）。
  下一步：主人选 A/B → 改默认值 + 提示位置 + 回退判据 + 测试 → 四件套。
- [ ] **DV-DOC-017 世界网关：MOSS（模思）预接线 —— `moss` 接入点 + MOSS-Live 实时语音插槽** `sev-P2`
  状态: waiting-user（代码、测试、文档完成；**要重启 3082 一次**才能看到六张卡）｜ owner: lead ｜ 开始: 2026-11-18 03:05 ｜ 完成: 2026-11-18 03:2x ｜ Scope: plugins/capability-hub/src/{capabilities.mjs,registry.mjs,candidates.mjs,catalog.mjs,client.js}、plugins/capability-hub/tests/{registry,candidates,catalog,client-render}.test.mjs、plugins/capability-hub/README.md、plugins/capability-hub/scripts/explore-endpoints.mjs、docs/research/moss-world-gateway-wiring.md、docs/logs/2026-11-world-gateway/v0.1.5-moss-prefab/、TODOLIST.md
  目标：主人 2026-11-18 03:03「将 platform.moss.cn 的模型页与 MOSS-Live 参考接入，先做预制接线保证能力，后面再进行实际应用开发」——只接线（接入点、基址、模型候选、实时语音插槽），不做适配器与真实调用。
  进度：`moss` 为第五个接入点（API 主机 `https://api.mosi.cn`，`platform.moss.cn` 是文档站，`api.moss.cn` 404；凭据名 `MOSS_API_KEY`）；四条能力候选 asr/tts/omni + 新增第六能力 `realtime`（`wss://api.mosi.cn/v1/realtime`、`moss-live-1.0`）；注册表按能力区分 `wss://`/`https://`，换接入点带出该家基址与首个候选，缺这类模型时保存被拒；面板删旧占位卡、加模思与实时语音真插槽；不接 embedding（模思没有向量）与 decision（Nex 属于 chat）。
  验证：capability-hub 37 pass / 0 fail（candidates 6、catalog 6、client-render 5、http-catalog 4、http-tts 7、registry 9）；`npm test` 1480/1469/1/10，唯一失败是已知的 `memory-actmem` 04:00 前时间窗问题（单跑同样失败，与本轮无关）；`explore-endpoints.mjs` 无 key 实测模思 403 `missing bearer api key`，随机路径 404。
  下一步：主人 `npm run stop && npm start` → 硬刷新 → 按 `docs/logs/2026-11-world-gateway/v0.1.5-moss-prefab/acceptance.md` 走七步；有 `MOSS_API_KEY` 后填凭据并跑 `explore-endpoints.mjs --check`。
  未验证：模思候选 id 未用真 key 对账；没有模思适配器（tts 选 moss 报 501）、没有 MOSS-Live WS 客户端（浏览器不能带 Authorization 头，要服务端代理，每用户并发 1 条）；3082 真面板观感。
  日志：docs/logs/2026-11-world-gateway/v0.1.5-moss-prefab/

- [ ] **DV-VOICE-003 世界网关语音包（`voice-dashscope`）并设为默认线路** `sev-P2`
  状态: waiting-user（三处面板级 bug 已修、隔离实例四个面板动作全过；**只差你再重启一次让新代码生效**）｜ owner: lead ｜ 开始: 2026-11-18 00:5x ｜ 完成: 2026-11-18 03:3x ｜ Scope: plugins/voice/src/{service.mjs,index.mjs,voice-packs.js,voice-tts.js,voice-diagnostics.js,client.js}、plugins/voice/README.md、plugins/capability-hub/src/{index.mjs,http.mjs,speak.mjs,adapters/dashscope-tts.mjs}、plugins/capability-hub/tests/{http-tts,speak}.test.mjs、scripts/setup-capability-hub.mjs、tests/{capability-hub-setup,voice-plugin,voice-gateway-inprocess}.test.mjs、package.json、TODOLIST.md、docs/logs/2026-11-world-gateway/v0.1.4-voice-dashscope/
  目标：主人 2026-11-18 00:5x「可以开始做一个世界网关语音包了，原理是，从世界网关获取数据，然后根据情况来进行云端语音合成」；音色选 `Cherry`，线路设为默认。
  进度：语音插件 2 线 → 3 线（`local`/`cloud`/`dashscope`），线路表收敛成 `ROUTE_PACKS` 常量；新增无进程的 `voice-dashscope` 包（`port: null`、`external: true`，只有接线后才出现在列表里；启动=探网关 `/health`，停止=空操作，卸载被拒绝并给替代做法）；网关侧新增唯一 invoke 路由 `POST /dsh-capability-hub/api/tts`（文本进 wav 出，`X-Duration-Ms`）与百炼适配器；`npm run setup:capability-hub` 幂等接线；已设默认线路 `dashscope` + 音色 `Cherry`。
  顺手修三个真 bug：①`synthesizeToFile` 硬编码 `/v1/speak/file`（网关是 `/tts`，会 404）；②百炼流式 wav 头长度是占位值（44739241ms → 实际时长，新增 `repairWavHeader`）；③**语音插件服务端调网关必然 401**（服务端请求没有浏览器会话，架构上走不通，不是配置问题）——改为网关 `ctx.provide('capabilityHub', { speak })` + 语音插件 `ctx.inject` 订阅，两个入口共用 `speak.mjs`，拿不到服务才退回 HTTP。
  验证：取 `HEAD` 基线确认既有 10 个失败（Windows 符号链接/云配置恢复事务），改完新增 0 个；最终 **263 项 261 通过 0 失败**（voice-plugin 156/154、voice-core 6、voice-policy 6、voice-settings-client 21、voice-send-pipeline 15、voice-registration 6、capability-hub-setup 5、voice-gateway-inprocess 4、capability-hub 七个套件全通过，新增 `http-tts` 7/7 与 `speak` 7/7）。全量 `npm test` 1484 项 1473 通过 1 失败（唯一失败在 `tests/memory-actmem.test.mjs`，该文件与被测模块本轮均未改、单独跑同样失败，既有问题未修）。隔离实例 3099（同一 profile 与 `DSH_HOME`，只改端口，3082 全程未动，pid 9884 起始 20:27）实测：四个错误分支正确（空文本 400、插槽关 409、无凭据 502、假 key 走到阿里云 401），真 key 下网关 `POST /tts` 200 / 153644 字节 / 3200ms（wav 有效、RMS −22.4dB 非静音），语音插件试听 200 / 88364 字节，缓存命中 18ms，时长随文本变化（2 字 400ms、84 字 18800ms，sha 不同，排除复用旧音频）。
  第二轮（主人重启后反馈「跑不起来」）：查出三处独立的错——①探活 fetch 网关 `/health`（路由不存在，且服务端请求过不了会话校验 → 永远 401），面板因此永远显示「已安装 · 已停止」，而「测试合成」按钮正是在 `!pack.running` 时禁用的；②`manifests()` 先合并 `{id,url}` 补丁再判断要不要加网关包，补丁把 id 占住，`external: true` 与名称音色永远进不来，包被当成「本地包但端口空」；③「测试合成」自己又 fetch 了一次。修法：网关多暴露 `status()` 服务，探活与测试合成全走进程内；`manifests()` 改成先放完整定义再让补丁覆盖。隔离实例 3099 实测四个面板动作全过：列包 `running: true`、测试合成 200 / 115244 字节 / 2.4s、试听 200 / `audio/wav` / 119084 字节、启动停止 200；定向套件 270 项 268 通过 0 失败。
  下一步：**再重启一次**（05:07 那个进程跑的是修复前的代码）→ 语音页选「世界网关（千问）」→ 点「测试合成」应出时长，点「试听」应出声。
  未验证：3082 真面板第三条线路的观感（只在渲染测试里过）；重启后真面板里按钮到出声。接口层与真 key 合成均已实测。
  日志：docs/logs/2026-11-world-gateway/v0.1.4-voice-dashscope/

- [ ] **DV-DOC-009 世界网关 × 千问接入点：ASR / TTS / 向量 实测** `sev-P2`
  状态: waiting-user（三项实测通过；等 D1/D2/D3 三个决定）｜ owner: lead ｜ 开始: 2026-11-17 20:46 ｜ 完成: 2026-11-17 22:1x ｜ Scope: scripts/probe-world-gateway.mjs、docs/research/world-gateway-qwen-maas-smoke.md、docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/、TODOLIST.md
  目标：主人「世界网关中接入千问系列模型，主要测 ASR / TTS / 向量 能力」。**只做实测**：没改 `plugins/capability-hub`、没写 `registry.json`、没改 profile、没重启宿主。
  结论：三项都能跑通，但没有一项走「OpenAI 兼容」那条最顺的路。向量 `POST /compatible-mode/v1/embeddings` 200，`dimensions` 1024 / 512 都真实生效；TTS 走 `aigc/multimodal-generation`（`qwen3-tts-flash`）与 `audio/tts/SpeechSynthesizer`（`qwen-audio-3.1-tts-flash`）都直接回 wav（24kHz/单声道/16bit），`/compatible-mode/v1/audio/speech` 404；ASR 走原生路径 + 公开 URL 输入，三个模型都 200，`qwen-audio-3.0-asr-flash` 识别正确、另两个首词错（只有一个 2 秒样本，不足以下结论）；兼容模式 `audio/transcriptions` 404。
  两个坑：①**本机代理会掐断带音频 base64 的大请求体**（同样大小的非音频体也一样断，所以不是服务端拒收）——ASR 因此改走公开 URL 形状；②百炼直回的 wav 头长度是流式占位值（声明 2147483547 字节、实际 211200），不修头播放器会以为是 12 小时音频。
  下一步：等主人定 **D1**（ASR 用现成的 `qwen-audio-3.0-asr-flash`，还是去控制台开通 `qwen-audio-3.1-asr-flash`）、**D2**（向量对照测做不做：20 条中文 query，本地 MiniLM vs `qwen3.7-text-embedding-flash@512`，做了才知道要不要动 mempalace 的 384 维硬校验）、**D3**（要不要给 capability-hub 写 asr/tts/embedding 三合一适配器——其中 TTS 那半已由 DV-VOICE-003 落地）。
  未验证：本地音频走 base64 的 ASR 形状（被代理挡住）；omni 吃 `input_audio`（网络断，无结论）；兼容 chat 的 `modalities:['text','audio']` 参数位置；真实录音上的字错率；TTS 换音色的主观听感。
  日志：docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/

- [x] **DV-SETUP-001 用户自定义插件源码级安装目录（user-plugins）** `sev-P2`
  状态: done（第三档安装档 + 首个真实插件 dsh-oil-ui 已装好并生效）｜ owner: lead ｜ 开始: 2026-11-16 23:1x ｜ 完成: 2026-11-17 00:2x ｜ Scope: user-plugins/、scripts/lib/user-plugins.mjs、scripts/setup-user-plugins.mjs、scripts/setup.mjs、package.json、.gitignore、AGENTS.md、tests/user-plugins.test.mjs、TODOLIST.md、docs/logs/2026-11-setup/v0.1.0-user-plugins/
  目标：主人 2026-11-16 23:0x「为 diva 添加用户自定义插件源码级安装目录；有一个插件想遵守源码级安装规则但不上主分支；规则写进说明书，脚本里写，AGENTS.md 一句话声明」。落地：`user-plugins/<name>/` 作为第三档源码级安装（前两档 `plugins/` 与 `third-party/`），新脚本复刻 third-party 的「发现 → 可选构建 → `dsh plugin add link:` → 复核」但砍掉 pin/submodule/兼容声明，补 prune 清理失效 link，接进 `npm run setup`；规则正文进 `user-plugins/README.md`，AGENTS.md §1 一句话指路；`.gitignore` 只跟踪 README。
  验证：`node tests/user-plugins.test.mjs` **13/13**；真实空档位 `--check` **exit 0**；`tests/third-party-setup.test.mjs` **14/14**；`npm test` **1463/1453/0/10，exit 0**（基线 1450/1440/0/10，+13 项，0 失败）。
  真实安装（2026-11-17 00:1x）：`dsh-oil-ui` clone 到 `user-plugins/dsh-oil-ui`（含已提交的 `lib/` 与 `skills/`），装好生产依赖；用 DSH 官方在线安装通道 `plugin_manager install_bundle link:<目录>` 注册，**没有停宿主**——profile `bundles` 末位出现 `dsh-oil-ui`，`setup:user-plugins -- --check` **exit 0「全部就绪」**，`oil_ui_skill_status` 返回 `skillReady: true`、内置 Lite Skill v0.33.4（45 文件）、有 0.33.4→0.33.5 更新提示。
  未验证：带 `scripts.build` 的插件真构建、`--remove`/prune 的真实 `dsh plugin remove` 路径、宿主重启后的加载（本次是在线加载，没重启）。
  日志：docs/logs/2026-11-setup/v0.1.0-user-plugins/

- [ ] **DV-RUN-001 DeepSeek 登录 403 与 dev 运行退出排查** `sev-P1`
  状态: waiting-user（诊断已交付；待崩溃前日志定位首次关闭原因）｜ owner: codex-20261116-runtime ｜ 开始: 2026-11-16 ｜ Scope: TODOLIST.md、docs/logs/2026-11-runtime/v0.1.0-login-dev-diagnosis/（只读排查，未改产品）
  目标：区分账号登录 403、inspector 关闭后发布、dev-web tsc 退出的根因与因果关系。
  验证：直连/代理 current 均 CloudFront 403；本机 grant 读 summary 为 HTTP 200/code 0/bizCode 0；真实 inspector source 关闭后状态事件复现同栈 exit 1；客户端 tsc 单次增量构建 exit 0。
  下一步：补堆栈前约 30 行日志，确定 inspector 首次关闭触发源及 tsc 是否独立故障；建议先禁用实验性 inspector 止损，备选根仓生命周期补丁。本轮未改配置、未重启、未执行真实推理。
  日志: docs/logs/2026-11-runtime/v0.1.0-login-dev-diagnosis/

- [ ] **DV-UI-021 genui 收口到 superagent：普通会话不再有 dsh-ui 能力** `sev-P2`
  目标：主人 2026-11-16 06:0x「这个工具可以限定范围为仅 superagent 和其 worker 可用吗？还有 html 我觉得也最好限定一下」→ 选 A。事实：genui 是 profile 级 bundle，段/工具/技能对每条会话都可见（本会话实测），而 superagent master 因为 `complete: true` 整段替换收不到教学、两个工具也被 allow 白名单与 WORK_TOOLS 挡掉——现状正好相反。本轮：① 新本地插件 `plugins/dsh-ui-scope`，在 `agent/created` 上对非 superagent agent 遮蔽 `genui:fence` 段（空文本）、`deny` render_ui/validate_dsh_ui、注册同名 `genui` 残桩技能（模型与用户两头都不可调用）；② `patches/superagent-genui.patch` 把一段「画界面」教学拼进 `composePrompt`，并把两个工具加进 master 的 allow 列表与 WORK_TOOLS；③ html 自由 UI 保持 `FREE_HTML_UI=false`，边界写死为「只属于 master 的左栏」。白名单：`^(orchestrator|worker)-` 及其 parentSession 链上的子 agent。
  状态：waiting-user（代码、补丁、构建、测试、profile 接线都完成；**等重启一次**验收）｜ owner：lead ｜ 开始：2026-11-16 06:1x ｜ 完成：2026-11-16 06:4x ｜ Scope：plugins/dsh-ui-scope/、scripts/lib/component-setup.mjs、patches/superagent-genui.patch、patches/superagent-patches.json、tests/ui-scope.test.mjs、tests/source-runtime.test.mjs、TODOLIST.md、docs/logs/2026-11-daily/v0.9.0-ui-scope/
  进度：① `plugins/dsh-ui-scope` 三处闸门（空段遮蔽 `genui:fence` / `deny` 两个工具 + `tools/change` 补晚注册 / 同名 `genui` 残桩技能），白名单 `^(orchestrator|worker)-` 及 parentSession 链 8 层；② `patches/superagent-genui.patch`（第 14 条）把 `uiPrompt` 插在 handoff/环境/policy 之前、两个工具进 `WORK_TOOLS` 与 master allow 列表；③ profile 手工接线（宿主在跑，`setup:components` 要求先停），`node_modules/dsh-ui-scope` 是 junction，lock 未更新。
  验证：`node tests/ui-scope.test.mjs` **9/9**；`npm test` **1450 项 / 1440 通过 / 0 失败 / 10 跳过**；`node scripts/build-bundle.mjs` exit 0，`superagent/lib/index.js` 里 `画界面（本安装独有的额外能力）` 与 `WORK_TOOLS` 尾部两个工具名都在；`git -C superagent status --short` 空。
  下一步：主人 `npm run stop` → `npm start` 后按 `docs/logs/2026-11-daily/v0.9.0-ui-scope/acceptance.md`：普通会话问「画一张卡试试」应拿不到；日常面板里让她画卡应能出；面板提示词预览 master/worker 两侧都该有 `## 画界面（本安装独有的额外能力）`。
  未验证：重启后的运行期（普通会话是否真看不到工具/技能、master 与 worker 是否真拿到）。
  日志：docs/logs/2026-11-daily/v0.9.0-ui-scope/
  阻塞：无（等重启验收，非阻塞）

- [ ] **DV-UI-020 收工写今日卡规则进 Superagent worker 提示词（需重启生效）** `sev-P2`
  目标：worker 收工时把这一单让主人看得见的变化写进 `$DSH_HOME/today/<YYYY-MM-DD>.json`（`{"cards":[{"title","body"}]}`，一天一张、读后追加不覆盖、同一件事一天一条、只写真实发生），规则只进 worker 段；master、普通 DSH 会话、DSH 子 agent 都看不到。
  状态：done（补丁+重建完成；**需重启宿主一次**才进运行期）｜ owner：worker-prompt ｜ 开始：2026-11-16 04:55 ｜ 完成：2026-11-16 05:00 ｜ Scope：patches/superagent-worker-today.patch、patches/superagent-patches.json、tests/source-runtime.test.mjs、TODOLIST.md、docs/logs/2026-11-daily/v0.8.0-worker-today-rule/
  进度：机制已确认——`superagent/prompts/*.md` 运行时读盘（`skill-files.ts:29-32` → `paths.ts:7-19`），`lib/` 不打包 prompts，而 `withTemporaryPatch` 构建后还原补丁，所以补丁改 prompt 文件不持久；落点改 `src/app/context.ts`，把 `todayCards` 拼进 `workerPrompt`（只喂 `runtime/worker`）。产物 `superagent/lib/index.js` 可搜到四句全文；worker/master 用真实 revision 1 各跑一遍 `promptParts`/`composePrompt` 取证。
  验证：`git -C superagent apply --check` exit 0；`git -C superagent status --short` 空；`node scripts/build-bundle.mjs` exit 0；`node --test tests/source-runtime.test.mjs tests/windows-deployment.test.mjs` 32/32；`npm test` 第二遍 **1441/1431/0/10、exit 0**（第一遍有 1 条 memory 时序 flake，单独重跑通过）。
  下一步：主人执行 `npm run stop` → `npm start` 后：① Superagent 面板提示词预览里 worker 尾部有这四句、master 0 命中；② 等一单真实 worker 收工，看 `$DSH_HOME/today/<当天>.json` 与右栏 Today。
  未验证：重启后的运行期（本轮没有停/重启 3082）。
  覆盖边界：DSH 子 agent（spawn_teammate）不是 ticket worker——`sessions.ts:232-237` 只给 master 与 ticket worker 挂提示词段，其余走 `limitSubagent`（`:303-312` 只加工具限制），收不到这条；此前写在 AGENTS.md 时它们反而能收到。
  日志：docs/logs/2026-11-daily/v0.8.0-worker-today-rule/
  阻塞：无（等重启验收，非阻塞）
  追加（2026-11-16 23:10，today-writer）：今日卡已写入 `.artifacts/dsh-home/today/2026-11-16.json`（4 张卡；JSON.parse 通过、`node --test tests/daily-today.test.mjs` 15/15）；这次是 Lead 指派的 worker 手写，不是 ticket worker 自动触发，触发链路仍未验；面板 Today 页需要 token，本轮没拿到，未截图。
  追加（2026-11-16 23:38，briefing-cards）：按主人 23:3x 贴的今日简报十一节逐字版（`.artifacts/today-sample/2026-11-16-briefing.md`）转写 11 张卡追加进同日 `2026-11-16.json`（累计 15 张，未覆盖原有 4 张；十一节一节一卡，没有合并或省略）；保留「线索级 / 待核实 / 仅知悉 / 以官方当天排期为准」，卡内不写日期、数字照抄不补外部信息；JSON.parse 通过、`node --test tests/daily-today.test.mjs` 15/15；未动 2026-11-15 两文件、未重启宿主、未提交 git。
  追加（2026-11-17 00:3x，today-v2）：worker 今日卡规则正文升级到 v2（`cards[].nodes`、常用节点 badge/text/chart/table/list/callout/keyvalue/steps/timeline、`nodes` ≤40 节点 / 嵌套 ≤6 层 / 单串 ≤2000 / 一天 ≤50 张、保留「线索级 / 待核实 / 仅知悉 / 以官方当天排期为准」并数字照抄不把线索写成结论、不编图片地址）。只改 `patches/superagent-worker-today.patch` 的 `todayCards` 文本，机制 / 补丁清单 / 测试未动；重建后 `superagent/lib/index.js` 第 3259 行起六句，真实 prompt revision 1 取证 worker 有、orchestrator 无；**需再重启一次**（`npm run stop && npm start`）才进运行期。证据：docs/logs/2026-11-daily/v0.8.1-worker-today-v2/。

- [ ] **DV-UI-019 右栏 Today 改 genui spec 渲染（按天分区 + 标题内容卡），旧 html 链路保留** `sev-P2`
  目标：主人 2026-11-15 23:1x「我觉得右侧的 today 等也可以用这个 genui，先两条链路保留一下吧。」——Today 改读 worker 写的结构化卡 `$DSH_HOME/today/<YYYY-MM-DD>.json`（`{"cards":[{"title","body"}]}`，卡里不写日期），按天分区：今天一块（分区头「11 月 15 日」这种写法），今天没卡说「今天还没有要注意的事情哦！」，历史倒序往下排、没有卡的日期整块不显示；每张卡只有「事件标题 + 内容」两行，宿主统一渲染。复用左栏那份 vendored 渲染器（`divider` 做分区头、`card` 做两行），不写第二套。`/dsh-daily/api/today` 改成一次下发 `cards` + `html` + `history`，校验沿用现有做法；旧 html 链路（`FREE_HTML_UI` / today iframe）一行没删，改一个常量切换。任务页与悄悄话页没动。
  状态：done（客户端硬刷新生效；**宿主 route 改了形状，需重启一次**）｜ owner：today-genui ｜ 开始：2026-11-15 23:14 ｜ 完成：2026-11-15 23:26 ｜ Scope：plugins/dsh-daily/index.js、plugins/dsh-daily/client.js、tests/daily-today.test.mjs、tests/daily-client.test.mjs
  进度：宿主 `index.js` 新增 `parseCards`/`readCards`/`readSmall`/`listHistory`；`/today` 200 返回 `{ok,date,cards,html,history}`（没有内容从 404 改成 200 + 空数组；`html` 字段保住旧链路；`history` 只含比今天早且真有卡的日子、倒序封顶 14 天，坏 JSON 与超大文件跳过）。客户端 `todaySpec`/`daySection`/`dayHeading` 把数据映射成已有 genui 词汇，`cardsOf`/`historyOf` 再收一道；`DailyPage` 不再因开关关闭跳过请求（两条链路共用一次请求）。新增 CSS 两条、只用 `var(--dl-*)`。
  验证：`node --test tests/daily-today.test.mjs` **15/15**；`node --test tests/daily-client.test.mjs` **52 项 / 48 通过 / 0 失败 / 4 跳过**；`npm test` **1441/1431/0/10，exit 0**（基线 1427/1417/0/10，+14 项）；临时翻 `FREE_HTML_UI=true` 回归 **52/50/0/2**（三条 html 用例全部通过，已翻回 false）。真宿主隔离实例（`.artifacts/dsh-daily-verify-home`，3083，独立 DSH_HOME，3082 全程没碰，跑完已停）+ 真 Chrome 三态截图：`today-genui-01-cards.png`（今天 2 卡 + 历史 2 天，分区头 11 月 15/14/13 日）、`02-history.png`（今天空 + 历史照常）、`03-empty.png`（只有那句空态）；iframe 0、console error 0、无横向溢出；带 cookie 直取路由 200，`cards`/`html`/`history` 同在一份响应里。
  未验证：3082 真面板里的观感（宿主 route 改了形状，要重启一次才生效，本轮不自己停服务）；窄窗 <1080px 的换行；旧 html 链路在真宿主里的截图（只跑了单测）。
  下一步：主人重启一次宿主（`npm run stop && npm start`）后硬刷新，右栏标题条应显示「今天的界面 · 结构化卡片」；**写页规则已接、触发未接**——2026-11-16 起规则进 Superagent worker 提示词（DV-UI-020，重启后生效），worker 收工会写这个 JSON；master 仍读不到卡上内容，定时触发仍卡在 DV-UI-014。
  日志：docs/logs/2026-11-daily/v0.7.2-today-genui/
  备注：回滚 = 覆盖 `.artifacts/dsh-daily-backup/20261115-before-today-genui/` 的四个文件 + 重启宿主 + 面板硬刷新；两条链路切换只改 `client.js:1365` 的 `FREE_HTML_UI`；`plugins/dsh-daily/` 未被根仓库跟踪。
  阻塞：无

- [ ] **DV-UI-018 日常左栏把 `dsh-ui` 围栏渲成 genui spec 卡** `sev-P2`
  目标：主人 2026-11-15 深夜说「在普通 session 里面生效，但是日常中不生效」——同一份 genui spec 在宿主会话里成卡，在「日常」页左栏却是原文。本轮只补左栏这条路：assistant 气泡里的 ```dsh-ui 围栏 → spec 卡，卡片外的正文照常显示；坏 JSON / 没闭合 / 一个能画的节点都没有时退回原文，不许吞字；右栏三页、html 沙箱通道、折叠、新建聊天都不动。
  状态：done（纯浏览器半边，硬刷新即生效）｜ owner：daily-genui ｜ 开始：2026-11-15 22:50 ｜ 完成：2026-11-15 23:15 ｜ Scope：plugins/dsh-daily/client.js、plugins/dsh-daily/VENDORED-genui.md、tests/daily-client.test.mjs、docs/logs/2026-11-daily/v0.7.1-daily-ui-fence/
  进度：路由选「复用 dsh-daily 已有的 vendored 渲染器」，不跨包引 genui——genui 浏览器半边靠 DOM 观察者只认宿主聊天通道（`.genui-dom-fence`），看不见这棵手搭的 React 树；它唯一的嵌入出口 `./embed` 指向未编译的 TS（要打包器 + React 18），而 dsh-daily 没有构建步骤。复用则零新增依赖、零构建、右栏三页与左栏一套渲染器、回归测试复用。为左栏补了 table / chart（bars·line·donut，只画 `data` 单序列）/ steps / timeline / code / json / link 七个节点，`GENUI_LIMITS` 加表格列行、图点、代码长度四档限额，`renderSpec` 在有 title 时多渲染根标题，`bubble()` 先切 dsh-ui 段（→ `.dl-spec`）再切 html 段。
  验证：`node --test tests/daily-client.test.mjs` **46 项 / 42 通过 / 0 失败 / 4 跳过**（v0.7.0 基线 39/35/0/4，+7 条新用例）；`npm test` **1427/1417/0/10，exit 0**（基线 1420/1410/0/10）；临时翻 `FREE_HTML_UI=true` 回归 **44/0/2**（html 围栏通道没被踩坏，已翻回 false）；真 Chrome 隔离实例（3083：真宿主 + 真模型 + 真 dsh-daily bundle，另建 DSH_HOME，3082 全程没碰）**日常左栏**渲出 `.dl-spec` 4 个、bars 9 条（写作 6 / 调试 3 / 复盘 2）、表格 写完 3 / 完成 1、根标题「今天三件事」、assistant 正文里 ``` 计数 0；同一批消息切到普通会话视图 `.genui-dom-fence` 4 个（一个 742×211），两张截图并排可对；页面无 console error、无 pageerror。
  未验证：3082 真面板里的硬刷新实测（没碰主人正在用的宿主，也没拿面板 token）；genui 上游将来新增的节点不会自动跟（同步步骤写在 `plugins/dsh-daily/VENDORED-genui.md`）；左栏卡片里的按钮/开关没有动作（`[genui-action]` 回路只在宿主聊天通道，设计边界）。
  下一步：在面板里 Ctrl+F5 看一眼左栏；如果之后要表单、tabs、图表联动这类交互节点，再谈要不要让 genui 暴露一个公开的「在任意 React 树里渲 spec」入口，而不是继续在 vendored 渲染器上补。
  日志：docs/logs/2026-11-daily/v0.7.1-daily-ui-fence/
  备注：回滚 = 覆盖 `.artifacts/dsh-daily-backup/20261115-before-spec-fence/` 的 `client.js` 与 `daily-client.test.mjs` + 面板硬刷新；`FREE_HTML_UI` 仍是 false，html 围栏照旧当文字；不需要重启宿主（只多了客户端代码，没动开关）。
  阻塞：无

- [ ] **DV-UI-015 左栏支持「自由 UI」：她写的 `html` 围栏渲成沙箱 iframe** `sev-P2`
  目标：用户 2026-11-15 15:4x 定稿——走 OpenClaw / hanako 那条路，允许 agent **自由创建界面**，不限于白名单 spec。落点选左栏气泡：正文里的 ` ```html ` 围栏渲染成 `sandbox="allow-scripts"` 的 iframe（**无** `allow-same-origin`），srcdoc 内再压一层 CSP（`connect-src 'none'`、图只认 data:/blob:、禁表单）。右栏仍是 spec，两条路并存、互不影响。
  状态：doing（渲染器与安全边界完成、纯浏览器半边，硬刷新即生效）｜ owner：本会话 ｜ 开始：2026-11-15 15:46 ｜ Scope：plugins/dsh-daily/client.js、tests/daily-client.test.mjs、TODOLIST.md、docs/logs/2026-11-daily/v0.4.0-free-ui/
  进度：`splitUiFences()` 切段（未闭合围栏当文字，不吞正文）、`uiDocument()` 拼沙箱文档、`uiFrame()` 建框、`.dl-msg--ui .dl-bubble{flex:1 1 auto}` 放宽气泡；高度由框内 `body` 盒子回报（80–620 夹紧，`event.source` 认帧，不认别的消息）。没闭合 / 没有围栏的回复一个 iframe 都不长。
  验证：`tests/daily-client.test.mjs` 29/29（含围栏切分、sandbox 属性、srcdoc 断网、普通气泡不长框）；真 Chrome 探针 `.artifacts/dsh-daily-check/frame-probe.mjs` = **SANDBOX OK**：脚本跑得起来、碰父页面被挡、父 `localStorage` 被挡、`document.cookie` 抛 SecurityError、`fetch` 被 CSP 断、高度回报 131px；像素 `ui-frame.png`（气泡 784 / 框 756，无页面错误）。
  下一步：① 硬刷新后在左栏直说「用 html 围栏做个面板」验一次真手感；② 要让她**主动**写还缺一条模型侧规则（master 提示词里没有这条）——两条候选：在聊天里告诉她一次（ActMem 会记住，零代码）或给 master 加一段 scoped 说明（要动 superagent 补丁，等重启）。
  验收：发一句带 `html` 围栏的回复 → 气泡里出现一个框、框里是她写的界面；框内脚本能跑、联网被挡；不带围栏的回复不长框。
  备注：genui **没装**（用户选了先试这条路）。
  追加（2026-11-15 22:3x，由 genui-install 记）：主人当晚决定改走 genui，这条自由 html 通道已用 `FREE_HTML_UI = false` 停用（代码、沙箱边界与测试都保留，恢复=改回 `true` + 重启面板）；本条转 waiting-user，等 genui 那条路定型后再决定去留。`plugins/dsh-daily/` 未被根仓库跟踪，回滚=删掉 `splitUiFences`/`uiDocument`/`uiFrame` 与那三条 CSS。
  未验证：真宿主 3082 里的手感（本轮没重启）；`npm test` 1399/1393/0/6 已过，全在 verification.md
  追加（2026-11-15 16:1x，用户定稿两条通道）：**master 写 `html` 围栏是为了表达（左栏），today 围栏由 worker 写（右栏）**——master 或定时事件派工 → worker 干完把内容写成今天的界面。本轮只做「文件 → 右栏」这一小段：
  　· 文件约定：`$DSH_HOME/today/<YYYY-MM-DD>.html`（worker 直接写文件，不经过任何数据库）。
  　· 宿主半边 `index.js` 从空 `apply()` 变成 `GET /dsh-daily/api/today?date=…`（校验照 `dsh-superagent-reset`：本机 host、非 GET 同源、`connection.requestRejection`；日期正则 + `basename` 挡穿越；单页上限 512 KB；没有文件返回 404 且不记日志）。
  　· 右栏 Today：有页面 → `sandbox="allow-scripts"` 的 iframe（与左栏共用 `sandboxFrame`/`uiDocument`/高度回报），标题条写「worker 写的」；没有 → 回落示例卡，标题条写「还没有人写，下面是示例」，旁边一个「刷新」按钮（手动流程下不必整页刷新）。
  　· 验证：`tests/daily-today.test.mjs` 7/7（200 / 404 / 400 穿越 / 超大文件 / 403 / 503）；`tests/daily-client.test.mjs` 32/32（有页面→iframe 且示例卡退场、404→回落、fetch 抛错→不炸）；真 Chrome `today-worker.png`（frame 572×249、示例卡 0、标签「今天的界面 · worker 写的」、无页面错误）；`npm test` 1409/1403/0/6。
  　· **这条要重启才生效**（host 半边新增路由）；左栏那条仍是硬刷新即可。
  　· 未做（下一步，别当已完成）：① worker 提示词里没有「收尾把今天页面写到这个文件」这条规则——现在只能手动放文件验；② 派工触发（master / 定时）没接，定时那条还卡在 master 没有 `schedule_*` 工具（DV-UI-014）；③ master 不知道今天卡上写了什么，聊天时可能跟卡上内容对不上。
  　· 证据 `docs/logs/2026-11-daily/v0.5.0-today-channel/`。
  　· 追加（2026-11-15 16:3x，抄 openhanako 的「卡片品味」）：主人问 hanako 的动态 UI 卡片是怎么做的——查清它**不是生成结构，是让 agent 直接写 HTML**，效果靠两样东西：① 宿主从主题里抠 CSS 变量注入 iframe `:root`；② 一份 20 KB 设计指南当工具/技能加载。我们只补了这两样，没照搬它的 HTTP 路由（它必须走 http 是因为它渲染进程有 `script-src 'self'`；我们没有 CSP，srcdoc + 自设 CSP 已实测等价）。
  　· 实现：`client.js` 新增 `UI_TOKENS`（11 个 `--dl-*`）与 `uiThemeVars()`（从 `.dl` 的 computed style 采、带 `<>{}` 的值丢弃、失败返回空），`uiDocument(code, vars)` 注入 `:root`，基础排版（h1–h3/table/pre/blockquote/hr）改用 `var(--dl-*,兜底)`；拿不到变量时不写空 `:root`。`sandboxFrame` 在 `load` 后 ping 一次，框内加 `message` 监听重报高度（补首报竞态）。新增 `skills/card-guide/SKILL.md`（5.8 KB，按 DIVA 纸墨改写禁令：保留品牌渐变、字重 400/600/650、字号 ≥11px），加进 `scripts/lib/skills.mjs` 的 `PROJECT_SKILLS`。
  　· 验证：`tests/daily-client.test.mjs` **35/35**（+3 条：变量注入与顺序、无变量不留空 `:root`、采集清洗与 `<`/`>` 丢弃）；真 Chrome `ui-frame.png` 卡片吃上 `--dl-paper-2`/`--dl-ink-3`/`--dl-rule-soft`/`--dl-grad`；`card-guide` 装进 `$DSH_HOME/skills/` 后**当场出现在可用技能列表**（无需重启）；`npm test` **1412/1406/0/6**。
  　· 未做：① 卡片按钮没有回路（`postMessage` 发得出、宿主没接收端，指南里明写别承诺点了就执行）；② 换肤后卡片跟不跟着变没验；③ master 提示词里没有「想画界面先 load card-guide」，所以她**不会主动画**，只能被要求画。
  　· 追加（17:3x，按钮回路，主人拍 T2a）：先查清 hanako **没有这个回路**（`InteractiveCard` 只认 `hana.card-resize`，`InteractiveCard.tsx:105`；CSP `connect-src 'none'` 连 `fetch` 都断），它的按钮只能在框内自己动。三档（T1 框内自嗨 / T2 回话 / **T3 直接派单**）摆开，主人选 T2a＝**点一下只把话填进输入框，不自动发**。实现：`uiPickText`（去空白、CRLF 归一、截 500 字）、`deliverUiPick`、`setUiPickSink`，`watchUiHeight` 的单一 message 监听里加 `uiFrameOf(event.source)` 闸——**只认我们自己挂的框**，别的一律不理；输入框已有字时另起一行不覆盖，光标落到末尾。**没做派单**：右栏 Today 是 worker 写的，卡片若能直接派活，worker 写的 HTML 就能间接生成工单，派活必须走她正常接单路径。
  　· 验证（按钮）：`tests/daily-client.test.mjs` **38/38**（+3：点了不进 `harness.sends`、已有输入另起一行、空话/非字符串/超长清洗、无接收端安静丢弃）。指南第 ③ 模板同步改为「`dlUiPick` 的值必须是主人会说的话」。
  　· 证据 `docs/logs/2026-11-daily/v0.6.0-card-polish/`。
  阻塞：无

- [ ] **DV-UI-009 「日常」左栏接 superagent 主会话（微信式）+ 右栏三页改 genui `dsh-ui` spec 渲染** `sev-P1`
  目标：左栏只渲「她的话 / 你的话」两种气泡，接 superagent 的主编排会话（用户 2026-11-14 23:0x 定稿：就是要接 master）；右栏按主人的分块 = **Today / 任务 / 悄悄话**（2026-11-15 15:5x 定稿：记忆页不用留、能力页也不用），全部由 genui `dsh-ui` spec 渲染；悄悄话是**占位页**，等《心流》自主能力系统与《野兔》情绪系统上线再接。genui 只 vendor 子集进本插件，不全局安装。
  状态：doing（实现与自测完成，运行期待重启）｜ owner：本会话 ｜ 开始：2026-11-14 22:06 ｜ Scope：plugins/dsh-daily/、tests/daily-*.test.mjs、docs/logs/2026-11-daily/v0.2.0-chat-and-cards/、TODOLIST.md
  进度：中途试过「独立建一条日常会话」，用户否掉——按 `superagent/src/app/sessions.ts:235-237`，只有 `masterId` 那条会被挂上 superagent 的提示词与工具，别的会话只走 `limitSubagent`，接不上派活。现已改回认 `orchestrator-<hash>` 主会话（`runtime.ts:104`、`:210`）。右栏已 vendor genui 19 种节点（来源 `.workspace/genui` @ `3357603`，MIT，见 `plugins/dsh-daily/VENDORED-genui.md`），四页手写 DOM 全部删除。
  验证：`tests/daily-client.test.mjs` 26/26；`.artifacts/dsh-daily-check/render3.mjs` ALL PASS；`.artifacts/dsh-daily-check/shot-page.mjs` 真 Chrome 截图 `gcards 9 / groots 5 / legacyPanels 0 / 无页面错误`；`npm test` 1385 项 / 1379 通过 / 0 失败 / 6 跳过（上一轮那条 `memory-actmem` 时间窗失败本次因运行时段在 4:00 后未出现，仍未修）。
  追加（2026-11-15 11:3x，用户定稿）：「新建聊天」**只折叠显示**——左栏仍绑同一条 master 会话，点头部按钮把之前的气泡收进「展开更早的 N 条」，可展开/收起，不发消息、不建会话、不改历史；分界按会话 id 存 `localStorage`（`dsh-daily/fold/<sessionId>`），刷新后仍收着。证据 `docs/logs/2026-11-daily/v0.2.1-folded-chat/`、真 Chrome 三态 `fold-{0-before,1-new-chat,2-expanded}.png`；纯浏览器半边，刷新即生效、不用重启。
  追加（2026-11-15 12:4x）：分界会过期——master 会话被搬走重建后 seq 从头数，本地那条旧分界指向不存在的消息，会把新的一段一起吞掉。现在 `lastSeq < 分界` 即作废并从 `localStorage` 抹掉（`client.js` 的 `stale`/`boundary`）；测试 27/27。证据 `docs/logs/2026-11-daily/v0.2.2-stale-fold/`。
  追加（2026-11-15 15:5x）：**右栏四页改回主人的三块**——`Today / 任务 / 悄悄话`，记忆页与能力页删除（四页本是照搬 OpenToday 原型），悄悄话只做占位（一张卡说清以后放什么、等什么才做，无任何控件）。`client.js` 1815 → 1640 行；`MEMORY`/`SKILLS` 与两个 View 全删。验证：`tests/daily-client.test.mjs` 26/26、`render3.mjs` ALL PASS、真 Chrome 三张截图无页面错误、`npm test` 1396/1390/0/6。证据 `docs/logs/2026-11-daily/v0.3.0-three-pages/`。**纯浏览器半边，硬刷新即生效，不用重启。**
  下一步：等用户 `npm run stop` + `node .artifacts/dsh-home/reset-master-session.mjs` + `npm start`（用户 12:4x 选定「删整条 master 会话」），再按 `docs/logs/2026-11-daily/v0.2.0-chat-and-cards/acceptance.md` 验收（三页页签、筛选、窄窗、焦点环），最后加 `docs/logs/2026-11-daily/v0.3.0-three-pages/acceptance.md` 那五组勾选。
  验收：左栏无推理块/工具行/命令回显；两张示例卡带「示例」角标且坏节点只丢自己；三页从 spec 出；悄悄话页只有一张占位卡、没有任何开关与筛选。
  清理清单（只搬不删，可回滚）：`reset-master-session.mjs` 搬走 master 会话目录 + `storages/session_projcache/sessions/orchestrator-4d18….json` + `storages/dsh-context/overview-cache.v1.json` → `backups/20261115-master-session/`；`orchestrator.sqlite`（工单/设置/提示词）、ActMem、人格、skills 都不动。`cleanup-autodream.mjs` 那份清单里的 dream 会话与 refine 工作区本轮未动。
  备注：`plugins/dsh-daily/` 在根仓库里未被跟踪，回滚靠 `.artifacts/dsh-daily-backup/20261115-before-genui/` 的三份原始文件（覆盖到 genui 之前）；只撤「新建聊天」按 `docs/logs/2026-11-daily/v0.2.1-folded-chat/acceptance.md` 末尾的六处删。
  未验证：运行期收发闭环与真页面手感（等用户重启后看）
  阻塞：无

- [ ] **DV-UI-010 把 DIVA 人格接回主会话（去掉 master 的 complete + 发布人格 r1 + 启用 laputa）** `sev-P1`
  目标：「日常」左栏那条 master 会话的系统提示词里真的有 `laputa:persona`，说话用人格口吻；路由与派活不退化。
  状态：doing（实现与静态验证完成，运行期待重启）｜ owner：本会话 ｜ 开始：2026-11-15 00:05 ｜ Scope：patches/superagent-persona.patch、patches/superagent-patches.json、tests/source-runtime.test.mjs、docs/logs/2026-11-persona/v0.1.0-master-prompt/、TODOLIST.md
  进度：根因两层——① `superagent/src/app/sessions.ts:244-249` 给 master 的 policy 段标了 `complete: true`，装配时 `sections: [completeSection]`（`deepseek-harness/packages/core/system-prompt/src/index.ts:653-685`），人格段整段被丢；② laputa 在本机其实是 disabled（bundle 默认 `enabled:false`、profile 无覆盖），人格六件套全 0 字节。已打补丁去掉 `complete` 并用 `withTemporaryPatch` 重建 `superagent/lib`；已用面板开关启用 laputa；已发布人格 revision 1（1355 字）。
  验证：`git -C superagent apply --check ../patches/superagent-persona.patch` exit 0；构建后 `superagent/lib/index.js` 里 `complete: true` 0 命中；`git -C superagent status --short` 为空；`tests/source-runtime.test.mjs` 29/29（清单断言十一条→十二条）；laputa `status` 为 `enabled=true initialized=true revision=1 chars=1355`，六份正文与 `revisions/r000001/` 逐字节一致。
  下一步：等用户 `npm run stop` + `node .artifacts/dsh-home/cleanup-autodream.mjs` + `npm start`，按 `docs/logs/2026-11-persona/v0.1.0-master-prompt/acceptance.md` 验收；路由若退化则撤补丁重建。
  验收：日常里问「你是谁」用人格口吻回答且不再出现 `dream_…` 汇报；明确请求仍进工单；`npm test` 全绿。
  备注：人格正文是起步稿（只依据 README 9-19/23 与 architecture 的所有权 invariant），用户可在「设置 → 人格」改文本并发布新 revision，不涉及代码。laputa 的启用是可逆的（面板开关或 profile 那行改回 false）。
  未验证：重启后人格是否真的进 master 提示词；去掉 `complete` 后 master 多吃到的系统段会不会影响路由
  阻塞：无

- [ ] **DV-UI-013 「初始化 Superagent 会话」做成设置项（插件 dsh-superagent-reset）** `sev-P2`
  目标：用户 2026-11-15 12:5x 定稿——不再手动跑脚本，把「删整条 master 会话」做成一行动作：设置 → 通用 → 一行「初始化 Superagent 会话」；二次确认后只写排队标记，真正搬移由 `npm start` 在 host 起来之前做。
  状态：doing（实现与静态验证完成，待注册与重启验收）｜ owner：本会话 ｜ 开始：2026-11-15 13:05 ｜ Scope：plugins/dsh-superagent-reset/、scripts/vivy-dsh.mjs、scripts/lib/component-setup.mjs、tests/superagent-reset.test.mjs、TODOLIST.md、docs/logs/2026-11-superagent-reset/v0.1.0-settings-row/
  进度：三件——① host 半边 `index.js` 挂 `/dsh-superagent-reset/api`（status/queue/cancel，校验抄 `dsh-laputa/src/http.ts:211-250` 的 `allowedHost`/`sameOrigin`/`connection.requestRejection`，写操作还要 `content-type: application/json` + 请求体 `confirm: true`）；② client 半边注册 `settings.general.item`（id `superagent-reset`、order 80），两段式确认、排队后变「已排队 · 取消」，并回显上次结果；③ `lib/reset.mjs` 管排队标记、目标盘点（master 会话 + 投影缓存 + 洞察缓存）、rename 进 `backups/reset-<时间戳>/`。启动器在 `pruneLogs()` 之后、spawn 之前消费标记（`scripts/vivy-dsh.mjs`）；`componentPackages()` 已加本插件，注册靠 `npm run setup:components`。
  验证：`node --test tests/superagent-reset.test.mjs` 11/11；`npm test` 1397 项 / 1391 通过 / 0 失败 / 6 跳过；`client.js`/`index.js`/`vivy-dsh.mjs` 均 `node --check` 通过。
  下一步：等用户 `npm run stop` + `npm run setup:components` + `npm start`，硬刷新后在「设置 → 通用」确认这一行；按 `docs/logs/2026-11-superagent-reset/v0.1.0-settings-row/acceptance.md` 验收。
  验收：行标题与说明在；点「初始化」出现二次确认；确认后显示「已排队 · 取消」；启动时控制台打印 `Superagent reset: moved N item(s) to backups/reset-…`；日常页变空且发一句不被折叠行吞掉。
  备注：搬移一个字节都不删，全在 `backups/reset-<时间戳>/`；`orchestrator.sqlite`、ActMem 记忆卡、人格、skills 不进这套。`plugins/dsh-superagent-reset/` 与 `plugins/dsh-daily/` 一样未被根仓库跟踪。
  未验证：真 host 里的注册与渲染（本轮没停过服务）、`settings.general.item` 那一行在设置页的实际排版、`connection.requestRejection` 在自建 prefix 路由上是否照旧可用
  阻塞：无（等重启验收，非阻塞）

- [ ] **DV-EV-019 AutoDream 改成独立会话类型：代码与构建已完成，等一次重启验收** `sev-P1`
  目标：时间到 → 准备语义 → 启动 autodream 精炼会话 → 提交人工审批；全程不经 Superagent 准入/工单。
  状态：doing（实现完成；运行期验收待重启）｜ owner：本会话 ｜ 开始：2026-11-13 01:55 ｜ 完成：2026-11-13 03:50
  下一步：用户执行 `npm run restart` + 硬刷新，按 `docs/logs/2026-11-autodream-native/v0.1.0/acceptance.md` 走 A1–F1。

- [ ] **DV-UI-007 「日常」页面插件（dsh-daily）：加载错误已修复并重启，待刷新验收** `sev-P2`
  目标：左栏「插件」上方一个独立入口「日常」；主面板照搬参考原型的两栏工作台（左对话栏 + 右 Today/任务/记忆/能力 四页），文案一条不改，只把皮换成 DIVA 核心元素，不接数据。
  状态：waiting-user（module 导出修复 done；12/12 测试通过；已挂 127.0.0.1:7890 代理并重启，runtime ready）｜ owner：codex-daily-module-20261114 ｜ 开始：2026-11-14 ｜ Scope：plugins/dsh-daily/client.js、tests/daily-client.test.mjs、TODOLIST.md、docs/logs/2026-11-daily/v0.1.2-module-export/
  下一步：硬刷新 http://127.0.0.1:3082；先按 v0.1.2-module-export/acceptance.md 确认加载，再按 v0.1.1-copy/acceptance.md 验收页面。2026-11-14 已按用户要求保存代理并在沙箱外成功重启，status 无服务错误、proxy.needs_restart=false。
  验收：入口在「插件」之上且不被折进 VIVY心核；两栏不溢出、各自滚动；四页文案与原型一致（400+ 行逐行比对已过）；勾选/切页/任务筛选/开关可用。
  Scope：plugins/dsh-daily/、tests/daily-client.test.mjs、plugins/dsh-vivy-studio/sidebar-core.js、plugins/dsh-vivy-studio/README.md、scripts/lib/component-setup.mjs、TODOLIST.md、docs/logs/2026-11-daily/
  日志：docs/logs/2026-11-daily/v0.1.2-module-export/（加载修复）；v0.1.1-copy/（页面照搬）
  未验证：真 GUI 像素（缺面板 token；离线 Chrome 四页截图已出）；重启后「日常」是否真的落在分组之外（逻辑上已改白名单，运行期未印证）；1080 以下窄窗折行
  备注（2026-11-14 22:06）：本条只保「两栏框架 + 右栏任务/记忆/能力三页 + 入口接线」；左栏真对话与右栏卡片转 DV-UI-009，原型里那段假对话与 Today 简报随之退场。
  阻塞：无（已重启，等刷新验收）

- [ ] **DV-DOC-001 IM 接入与统一网关：方案已出，待拍板** `sev-P2`
  目标：用户就 D1–D5 做出选择后，按选定路线实施（A / B1 / B2 / C）。
  状态：waiting-user ｜ owner：4741b8045c5b ｜ 开始：2026-11-10 08:31
  下一步：用户已给出需求「对话 + 主动探索，且以官方支持为前提」→ 先确认 §11.5 的战略转向（QQ 走官方机器人而非 SnowLuma 个人号），再回答 D1–D5。
  验收：`docs/research/im-gateway-unification.md` §6 五条决策都有结论，且用户明确选定路线。
  Scope：docs/research/im-gateway-unification.md（**本轮纯文档，未改代码**）
  日志：docs/logs/2026-11-im-gateway/v0.0.1-im-gateway-survey/
  未验证：见 DV-DOC-002；另有 dsh-im 源码行为、dsh-im 与 rc.5 `app.asar` 补丁的兼容性、真实 QQ 闭环
  阻塞：无（等用户决策，非阻塞）

- [ ] **DV-DOC-002 补齐各平台「主动消息」官方规则核实** `sev-P3`
  目标：把 §11.3 表里标「未核实」的格子全部换成官方文档原文。
  状态：todo ｜ owner：未认领 ｜ 开始：—
  下一步：逐条核对 ①飞书应用机器人主动私聊是否有隐性限额 ②Discord/Slack/WhatsApp/Matrix 官方条文 ③QQ 官方机器人「允许主动发送」开关默认值 ④QQ 机器人类目/资质门槛。
  验收：§11.3 与 §11.6 中不再有「未核实」标记，且每条附官方 URL。
  Scope：docs/research/im-gateway-unification.md
  日志：docs/logs/2026-11-im-gateway/v0.0.1-im-gateway-survey/
  未验证：本条自身即未完成
  阻塞：无（飞书/企业微信官方文档为 SPA，`web_fetch` 抓不到正文，需人工在浏览器中查看后回报）

- [ ] **DV-DOC-007 千问 Token Plan 接入：选型已出，等 key** `sev-P2`
  目标：把已有 Token Plan 接进 DSH（P0′），再决定决策模型/ASR 的接入顺序。
  状态：waiting-user ｜ owner：本会话 ｜ 开始：2026-11-11 06:05
  下一步：用户提供 `sk-sp-` key（或告知已存于 `.credentials.yaml` 的哪个 ref）→ 按 `cordis.patch.yml` 增 `qianwen-token-plan` provider，重启后验文本/带图/内置 web_search 三条。
  验收：模型选择器出现 `qwen3.8-flash` 等条目；三条验证各有一次成功响应；`docs/research/qwen-platform-model-integration.md` §10 结论成立。
  Scope：`.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml`（本轮**尚未改动**）
  日志：docs/logs/2026-11-qwen-platform/v0.0.1-model-selection/
  未验证：Token Plan 端点真实可用性、内置 web_search 质量与 Credits 消耗、决策模型 systemone 在本机可调
  阻塞：无（等 key，非阻塞）

<!--
条目模板（复制这一段，字段名不要改）：

- [ ] **DV-SC-012 一句话标题** `sev-P2`
  目标：可验证的一句话。
  状态：todo ｜ owner：未认领 ｜ 开始：—
  下一步：动词开头 + 具体文件或命令。
  验收：跑什么 / 看什么。
  Scope：plugins/surfcore/src/memory-card.js
  日志：docs/logs/2026-11-memory-decay/v0.7.24-decay-window/
  未验证：—
  阻塞：无
-->

- [ ] **DV-UI-008 「日常」左栏图标换成咖啡杯** `sev-P3`
  目标：左栏那一行（`sidebar.panellist` / `daily`）的图标从日出换成咖啡标志，注册元数据与几何不动。
  状态：done（代码已改，待用户刷新看像素）｜ owner：本会话 ｜ 开始：2026-11-14 16:47 ｜ 完成：2026-11-14 17:18
  下一步：用户硬刷新 `http://127.0.0.1:3082`，按 v0.1.3-coffee-icon/acceptance.md 看 16px / 18px 两种宽度；不满意就按 summary.md 里留的原路径换回日出。
  验收：图标读成咖啡杯、粗细与相邻图标一致、行高与文字位置不变。
  Scope：plugins/dsh-daily/client.js、plugins/dsh-daily/README.md、TODOLIST.md、docs/logs/2026-11-daily/v0.1.3-coffee-icon/
  日志：docs/logs/2026-11-daily/v0.1.3-coffee-icon/
  未验证：活 GUI 像素（面板地址要 `?token=`，本会话拿不到）；深色主题对比度；带 runner 的 `node --test` 在本沙箱 EPERM（起子进程要命名管道），已改为直接执行测试文件
  阻塞：无

- [ ] **DV-UI-001 日常页 v0.1 评审：框架成立，待抽卡槽 + 接真数据** `sev-P2`
  目标：把「日常」从静态样本推进到「数据驱动 + 卡片可复用」。
  状态：waiting-user ｜ owner：本会话 ｜ 开始：2026-11-14 16:46 ｜ 评审完成：2026-11-14 16:55
  现状：`plugins/dsh-daily` v0.1.0 已按正规路径接线（profile `link:` + `dsh.profile.bundles` + `node_modules` 软链 + `component-setup.mjs` 登记）；`client.js` 927 行手写 ModuleLoader bundle、无构建；两个注册点 `sidebar.panellist`（id `daily`, order -5, label thunk）与 `main`（key `daily`）；四页 Today/任务/记忆/能力；样式 `.dl` 作用域 + 自有 `--dl-*` 变量。
  结论：框架成立——官方 slot 契约、入口与面板 key 同名、`label` 走 thunk 合法（`resolveSlotLabel` 支持）、`.dl` 作用域不污染、侧栏图标走 currentColor。决定它能走多远的是五点：①卡槽未抽出（邮件卡/待确认卡/步骤条/进度条/周条是写死 JSX）；②状态只在 `useState`，切页即丢；③不被折进「VIVY心核」靠改 `dsh-vivy-studio/sidebar-core.js` 白名单，属跨插件隐式约定；④`.dl` 变量不在 `--dsw-*` token 体系，深色主题不跟随；⑤文案硬编码（产品名固定中文合理，页内 400+ 行文案将来要翻译）。
  下一步：用户拍板是否做 P0（把 5 块卡抽成 `{kind, props}` + 统一 `renderCard`，视觉零差异、只换数据源），再 P1（接 `todo_write` 列表或审批/待确认，只读）。
  验收：P0 后四页视觉零差异且 `node --test tests/daily-client.test.mjs` 全绿；P1 后至少一张卡内容来自真实会话数据。
  Scope：plugins/dsh-daily/、docs/
  日志：—（本轮只评审，无交付）
  未验证：GUI 是否已加载 16:17 最后一版 `client.js`（截图是 13:45 的）；`node --test tests/daily-client.test.mjs` 本轮未跑（沙箱拒绝外部进程命名管道）；根 `npm test` 里 `voice-registration` 的 2 条 Windows `ERR_UNSUPPORTED_ESM_URL_SCHEME` 与本页无关但会让全量红
  阻塞：等用户拍板是否做 P0

### L0 启动器 / 脚本 / 测试 / 补丁

- [x] **DV-OPS-006 全量测试修到全绿（Windows）** `sev-P1`
  目标：`npm test` 全绿，并把「环境限制造成的假失败」和「代码/测试可移植性缺陷」分开记录。
  状态：done（`npm test` 1371 项 / 1365 通过 / 0 失败 / 6 跳过，exit 0，51s）｜ owner：本会话 ｜ 开始：2026-11-14 ｜ 完成：2026-11-14 20:25
  下一步：无（要提交就按 release.md 建议切 5 笔：4 个根仓实现 + 1 个子模块 + 1 组测试）。
  验收：`npm test` 退出码 0，`pass 1365 / fail 0`；6 条跳过全部是「本机缺模型/ffmpeg/符号链接权限」。
  Scope：scripts/surfcore-loader.mjs、scripts/lib/component-setup.mjs、scripts/lib/component-migration.mjs、scripts/lib/surfcore.mjs、scripts/check-asr-mount.mjs、plugins/voice/src/voice-pack-import.js、tests/*.test.mjs（20 个）
  日志：docs/logs/2026-11-test-suite-windows/v0.1.0-full-suite-green/
  未验证：Linux / macOS 未复跑；`evolution-records` 的 `0700/0600` 两条在 Windows 上按平台跳过（ACL 未验）；`plugins/voice` 子模块指针变更未提交；其它 submodule 的脏指针不是本轮产物
  阻塞：无

- [ ] **DV-OPS-005 上游贡献：Superagent Windows 补丁整理成 PR（卡推送凭据）** `sev-P3`
  目标：把 `patches/superagent-windows.patch` 提成上游 `deepseek-ai/dsh-superagent-prototype` 的 PR；其余本地改动逐条评估，判「不做」的留证。
  状态：waiting-user（分支 / 提交 / PR 文案已备好，缺 GitHub 凭据）｜ owner：本会话 ｜ 开始：2026-11-14 00:40 ｜ 完成：2026-11-14 01:05
  已做：①`.artifacts/upstream/superagent-windows` 干净克隆自上游 `main@8c32a9d`，分支 `fix/windows-support`，提交 `9e56763`（作者沿用本仓既有身份 `mastwet`）；②`absolute()` 原来不认 UNC，改为 `/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\])/`，并补 `describe('windows')` 两条单测（回退 `src/` 三个文件即红，已验证）；③钉住的 `superagent/` 上把 11 个补丁全打后 `tsc --noEmit` 退出 0，工作区恢复干净；④构建期补丁更新为 7,048 字节 / 3 文件（**只收 `src/`**：根仓 `tests/windows-deployment.test.mjs` 把补丁打进只含 `superagent/src` 的夹具，带测试文件会让 3 条用例全红），`node --test tests/windows-deployment.test.mjs` 3/3 通过。
  结论（候选裁决）：只有这一条值得上游。`plugins/dsh-see-now` 的面板是产品取舍（我们 `HEAD` 与上游 `main` 同为 `1d98dd5`，差异全在未提交的面板），应先开 issue 问；`scripts/lib/surfcore-*.mjs` 是本项目集成层（组件 IPC、记忆委托、面板外壳），不是上游 bug；`third-party/dsh-context` 干净。
  下一步：用户按 `docs/logs/2026-11-upstream-contrib/v0.1.0-superagent-windows/acceptance.md` 推送并开 PR（A 手工 push / B `gh auth login` + `gh pr create`）。
  验收：上游出现指向 `main` 的 PR 且只含 4 个文件；或用户明确放弃贡献，则本条改 done 并保留补丁。
  Scope：patches/superagent-windows.patch、.artifacts/upstream/superagent-windows（缓存，不入库）、docs/logs/2026-11-upstream-contrib/v0.1.0-superagent-windows/
  日志：docs/logs/2026-11-upstream-contrib/v0.1.0-superagent-windows/
  未验证：上游 CI 的 Linux / macOS 矩阵、真实 `gh` / `lark-cli` 在 Windows 上被解析后的启动
  阻塞：本机无 git 推送凭据（`git push --dry-run` → `could not read Username`），`gh` 未登录（`hosts.yml` 只有用户 `mastwet`、无 token）

- [x] **DV-OPS-004 Windows esbuild 大文本临时文件删除失败** `sev-P2`
  目标：`just dev` 的 Web 构建不再因 esbuild 删除临时文件被拒绝而退出。
  状态：done ｜ owner：codex-esbuild-pipe-20261113 ｜ 开始：2026-11-13 ｜ Scope：scripts/dev.mjs、scripts/lib/esbuild-pipe.cjs、tests/esbuild-pipe.test.mjs、docs/logs/2026-11-just-dev/v0.2.0-esbuild-pipe/
  下一步：用户重新执行 `just dev`；全量测试 120 失败跟 DV-TEST-001，未做基线归因。
  日志：docs/logs/2026-11-just-dev/v0.2.0-esbuild-pipe/
  验收：真实构建 7/7 通过、Vite watch 重建成功、服务 HTTP 401、专用回归 1/1 通过。
  未验证：系统阻止 native 删除的更底层原因、浏览器热更新、真实终端 Ctrl+C。

- [x] **DV-OPS-003 Justfile 一键启动 DSH 开发服务器** `sev-P2`
  目标：`just` 输出使用教程，`just dev` 启动项目内 DSH web 构建监听及前台服务。
  状态：done（默认教程实测通过；完整热更新未验证） ｜ owner：codex-just-dev-20261113 ｜ 开始：2026-11-13 ｜ Scope：Justfile、scripts/dev.mjs、README.md、docs/logs/2026-11-just-dev/v0.1.0/
  下一步：使用 `just dev`；Vite 临时文件权限错误及全量测试失败/挂起跟 DV-TEST-001。
  日志：docs/logs/2026-11-just-dev/v0.1.0/
  未验证：完整首次构建、浏览器热更新、真实终端 Ctrl+C；详见 verification.md。

- [ ] **DV-UP-001 SurfCore 上游现状：stable v0.8.9 / dev 整架构重写，待拍 D1–D4** `sev-P2`
  目标：就「是否从 v0.8.6 升到稳定 v0.8.9」与「dev 线是否跟」拿到结论，避免凭印象挑版本。
  状态：waiting-user（报告已交付，等 D1–D4）｜ owner：本会话 ｜ 开始：2026-11-13 02:50 ｜ 完成：2026-11-13 03:15
  事实：上游 `main`=v0.8.9（0ce8580，2026-11-06）、`dev`=v0.8.9-dev.6（af0ded7，2026-11-12，整包重写、后端未接线）；我们钉 59ec3066=v0.8.6；v0.8.6→v0.8.9 为 351 文件/+33240−1160；9 个锚点文件实测 **3 条渲染链断裂**（`src/bridge.js`、`lib/index.js`、`lib/scheduler.js`），其余 6 个原样可用。
  排序：`docs/research/surfcore-upstream-status.md` §10.5 —— P0 6 条（环境适配/直接坏）、P1 11 条（行为正确性）、P2 7 组（与 ActMem/plugins-memory/vivy-tone 正面冲突，不吃）、P3 dev 线；每条标了落点与成本（断裂面 / 模块级）。硬结论：P0 六条里 4 条在 `bridge.js`，所以「吃 P0」等价于「重锚 bridge.js」。
  下一步：等 D1（A 维持 v0.8.6 推荐 / B 升 v0.8.9 / D 单点移植）、D2（是否接受「重锚+语义复核」一整轮）、D3（dev 线只观察推荐 / 订阅 / 弃）、D4（是否先清 DV-TEST-001 再升）；见 `docs/research/surfcore-upstream-status.md` §8。
  验收：§8 四条都有结论；若选 B，`npm run setup:surfcore` 无 `SURFCORE_PATCH_DRIFT`、`node --test tests/surfcore-*.test.mjs` 全绿、`plugins/surfcore` 的 `test:audit` 与基线可对比。
  Scope：docs/research/surfcore-upstream-status.md、docs/logs/2026-11-surfcore-upstream/v0.1.0-upstream-survey/、TODOLIST.md（**纯文档，未改代码，未动子模块指针**）
  日志：docs/logs/2026-11-surfcore-upstream/v0.1.0-upstream-survey/
  未验证：`renderHostBootSource`/`renderHostWorkdirSource` 两层锚点（未导出，探针只覆盖 `renderHostSource`）；`setup:surfcore` 与 `test:audit` 未跑（只读纪律）；dev 包在本机 rc.5 上能否加载（未试，上游自述后端未接线）
  阻塞：无（等用户决策，非阻塞）

- [x] **DV-OPS-002 整理工作区并上传已有成果** `sev-P2`
  目标：按主题提交已有改动，先上传自有插件，再上传主仓库与可获取的子模块指针。
  状态：done ｜ owner：codex-workspace-upload-20261113 ｜ 开始：2026-11-13 ｜ Scope：根仓库、自有脏插件、plugins/capability-hub（排除上游三仓）
  下一步：整理上传已完成；后续测试修复按 DV-TEST-001 单独认领。
  验收：远端分支包含提交；主仓库无遗漏的交付文件；保留项有记录。
  日志：docs/logs/2026-11-workspace-upload/v0.1.0/
  未验证：根全量 151 fail、Harness 2 fail、SurfCore audit 未完成；浏览器和完整 setup 未重跑，详见日志。
  阻塞：无

- [x] **DV-OPS-001 临时根移出工作区 + 技能纳入 setup 安装** `sev-P2`
  目标：修复「`pwsh` 所有命令被沙箱拒绝」；让 `npm run setup` 可重复安装 `more-faster-better-economical`。
  状态：done（临时根**重启后生效**）｜ owner：本会话 ｜ 开始：2026-11-11 05:52
  下一步：重启 DSH 后跑一条 `pwsh` 验证；停面板后跑 `npm run setup` 验证两个 skill 都被装到 `$DSH_HOME/skills`。
  验收：`scripts/lib/source.mjs` 的 `TMP/TEMP/TMPDIR` 落在工作区外；`npm test` 中 source-runtime / dream-skill 相关用例通过；技能目录出现两个 skill。
  Scope：scripts/lib/source.mjs、scripts/lib/skills.mjs、scripts/lib/dream-skill.mjs、scripts/setup-components.mjs、tests/source-runtime.test.mjs、tests/dream-skill-install.test.mjs、skills/more-faster-better-economical/SKILL.md、AGENTS.md
  日志：docs/logs/2026-11-launcher-env/v0.0.1-temp-and-skills/
  未验证：全量 `npm run setup`（面板运行中，setup-components 主动拒绝）；重启前 `pwsh` 仍会被旧进程的 TMP 拒绝。
  阻塞：无

### L0 插件（surfcore / memory / voice / asr / actmem-recap / mempalace / laputa / evolution / live2d / 皮肤）

- [ ] **DV-UI-006 「我看到了」面板复审：把「0 张」判据补进调试页** `sev-P2`
  目标：调试页能用一句话回答「帧在涨，为什么没出图」，并削掉面板轮询上的无谓请求。
  状态：done（**待重启验收**）｜ owner：本会话 ｜ 开始：2026-11-14 00:25 ｜ 完成：2026-11-14 01:10
  已做：①`snVerdict()` 五分支结论（没在采集 / 一帧没抓到 / 抓了 N 帧但没留帧=画面没变化 / 留了帧还没封箱 / 已出 N 张），调试页新增 10 项计数（留下的帧、判据切/标/底、重复跳过、分数均值与最高、档位分布、首帧至今、叫醒空手、预留图、溢出）；②动作后不再补两趟 GET；③`document.hidden` 时跳过轮询；④`readLifecycle()` 改按 `limit` 尾部读；⑤`sheets` 取值统一、卡片 tone 补样式、toast 4 秒清、标签补 ARIA、隐私页「停止一切采集」改名「停止采集与陪看」。
  下一步：`npm run stop && npm start` + 硬刷新，按 `docs/logs/2026-11-see-now/v0.3.2-panel-review/acceptance.md` 走 1–7 步，重点看第 2 步那句结论与第 4 步「张」是否从 0 变 1。
  验收：静止画面给出「画面没变化」的解释而不是光秃秃的 0 张；变化画面上「留下的帧」>0 且「张」≥1；停止后 toast 约 4 秒自行消失。
  Scope：plugins/dsh-see-now/client.js、plugins/dsh-see-now/src/lifecycle-store.mjs、plugins/dsh-see-now/test/{client-wiring,lifecycle-store}.test.mjs、patches/see-now-vivy-core.patch、docs/logs/2026-11-see-now/v0.3.2-panel-review/
  日志：docs/logs/2026-11-see-now/v0.3.2-panel-review/
  未验证：端内观感（运行中的宿主仍是旧 bundle）、真实变化画面下 `0 张` 的归因、轮询削峰的前后实测、根仓既有 Windows 失败（DV-TEST-001）
  阻塞：无（需用户重启宿主）

- [ ] **DV-UP-002 SurfCore 向量记忆管线移植进 MemPalace（P0-1..P0-3 + 云向量引擎，done 待验收）** `sev-P2`
  目标：按用户 2026-11-13 定调，只移植「管线」不搬「引擎」——分空间索引、四段打分召回注入、敏感闸门、fail-closed 校验；云端 embedding 走 `capability-hub` 的 `embedding` 插槽。
  状态：done（**待重启验收**；云端 live 待 key） ｜ owner：p0-spaces-cloud-20261113 ｜ 开始：2026-11-13 03:50 ｜ 完成：2026-11-13 04:25
  本轮交付：多向量空间（`embedding_spaces`/`memory_spaces` + 每空间一张 `vec0`）、旧库原地收养并写迁移备份、宽度不符不写向量、云端适配器（批量/超时/一次重试/5 分钟熔断/`dimensions` 降级）、四信号召回注入 + 敏感闸门、`/spaces` 与 `/embedding/*` 四个接口、面板「向量空间」卡与探测按钮、`scripts/spaces-check.mjs` 与 `scripts/embedding-probe.mjs`。设计与运维见 `docs/mempalace-multi-space-embedding.md`。
  已核：8 个测试文件 84 通过 / 1 跳过（Windows 符号链接 EPERM）/ 0 失败；线上库已实际迁移（7/7 行入 `memory_spaces`，备份 `memories-2026-11-12T20-07-35-838Z.db` 已落盘）；真实库副本 dry-run 切到 512 维云空间后旧数据完整。
  下一步：`npm run stop && npm start` → 硬刷新 → 按 `docs/logs/2026-11-surfcore-upstream/v0.4.0-p0-spaces-recall-cloud/acceptance.md` 走 A/B/D（C 等 key）。
  验收：384 与 512 两空间同库共存 ✓；配错空间显式报错且不写库 ✓；含旧事的问法能召回 ≤4 条且敏感记录不出现 ✓（离线用例）；测试无新增失败 ✓；云端 probe 一次实打实 ✗（等 key）。
  Scope：plugins/dsh-mempalace/**、tests/mempalace*.test.mjs、scripts/spaces-check.mjs、scripts/embedding-probe.mjs、docs/**
  日志：docs/logs/2026-11-surfcore-upstream/v0.4.0-p0-spaces-recall-cloud/
  未验证：云模型是否接受 `dimensions` 与真实维度（等 key）；`qwen3.7-text-embedding` 维度；面板像素（沙箱无浏览器）；`sensitive` 存量行未回填；千行级重建耗时。
- [ ] **DV-UP-003 云端向量 live 验收（等 key）** `sev-P2`
  目标：用户提供 key 后跑一次真实 embedding，确认维度/延迟/端点与面板自检闭环。
  状态：waiting-user ｜ owner：p0-spaces-cloud-20261113 ｜ 开始：2026-11-13 03:50 ｜ Scope：plugins/dsh-mempalace/src/store/cloud_embedding.mjs、scripts/embedding-probe.mjs
  下一步：世界网关「向量化」插槽启用并填真实 baseURL + `DASHSCOPE_API_KEY` → 面板「设置 → 模型与网络 → 探测向量接口」，或 `node scripts/embedding-probe.mjs --dim 512 --json` → 把实测维度写回 DV-UP-002 的 verification.md 第 13 行，并把 `cloudEmbeddingDim` 对齐后点「重建缺失向量」。
  阻塞：无（等用户提供 key）

- [ ] **DV-UI-004 SurfCore 面板铺满 + 四段固定骨架** `sev-P2`
  目标：SurfCore 面板整块铺满面板区（不再套居中卡片），内部固定「头部 / 标签栏 / 内容 / 底部操作」四段；只有内容区滚动，页脚不再浮在内容上，面板外不再有第二条滚动条。
  状态：doing（生成器已改、bundle 已重建；新页面已量到铺满 + 单滚动区）｜ owner：本会话 ｜ 开始：2026-11-13 05:20 ｜ 完成：2026-11-13 05:42
  下一步：用户在真实窗口硬刷新复核观感；要再调宽度/留白只动 `panelShellCss` 一处。
  验收：`.surfcore-panel` 的 `scrollHeight === clientHeight`；`.qbw-app` 宽度等于面板宽度且无外边框；`.qbw-foot` 计算值 `position:static`；1440 宽下面板 1160×900，1024 宽 744×768。
  Scope：scripts/lib/surfcore-panel.mjs、docs/architecture.md、docs/logs/2026-11-surfcore-panel/v0.0.1-full-bleed-shell/
  日志：docs/logs/2026-11-surfcore-panel/v0.0.1-full-bleed-shell/
  未验证：深色主题与大字号观感；非 split（设置页 section）模式不走这条外壳
  阻塞：无

- [ ] **DV-UI-003 设置「人格与语气」内加可编辑的语气块** `sev-P2`
  目标：更多 → 设置里的人格页改名「人格与语气」，页内加一个可看可改的「语气」块；保存写回 Superagent 提示词，重启不丢，留空即去掉语气小节。
  状态：done（**待重启验收**）｜ owner：本会话 ｜ 开始：2026-11-12 01:30 ｜ 完成：2026-11-12 02:35
  下一步：`npm run stop && npm start` → 硬刷新 → 按 `docs/logs/2026-11-persona-tone/v0.1.0-tone-editor/acceptance.md` 走 A–F。
  验收：设置导航显示「人格与语气」；页内出现「语气」卡片；保存后 Superagent 的 Prompts 全文与历史版本变化；重启后语气保持；恢复默认、留空与 409 冲突提示可用。
  Scope：plugins/dsh-vivy-tone/**、plugins/dsh-laputa/src/client.js、plugins/dsh-laputa/README.md、docs/architecture.md、tests/vivy-tone.test.mjs、tests/vivy-tone-client.test.mjs、tests/laputa-panel.test.mjs
  日志：docs/logs/2026-11-persona-tone/v0.1.0-tone-editor/
  未验证：端内交互（运行中实例仍是旧代码，本会话由它托管）；真实 Superagent 写入（单测用假 fetch）；浏览器像素（沙箱不能跑 Playwright）
  阻塞：无

- [ ] **DV-UI-002 `VIVY工具` 分组标记换成扳手** `sev-P3`
  目标：侧边栏 `VIVY工具` 头左侧的图标由三条滑轨换成一个开口扳手，尺寸 / 间距 / 收起行为不变。
  状态：done（**待重启验收**）｜ owner：本会话 ｜ 开始：2026-11-12 01:26 ｜ 完成：2026-11-12 01:5x
  下一步：`npm run stop && npm start` → 硬刷新 → 按 `docs/logs/2026-11-sidebar-groups/v0.0.2-tools-wrench/acceptance.md` 走 1–3 步。
  验收：`VIVY工具` 头左侧是开口扳手（斜柄 + 右上开口），线宽与心形 / chevron 一致；`VIVY心核` 仍是心形；分组开合与窄栏行为不变。
  Scope：plugins/dsh-vivy-studio/sidebar-core.js、plugins/dsh-vivy-studio/README.md
  日志：docs/logs/2026-11-sidebar-groups/v0.0.2-tools-wrench/
  未验证：运行中实例仍缓存旧 `sidebar-core.js`（本会话由该实例托管，重启会终止当前回合）；端内像素未看；`verify-skin.mjs` 活体检查未跑（浏览器在本沙箱 spawn EPERM）
  阻塞：无

- [ ] **DV-UI-001 上下文洞察移入新分区 VIVY工具** `sev-P2`
  目标：侧边栏从单组变成两组——`VIVY心核` 保留产品面板，新增 `VIVY工具` 收纳工具面板，`上下文洞察` 从 `心核` 移入 `工具`；两组各自折叠、各自记忆。
  状态：done（**待重启验收**）｜ owner：本会话 ｜ 开始：2026-11-11 08:27 ｜ 完成：2026-11-11 08:44
  下一步：`npm run stop && npm start` → 硬刷新 → 按 `docs/logs/2026-11-sidebar-groups/v0.0.1-vivy-tools/acceptance.md` 走端内 1–7 步。
  验收：侧边栏出现两个分区标题（`心核` 上、`工具` 下，夹在 `自动化任务` 与 `更多` 之间）；`上下文洞察` 只在 `工具` 下；收起一个不影响另一个；两组的开合状态跨刷新各自保留。
  Scope：plugins/dsh-vivy-studio/sidebar-core.js、theme.css、README.md、verify-skin.mjs、tests/vivy-sidebar-core.test.mjs、tests/vivy-skin-css.test.mjs
  日志：docs/logs/2026-11-sidebar-groups/v0.0.1-vivy-tools/
  未验证：运行中实例仍是旧脚本（本会话由该实例托管），端内两个分区未看到；`verify-skin.mjs` 101 项未跑（Playwright 在本沙箱 spawn EPERM）；全量 `npm test` 未跑（`node --test` 子进程被沙箱拒绝）
  阻塞：无

- [ ] **DV-MEM-001 记忆卡投递改到 runtime context** `sev-P2`
  目标：ActMem 记忆卡从 system section（`actmem:card`，order 3）迁到 runtime context，普通会话、worker、router 主 Session 都能收到；工具型子 agent 仍排除；默认仍关闭。
  状态：done（待重启验收）｜ owner：7cd4042aa6b7 ｜ 开始：2026-11-10 16:10 ｜ Scope：plugins/memory/src/card-prompt.mjs、plugins/memory/src/service.mjs、plugins/memory/README.md、tests/memory-card-prompt.test.mjs
  下一步：重启后按 `docs/logs/2026-11-memory-card-context/v0.1.0-runtime-context/acceptance.md` 验普通会话 / router / subagent / 关开关四个面。
  验收：普通会话与 router 的 runtime-context 快照含 `【记忆卡`；subagent 没有；开关关闭后下一步快照无卡；system prompt 里不再有 `actmem:card` section。
  日志：docs/logs/2026-11-memory-card-context/v0.1.0-runtime-context/
  未验证：运行中实例仍是旧代码（本会话由该实例托管，重启会终止当前回合）；四步活体验收待重启。
  阻塞：无

- [ ] **DV-MEM-002 MemPalace 入档条件改为「已退色 / 被淘汰」** `sev-P2`
  目标：ActMem → MemPalace 不再镜像全量归档，只有退到 `fuzzy`/`trace` 或被遗忘/压缩/容量挤掉的记忆才写入退役账本并投递；全量归档仍保留每一条。
  状态：done（待重启验收）｜ owner：7cd4042aa6b7 ｜ 开始：2026-11-10 16:40 ｜ Scope：plugins/memory/src/card-engine.mjs、plugins/memory/src/archive-out.mjs、plugins/memory/src/service.mjs、plugins/memory/README.md、tests/memory-retired-archive.test.mjs、tests/memory-archive-outbox.test.mjs
  下一步：重启后按 `docs/logs/2026-11-memory-retired-archive/v0.1.0-retired-condition/acceptance.md` 验「清晰不入档 / 退色入档 / 只入一次 / 淘汰入档」。
  验收：新加且清晰的记忆不进 `memory-card-retired.jsonl` 且宫殿搜不到；退色或被淘汰后入档一次，`retiredReason` ∈ faded|forgotten|compacted|evicted。
  日志：docs/logs/2026-11-memory-retired-archive/v0.1.0-retired-condition/
  未验证：运行中实例仍是旧代码（本会话由该实例托管）；活体验收待重启；旧的 7 条历史投递仍是旧条件写入，未清理。
  阻塞：无

### L0 第三方插件（third-party/，源码级 + 版本锚定）

- [ ] **DV-3P-001 第三方插件源码目录 + 首个插件 dsh-context** `sev-P2`
  目标：在根仓库建立 `third-party/` 作为第三方社区插件的源码级目录（submodule，逐个锚定到兼容 `0.2.1-rc.5` 的 tag），本轮只接 `bowenliang123/dsh-context`。
  状态：done（**已注册，待重启验收**）｜ owner：本会话 ｜ 开始：2026-11-11 07:30 ｜ 完成：2026-11-11 07:42 ｜ 注册：2026-11-11 08:02
  下一步：`npm run stop && npm start` → 硬刷新 `http://127.0.0.1:3082` → 看「设置」是否出现 Context 分区、`/context` 是否可用，按 `docs/logs/2026-11-third-party/v0.0.1-dsh-context/acceptance.md` 走 1–7 步。
  验收：`third-party/dsh-context` 指向 tag `v0.83.1` 且 `lib/index.js` + `lib/client.js` 存在；`node --test tests/third-party-setup.test.mjs` 通过；`--check` 退出 0；重启后「设置」出现 Context 面板且 `/context` 命令可用。
  Scope：third-party/dsh-context（新 submodule）、third-party/pins.json（新）、scripts/lib/third-party.mjs（新）、scripts/setup-third-party.mjs（新）、tests/third-party-setup.test.mjs（新）、package.json、.gitmodules
  日志：docs/logs/2026-11-third-party/v0.0.1-dsh-context/
  未验证：重启后的端内面板与 `/context`；`dsh.client.inject` 六个客户端依赖在运行时是否齐全；注册时 pnpm 把 `dsh-capability-hub` 副本挪进 `node_modules/.ignored/`（原链接仍在，见 DV-DOC-008）；全量 `npm test` 1122 pass / 289 fail 属既有失败，未逐条与基线对照
  阻塞：无

### L0 上游跟随（DSH / Superagent 升级与补丁）

- [ ] **DV-EV-016 Dream 候选 staging 授权错配（漏传 requestId / baseline 走 GET）** `sev-P1`
  目标：同一 Ticket 拥有多个 Dream Input 时，skill/persona 候选 staging 与 baseline 都绑定本轮请求，不再解析到旧请求或旧路由。
  状态：doing（代码与测试已改，**未跑测试**，待 build + 重启）｜ owner：本会话 ｜ 开始：2026-11-11 06:14
  下一步：`pnpm -C plugins/dsh-continual-harness build` → `npm test` → `npm run stop && npm start` → 手动 refine 一次，plan 应返回 `planned`、execute 返回 `completed`（候选 `pending_review`）。
  验收：refine 的 plan 不再报 `Exact skill entry absent from frozen Dream plan`；baseline 返回 persona revision/draftDigest 与技能列表，而不是 `Unknown Laputa owner operation`；`node --test tests/dream-evolution.test.mjs`、`tests/dream-tool.test.mjs` 与 laputa `vitest run` 通过。
  Scope：plugins/dsh-evolution/src/{dream.mjs,dream-tool.mjs}、plugins/dsh-continual-harness/src/{skill-owner.ts,skill-owner-runtime.ts}、plugins/dsh-laputa/{internal.mjs,tests/internal.spec.ts}、plugins/dsh-evolution/tests/{dream.test.mjs,dream-tool.test.mjs}、docs/dream-executor.md
  日志：docs/logs/2026-11-dream-staging/v0.1.0-owner-request-binding/
  未验证：pwsh 仍被工作区 TMP 拒绝（DV-OPS-001 待重启），本轮一条测试都没跑；失败的那次 run（ticket `c0674ee…`）仍为 blocked，未清理。
  阻塞：无（重启由用户执行；本会话由运行中实例托管）

- [ ] **DV-EV-015 Dream 执行器模式：无 shell、只提交候选** `sev-P1`
  目标：AutoDream/refine 的 worker 只能用 `dream_refine` 读冻结材料并提交计划，工具集里没有任何能写工作区或执行命令的工具。
  状态：doing（待重启验收）｜ owner：75422f6e1b54 ｜ 开始：2026-11-10 10:57 ｜ Scope：patches/superagent-dream.patch、plugins/dsh-evolution/src/{dream-tool.mjs,index.mjs,dream.mjs}、skills/diva-dream/SKILL.md
  下一步：`npm run stop && npm start` 后手动触发一次 refine，确认 Dream 会话只剩 `skill`/`dream_refine`，按 `docs/logs/2026-11-dream-executor/v0.1.0-dream-mode/acceptance.md` 验收。
  验收：Dream 会话发起 `pwsh`/`write` 被工具列表拒绝；`dream_refine claim/evidence/plan/execute` 全链路跑通；非 Dream 会话调用该工具被拒。
  日志：docs/logs/2026-11-dream-executor/v0.1.0-dream-mode/
  未验证：运行中实例仍是旧 Executor（补丁只在新进程生效）；`dream_refine` 在真实 worker 会话中的可见性、以及 `evidence` 分页对 4.4 MB 材料的内存/上下文表现，均需重启后实测。
  阻塞：无（需要停面板重启，而本会话由运行中的实例托管）

- [x] **DV-EV-017 审批链路审计：批准与发布不同步，审批产出未进入进化记录** `sev-P1`
  目标：技能与人格两侧，「批准」与「发布」收敛成一个可核对的结果；审批产出要么真正写进 Evolution 记录，要么明确降级。
  状态：done ｜ owner：本会话 ｜ 开始：2026-11-11 15:18 ｜ 完成：2026-11-11 16:15
  已做：①技能侧新增 `decideAndPublish()`：锁内先提交发布（CAS + 不可变版本 + owner-state 原子替换），成功后才写决定回执；发布失败不落决定，候选留在待审；回执丢失时从 publication 反推，重放不重复发布。`/pending` 增返 `decided`、渲染后的 `bundle/baselineBundle`、ticket/subject/证据引用；新增 `POST /rollback`（生成回滚候选，仍需批准）。②人格侧批准后按「草稿仍等于提案基线」把候选内容同步回草稿（有人工编辑则保留并返回 `draftSynced:false`），`publish()` 拒绝发布等于旧版本的草稿（`persona_draft_stale`）。③审批页增加逐行 diff、附件全文、来源工单/证据、「已处置」与重试、回滚按钮；删除无效的「全局变更需人工确认」开关；记录页空态注明无运行时生产者。④Evolution 记录库本轮**不接线**（`owner-candidates.ts` 注释为未接线），理由见日志。
  下一步：无（A–D、F、G 已活体通过，明细见日志 `verification.md`「活体验收」）。
  验收：模拟 baseline 冲突后该候选仍在待审且可在「已处置」看到；人格批准后不再出现「有未发布修改」；旧草稿发布被拒；回滚入口可用；设置页不再有全局确认开关。
  Scope：plugins/dsh-continual-harness/src/{skill-owner.ts,panel.ts}、plugins/dsh-laputa/src/{candidates.ts,revision.ts,http.ts,domain.ts,client.js}、plugins/dsh-evolution/src/{config.mjs,client.js}、三仓 README 与 docs/{autodream.md,skill-owner.md}
  日志：docs/logs/2026-11-approval-fix/v0.4.0/
  实测：harness `skill-owner+panel` 23 pass；laputa `candidates+revision+http` 77 pass；`tests/evolution-dream-client.test.mjs` 9 pass；`tests/evolution.test.mjs` 等 38/39（1 项为 DV-EV-016 遗留的 `dream-tool` 挂载失败）；probe 证明失败发布后 `staleStillPending:true`、`publicationCount:1`。
  活体验收（16:03 重启后，`.artifacts/audit/acceptance-live.ps1`）：拒绝无发布；批准=1 条发布；v1 后暂存的两个候选基线均为 v1，其中 `stale-b` 返回 422「Skill baseline conflict」且仍在待批、未写决定；`/rollback` 只生成候选，批准后回到旧内容 v3；`/pending` 返回 `{pending,decided,live}`；重放 `/decide` 不重复发布；夹具已清理进 `.trash-acceptance-*`。
  未验证：浏览器点击流未执行（渲染由 9 项客户端测试覆盖）；人格 E 步因活体人格未初始化记 N/A；4 MiB 截断分支仅代码审阅；harness 全量套件 7 项既有失败（logfile 0600、plugin.spec DSH_HOME 断言）与本次无关。
  阻塞：无

### L0 文档与架构

- [ ] **DV-DOC-008 世界网关：分区空白已定位并修复，补真实模型清单** `sev-P1`
  目标：DSH 设置页「世界网关」分区 + 五个能力插槽（asr / tts / decision / embedding / omni）+ 实时语音纯 UI 占位；只接线不接能力。**不管 chat/vision，不做能力验证**。
  状态：done（**已修复，待重启看端内**）｜ owner：本会话 ｜ 开始：2026-11-11 08:40 ｜ 完成：2026-11-11 09:05
  根因（已复现）：`client.js` 把凭据名作为 React 保留 prop `ref` 传给 `CredentialRow`，React 18 抛 `Function components cannot have string refs`，被 `SlotErrorBoundary` 吞成 `<div data-slot-error="settings.section"/>` → 分区整块空白。
  已做：①`ref`→`authRef`（4 处）；②新增 `src/catalog.mjs` + `GET /api/catalog`，decision/omni 取宿主 `llm` 真实模型，asr/tts/embedding 如实返回原因；③模型字段加"从 N 个候选填入"取词器；④新增 14 项测试（含 jsdom 真实客户端渲染回归）。
  下一步：`npm run restart` → 硬刷新 → 按 `docs/logs/2026-11-world-gateway/v0.1.1-render-fix/acceptance.md` 走 7 步，重点看第 1 步（有 5 张卡、无 `[data-slot-error]`）与第 7 步（`/api/catalog` 返回 `ok:true`）。
  验收：分区渲染出 5 张卡且页面无 `[data-slot-error]`；`/api/catalog` 返回真实候选；保存/凭据/resolve/重启持久化四项端到端通过。
  Scope：plugins/capability-hub/（src/client.js、src/catalog.mjs 新、src/http.mjs、src/index.mjs、tests/）；docs/logs/2026-11-world-gateway/v0.1.1-render-fix/
  日志：docs/logs/2026-11-world-gateway/v0.1.1-render-fix/
  实测：`node --test "plugins/capability-hub/tests/*.test.mjs"` → 21 pass / 0 fail；活体 HTTP 9 项全过（启用/resolve/落盘/凭据写清/无明文密钥/关闭/非法 kind 400/invoke 404/恢复基线）
  未验证：`/api/catalog` 活体响应（新路由要重启才挂上，接线由测试覆盖）；浏览器点击流（需用户走 7 步）；候选下拉是否有内容取决于 profile 里有没有同名 provider
  阻塞：无

- [x] **DV-DOC-009 世界网关：默认预制候选 + 端点核对脚本** `sev-P3`
  目标：让 asr / tts / embedding 也有真实候选（DSH 没有这些注册表），默认值只定义一处，并留一个可重复跑的端点核对脚本。
  状态：done ｜ owner：本会话 ｜ 开始：2026-11-11 14:38 ｜ 完成：2026-11-11 15:05
  已做：①新增 `src/candidates.mjs`（PRESET / DEFAULT_MODEL / LIST_BASE / 展示名）；②五个能力的默认模型改从 `DEFAULT_MODEL` 取，顺带把无效的 `qwen-omni` 改成 `qwen-omni-turbo`；③`catalog.mjs` 先铺预制、再追加宿主 provider、按 id 去重并标 `source`；④新增 `scripts/explore-endpoints.mjs`（`--json` / `--check`）；⑤测试 26 条全过。
  下一步：重启后按 `docs/logs/2026-11-world-gateway/v0.1.2-preset-candidates/acceptance.md` 走 6 步；配上任一 key 后跑一次 `node plugins/capability-hub/scripts/explore-endpoints.mjs --check` 校正候选表。
  验收：`/api/catalog` 的 `models.asr.dashscope` 非空；面板下拉有内容；换接入点候选随之变化；手填仍可保存。
  Scope：plugins/capability-hub/{src/candidates.mjs,scripts/explore-endpoints.mjs,src/capabilities.mjs,src/catalog.mjs,tests/}、README、docs/research/capability-hub-slots.md §10
  日志：docs/logs/2026-11-world-gateway/v0.1.2-preset-candidates/
  实测：5 个测试文件 26 pass / 0 fail；探索脚本在本机（无 key）跑通，如实报 3×401 + Token Plan 无接口
  未验证：预制 id 未用真 key 核对（本机 `.credentials.yaml` 只有 `OPENDESIGN_API_KEY`）；浏览器下拉未实测；百炼兼容模式列表是否含原生 asr/tts 模型未知
  阻塞：无（需重启才能在端内看到）

- [ ] **DV-DOC-003 MemPalace × Obsidian 开源生态调查** `sev-P3`
  目标：查清「把 MemPalace 原生接进 Obsidian」的 GitHub 项目是哪一个/哪一类，并给出我们的接入路线。
  状态：done（报告已交付，待选路线）｜ owner：98d23d997447 ｜ 开始：2026-11-10 23:53
  下一步：用户在 A 插件直连 / B markdown 导出 / C vault 真源 中拍板；选 A 则先开「只读 token 通道」实施条目。
  验收：`docs/research/mempalace-obsidian-integration.md` §2.3 能对上记忆中的项目；§7.2 三条路线有明确选择。
  Scope：docs/research/mempalace-obsidian-integration.md（**纯文档，未改代码**）
  日志：docs/logs/2026-11-mempalace-obsidian/v0.0.1-survey/
  未验证：Obsidian `requestUrl`/CORS、Graph View 注入、上游 `mempalace serve`、两个项目的许可证
  阻塞：无（等用户决策，非阻塞）

- [x] **DV-DOC-004 mnemos 源码级深挖（v0.0.2）** `sev-P3`
  目标：把候选 `mnemos-dev/mnemos` 从「读 README」升级为「读源码」，判断值不值得借鉴。
  状态：done ｜ owner：98d23d997447 ｜ 开始：2026-11-11 00:08
  下一步：无（结论已交付）；若用户要「移植成本」而非「值不值得抄」，另开条目。
  验收：`docs/research/mnemos-deep-dive.md` §0 五条结论 + §8 硬伤表 + §9 借鉴清单可读。
  Scope：docs/research/mnemos-deep-dive.md（新建，**纯文档**）；mempalace-obsidian-integration.md §5（两处修正）
  日志：docs/logs/2026-11-mempalace-obsidian/v0.0.2-deep-dive/
  未验证：作者自述 556 pass（未跑 pytest）、Windows hook 真机行为、索引陈旧体感
  阻塞：无
  备注：修正上一轮两处说法——①v1.0 已删 watcher，索引靠手动 `reindex`；②R@5 0.90 是旧范式数据，新范式基准仍 `⏸`。

- [ ] **DV-DOC-005 Obsidian 笔记 ↔ MemPalace 双向可行性** `sev-P2`
  目标：评估「笔记建索引进 mempalace + agent 读写笔记 + 特殊 wing 隔离」三件事能不能做、卡在哪、代价多少。
  状态：waiting-user（方案已定稿 §11–§12，待拍五件事或直接开 M0）｜ owner：98d23d997447 ｜ 开始：2026-11-11 00:22
  下一步：默认「枢纽投影 + 300s 定时扫描 + 本地多语嵌入（预留 EmbeddingProvider 接缝）+ 先只读」被接受即可开 M0（notes 表 + 扫描 + 三个工具，2.5–3 人日）。
  验收：`docs/research/obsidian-mempalace-feasibility.md` §2 卡点有证据、§11 三步检索链路与自动索引链路可执行、§12 嵌入方案取舍有依据。
  Scope：docs/research/obsidian-mempalace-feasibility.md（新建，**纯文档**）
  日志：docs/logs/2026-11-obsidian-mempalace/v0.0.1-feasibility/
  未验证：中文多语嵌入与外部 API 嵌入的检索质量、FTS5 trigram 体积/延迟、Obsidian 外部写入冲突提示、面板页签成本
  阻塞：无（等用户决策，非阻塞）
  备注：决策已记录——**C 禁用**（笔记是 mempalace 专属能力）；存储用 A（独立 notes 域），可见性用 D-lite（只投影枢纽笔记）；检索走「搜记忆 → 命中带 path/heading/行号 → obsidian_read 读原文」三步；自动索引走「启动对账 + 300s 定时增量 + 写入即更新」，不做 fs.watch；嵌入先本地多语（L1），外部 API（L2/L3）留接缝不默认启用。

- [ ] **DV-DOC-006 外置全模态 provider 可行性（百炼 / 硅基流动）** `sev-P2`
  目标：回答「接外置 provider 做 ASR/TTS/媒体理解/JEV 能不能做、接在哪、代价多少」，并给出顺序。
  状态：waiting-user（报告已交付，待 D1–D5 决策）｜ owner：未认领 ｜ 开始：2026-11-11 05:40
  下一步：用户回答报告 §8 的 D1–D5；默认 A（配置级 chat 路由，0.5d）→ B（ASR 云端引擎，1–2d）→ D → C → E。
  验收：`docs/research/omni-modal-external-providers.md` §0 五条结论有证据、§3 每条路径有落点与工作量、§7 未验证项可补。
  Scope：docs/research/omni-modal-external-providers.md（新建，**纯文档**）
  日志：docs/logs/2026-11-omni-providers/v0.0.1-feasibility/
  未验证：qwen3-asr-flash 的 OpenAI 兼容路径、omni 音视频单价、硅基流动语音价格与 systemone 质量、TTS 返回格式
  阻塞：无（等用户决策，非阻塞）

## L0 决策闸门（先拍板、后实施）

- [ ] **DV-DOC-018 MOSS-Live 的工具调用：能与 OpenAI 标准对照（调研已出，待拍 D1–D4）** `sev-P2`
  目标：主人 2026-11-18 03:2x「他这个 live 是不是也能接入工具？和 openai compatible 的工具接入标准，区别有吗」——查清 Live 的工具协议、与 OpenAI Chat/Realtime 两套标准的异同、以及我们要不要做桥。
  状态：waiting-user（报告已交付，零代码改动）｜ owner：本会话 ｜ 开始：2026-11-18 03:22 ｜ Scope：docs/research/moss-live-tool-calling.md（新建）、docs/logs/2026-11-world-gateway/v0.1.6-moss-live-tools/、TODOLIST.md
  结论：**能挂，但和「OpenAI compatible」不是同一层。** Live 原生支持客户端函数工具（`session.update.session.tools`，≤128；`type/name/description/parameters` + `execution_mode`）；模型发 `response.function_call_arguments.done`，应用执行后 `conversation.item.create`（`function_call_output`）+ `response.create{call_ids}` 续答。OpenAI Chat 的 `tools/tool_calls/role:"tool"` 是 HTTP 结构，只适用于 MOSS 的 HTTP 侧（Nex N2.6 文档完全兼容它），**不能驱动 Live**。Live 与 OpenAI Realtime 事件骨架几乎同名，但：外壳 `action` vs `type`；MOSS 多一层**异步任务**（task_id/revision/取消/幂等、32 修订、4 并发、120 秒）；MOSS 没有 `tool_choice`、`parallel_tool_calls`、MCP 服务端工具与浏览器临时令牌，浏览器必须服务端代理。
  候选：D1 何时做——A 现在（不推荐）/ **B 等语音闭环跑通后（推荐）** / C 不做；D2 桥形状——**A 按 MOSS 原生事件（推荐，薄）** / B 抽象成 OpenAI Realtime 兼容层（可换供应商，厚且丢 async 语义）；D3 第一版范围——**A 只 sync（推荐）** / B sync+async_effect（要任务/取消/幂等）；D4 是否接受 Beta 限额（128 工具/128 任务/4 并发/120 秒/单会话并发 1/无 MCP）。
  下一步：用户读报告 §6 拍 D1–D4，可只回「按推荐来」；拍板前不动 Live 适配器与世界网关代码。
  验收：报告 §0 四条结论可独立读懂；§4 对照表每行能对到 §2/§3 的文档原文；§7 未验证项不混进结论。
  未验证：没有 `MOSS_API_KEY`、没跑过 MOSS-Live 会话；同步工具等待上限、同轮并行、output 上限文档未给；OpenAI 事件名按现行文档对照，不同 SDK 版本可能不同。
  阻塞：无（等用户决策，非阻塞）
  日志：docs/logs/2026-11-world-gateway/v0.1.6-moss-live-tools/

- [ ] **DV-PR-001 openhanako 的规则类内容能不能搬过来（调研已出，待拍 D1–D6）** `sev-P2`
  目标：主人 2026-11-15 16:1x「openhanako 里面是不是有一些可以借鉴的规则类内容，我们能不能把这些规则看看怎么在这边生效」——查清它有哪些规则、哪些能用在 DIVA 这边、落点在哪。
  状态：waiting-user（报告已交付，零代码改动）｜ owner：本会话 ｜ 开始：2026-11-15 16:16 ｜ Scope：docs/research/hanako-rules-port.md（新建）、TODOLIST.md
  结论：**有 10 条固定规则小节可抄，且不用动上游源码。** master 的系统提示词是数据驱动的版本化配置（`superagent/src/app/prompts.ts:102-119` 的 `composePrompt`：`runtime/shared` + `runtime/orchestrator` + 团队三段 + skills + 覆盖），管理面保存即生成新版本、下一个模型请求就吃新的，**不重启**。最值钱三条：①行动纪律（先诊断再换方向、按可逆性决定问不问人）②记忆使用规则（记忆无声参与、禁止说「我记得」）③输出契约（每轮必须有面向用户的正文）。另外 `lib/agents.example.md` 的文风硬规则（少用破折号、不用「总的来说」收尾）立刻可用。**反向发现**：我们 master 现在的提示词几乎全是派活/交付口径（`shared.md` 847B 讲路由、`team/communication.md` 9726B 全在讲「PR 就绪才发 IM」），日常闲聊与工具纪律一条都没有——这跟「左栏像派活接口」是同一个根因。
  候选：**A 分层落位（推荐）**＝短规则（3–4 条）进 `runtime/shared` 覆盖 + 文案进 laputa 人格 + 长细则（子代理协作、记忆抽取边界）做成 skill 按需加载，约 +400 常驻 token、0 代码；B 全常驻（+2.5~3k token/轮，被动挨打）；C 只改 `runtime/orchestrator`（worker 不读，避免 worker 变话多）；D 全部做成 skill（省 token 但可能永不加载）。
  下一步：用户回答报告 §6 的 D1（行动纪律+输出契约进哪段）、D2（记忆口径：抄 hanako 的「无声 + 禁止我记得」还是保留 DIVA 原有）、D3（文风硬规则进人格还是团队段）、D4（长细则做 skill 还是常驻）、D5（要不要给 master 开 web 工具）、D6（「一天从 04:00 开始」采不采纳）。可只回「按推荐来」。
  验收：报告 §1 能独立读懂；§4 每条带文件+行号；§5 卡点能对到 §6 至少一个决策；§3 的「规则位」表与实际 `composePrompt` 顺序一致（已核对）。
  卡点（编号对应报告 §5）：C1 master 白名单没有 web 工具（`sessions.ts:263`）→ hanako 的网页优先级对 master 无效 ｜ C2 全抄会让常驻提示词翻倍 ｜ C3 「禁止说我记得」与 DIVA「记不清就说记不清」口径要人拍 ｜ C4 `runtime/shared` 是 master+worker 共用 ｜ C5「04:00 的一天」是产品决定 ｜ C6 抄规则无法证明有效，没有 A/B 手段。
  未验证：**没跑过 hanako**，规则效果是文本判断不是效果证明；`lib/approval-gateway.ts`、`lib/diary/*`、`lib/memory/prompts/{dream,compile,rolling-summary}.ts`、`lib/fresh-compact/*`、`skills2set/` 只扫了开头，里面可能还有规则；ActMem 注入位置是否也遵守「静态前缀在前」的 cache 顺序未核。
  阻塞：无（等用户决策，非阻塞）
  备注：不抄的 4 条（SessionFile/stage_files、`current_status` 的 ui_context、`computer` 本机控制、`learn_skills` 主动装技能）占了它规则量的约 1/3，全是它自己的工具集形态依赖——**说明它是桌面个人助手，我们是「派活 + 日常表达」**，照抄会得到死规则。

- [ ] **DV-UI-014 个人助手闭环：左栏持久记忆 + 右栏定期梳理（调研已出，待拍 D1–D9）** `sev-P1`
  目标：左栏日常对话「跨会话不忘、非逐字、能读回」；右栏由定期后台作业产出两类内容——「你真正需要注意的」与「你每天想了解的」（用户 2026-11-15 14:06 原话）。
  状态：waiting-user（报告已交付，零代码改动）｜ owner：本会话 ｜ 开始：2026-11-15 14:06 ｜ Scope：docs/research/personal-assistant-loop.md（新建）、docs/logs/2026-11-assistant-loop/v0.1.0-research-loop/、TODOLIST.md
  结论：**两件事都不需要造新系统，但右栏必须拆成两种成本的作业。**①左栏记忆已在跑半个：ActMem 卡（30 条）以 runtime context 常驻注入 master（`plugins/memory/src/card-prompt.mjs:140-148`，本机 `cardInjection.enabled=true`），recap 每 3 轮/30 分钟写总结进卡（`recaps.jsonl` 30 条）；缺事实级抽取、日常页读回、`daily` 呈现变体（卡只认 qq/bili，`card-prompt.mjs:40`）。②右栏「需要注意的」应是**零模型规则扫描**（TODOLIST NOW / 工单 `person/*` 状态 / 待审批提案 / 到期提醒），照 openmuse Ideas 的形状（正则规则 + 幂等 id + 证据 + 接受即派活）；「想了解的」才是**每天一次模型编辑**（带出处）。③载体三条：DSH `schedule`（到期恢复原会话跑一轮，`packages/schedule/schedule/src/runtime.ts:85-140`）、插件定时器（AutoDream 范式，`dsh-evolution/src/dream.mjs:509-525`）、superagent trigger→ticket。④右栏今天**一条真数据都没有**：`dsh-daily/index.js` 空实现，Today 卡是静态 demo（`client.js:110,152-167`）。
  候选：A1 master 内 schedule（**要改 router preset + 白名单，非零代码**，且到期会在左栏插一条 user 消息）/ A1b superagent 自带 `everyMinutes` 规则（`patches/superagent-schedule.patch`，产物进工单、右栏读不到）/ **A2 插件 check-in 作业（推荐）** / A3 工单 / A4 引第三方日报插件；记忆侧 X0 维持 / **X1 recap 契约加 facts（推荐，不增调用次数）** / X2 独立整理作业 / X3 给 master 开 `memory_*`（要动上游）。
  更正（15:1x，子代理复核后自查）：初稿把「一条 `schedule_create` 就能验证」当零成本手段，**是错的**——`schedule` 是 preset-owned，router preset 注释明写不含 scheduling（`superagent/cordis.patch.yml:121-124`），master 白名单也没有 `schedule_*`（`sessions.ts:263`）。另补一条初稿漏掉的读回面：**每轮语义召回已经在跑**（`dsh-mempalace/src/index.mjs:100-112`，topK=4 / 0.4 / 1.2s），因为 `complete:true` 只换 sections、contexts 保留（`system-prompt/src/index.ts:681-687`）——所以左栏是「查得到但不会主动查」，缺的是「何时该用」的说明（mempalace POLICY section 被吞）。
  下一步：用户回答报告 §6 的 D1（记忆粒度）、D2（读回方式）、D3（作业载体）、D4（谁判断「需要注意」）、D5（简报频率/时刻）、D6（兴趣来源）、D7（落点）、D8（失败语义）、D9（要不要加 `daily` 变体）——都带默认推荐，可只回「按推荐来」。
  验收：报告 §0 五条结论可独立读懂；§2 外部事实每条可对到 §7 的 URL 或本地路径；§3 本仓断言都带 `文件:行号` 且 `verification.md` 有对应命令；§5 每个卡点能对到 §6 至少一个决策；§7 未核实项不混进结论。
  卡点（编号对应报告 §5）：K1 `web_search` 无 key（本轮实测报错，只能 `web_fetch` 抓指定源）｜ K2 master 白名单无 web / `schedule_*` / `memory_*`（`superagent/src/app/sessions.ts:263`），memory 仅「常驻卡 + 每轮召回」半通｜ K3 兴趣画像无来源，第一版必须手填｜ K4 卡无 `daily` 变体｜ K5 右栏无宿主半边｜ K6 两种定时语义不能混用｜ K7 成本叠加（recap 已每 30 分钟一次）｜ K8 简报别进会话历史｜ K9 召回在热路径（1.2s 超时）｜ K10 调度在本仓 0 测试覆盖｜ K11 reset 会带走 master 会话，挂会话的定时全废。
  未验证：OpenMuse/OpenDots 只读源码未启动；`schedule` 跨重启「错过只补最近一次」未真机复现；recap 30 条未按 session 统计是否覆盖 master。
  阻塞：无（等用户决策，非阻塞）
  备注：与既有结论的关系——`daily-page-integration.md` 的 F1–F6 未推翻，本轮把 F3（Today 资讯来源）具体化为「规则扫描 + 每日一次编辑」，并补上记忆这一面。外部四家里 OpenBot 的 Routines（15 分钟下限/20 条上限/疲劳规则/错过跳过/以创建者身份运行）与 openmuse 的 Ideas 规则流是唯一两处值得直接照抄的实现；OpenBot 的记忆与 Learning、CopilotKit Threads 均为闭源托管，抄不了。

- [ ] **DV-UP-002 DSH 上游 0.2.2 升级评估（能不能不影响 Superagent 整体升级 / 补丁路线是否成立）** `sev-P1`
  目标：盘点 `deepseek-harness` 从 `dsh-v0.2.1-rc.5`（`b830ec95`，本仓 pin）到上游最新 `dsh-v0.2.2-rc.3`（`38a6a5c9`，2026-11-13）的变更，判断能否在不影响 Superagent 的前提下整体升级；若不行，`patches/` 能否做到不改 Superagent 源码。
  状态：waiting-user（调研已交付，待拍 D1–D5）｜ owner：本会话 ｜ 开始：2026-11-15 13:10
  结论：**能升，但不是零影响，也不用弄脏 Superagent 源码。**①Harness 是干净 submodule、本仓无 Harness 补丁，升级＝换指针 + 改 `scripts/setup.mjs:63-66` 的版本断言 + 收紧 `engines.node` 到 `>=24.9`（本机 24.14.1 已满足）。②版本门放行 Superagent（`^0.2.1-alpha.2` 对 0.2.2-rc.3 为 true，`includePrerelease` 生效），真破面只有一处：0.2.2 起 `agent/request` 不许改路由，而 `superagent/src/app/role-models.ts:31-36` 靠它种初始模型（静默降级，不崩）。③补丁路线成立：`withTemporaryPatch` 构建时 apply、之后还原，`git -C superagent status` 仍空；升级后改的是补丁内容。**新发现的静默失效**：`dsh-continual-harness`、`dsh-laputa` 的 peer 上界 `<0.2.1` 在 0.2.2 越界，会被 `skippedBundles` 跳过且不报错（人格/进化两条线会消失）。
  候选：A 两段式（推荐）＝先只做「能起来」的最小集，真跑定位后再补 B1；B 一次到位（3–5 人日，Superagent 26 个 peer 编译期不报错＝盲赌）；C 不升（错过 Windows 管理员/沙箱启动修复、工作步骤折叠、引用、apply_patch）；D 只升到 rc.1（少变量、少收益）。
  下一步：用户回答报告 §7 的 D1（升/不升、升到 rc.3 还是 rc.1）、D2（两个 TS 插件是否加 `engines.dsh: ^0.2.2-rc.1`）、D3（B1 走补丁改 `agent.model` 还是先加精确版本豁免）、D4（是否把 Superagent devDeps 指向本地 harness 源码做真编译）、D5（升级前是否整包备份 `.artifacts/dsh-home`——存储「读旧写新」是单向的）。
  验收：`docs/research/dsh-0.2.2-upgrade.md` §0 三条直答可独立读懂；§2.3 版本门表每行可对到 manifest 字段与判定代码；§4 命中点可用 `verification.md` §4 的命令复现；§8 未核实项不混进结论。
  Scope：docs/research/dsh-0.2.2-upgrade.md（新建）、docs/logs/2026-11-upstream-dsh/v0.1.0-upgrade-survey/、TODOLIST.md（**纯文档，未改代码**）
  日志：docs/logs/2026-11-upstream-dsh/v0.1.0-upgrade-survey/
  未验证：Superagent 在 0.2.2 上的启动与收发未实测；旧 `tools.execute` 注册是否仍兼容；SurfCore `apiproxy@0.1.1-rc.2` 与 0.2.2 host 的线协议；10 个 client 插件在 slot/菜单/主题变化下的表现；`dsh-context` v0.83.1 实跑；会话存储回滚后的旧版本读取行为
  阻塞：无（等用户决策，非阻塞）
  备注：本机 `deepseek-harness` 是 shallow 克隆且 `git fetch` 被沙箱拒（`cannot create standard input pipe for remote-https`），所以版本结论全部以 GitHub API / raw 文件为准，本地未产出 diff；Superagent 上游只有一个 commit（`8c32a9d`，2026-10-31）且与本仓 pin（`6337fc8`）不同，说明上游停更、适配只能落在我方补丁。
  追加（13:5x，用户问「0.2.2 是不是多了一个接上游 api 的功能」）：有，共四处「接上游」变化，最要紧的是**网页搜索默认改成直连 DeepSeek Search API**（端点/凭据跟随模型路由，可分别选账号或 API Key，Exa/Perplexity 移除）。我们 profile 只有 `opendesign` 中转、无 deepseek 路由、无 `DEEPSEEK_API_KEY` → 升级后 **web_search 工具会静默消失**（rc.2 起缺凭据就不提供给模型）；三条处理路见报告 §4.1。另三处：Gemini 原生 provider、账号服务具体化（不用重登）、rc.3 DeepSeek 会话导入插件。
  追加（2026-11-17 06:3x，主人「可能上游有更新，主要看dsh，先调查」→ 本地真 diff 复核）：**结论不变，证据换成实测。** ①`git fetch origin master` 已跑通（一次 danger-full-access；沙箱只拦 remote-https 建管道），本机现在能离线 diff：pin → master **4803 commit / 11665 文件 / +653,803 −798,230**，**新增 117 条中文升级指南**；②上游位置：最新 tag 仍 `dsh-v0.2.2-rc.3`=`38a6a5c9`（2026-11-13），master tip=`39163dd`，比 tag 多 **608 commit（433 非 merge，3309 文件）**，**未发版**（npm dist-tags `latest`=rc.1、`next`=rc.3）；master **自 11-13 15:37 起 3.5 天无新提交** → 「没有新版本，新东西都在 rc.3 里」；③rc.3 之后未发版增量含 `timeline`/`script-realm`/`cua-windows`/`ui-session-status`/`authentication-{desktop,token}`/`text-search` 九个新包与 `ptc-runtime-python` 移除；④新增硬事实：Agent Teams 已从 experimental 变核心（`dsh-experimental-agent-team-profile` 进 `RETIRED_BUNDLES`，我们 profile 里那条会被自动移除；`spawn_teammate` 消失、控制工具改 `agent_id`、`/team on|off` 移除、按 Session 默认关）、`fs-observation-policy` 默认关（write/edit 不再要求先读，新增 `apply_patch`）、工具执行器拆成插件、Python PTC 移除、Node 24.9 硬门槛（本机 24.14.1 ✓，本仓 `engines` 仍写 `>=24.0.0`）、组合包列表 API 搬到 `dsh-official-bundles`、`superagent` 的 cordis peer 钉 `4.0.5-alpha.1` 而 0.2.2 是 `4.1.0`；⑤决策影响：**D1 多两个候选**（master tip = 「rc.3+未发版增量」，只在想要 timeline/cua-windows 时考虑；rc.1 少变量少收益），推荐仍是 **rc.3 tag**；新增 **D6**（是否在 profile patch 里把 `fs-observation-policy` 恢复为先读后写，推荐恢复）与 **D7**（要不要先手清 `dsh-experimental-agent-team-profile`）。报告 §10；四件套 `docs/logs/2026-11-upstream-dsh/v0.1.1-local-diff-survey/`。
  新增未验证：rc.3→master 的 433 个未发版提交是否再引入 Superagent 破面（只按主题分类，未逐条核 117 条指南对 14 个本地插件的命中）；Forge/Timeline/Action Cards/CUA/Office 实际可用性（未安装未运行）；三个 client 槽位名在 master 仍存在但未运行时验证；`superagent` 在 cordis 4.1.0 下能否构建（静态 peer 冲突，未真编译）。
  更正（2026-11-17 06:5x）：上面 13:5x 那条说「我们 profile 只有 opendesign 中转、无 deepseek 路由」**不准确**——本机 profile 的 `agent-default-model` 就是 `deepseek-account`/`deepseek-flash`（effort high），账号 token 在 `.credentials.yaml`（`deepseek-account-platform/default`），DeepSeek Files 上传缓存有 26 条记录；缺的是 `DEEPSEEK_API_KEY`（没有 key、没有 `.env`）。所以升级后 `web_search` 不会「静默消失」，而是改走账号计费的 Search API。详见 DV-DS-001。

- [ ] **DV-DS-001 DeepSeek 接入面：会话导入 / Search API 默认 / 两个上报扩展（调研已出，待拍 D1–D6）** `sev-P2`
  目标：主人 2026-11-17 06:4x「上游更新了一大堆 deepseek api 接入能力——甚至还能导入在线的聊天记录，去调查一下」——查清上游到底有什么、哪些我们已在用、哪些是 0.2.2 才新增。
  状态：waiting-user（报告已交付，零代码改动）｜ owner：本会话 ｜ 开始：2026-11-17 06:4x ｜ Scope：docs/research/deepseek-api-surface.md（新建）、docs/logs/2026-11-upstream-dsh/v0.1.2-deepseek-api-surface/、TODOLIST.md
  结论：①**大部分能力 pin 里就有、而且本机在跑**：默认模型 `deepseek-account`/`deepseek-flash`（effort high），账号 token 已存（值未读），Files 上传缓存 26 条（2026-11-16 22:54 → 11-17 02:36）；`llm-deepseek`＋`llm-deepseek-api-key`＋`llm-deepseek-account`、`web-deepseek-api`、`web-search-deepseek`、`session-log-deepseek`、`plugin-package-inventory-deepseek` 全在 pin 里。②**0.2.2 新增的只有三类**：DeepSeek 会话导入（`packages/experimental/deepseek-chat-import`，pin 里没有、实验 bundle 默认关）、搜索默认从旧 Messages 搜索改成**直连 Search API**（v0.2.2-alpha.2，Exa/Perplexity 移除）、Files 上传超时 60s→20s＋账号 Remote 重构＋账号赠送通知（`ui-account-notifications` 是 pin→master 新增包）。③**「导入在线聊天记录」实际是离线 ZIP**：chat.deepseek.com「导出全部会话」→ `deepseek_data-*.zip` → DSH 里上传 → 把最近最多 **1000** 个会话写进所选工作区；保留思考/联网搜索卡片/阅读链接/图片，分叉与撤回内容丢弃；**只 owner 能导**；重复导入会再写一组。④对我们最要紧：升级后搜索默认走 Search API（有账号 token 就能搜；旧默认 Messages 搜索同样要凭据）；base 默认挂的两个请求扩展会把「规范会话日志」（`dsh_session_log`，8 MiB/请求上限）与「活跃插件清单」（`dsh_plugin_packages`）随官方 API 请求上报，本机 78 份会话日志 zstd 解压后 `session-log-deepseek` 水位 **0 命中**（是否真在上传未取证），Web 开关「设置 → 通用 → 在使用官方模型 API 时上传 Session Log」与 `enabled:false` 都能关。
  下一步：主人答报告 §5 的 D1–D6（D1 何时动；D2 搜索走 Search API / 旧 Messages / 只抓取；D3 是否启用会话导入、先导多少；D4 两个上报扩展开还是关；D5 导入后当历史看还是抽成记忆；D6 要不要 `DEEPSEEK_API_KEY` 兜底）。推荐：D1 跟 DV-UP-002 的 rc.3 一起；D2 升级后先实测一次账号计费下的 Search API；D3 先导 200 条试水；D4 先关两个扩展；D5 走现有记忆写入边界（ActMem/宫殿），不改上游；D6 加。
  验收：报告 §0 四条直答可独立读懂；§2 每条能力能对到包路径或升级指南；§3 本机观测可按 verification.md 复现；§4 的 K1–K7 能对到 §5 至少一个决策。
  卡点：K1 账号态有效性/额度（DV-RUN-001 历史 403）｜K2 账号模型目录改由 `GET /models` 提供，`deepseek-flash` 是否在列未实测｜K3 Search API 计费口径与 5 QPS｜K4 导入只写 Session，不进 ActMem/记忆宫殿｜K5 1000 条会挤侧栏、重复导入翻倍｜K6 两个上报扩展的隐私边界｜K7 全部挂在 DSH 0.2.2 升级上。
  未验证：账号 token 是否仍有效、额度够不够；`deepseek-flash` 在账号模型列表里吗；Search API 账号计费下的单价/延迟/质量；78 份日志 0 命中是否等于没在上传；会话导入真实观感（没有 ZIP 样本，没跑过）。
  阻塞：无（等用户决策，非阻塞）
  日志：docs/logs/2026-11-upstream-dsh/v0.1.2-deepseek-api-surface/
  追加（2026-11-17 06:5x，主人问「websearch 应该也会用本地浏览器吧之后」）：**上游不会，方向相反**。0.2.2 的 Search 改动是「少一跳」（辅助模型请求→直接 HTTP），`packages/web` 里没有 playwright/puppeteer 依赖；`dsh-web` 提供方仍全是 HTTP（`deepseek-search-api`、旧 `deepseek-official`、抓取 `deepseek-fetch-api`/`http`）。浏览器是另一条缝：`dsh-browser-use` + 4 个实验性 provider（playwright-mcp / stagehand-native / chrome-devtools-mcp / cua），给 Agent 操作网页，**不在 `OPTIONAL_BUNDLES`**（插件页没开关，只能显式挂 profile 或按需目录——目录目前只有 codex/claude-code 两个 subagent）。想「搜索走本地浏览器」只能自己注册一个 `searchProvider`/`fetchProvider` 插件（seam 支持，profile 里填 id 选中），代价是每次起浏览器/接管标签页且解析自维护；建议先不写，真遇到登录态站点优先用 browser-use `attach` 到现有 Chrome。本机已有 Chrome（`C:\Program Files\Google\Chrome\Application\chrome.exe`）与 `%LOCALAPPDATA%\ms-playwright`。详见报告 §7。




- [ ] **DV-UI-012 Superagent 一键初始化（设置里一个专用分区 + 清除记忆）：可行性已出，待拍 D1–D6** `sev-P2`
  目标：在设置里给 superagent 一个专用分区，能一次性清掉它的历史/状态（用户 2026-11-15 11:46 提问：「清除记忆选项…一次性初始化 superagent…然后看看能不能给它一个专用分区」）。
  状态：已拍板（2026-11-15 12:5x 用户定：做成插件、放「更多 → 设置 → 通用设置」一行）→ 实施见 DV-UI-013 ｜ owner：本会话 ｜ 开始：2026-11-15 11:50
  结论：**能做，不用碰上游三仓**。界面侧 `settings.section` 是 root 级 list slot，任何插件可注册一节（`ui-settings/src/client/contract/slots.ts:57`；`ui-settings-account/src/client/index.ts:313`；本仓 `dsh-see-now` 早前也注册过）；或只往「通用设置」塞一行（`settings.general.item`，`slots.ts:92`）。硬卡点：**真删必须在 host 停着时做**——`orchestrator.sqlite-shm` mtime = 本次启动时刻（host 持有），master 日志正被写（`cleanup-autodream.mjs:1-6` 的原话）。所以按钮只能「排队」，执行放 `npm start` 前。
  候选：A 新插件 `plugins/dsh-superagent-reset`（host `webServer.register({kind:'prefix'})` 抄 `dsh-laputa/src/http.ts:211-250` 的三层校验；client 注册分区）+ `scripts/lib/reset-superagent.mjs`（rename 到 `backups/reset-<stamp>/`）+ `scripts/vivy-dsh.mjs:205-220` 插一步（推荐）；B 只做 `npm run reset:superagent [--all] [--dry]` CLI（约 150 行、零 host 代码，最省）；C 改 patch 让 superagent 运行中自清（免重启但删 host 正在写的日志、内存表与磁盘不一致、不可回滚，不推荐）。
  顺带发现：清空历史后 master id 不变（`runtime.ts:104-105` 用 stateDir 哈希兜底），日常页无需改；但 `localStorage` 的 `dsh-daily/fold/<sessionId>` 分界会指向不存在的 seq，需在 `dsh-daily` 加一行「最大 seq < 分界就丢弃」。
  下一步：D1/D3/D4/D6 已定（通用设置一行、ActMem 不动、排队到下次启动、新插件）→ **实施已落在 DV-UI-013**；只剩 D2（要不要再来一档「连 sqlite 一起回出厂」）与 D5（要不要 CLI 入口）没定，两者都不阻塞当前实现。
  验收：本阶段只验决策；实施后的清单见 `docs/logs/2026-11-superagent-reset/v0.0.1-feasibility/acceptance.md`。
  Scope：docs/research/superagent-reset.md、docs/logs/2026-11-superagent-reset/v0.0.1-feasibility/、TODOLIST.md（**纯文档**；未改 plugins/、未改 scripts/、未改 profile）
  日志：docs/logs/2026-11-superagent-reset/v0.0.1-feasibility/
  未验证：自建 prefix 路由上 `connection.requestRejection` 是否可用；分区在新插件里的实际挂载与外观；清空后 DSH 侧栏空会话条目的表现（推断「变空不消失」）
  阻塞：无（等拍板，非阻塞）

- [ ] **DV-DOC-016 日常页 v0.2：卡片契约（genui spec + 薄渲染器）+ 接入方案（Superagent 聊天面），待拍 D-A…D-F / F1–F6** `sev-P1`
  目标：定下「agent 自己创作卡片显示任何内容」的定义形式，以及日常页三块（Today / 任务 / 悄悄话）的数据与聊天区路线，给出可实施的设计。
  状态：waiting-user（三轮调研完成，零代码改动）｜ owner：本会话 ｜ 开始：2026-11-14 17:44 ｜ 最近更新：2026-11-14 20:05
  已定（用户 2026-11-14 17:44）：① 卡片要让 agent 自己创作、显示任何内容，候选含 OpenClaw 同款与 A2UI；② 日常页聊天区未来接 Superagent，**必须避免代码块与杂七杂八的工具调用**；③ 页面分块 = **Today**（agent 提醒今天该注意的事：新闻小卡、建议）/ **任务**（长期任务，如项目看板）/ **悄悄话**（目标之外的洞察、小贴士、自我改进；**等《心流》自主能力系统与《野兔》情绪系统上线后再做**）；④ 本轮只调研，不改代码。
  结论：**卡片 = 内容块词汇表（13 块）+ 卡型模板，不做 A2UI、不做 HTML 画布（只留受控逃生舱）**；「任何内容」靠内容形态枚举而非布局自由。**聊天区不重造聊天**：Superagent 的四类对外消息（acknowledgement / answer / result / attention）本身就是「人话」，工具噪声结构上进不来；路线 A 只读面板 API（1–2 天）→ B 自建 `target:'daily'` 的 Definition + 自定义 View（3–5 天）→ C 给 Superagent 加 `daily` Source（5–8 天，先不做）。
  修订（2026-11-14 18:20，代理关闭、网络恢复后补查）：社区已有现成实现，E1 变成「复用哪个 + 自研哪一层」——`dsh-genui`（974★，MIT，明列支持 `0.2.1-rc.5`，白名单 JSON 30+ 组件 + 动作回流 + 同轮纠错 + 导出）做回复内卡；`dsh-visualize`（343★，沙箱 HTML，按钮不能回话）做只读逃生舱；`dsh-better-sidebar`（5092★，`ctx.betterSidebar.registerTab`）是页面最现实挂载点；`dsh-taskboard`（327★）可充当看板；`dsh-bili-scroll`（1376★）是「抓取→判定→日报→推送」的资讯范本。**页面三栏仍然没有现成物，仍需自研。** 站点搜索/筛选/分页是前端 JS，无法全站检索；可达样本里没有日历/RSS/天气/新闻聚合。
  修订 2（2026-11-14 20:05，按用户 19:32 指示研读 hanako/openmuse/OpenDots 三个本地实现 + 克隆 study `dsh-genui`）：**最终建议 = spec 统一、渲染分期、资产自持**。① 卡片内容语言采用 genui 的 `dsh-ui` spec（约 59 节点，`spec.ts:52–115`），不另造词汇表；② 页面卡第一期自研**薄渲染器**只吃内容子集（约 16 种节点），视觉/布局归我们，spec 相同所以后换渲染器零成本；③ **装** genui 当聊天内复杂卡渲染器 + 模型写作规范 + 模板中心（白名单 JSON + 深校验 + 确定性修复，动作回流 = `conversation.send("[genui-action] …")` 一条用户消息）；④ **不装** visualize（无回流）；⑤ 资产存自己的 storage 域（`{id,title,spec,kind,createdBy}`），内置模板取 genui 的 demo spec 同格式。契约分层抄 openhanako：**壳固定、内容自由、词汇表以文档交付、安全边界独立成层、资产挂内容不挂渲染态**（openmuse 卡形状写进 schema、OpenDots 通配返 null 无表达力，均不取）。宿主侧已核对：`0.2.1-rc.5` 有 genui 依赖的 DOM 契约（`ChatNodeSeat.tsx:150–151`、`CodeBlock.tsx:188,209`），但**没有 `fence-registry`**（全仓零命中）→ 只能走 DOM 观察通道。详见 `docs/research/card-contract-decision.md` D-A…D-F。
  修订 3（2026-11-14 20:10，用户追加「左栏接入 supervisor 主编排；genui 只在日常生效」）**（结论已被修订 4 取代，保留作过程记录）**：**不需要第二个 supervisor**。事实：Superagent 主编排是**单例** main Session（`dsh-superagent-router`；`006-deployment.md:15`、`007-architecture.md:33,511`），职责被提示词写死为「只路由、不等待、不做技术决定」（`004-prompts.md:77–78`），提示词可全局配置但**没有 per-surface 维度**。推荐 **C 前台 + 编排**：日常页聊天 = DIVA 自己的会话（人格/记忆/情绪在前台），supervisor 原样不动、由 DIVA 通过其 14 个工具与 `/orchestrator/api/*` 派活，消息带 `surface: daily`，只消费四类对外消息 + 卡片（1–2 天）。A 直连 supervisor（3–5 天，人格串）、B 新造第二编排（最贵，状态分裂）均不取。**genui 局部化**：全局安装做不到「只在日常」（全局系统提示 `plugin/index.ts:93` + 全局 DOM 观察 `dom-fence.tsx:196,199,210`），故 D-C 改为**不装插件**——spec 当线格式、渲染放日常页、写作规范用 `systemPrompt.section()` 的 scoped 注册只注入日常会话（机制见 `system-prompt/src/index.ts:471–486`）。详见 `daily-page-integration.md` §3.7/§3.8。
  修订 4（2026-11-14 20:44，用户纠正我的错误口径）：**superagent main Session 接 DIVA（人格+记忆+语气）是项目目的；worker 不接。** 我此前说的「router 会话没有人格段」「架构非目标禁止 main Session 有人格」都是我本人的错误推断，无人授权；`architecture.md:77` 的「独立人格」指另立一个身份，不是禁止挂人格（已在原条目加注）。**现状与意图的差距只有一处**：`dsh-laputa` 对**每个顶层 agent** 注入 `laputa:persona`（`adapter.ts:70–113`；门槛 `top-level.ts:9–11` 只看 origin/depth），所以 **worker 也被注入了**，应排除。由此聊天区结论改为：**日常页接的就是 main Session 本身**（它已经是她），不需要第二个 supervisor、也不需要另建「DIVA 专用会话」；真正要修的是两处实现——① laputa 注入按 preset 收窄（保留 router、排除 worker）；② router 提示词措辞从「只路由」改为「她负责编排」（`docs/004-prompts.md:77–78`）。见 `daily-page-integration.md` §3.7（已重写）。
  修订 5（2026-11-15 15:4x，用户回到原决策）：「Today / 任务 / 记忆 / 能力」这四页**不是用户的分块方案**——四页是照搬 OpenToday 原型（`plugins/dsh-daily/client.js:4-7` 自述「内容照搬 Open Design 的 OpenToday 工作台原型…右边是四页上下文面板」）。用户 2026-11-14 17:44 的原话（`session-52c2f98d-74b8-4644-8081-c160ec66361c` seq 773，本会话可复现）：「**页面分块我想的是：today**（现在就是，主要是一天中 agent 提醒用户应该注意的事情，可能是新闻小卡片，或者是一些建议之类）**任务**（主要是主人的一些长期任务相关，例如说项目看板）**悄悄话**（在用户目标之外，agent 洞察发现用户的一些小贴士…《心流》自主能力系统与《野兔》情绪系统上线之前，这个暂时不用理）」。用户 2026-11-15 15:4x 追加：**记忆页不用留、能力页应该也不用**；15:5x 定稿：**改成 Today / 任务 / 悄悄话 三页，悄悄话先做占位标「待实现」**。由此「记忆」不再有右栏入口，记忆读回只剩常驻卡 + 每轮召回（与 DV-UI-014 的 D2 结论一致）。实施见 DV-UI-009 的 15:5x 追加。
  下一步：等用户拍两件事——① 是否现在改 laputa 注入范围（约十行：保留 `dsh-superagent-router`，排除 `dsh-superagent-worker`）；② 日常页按「接 main Session + 只渲人话的视图」推进。genui 仍按 D-C 不装（spec 作线格式、日常页自渲染）。③ 右栏按 Today + 任务 两页重排（撤销 demo 的记忆/能力两页），等 DV-UI-014 的 D3/D4 定了再决定谁产生 Today 的内容。
  验收：`docs/logs/2026-11-daily-research/v0.1.0-pre-research/acceptance.md`、`docs/logs/2026-11-daily-research/v0.2.0-card-contract/acceptance.md`；拍板后另开实施条目。
  Scope：docs/research/agent-ui-card-spec.md、docs/research/daily-page-integration.md、docs/research/card-contract-decision.md（**纯文档**）；`.workspace/genui`（只读克隆，不参与构建、不入库）；未改 plugins/、未改 profile
  日志：docs/logs/2026-11-daily-research/v0.1.0-pre-research/、docs/logs/2026-11-daily-research/v0.2.0-card-contract/
  未验证：`dsh-plugin.org` 只看了三类首页各 12 条 + 6 个详情页（站点无法全站检索；所有插件均未安装实测）；`dshTarget` 字段在详情页未渲染；三个参考仓只读源码未运行；genui 未安装未运行，`GenuiBlock` 跨包编译（TSX+CSS Modules）与重绑 `--dsw-*` 后的观感未实测；`systemPrompt.section()` 按日常会话 scope 注入未实测；**main Session 的对话以「只渲人话」的微信式视图嵌进日常页未实测**；官方语义上的「只读 attach」开关；Superagent 面板 API 在 GUI 同源下的实测；业务插件长期依赖 `SessionBinding.eventSource` 是否被允许
  阻塞：无（等用户拍板，非阻塞）
- [x] **DV-UI-002 laputa 人格注入收窄：main Session 保留、worker 排除** `sev-P1`
  目标：落实 `docs/architecture.md:77` 的口径——superagent main Session 挂同一份 DIVA 人格是项目目的，Executor（worker）不挂。开工前现状：laputa 对**每个顶层 agent** 注入，worker 也被注入。
  状态：done（代码 + 单测 + 构建；**运行期未验证，需重启**）｜ owner：本会话 ｜ 开始：2026-11-14 21:03 ｜ 完成：2026-11-14 21:12 ｜ Scope：plugins/dsh-laputa/{src/top-level.ts,src/adapter.ts,src/tool.ts,tests/adapter.spec.ts}
  结论：新增 `carriesPersona()`（顶层且 preset 不在 `PERSONA_EXEMPT_PRESETS = ['dsh-superagent-worker']`），注入与 `laputa_init` 守卫统一用它。main Session 与普通会话不变，worker 两者都不再获得。
  验证：`npm test` 17/17 文件、280 passed / 7 skipped；`typecheck`、`build` 通过。vitest 仍 exit 1（`tests/index.spec.ts` 的 7 个 unhandled rejection：测试环境无 webServer 端口，非本次改动范围，改动前基线未取证）。
  下一步：等用户确认时机重启宿主，按 `docs/logs/2026-11-daily-research/v0.3.0-worker-persona-exclusion/acceptance.md` 做运行期验收（普通会话仍答 DIVA / main Session 仍有 `laputa:persona` / Executor 两者皆无）。
  日志：docs/logs/2026-11-daily-research/v0.3.0-worker-persona-exclusion/
- [x] **DV-DOC-013 dsh-see-now：v0.2.3 落地 `plugins/`、接线 VIVY心核，并本地化为「我看到了」** `sev-P1`
  目标：把 see-now 作为 diva「看见世界」的感知前端安装进 `superagent-local`，侧栏入口归到 `VIVY心核`；按用户 06:00 决定改名为「我看到了」、接管看/陪看/记录/配置/隐私的生命周期，**DSH 设置里不再保留独立分区**。
  状态：done（安装/接线/面板/生命周期接口/调试页/运行期 start-stop 已验证；**出图仍为 0 张**、token/CPU 未验）｜ owner：本会话 ｜ 开始：2026-11-13 05:10 ｜ 阶段完成：2026-11-13 06:55 ｜ Scope：plugins/dsh-see-now/、patches/see-now-vivy-core.patch、scripts/setup-see-now.mjs、scripts/lib/component-setup.mjs、.artifacts/dsh-home/profiles/superagent-local/{package.json,pnpm-lock.yaml,node_modules/dsh-see-now}、docs/logs/2026-11-see-now/v0.2.0-install/、docs/logs/2026-11-see-now/v0.3.0-vivy-core/、docs/logs/2026-11-see-now/v0.3.1-debug/
  结论：**有，且是目前最缺的感知层**；它给连续抓屏/摄像头/视频 + 系统声 + `say` 通道，不给理解/记忆/人格身体。04:12 已解除模型层前提：`deepseek-v4.1-flash` 补 `input: [text, image]` 后 `read_image` 读三张 README 图成功。05:35 改线到 `https://github.com/vivy-dsh/dsh-see-now`，以 `main@1d98dd5` 为准（fork，无 tag；比 tag v0.2.3 多 pack 的 maxCrop 改动）。已作为 submodule 落地；`patches/see-now-vivy-core.patch`（45,047 字节，7 文件）打入，`scripts/setup-see-now.mjs` 幂等应用，`componentPackages` 已收 `dsh-see-now`。**06:00–06:55 本地化改造完成**：`client.js` 新增「我看到了」六标签管理面板（总览/会话/记录/**调试**/配置/隐私），`src/lifecycle-store.mjs` + `/api/see-now/lifecycle` 提供 start/stop/window/clear 与动作流水；`settings.section` 已移除。插件测试 **511/490/0/21 skip**；live 侧栏 `see-now` order 16 active；调试页开始后自动切换，14 秒读到 `156 帧 / 0 张`；停止后回落。**帧在涨，但出图仍为 0；token/CPU 未验。**
  下一步：用「我看到了 → 调试」点开始看，切到有变化的视频/幻灯片，看 `帧 / 出图` 是否从 `N 帧 / 0 张` 变成 ≥1 张；按 `docs/logs/2026-11-see-now/v0.3.1-debug/acceptance.md` 走，再按 v0.3.0 第 7 条记录 token/CPU。若帧不涨，先看调试页「最近错误 / 原始状态」。
  发现（05:45，06:30 已解决）：原版日常 UI 是 `examples/floating-chat/window.py` 的**桌面悬浮窗**（Python/Tk 独立进程，不是 Web 面板，也不是另一个插件）；原先 `client.js` 只注册 `settings.section`。现已改为「我看到了」管理面板并移除 setting 分区；桌面悬浮窗仍由面板的「打开/关闭悬浮窗」管理，不替代它。
  验收：侧栏 `VIVY心核` 出现「我看到了」且点击可开；设置里无旧入口；总览/会话/记录/调试/配置/隐私六页可切；开始后自动进调试页且帧数增长；停止后状态回落；配置页可读写；真实出图两段并能被模型描述；token/CPU 有记录。
  Scope：plugins/dsh-see-now/（submodule）、patches/see-now-vivy-core.patch、scripts/setup-see-now.mjs、scripts/lib/component-setup.mjs、profile package.json/pnpm-lock/node_modules link、docs/logs/2026-11-see-now/v0.2.0-install/、docs/logs/2026-11-see-now/v0.3.0-vivy-core/、docs/logs/2026-11-see-now/v0.3.1-debug/
  日志：docs/logs/2026-11-see-now/v0.3.1-debug/
  未验证：有变化画面下出图（当前 156 帧 / 0 张，静止屏未触发拼图）、token/CPU、端到端描述；悬浮窗按钮真实点击；记录页多次 start/stop 与 clear 后状态；六标签窄屏滚动；轮询长期稳定性；Python Tk/mss/PIL/numpy；Windows/macOS/Linux 行为；根仓 `npm test` 仍有 114 条 Windows 既有失败（1350/1230/114/6），未修
  阻塞：无

- [ ] **DV-DOC-015 「我看到了」的 Python 依赖核实：核心不需要，只有窗/取框/听声要** `sev-P2`
  目标：回答「另一条线做的『我看到了』是否真的离不开一个外置 Python 工具包」，并给出可执行的取舍。
  状态：waiting-user（结论已交付，等 D1–D3）｜ owner：本会话 ｜ 开始：2026-11-13 06:13 ｜ 阶段完成：2026-11-13 06:25
  结论：**核心「看」不依赖 Python**——`see-now` 唯一 spawn 的是 ffmpeg（本机 PATH 已有）。要 Python 的只有：悬浮窗 `window.py`（Tk+mss+Pillow+numpy，本机已在）、区域取框（Tk）、听系统声（缺 `pyaudiowpatch`）、Linux portal/指示框（PyGObject/PySide6，本机不适用）；cv2/moderngl 是可选加速。`DSH_SEE_NO_WINDOW=1` 时连 Python 都不 spawn。
  下一步：等 D1（悬浮窗 A 要/B 不要/C 重写成 Web）、D2（听声 A 装 `pyaudiowpatch`/B 不做）、D3（setup 只检测提示/自动装/不管）；拍板后再动 profile 或脚本。
  验收：重启后按 `docs/logs/2026-11-see-now/v0.3.0-python-dependency/acceptance.md` 四条走：工具在、无窗仍出图、取框可拖、听声降级文案正确。
  Scope：docs/research/see-now-python-dependency.md、docs/logs/2026-11-see-now/v0.3.0-python-dependency/、TODOLIST.md（**纯文档，未改代码/配置/依赖/submodule**）
  日志：docs/logs/2026-11-see-now/v0.3.0-python-dependency/
  未验证：运行期 spawn python 与 `see_now` 端到端（沙箱拒绝命名管道，只做了文件级核查）；DSH 服务进程 PATH 是否含 `…\Python313`；插件测试 21 skip 是否由沙箱造成。
  阻塞：无（等用户决策，非阻塞）

- [ ] **DV-DOC-014 Agent UI：A2UI 不做；OpenMuse UI 识别可移植；小卡片走「词汇表 + JSON 资产」** `sev-P2`
  目标：定下 DSH 的对话内小卡片/小组件路线，并给出可实施的设计。
  状态：waiting-user ｜ owner：本会话 ｜ 开始：2026-11-13 03:56 ｜ 更新：2026-11-13 05:15
  已定（用户 2026-11-13 05:00）：① **不接 A2UI**；② 任何实践先尝试移植 OpenMuse 的 UI 识别；③ 需要一个以 Superagent 为聚焦主体的新页面（细节待用户补充）；④ 小卡片可预制、也可自做，且**要能保存为资产**。
  v0.1 结论（A2UI）：DSH `0.2.1-rc.5` 零支持（全仓零命中、无依赖、无声明式 UI 通道、无 MCP Apps）；A2UI 是协议 + 两侧 SDK；OpenClaw 2025-12-17 接入、停在 0.8、2026-10-23 整套退役；ChatGPT/OpenAI 无接入证据；OpenMuse 手写卡片 + Jev 决策。
  v0.2 结论（移植与资产）：`tool.call.toolview` keyed slot + generic 兜底与 OpenMuse `useRenderTool` 同构——**没有可搬的框架**，缺的是卡片集合、设计语言、屏幕上下文、选择闭环。OpenMuse 是 RN，视觉可搬、实现必须重写（不引入 react-native-web）。小卡片资产化 = 固定词汇表（12 原语）+ JSON 文档 + 内联快照渲染 + `storage-domain` 复用。硬约束：client bundle 是构建期产物（不能运行时下发组件）、工具结果模型可见（文档限 2–4KB，超限再上 log-only 展示事件）、Web 客户端无 URL 路由（页面 = sidebar section + slot）。
  下一步：① 用户补「Superagent 聚焦页面」四问（主体是运行态还是产出物、与 Chat/Activity 的关系、卡片在页面还是对话里、是否需要可分享 URL）；② 拍 D7–D12（D7 形态：推荐 preset+composed；D8 存储：推荐内联快照 + storage 复用；D9 文档事件：先复用 tool result；D10 词汇表首批；D11 屏幕上下文：推荐做；D12 新页面：等描述）。
  验收：本轮见 `docs/logs/2026-11-agent-ui/v0.2.0-port/acceptance.md`；实施按 A1–A10。
  Scope：docs/research/agent-ui-protocols.md、docs/research/agent-ui-widgets-port.md（新建，**纯文档**；未装 `@a2ui/*`、未改代码/配置）
  日志：docs/logs/2026-11-agent-ui/v0.1.0-survey/、docs/logs/2026-11-agent-ui/v0.2.0-port/
  未验证：OpenClaw 退役动机与是否上过 0.9/1.0、ChatGPT 对 MCP Apps 的支持、DSH client 插件动态加载全链路、OpenMuse 浏览器/桌面卡实现、`ctx.storageDomain` 在本 profile 是否启用、新增展示事件对 session 格式的影响、2–4KB 文档对 KV 缓存的影响
  阻塞：等用户拍板与页面描述（非阻塞）

- [ ] **DV-EV-021 Dream plan 校验不可定位 + 零候选不结案：代码与单测完成，等一次重启验收** `sev-P1`
  目标：让精炼的 plan 拒绝能指到具体卡/ref/会话，`event:<序号>:<hex>` 这类抄写错误自动纠正，零候选计划提交即结案（不再空占精炼位 2 小时后被记成超时）。
  状态：doing（实现 + 34/34 单测完成；运行期验收待重启）｜ owner：本会话 ｜ 开始：2026-11-14 16:43 ｜ 完成：2026-11-14 17:50
  事实：`run_9954bfd6`（2026-11-14）6 次 plan 5 拒 1 过，最后只冻住 1 卡 / 1 条 coverage / 0 候选，04:40Z 收工未 `execute`，06:46Z 被判 `blocked`+`timed_out` 并触发 24h 冷却。四类根因：拒绝信息不定位（4 类缺陷共用 3 句）、`[序号] event:<hex>` 显示诱导写成 `event:193:<hex>`（56 处）、skill 的 plan 示例没有候选（候选缺 `refs`）、零候选 plan 不结案。
  下一步：`npm run stop && npm start` + 硬刷新，按 `docs/logs/2026-11-dream-progress/v0.1.0-plan-repair/acceptance.md` 走 A1–A4。
  验收：A1 漏 refs 的候选报 `Candidate #0 … no refs array` 且计划未冻结；A2 `event:<序号>:<hex>` 被修并回 `repairedRefs`；A3 零候选 plan 立即「精炼完成」且下次精炼不被占位；A4 带 refs 的候选进「审批」。
  Scope：plugins/dsh-evolution/src/{dream.mjs,dream-tool.mjs}、plugins/dsh-evolution/tests/{dream.test.mjs,dream-tool.test.mjs}、skills/diva-dream/SKILL.md、TODOLIST.md、docs/logs/2026-11-dream-progress/
  日志：docs/logs/2026-11-dream-progress/v0.1.0-plan-repair/
  未验证：运行期 A1–A4；非空 plan 从不 `execute` 的空转只加了提示未改协议；上下文压缩、快照规模/时限、人格候选 baseline 缺口未触及；全量 `npm test` 的 113 条为既有 Windows 失败（DV-UI-007 已记 114 条），未修
  阻塞：无（等用户重启）

- [ ] **DV-EV-019 AutoDream 改成独立会话类型（「自动精炼模式」）：链路按 dsh-webhook 原生会话重做，Superagent 已整条退出** `sev-P1`
  目标：时间到 → 准备语义 → 启动 autodream 精炼会话 → 提交人工审批；不经 Input、Policy、Ticket 或工单。
  状态：doing（代码/构建/单测完成；运行期验收待重启）｜ owner：本会话 ｜ 开始：2026-11-13 01:55 ｜ 完成：2026-11-13 03:50 ｜ Scope：plugins/dsh-evolution/src/、plugins/dsh-evolution/cordis.patch.yml、plugins/dsh-continual-harness/src/、plugins/dsh-laputa/{internal.mjs,src/candidates.ts}、patches/、scripts/dream-refine.mjs、tests/、docs/
  结论：上游 webhook 建会话的五步（`agentPresets.resolve`+`acquireScope` → `workspaceRegistry.create`+`attachSession` → `agents.create` 在 `setup` 里 `mount` preset → `permissionPresets.set`+`sessionTitle.rename` → `agent.followup`）就是这套机制的正常用法，evolution 照抄即可。据此删掉 `superagent-dream.patch`（12→11）、`api('inputs')` 投递、Ticket 授权与 `worker-<ticket>` 解析；授权改为「冻结请求即授权」——工具用 `execution.agent.id` 绑定请求，`authorize()` 只比 `request.agentSessionId`。
  下一步：用户 `npm run restart` + 硬刷新，按 acceptance.md 走 A1（9 条 preset）→ B1（普通会话无 `dream_refine`）→ C1–C5（手动精炼建会话、工具面恰为 `skill`+`dream_refine`、走完六个命令、候选进审批）→ D1–D3（自动精炼建 `dream-…` 会话、不产生 Superagent Input/Ticket）→ E1–E2（preset 缺失/`skill` 非全局时 fail loud）→ F1（冷却）。
  验收：见 docs/logs/2026-11-autodream-native/v0.1.0/acceptance.md
  日志：docs/logs/2026-11-autodream-native/v0.1.0/（上一阶段的 B 记录在 docs/logs/2026-11-autodream-preset/v0.1.0-b/，已被本条取代）
  未验证：`agentCtx.tools.restrict()` 在 `setup` 作用域与 `agent.ctx` 等效、`followup()` 接受手写 `UserMessage`、`meta.agentPreset` 接受 id 字符串、`permissionPresets.resolve('read-only')` 在本 profile 存在、15 分钟 tick 的实际开销
  阻塞：无（只差一次重启；重启会终止当前会话进程，故由用户执行）

- [ ] **DV-EV-020 `owner-candidates.ts` 未接线（约 300 行死代码）：接线还是删除，待拍板** `sev-P2`
  目标：让「进化 → 进化记录」有真实生产者，或把这条链路整体删掉，不留无法到达的代码。
  状态：waiting-user ｜ owner：本会话 ｜ 开始：2026-11-13 03:55 ｜ Scope：plugins/dsh-continual-harness/src/{owner-candidates,index}.ts、plugins/dsh-evolution/src/records.mjs、docs/dream-executor.md
  事实：`forwardAppliedOwnerCandidates`/`retryPendingOwnerCandidates` 无任何调用点（DV-EV-017 已定「本轮不接线」）；它写的是 evolution 记录库（`/evidence` + `/proposal`），而记录页面因此长期空态。精炼链路改原生会话后，跨域候选（prompt/memory/subagent）的产出路径也没有了调用者。
  下一步：拍一个——A 接线（在精炼 `execute` 后把跨域候选转发成 Evidence+Proposal，成本约半天，需定义「谁算 subject」）；B 删除（删 `owner-candidates.ts` 与其 244 行单测、`records.mjs` 的 `CANDIDATE_OWNERS` 入口、面板记录页，成本约 2 小时，改为在「审批」页呈现全部候选）。**推荐 B**：记录库没有第二个生产者，面板已经用「已处置」覆盖了同样信息。
  验收：`git grep -n "forwardAppliedOwnerCandidates"` 为空（选 B）或记录页出现真实记录（选 A）。
  日志：本轮无交付（仅登记）
  阻塞：需用户拍板 A/B

- [~] **DV-EV-018 AutoDream 自动精炼被准入忽略：根因已定 → 已由 DV-EV-019 取代** `sev-P1`
  目标：~~让「自动精炼：开启」真的能跑，或诚实地把失败显示出来~~（本条不再单独推进）
  状态：superseded（2026-11-13 03:50，由 DV-EV-019 取代——精炼不再经过准入，`human`/Policy 这条链路整体退出）
  根因（留档）：门槛通过、Input 也已提交（`3ed7d8de…`），但自动请求 `human:false` → inferred，而本部署 Policy 是内置默认值（`policyVersion 9fbbf9a0…`，规则仅 `copy`/`visual`、模式 `observe`），主会话 15 秒后记 `decision kind:ignore`（`ignoredFromCard`），无 Ticket → 无 run。
  验收：不再适用。若日后恢复准入路线，按 `docs/research/autodream-auto-admission.md` §6 的 D1/D3/D4 重新拍板。
  Scope：docs/research/autodream-auto-admission.md、docs/logs/2026-11-autodream-admission/v0.1.0-diagnosis/、TODOLIST.md（纯文档，未改代码）
  日志：docs/logs/2026-11-autodream-admission/v0.1.0-diagnosis/
  阻塞：无（已被取代）

- [ ] **DV-EV-014 Python 验证 skill 进化环境与 Python 工作台（待决策）** `sev-P2`
  目标：决定技能进化是否需要独立验证环境，以及是否统一到一套 Python 工作台承载（疑源自 prime agent 的进化体系，diva 侧设计未定）。
  状态：todo（waiting-user）｜ owner：未认领 ｜ 开始：—
  下一步：先产出 docs/autodream-verification-env.md，列出三个选项（无验证 / Python 工作台内验证 / 保留 OCI 将来再议）与成本风险，再由用户拍板。
  验收：docs/ 下有决策记录，且本条目指向它；决策前不得引入新的运行时依赖（Docker 或 Python 服务）。
  Scope：docs/、plugins/dsh-continual-harness/
  日志：—
  未验证：—
  阻塞：用户尚未确定 diva 侧设计（明确表示「没想好」）

- [ ] **DV-DOC-010 三源工作台调研 + PENS 收窄为接线总线（待拍 D1–D9）** `sev-P2`
  目标：把 `.workspace/luanyujia-workbench`、`.workspace/pens` 与本仓放到同一张对照表上，回答「三方各在哪一层、我们缺什么、先做什么」；并按「不带人格与记忆、只做外部功能接线、要能接 Codex/Hermes」把 PENS 收窄为应用接线总线，给出可拍板的决策清单。
  状态：waiting-user（报告已交付，等 §9 的 D1–D6 与 §10.8 的 D7–D9 拍板）｜ owner：本会话 ｜ 开始：2026-11-11 16:07 ｜ 完成：2026-11-11 16:45 ｜ 追加：2026-11-11 17:05
  下一步：用户回答 `docs/research/workbench-landscape.md` §9（D1–D6）与 §10.8（D7 首个 PEN=Blender？/ D8 MCP+manifest？/ D9 暴露权归宿主？）；六条中 D5（反例验收）与 D6（参考源登记）影响面最小，可先落；PENS 侧 D8、D9 是其前置。
  验收：报告含仓库目录（`.workspace` 5 仓 + 本仓树 + 淋雨家 15 板块 + PENS 完整目录 + `ProjectViVy` 10 仓）与 PENS 主仓库全文解读；§10 给出「无记忆」三条硬推论（状态归应用 / 做到哪归 agent / 暴露权归宿主）、Blender 三路线与六项最小验收、跨 agent 三样标准化；§4.6 记下淋雨家已有 9 个 MCP（含 Blender 32 工具 ≈8.9k token/轮）与逐项开关；D1–D9 均有选项/推荐/影响面；用户给出选择。
  Scope：docs/research/workbench-landscape.md（新建 + §4.6 + §10 追加）、docs/logs/2026-11-landscape/（两个版本目录）、TODOLIST.md（**纯文档，未改代码**）
  日志：docs/logs/2026-11-landscape/v0.0.1-three-source-survey/、docs/logs/2026-11-landscape/v0.1.0-wiring-bus-scope/
  未验证：淋雨家壳在 rc.5 的兼容性、其「免费 AI 桥」可用性（面板已确认有 5 个站，未实机跑）、Alife/grok-build 实机运行、PENS 任何集成（其自身未实现）、Blender 脚本接口与后台渲染（本机未装）、Codex/Hermes 的 MCP 能力矩阵
  阻塞：无（等用户决策，非阻塞）

- [ ] **DV-DOC-011 PENS 设计与接入（四工具 + 五族适配器 + 深度分级）** `sev-P2`
  目标：回答「PENS 该怎么设计、agent 怎么接进来、怎么尽可能多地玩游戏」，产出可开工的设计：4 个恒定工具、5 个接口族适配器、每游戏一份声明式 profile、D0–D3 深度分级、观察压缩与时间模型、MCP 接入协议与分期 M0–M2。
  状态：waiting-user（设计已交付，等 M0 是否开工 + D7 双 PEN 修订）｜ owner：本会话 ｜ 开始：2026-11-11 17:20 ｜ 完成：2026-11-11 17:50
  下一步：用户就 `docs/research/pens-design.md` §10 的 M0 范围与 §14 的 D7–D9 修订拍板；M0 落地前需要确认目标模拟器/游戏与 ROM 来源合法。
  验收：设计含 4 工具签名 + 5 族覆盖/成本/深度表 + D0–D3 判据 + 观察三档与 delta + 时间模型三硬规则 + 租约/权限四级/6 错误码 + 一份 profile 示例 + 分期验收 + 备选对比（每游戏一个 MCP / computer-use 一把梭）+ §15 四宿主（DSH/Codex/Claude Code/pi）能力矩阵与 P0–P2 适配优先级 + §15.7 组织形态（服务+双接线，插件只是壳）+ §16 桌面壳（Electron 优先、外挂三形态、M1 起）；用户给出选择。
  Scope：docs/research/pens-design.md（新建 + §15 + §16）、docs/logs/2026-11-landscape/v0.2.0-pens-design/、TODOLIST.md（**纯文档，未改代码**）
  日志：docs/logs/2026-11-landscape/v0.2.0-pens-design/
  未验证：libretro/BizHawk 内存接口、CDP 对 canvas 的可读性、BepInEx 版本绑定、四宿主 MCP 互通实测（版本与 CLI 子命令已本机确认，端到端未跑）、Electron 壳的置顶/穿透/帧流可行性（未写代码）、任何一款游戏的可玩性与单轮 token 实测（「≤400 token/轮」是估算）
  阻塞：无（等用户决策，非阻塞）

- [ ] **DV-DOC-012 PENS 预研：两仓功能盘点 + 交界洞察** `sev-P2`
  目标：把 `.workspace/luanyujia-workbench`（参照物）与 diva-dsh（落点）的已有功能盘清，每条带证据；据此回答「PENS 该占哪一层、不该重复什么、M0 该接什么」。
  状态：waiting-user（两份文档已交付，等 M0 是否开工 + 十条修订是否折叠）｜ owner：本会话 ｜ 开始：2026-11-12 01:40 ｜ 完成：2026-11-12 02:45
  下一步：用户拍板 M0 对象（CDP 网页族）与是否把修订折叠进 `pens-design.md` v0.3.0；若开工，先做 core 的 4 工具 + 八字段租约 + CDP 族。
  验收：两份文档成形；功能清单每条带 `路径:行号` 且区分「有代码/仅文档/占位」；洞察含「PENS 该占哪层」的判断、租约契约草案与 M0 对象重选。
  Scope：docs/research/pens-preresearch-inventory.md、docs/research/pens-preresearch-insights.md（新建，**纯文档，未改代码**）
  日志：docs/logs/2026-11-landscape/v0.3.0-pens-preresearch/
  未验证：Claude/pi 的实际 `tools/call`（既有凭证 401）、淋雨家 patch 是否真热重载（注释与文档矛盾）、Electron 壳置顶/穿透、CDP 对 canvas 的可读性、任何一款游戏的可玩性
  阻塞：无

## L0 可靠性与测试债务

- [ ] **DV-TEST-001 Windows 全量测试失败与超时盘点** `sev-P2`
  目标：按根因拆分并修复 Windows 验证缺口，不把本轮备份上传当成测试全部通过。
  状态：todo ｜ owner：未认领 ｜ 开始：— ｜ Scope：tests/、plugins/dsh-continual-harness/tests/、plugins/surfcore/scripts/
  下一步：从 `docs/logs/2026-11-workspace-upload/v0.1.0/verification.md` 的本轮结果逐组复现路径、权限、ESM、超时与其他断言；先比较基线，再决定修复范围。
  验收：根全量与插件检查均完成，逐项给出通过或明确的未验证项。
  日志：docs/logs/2026-11-workspace-upload/v0.1.0/
  未验证：2026-11-13 根全量 1350/1230/114/6（日志 `.artifacts/root-test-2026-11-13.tap`），114 项失败尚未全部定因；Harness 两项 mode 断言失败；SurfCore audit 中断后未完整通过。
  追加（2026-11-17，DV-WS-002）：无沙箱根全量默认 Git 配置 5 项 CRLF/LF 断言失败；仅对测试进程设置 core.autocrlf=false 后 1475/1465/0/10、exit 0。Harness 689/686/2/1，两项仍为 Windows 0666 与预期 0600 权限断言；Laputa 280 通过、see-now 492 通过、Evolution 32 通过。证据：docs/logs/2026-11-workspace-upload/v0.2.0-preparation/verification.md。下一步：隔离测试夹具的 Git 换行环境，处理 Windows 权限断言适配；本轮未改产品行为。
  阻塞：无

## 仓级状态入口（只放指针，不摘内容）

- `plugins/surfcore` → [docs/HANDOFF.md](plugins/surfcore/docs/HANDOFF.md)

## Archive Index

- **DV-WS-005 二次推送核对（done，2026-11-18）** → [v0.5.0 日志](docs/logs/2026-11-workspace-upload/v0.5.0-push/summary.md)。owner: lead；v0.4.0 之后的世界网关语音/模思工作已推送（voice `6cebdf6`、capability-hub `1fb9bc3`、根仓 `52d18ab`+`d7bc24b`+`e2d0a7f`），superagent pin 由本地独有的 `6337fc8` 改为上游同树的 `8c32a9d`。27 个仓本地独有提交全 0。未同步：核对期间另一会话正在写的 ASR 接线（未提交、无测试），没有动。下一步：ASR 落定后再做一轮同步。

- **DV-WS-004 分仓推送（done，2026-11-17）** → [v0.4.0 日志](docs/logs/2026-11-workspace-upload/v0.4.0-push/summary.md)。owner: codex-20261117-push；11 个自有子仓已推送，Harness/Evolution 使用 codex/native-refinement-20261117，其余 main；25 个固定 SHA 远端 fetch 成功。根仓源码 main 已由 a431930 快进至 aa0112e，随后补推本轮文档回执。下一步：按已有任务执行完整 setup 与宿主重启验收；无强推，未改变既有测试限制。

- **DV-WS-003 整理并分仓提交现有成果（done，2026-11-17）** → [v0.3.0 日志](docs/logs/2026-11-workspace-upload/v0.3.0-local-commits/summary.md)。owner: codex-20261117-commits；11 个子仓 12 笔、根仓 8 笔本地提交，3 个新插件已登记子模块，25 个 gitlink 与本机 HEAD 一致。根全量进程级关闭 autocrlf 后 1475/1465/0/10；Harness 两项 Windows 权限断言仍失败，Laputa 首轮超时后完整复跑通过。下一步：用户要求上传时先推送各子仓再推根仓；完整 setup 与重启验收另行执行。本轮未推送。

- **DV-WS-002 工作区整理，为上传做准备（done，2026-11-17）** → [v0.2.0 日志](docs/logs/2026-11-workspace-upload/v0.2.0-preparation/summary.md)。owner: codex-20261117-upload-prep；三插件独立本地仓与 vivy-dsh 公开空远端已建立，Hiyori 18 项取消跟踪且本机文件保留；原 NOW 溢出任务移入活跃且状态不变。根全量临时关闭 autocrlf 后 1475/1465/0/10；Harness 2 项 Windows 权限断言仍失败。下一步：收到提交/推送指令后，按 release.md 先子仓、后 gitlink、最后根仓上传；新插件尚无提交，不存在有效子模块指针。本轮未提交或推送源码。

- **DV-UI-016 右栏去掉 Today / 任务两页的验证期预制内容（done，2026-11-15）** → [v0.6.1 日志](docs/logs/2026-11-daily/v0.6.1-remove-preset-pages/summary.md)。删掉 Today 两张示例卡与任务页四条演示任务，三个页签保留、只留安静空态；纯浏览器半边，硬刷新即生效。

- **DV-UI-017 源码安装 genui（done，2026-11-15）** → [v0.7.0 日志](docs/logs/2026-11-daily/v0.7.0-genui-install/summary.md)。第三方社区插件法装 `third-party/genui`，pin 上游 v0.16.0（`9220925`）；真 GUI 渲出第一张 spec 卡；自由 html 转 `FREE_HTML_UI=false`（面板失效要重启宿主）。宿主运行中注册 genui 只需硬刷新页面。

- **DV-EV-013 AutoDream 全员人工批准（done，待重启验收）** → [v0.3.4 日志](docs/logs/2026-11-autodream-human-approval/v0.3.4/summary.md)。技能与人格候选统一为面板人工批准，删除 Docker/OCI 验证门；重启后按 acceptance.md 验收。
