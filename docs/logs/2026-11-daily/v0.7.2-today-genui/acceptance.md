# 验收：右栏 Today 改 genui spec（按天分区 + 标题内容卡）

主人原话（2026-11-15 23:1x）：「我觉得右侧的 today 等也可以用这个 genui，先两条链路保留一下吧。」
本轮范围：**只做 Today 一页**；任务页与悄悄话页一行没动。

| 验收点 | 结果 | 证据 |
| --- | --- | --- |
| Today 用 genui spec 渲染，复用左栏那份 vendored 渲染器 | 通过 | `todaySpec()` 只产 `divider` + `card` + `text` 三个已有节点，交给 `renderSpec`；新增渲染代码 0 行 |
| 数据形状 `{"cards":[{"title","body"}]}` | 通过 | `daily-today`「200 把卡片交出去」；真宿主 200 响应实测 |
| 卡里不写日期，日期由分区头承担 | 通过 | 单测 `todaySpec`（断言 spec JSON 里没有 `2026-11-15`）；截图卡内无日期 |
| 分区头写「11 月 15 日」 | 通过 | 单测 `dayHeading`；截图 3 个分区头 |
| 每张卡只有「事件标题 + 内容」两行，宿主统一渲染 | 通过 | `todaySpec` 的卡是 `card.title` + 一条 `text`；截图卡片文字即「标题 内容」 |
| 今天没卡 → 「今天还没有要注意的事情哦！」 | 通过 | 单测 + `today-genui-02/03` 两张截图 |
| 历史按日期倒序往下排 | 通过 | 单测「历史倒序」；截图 `11 月 15 → 14 → 13` |
| 没有卡的日期整块不显示 | 通过 | `daily-today`「历史只留比今天早且有卡的日子」、坏 JSON 那天不出现 |
| 宿主校验沿用现有做法 | 通过 | 本机 host 403、跨站 403、`requestRejection`、日期正则 400、单文件上限 → `daily-today` 原用例保留 |
| 坏 JSON 当没有 | 通过 | 「坏 JSON 当没有」+ 形状过滤用例 |
| 旧 html 链路保留（`FREE_HTML_UI` 与 today iframe） | 通过 | 代码未删；开关打开时 `daily-client` 50/0/2，三条 html 用例全部通过 |
| 不写死颜色、不用 emoji | 通过 | 新增 CSS 两条只用 `var(--dl-*)`；空态是纯文字 |
| 不要 iframe | 通过 | 截图像素 `.dl-today-frame` = 0；单测断言 iframe 0 |
| 不重启 3082、不写家目录 | 保持 | 隔离实例 `.artifacts/dsh-daily-verify-home` + 3083，跑完已停 |
| `npm test` 无新增失败 | 通过 | 1441 / 1431 / 0 / 10，exit 0（基线 1427 / 1417 / 0 / 10） |

未达成的验收（本轮不做）：

- 写页规则与触发：worker 不知道要写这个 JSON，master / 定时都没接 → 见 summary.md「还没接」。
- 3082 真面板里的观感：宿主 route 改了形状，要重启一次才生效；本轮不自己停服务。
