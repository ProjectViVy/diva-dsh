# 世界网关 · v0.1.0-slots · 总结

- 日期：2026-11-11
- 目标：在 DSH 设置页新增「世界网关」板块，只做**拓展能力插槽与接线**；五个可选能力（ASR / TTS / 决策 / 向量 / 全模态）+ 一张实时语音纯 UI 占位卡。
- 范围：不接管 chat/vision，不接入任何项目，不做能力验证，不发起任何真实模型请求。

## 交付物

| 路径 | 内容 |
| --- | --- |
| `plugins/capability-hub/` | 新插件（host 半 `src/index.mjs` + `registry.mjs` + `http.mjs` + `capabilities.mjs`，浏览器半 `src/client.js`，`tests/registry.test.mjs`，README） |
| `scripts/lib/component-setup.mjs` | `componentPackages()` 与 `mappings` 各加一行，接入既有组件接线流程 |
| `docs/research/provider-hub-and-gateway.md` | 上游设计（上一轮已改） |
| 本目录四件套 | 总结 / 验证 / 验收 / 发布 |

## 设计与取舍（一句话版）

最简方案：一个插件、一个 JSON 真源、四条 HTTP 路由、一块设置分区；凭据不另存，直接复用 DSH 的 `credentials` 服务，插槽只存引用名。
备选：把插槽做成 DSH 的 settings 命名空间（schema + 表单引擎自动渲染）——省掉客户端代码，但拿不到「卡片 + 凭据状态 + 占位卡」这套版式，且要把 `capability` 结构塞进 schema，反而更绕。
取舍依据：本仓库已有 `dsh-local-voice` 用「手写 `client.js` + 自有 HTTP 前缀 + `settings.section`」的先例（`plugins/voice/src/client.js:1563`、`plugins/voice/src/http.mjs:32`），复用它的机制就没有新机制；代价是浏览器半手写，约 300 行，无构建步骤。
未加的东西：适配器层、能力测试按钮、`invoke` 路由、网关进程——都等到有真实消费者时再说（避免「先建后猜」）。

## 事实依据（本轮读过的源码）

- 浏览器半契约：`plugins/voice/src/client.js:13-17`（`window.__ModuleLoader__.load`）、`:1563-1569`（`settings.section` 注册）、`:1514`（组件收 `{ store }`）
- host 半契约：`plugins/voice/src/index.mjs:9-12`（`name` / `inject: ['webServer','connection']` / `apply`）、`plugins/voice/src/http.mjs:31-45`（前缀路由 + Host/Origin/会话校验）
- 路径与状态目录：`plugins/_shared/paths.mjs:5-23`（`projectHome` / `prepareStateDir`）
- 凭据服务：`deepseek-harness/packages/bundle/base/cordis.patch.yml:125-126`（`credentials-local` 在 base bundle 里，恒可用）
- 接线入口：`scripts/lib/component-setup.mjs:113-129`（`componentPackages`）、`:42`（`mappings`）
- 插件归类：`.gitmodules:16-54`（每个本地插件都是独立 submodule）

## 命令与验证状态

**首轮（v0.1.0 交付时）没有执行任何命令**：`pwsh` 不可用（DV-OPS-001，Windows ACL temp root 落在工作区内）。
**2026-11-11 08:0x 复测**：`pwsh` 恢复，单测 7/7 通过；但 `setup:components`（要求面板停止）与 `dsh plugin add`（tsx/esbuild spawn EPERM）仍不可用，
改用等价的手工 profile 登记（manifest + lock + junction，详见 `verification.md` §D）。浏览器端到端仍未跑。

## 未验证（如实）

1. ~~测试未跑~~ → 2026-11-11 08:0x 已跑：7/7 通过（直跑测试文件；`node --test` 在沙箱里 spawn 会 EPERM）；host 半 import、client 半语法检查均通过。
2. 浏览器半能否被 web shell 加载（`dsh.client` + `exports["./client"]`）只有 voice/asr 先例，本插件未实测。
3. `settings.section` 的 `order: 9` 是否与现有分区冲突未核（只影响排序）。
4. `plugins/capability-hub` **还不是 submodule**：用户已定独立仓名 `vivy-dsh/word-gateway`，但 `git init/push` 与 `git submodule add` 因 `pwsh` 不可用**未执行**，命令留在 `release.md`。
5. 面板端到端没点过：保存插槽、写凭据、`resolve` 返回，均未在真实浏览器里验证。

## 下一步

重启进程后（`npm run stop` → `npm run setup:components` → `npm start` → 硬刷新），按 `acceptance.md` 走一遍；
若浏览器半没出现，先查 profile `bundles` 是否含 `dsh-capability-hub`，再查 `exports["./client"]` 是否被客户端加载。
