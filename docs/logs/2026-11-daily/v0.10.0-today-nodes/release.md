# 发布说明：v0.10.0 今日卡 nodes（需要重启宿主）

## 生效方式

| 半边 | 改动 | 生效方式 |
| --- | --- | --- |
| 宿主 `plugins/dsh-daily/index.js` | 卡片可选 `nodes` 的四项上限校验（数组 / ≤40 节点 / ≤6 层 / 单串 ≤2000；坏树整卡丢） | **重启一次宿主** |
| 浏览器 `plugins/dsh-daily/client.js` | `cardsOf` / `daySection` 透传 nodes 进 card items；复用现有 `renderSpec` | 面板硬刷新（Ctrl+F5） |
| 数据 `.artifacts/dsh-home/today/2026-11-16.json` | 11 张新格式简报卡 | 宿主按请求读文件，点「刷新」或重载即生效 |

重启命令（主人执行；本轮没有自己停/重启 3082）：

```powershell
cd C:\Users\Administrator\Desktop\diva-dsh
npm run stop
npm start
```

- 影响：3082 面板会短暂断开一次；Superagent/Daily 都随宿主重启。
- 重启后浏览器 **硬刷新** 一次，新的客户端代码才会加载。
- 重启前：旧宿主会忽略 `nodes`，Today 只显示 11 张卡的标题 + 正文（不报错）。
- 重启后：11 张卡带徽标 / 表格 / 图表 / 步骤 / 时间线；2026-11-15 的 4 张旧卡保持
  标题 + 正文，不出现 nodes。

## 本轮验证环境

- 隔离实例：`.artifacts/dsh-daily-verify-home`（独立 `DSH_HOME`，profile `daily-verify`，
  端口 3083），真 Chrome headless，1440×1000；截图后已停，3083 端口已释放。
- 3082（主人面板）全程未碰；收尾检查监听端口只剩 3082。
- 截图：`.artifacts/dsh-daily-check/today-v2-01-nodes-and-legacy.png`（新卡 + 旧卡同屏）、
  `today-v2-02-all-cards.png`（11 卡）、`today-v2-03-briefing-mid.png` / `-bottom.png`；
  明细 `today-v2-report.json` / `today-v2-report-more.json`。
- 测试：`daily-today` 21/21；`daily-client` 55/51/0/4；`npm test` 1472/1462/0/10，exit 0。

## 回滚

1. **只回滚内容**（最快、不用重启）：
   ```powershell
   Copy-Item `
     'C:\Users\Administrator\Desktop\diva-dsh\.artifacts\dsh-daily-backup\20261116-today-cards\2026-11-16.json' `
     'C:\Users\Administrator\Desktop\diva-dsh\.artifacts\dsh-home\today\2026-11-16.json' -Force
   ```
   然后 Today 点「刷新」；15 张旧卡回来，新格式消失（旧宿主会忽略 nodes；新宿主也兼容）。
2. **回滚代码**（`plugins/dsh-daily/` 未被根仓库跟踪，没有 git 版本可 checkout）：
   - `plugins/dsh-daily/index.js`：删掉 `MAX_NODES` / `MAX_NODE_DEPTH` / `nodesFit`，
     把 `parseCards` 恢复成「title 与 body 必须都有、只 push {title, body}」。
   - `plugins/dsh-daily/client.js`：`cardsOf` 只收 `{title, body}`；`daySection` 恢复
     `items: [t(body, 'body')]`。
   - 回滚后重启宿主 + 硬刷新；`daily-today` / `daily-client` 里新增的 nodes 用例
     会失败——把对应 6 + 3 条测试一并删掉即可（它们与旧行为互斥）。
3. **不动数据只回滚 UI**：不需要，客户端在没有 `nodes` 数据时自然走旧路径。

## 提交

本轮**没有 git commit**（按纪律）。`plugins/dsh-daily/`、`tests/daily-*.test.mjs`、
`.artifacts/`、`docs/logs/2026-11-daily/v0.10.0-today-nodes/` 的改动都在工作树上，
等主人决定是否提交。
