# 2026-11-15 DSH 0.2.2 升级评估（只读调研）

## 本轮目标

回答三件事：① 上游 `deepseek-harness` 现在更新了什么；② 能不能在不影响 Superagent 的前提下整体升级；③ 如果不行，用 `patches/` 能否不改 Superagent 源码。

## 交付

- 报告：[docs/research/dsh-0.2.2-upgrade.md](../../research/dsh-0.2.2-upgrade.md)
- 未改任何代码、配置、数据；`docs/research/` 与 `docs/logs/` 之外只写了一个 `.artifacts/` 复算脚本（本地缓存，不入库）。

## 结论

- 上游最新 `dsh-v0.2.2-rc.3`（2026-11-13），本仓 pin 的是 `dsh-v0.2.1-rc.5`（2026-10-29），中间跨 5 个版本。
- **整体升级可行**（Harness 是干净 submodule，本仓无 Harness 补丁）；**「不影响 Superagent」做不到**，但不是崩溃级：版本门放行，唯一确定破坏是 `agent/request` 不许改路由。
- **补丁路线成立**：`withTemporaryPatch` 构建时打、构建后还原，Superagent 源码不脏；升级后改的是补丁内容。
- 新发现的**静默失效**：`dsh-continual-harness` 与 `dsh-laputa` 的 peer 上界 `<0.2.1` 在 0.2.2 上越界，会**被跳过且不报错**。

## 本轮无实施

按只读纪律，未跑 `npm run setup`、未 checkout、未改补丁。升级的验证计划写在报告 §6–§7，等拍板。

## 未验证

见报告 §8（Superagent 实跑、tools 旧接口、SurfCore 线协议、10 个 client 插件、dsh-context 实跑、存储回滚边界）。
