# v0.0.1-vivy-tools 验证记录

环境：Windows，Node v24.14.1，DSH `0.2.1-rc.5`，profile `superagent-local`，运行中的 web 面板 `http://127.0.0.1:3082`（旧脚本）。

## 一、语法

| # | 命令 | 期望 | 实际 |
| --- | --- | --- | --- |
| 1 | `node --check plugins/dsh-vivy-studio/sidebar-core.js` | 无语法错误 | ✅ exit 0 |
| 2 | `node --check plugins/dsh-vivy-studio/verify-skin.mjs` | 无语法错误 | ✅ exit 0 |
| 3 | `node --check tests/vivy-sidebar-core.test.mjs` `tests/vivy-skin-css.test.mjs` | 无语法错误 | ✅ exit 0 |

## 二、仓库测试（单进程跑，绕开 `node --test` 的子进程 spawn）

| # | 命令 | 结果 |
| --- | --- | --- |
| 4 | `node tests/vivy-sidebar-core.test.mjs` | ✅ 8/8 |
| 5 | `node tests/vivy-skin-css.test.mjs` | ✅ 9/9 |

第 4 条覆盖：注入脚本含 `brand.js` + `sidebar-core.js` 且只有一个 `<script>` 标签、两个 IIFE 之间有语句终止符、`sidebar-core.js` 在 `files` 里、成员按 `aria-label` 判定（含 `上下文洞察` / `Context Insights` 两个标签）、每组各自的键与头标、头插在成员前且用 `nextSibling` 判定、头内顺序为「字形 / 标题 / 展开箭头」、常驻行被拉回第一个头之前且 `更多` 豁免。

第 5 条覆盖：`data-diva-rail` 决定宽/窄、`padding-left: 22px` 缩进、`data-diva-core` 与 `data-diva-tools` 各自只隐藏本组成员（退出条件是「恰好两条收起点规则，且每条同时约束自己的组」）、这些规则不依赖任何 `--diva-*` 皮肤令牌、头是 36px 面板行、chevron 16px 贴右缘、成员行左右不画边、标题不换成手写体。

## 三、行为验证（jsdom，真实脚本 + 真实样式表）

脚本：`.artifacts/group-dom-check.mjs`（一次性，不入库）。它构造一段与 shell 同形的 `nav[class*="panelList"] > button[class*="panelRow"]`（`相遇 / 插件 / SurfCore / Superagent / 记忆卡片 / 记忆宫殿 / 人格 / 进化 / 自动化任务 / 上下文洞察 / 更多`，其中 `自动化任务` 故意排在成员之后，复现 shell 的 order 并列），把 `sidebar-core.js` 原样注入，`theme.css` 原样挂上，再读 DOM 与计算样式。

`node .artifacts/group-dom-check.mjs` → **19/19**：

| # | 检查 | 实际 |
| --- | --- | --- |
| 6 | 两个头，`core` 在前 | `core, tools` |
| 7 | 标题是产品名 | `VIVY心核 / VIVY工具` |
| 8 | `core` 头紧贴第一个产品面板 | 下一个兄弟 = `SurfCore` |
| 9 | `tools` 头紧贴 `上下文洞察` | 下一个兄弟 = `上下文洞察` |
| 10 | 成员 7 个，全部非常驻 | `SurfCore … 进化, 上下文洞察` |
| 11 | 组成员标记 | `core` 6 个 + `tools` 1 个 |
| 12 | 常驻 `自动化任务` 被拉回第一个头之前 | `相遇 > 插件 > 自动化任务 > core > … > tools > 上下文洞察 > 更多` |
| 13 | `更多` 收尾 | `更多` |
| 14 | 宽栏判定 | `data-diva-rail="false"` |
| 15 | 两个组各自展开 | `expanded / expanded` |
| 16 | 收起 `core` 只写自己的键 | `core=collapsed` |
| 17 | 收起 `core` 只隐藏本组成员（计算样式） | `SurfCore display:none`、`上下文洞察 display:inline-block` |
| 18 | `tools` 仍展开 | `aria-expanded="true"` |
| 19 | 收起 `tools` 只写自己的键 | `tools=collapsed` |
| 20 | 收起 `tools` 只隐藏 `上下文洞察` | `上下文洞察 none`、`SurfCore none`（上一步 core 已收起） |
| 21 | 重新展开 `core` 不动 `tools` | `expanded / collapsed` |
| 22 | 整表重渲染后重新分组并保留状态 | `core:true, tools:false`（来自 localStorage） |
| 23 | 卸载 `上下文洞察` 后空组连头带状态消失 | 只剩 `core`，`data-diva-tools` 为 `null`，无残留成员 |
| 24 | 无 `data-diva-group="tools"` 残留行 | 0 |

## 四、没跑的，以及为什么

| 检查 | 状态 | 原因 |
| --- | --- | --- |
| `node --test tests/*.test.mjs` | ⛔ | 沙箱拒绝 `node --test` 为每个文件 spawn 子进程（`拒绝访问`）；单进程直跑可绕开，见第二节 |
| `node --test tests/vivy-*.test.mjs`（同上） | ⛔ | 同一原因 |
| `node plugins/dsh-vivy-studio/verify-skin.mjs` | ⛔ | Playwright `chromium.launch` → `spawn EPERM`（`--remote-debugging-pipe` 需命名管道）；且运行中面板仍服务旧脚本，起得来也只能验旧代码 |
| 端内看两个分区 | ⛔ | 需重启，而本会话由该面板托管 |
| 切换英文界面看 `Context Insights` 归组 | ⛔ | 同上；标签匹配已由 jsdom 用例覆盖英文正则，但没在真机切语言 |
