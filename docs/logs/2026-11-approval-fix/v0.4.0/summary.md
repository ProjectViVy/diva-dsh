# v0.4.0 审批链路：批准与发布合成一次提交

日期：2026-11-11 ｜ owner：本会话 ｜ 状态：done（活体验收 A–D、F、G 通过）

## 问题

审计发现两处会伤到真实使用的缺口，外加若干「界面承诺与运行时不一致」：

1. **技能侧**：面板先写决定、再调 `publishCandidate()`。发布失败（基线已前进、身份不符）时决定已经落盘，候选从 `pending()` 消失，又不在任何列表里——批准了但既没生效也看不见，且不能改判。
2. **人格侧**：批准后草稿仍停在旧内容，概览一直显示「有未发布修改」；此时点「发布草稿」会把人格静默退回批准前的版本。
3. 技能审批只显示 `content` 与附件文件名，审阅者读不到附件正文、看不到与现版本的差异；审批产出也没有进入 Evolution 记录（四表 0 行，`owner-candidates.ts` 的转发从未接线）。
4. 设置页有「全局变更需人工确认」开关，但它对应的门在运行时永不触发（`skillOwner` 恒存在、`requireGlobalApprovalForTool` 无人设置）。

## 改了什么

### dsh-continual-harness

- `src/skill-owner.ts`：新增 `decideAndPublish()`。锁内顺序为：校验审阅摘要/确认/subject → CAS 基线 → 写不可变版本目录 → 一次原子替换 owner-state（publication + 幂等键 + live 指针）→ 成功后才写不可变决定回执。发布失败时不写决定，候选留在待审；回执丢失时 `decision()` 从 publication 反推，重放同一请求返回同一条发布。
- 幂等/唯一性：「一次批准只发布一次」改为按 `candidateId` 反查（回执可能重建，摘要不再可靠），同 key 重放返回原发布，不同 key 拒绝。
- `pending()` 增返 `subjectId`、`ticketId`、紧凑的 `evidenceRefs`、渲染后的 `bundle`（`SKILL.md` + 附件）与 `baselineBundle`；新增 `decisions()`（已处置历史，含拒绝）与 `previousPublication()`。
- `src/panel.ts`：`GET /pending` 返回 `{pending, decided, live}`（响应 > 4 MiB 时省略最旧候选正文并标记 `truncated`）；`/decide` 改走 `decideAndPublish`；新增 `POST /rollback`（`{skillId, confirm:true}`）以 live 的上一版生成回滚候选，不发布。三道守卫与「POST 必须带 Origin + JSON + confirm」保持不变。
- `src/coordinator.ts`、`src/approval.ts`、`src/owner-candidates.ts`：给不可达的保守审批门与未接线的转发加上明确注释；逻辑未动。

### dsh-laputa

- `src/candidates.ts`：批准成功后，若草稿摘要仍等于提案基线（或已等于候选内容），把六个文件原子写回草稿并 `cache.reload()`，决定里记 `draftSynced: true`；若草稿被并行编辑则保留，记 `draftSynced: false`。写入中途失败会把基线内容放回，避免半套草稿。
- `src/revision.ts`：`publishCandidate` 的草稿校验同时接受「候选内容」摘要（批准已同步草稿后的崩溃恢复重试）；`publish()` 新增 `persona_draft_stale` 守卫——草稿等于某个非当前版本时拒绝，提示用「版本 → 回滚」。
- `src/domain.ts` / `src/http.ts`：新增错误码与 `DRAFT_STALE` 映射（409 + 中文 hint）。
- `src/client.js`：说明文字改为「批准后草稿同步」；`draftSynced:false` 与 `DRAFT_STALE` 给出专门提示。

### dsh-evolution

- `src/client.js`：「审批」页展示来源工单/主体/证据引用、逐行 diff（`SKILL.md` 与附件分别展开，300 行上限）、附件全文；新增「已处置」卡片（已批准 vN / 未发布可重试 / 已拒绝）；已发布版本加「回滚到上一版」（二次确认后只生成候选）。记录页空态注明「记录库当前没有运行时生产者」。
- `src/config.mjs`：删除无效的「全局变更需人工确认」控件（harness schema 仍接受旧配置，不会报错）。

### 文档

`docs/autodream.md`、`plugins/dsh-continual-harness/docs/skill-owner.md`、`plugins/dsh-laputa/README.md`、`plugins/dsh-evolution/README.md`：把「回滚也是普通候选」「不写入可编辑草稿」「一次批准只发布一次」等承诺改成与代码一致的描述。`acceptance.md` 的 C 步暂存顺序已修正：`stale-a/b` 必须在 v1 之后暂存，否则基线对不上。

## 决策：本轮不接 Evolution 记录库

`owner-candidates.ts` 的 Evidence/Proposal 转发仍未接线。理由：DV-EV-013 已删除验证门，`skill_owner.versionedWrite=false` 是刻意的所有者边界；接记录要么给技能开所有者回传通道，要么把人工批准包装成 Validation，都会改写治理模型，且需要跨 4 个仓的协调。因此本轮只把 UI/README 的承诺降级为真实行为，并在条目里保留后续接入的触发条件。`evolution.db` 四表继续为 0 行。

## 验收结果

- A–D、F、G 已在 16:03 重启后的实例上实测通过（明细见 `verification.md`「活体验收」）：拒绝不发布；批准=1 条发布且重放不重复；基线冲突返回 422 且候选仍在待批、未写决定；回滚只生成候选，批准后回到旧内容。
- 浏览器点击流未执行；人格 E 步因活体人格未初始化记 N/A（由单测覆盖）。
- 夹具已清理进 `.trash-acceptance-2026-11-11T08-12-13-391Z`；若技能目录仍缓存夹具名，再重启一次即可。
- harness 全量套件仍有 7 项与本次无关的既有失败（见 `verification.md`）。
