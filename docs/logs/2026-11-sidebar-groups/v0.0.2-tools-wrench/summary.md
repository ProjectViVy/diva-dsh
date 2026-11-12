# v0.0.2-tools-wrench-glyph `VIVY工具` 的分组标记换成扳手

- 状态：done（**待重启验收**）
- 范围：`plugins/dsh-vivy-studio/sidebar-core.js`、`plugins/dsh-vivy-studio/README.md`
- 验证：见 `verification.md`（插件两个测试文件 8/8 + 9/9；jsdom 行为 19/19；新字形 markup 8/8）
- 未验证：端内真实像素（运行中实例仍在内存里缓存旧 `sidebar-core.js`，需重启；`verify-skin.mjs` 的活体检查与截图在本沙箱 `spawn EPERM`，跑不了）
- 回滚：`git checkout -- plugins/dsh-vivy-studio/sidebar-core.js plugins/dsh-vivy-studio/README.md`（面板重启后回到滑轨图形）

## 改了什么

1. **`VIVY工具` 的分组标记换成开口扳手**。`GROUPS` 里 `tools` 的 `glyph` 由 `sliders` 改为 `wrench`；`glyphOf()` 相应调用 `wrench()`。心形（`VIVY心核`）与 chevron（展开箭头）不变。
2. **`icon()` 多一个可选的 `viewBox`**（默认 `0 0 16 16`），因为扳手直接使用 Lucide 的 **24 单位**绘制网格：路径里的弧半径（1 / 6 / 2.12）和端点都是按 24 网格画的，原样保留、交给 `viewBox` 缩放，比手算 ×2/3 后重写弧参数更不容易画歪。屏幕上的盒子仍是样式表给的 16px，所以与上下行图标对齐不受影响。
3. **描边权重**：24 网格下 `stroke-width="2"`，落到 16px 是 1.33px，与心形 / chevron 的 1.5px 同一量级（`fill:none`、`stroke:currentColor`、圆头圆角沿用 `icon()` 的既有做法）。
4. **类名不动**：仍是 `.diva-tools-glyph`。`theme.css` 的 16px 尺寸规则、`verify-skin.mjs` 的 16px / 8px 间距断言、`tests/vivy-sidebar-core.test.mjs` 对 `"diva-tools-glyph"` 的断言全部照旧成立。
5. **README 同步**：把「`工具` 是三根滑轨带旋钮」改成「`工具` 是开口扳手」。

## 影响面

- 用户可见：侧边栏 `VIVY工具` 分组头左侧的字形由三条滑轨变成一个开口扳手，其余几何（36px 行高、8px 左内边距、16px 字形、chevron 贴右缘）不变。
- 代码面：`sidebar-core.js` 约 +6 / −3 行；无新依赖、无样式改动、无行为改动。
- 加载方式不变：仍是 `webServer.tapIndex` 注入的脚本，React 树不补丁。
- 重启要求：**是**。`index.js` 在进程启动时读 `sidebar-core.js` / `theme.css` 并缓存进内存，改文件不热更。
