# 「日常」页面插件（dsh-daily）· v0.1.0-page · 总结

- 目标：做一个页面插件「日常」，在左栏是独立板块、位置在「插件」之上，只做 UI，视觉统一到 DIVA 核心设计元素。
- 性质：新增插件 + 三处接线。未改任何上游仓，未动 DSH 源码，未提交。
- 交付：
  1. `plugins/dsh-daily/` —— `package.json` / `cordis.patch.yml` / `index.js`（空宿主半身）/ `client.js`（全部界面，手写 ModuleLoader 包，无构建步骤）/ `README.md`。
  2. 接线：`plugin_manager install_bundle` 落进 profile（`link:` 依赖 + `bundles` 末位 + 软链）；`scripts/lib/component-setup.mjs` 的 `componentPackages()` 加一行，`npm run setup` 不再漏；`plugins/dsh-vivy-studio/sidebar-core.js` 的 `KEEP` 白名单加 `日常`（否则会被折进 `VIVY心核`，分组表头插到它上面、收起时它一起消失），`dsh-vivy-studio/README.md` 同步。
  3. 测试：`tests/daily-client.test.mjs`（8 项，无浏览器、无依赖）。
- 关键取舍：
  - **位置用 `order: -5`**：`相遇`(dsh-live2d) 在 -10、`插件` 在 0，-5 正好夹在中间。不进 `VIVY心核` 是硬要求，所以改的是那份 DOM 分组脚本的白名单，而不是给插件加语义。
  - **颜色两层兜底**：先读 shell 语义 token（`--dsw-alias-*`），再读皮肤暴露的 `--diva-*`（渐变/铅笔线/不齐圆角/墨影），两处都缺才落到写死的暖白与线色。换皮肤不变成死色，用 `diva` 时直接共享同一套渐变。
  - **纸面不自己刷**：面板底色透明，用 shell 在 `centerCol` 上画的水彩与纤维；页头只叠 5% 暖色渐隐。少一层重复纹理，也少一处和皮肤打架。
  - **渐变只当装饰**：宝石标记、选中态点缀、统计/进度填充；正文与标题保持墨色，主按钮是实心品牌色。
  - **不做数据**：样本写成常量，勾选与「记下一笔」只在组件 state 里。要接真数据时替换的是数据段，不是结构。
- 未验证：真 Chrome 里的像素（面板地址要带 `?token=`，本轮拿不到；jsdom 结构检查全过，像素待补一张截图）。
- 下一步：用户刷新页面 → 左栏「插件」上方应出现「日常」→ 点开对照 `acceptance.md`。
