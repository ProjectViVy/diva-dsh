# v0.5.0 worker → today 围栏：文件到右栏这一段

- 状态：已交付（**需要重启**才能生效：host 半边新增了一条路由）
- 范围：`plugins/dsh-daily/index.js`（宿主半边，原来只有 463 字节的空壳）、`plugins/dsh-daily/client.js`、`tests/daily-client.test.mjs`、`tests/daily-today.test.mjs`
- 验证：`tests/daily-today.test.mjs` 7/7；`tests/daily-client.test.mjs` 32/32；`npm test` 1409/1403/0/6；真 Chrome `today-worker.png` 无页面错误
- 未验证：真宿主里的路由是否被 `connection.requestRejection` 放行（要重启）、worker 真的写一次（规则还没有）
- 回滚：`index.js` 回到空 `apply()`；`client.js` 删 `TODAY_API`/`todayKey`/`fetchToday` 与 `DailyPage` 里那段 effect，`TodayView` 回到只渲 `DAILY_CARDS`，删 `.dl-today*` CSS

## 判断依据（用户 16:0x 的口径）

> master 通常不写 today 围栏，这个主要交给 worker 来写。master 或者是定时事件等外部触发派工：看今天的新闻，worker 就会把这些内容写入 today 围栏。master 的书写能力主要是为了更便捷跟主人进行表达。

所以是两条通道，不是一条：

| 通道 | 谁写 | 语言 | 落点 | 状态 |
| --- | --- | --- | --- | --- |
| 表达 | master | `html` 围栏 | 左栏气泡 | 已完成（v0.4.0） |
| 内容 | **worker** | `html` | 右栏 Today | **本版** |

两条都用同一套沙箱：同一份 `uiDocument()`、同一个 `sandbox="allow-scripts"`、同一套高度回报。差别只有谁写、写到哪、什么时候出现。

## 这一段做了什么

1. **约定**：worker 写 `$DSH_HOME/today/<YYYY-MM-DD>.html`。不建库、不建表——一个文件就是一天的一页。
2. **宿主半边**：`index.js` 从空壳变成 `GET /dsh-daily/api/today?date=YYYY-MM-DD`。
   - 校验照抄 `dsh-superagent-reset` 那三层（本机 host / 非 GET 同源 / `connection.requestRejection`）——这一仓里已经有先例，不另发明。
   - 日期先过正则再 `basename` 再拼路径：`../secret`、`2026-11-15.html`、`20261115` 全部 400。
   - 单页上限 512 KB，超了当作没有。
   - **没有文件返回 404 且不写日志**：「今天还没人写」是常态，不是故障，刷日志只会淹掉真错误。
3. **右栏 Today**：先问一次宿主，有内容就把整页塞进沙箱 iframe，示例卡退场；没有就回落示例卡，标题条明说「还没有人写，下面是示例」。旁边一个「刷新」——手动放文件时不至于要整页重载。

## 为什么是文件 + 一条 GET

备选是走 Superagent 的工单存储或 `dsh-context` 的缓存。没选，两个理由：

- worker 要写的东西是**一天的、会整份覆盖的、给人看的**，天然是文件；塞进工单表会让「任务状态」和「今天的页面」互相污染。
- 通道只要一条 GET，前端不需要理解 Superagent 的数据模型；将来换触发方式（定时、`schedule`）也不动这条通道。

代价：多一个约定（目录 + 文件名），worker 得知道。这条约定现在只写在文档里，没有进 worker 的提示词——见下。

## 没做的三件（下一步）

1. **worker 的规则没有。** worker 收尾时不会自己写这个文件。现在只能手动放一份进去验通道。要做：worker 提示词里加一条「如果这次派活是要出今天的页面，就写到 `$DSH_HOME/today/<今天>.html`」。
2. **触发没接。** master 派工、定时事件派工都还是空的。定时那条还卡在老问题：master 的工具白名单里没有 `schedule_*`（DV-UI-014）。
3. **master 不知道卡上写了什么。** 他聊天时若提到今天的事，可能和右栏那张卡对不上。要么给他一个只读入口，要么每日摘要进他的 context。

这三条都不在本版范围里，本版只保证「文件放进去，右栏看得见」。
