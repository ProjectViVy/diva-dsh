# v0.1.0：AutoDream 走 dsh-webhook 原生会话，Superagent 退出精炼链路

- 状态：已实施并通过构建与单测；运行期验收待重启（重启会终止当前会话进程，由用户执行）
- 范围：`plugins/dsh-evolution/src/{dream-session,dream,dream-tool,index}.mjs`、`plugins/dsh-evolution/src/client.js`、`plugins/dsh-evolution/cordis.patch.yml`、`plugins/dsh-continual-harness/src/*`（`requestId` 改名）、`plugins/dsh-laputa/{internal.mjs,src/candidates.ts}`、`patches/superagent-patches.json`、`scripts/dream-refine.mjs`、`tests/*`、`docs/*`
- 验证：见 [verification.md](verification.md)
- 未验证：重启后的 preset 挂载、工具面、自动跑通一次、面板「请求与运行」渲染；明细见本文末尾 §未验证
- 下一步：用户 `npm run restart`，按 [acceptance.md](acceptance.md) 逐条验

## 做了什么

按用户拍板的方向，把精炼链路改成：**时间到 → 准备语义 → 启动 autodream 精炼会话 → 提交人工审批**，中间不再有 Input、Policy、Ticket 或 Superagent 工单。

1. **新增 `src/dream-session.mjs`**：照抄上游 `@deepseek-ai/dsh-webhook#createWebhookSession` 的五步——解析 agent preset 与 permission preset → `workspaceRegistry.create` 并挂会话 → `agents.create({ sessionId, meta, setup })`，在 `setup` 里挂 preset、`tools.restrict({ allow: ['skill'] })` 并注册 `dream_refine` → `permissionPresets.set(session, 'read-only')` + `sessionTitle.rename` → 下发一条用户消息。失败时回滚（解挂 + dispose）。
2. **`dream.mjs` 重写核心**：删掉 `api()` HTTP 客户端、`/orchestrator/api/inputs` 投递、`inputId/inputReceipt`、`authorize()` 里的 Ticket 查询；请求记录改成 `{ id, sessionId, agentSessionId, status, snapshot, deadlineAt }`；`authorize()` 只认「冻结请求 + 会话身份」（`request.agentSessionId === sessionId`），owner IPC 回调可只带 `requestId`；`maintain()` 把超过 2 小时未完成的请求标为 `timed_out` 并 `blocked` 其运行；新增 `startDreamSchedule()`（appReady 触发一次，之后每 15 分钟）。
3. **`dream-tool.mjs` 改成按会话注册**：`dreamToolDefinition(dream)` 是纯工厂，由 launcher 在会话作用域里注册；会话 id 从 `execution.agent.id` 取，删掉 `worker-<ticket>` 解析。
4. **退役补丁**：`patches/superagent-dream.patch` 移到 `.artifacts/retired/`，清单 12 → 11；Superagent 不再有任何 Dream 专用代码（`git grep dsh-autodream` 为空）。
5. **改名对齐**：`ticketId` → `requestId` 穿过 harness（`skill-owner*`、`panel`、`coordinator*`、`tool`、`owner-candidates`）与 Laputa（`internal.mjs`、`candidates.ts`）；`ticket_id` 工具参数删除，错误码改 `SKILL_DREAM_REQUEST_REQUIRED`。记录库的 `ticket_id` 列保留（它是外部工作项 id，与本次无关）。
6. **CLI 与 UI**：`scripts/dream-refine.mjs` 由 `--ticket` 改为 `--session`；面板文案从「Input / Ticket / 已提交 / 已接纳」改为「会话 / 请求与运行 / 启动失败 / 超时」。

## 关键取舍（多·快·好·省）

- **最简方案**：复用上游已验证的建会话序列，不新造会话启动器，也不注册 webhook 路由去伪造一次 `VerifiedWebhookDelivery`（备选方案，被否：会伪造 `kind:'webhook'` 来源并多一个依赖）。
- **省**：`tools.restrict` 只接受全局工具名，所以 `dream_refine` 改为会话作用域注册——限制清单里不必再列它，同时它也不再泄漏给普通会话；「废弃补丁」让上游升级面少一个补丁。
- **好**：失败面显式化——preset 缺失 → 请求 `failed` + `lastError`；`skill` 不是全局工具 → `restrict` 抛错（绝不退回不受限）；无 workspace → 拒绝建会话；agent 死掉 → 2 小时后 `timed_out`，不会永久卡住门槛。
- **快**：一个 PR 内完成代码 + 测试 + 文档，未引入新依赖。

## 未验证

- `agentCtx.tools.restrict()` 在 `setup` 里与 `agent.ctx` 行为一致（按上游同款调用推断）。
- `agent.followup()` 接受手写 `UserMessage`（已核对 `agent-loop/src/agent.ts:163` 直接 `send(..., 'next-turn', true)`，无运行时校验）。
- `meta.agentPreset` 接受 preset id 字符串；`permissionPresets.resolve('read-only')` 在本 profile 存在。
- 15 分钟 tick 的实际开销未测量（一次 `listSessions` + 日志读，与启动检查同量级）。
