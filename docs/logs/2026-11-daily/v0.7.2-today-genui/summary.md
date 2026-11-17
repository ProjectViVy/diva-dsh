# v0.7.2 右栏 Today 改 genui spec 渲染（按天分区 + 标题内容卡）

## 一句话

右栏 Today 现在读 worker 写下的**结构化卡**（`$DSH_HOME/today/<日期>.json`），
按天分区往下排：今天一块、历史倒序跟着，「每张卡只有事件标题 + 内容两行」由宿主统一渲染；
今天没卡就说一句「今天还没有要注意的事情哦！」。左栏那套 vendored 渲染器原样复用，
没有第二套渲染代码。旧的两条自由 HTML 路径（`FREE_HTML_UI`、today 的 html iframe）一行没删，
客户端改一个常量就能切回去。

主人原话（2026-11-15 23:1x）：「我觉得右侧的 today 等也可以用这个 genui，先两条链路保留一下吧。」

## 方案与依据（多·快·好·省）

**最简方案**：宿主一条路由一次下发「今天 + 历史」；客户端把「天」映射成**已有的** genui 词汇
——日期分区头就是 `divider` 的 `label`，每张卡就是 `card` 的 `title` + 一个 `body` 文本——
交给左右栏共用的 `renderSpec`。零新节点、零新依赖、零构建；新增 CSS 只有两条、只用 `var(--dl-*)`。

**备选**：新开 `/api/history` 或每天一次请求。两者都要多一条路由/多一次往返、多一套竞态与错误
分支，收益只是「语义更分明」，不值得。历史数量已经由宿主侧 `HISTORY_LIMIT = 14` 封顶，
够用且不引入分页机器。

**依据**：① 渲染器已经在左栏验证过（v0.7.1），Today 只是换数据源；② 宿主校验已经是现成的
（本机 host、同源、`connection.requestRejection`、日期正则、单文件上限），新字段走同一道闸；
③ 一次请求装下整页，是最少的 IO 与最少的失败面。

## 数据契约

文件：`$DSH_HOME/today/<YYYY-MM-DD>.json`

```json
{"cards":[{"title":"九点的评审","body":"带上三页纸：改动范围、风险、回滚办法。"}]}
```

- **卡里不写日期**：日期由文件名与右栏的分区头承担（分区头写「11 月 15 日」，跨年才带年份）。
- `title` = 事件标题，`body` = 一两句内容；两者必须都是非空字符串，否则整张卡丢掉（不画半张卡）。
- 字符串上限：标题 200、正文 2000，超出截断；一天最多 50 张卡。
- 坏 JSON / `cards` 不是数组 / 元素不是对象 → **当没有卡**，不报错、不记日志。

接口：`GET /dsh-daily/api/today?date=YYYY-MM-DD`

```json
{
  "ok": true,
  "date": "2026-11-15",
  "cards": [{"title": "…", "body": "…"}],
  "html": "<p>旧链路那页</p> | null",
  "history": [{"date": "2026-11-14", "cards": [{"title": "…", "body": "…"}]}]
}
```

- `history` 只含**比今天早、而且真有卡**的日期，倒序，最多 14 天；今天不进自己的历史；未来日期也不进。
- `html` 是旧链路（`today/<日期>.html`）的整页内容，没有就是 `null`；两条路的文件可以同时存在。
- 状态码：`400` 日期不合格式；`403` 非本机 host / 跨站；`503` 没有 `DSH_HOME`；没有内容一律 **`200` + 空数组**
  （「今天还没人写」是常态，不是错误，所以不再用 404 表达）。
- 单文件上限 512 KB（json 与 html 同一条闸），超了当没有。

## 改了什么

- `plugins/dsh-daily/index.js`（127 → 220 行）
  - 新增 `parseCards()` / `readCards()` / `readSmall()` / `listHistory()`；`readToday()` 改走同一条 `readSmall()`。
  - `/dsh-daily/api/today` 一次 `Promise.all` 读今天卡 + 旧 HTML + 历史，返回上面那个形状；404 语义改成 200 + 空。
- `plugins/dsh-daily/client.js`（2167 → 2238 行）
  - `todaySpec()` / `daySection()` / `dayHeading()`：数据 → genui spec（`divider` 做分区头、`card` 做两行卡）；
    `dayHeading` 只在这一层格式化日期，卡里不出现日期。
  - `cardsOf()` / `historyOf()`：客户端也收一道，坏形状当没有（宿主已经洗过，这层是防守）。
  - `TodayView`：`FREE_HTML_UI === true` 且响应里有 `html` → 旧沙箱 iframe；否则渲染结构化 spec。
  - `DailyPage` 的 effect 不再因开关关闭而跳过请求：两条链路共用一次请求。
  - `EMPTY_TODAY`（一句笼统的空态卡）→ `TODAY_EMPTY_TEXT = '今天还没有要注意的事情哦！'`。
  - CSS 新增 2 条：`.dl-today-days`（纵向排布）与它作用域内的 `.dl-g-divider--labeled`（分区头 11.5px/650，
    颜色取 `var(--dl-ink-2)`）。无写死颜色、无 emoji。
- `tests/daily-today.test.mjs`（197 → 304 行，15 项）：结构化卡、旧 html 字段、两条链路并存、坏 JSON、
  形状过滤、字符串截断、历史顺序与过滤、历史坏文件/超大文件、历史上限、超大文件、400/403/503。
- `tests/daily-client.test.mjs`（1166 → 1320 行，52 项）：结构化链路、历史倒序、今天空态、坏形状、
  fetch 抛错、`dayHeading` 格式化、`todaySpec` 形状；旧的 html 链路用例保留（开关打开时才跑）。

## 两条链路怎么切

一个常量，`plugins/dsh-daily/client.js` 第 1365 行：

```js
const FREE_HTML_UI = false;   // false = 结构化卡（当前）；true = 自由 HTML（左栏围栏 + Today iframe）
```

- 切到自由 HTML：改 `true` → 面板硬刷新。Today 若当天有 `today/<日期>.html` 就渲沙箱 iframe，
  没有就退回结构化那句空态；左栏 ` ```html ` 围栏同时恢复成沙箱框。
- 切回结构化：改回 `false` → 硬刷新。HTML 文件原样留着，不删。
- 两条路共用同一个响应与同一次请求，所以切换不需要重启，也不需要改宿主。

## 还没接（别当已完成）

1. **写页规则与触发都没接**：没有任何东西会自动写 `today/<日期>.json`。worker 的提示词里没有
   「收尾把今天的事写进这个文件」这条，master / 定时触发也没接（定时那条还卡在 master 没有
   `schedule_*` 工具，见 DV-UI-014）。现在只能手放文件。
2. **master 不知道卡上写了什么**：聊天里问「今天我有什么事」她读不到这份 JSON，可能跟卡上对不上。
3. 历史只认 `.json`：只有旧 `.html` 的日子不会出现在历史里（以前也没有历史，不算回退）。
