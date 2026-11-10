# 发布说明 · v0.1.0 MemPalace 入档条件

- 版本：`v0.1.0-retired-condition`
- 影响组件：`plugins/memory`（ActMem 侧），MemPalace 接收端不改
- 生效方式：重启（`npm run stop && npm start`）
- 新文件：`$DSH_HOME/memory/data/memory-card-retired.jsonl`（自动创建，无需迁移）
- 数据迁移：无。旧 `memory-card-full.jsonl` 保留全部内容；旧 `archive-outbox/state.json` 首次扫描自动归零

## 升级后检查

1. `GET /archive-out/status` 返回 `ok: true`，`enabled: true`，`pending: 0`。
2. 加一条记忆后，`memory-card-retired.jsonl` 不出现该条。
3. 记忆退色/被淘汰后，账本出现且只出现一次；宫殿可检索到。

## 回滚

1. `git checkout plugins/memory/src/card-engine.mjs plugins/memory/src/archive-out.mjs plugins/memory/src/service.mjs`
2. `npm run stop && npm start`
3. 回滚后投递源回到 `memory-card-full.jsonl`，`memory-card-retired.jsonl` 留在磁盘上但不被读取；可选删除。
