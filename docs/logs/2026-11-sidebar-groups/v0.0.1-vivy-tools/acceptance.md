# v0.0.1-vivy-tools 验收步骤

前置：本轮代码已落盘但**运行中的面板仍是旧脚本**（`index.js` 在进程启动时读 `sidebar-core.js` / `theme.css`）。以下全部需要重启。

## 一、重启

```bash
npm run stop
npm start
```

等面板打印 tokenised URL（端口不固定，看 `npm run status` 或日志里的 `dsh web: http://127.0.0.1:…`）。

## 二、端内（浏览器，硬刷新）

1. 侧边栏出现**两个**分区标题：`VIVY心核`（心形）在上、`VIVY工具`（三条滑轨）在下，位置在 `自动化任务` 之后、`更多` 之前。
2. `上下文洞察` 只出现在 `VIVY工具` 下面；`VIVY心核` 下面不再有它。
3. 点 `VIVY心核` → 只收起它自己的成员，`上下文洞察` 仍可见；再点一次恢复。
4. 点 `VIVY工具` → 只收起 `上下文洞察`；`VIVY心核` 保持当前状态。
5. 刷新页面 → 两个分区的开/合状态分别保持（DevTools → Application → Local Storage：`dsh.vivy.sidebar.core.v1` 与 `dsh.vivy.sidebar.tools.v1`）。
6. 把侧边栏收成窄栏（顶部折叠按钮）→ 两个分区标题都消失，成员只剩图标，行高 36px、缩进 0。
7. 打开 `上下文洞察` 面板本身 → 页面正常（分组只是给行换位置/加标记，不接管点击）。

失败判据：

- 只看到一个头 → 看控制台是否有脚本报错；再查 `aria-label` 是否仍是 `上下文洞察`（英文界面是 `Context Insights`）。
- `上下文洞察` 仍在 `VIVY心核` 下 → `TOOL` 正则没命中当前标签；把实际标签补进 `sidebar-core.js` 的 `TOOL`，不要去改 `dsh-context`。
- 两个头顺序颠倒或 `自动化任务` 跑到组后 → shell 的 `order` 变了，记录实际 `order` 再决定是调白名单还是接受。

## 三、活体脚本（可选，需 Playwright 可用）

```bash
PANEL_URL="http://127.0.0.1:3082/?token=…" node plugins/dsh-vivy-studio/verify-skin.mjs
```

预期：101 项全过，其中 `groups:` / `core:` / `tools:` 前缀的 25 项是本次新逻辑；截图与 `assertions.json` 写到 `$TMPDIR/diva-skin-verify`。

## 四、自动化测试

```bash
node tests/vivy-sidebar-core.test.mjs
node tests/vivy-skin-css.test.mjs
```

预期：8/8、9/9。全量 `npm test` 需在能 spawn 子进程的终端里跑（本会话沙箱不允许）。

## 五、本轮实际执行到哪

| 步骤 | 状态 |
| --- | --- |
| 代码落盘 | ✅ |
| 两个测试文件 | ✅ 8/8、9/9 |
| jsdom 行为检查 19 项 | ✅ 19/19 |
| 重启 | ⛔ 未做（本会话由该面板托管，停面板即终止本回合） |
| 端内 1–7 | ⛔ 未做 |
| `verify-skin.mjs` 101 项 | ⛔ 未做（Playwright 在本沙箱 spawn EPERM） |
