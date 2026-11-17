# 验证记录：v0.10.0 今日卡 nodes 契约

## 1. 两个专用测试文件

```
node --test tests/daily-today.test.mjs
ℹ tests 21   ℹ pass 21   ℹ fail 0   ℹ skipped 0

node --test tests/daily-client.test.mjs
ℹ tests 55   ℹ pass 51   ℹ fail 0   ℹ skipped 4
```

- `daily-today`：15 → **21 项**（+6）。新增：合法 `nodes` 原样下发且旧卡形状不变、
  只有 `title + nodes` 的卡合法、空 `nodes` 没正文整卡丢、坏 `nodes` 四类各丢整卡
  （非数组 / 41 节点 / 7 层 / 2001 字）、边界值（40 节点、6 层、未知类型）放过、
  历史里的 `nodes` 同路径。
- `daily-client`：52 → **55 项**（+3，仍是 51 过 / 4 跳过）。新增：`todaySpec`
  带 nodes 的卡顺序为「标题 + 正文 + 图」，正文可省、坏 nodes 当没有；
  `cardsOf` 透传/过滤规则；真渲染一张带 nodes 的卡（徽标 + 强调句 + 小图表 + 未知
  `tabs` 节点只丢自己）与旧格式卡并存。
- 4 条跳过仍是 html 围栏那组（`FREE_HTML_UI === false` 时不跑），与旧基线一致。

## 2. 全量

```
npm test
ℹ tests 1472   ℹ pass 1462   ℹ fail 0   ℹ skipped 10   (exit 0, 52.3s)
```

- 任务下发时基线写作 1450；本次工作树在基线之后先有 user-plugins 交付的 +13 项
  （1450 → 1463）。本轮再 +9（daily-today +6、daily-client +3）→ **1472**。
  **0 失败、10 跳过、exit 0**，没有新增失败。
- 未出现 memory 计时类 flake（本次全量一次通过）。

## 3. 旧格式回归

- `GET /dsh-daily/api/today?date=2026-11-15`（真实主 DSH_HOME 文件）→ 200，
  仍是 4 张 `{title, body}` 卡，`nodes` 字段一个都没多出来：
  genui 装进项目 / 日常左栏能画卡了 / Today 改成按天分区 / 隔离实例漏过一次凭据。
- 真 Chrome 证据截图里第二张卡就是这份旧数据里的「genui 装进项目」，只渲标题 +
  正文，没有徽标/图表。

## 4. 真宿主路由实测（隔离实例，3082 不碰）

在 `.artifacts/today-v2/probe-route.mjs` 里用假 ctx 挂真插件、`DSH_HOME` 指主
`.artifacts/dsh-home`，直接调 handler：

```
date=2026-11-16 → 200, cards=11, with nodes=11, nodeCounts=[5,2,1,4,5,5,3,5,3,4,3]
date=2026-11-15 → 200, cards=4（旧格式）
history = ["2026-11-15"]
```

- 11 张卡顶层 nodes 数组长度如上；按带 `type` 的节点计数，最多 8 个、最深 2 层，
  离宿主上限（40 / 6）很远。
- 11 张卡标题最长 21 字、正文最长 50 字；扫描 `YYYY-MM-DD` / `M-D` / 年月日 /
  年份 / 季度：**0 命中**；唯一月份引用是数据窗口「10 月用量」（不是事件日期）。

## 5. 真 Chrome 截图（隔离实例 3083 + 独立 DSH_HOME）

实例：`.artifacts/dsh-daily-verify-home`（profile `daily-verify`，端口 **3083**）。
3082 主人的面板全程没碰；截图完成后已停掉 3083，端口检查只剩 3082。
数据写在实例自己的 `today/` 下；截图由真 Chrome（`channel=chrome`，headless，
1440×1000）拍摄，页面无 mock。

| 状态 | 截图 | 实测 |
| --- | --- | --- |
| 证据态：1 张带 nodes 的新卡 + 1 张旧格式卡同屏 | `.artifacts/dsh-daily-check/today-v2-01-nodes-and-legacy.png`（右栏特写 `...-right.png`） | 卡 2 张：新卡 `badges=3`、`chartRows=2`、`tables=1`、`callouts=1`，正文「Qwen4-Max 与 Gemini 赠金两条降价消息…」；旧卡 badges/chart/table/callout 全 0，只有标题 + 正文；iframe 0；`.dl-ctx-scroll` 无横向溢出 |
| 11 张简报卡（点「刷新」原地换数据） | `.artifacts/dsh-daily-check/today-v2-02-all-cards.png` | `cardCount=11`，标题条仍是「今天的界面 · 结构化卡片」，`viaRefresh=true`，无横向溢出 |
| 11 张卡逐张结构与后半段 | `.artifacts/dsh-daily-check/today-v2-03-briefing-mid.png` / `-bottom.png`；明细 `today-v2-report-more.json` | 11 张卡全部渲染；节点分布：chartRows 2（仅卡 1）、stats 2+4、tables 1、steps 2、timelines 2、callouts 7、kv 5、badges 3+2+2+2；`scrollHeight=4459 / clientHeight=921`；卡文本 `dateHits=[]` |
| 页面错误 | 两份 report | `console error 0`、`pageerror 0` |

截图脚本与报告都留在 `.artifacts/dsh-daily-check/`：
`today-v2-start.mjs` / `today-v2-shot.mjs` / `today-v2-shot-more.mjs` /
`today-v2-report.json` / `today-v2-report-more.json`。

## 6. 没验的

- **3082 真面板重启后**：宿主 route 改了，必须重启一次；本轮按纪律没有停/重启 3082。
- **窄窗 <1080px**：右栏表格/图表换行只按现有 CSS 推断，没有截图。
- **worker 自动写 nodes**：本轮 11 张卡是人工写进文件的；worker 提示词仍只要求
  `title/body`，触发链与写 nodes 的指令都未接（下一轮）。
- **未知节点类型在真数据里**：单测覆盖了宿主放行 + 渲染器只丢自己；没有在真面板
  里手工塞坏节点截图。
