# OpenMuse UI 移植 + 小卡片资产化 · v0.2.0-port · 总结

- 目标：在「不接 A2UI」已定的前提下，判断 OpenMuse 的 UI 识别能不能移植、小卡片怎么资产化。
- 性质：只读调研 + 方案设计。未改代码/配置/依赖；新增 `docs/research/agent-ui-widgets-port.md` 与本日志目录，更新 `TODOLIST.md` 的 `DV-DOC-014`。
- 结论：
  1. **框架层没有要移植的**：`tool.call.toolview` keyed slot + generic 兜底与 OpenMuse 的 `useRenderTool` 同构；缺的是卡片集合、设计语言、屏幕上下文、选择闭环。
  2. **不能搬代码**：OpenMuse 是 RN（`View/Text/StyleSheet`），DSH 是 React DOM + CSS Modules + `--dsw-*`，且禁止组件库；视觉可搬、实现必须重写。
  3. **小卡片资产化 = 固定词汇表 + JSON 文档 + 内联快照 + storage 复用**；运行时下发组件代码与「构建期 client bundle」直接冲突，不做。
  4. **新卡点**：工具结果是模型可见的，widget 文档走工具结果会进上下文与 KV 缓存；建议文档限制 2–4KB，超限再上「只展示事件」。
  5. DSH Web **无 URL 路由**（源码里没有应用级路由，只有测试的 route mock）：所谓「新页面」= sidebar section + slot。
- 工作量：预制卡 + 内联文档 1–2 天；含资产保存/面板/编辑 3–5 天（单插件）。
- 交付：`docs/research/agent-ui-widgets-port.md`；`TODOLIST.md` `DV-DOC-014` 追加决策记录与 D7–D12。
- 未验证：OpenMuse 浏览器/桌面卡与 worker 的实时流对接、`ArtifactCard` 全家族、本 profile 是否已启用 `ctx.storageDomain`、新增展示事件对 session 格式/SDK 的影响、2–4KB 文档对 KV 缓存的实际影响。
- 下一步：用户补「以 Superagent 为聚焦主体的新页面」细节；同时拍 D7–D12（重点 D7 形态、D8 存储、D9 事件）。
