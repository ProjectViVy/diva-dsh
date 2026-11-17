# Agent UI 协议调研 · v0.1.0-survey · 总结

- 目标：回答三个问题——A2UI 是什么、DSH 现在支不支持、值不值得接。
- 性质：只读调研。未安装 `@a2ui/*`、未改代码/配置/依赖；仅新建 `docs/research/` 与本日志目录、登记 `TODOLIST.md`。
- 结论：**A2UI 是真协议，但不是 DSH 现在该接的东西。** DSH `0.2.1-rc.5` 零 A2UI 支持（全仓零命中、无依赖、无声明式 UI 通道），L1/L2/L3 三档全无。
- 关键证据：
  - A2UI v1.0（2026-11-11，Google 2025-12-15 开源）：协议 + agent/renderer 三层 SDK，catalog 约束，`createSurface`/`updateComponents`/`updateDataModel`/`action`。
  - OpenClaw 2025-12-17 接入（开源后第 2 天）、停在 0.8、**2026-10-23 整套退役**（BREAKING，保留 HTML + 原生 widget + MCP Apps）。
  - ChatGPT / OpenAI 无接入证据；官方名单里的托管方是 Gemini 与 Claude（经 MCP Apps）。
  - CopilotKit 自家 OpenMuse 不用 A2UI：Expo + RN 手写 12 个原语 + 按工具名硬编码卡片 + Jev 决策模型。
- 推荐：B（受控卡片 schema）起步，C（MCP Apps）作为战略选项，D（自建 A2UI 插件）不做。
- 交付：`docs/research/agent-ui-protocols.md`；`TODOLIST.md` 新增 `DV-DOC-014`（L0 决策闸门，等待 D1–D6）。
- 未验证：OpenClaw 退役动机、OpenClaw 是否上过 0.9/1.0、ChatGPT 对 MCP Apps 的支持状态、DSH 客户端插件的动态加载链路、A2UI TS SDK 对本仓的兼容性、A2UI 真实渲染性能。
- 下一步：用户拍 D1–D6；若选 B，按报告 §3-B 出插件方案，先做「现在只能用文字回答」的场景。
