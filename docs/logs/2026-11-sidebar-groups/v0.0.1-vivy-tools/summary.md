# v0.0.1-vivy-tools 上下文洞察移入新分区 VIVY工具

- 状态：done（**待重启验收**）
- 范围：`plugins/dsh-vivy-studio/sidebar-core.js`、`theme.css`、`README.md`、`verify-skin.mjs`；`tests/vivy-sidebar-core.test.mjs`、`tests/vivy-skin-css.test.mjs`
- 验证：见 `verification.md`（两个测试文件 8/9 全过 + jsdom 行为检查 19/19）
- 未验证：端内真实渲染（运行中实例仍是旧脚本，需重启）；`verify-skin.mjs` 的 101 项活体检查未跑
- 回滚：`git checkout -- plugins/dsh-vivy-studio/{sidebar-core.js,theme.css,README.md,verify-skin.mjs} tests/vivy-*`（面板重启后恢复旧分组）

## 改了什么

1. **分组从「一个」变成「一张表」**。`sidebar-core.js` 原来把「除 `插件`/`自动化任务`/`相遇`/`更多` 以外的所有面板」都折进唯一的 `VIVY心核`；现在由 `GROUPS` 描述两个组：
   - `core` → `VIVY心核`，成员 = 除常驻行与工具行之外的全部面板行；
   - `tools` → `VIVY工具`，成员 = 按 `aria-label` 命中的工具行（当前只有 `上下文洞察` / `Context Insights`）。
   判定仍读每一行的 `aria-label`，不认位置、不认数量：安装或取消固定哪些面板，分组自己跟上。
2. **每个组一套状态**：各自的头标（`data-diva-head="core|tools"`）、各自的 `localStorage` 键（`dsh.vivy.sidebar.core.v1` / `dsh.vivy.sidebar.tools.v1`，前者沿用旧键）、各自的 nav 属性（`data-diva-core` / `data-diva-tools`）。收起一个不影响另一个。
3. **位置**：`VIVY工具` 头插在 `上下文洞察` 前面，落点因此在 `VIVY心核` 下方、`更多` 上方；`自动化任务` 等常驻行仍被拉回**第一个**头之前（原来只有一个头，现在锚点固定为第一个）。
4. **空组自动消失**：某个组没有成员时（插件被移除、面板被取消固定），头、`aria-expanded` 与 nav 属性一起撤掉，不会留下一个「点开是空的」分区。
5. **视觉**：`工具` 组用三条滑轨带旋钮的图形（`.diva-tools-glyph`）替代心形，其余几何（36px 行、7/8px 内边距、16px 字形、22px 成员缩进、chevron 在右缘）与 `心核` 完全一致；收起规则拆成两条（`data-diva-core` / `data-diva-tools` 各管自己的成员）。窄栏（rail）里两个头一起隐藏，成员保留 shell 自己的 36px 几何。

## 影响面

- 用户可见：侧边栏多一个 `VIVY工具` 分区，`上下文洞察` 从 `VIVY心核` 移到它下面；两个分区可独立折叠，折叠状态跨刷新保留。
- 代码面：`sidebar-core.js` 由单组改成组表（约 +90 行、-20 行），`theme.css` 加一个字形类与一条独立收起规则，未引入任何依赖。
- 加载方式不变：仍是 `webServer.tapIndex` 注入的一段脚本，React 树不补丁。
- 重启要求：**是**。`index.js` 在进程启动时读 `sidebar-core.js`/`theme.css` 并缓存在内存里，改文件不会热更。

## 未验证

1. **端内真实渲染**：本会话由运行中的面板托管，停面板即终止本回合，所以没有重启、没有实际看到两个分区。
2. **`verify-skin.mjs`**：已按两组改写（101 项），但 Playwright 在本沙箱 `spawn EPERM`（`--remote-debugging-pipe` 需要命名管道），且运行中的页面仍是旧脚本——即便能起浏览器也只能验旧代码。
3. **全量 `npm test`**：`node --test` 会为每个测试文件 spawn 子进程，同样被沙箱拒绝；两个改动直接相关的测试文件用 `node tests/<file>` 单进程跑通。
4. 英文界面下 `Context Insights` 的匹配只做了源码级确认（`i18nEn.ts` 的 `ov.title`），没有真机切换语言验证。

## 备注

- 按 `AGENTS.md` §6 **未提交**。
- 一次性行为验证脚本在 `.artifacts/group-dom-check.mjs`（本地缓存，不入库）；它用 jsdom（取自 DSH 检出内的 pnpm store）跑真实的 `sidebar-core.js` + `theme.css`，不依赖浏览器。
- 分组判定按标签而不是按插件 id：`dsh-context` 的面板 id 是 `dsh-context`，但 shell 的 DOM 只暴露 `aria-label`，读标签是既有做法，也避免在皮肤插件里硬编码别的插件的 id。
