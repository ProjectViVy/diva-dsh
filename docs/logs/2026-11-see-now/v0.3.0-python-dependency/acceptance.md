# 「我看到了」Python 依赖核实 · v0.3.0-python-dependency · 验收

目标：用一次真实运行确认「核心看不需要 Python、窗/听声才需要」，而不是只信文件级证据。

前置：`npm run restart`，等 `npm run status` 的 `runtime` 为 `ready`，硬刷新 Web GUI。

1. **工具在**：新会话 `/seenow` 或工具列表能看到 `see_now`；`see_now({action:"status"})` 不报 error。
   - 看 `窗口：` 行：`显示中` = 窗活着；`被 DSH_SEE_NO_WINDOW=1 关掉了` / `找不到 window.py` / `缺 Python 包` = 对应分支。
   - 看 `听声音：` 行：`没在听（…要 pip install pyaudiowpatch numpy）` = 本机现状（预期）。
2. **不装 Python 也能看**：设置 `DSH_SEE_NO_WINDOW=1` 后 `npm run restart`，`see_now({action:"watch"})` 仍要出图并在结果里被模型描述；任务管理器里不该出现 `pythonw.exe`。
   - 反证：去掉该变量再 watch，`pythonw.exe` 应被拉起（窗出现）；若没有，记录 `窗口：` 的 reason（tkinter/缺包/PATH），不要猜。
3. **取框**：`see_now({action:"region"})` → 屏幕变暗可拖框 → `~\.dsh\see-now\region.json` 或 `$DSH_HOME` 对应文件落盘；失败时 reason 应为 `no-python` / `no-script` / `cancelled`，不得静默。
4. **听声（可选）**：`pip install pyaudiowpatch` 后用 `see_now({action:"status"})` 确认 `听声音` 不再是「没在听」；放一段有声视频，看结果里是否出现 `台词` 段。不装则应保持清晰降级文案。

通过标准：第 1、2 条成立即可确认「Python 不是核心链路依赖」；第 3、4 条只影响对应动作。
失败时先看 `~\.dsh\see-now\plugin-error.log` 与 `~\.dsh\see-now-window.log`（DSH_HOME 优先）。
