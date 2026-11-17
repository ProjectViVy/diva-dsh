# 验收 · v0.0.1-full-bleed-shell

前置：面板运行中；新开页面或硬刷新（客户端的 bundle 已重建，不需要重启进程）。打开侧边栏「VIVY心核 → SurfCore」。

| # | 操作 | 期望 |
| --- | --- | --- |
| A1 | 看整块面板 | SurfCore 从面板左边界铺到右边界、从顶部铺到底部：没有外留白、没有外边框/圆角/阴影，和记忆卡面板一样是「整块铺满」；内部自上而下是 头部 / 标签栏 / 内容 / 底部操作 四段 |
| A2 | 滚轮在面板上滚动 | **只有中间内容区滚动**；头部（标题 + QQ/B站/生物钟 三个状态点）、标签栏、底部按钮行全程不动 |
| A3 | 滚到底 | 页脚不再压住最后一行内容；浏览器只在内容区出现一根滚条，面板本身不滚 |
| B | 依次点 概览 / 目的 / QQ / B站 / Token 额度 / 观看历史 / 对齐 / 扩展 / 全部参数 / 诊断 | 每个页签的外框位置和尺寸完全不变，只有框内内容替换并各自滚动 |
| C | 把窗口缩到约 1024 宽 | 仍是铺满，不横向溢出；`.qbw-cols` 之类多列网格按上游规则折行 |
| D | 再缩到接近 760 宽（或把侧栏收起） | 头部 / 内容 / 页脚的左右内边距收紧到 14px，骨架与滚动行为不变 |

判据（可在 DevTools 里核对）：

1. `.surfcore-panel` 的 `scrollHeight === clientHeight`（面板外不滚）。
2. `.surfcore-panel .qbw-app` 的宽度等于 `.surfcore-panel` 的宽度，且 `border-width: 0`。
3. `.qbw-foot` 计算样式 `position: static`。
4. `.qbw-body` 计算样式 `overflow-y: auto`。

如需回滚：`git checkout -- scripts/lib/surfcore-panel.mjs docs/architecture.md`，重跑
`node -e "const m=await import('./scripts/lib/surfcore.mjs'); m.ensureSurfcoreAdapter(process.cwd(), undefined, { splitComponents: true })"`，再硬刷新。
