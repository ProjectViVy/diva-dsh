# v0.4.0 发布说明

日期：2026-11-11 ｜ 状态：构建通过，待重启

## 构建

```powershell
pnpm -C plugins/dsh-continual-harness build   # tsc -> lib/types
pnpm -C plugins/dsh-laputa build              # tsc -> lib/types
# dsh-evolution 直接加载 src/*.mjs，无构建产物；client.js 由面板按源文件加载
npm run stop
npm start
```

重启是必需的：本会话由运行中的实例托管，`lib/types` 与 `src/*.mjs` 不会热加载。

## 兼容性

- `GET /dsh-continual-harness/api/pending` 只增字段（`decided`、`bundle`、`baselineBundle`、`ticketId`、`subjectId`、`evidenceRefs`）；旧的读取方忽略新字段。
- `POST /decide` 请求体不变；响应仍是 `{ok, decision, publication}`，`publication` 在发布失败时不会出现（请求会以 422 失败，而不是成功返回空发布）。
- `POST /rollback` 是新增路由，旧面板不会调用。
- 旧的决定文件没有 `publicationId`：`decision()` 仍读文件；只有文件丢失时才从 publication 反推。旧 publication 没有 `publishedAt`：按 epoch 处理，仅影响展示。
- 旧的 `requireGlobalApproval` 配置键仍被 harness schema 接受；进化面板不再投影该字段，保存设置不会把它写回 profile。
- 人格侧新增错误码 `persona_draft_stale`（`DRAFT_STALE`，409）。只有「草稿内容恰好等于某个非当前版本」时触发，正常编辑与新内容发布不受影响。

## 变更文件

- `plugins/dsh-continual-harness`：`src/skill-owner.ts`、`src/panel.ts`、`src/coordinator.ts`、`src/approval.ts`、`src/owner-candidates.ts`、`tests/skill-owner.spec.ts`、`tests/panel.spec.ts`、`docs/skill-owner.md`
- `plugins/dsh-laputa`：`src/candidates.ts`、`src/revision.ts`、`src/http.ts`、`src/domain.ts`、`src/client.js`、`tests/candidates.spec.ts`、`README.md`
- `plugins/dsh-evolution`：`src/config.mjs`、`src/client.js`、`README.md`
- 根仓库：`docs/autodream.md`、`tests/evolution-dream-client.test.mjs`、`TODOLIST.md`、本日志目录
- 验收辅助：`.artifacts/audit/stage-acceptance-candidate.mjs`、`.artifacts/audit/skill-owner-probe.mjs`（不入库）

## 回滚方式

- 代码：`git -C plugins/dsh-continual-harness checkout -- src/...`（按仓回退），然后重新构建与重启。
- 已发布技能：面板「已发布的 harness 技能 → 回滚到上一版」生成候选，再批准。
- 人格：面板「版本 → 回滚」恢复草稿与版本。
