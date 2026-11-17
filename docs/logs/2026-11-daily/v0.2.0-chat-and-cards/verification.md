# 验证记录

## 插件自身

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 单元测试 | `node --test tests/daily-client.test.mjs` | 23/23 通过（左栏 18 项 + 右栏 spec 5 项） |
| jsdom 渲染 | `node .artifacts/dsh-daily-check/render3.mjs` | ALL PASS（四页逐项断言） |
| 真 Chrome 截图 | `node .artifacts/dsh-daily-check/shot-page.mjs` | `gcards 9`、`groots 5`、`legacyPanels 0`、页面错误 无 |
| 视觉 | `.artifacts/dsh-daily-check/new-{today,tasks,memory,skills}.png` | 纸色/墨色/圆角/铅笔影沿用 `--dl-*`；无新配色、无外部字体 |

## 全仓

`npm test` → 1382 项 / 1375 通过 / 1 失败 / 6 跳过。

唯一失败在 `tests/memory-actmem.test.mjs:175`（「records, updates and restores from another subject are rejected」），与本轮改动无关，是**既有缺陷**：

- 复现：`.artifacts/repro-memory.mjs` 走同样的 `createMemoryService` + `action('add')` + `maintenance()`，结果 `{"ok":true,"changed":false}`，`backups/` 目录根本没建，`backups()` 返回 `[]` → 测试里 `join(dir,'backups', undefined)` 抛错。
- 根因：`plugins/memory/src/service.mjs:905` 只在 `needsDailyDecay(card, cfg, now)` 为真时才备份，而 `plugins/memory/src/card-engine.mjs:1911-1916` 要求 `hour >= cfg.dailyHour`，默认 `dailyHour: 4`。所以**本地时间 0:00–3:59 这段跑必挂，4:00 之后必过**。本轮在 00:30 跑，正好落在豁免窗口外。
- 该文件最后修改时间 2026-11-10，本轮未触碰。

## 未验证

- 重启后真页面的页签切换与滚动、任务页点「进行中」是否只剩一条、能力页开关翻转、窄窗 ≤680px 时 `grid` 是否变一列、`focus-visible` 环。
- 左栏在真实 host 下的收发（依赖 master 会话重建，见 `2026-11-persona`）。
