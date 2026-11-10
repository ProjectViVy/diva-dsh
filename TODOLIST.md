# TODOLIST

> 跨会话唯一「当前任务」事实源。字段与规则见 `AGENTS.md` §1–§2。
> 只写状态，不写设计（→ `docs/`），不写历史（→ `docs/logs/`）。
> 完成项移出活跃区，进 `Archive Index` 指向的归档文件。
> 协议来源：[docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md](docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md)
> 更新时间：2026-11-10 16:55 (Asia/Shanghai)

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

（空）

### L0 插件（surfcore / memory / voice / asr / actmem-recap / mempalace / laputa / evolution / live2d / 皮肤）

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

### L0 上游跟随（DSH / Superagent 升级与补丁）

- [ ] **DV-EV-015 Dream 执行器模式：无 shell、只提交候选** `sev-P1`
  目标：AutoDream/refine 的 worker 只能用 `dream_refine` 读冻结材料并提交计划，工具集里没有任何能写工作区或执行命令的工具。
  状态：doing（待重启验收）｜ owner：75422f6e1b54 ｜ 开始：2026-11-10 10:57 ｜ Scope：patches/superagent-dream.patch、plugins/dsh-evolution/src/{dream-tool.mjs,index.mjs,dream.mjs}、skills/diva-dream/SKILL.md
  下一步：`npm run stop && npm start` 后手动触发一次 refine，确认 Dream 会话只剩 `skill`/`dream_refine`，按 `docs/logs/2026-11-dream-executor/v0.1.0-dream-mode/acceptance.md` 验收。
  验收：Dream 会话发起 `pwsh`/`write` 被工具列表拒绝；`dream_refine claim/evidence/plan/execute` 全链路跑通；非 Dream 会话调用该工具被拒。
  日志：docs/logs/2026-11-dream-executor/v0.1.0-dream-mode/
  未验证：运行中实例仍是旧 Executor（补丁只在新进程生效）；`dream_refine` 在真实 worker 会话中的可见性、以及 `evidence` 分页对 4.4 MB 材料的内存/上下文表现，均需重启后实测。
  阻塞：无（需要停面板重启，而本会话由运行中的实例托管）

### L0 文档与架构

（空）

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

## L0 可靠性与测试债务

（空）

## 仓级状态入口（只放指针，不摘内容）

- `plugins/surfcore` → [docs/HANDOFF.md](plugins/surfcore/docs/HANDOFF.md)

## Archive Index

- **DV-EV-013 AutoDream 全员人工批准（done，待重启验收）** → [v0.3.4 日志](docs/logs/2026-11-autodream-human-approval/v0.3.4/summary.md)。技能与人格候选统一为面板人工批准，删除 Docker/OCI 验证门；重启后按 acceptance.md 验收。
