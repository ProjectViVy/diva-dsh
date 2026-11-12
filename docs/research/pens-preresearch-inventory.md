# PENS 预研 · 工作台功能清单（两仓对照）

- 状态：盘点进行中（3/5 完成；「外部应用与 MCP」「diva-dsh 插件」两节待补）
- 日期：2026-11-12 (Asia/Shanghai)
- 口径：只读盘点，不改任何代码；每条结论带 `路径:行号`
- 前置：[`pens-design.md`](pens-design.md)（设计已批准）、[`workbench-landscape.md`](workbench-landscape.md)

---

## 0. 先说七条结论

1. **淋雨家工作台没有「外部应用」这个抽象，只有三条互不相通的通道**：①引擎侧 MCP（壳只往 profile patch 写 `disabled: true`）；②壳自己 spawn 进程并接管窗口（Blender / 工业软件）；③页面自动化桥（本地 HTTP → 渲染层 webview 打字取字，再逐站包成 MCP）。**跨通道没有统一的启动/就绪/失败/关闭语义**（`W12-源码照搬/外壳/renderer/mcp-panel.js:8`、`外壳/main.js:552-565`、`外壳/renderer/renderers.js:2556`）。
2. **唯一把「进程级接入」做完整的是 Blender**：常量表（exe、工作区、`autostart_mcp.py`、抓帧 ps1、9876 端口、嵌入代理）+ `tasklist` 判活 + TCP 探端口 + 异步抓帧循环 + owner-overlay 窗口内置 + 第二窗口自动退回抓帧（`main.js:1627-1636`、`:1692-1711`、`:1655-1678`、`:1876-1918`）。它证明「打开→探活→观察→嵌入→退让」这条链可行，**但它只服务这一个壳，且 MCP 在引擎侧，别的宿主复用不了**。
3. **公开副本里的「MCP 逐项开关」是真 UI、假配置**：`FILE` 仍是 `<工作台>` 占位，写盘后 `parse` 得到空 off，9 行会全显示「已开启」；`patchReload=live` 只有一行注释，而仓库自己的文档写「补丁层只在启动时读一次，必须重启」（`mcp-panel.js:8,96-105,144`；`04-工作台搭建/配置片段.md:35`）。→ **「逐项开关」只能当设计先例，不能当可运行参照**。
4. **全仓最成熟的「唯一执行者」不是 MCP，而是网页版 AI 桥**：HTTP 只监听 `127.0.0.1`、任务带 claim 独占、桥版本三闸、旧桥回包直接丢弃（`main.js:4617,4696-4745`）。这是租约 + 作业的雏形，比 MCP 面板成熟得多。
5. **本仓的 MCP 桥已经把跨宿主契约定死了**：工具名 `mcp__<server>__<raw>`（与 Claude Code / Codex 同形）、单次调用超时 60s、重连 500ms→30s×10、`maxInstructionBytes` 32KB、图像走 attachment、**MCP task 扩展未实现**（`deepseek-harness/packages/mcp/mcp-client/README.md:12,61-67,213`）。PENS 只能顺着走。
6. **两仓都没有「会话级 × 应用级」的暴露清单**：淋雨家是全局 per-MCP 开关，本仓是「装上即全量暴露」，唯一现成抓手是 MCP caller scope 为空时不产生任何工具与提示词（`mcp-client/README.md:12`）。
7. **本机一个外部应用都没装**（Blender/ComfyUI/剪映/RetroArch/Minecraft/OBS 全无，2026-11-12 实测）→ M0 主链改 **CDP 浏览器族**（零安装），Blender 作为第二例。

---

## 1. 口径

| 项 | 说明 |
| --- | --- |
| 对象 | ①淋雨家工作台 `.workspace/luanyujia-workbench`（参照物）②本仓 diva-dsh（落点） |
| 方法 | 5 个子代理并行只读盘点，每条结论必须带证据；区分「有代码」「仅文档」「占位」 |
| 不做的判断 | 不评分、不排序、不给「谁更好」；只回答 PENS 该借什么、该占什么、该避开什么 |

---

## 2. 淋雨家工作台（15 板块）

### 2.1 场景 / 面板 / 外壳入口

**本质**：零构建 Electron 壳。一个窗口 = 一份 `scenarios/<id>.json`，文件只写「哪几块面板、摆哪格」；长相交给 `type → 函数` 的渲染器表；系统能力全部经 `window.app.*` 注入。

| 功能 | 做什么 | 证据 | 对 PENS |
| --- | --- | --- | --- |
| 场景 = 一份 JSON | 丢进 `scenarios/` 即被发现；文件名必须等于 id | `W01-场景模式/场景配置格式.md:5,33` | 不重复（UI 层） |
| 网格布局 | `cols` + `col/row/w/h`；越界按实际列数渲染并告警 | `W01-场景模式/布局与网格.md:65` | 不重复 |
| 渲染器注册表 | 键=type、值=函数；未注册只显示灰字、不报错 | `W01-场景模式/面板类型与注册.md:10-18` | PENS 可作为**一个面板类型**挂进去 |
| 面板生命周期 | 渲染器可返回 `cleanup`，切场景时调用 | `面板类型与注册.md:46-56` | 不重复 |
| **面板↔外壳桥 `app.*`** | 面板不碰系统能力，全走 preload IPC；按域分命名空间 | `面板通用能力.md:43-52`；`面板-harness-AI会话.js:1309,1604` | **P0**：`app.blender` 就是「外部应用 IPC」的先例 |
| 自刷新通道 | 指令文件→主进程轮询→重载面板→删文件 | `面板通用能力.md:26-32`；`外壳/main.js:4817-4823` | P1 |
| 会话三字段 | `sessionTitle`/`sessionId`/`pinTarget` 把面板钉到一条会话 | `场景配置格式.md:64-78` | P1：会话→租约的先例 |
| 会话校验/轮换 | 逐面板核对 id 与标题逐字一致；建新→归档→原子回写 | `W10-源码/会话与切换/sessions.mjs:202-210,382-395` | P1 |
| **Blender 窗口内置** | `SetParent` 把窗口塞进面板；画面走本地静态服务，**不经 IPC**；`ResizeObserver` 同步几何 | `面板-harness-AI会话.js:1308-1311,1368,1394-1403` | **P0**：视图层先例 |
| 顶栏 6 部件 | 负载/余额/回退/⋯菜单/网页端按钮；无接口就隐藏或禁用 | `W07-顶栏与菜单栏/README.md:100-114` | P2：**不给假按钮**的纪律 |
| 标签栏与开窗 | 拖拽换位 FLIP、固定组、`⧉` 单场景开窗 | `W07-顶栏与菜单栏/2-标签交互.js:23,33,39,88` | P2 |
| 最小可运行壳 | 单文件演示 SCENES+RENDERERS+拖拽，假 `app.*` | `W11-最小可运行壳/index.html:182,316,401` | 教具，不重复 |
| 外壳侧 / 热更侧二分 | 改外壳要重启；手感类逻辑一律放热更侧 | `W07/README.md:9-15`；`W04/技术栈与启动链路.md:63-72` | P1：**PENS 的壳也该这么切** |
| 流程画布节点 | 节点类型=剪映/OBS，双击 `launchApp` 开软件 | `外壳/renderer/renderers.js:2556,4165` | **P0**：第三处碎片 |

**观察**
- 真实机制（有代码）：渲染器查表、`cleanup` 契约、标签拖拽、Blender `SetParent`、MCP patch 写入、`sessions.mjs` 回写。
- 真实机制但公开版只剩摘录：场景目录扫描与 `scenarios:list` IPC 只在完整壳（`外壳/main.js:503-507,1183`）；`W10-源码/README.md:69-71` 自认「clone 下来跑不起来」。
- 仅文档/占位：`theme`/`layout` 字段不参与渲染（`场景配置格式.md:47`）；「状态小字」是规范不是 API（`面板通用能力.md:56-66`）。
- **真正缺口**：没有统一「外部应用」抽象。能力散在三处，**没有启动/关闭/窗口几何/就绪失败状态**。

### 2.2 外部应用与 MCP

**本质**：三条互不相通的通道，生效方式都是「写配置文件 + 引擎重放/重启」。

| 通道 | 机制 | 覆盖 |
| --- | --- | --- |
| ① 引擎侧 MCP | 壳只往 profile patch 追加 `disabled: true`；MCP 本体一律不在仓内 | 9 项：Blender 32 / CUA 57 / ComfyUI 39 / 剪映 8 / 网页 AI ×5（各 1） |
| ② 壳 spawn 进程 + 接管窗口 | Blender、工业软件；`tasklist` 判活、TCP 探端口、抓帧、`SetParent`/owner-overlay | Blender（唯一做完整）、工业软件（`app.win` IPC） |
| ③ 页面自动化桥 | 本地 HTTP（仅 `127.0.0.1`）→ 渲染层 webview 打字取字 → 包装成 MCP | 5 个网页版 AI，每站一个 `ask` 工具 |

**关键实测/读码事实**：

| 事实 | 证据 |
| --- | --- |
| MCP 面板是**真 UI、假配置**：`FILE` 仍是 `<工作台>` 占位；`parse` 得空 off；9 行会全显示「已开启」 | `mcp-panel.js:8,96-105,144` |
| 热重载**自相矛盾**：注释称 `patchReload=live`，文档写「补丁层只在启动时读一次，必须重启」 | `mcp-panel.js:4-5`；`04/配置片段.md:35` |
| token 是算完再手抄：`ceil(len/4)+4`，要求照 `引擎\MCP\检查MCP.mjs` 实测抄 | `mcp-panel.js:11-13` |
| 9 项面板值合计 ≈52.4k/轮；文档口径「全开 58k、cua 一个 26.8k、按需降到 ~9k」 | `mcp-panel.js:18-32`；`规范:520-522` |
| 文档与代码计数不一致：工具目录写「MCP 3 套」，面板有 9 项 | `工具与技能目录.md:5` |
| 网页 AI 桥是全仓最成熟的「唯一执行者」：claim 独占 + 桥版本三闸 + 旧回包丢弃 | `main.js:4617,4696-4745` |
| Blender 走**引擎侧 MCP**（自带插件 9876），壳只负责起停/探活/抓帧/嵌入 | `main.js:552-565,1733-1748,1891-1918` |
| 剪映/ComfyUI 在壳里只是「打开软件」，真正工具面在引擎里 | `renderers.js:2556-2563,4165`；`规范:394` |
| 本地模型在公开副本是**死 UI**（preload 只有注释，取 `app.localmodel` 直接报「还没有通道」） | `preload.js:100-102`；`renderers.js:7002-7003,7078` |

**观察**
1. 三条通道各自的「打开/观察/动作/关闭」都不完整，且互相不复用；**唯一把生命周期做全的是 Blender**。
2. 「逐项 token 开关」这个设计方向被证明是这层最便宜的入口，但**公开副本跑不起来**，只能当先例。
3. 网页 AI 桥证明：**claim 独占 + 版本闸 + 回包丢弃**这套土办法就是租约/幂等的雏形。

### 2.3 机制 / 规矩 / 升级 / 情报

**本质**：解决多会话长跑三个月的四类退化（记忆膨胀没人读、活互相踩、规矩漂移、交付没回执）：**记忆落文件不落会话 + 修改权分层 + 每条例都有会失败的检查**（`总纲.md:12-13`、`05-协作与规矩/README.md:6-9`）。

| 机制 | 内容 | 可验证 | 证据 | 对 PENS |
| --- | --- | --- | --- | --- |
| 三档字节红线 | §〇≤4096（超→problems+exit 1）、主文件≤25600（仅 warn）、项目记忆≤8KB（**无代码检查**） | 部分 | `场景记忆.mjs:556,558,562` | 需改造：换成「持久化字段白名单」 |
| 修改权五档 A–E | 宪法/工具/台账/自己的/别人的地盘 | 无代码，靠人判 | `05-协作与规矩/一-全局铁律.md:60` | 需改造：暴露权归宿主 |
| 派单≠公告 + 回执 | 要动手必须唤醒；「活干完但对方不知道=没干完」 | 有自测 | `08-升级与改造清单/机制清单.md:70-77,97-102` | 不适用（PENS 不做主动唤醒） |
| 禁止无限对话 | 一次派单=一条回执=结束，≤200 字/≤10 行【结束】 | 无代码 | `05-协作与规矩/README.md:34-35` | **可直接借** |
| 把规矩变成机制·五步法 | 可判定违规→唯一判据→exit 非 0+差异集合→**反例不报即假检查**→挂节奏 | 方法+9 例 | `08/把规矩变成机制.md:31-55,134` | **可直接借**（对应待拍 D5） |
| 临时哨兵 | 问工具即建目录；扫违规 exit 1 | 有代码 | `10-源码/机制小工具/临时哨兵.mjs:60-67` | 需改造 |
| 归档只进不改 | 交接才归档，升级可回滚 | 有代码 | `12-源码照搬/说明/记忆约定.md:24` | 需改造（租约需可撤回） |
| 公开情报口径 | 事实与判断分离、带日期链接、未证实标注 | 文档自律 | `13-公开情报/README.md:19-22` | **可直接借** |

**观察**
1. 三档数字执行强度不对称：§〇 硬拦、主文件只 warn、**8KB 全仓无检查**——按它自己的判据（`把规矩变成机制.md:12`），8KB 仍是口号。
2. 五步法的四要素：可判定违规（把「记忆不要太长」改成「§〇 超过 4096 字节」）、唯一判据出处、差异集合非 0/1、**反例不报=检查是假的**。
3. 机制清单靠**自曝盲区**立信：7 个插件只 2 个有路由可探；场景体检只查文件不查内容；回执台账「可能缺记录」（`机制清单.md:45,56,80-81`）。
4. 公开情报可复核面窄：只有版本号、许可证、commit `6337fc8` 是硬事实；Super-agent 概念自述「不是官方规范」；Harness alpha 特性明标二手未证实。
5. 记忆层整体对 PENS 不可移植（前提是「引擎不按场景注入任何东西」，`05/README.md:43`）——能借的是**判据与纪律**，不是目录结构。

---

## 3. 本仓（diva-dsh）工作台

### 3.1 插件清单

**口径更正**：`plugins/` 下 15 个本地目录 = **14 个可挂载插件 + 1 个共享库（`_shared`，无 manifest、无 Cordis 入口）**；再加 `surfcore`（上游）与 `third-party/dsh-context`（第三方），共 **16 个可挂载包**。装法一律是 `cordis.patch.yml` 的 insert 行，**无 enable/disable、无会话级暴露清单**（`plugins/asr/cordis.patch.yml:1-4`）。

| 插件（name@版本） | 提供什么 | 挂载点 | P |
| --- | --- | --- | --- |
| `dsh-live2d@0.1.0` | 6 个 `l2d_*` 工具 → 独立舞台进程（`127.0.0.1:5462` + token 文件） | `ctx.tools.register` ×6 | **P0** |
| `dsh-surfcore-adapter@0.1.0` | 入站 QQ/B站事件→InputEnvelope；出站唯一 Source + ledger 幂等 | `sources.register('surfcore')` | **P0** |
| `dsh-local-voice@0.1.0` | TTS、语音包安装、音频库、限流审计、prepare/commit/abort | orchestrator Effect host | **P0** |
| `surfcore@0.8.6`（上游） | QQ(SnowLuma/OneBot)+B站桥接、控制台 | 独立进程 `src/bridge.js` | **P0** |
| `dsh-local-asr@0.1.0` | SenseVoice 本地识别；子进程 stdio + 模型按 hash 下载 | 面板 HTTP + IPC `asr` | P1 |
| `dsh-capability-hub@0.1.0` | 世界网关五插槽，只存凭据**引用**，**无 invoke 路由** | `capability-hub/registry.json` | P1 |
| `dsh-local-memory@0.1.0` | 记忆卡/会话记忆/黑话/收尾/快照 + Worker | 面板 HTTP + IPC `memory` | P1 |
| `_shared`（共享库） | 跨域信封、归档摘要唯一实现、组件 IPC、路径、主体 | 无入口，被相对导入 | P1 |
| `dsh-actmem-recap@0.1.0` | `/recap` + 定时简报，写衰减记忆卡 | commands + 面板 | P2 |
| `dsh-continual-harness@0.3.4` | `harness_refine`/benchmark、系统提示投影、refine 门、回滚 | 工具 + 面板 | P2 |
| `dsh-evolution@0.1.0` | Evidence/Proposal/Validation/PublicationRecord、Dream 工具 | webServer/tools | P2 |
| `dsh-laputa@0.3.0` | 六文档人格注入 + 不可变版本；**明说不改工具权限** | 提示 section + `laputa_init` | P2 |
| `dsh-mempalace@0.1.0` | 14 个记忆/知识工具 + 面板 + sqlite-vec | webServer + tools | P2 |
| `dsh-skin-manager@0.1.0` | 六个皮肤偏好持久化 | webServer | P2 |
| `dsh-vivy-studio@0.1.1` | 品牌名/字体/主题/侧栏分组 | 静态注入 | P2 |
| `dsh-vivy-tone@0.1.1` | 提示词中文替换，走 Superagent 自己的 prompt API | loopback 面板 | P2 |
| `dsh-context@0.83.1`（第三方） | 上下文面板 + `/context` | `dsh.client.inject` ×6 | P2 |

**观察**

1. **真·外部进程只有 3 处，各造各的轮子**：live2d 走 HTTP+token、asr 走 stdio 子进程、voice 走 ffmpeg/安装器——**没有共享的进程模型**（`dsh-live2d/src/stage-client.mjs:9-13`、`asr/src/worker-host.mjs:5`、`voice/src/voice-core.mjs:161`）。
2. **单实例靠 pid 锁文件，没有租约**：`bridge.lock`（校验 inode）、`dream.mjs:45-51`、live2d token 0600；失效即人工清理。
3. **权限面几乎不存在**：能力 = 注册工具；`laputa` 明说不改权限；出站唯一闸是 Source + ledger。**没有 `action_class`、没有人审**。
4. **已有「总线雏形」**：组件 IPC 是 loopback-only + 每组件令牌 + 错误码前缀归属（`_shared/ipc.mjs:5,12,35-40`）——比 PENS 弱在没有句柄、租约、动作白名单。
5. **作业语义零散**：live2d 有 `jobId`+`progress`+`requestId` 幂等（`l2d-tools-remote.mjs:172-204`）；voice 有 prepare/commit/abort；其余无取消/进度。
6. **`capability-hub` 是空插槽**：五个能力可填可存，但无 invoke、无测试连接（`capability-hub/README.md:8-10`）。

### 3.2 平台能力面

**六层**：控制核心（Superagent）→ 执行/工具/任务（DSH `packages/`，52 包组）→ 人格（Laputa）→ 记忆（ActMem + MemPalace）→ 交付/界面（web shell、apps/desktop）→ 呈现（`stage-app` 独立进程）。

| 能力 | 来自 | 形态 | 证据 | 与 PENS |
| --- | --- | --- | --- | --- |
| 执行运行时 | DSH `packages/` | 包 | `deepseek-harness/packages/`（52 组） | 相邻（宿主） |
| **MCP 客户端** | `mcp/mcp-client` | 包（一实例一服务器） | `packages/mcp/mcp-client/src/index.ts:2-11` | **复用**：首选接入面 |
| MCP 资源 | `mcp/mcp-resources` | 包 | `packages/mcp/README.md:12` | 复用（观察面） |
| **作业** | `jobs` / `jobs-local` / `tool-jobs` | `ctx.jobs` + 3 工具 | `packages/jobs/README.md:12,27-29` | **复用**：承载分钟级作业 |
| 定时/唤醒 | `schedule` | Host-owned | `packages/schedule/README.md:12` | 复用（PENS 不做主动唤醒） |
| 审批与权限 | `interaction/user-approval`、`permission-presets` | 包 | `packages/interaction/README.md:12` | 复用（第二道闸） |
| 沙箱 | `sandbox` + `-policy/-local/-windows-acl` | 三档 + 一次性升级 | `packages/sandbox/README.md:12` | 复用 |
| 技能 | `skill` + `tool-skill` | 包 + 仓内 2 个 | `packages/skill/README.md:12`；`skills/` | 相邻 |
| 自动化入口 | `acp` | JSON-RPC，可挂 MCP、代答审批 | `packages/acp/README.md:12` | 复用（第二宿主口径） |
| 呈现 | `stage-app/` | 独立进程（令牌 HTTP，perform 返回 jobId） | `stage-app/README.md:3,23` | 无关（纯输出面） |
| 人格/记忆 | `dsh-laputa`、`memory`、`dsh-mempalace` | 插件 | `docs/architecture.md:144-156` | **冲突区**：不进 PENS |

**MCP 桥的硬约束（本仓实测/读文档）**：

| 约束 | 值 | 对 PENS 的含义 |
| --- | --- | --- |
| 工具命名 | `mcp__<serverName>__<rawName>`（与 Claude Code / Codex 同形） | 跨宿主命名天然一致，PENS 不必自造 |
| 空 scope | **不产生任何 MCP 工具与提示词**（`mcp-client/README.md:12`） | D9「暴露权归宿主」的现成抓手 |
| 单次调用超时 | 60s（`toolCallTimeoutMs`） | 渲染/模拟必须走 job，不能占一次调用 |
| 服务器指令上限 | 32KB，超限拒绝连接 | PENS 的说明文本必须精简 |
| 图像 | 模型支持图像输入时进 attachment（`:87`） | `observe(frame)` 可行 |
| 重连 | 500ms→30s 翻倍，10 次后移除工具（`:93`） | core 重启可被容忍 |
| **MCP task 扩展** | **未实现**（`:213`） | PENS 不能依赖 MCP 的长期任务原语，必须自带 job |
| 环境清洗 | 子进程丢弃 `KEY\|PASSWORD\|SECRET\|TOKEN` 与 `DSH_*`（`:137`） | MCP 壳不会继承凭据 → 凭据引用必须走 PENS 自己的授权 |

---

## 4. 交界分析：PENS 该占哪块

```text
淋雨家已有（不该重复）            两仓都没做（PENS 的落点）
─────────────────────           ────────────────────────────
场景 JSON / 网格布局             外部应用的生命周期（启动/就绪/失败/关闭）
渲染器注册表 / cleanup          统一能力层（现在碎在 app.* / MCP 开关 / launchApp 三处）
标签栏 / 开窗 / 顶栏            租约与并发（谁在操作这个实例）
会话三字段绑定                  会话级 × 应用级 的暴露清单
MCP 开关（全局）                动作级权限与审计账本
SetParent 视图嵌入              作业与取消（跨进程）
```

四条判断：

1. **PENS 不做视图层**：`SetParent` + 静态服务那条路已经证明「把窗口塞进面板」可行，但它绑定单个壳；PENS 只提供「帧 + 结构状态」，谁显示、怎么显示归壳。
2. **PENS 不做场景/布局/标签栏**：那是壳的产品设计，不是能力总线。
3. **PENS 必须补生命周期**：两仓都没有**跨应用统一**的「启动→就绪→运行→失败→关闭」状态机。Blender 有单应用的完整链（判活/探端口/抓帧/嵌入/退让），但它是硬编码在壳里的常量表，**不是可声明、可复用的抽象**——这正是 PENS 要把它抬成 profile 的地方。
4. **PENS 必须补租约与暴露**：淋雨家是全局开关、本仓是空 scope 才不暴露，都没有「这个会话能看到这个应用的这几个动作」。

---

## 5. 差距与 M0 建议

| 差距 | 现状 | PENS 补法 | 优先级 |
| --- | --- | --- | --- |
| 外部应用无统一生命周期 | 三处碎片，各自 launchApp / IPC / MCP 开关 | core 的「三面一作业」（§3） | P0 |
| 无租约/并发裁决 | 只有「一个 MCP 开关」 | lease + spectate | P0 |
| 无会话级暴露清单 | 全局开关 or 空 scope | catalog 分级 + 宿主 scope | P1 |
| 无动作级审计 | 只有日志 | 权限账本（四类 action_class） | P1 |
| 作业跨进程 | 淋雨家无；本仓 job 在宿主内 | PENS 自己的 job id | P0 |
| 无跨应用就绪探测 | 只有 Blender 硬编码了 `tasklist` + TCP 探端口 | `ready_probe` 写进 profile，成为声明式 | P0 |

**M0 主链建议改为 CDP 浏览器族**（本机零外部应用）：

1. 用本机 Edge/Chrome + CDP 打开一个本地页面（零安装）；
2. 4 个工具 + lease + 错误码 + summary/delta 观察；
3. 两个宿主（Codex/Claude Code，pi 端到端实测结果待回）各跑 10 分钟；
4. Blender 作为第二例，装好后再验「有脚本接口的应用」路径。

---

## 6. 已验证与未验证

**已验证（本轮实读/实测）**

- 两仓的功能面与代码结构，证据均带行号。
- 本机无任何外部应用（`Test-Path` 实测）、node `v24.14.1`、python `3.13.12`、uv `0.11.7`。
- DSH MCP 桥的四项硬约束（命名/超时/指令上限/空 scope）——读 `mcp-client/README.md` 与 `src/index.ts:42-47`。

**未验证**

| 项 | 原因 | 怎么验 |
| --- | --- | --- |
| 淋雨家 MCP 开关是否热重载 | 注释与文档互相矛盾，公开副本无 `patchReload` 字段 | 实机改 patch 看引擎是否重载 |
| 四宿主 MCP 端到端 | ✅ **已完成**（能连 4/4，能调通 1/4，其余卡凭证） | 见 `pens-preresearch-insights.md` §6.1 |
| Electron 壳置顶/穿透/30fps | 未写 demo | M1 前写最小 demo |
| 任何一款游戏的可玩性 | 本机无游戏 | M0 起 CDP 网页族 |
| PENS 自身运行时 | PENS 仓尚无实现（`workbench-landscape.md:18`） | 不在本轮范围 |

**方法学说明**：本盘点全部为**读代码与读文档**，没有运行任何工作台实例；凡标「仅文档」「占位」的，均为子代理明确核对后判定。
