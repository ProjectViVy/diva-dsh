# 验收 · v0.1.2

前置：`npm run stop` → `npm start`（插件与 DSH 都是常驻进程，改代码必须重启），然后硬刷新设置页。

1. **分区还在**：设置页出现「世界网关」，五张卡，页面里没有 `[data-slot-error]`。
2. **候选有内容**：`asr` 卡的「从 N 个候选填入…」不再是 0；展开后能看到 `百炼 · 语音识别 3.1（Flash）` 与 `Paraformer v2`。
3. **换接入点换候选**：把 `asr` 的接入点改成「硅基流动」，下拉里应出现 `SenseVoice Small`。
4. **选中即写入**：选一项后模型输入框里出现对应 id，点保存后重启仍在。
5. **手填不被挡**：删掉模型名手打一个不存在的 id，仍能保存（候选只是提示，不做校验）。
6. **Token Plan 如实说**：`decision` 卡的候选里只有预制的一条 `decision-model-preview`；没有「刷新」按钮，符合本轮范围。

判定：1–5 全过即通过；第 2 步若为空，先确认 `/api/catalog` 返回 `ok:true` 且 `models.asr.dashscope` 非空。
