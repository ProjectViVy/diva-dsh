# laputa 人格注入收窄 · 总结

- 触发：用户 2026-11-14 20:44 明确口径——**superagent main Session 接 DIVA 是项目目的，worker 不接**；现状是两者都被注入。用户 21:03 授权开工。
- 改动：`plugins/dsh-laputa`
  - `src/top-level.ts` 新增 `PERSONA_EXEMPT_PRESETS = ['dsh-superagent-worker']` 与 `carriesPersona(agent)`（= 顶层会话且 preset 不在豁免表）。
  - `src/adapter.ts` 注入条件从 `isTopLevelAgent` 改为 `carriesPersona`；导出 `carriesPersona` / `PERSONA_EXEMPT_PRESETS`。
  - `src/tool.ts` 的 `laputa_init` 守卫改用 `carriesPersona`，错误文案改为「…top-level agent that carries the persona」。
  - `tests/adapter.spec.ts`：`fakeAgent` 支持 `preset`；新增 6 条用例（携带判定 4 条 + 注入/延迟创建 2 条）。
- 结果：main Session（`dsh-superagent-router`）保留人格段 + `laputa_init`；worker Session（`dsh-superagent-worker`）两者都不再获得；普通会话（无 preset）不变；delegated child 仍一律不注入。
- 验证：`npm test` 17/17 文件通过、**280 passed / 7 skipped**；`npm run typecheck` 与 `npm run build` 通过。
- 未验证：**运行期未验证**（改动需重启宿主才生效；当前 GUI 正在承载对话，未擅自重启）。`vitest` 仍以 exit 1 结束，因 `tests/index.spec.ts` 产生 7 个 unhandled rejection（`Component web server port is unavailable`，`src/index.ts:124`）——该文件不在本次改动范围，且是测试环境无 webServer 端口所致；**未确认改动前是否同样出现**（工作区另有他人未提交改动，未做 stash 以免破坏）。
- 影响面：仅 `plugins/dsh-laputa`（独立 git 仓，未提交）；未改 profile、未改上游三仓。
