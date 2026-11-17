# 发布说明

## 变更

- 新增本地插件 `plugins/dsh-ui-scope`：在 `agent/created`（以及启动扫描）上，给**不是** superagent 的 agent 遮蔽 `genui:fence` 段（空文本）、`deny` `render_ui` / `validate_dsh_ui`、注册同名 `genui` 残桩技能（两头不可调用）；工具晚注册由 `tools/change` 补 deny。
- `scripts/lib/component-setup.mjs`：`componentPackages()` 增加 `['dsh-ui-scope', plugins/dsh-ui-scope]`，与 `dsh-daily` / `dsh-superagent-reset` 同一套本地组件接线。
- 新增 `patches/superagent-genui.patch`（第 14 条）：`composePrompt` 在 handoff/环境/policy 段之前插入 `uiPrompt` 教学；`WORK_TOOLS` 与 master 的 allow 列表各加两个 UI 工具。
- `patches/superagent-patches.json`：13 → 14 条。
- `tests/source-runtime.test.mjs`：补丁清单断言十三条 → 十四条。
- 新增 `tests/ui-scope.test.mjs`：9 条闸门用例。
- `superagent/lib` 已按 14 条补丁重建，运行期加载的就是这份产物。
- profile（`.artifacts/dsh-home/profiles/superagent-local/package.json`）：加 `dsh-ui-scope` 依赖与 bundles 条目，`node_modules/dsh-ui-scope` 已指向 `plugins/dsh-ui-scope`。

## 影响面

- 普通 DSH 会话（含跑开发的 lead 会话）与 DSH 子 agent：不再收到围栏教学、拿不到两个工具、技能目录里不再有 `genui`。
- superagent 主会话与 ticket worker：第一次真正拿到围栏教学与两个工具（此前 master 因 `complete` 段、两边因白名单都没有）。
- 前端渲染未动：浏览器那一半仍会渲 `dsh-ui` 围栏；收口靠「不教、不给工具、不给技能」。
- 运行中的 3082 宿主仍是旧 profile + 旧 lib，需要重启一次才生效。

## 回滚

- 移除 `patches/superagent-genui.patch` → `node scripts/build-bundle.mjs` → 重启（回到「普通会话能用、superagent 不能用」的原状）。
- 只想恢复普通会话、不重启补丁：从 profile 的 bundles 里删掉 `dsh-ui-scope` 并重启——但那样 master 也仍然收不到教学（教学在补丁里）。

## 注意

- 上游 `superagent/` 未改：`git -C superagent status --short` 为空，改动只在 `patches/`。
- profile 是手工接的（宿主在跑，`npm run setup:components` 要求先停面板）：`node_modules` 下是 junction，`pnpm-lock.yaml` 未更新；下次正常的 `npm run setup` / `setup:components` 会按 `componentPackages()` 重新接一遍。
- 教学文本只在补丁里一份，本目录不复制，避免两处不一致。
