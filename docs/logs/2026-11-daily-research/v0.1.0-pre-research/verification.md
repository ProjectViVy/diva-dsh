# 日常页 v0.2 预研 · v0.1.0-pre-research · 验证记录

只记录本轮实际读过的位置与跑过的检查；外部访问日期 2026-11-14。

## V1 外部网络（失败，记录原因）

| 目标 | 结果 |
| --- | --- |
| `https://dsh-plugin.org/`、`/robots.txt`、`/sitemap.xml`（http/https） | `Error: URL hostname "dsh-plugin.org" resolves to a non-public IP address` |
| `https://a2ui.org/` | 同上 |
| `https://api.github.com/repos/openclaw/openclaw/contents/docs` | 同上 |
| `https://raw.githubusercontent.com/openclaw/openclaw/main/package.json` | 同上 |
| 诊断（子代理只读） | `dsh-plugin.org` → 198.18.0.55、`www` → 198.18.0.57（RFC 2544 保留段，TTL=1）；TCP 可连本机代理但 TLS 握手失败；`curl.exe` 被沙箱拦 |

**结论**：外部网络整体不可用，本轮任何外部事实只能沿用 2026-11-13 同会话已抓取并留痕的内容（A2UI、OpenClaw 退役提交、OpenMuse 源码），报告中已逐条标注。

## V2 本仓与上游证据（只读）

| 位置 | 取证 |
| --- | --- |
| `superagent/docs/000-philosophy.md:5,12,33` | 「尽量少占注意力」；「只在你必须行动或能用上结果时说话；干活时保持安静」；「该帮忙的时候帮，其他时候不打扰」 |
| `superagent/docs/007-architecture.md` | `Replies` 经 `Outbox` 发四类消息：acknowledgement / answer / result / attention；`worker_report` ≤600 字符、`worker_attention` 带 Ticket 卡 |
| `superagent/docs/005-panel.md:9,57` | 面板第一问「现在有没有事需要我」；「Quiet by default」 |
| `superagent/src/app/http.ts:231–247` | `/orchestrator/api/*`，要求 loopback + 同源 + `x-orchestrator-request: 1`；路由含 `overview`/`tickets`/`tickets/:id`/`threads`/`decisions`/`ticket/<id>/transcript` |
| `superagent/docs/008-cookbook.md` | 新增 Source 是受支持的扩展点（四责任 + 照 `src/sources/github.ts`） |
| `deepseek-harness/docs/subsystems/conversation.md` | View Definition / 第三方 View 参与同一套选择与激活；「another consumer activates a target through its first source subscription」 |
| `deepseek-harness/packages/client/ui-conversation/README.md` | `ctx.uiConversation` 提供 events/views 注册表与 `UiConversation.binding(sessionId)` |
| `deepseek-harness/packages/client/ui-tool/README.md` | `tool.call.toolview` 按 wire tool name 注册、未注册走 generic |
| `deepseek-harness/packages/schedule/README.md` | 到期的提醒以普通 follow-up 消息进入原会话 |
| `deepseek-harness/packages/todo/README.md` | `todo_write` 会话级清单，组内无 UI |
| `plugins/dsh-daily/client.js:81–130` | 现有样本常量的形状（planCard/taskCard/confirm/mail）即未来的卡槽 |

## V3 三个本地参考项目（子代理只读）

| 项目 | 卡片形式 | 噪声处理 | 关键证据 |
| --- | --- | --- | --- |
| openmuse | 工具名 → 组件一对一路由（11 个 `useRenderTool`） | 工具消息不进流（只渲染 user/assistant）；代码块降级纯文本 | `apps/mobile/src/chat.tsx:61–147,486`、`assistant-response.tsx:20–38` |
| OpenDots | 工具名/通配前缀路由；`useRenderTool({name:'*'})` 未命中返回 `null` | 默认隐形 + visible 过滤 + 只给最新一条活体画面 | `src/client/Chat.tsx:193–246,247–260` |
| openhanako | **三段式**：工具 → 服务端 `BLOCK_EXTRACTORS` → `ContentBlock` → 客户端 `BLOCK_RENDERERS`；另有 `show_card` HTML（iframe+CSP）与 `hana_card_guide` 设计手册 | 单一 `CARD_BACKED_TOOL_NAMES` 谓词 + 工具组折叠 + turn 级过程折叠 | `server/block-extractors.ts:15,421`、`chat-types.ts:227–292`、`block-renderers.ts:11–15`、`cards.ts:22–39`、`tool-call-visibility.ts:5–36`、`process-fold.ts:200–257` |

子代理未运行任何项目、未读 `node_modules`，以上均为源码级结论。

## V4 会话渲染与噪声过滤（子代理只读，DSH 上游）

| 主题 | 证据 |
| --- | --- |
| 事件 discriminator | `turn/start|end`、`step/start|end`、`user/message`、`assistant/message`、`tool/call`、`tool/result` 等（`packages/core/session/src/types.ts:289–428`） |
| 「助手文本/推理/工具调用」是一件事 | 都是 `assistant/message` 的 content blocks，`kind: 'text' | 'reasoning' | 'tool-call'`（`ui-chat/.../assistant.ts:59–63`） |
| 只订阅部分事件 | `events.register({ target, match: {...} })`，注册表把 match 编译成按类型的路由（`event-registry.ts:74–116`） |
| 节点不可删 | 只能返回同 key 的 `visibility: 'hidden'`（`assembler.ts:986–998`） |
| 全局 fallback 单例 | 已被 ui-chat 占用（`event-registry.ts:39–43`、`fallback.ts:40`） |
| 流式瞬态 | `assistant/live-chunk` 由 `settle-assistant` 整批替换；发布有 3 帧 rAF 合并（`contract/events.ts:98–106`、`assembly.ts:141–158`） |
| 官方嵌入样板 | `sessions.retain` → `SessionProvider` → `renderFactorySlot('conversation.content', {variant:'embedded'})`（`ui-subagent/src/client/sidebar-chat/index.tsx:109,145–165`） |
| 发一句话 | `ctx.sessions.scope(id).conversation.send(text)`（`ui-conversation/src/client/service.ts:53`，未带 scope 报错文案在 :40 附近） |
| 两个可编辑 root | DSH 不支持同一 Session 同时挂两个；草稿在持久化 per-session store（`contract/views.ts:19–25`；本仓结论 `docs/research/encounter-chat-and-session.md:18,194`） |

## V5 补查：`dsh-plugin.org`（18:20 代理关闭后恢复可达）

| 目标 | 结果 |
| --- | --- |
| `https://dsh-plugin.org/`、`/interface`、`/tools`、`/integration` | HTTP 200；分类规模 UI 3622 / Sessions 1923 / Memory 723 / Tools 8843 / Agents 1263 / Workflow 692 / Integrations 1471 / Models 2501 / Dev 2007 / Knowledge 930 / Fun 706，合计 24681 |
| 详情页 `/plugins/omdsh-dev/dsh-genui`、`/plugins/nagi-ovo/dsh-visualize` | HTTP 200；一手来源改用各自 GitHub README（`raw.githubusercontent.com` 可取） |
| 检索能力 | **不可用**：`?q=`、`?category=`、`?page=` 均不在服务端过滤（与基线逐字相同），每类只 SSR 前 12 条；`api.dsh-plugin.org` 的 JSON 端点报 `unsupported content type` |
| `dshTarget` | 抓到的 4 个详情页均未渲染该字段；站点自称 confirmed 24681 / unverified 0，徽章无区分度 |

关键发现：`dsh-genui`（MIT，974★，v0.16.0，2026-11-11）支持 `^0.2.0-rc.1 || ^0.2.1-rc.1 || ^0.2.2-alpha.2`，并明列 `check:host-api dsh-v0.2.1-rc.5`；`dsh-visualize`（BSD-3，343★）README 明写「卡片内按钮目前不能向主对话发消息」；`dsh-better-sidebar`（5092★，v0.30.1）暴露 `ctx.betterSidebar.registerTab`，0.1.7 线须钉 `0.22.1`（caret 跨 minor 在 0.2.0 宿主会被启动兼容预检静默禁用）；`dsh-taskboard`（327★）、`dsh-automation`（103★）、`dsh-bili-scroll`（1376★）分别对应看板、调度、资讯日报。

## V6 本轮没做

- 没有启动 GUI / Superagent，没有实测 `/orchestrator/api/*` 的同源调用。
- 没有跑任何测试（沙箱拒绝外部进程的命名管道：`node.exe` / `git.exe` 均报 `\\.\pipe\LOCAL\dotnet_*` denied）。
- 没有安装或升级任何依赖；`plugins/dsh-daily` 未改一行。
