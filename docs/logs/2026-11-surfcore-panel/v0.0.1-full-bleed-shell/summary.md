# v0.0.1-full-bleed-shell SurfCore 面板铺满 + 四段固定骨架

- 状态：doing（代码与 bundle 已落地，等在真实窗口硬刷新复核观感）
- 范围：`scripts/lib/surfcore-panel.mjs`、`docs/architecture.md`（§15.1）
- 验证：见 `verification.md`（生成器 `node --check` 通过；`tests/surfcore-integration.test.mjs` 21/25，4 条既有失败与本次无关；活体量到「铺满面板 + 只有内容区滚动 + 页脚 static」）
- 未验证：深色主题与大字号观感；非 split（设置页 `settings.section`）模式不走这条外壳
- 回滚：`git checkout -- scripts/lib/surfcore-panel.mjs docs/architecture.md`，再跑一次 `ensureSurfcoreAdapter` 重建 bundle（`.artifacts/surfcore-adapter/bundle/surfcore-panel.client.js`）

## 问题

`SurfCore` 面板原先是一张「浮在滚动页面里的卡片」：`.surfcore-panel` 自己 `overflow:auto` 并从 28px 起给它留白，卡片 `.qbw-app` 又被放宽到 1200px，而卡片内的 `.qbw-body` 还有一条 `max-height:min(68vh,760px)` 的独立滚动条，`.qbw-foot` 用 `position:sticky` 贴在视口底部。结果是：头部和标签栏跟着整页滚走、内容和页脚之间出现第二条滚动条、页脚压在内容上；和记忆卡（`.mp-*`）、记忆宫殿（`.mz-*`）那种「一个整高面板 + 头 / 标签 / 内容 / 操作四段」的骨架不一致。

## 改了什么

1. **外壳铺满面板**：`.surfcore-panel` 变成 `display:flex; height:100%; overflow:hidden`，不再有外留白；`.qbw-app` 用 `flex:1; width:100%; max-width:none` 填满，**去掉居中卡片**——没有外边框、圆角与阴影，背景回到 `--dsw-alias-bg-base`。
2. **四段骨架固定**：`.qbw-head` 与 `.qbw-tabs` `flex:none`；`.qbw-body` `flex:1; min-height:0; max-height:none; overflow:auto`，成为唯一的滚动区；`.qbw-foot` 由 `position:sticky` 改成 `static` 的 `flex:none` 页脚。面板外不再有第二条滚动条。
3. **窄屏**：`≤760px` 只收紧头 / 内容 / 页脚的左右内边距与标签栏内边距，骨架不变。
4. **样式只作用于面板实例**：全部选择器加了 `.surfcore-panel` 前缀，钉住的上游 `client.js` 未改一行；非 split 模式的设置页 section 仍是原来的卡片。

## 迭代记录

第一版按「屏幕中间一个内置框」做（`max-width:1120px` + 边框/圆角/阴影 + 14px 外留白），用户看过后要求内部 SurfCore **占满**而不是居中内框，因此改为铺满方案；居中版样式未保留，`panelShellCss` 只有当前这一份。居中版的样子留在截图 `.artifacts/surfcore-panel/centered-frame.png` 供对照。

## 影响面

- 用户可见：SurfCore 面板从标题栏到操作栏铺满整个面板区，头部/标签栏/操作栏不再随内容滚动，页脚不再盖住内容。
- 代码面：`scripts/lib/surfcore-panel.mjs` 的 `panelEntry` 拆出一个 `panelShellCss` 常量（约 +16 行），生成的客户端 CSS 由 4 条规则变为 8 条；无新依赖、无行为改动、无接口改动。
- 生效方式：`.artifacts/surfcore-adapter/bundle/surfcore-panel.client.js` 是生成物，重建后新开/硬刷新页面即拿到新外壳；实测不需要重启进程。
