# dsh-see-now · v0.3.2-panel-review · 总结

- 目标：对「我看到了」这一版做一次优化复审——找出真正影响使用的点，只改有证据、改动面小的部分。
- 结论：**面板本身没有坏，坏的是「看不出为什么」。** 上一轮留下的悬案是调试页只显示 `N 帧 / 0 张`，而 0 张既可能是故障也可能是静止画面。这一轮把判据补进界面，并顺手削掉了轮询与请求上的浪费。

## 复审找到的问题（按影响排序）

1. **`0 张` 无法判读**（高）：调试页只有「帧 / 出图」，没有「留下几帧、为什么没留」。`runner.status()` 里 `stats.kept / cuts / marks / floors / dupSkipped / scoreSum / scoreMax / tierHist / overflow`、`secondsSinceWake`、`takes.peekEmpty`、`reserved` 全都有，界面一个都没显示。
2. **每次动作多两趟请求**（中）：POST `/lifecycle` 的回包已经是完整 `status + journal`，`act()` 之后又 `refresh()` 了一遍（`/status` + `/lifecycle`）。
3. **`/lifecycle` 每次整份读流水**（中）：调试页每 1.5 秒读一次，裁剪上限 512KB，等于持续 IO；而行数需求只有 80 条。
4. **`sheets` 取值顺序两页不一致**（低）：总览 `stats.sheets ?? sheets`，调试页 `sheets ?? stats.sheets`。当前两者同源，靠巧合一致。
5. **卡片 tone 没有样式**（低）：`snCard(..., 'ok')` 传了 tone，CSS 里只有 `.snv-chip.*`，`.snv-card.ok` 不存在——状态色一直没生效。
6. **toast 不会消失**（低）：动作提示一直挂在顶部，盖住下一次状态。
7. **标签页缺 ARIA 关联**（低）：有 `role=tab`/`aria-selected`，没有 `aria-controls` 与 `tabpanel`。
8. **「停止一切采集」名不副实**（低）：它只停采集与陪看循环，不关悬浮窗。
9. **后台标签页照样轮询**（低）：窗口切走时没人看，仍按 1.5 秒敲宿主。

## 本轮改动

- `client.js`
  - 新增 `snVerdict(cap)`：把「没在采集 / 一帧没抓到 / 抓了 N 帧但一帧没留（画面没变化）/ 留了帧还没封箱 / 已出 N 张」分成五句话，直接显示在调试页「实时状态」上方。
  - 调试页新增 10 项计数：留下的帧、判据（切/标/底）、重复跳过、分数均值/最高、档位分布、首帧至今、叫醒空手（`peekEmpty/peek`）、预留图、溢出。
  - 动作后不再补 `refresh()`；toast 4 秒自动清；轮询在 `document.hidden` 时跳过；标签补 `aria-controls` / `role=tabpanel`。
  - `sheets` 统一取 `cap.sheets`；补 `.snv-card.ok/.warn/.bad` 三条样式；「停止一切采集」改「停止采集与陪看」。
- `src/lifecycle-store.mjs`：`readLifecycle()` 改为按 `limit × 320B` 读文件尾部（下限 4KB），从中间切进来的半截行丢掉；不再整份读。
- 测试：`test/client-wiring.test.mjs` 新增 4 条 `snVerdict` 用例；`test/lifecycle-store.test.mjs` 新增「300 条里只取最近 5 条、且从尾部读」用例。
- 补丁：`patches/see-now-vivy-core.patch` 更新为 **51,832 字节 / 7 文件**。

## 没有改的（留作后续，不为凑数动手）

- **会话维度不存在**：会话页的「会话时间线」只是 start/stop 动作的别名，多次开始/多会话无法区分。要做真会话表就得落盘会话 id 与区间，属于新数据面，不在这次复审范围。
- **记录页固定 80 条**：没有分页/时间过滤。真按「记录」用的时候再说，先不造查询参数。
- **头部三个状态点没有「听声音」**：调试页已有全部四类状态，头部只挑采集/窗口/循环。
- **面板轮询频率不可配**：1.5 秒是硬编码；等有实测（白屏/卡顿）再谈。
