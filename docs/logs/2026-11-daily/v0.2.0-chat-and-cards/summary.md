# 右栏四页改成 genui `dsh-ui` spec 渲染

- 起因：右栏 Today/任务/记忆/能力四页是照原型手写的 DOM，一行 genui 都没有；用户要求「右边彻底要用 genui」。
- 做法：把 `dsh-genui`（`.workspace/genui` @ `3357603`、v0.16.0、MIT）里右栏用得到的 **19 种节点** vendor 进 `plugins/dsh-daily/client.js`（装载器只给 `require('react')`、没有相对模块解析，所以必须单文件，无构建步骤），自写 `validateSpec` + `renderSpec`；四个页面改成 `DAILY_CARDS` / `taskCards(filter)` / `memoryCards()` / `skillCards(switches)` 四个 spec 源，手写卡片 DOM 全删（`legacyPanels: 0`）。
- 新增两张示例卡：**今天天气**（`stat` hero 18℃ + 体感/风/湿度 `keyvalue` + 一句预报）与**每日推荐**（内联 SVG 封面 data URI + 书名 + badge + 一句理由），都带「示例」角标与「示例数据」脚注，排在晨间简报之前。
- 限额与清洗：`validateSpec` 单次 DFS —— 深度 > 8 丢该节点、节点预算 200、字符串截 2000、`list 50` / `kv 24` / `options 50` / `grid.cols 1–12` / `progress 0–100` / `gap 0–40`、`image.src` 只放 http(s)/相对/`data:image/`；渲染前再洗一遍，未知类型返回 `null`，坏节点只丢自己。
- 交互：`switch` 与 `segmented-control` 按 spec 的 `name` 走 `handlers = { switch, segmented }`，任务筛选与能力页三个开关照旧可用。
- 顺带修掉一处原型遗留：简报标题原来写死「今天，11 月 14 日」，现在跟着系统日期走（`dayStamp()`），与左栏头部同口径。
- 验证：`tests/daily-client.test.mjs` 23/23；jsdom 四页 `ALL PASS`；真 Chrome 截图 `gcards 9 / groots 5 / legacyPanels 0 / 页面无错误`。
- 未验证：重启后的真页面手感（页签滚动、窄窗 ≤680px、`focus-visible`）。
