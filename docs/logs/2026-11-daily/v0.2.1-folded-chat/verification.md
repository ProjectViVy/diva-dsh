# 验证记录

## 插件自身

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 语法 | `node --check plugins/dsh-daily/client.js` | 通过 |
| 单元测试 | `node --test tests/daily-client.test.mjs` | 26/26 通过（原 23 项 + 新增 3 项） |
| jsdom 渲染 | `node .artifacts/dsh-daily-check/render3.mjs` | ALL PASS（四页断言未受影响） |
| 真 Chrome 三态 | `node .artifacts/dsh-daily-check/shot-fold.mjs` | 见下表，页面错误 `无` |

真 Chrome 三态（`.artifacts/dsh-daily-check/fold-{0-before,1-new-chat,2-expanded}.png`）：

| 时刻 | 我的气泡 | 她的气泡 | 折叠行 | 提示 | localStorage |
| --- | --- | --- | --- | --- | --- |
| 初始 | 2 | 2 | 无 | 无 | 空 |
| 点「新建聊天」 | 0 | 0 | 展开更早的 4 条 | 新的一段，从这句话开始。 | `dsh-daily/fold/orchestrator-test=4` |
| 点折叠行 | 2 | 2 | 收起（`aria-expanded=true`） | 同上 | 不变 |
| 硬刷新后 | 0 | 0 | 展开更早的 4 条 | 同上 | 不变 |

## 全仓

`npm test` → 1385 项 / 1379 通过 / 0 失败 / 6 跳过（exit 0）。比上一轮多出的 3 项就是本轮新增用例。

上一轮那条 `tests/memory-actmem.test.mjs:175` 的失败这次没出现——它是**既有的时间窗缺陷**
（`dailyHour: 4`，本地 0:00–3:59 必挂），本轮在 11:2x 跑，落在窗口外，与改动无关，未修。

## 窄窗

700×900 视口（单栏）下 `.dl-chat-head` 的 `getBoundingClientRect().width` 与 `scrollWidth`
都是 **666**，不溢出；把 `running` 临时改成 true 让「停止」也出现，仍是 666/666。
截图 `.artifacts/dsh-daily-check/fold-3-narrow.png`。

## 未验证

- 真 host（3082）里点一次：master 历史 291 条时折叠行的位置、点「展开」后滚动位置是否跳、刷新后
  是否仍收着（这三条只有在真会话上才看得到）。
- 极窄（<420px）时头部四个元素是否会挤成两行。
