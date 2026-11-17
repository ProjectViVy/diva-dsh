# 验证记录 v0.6.0

## 0. 追加：按钮回路（17:3x）

`node --test tests/daily-client.test.mjs` → **38 项 / 38 通过**（35 + 3 条按钮回路）

| # | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| 0.1 | 点按钮后输入框 | 值变成 `先做评审`（两头空白去掉） | 通过 |
| 0.2 | **有没有偷偷发出去** | `harness.sends.length === 0`（点了三轮始终为 0） | 通过 |
| 0.3 | 已有输入时 | `我先说一句` + `先做评审` → `我先说一句\n先做评审`，不覆盖 | 通过 |
| 0.4 | 空话 / 非字符串（`'   '`、`'\n\n'`、`null`、`42`、对象） | 输入框不变，不抛 | 通过 |
| 0.5 | 清洗 | `a\r\nb\rc` → `a\nb\nc`；600 字 → 500 字 | 通过 |
| 0.6 | 没挂接收端 | `setUiPickSink(null)` 后投递安静丢弃 | 通过 |

「消息能不能从沙箱里出来」不需要另测：高度回报走的就是同一个 `window.addEventListener('message')`，截图里 340px 的框高就是它跑通的证据。安全闸（只认 `event.source === 某帧的 contentWindow`）是同一条路径上的 `uiFrameOf()`。

## 1. 单元测试（假 React + 假 document）

`node --test tests/daily-client.test.mjs` → **35 项 / 35 通过**（原 32 + 3 条）

| # | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1.1 | `uiDocument('<p>hi</p>', '--dl-ink:#123456;--dl-paper:#abcdef')` | 含 `:root{--dl-ink:#123456;--dl-paper:#abcdef}` | 通过 |
| 1.2 | 基础排版引用变量并留兜底 | 含 `var(--dl-ink,#241c16)` | 通过 |
| 1.3 | 顺序 | `:root{…}` 在用它的样式之前 | 通过（比对 index） |
| 1.4 | 没采到变量 | 不写空 `:root`，仍带 CSP | 通过 |
| 1.5 | `uiThemeVars()` 无 document | 返回 `''`，不抛 | 通过 |
| 1.6 | 采集值清洗 | 两头空格去掉、`rgb(...)` 与 `linear-gradient(...)` 保住 | 通过 |
| 1.7 | 注入防护 | 值里带 `</style><script>` 时整条丢弃 | 通过（断言结果里无 `<`/`>`） |
| 1.8 | 空值 | 取不到的 token 不产生空声明 | 通过 |
| 1.9 | 语法 | `node --check`（client.js、测试文件） | 通过 |

## 2. 真 Chrome 像素

`.artifacts/dsh-daily-check/ui-frame-shot.mjs`（用 client.js 的真 CSS 与真 `uiDocument`，token 串手填——脚本环境没有真 DOM）

| # | 指标 | 实际 |
| --- | --- | --- |
| 2.1 | 气泡 / 框尺寸 | 784 × 340 / 756 × 260 |
| 2.2 | 卡片是否吃变量 | 左栏小卡底 `--dl-paper-2`、标签 `--dl-ink-3`、描边 `--dl-rule-soft`、柱状 `--dl-grad` 全部生效（截图 `ui-frame.png`） |
| 2.3 | 页面错误 | 无 |

## 3. skill 是否真的可用

| # | 检查 | 实际 |
| --- | --- | --- |
| 3.1 | 把 `skills/card-guide/SKILL.md` 装进 `$DSH_HOME/skills/card-guide/` 后，会话可用技能列表 | **当场出现 `card-guide`**（无需重启） |
| 3.2 | 描述与用途 | 列表里显示「Use when you want to show the owner a visual…」 |
| 3.3 | 重装路径 | 已加进 `scripts/lib/skills.mjs` 的 `PROJECT_SKILLS`，`npm run setup:components` 会重新装 |

## 4. 全仓回归

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 4.1 | `npm test` | 无新增失败 | **1415 项 / 1409 通过 / 0 失败 / 6 跳过**（v0.5.0 基线 1409/1403：+6，本轮 3 条变量 + 3 条按钮） |

## 5. 未验证

- **「从 computed style 采集」只在假 document 上验过**，没在真页面里跑过（真页面里 `.dl` 一定存在、`getComputedStyle` 一定可用，但这是推断，不是命令输出）。
- **换肤后卡片会不会跟着变**没测：变量每次渲染现采，但皮肤切换是否触发重渲染未知。
- **卡片的按钮回路**没做也没测：`postMessage` 发得出去，宿主没有接收端。
- 没有真跑 hanako 对照它的实际观感，只读了源码与它的设计文档。
