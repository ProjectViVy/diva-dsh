# v0.3.0 右栏改成 Today / 任务 / 悄悄话 三页

- 状态：已交付（浏览器半边，刷新即生效，**不用重启**）
- 范围：`plugins/dsh-daily/client.js`、`tests/daily-client.test.mjs`
- 验证：`node --test tests/daily-client.test.mjs` 26/26；`node .artifacts/dsh-daily-check/render3.mjs` ALL PASS；真 Chrome 三张截图（`new-today.png` / `new-tasks.png` / `new-whisper.png`）无页面错误
- 未验证：真宿主 3082 里的点击手感（本轮没重启；不过这是 client 半边，硬刷新就生效）
- 下一步：`docs/logs/2026-11-daily/v0.2.0-chat-and-cards/acceptance.md` 那条重启验收照旧
- 回滚：`git checkout --` 不适用（插件未被根仓库跟踪）；回滚靠把四个改动倒回去——删 `WHISPER_CARDS` / `WhisperView`、恢复 `MEMORY` / `SKILLS` 常量与两个 View、`TABS` 回到四页。备份前的版本见 `.artifacts/dsh-daily-backup/`（更早的 genui 备份）。

## 改了什么

1. **右栏从四页改回主人的三块**：`Today` / `任务` / `悄悄话`。四页（Today / 任务 / 记忆 / 能力）本来就是照搬 OpenToday 原型，不是主人的分块方案（`docs/research/daily-page-integration.md` 顶部有原话与出处）。
2. **悄悄话页是占位**：一张卡说清两件事——以后放什么（你没问但她注意到的、以及她想改的地方）、为什么现在不做（等《心流》自主能力系统与《野兔》情绪系统）。页脚一行「占位 · 暂无数据源，不接任何接口」。**没有任何控件**，不装假交互。
3. **删掉记忆页与能力页**：两张页的常量（`MEMORY` / `SKILLS`）与两个 View（`MemoryView` / `SkillsView`）、`skillCards` / `memoryCards` 全部删除；`DailyPage` 里那三个开关的 state 与 `switch` handler 一并删掉，只剩任务页的 `taskFilter`。文件从 1815 行降到 1640 行（-175：删掉记忆/能力两页约 150 行，加上悄悄话占位约 15 行，TASKS 原样保留）。
4. 同步更新文件头注释、分块说明注释与测试标题（四页 → 三页）。

## 影响面

- 用户可见：右栏页签从 4 个变 3 个；记忆与能力的入口消失（按主人要求）。
- 数据：无。右栏仍是静态 demo，刷新回样本。
- 依赖方：无。genui 渲染器与 `DAILY_CARDS` / `TASKS` 原样保留。
- 重启要求：**无**（client 半边，硬刷新页面即可）。

## 未验证

- 真宿主里的手感没点过：本轮没有停服务，只用离线页面（真 Chrome + 真 React + 真 CSS）截图。等下次硬刷新 3082 时顺手确认页签与占位页。
- 窄窗（<900px）下三页签的换行表现没重测；四页时测过，去掉一页只会更宽，风险低但没有取证。

## 备注

- 取舍：悄悄话没有做任何「示例内容」。原因是它一旦有示例条目，看起来就像已经实现了，而它缺的不是数据源是主体性——宁可空着也不要假数据。这跟 Today 页那两张卡不同：那两张带「示例」角标和脚注，读者一眼就知道是排版演示；悄悄话做示例没有对应的诚实标注方式。
- 备选：把悄悄话做成「不可点」的灰页签（更省事）。没选，因为灰页签说不出「等什么才做」，而这句话是你 11-14 定下的边界。
