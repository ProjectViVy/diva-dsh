# v0.1.0 B：为 AutoDream 挂载 `dsh-autodream` 模式（保留 Ticket）

- 状态：已实施，**待重启验证**（运行时验证需要重启 DSH，重启会终止当前会话进程，故留给下一轮）
- 范围：`plugins/dsh-evolution/cordis.patch.yml`、`patches/superagent-dream.patch`、`docs/dream-executor.md`、`docs/autodream.md`、`tests/dream-preset.test.mjs`、`TODOLIST.md`
- 验证：见 `verification.md`（构建 exit 0、bundle 含新逻辑、新增 4 条测试绿、4 条既有失败已用还原法复验与本改动无关、YAML 用 `yaml` 解析并与内置 preset 对照）
- 未验证：重启后的 preset 挂载、会话 `agentPreset`、首个请求工具清单、候选是否仍进审批面板
- 下一步：用户执行 `npm run restart`，下一轮按 `acceptance.md` B1–B5 验证

## 做了什么

按已拍板的 **B**（只挂 preset，不摘 Ticket、不修准入、不做 A）：

1. **声明新预设** `plugins/dsh-evolution/cordis.patch.yml`：追加 `@deepseek-ai/dsh-agent-preset` 行，`id: dsh-autodream`、名「自动精炼」、`order: 92`；子插件只有 `skill-filesystem`、`tool-skill` 与 `compaction`（`compaction-basic` + `tool-result-pruner`），没有 shell、fs、jobs、web。
2. **让 Dream 工单用新预设** `patches/superagent-dream.patch`（重写，文件名与清单位置不变）：
   - 新增 `DREAM_PRESET = 'dsh-autodream'`；
   - `SessionsHost.store` 的 `Pick` 加 `triggers`（Dream 判定需要读 Trigger）；
   - 新增私有 `workerPreset(sessionId)`：从 `worker-<ticketId>` 找到 Ticket → origin Trigger → `dreamTrigger()`，返回 `DREAM_PRESET` 或 `WORKER_PRESET`；
   - `ensure()` 建会话时用 `this.workerPreset(id)`；
   - `agent-preset/selected` 守卫同样按 `workerPreset` 重选，避免用户在 UI 里打开该会话后被纠正回 worker preset；
   - `workOnly` 的 `DREAM_TOOLS` 分支保留（工具面仍由补丁作为唯一权威——preset 不是边界，root 工具对 preset 会话仍可见）。
3. 文档：`docs/dream-executor.md` 增「The preset」一节与两条 Limits（自动仍被准入拦截；系统提示词仍是 worker 版本）；`docs/autodream.md` 流程图与正文标注该模式。
4. 新增 `tests/dream-preset.test.mjs`（4 条）：preset 行与补丁字面量一致、preset 不含工作工具、补丁保留 `skill+dream_refine`、补丁用 `workerPreset` 建会话并在选中时重选。

## 实现中踩到的两个坑（都已解决）

1. `git apply` 直接读 `patches/*.patch` 会失败：磁盘上的补丁是 CRLF，而仓库的补丁器会先 `replaceAll('\r\n', '\n')` 再喂给 `git apply -`。用 PowerShell 逐个 `git apply 文件` 时，只有 windows 补丁偶然成功，其余全部 “patch does not apply”。
2. 新补丁的上下文必须匹配**应用完前 11 个补丁之后**的 `src/app/sessions.ts`（`superagent-context.patch` 改过 `SessionsHost` 附近）。第一次按 pristine 状态生成的补丁在构建时报 `patch failed: src/app/sessions.ts:24`。正确做法：先按构建的方式应用 11 个补丁并 stage，再编辑、`git diff`，最后 `reset --hard`。

## 影响面

- 用户可见：模式选择器/预设列表会多一条「自动精炼」；Dream 会话换 preset（候选与审批流程不变）。
- 依赖/数据：无新依赖；`superagent/` 工作树保持干净（补丁只在构建期应用）。
- 需要重启：**是**（补丁进了 bundle，profile 组合也变了）。

## 未验证

1. `dsh-autodream` 在运行时能否挂载（子插件解析、`mountPreset` 的服务泄漏检查）——只有真正建一次会话才知道；
2. Dream 会话的首个 model 请求工具清单是否恰为 `skill` + `dream_refine`；
3. 会话被 UI 打开时守卫是否把它保持在 `dsh-autodream`；
4. 自动检查那支仍被准入拦截（预期，不是回归）。

## 备注

- 取舍：没有把工具限制搬到 evolution（跨插件 `agent.ctx.tools.restrict` 的可见性未实测），因此 `superagent-dream.patch` 仍在，只是从「按工单标记限制」变成「按工单标记选 preset + 限制」。真正的职责搬家属于 A。
- 4 条测试失败（mempalace 缓存、两条 profile 路径、lazy store）与 1 条 QQ 对齐重试用例与本改动无关：前 4 条在把两个改动文件还原到 HEAD 后**同样失败**；QQ 那条不触及本改动路径，未单独复验。
- `tests/evolution-records.test.mjs` 的 56 条失败是**环境**问题：`.artifacts` 带着 `Everyone: Deny DeleteSubdirectoriesAndFiles` 的既有 ACE，用例收尾 `rmSync` 带子文件的临时目录被拒；空目录能删、非空删不掉，与本次改动无关。
