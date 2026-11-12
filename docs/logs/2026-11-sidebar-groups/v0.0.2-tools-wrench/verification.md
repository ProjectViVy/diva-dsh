# 验证：v0.0.2-tools-wrench-glyph

运行环境：Windows，工作区 `C:\Users\Administrator\Desktop\diva-dsh`，DSH 沙箱 `workspace-write`。
本沙箱下 `node --test`（`node:test` 会为每个文件 spawn 子进程）与 Playwright / Chrome 启动都会 `spawn EPERM`，
所以下面用「直接执行测试文件」与「jsdom」两条不 spawn 子进程的路径取证。

## 1. 插件测试（直接执行，不 spawn）

```
node tests/vivy-sidebar-core.test.mjs      → 8 pass / 0 fail, exit=0
node tests/vivy-skin-css.test.mjs          → 9 pass / 0 fail, exit=0
```

覆盖：注入脚本结构、分组按标签认成员、每组独立状态、头部顺序（字形 / 标题 / chevron）、
头部几何（16px 字形 + flex:none）、收起规则分家。

## 2. 分组行为（jsdom，既有脚本）

```
node .artifacts/group-dom-check.mjs        → 19/19 checks passed
```

覆盖：两个头的位置与顺序、成员归属、常驻行回拉、`更多` 收尾、宽/窄栏属性、独立折叠与持久化、
重渲染后重新分组、空组消失。

## 3. 新字形 markup（jsdom，本轮新增）

```
node .artifacts/tmp/wrench-dom-check.mjs   → 8/8 checks passed
```

断言：`VIVY工具` 头第一个子节点是 `svg.diva-tools-glyph`；`viewBox="0 0 24 24"`；
路径以 `M14.7 6.3`（扳手开口）开头；不再有滑轨路径 `M2.5 4.3h11`；
`stroke-width="2"` + `stroke="currentColor"`；`VIVY心核` 仍是 16 网格的心形；
两端子节点顺序仍是「字形 / 标题 / chevron」；无未捕获脚本错误。

## 4. 没跑的

- `verify-skin.mjs`（101 项活体检查）：需要启动 Chrome + Playwright，本沙箱 `spawn EPERM`。
- 端内像素截图：同上；并且本会话运行在待更新的实例里，重启会结束当前回合。
- 全量 `npm test`：`node --test` 子进程被沙箱拒绝（非本轮改动导致）。

## 结论

代码层面（结构、行为、markup）已验证；**视觉像不像扳手只有重启后肉眼确认**，
落到 `acceptance.md` 第 2 步。
