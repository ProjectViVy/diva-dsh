# v0.1.0 MemPalace 入档条件改为「已退色 / 被淘汰」

- 状态：已交付（待重启验收）
- 范围：`plugins/memory/src/card-engine.mjs`（退役判定与退役账本）、`plugins/memory/src/archive-out.mjs`（投递来源）、`plugins/memory/src/service.mjs`（接线与手动动作）、`plugins/memory/README.md`、`tests/memory-retired-archive.test.mjs`（新增）、`tests/memory-archive-outbox.test.mjs`
- 验证：`node --test tests/memory-retired-archive.test.mjs tests/memory-archive-outbox.test.mjs` → 19/19；`memory-{actmem,context-snapshot,plugin,outbox}` 四文件 270 项里 269 通过，唯一失败是既有的 QQ 同步 `rename` EPERM（与本改动无关，单独复跑同样失败）
- 未验证：运行中的 DSH 仍是旧代码，退役账本要重启后才开始工作；活体验收见 `acceptance.md`
- 下一步：DV-MEM-002（重启验收）
- 回滚：`git checkout plugins/memory/src/{card-engine,archive-out,service}.mjs` 后重启；已写入的 `memory-card-retired.jsonl` 与 `archive-outbox/state.json` 可保留（回滚后不再被扫）

## 改了什么

- 入档条件从「尚未归档」（`!record.fullArchivedAt`，等于每条新记忆立刻镜像）改为「已经退色或被淘汰」：
  - 退色：清晰度降到 `fuzzy` / `trace`（`RETIRED_CLARITIES`）；
  - 淘汰：衰减到 `forgotten`、压缩时丢掉 `trace`、摄取时被容量挤掉、手动遗忘。
- 新增退役账本 `data/memory-card-retired.jsonl`：只在上述事件发生时追加一行，带 `retiredAt` / `retiredReason`（`faded` / `forgotten` / `compacted` / `evicted`），同一 id 只写一次；卡片上持久化 `retiredAt` 做凭据。
- `archive-out` 的扫描源从 `memory-card-full.jsonl` 换成退役账本（选项改名 `fullJsonl` → `ledgerJsonl`）；首次扫描不再从 EOF 起跳，因为退役账本本身就是「只有新退役记录」的账本。
- 全量归档 `memory-card-full.jsonl` 保持原样：每条记忆仍然在第一次维护时写入，本地可查、可恢复；只是它不再直接喂 MemPalace。
- 手动动作（遗忘 / 压缩 / 加记忆时挤掉旧记录）也接进退役判定，避免「批量压缩后一批记忆凭空消失、MemPalace 永远不知道」。

## 影响面

- MemPalace 从「实时镜像」变成「退役档案」：新加且清晰的记忆不会出现在宫殿里；等它模糊、被遗忘或被压缩掉才入档。
- 本地存储不减：`memory-card-full.jsonl` 仍然收全量；退役账本只是很小的一份投递清单。
- 已存在的 7 条历史投递（旧条件写入 MemPalace）保持不动，未清理。
- 依赖方：面板的归档出站计数不变；`old archive-outbox/state.json` 里的 `scan_identity` 指向旧文件，切换后第一次扫描会因 identity 不符从 0 开始，本身就是空账本。

## 未验证

- 活体：重启后加一条记忆 → 宫殿里没有；让它退色（面板维护或等每日 4 点）→ 宫殿里有，且只出现一次。原因同上一批：本会话由运行中的 DSH 实例托管，重启会终止当前回合。
- 复活语义：退色入档后被重新提到的记忆会回到卡片，但它已经留在宫殿里（档案只写一次、不回收）。这是「坟头立碑」的取舍，未做回收逻辑。
- 手动遗忘进宫殿未做隐私开关；如认为主动删除不该进档案，需要在 `applyManualAction('forget')` 去掉这一条。
