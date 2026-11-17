# 交付

| | |
| --- | --- |
| 改动文件 | `plugins/dsh-daily/client.js`（只改 `DailyIcon`）、`plugins/dsh-daily/README.md`（补一行图标说明）、`TODOLIST.md`（DV-UI-008） |
| 新增文件 | `docs/logs/2026-11-daily/v0.1.3-coffee-icon/`（四件套）、`.artifacts/dsh-daily-check/icon-sheet.mjs` + `icon-sheet.png`（不入库） |
| 依赖 / 配置 / 接线 | 无变化；没有新包、没有 profile 改动、没有子模块指针 |
| 生效方式 | 刷新页面（浏览器半身）；宿主不用重启 |
| 提交 | 未提交（等用户发话） |

## 回滚

单个组件函数，内联在 `client.js` 里：把 `DailyIcon` 换回 16 格日出即可，无数据、无迁移、无副作用。
