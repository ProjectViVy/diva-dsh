# v0.3.4 AutoDream 改为全员人工批准

日期：2026-11-10 ｜ owner：session-cb519418-30ae-46c2-b127-bca01a68a4f9 ｜ 状态：done（待重启生效）

- 技能候选与人格候选统一：只在面板人工确认后发布，删除 OCI/Docker 验证门。
- `execute` 只暂存候选并停在 `awaiting_review`；Dream 状态合并 owner 的 live 版本。
- 新增 harness 面板 API `/pending` 与 `/decide`（同源 + 宿主会话守卫），进化面板新增独立「审批」标签（排在「概览」之后）。

## 改了什么

- `plugins/dsh-continual-harness/src/skill-owner.ts`：删掉 runner / 验证回执 / HMAC，改为决定记录（`approved` / `rejected`，绑定 bundle 摘要）+ 发布；新增 `pending()`、`decision()`、`decide()`；发布只认人工决定，一次决定只能发布一次。
- `src/panel.ts`（新增）：`GET /dsh-continual-harness/api/pending`、`POST /decide`，回环 + 同源 + `connection.requestRejection` + 显式 `confirm`。
- `src/skill-owner-runtime.ts`：组件通道只保留暂存与只读状态；面板在 `['webServer','connection']` 齐备时才挂载。
- `src/coordinator.ts`、`src/coordinator-types.ts`、`src/store.ts`、`src/tool.ts`：技能编辑止于暂存，返回 `human-approval-required` / `pending`；工具描述不再宣称自动验证。
- `plugins/dsh-evolution/src/dream.mjs`：`execute` 对两类候选都置 `pending_review`；`status()` 用 owner 的 live 版本标注已发布候选；`authorize` 只接受 `skill:stage`，`skill:publish` 明确拒绝。
- `plugins/dsh-evolution/src/client.js`：新增「审批」标签（概览之后）：待批候选正文、附件、摘要与批准/拒绝按钮，已发布版本列表，空态显式说明；AutoDream 标签只保留门槛、手动精炼与运行记录，并提示去「审批」确认。
- 文档：`docs/autodream.md`、`plugins/dsh-continual-harness/docs/skill-owner.md`、`skills/diva-dream/SKILL.md`、`README.md`。
- 测试：`plugins/dsh-continual-harness/tests/skill-owner.spec.ts`、`tests/panel.spec.ts`（新增）、`plugins/dsh-evolution/tests/dream.test.mjs`、根 `tests/evolution-dream-client.test.mjs`、`tests/dream-skill-install.test.mjs`。

## 未验证

- 运行中实例（PID 17356）未重启。本会话由该实例托管，重启会中断当前对话；改动要重启后才加载。
- 面板按钮未做浏览器实测：只验证了客户端渲染与请求体（`tests/evolution-dream-client.test.mjs`）。
- `connection` 服务在真实 profile 下是否存在，未在运行态确认；缺失时面板不挂载（fail-closed），不会退化成无鉴权写入。
- 145 个根测试失败为改动前既有项（`INSTALLATION-NOTES.md` 记录 149 个），本轮未修。
