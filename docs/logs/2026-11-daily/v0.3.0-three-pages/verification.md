# 验证记录 v0.3.0

按 命令 → 预期 → 实际。

## 1. 单元测试（假 React 树）

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1.1 | `node --test tests/daily-client.test.mjs` | 全绿 | **26 个 / 26 通过 / 0 失败** |
| 1.2 | 同上，页签断言 | 三个标签、顺序对 | `['Today', '任务', '悄悄话']`，`dl-tab` 数量 3 |
| 1.3 | 同上，占位页断言 | 文案齐、无控件 | 六行文案全在；`dl-g-switch` 0、`dl-g-seg-opt` 0 |
| 1.4 | 同上，交互断言 | 切页 + 筛选 | 任务页 4 张卡 → 点「进行中」剩 1 张；切到悄悄话只有 1 张占位卡 |
| 1.5 | 同上，「三页都从 spec 渲染」 | 每页 `.dl-g-root` > 0 且无手写 DOM | 三页全通过，`pages.length === 3` |

## 2. 真 DOM 检查（jsdom + 真 React）

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 2.1 | `node .artifacts/dsh-daily-check/render3.mjs` | 全项通过 | **ALL PASS**（原脚本里记忆页/能力页的四条断言已替换成悄悄话占位断言） |
| 2.2 | 同上，悄悄话页 | 一张卡、有「待实现」、无开关无筛选 | 通过 |

## 3. 真 Chrome 像素检查

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 3.1 | `node .artifacts/dsh-daily-check/shot-page.mjs` | 三页各一张图、无页面错误 | `new-today.png` / `new-tasks.png` / `new-whisper.png`；`页面错误: 无` |
| 3.2 | 同上，指标 | 两栏宽度、无纵向溢出 | `chat 818×868`、`ctx 576×868`、`overflow false`、`scrollHeight 900` |
| 3.3 | 看截图 | 页签只有三个；占位页文案不溢出 | 见 `new-whisper.png`：`Today / 任务 / 悄悄话`，占位卡与页脚一行都在框内 |

## 4. 静态检查

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 4.1 | `node --check plugins/dsh-daily/client.js` | 语法通过 | 通过 |
| 4.2 | `node --check tests/daily-client.test.mjs` | 语法通过 | 通过 |
| 4.3 | `grep MEMORY\|SKILLS\|switches\|MemoryView\|SkillsView` | 零残留 | 零命中（`FOOT_ALL` 也随两个 View 一起删掉，未再被引用） |

## 5. 全仓回归

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 5.1 | `npm test` | 无新增失败 | **1396 项 / 1390 通过 / 0 失败 / 6 跳过**（改动前 1397/1391/0/6：删掉能力页与记忆页两条用例、加了一条悄悄话用例） |

## 6. 未做的验证

- 没在真宿主 3082 上点过这三个页签（本轮没有停/起服务）。风险低：这是 client 半边，硬刷新即生效，且离线页用的是同一份 `client.js` + 宿主同一版 CSS 变量。
- 窄窗（<900px）三页签换行未重测（四页时测过，少一页只会更宽松）。
