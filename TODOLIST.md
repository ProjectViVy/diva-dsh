# TODOLIST

> 跨会话唯一「当前任务」事实源。字段与规则见 `AGENTS.md` §1–§2。
> 只写状态，不写设计（→ `docs/`），不写历史（→ `docs/logs/`）。
> 完成项移出活跃区，进 `Archive Index` 指向的归档文件。
> 协议来源：[docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md](docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap/summary.md)
> 更新时间：2026-11-10 09:14 (Asia/Shanghai)

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

（空）

### L0 上游跟随（DSH / Superagent 升级与补丁）

（空）

### L0 文档与架构

（空）

## L0 决策闸门（先拍板、后实施）

（空）

## L0 可靠性与测试债务

（空）

## 仓级状态入口（只放指针，不摘内容）

- `plugins/surfcore` → [docs/HANDOFF.md](plugins/surfcore/docs/HANDOFF.md)

## Archive Index

（空）
