# 发布与回滚：v0.7.2 Today 结构化卡

## 交付物

| 文件 | 变化 |
| --- | --- |
| `plugins/dsh-daily/index.js` | 127 → 220 行：`/dsh-daily/api/today` 改下发 `cards` + `html` + `history` |
| `plugins/dsh-daily/client.js` | 2167 → 2238 行：按天分区、标题内容卡、取数统一；旧 html 路径保留 |
| `tests/daily-today.test.mjs` | 197 → 304 行，15 项 |
| `tests/daily-client.test.mjs` | 1166 → 1320 行，52 项 |
| `docs/logs/2026-11-daily/v0.7.2-today-genui/` | 四件套 |
| `.artifacts/dsh-daily-check/today-genui-0{1,2,3}-*.png` | 真 Chrome 三态证据（隔离实例 3083） |

备份（改动前）：`.artifacts/dsh-daily-backup/20261115-before-today-genui/`
（`client.js`、`index.js`、`daily-client.test.mjs`、`daily-today.test.mjs` 各一份，覆盖回去即回滚）。

## 生效方式

两半，生效条件不同：

1. **浏览器半边（多半）**：`client.js` —— 面板里 **Ctrl+F5 硬刷新**即可，不用重启。
2. **宿主半边**：`index.js` 的 `/dsh-daily/api/today` 换了响应形状（`cards` / `history` 两个新字段）。
   插件是常驻进程，**必须重启一次宿主**才生效；重启会断一次主人的面板（会话不丢，状态在 `$DSH_HOME`）。

源码级重启（由主人执行，本会话不自己停服务）：

```
npm run stop
npm start
npm run status      # 记下新端口
```

重启后在面板里 Ctrl+F5，右栏 Today 标题条应变成「今天的界面 · 结构化卡片」，且不再有 iframe。
重启前（旧宿主 + 新客户端）会怎样：旧宿主不返回 `cards`，客户端按「今天没卡」渲染——只有分区头和
空态，历史也不会出现；这是两边版本错位时的预期降级，不会报错、不会空白。

## 数据准备（本轮没有触发源）

```
$DSH_HOME/today/2026-11-15.json
{"cards":[{"title":"九点的评审","body":"带上三页纸。"}]}
```

没有任何东西会自动写它（见 summary.md「还没接」）。手放一份再点「刷新」即可看到。

## 回滚

覆盖回备份的四个文件 → 宿主重启 + 面板 Ctrl+F5。数据文件不用动：旧链路读同一个目录的 `.html`，
结构化文件留着也不影响旧链路（旧宿主根本不知道 `.json`）。

## 两条链路切换

`plugins/dsh-daily/client.js:1365` 的 `const FREE_HTML_UI`：`false`（当前，结构化）↔ `true`（自由 HTML）。
改完硬刷新，不用重启；两边的数据文件都留着，不删任何东西。
