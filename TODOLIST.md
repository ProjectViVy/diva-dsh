# TODOLIST

> 跨会话唯一「当前任务」事实源。字段与规则见 `AGENTS.md` §1–§2。
> 只写状态，不写设计（→ `docs/`），不写历史（→ `docs/logs/`）。
> 完成项移出活跃区，进 `Archive Index` 指向的归档文件。
> 协议来源：[docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md](docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md)
> 更新时间：2026-11-13 (Asia/Shanghai)

## NOW（≤40 行、≤3 条；没有就写「无」，不要编）

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

## 活跃

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

### L0 启动器 / 脚本 / 测试 / 补丁

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
  未验证：根 151 项失败尚未全部定因；Harness 两项 mode 断言失败；SurfCore audit 中断后未完整通过。
  阻塞：无

## 仓级状态入口（只放指针，不摘内容）

- `plugins/surfcore` → [docs/HANDOFF.md](plugins/surfcore/docs/HANDOFF.md)

## Archive Index

- **DV-EV-013 AutoDream 全员人工批准（done，待重启验收）** → [v0.3.4 日志](docs/logs/2026-11-autodream-human-approval/v0.3.4/summary.md)。技能与人格候选统一为面板人工批准，删除 Docker/OCI 验证门；重启后按 acceptance.md 验收。
