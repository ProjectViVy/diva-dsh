# 发布记录 v0.6.1

- 是否发布：**是**——纯客户端
- 生效方式：浏览器硬刷新 3082（只改了 `client.js`）
- 需要重启的进程：**无**
- 宿主半边：没动（`index.js`、`GET /dsh-daily/api/today`、`$DSH_HOME/today/<date>.html` 约定照旧）

## 发布后必做

1. 硬刷新后先看 Today 与任务两页：应该只是空的，没有任何示例卡 / 演示任务的残影。
2. 若今天已有 worker 页面（`$DSH_HOME/today/<今天>.html`），确认 Today 仍渲染成框——这是本轮唯一可能被误伤的路径，已离线回归 572 × 249。

## 需要回头核对

- 任务页接真实数据时，`EMPTY_TASKS` 是唯一要替换的地方；不要把演示数据加回来。
- Today 接真实数据有两条路：worker 写文件（现成）或另接数据源（未定）；没数据时 `EMPTY_TODAY` 就是那唯一一句话。

## 回滚

1. 用 `.artifacts/dsh-daily-backup/20261115-before-empty-pages/client.js` 覆盖 `plugins/dsh-daily/client.js`；`daily-client.test.mjs` 同样用同目录备份覆盖回测试。
2. 硬刷新即可。`plugins/dsh-daily/` 未被根仓库跟踪，不能用 `git checkout` 回滚。
