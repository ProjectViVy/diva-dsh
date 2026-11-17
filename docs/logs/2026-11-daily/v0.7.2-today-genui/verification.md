# 验证记录：v0.7.2 Today 结构化卡

## 1. 两个专用测试文件

```
node --test tests/daily-today.test.mjs
ℹ tests 15   ℹ pass 15   ℹ fail 0   ℹ skipped 0

node --test tests/daily-client.test.mjs
ℹ tests 52   ℹ pass 48   ℹ fail 0   ℹ skipped 4
```

- `daily-today` 基线 7 项 → **15 项**：3 条旧用例按新契约改写（没有内容从 404 改成 200 + 空数组），
  新增 9 条——结构化卡、两条链路并存、坏 JSON、形状过滤、字符串截断、历史顺序与过滤、
  历史里的坏文件/超大文件、历史上限 14 天、json 超大文件；净 +8。
- `daily-client` 基线 46/42/0/4 → **52/48/0/4**：原「停用期间不发请求」那条按新行为重写成 7 条
  （结构化链路、历史倒序、今天空态、坏形状、fetch 抛错、`dayHeading`、`todaySpec`），净 +6；
  另改写「Today 空态」与「切标签」两条的断言（空态不再是一张卡）。
  4 条跳过仍是 html 围栏那组（`FREE_HTML_UI === false` 时不跑）。

## 2. 全量

```
npm test
ℹ tests 1441  ℹ pass 1431  ℹ fail 0  ℹ skipped 10   (exit 0)
```

- 基线（v0.7.1）：1427 / 1417 / 0 / 10。现在 **+14 项**（daily-today +8、daily-client +6），**没有新增失败**。
- 同一次交付里第一遍全量出现过 1 条红：`tests/memory-plugin.test.mjs` 的
  「Bilibili network refresh does not block unrelated memory writes」，属既有网络计时用例；
  单独跑该文件 **234/234 通过**，随后再跑全量 **0 失败**。与本轮改动无关（没有碰 memory 插件的任何文件）。

## 3. 旧链路回归（临时翻开关跑一遍再翻回）

`FREE_HTML_UI` 临时改 `true`：

```
node --test tests/daily-client.test.mjs
ℹ tests 52   ℹ pass 50   ℹ fail 0   ℹ skipped 2
```

跳过的换成两条「关闭 html 时才跑」的结构化用例，三条自由 HTML 用例（左栏围栏 + Today iframe + 404 空态）
全部重新生效并通过。跑完已改回 `false`（`client.js:1365 const FREE_HTML_UI = false;` 已核对）。

## 4. 真宿主 + 真 Chrome（隔离实例）

实例：`.artifacts/dsh-daily-verify-home`（独立 DSH_HOME，profile `daily-verify`，端口 **3083**；
3082 主人的面板全程没碰，跑完已停，3083 已释放）。数据写在实例自己的
`today/` 下，未碰 `.artifacts/dsh-home/today/`。截图 1440×900、`channel=chrome`：

| 状态 | 截图 | 实测 |
| --- | --- | --- |
| 今天有卡 + 历史 | `.artifacts/dsh-daily-check/today-genui-01-cards.png` | 分区头 3 个：`11 月 15 日` / `11 月 14 日` / `11 月 13 日`；卡 4 张，文字为「标题 + 内容」两行、卡里无日期；iframe 0；标题条「今天的界面 · 结构化卡片」 |
| 今天空、历史有卡 | `today-genui-02-history.png` | 头 3 个不变；今天那块是「今天还没有要注意的事情哦！」；历史 2 张卡照常 |
| 今天和历史都空 | `today-genui-03-empty.png` | 只有今天一个头 + 那句空态，卡 0 张 |

像素层核对：分区头 `font-size: 11.5px / font-weight: 650 / color: rgb(111,96,85)`（= `var(--dl-ink-2)`），
卡片标题 `13.5px / 650`；`.dl-ctx-scroll` 无横向溢出；页面 **console error 0、pageerror 0**。

## 5. 真宿主路由实测（带面板 cookie）

```
GET http://127.0.0.1:3083/dsh-daily/api/today?date=2026-11-15   → 200
{"ok":true,"date":"2026-11-15",
 "cards":[{"title":"九点的评审","body":"…"},{"title":"下午去拿药","body":"…"}],
 "html":"<p>旧链路那页</p>\r\n",
 "history":[{"date":"2026-11-14","cards":[…]} , {"date":"2026-11-13","cards":[…]}]}
```

- 同一天 `.json` 与 `.html` 同时存在时两个字段都带 → 两条链路切换不需要改接口。
- 再放一份坏 JSON（`today/2026-11-12.json` = `{oops`）：`history` 里 12 号不出现，接口照旧 200。

## 6. 没做的验证

- **3082 真面板**：宿主 route 改了形状，需要重启才生效；本轮没重启（会断主人的面板）。见 release.md。
- 窄窗（<1080px）下 Today 分区的换行只按 CSS 推断，没有截图。
- 真 worker 写文件 → 页面自己出现：没有触发源，只能手放文件（见 summary.md「还没接」）。
- 旧 html 链路在真宿主里的观感：本轮只在开关打开时跑了单测，没有重新截 iframe 图
  （v0.5.0 的 `today-worker.png` 是同一段代码的旧证据）。
