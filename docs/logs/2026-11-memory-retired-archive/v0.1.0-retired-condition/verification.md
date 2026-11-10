# 验证记录 · v0.1.0 MemPalace 入档条件

## 命令

```
node --test tests/memory-retired-archive.test.mjs tests/memory-archive-outbox.test.mjs
node --test tests/memory-actmem.test.mjs tests/memory-context-snapshot.test.mjs tests/memory-plugin.test.mjs tests/memory-outbox.test.mjs
node --test --test-name-pattern "QQ public sync retries a snapshot" tests/memory-plugin.test.mjs
```

## 结果

| 范围 | 结果 |
| --- | --- |
| 新增退役账本 + 投递两文件 | 19 / 19 通过 |
| 四个 memory 测试文件 | 270 项，269 通过 |
| QQ 同步单测单独复跑 | 同样失败（`EPERM: rename qq-feed.jsonl -> qq-feed.jsonl.1`） |

## 新增/修改的用例

`tests/memory-retired-archive.test.mjs`：

1. 新加且清晰的记忆只进 `memory-card-full.jsonl`，`memory-card-retired.jsonl` 不生成。
2. 记录退到 `fuzzy` 时，退役账本只追加一行，`retiredReason=faded`、`clarity=fuzzy`、正文与 provenance 完整；再跑一次维护不重复追加。
3. 记录在衰减里被丢掉（`trace` → `forgotten`）时，`retiredReason=forgotten`，随后 `drainArchives()` 走 `/archive/status` + `/archive`，回执落盘、意图清空。

`tests/memory-archive-outbox.test.mjs`：

- 扫描源换成退役账本（`ledgerJsonl`）；首次扫描把账本里已有行全部接住，不再从 EOF 起跳。
- 服务级投递用例改为往 `memory-card-retired.jsonl` 追加行。

## 未验证 / 已知失败

- `memory-plugin.test.mjs:950` 的 QQ 同步用例在 Windows 上 `rename` 报 EPERM（共享读句柄未关）。该路径只经过 `plugins/_shared/qq-feed.mjs` 与 `plugins/memory/src/qq-sync.mjs`，本次改动没有触碰，单独复跑同样失败，判定为既有环境问题。
- 活体（重启后的真实投递）未做，见 `acceptance.md`。
