# 发布说明 — v0.1.0（AutoDream 原生会话）

## 交付物

| 文件 | 性质 |
| --- | --- |
| `plugins/dsh-evolution/src/dream-session.mjs` | 新增：按上游 webhook 五步自建 Dream 会话（解析 preset → 建 workspace → create + setup → 只读权限 + 命名 → 下发首条消息），失败回滚 |
| `plugins/dsh-evolution/src/dream.mjs` | 重写：删 `api()`/Input 投递/Ticket 授权；请求含 `sessionId`/`agentSessionId`/`deadlineAt`；`maintain()` 处理 2 小时超时；新增 15 分钟定时检查 |
| `plugins/dsh-evolution/src/dream-tool.mjs` | 重写：`dreamToolDefinition(dream)` 纯工厂，按会话作用域注册；会话 id 取 `execution.agent.id` |
| `plugins/dsh-evolution/src/index.mjs` | 修改：inject 增加 `agents`/`agentPresets`/`permissionPresets`/`sessionTitle`/`agentDefaultModel`，去掉 `tools`；接线 launcher；启动调度 |
| `plugins/dsh-evolution/src/client.js` | 修改：面板文案（会话 / 请求与运行 / 启动失败 / 超时 / 来源请求），去掉 Input 与工单 |
| `plugins/dsh-evolution/cordis.patch.yml` | 修改：preset 描述改为「工具面由 Evolution 建会话时收窄」 |
| `plugins/dsh-continual-harness/src/*` | 修改：`ticketId` → `requestId`；删除 `ticket_id` 工具参数；错误码 `SKILL_DREAM_REQUEST_REQUIRED` |
| `plugins/dsh-laputa/{internal.mjs,src/candidates.ts}` | 修改：候选输入改 `requestId`，IPC 授权只转发它 |
| `patches/superagent-patches.json` | 修改：12 → 11，移除 Dream 补丁 |
| `patches/superagent-dream.patch` | 移除：移到 `.artifacts/retired/`（可回滚，不入库） |
| `scripts/dream-refine.mjs` | 修改：`--ticket` → `--session` |
| `tests/*` | 修改：`source-runtime` 补丁计数、`dream-preset` 重写、`evolution-dream-client` 文案与字段、`harness-owner-candidates` 输入字段 |
| `docs/{autodream,dream-executor}.md`、`docs/research/autodream-session-type.md`、`docs/logs/2026-11-autodream-native/v0.1.0/`、`TODOLIST.md` | 文档 |

## 生效方式

1. `npm run build:bundle` —— 已执行，exit 0（Superagent 重新构建并还原补丁）。
2. `npm run restart` —— **必做**；运行中的进程仍是旧 bundle 与旧 profile。
3. 浏览器硬刷新，再按 [acceptance.md](acceptance.md) 走 A→F。

## 用户可见变化

- 模式列表：一共 9 条，含「自动精炼」（`dsh-autodream`）。
- 「进化 → AutoDream」：不再显示 Input / 工单 / 已接纳，改为「请求与运行」，每条带「会话 `<id>`」。
- 手动按钮改名「创建手动精炼」；它直接创建一个精炼会话，不再投递 Input。
- 自动精炼不再经过准入，因此**开关打开后到点必跑**（受冷却、会话数、一手证据三条门槛约束）。
- Superagent 侧：不再有 Dream 工单/执行器；工单列表里不会再出现精炼任务。
- 审批面板：「来源工单」→「来源请求」。

## 兼容性 / 风险

- 运行中的旧 journal 记录仍可读：`version` 保持 1，读侧忽略已弃字段（`inputId`/`inputReceipt`/`ticketId`），新记录不再写它们。
- 记录库 `ticket_id` 列保留（外部工作项 id），未做迁移。
- 若 `dsh-autodream` preset 未注册（profile 未重载），手动/自动精炼会以 `failed` + `lastError` 呈现，不会静默降级成普通会话。
- 若 `skill` 不再是全局工具，`tools.restrict` 抛错 → 请求 `failed`，不会退回不受限的工具面。
- 一个进程里同时最多一个未结算请求；超时 2 小时后自动放开，不重试。

## 回滚

1. `git checkout -- plugins/dsh-evolution plugins/dsh-continual-harness plugins/dsh-laputa scripts/dream-refine.mjs tests docs` （或按需挑选）。
2. `patches/superagent-patches.json` 恢复 12 条，并把 `.artifacts/retired/superagent-dream.patch` 移回 `patches/`。
3. `npm run build:bundle && npm run restart`。

无数据迁移；已产生的 Dream 会话留在 `.artifacts/dsh-home/sessions`（不入库）。

## 已知限制

见 `summary.md` §未验证：preset 挂载、`tools.restrict` 在 `setup` 作用域的行为、`followup` 接受手写消息、`meta.agentPreset` 取 id 字符串、15 分钟 tick 开销——都要重启后实测。`plugins/dsh-continual-harness/src/owner-candidates.ts` 仍是未接线的既有死代码（见 TODOLIST DV-EV-017）。
