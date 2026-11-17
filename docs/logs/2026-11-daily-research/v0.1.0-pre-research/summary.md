# 日常页 v0.2 预研 · v0.1.0-pre-research · 总结

- 目标（用户 2026-11-14 17:44）：① 商讨「卡片定义形式」，让 agent 能自己创作卡片、显示任何内容，候选 OpenClaw 同款 / A2UI；② 日常页聊天区未来接 Superagent，且不得出现代码块与工具杂项；③ 记录页面分块（Today / 任务 / 悄悄话）；④ 只调研、不改代码。
- 性质：只读预研。零代码/配置/依赖改动；只写 `docs/` 与本目录与 `TODOLIST.md`。
- 交付：
  - `docs/research/agent-ui-card-spec.md`（卡片定义形式：A2UI / OpenClaw HTML / 内容块 三案对比 + 13 块词汇表 + CardDoc schema + E1–E8 决策）
  - `docs/research/daily-page-integration.md`（Superagent 成果面、聊天区 A/B/C 三条路线、三块数据来源、能力盘点、F1–F6 决策）
- 核心结论：
  1. **卡片走「内容块词汇表」**：13 种内容形态（text/list/kv/table/metrics/progress/steps/timeline/chart/image/links/quote/actions），布局由宿主统一；A2UI 过度设计（模型要懂布局、DSH 三档全无），OpenClaw 的 HTML 画布只留受控逃生舱。
  2. **先例已存在**：本机 `openhanako` 的「工具 → 服务端投影出 ContentBlock → 客户端块注册表」三段式跑通了同一思路，并用 `show_card` + 16 条 CSP 做了受控 HTML 通道——证明块流水线与逃生舱可共存。
  3. **聊天区不重造聊天**：Superagent 对外只有四类消息（acknowledgement / answer / result / attention，走 Outbox），执行细节不在这条流上；日常页只订阅这个人话面即可，工具噪声结构上进不来。路线 A（只读面板 API，1–2 天）→ B（自建 `target: 'daily'` 的 Definition + 自定义 View，3–5 天）→ C（给 Superagent 加 `daily` Source，5–8 天，先不做）。已核实：发一句话走 `ctx.sessions.scope(id).conversation.send(text)`；「助手文本」不是独立事件而是 `assistant/message` 里的 `kind: 'text'` 块，必须按块过滤。
  4. **页面三块**：Today ← schedule 简报 + attention + 资讯卡；任务 ← Superagent tickets + todo/goal；悄悄话 ← 暂缓，等《心流》自主能力与《野兔》情绪系统。
  5. **能力接入**：schedule / todo / goal / mempalace / see-now / voice 都已就位；缺资讯源（用 agent + web 工具在定时任务里抓，不引第三方）；`dsh-plugin.org` 本轮不可达，插件生态**未核实**；PEN/PENS 是外设总线，与「显示什么」正交。
  6. **修订（18:20，代理关闭、网络恢复）**：`dsh-plugin.org` 可达后补查到现成实现——`dsh-genui`（fence 内白名单 JSON，30+ 组件、动作回流、同轮纠错、支持 `0.2.1-rc.5`）、`dsh-visualize`（沙箱 HTML 卡，无动作回流）、`dsh-better-sidebar`（`ctx.betterSidebar.registerTab` 页面承载）、`dsh-taskboard`（看板）、`dsh-bili-scroll`（资讯日报范本）。E1 因此从「自研哪种」变成「复用哪个 + 自研哪一层」，新增 E9/E10；**页面三栏本身仍无现成物**。
- 未验证：`dsh-plugin.org` 只看到三类首页各 12 条 + 6 个详情页（站点搜索/筛选/分页是前端 JS，无法全站检索；`dshTarget` 未渲染；所有插件均未安装实测）；三个参考仓只读源码未运行；官方语义上的「只读 attach」开关；Superagent 面板 API 在 GUI 同源下的实测；业务插件长期依赖 `SessionBinding.eventSource` 是否被允许。
- 下一步：用户拍 E1–E10 与 F1–F6（`TODOLIST.md` 的 `DV-DOC-016`）；拍板后另开实施条目。
