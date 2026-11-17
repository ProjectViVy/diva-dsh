# 验收 v0.7.0-genui-install

1. **看装没装对**：在仓库根执行 `node scripts/setup-third-party.mjs --check`，末行应是「All third-party plugins are pinned, built and registered.」，且 genui 一节显示 `pin v0.16.0` / `declares engines.dsh`。
2. **看面板里有没有**：
   - 不重启：在面板的任意会话里发一句「用 `dsh-ui` 围栏画一张卡片」，刷新页面后应渲成卡片（不是代码块）。刷新后浏览器 console 有 `[genui] client active; fence-channel=dom`。
   - 若刷新后仍是代码块：说明这份 profile 的 bundle 没注册上，跑 `npm run setup:third-party`（需要面板停着）再试。
3. **看自由 html 停了**：重启面板后，左栏发一条带 ```html 围栏的回复，应显示为一段代码文字、**不出现沙箱框**；右栏 Today 标题条写「今天的界面 · 自由 HTML 通道已停用」，任务页空态不变。
4. **恢复自由 html**：`plugins/dsh-daily/client.js` 的 `const FREE_HTML_UI = false` 改回 `true` → 重启面板 → 围栏又渲成框；`node --test tests/daily-client.test.mjs` 应回到 39 项全跑（4 条 skip 消失）。
5. **卸载 genui（如果需要）**：`dsh plugin --profile superagent-local remove @changfenhuang/dsh-genui`，然后刷新页面；submodule 与 `third-party/pins.json` 的条目都还在，随时可以再注册。
