# 活体验收 · v0.1.0 MemPalace 入档条件

前置：`npm run stop && npm start`（插件代码改动必须重启；本会话由运行中的实例托管，重启会终止当前回合）。

1. **清晰记忆不入档**：在面板或 QQ 里加一条记忆 → 等一次维护（重启后首轮就会跑）→
   - `data/memory-card-full.jsonl` 里能看到它；
   - `data/memory-card-retired.jsonl` 不存在或没有这一行；
   - MemPalace 面板「记忆」页搜不到这条正文。
2. **退色入档**：让这条记忆退色。最快做法是面板的记忆卡「衰减 / 维护」动作（`forceDecay`），或在 `data/memory-card.json` 里把它的 `createdAt` 改到 90 天前、`importance` 改成 20，再触发一次维护 →
   - `memory-card-retired.jsonl` 出现一行，`retiredReason` 为 `faded` 或 `forgotten`；
   - 下一次维护（`drainArchives`）后 `data/archive-outbox/receipts.jsonl` 多一条回执，`pending/` 为空；
   - MemPalace 记忆页能搜到这条正文，且只有一条。
3. **只入档一次**：再触发一次维护 → 退役账本行数不变，宫殿里没有重复。
4. **淘汰入档**：把其中一条的 `clarity` 直接写成 `trace` 并触发维护 → 卡片里消失，`retiredReason=forgotten`，宫殿里有它。
5. **回执与偏移**：`GET /archive-out/status`（面板概览）里 `pending=0`、`receipts` 随入档增加、`scanOffset` 跟着 `memory-card-retired.jsonl` 的大小走。

预期与风险：

- 重启后第一次扫描时，旧 `archive-outbox/state.json` 的 `scan_identity` 指向 `memory-card-full.jsonl`，会因为 identity 不符从 0 开始扫（账本为空，不产生意图）。
- 旧的 7 条历史投递仍在 MemPalace，不会因为改条件消失或重复。
