# 验证

## 已验证

- `node tests/daily-client.test.mjs`：12 tests / 12 pass / 0 fail（图标改动不涉注册元数据，仍是原 12 项）。
- `node --check plugins/dsh-daily/client.js`：退出 0。
- 真像素：`.artifacts/dsh-daily-check/icon-sheet.mjs` 用真 React 18 + 真 `client.js` + headless Chrome 渲染同一组件，输出 `icon-sheet.png`。16px / 18px / 32px、整行未选中 / 选中态下都能读成「带把手、冒热气的咖啡杯」，与「日常」二字同一基线，视觉重量与相邻扳手一致。

## 未验证与限制

- 活 GUI 未截屏：`http://127.0.0.1:3082` 的面板地址带 `?token=`，本会话取不到；离线那一张与真实渲染共用 `client.js` 与 `document` 布局，但宿主 CSS Module 的 `.panelRow/.panelGlyph` 只做了等价复刻（gap 8、16/18px 槽位），像素级对比未做。
- 深色主题下的对比度：离线图里暗底那一格被测试页自己的 `color` 覆盖盖成黑块，没测出来；图标用 `currentColor`，随主题走，但没有截图证据。
- `node --test tests/daily-client.test.mjs`（带 `--test`）在本沙箱下会被拒：runner 起子进程要命名管道，报 `spawn EPERM`。改用直接执行测试文件（Node 24 在进程内跑），结论相同。
- headless Chrome 需要 `--remote-debugging-pipe`，同一条命令在 workspace-write 下 `spawn EPERM`，已按沙箱规则一次性提权执行；提权只用于截图，没有别的文件操作。
