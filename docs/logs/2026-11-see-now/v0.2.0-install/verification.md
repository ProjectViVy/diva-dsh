# dsh-see-now 安装 · v0.2.0-install · 验证

时间：2026-11-13 05:10–05:25（Asia/Shanghai）。只列命令与真实输出，不把「应该」写成「已通过」。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node .workspace/download-see-now-v0.2.3.mjs`（codeload `refs/tags/v0.2.3`） | 得到 tag 源码 | HTTP 200，`.workspace/see-now-v0.2.3.zip` 8,729,569 字节 |
| 2 | `Expand-Archive` + `Copy-Item` 到 `plugins/dsh-see-now` | 版本 0.2.3 | 目录落地，`package.json` version `0.2.3` |
| 3 | `node --check` 33 个 `src/*.js` + `client.js` | 全部可解析 | `all 33 src files parse`；client 语法通过 |
| 4 | 客户端槽位探针（`.workspace/probe-see-now-client.mjs`，mock ModuleLoader/React/slots） | 注册 `main` / `sidebar.panellist` / `settings.section` | `probe ok`；sidebar `{id:'see-now', order:16, label:'看你看的东西'}` |
| 5 | `node --test`（插件目录，首次） | 上游测试通过 | **失败 2 条**：`test/client-wiring.test.mjs` 断言只注册 `settings.section`，实际 `['main','sidebar.panellist','settings.section']`；「第一帧」测试按索引取 settings 也失败 |
| 6 | 更新 `test/client-wiring.test.mjs` 的断言（按 name 取 settings，补 sidebar/main 断言） | 测试与本地 fork 一致 | — |
| 7 | `node --test`（插件目录，复跑） | 0 fail | **500 tests / 479 pass / 0 fail / 21 skipped**，47.3s |
| 8 | profile `package.json` 解析 | JSON 合法，含依赖与 bundle | 解析通过；`dsh-see-now` 在 dependencies 与 bundles |
| 9 | 建 `node_modules/dsh-see-now` 符号链接 | 指向 `plugins/dsh-see-now` | `LinkType SymbolicLink`，target `..\..\..\..\..\plugins\dsh-see-now`，`package.json` 可读 |
| 10 | `pnpm install`（profile 目录） | 锁文件纳入新 link | `Already up to date` 后 `pnpm-lock.yaml` 出现 `dsh-see-now` 的 specifier 与 version |
| 11 | `dsh plugin --profile superagent-local list` | 19 个包，含 see-now | `dsh-see-now@link:../../../../plugins/dsh-see-now`，`19 packages` |
| 12 | 隔离端口启动 / 浏览器打开侧栏 | 插件加载、分组归属 | **未执行**：重启会终止当前会话；留给用户重启后验收 |

## 05:35 改线后（`vivy-dsh/dsh-see-now`）

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 13 | `git ls-remote https://github.com/vivy-dsh/dsh-see-now HEAD` | 新仓可达 | `1d98dd5bf1fdcad58fbf27b6906bb8c525ccccb3`，exit 0 |
| 14 | `git submodule add https://github.com/vivy-dsh/dsh-see-now plugins/dsh-see-now` | 子模块落地 | 成功；HEAD = `1d98dd5`；`.gitmodules` 新增条目 |
| 15 | 将原 `client.js` / `test/client-wiring.test.mjs` 的本地补丁应用到新源码 | 侧栏注册仍在 | 通过；`node .workspace/probe-see-now-client.mjs` 输出 `main` / `sidebar` / `settings`，`probe ok` |
| 16 | `git -C plugins/dsh-see-now diff` → `patches/see-now-vivy-core.patch` | 补丁可重放 | 3,949 字节，2 文件 |
| 17 | `node scripts/setup-see-now.mjs`（补丁已应用时） | 幂等，不重复打 | `dsh-see-now: VIVY心核 panel patch already applied` |
| 18 | `node --test`（新源码 + 补丁） | 0 fail | **503 tests / 482 pass / 0 fail / 21 skipped** |
| 19 | `inspectComponents` + `componentCutoverReady` | 组件已接线 | `missing: []`；`cutoverReady=true` |
| 20 | 子模块回到干净态 → `node scripts/setup-see-now.mjs` | 补丁能从零重放 | `applied VIVY心核 panel patch`；`client.js` / `test/client-wiring.test.mjs` 重新变为 modified |

## 未验证（不得写成「没问题」）

- 重启后的插件加载：bundle patch、`@deepseek-ai/dsh-tools` peer 解析、`session.snapshotEvents()` 在 rc.5 的行为。
- 侧栏是否真的把新行放进 `VIVY心核`（分组是 DOM 增强，按 label 判定；逻辑上不在 `TOOL` 白名单，但未看真实 DOM）。
- 设置页与侧栏面板的 `/api/see-now/*` fetch（同源、运行期才挂路由）。
- `see_now` 工具注册、`/seenow`、真实抓屏出图、token/CPU。
- Python + Tk + `mss`/`Pillow`/`numpy` 悬浮窗依赖。
- 插件自带测试的 Windows/Linux/macOS 差异；本次只在本机跑。
- submodule 的 `client.js` / `test/client-wiring.test.mjs` 是**本地未提交改动**；`git submodule update --checkout` 会清掉，需要 `npm run setup:see-now` 重打。
- 根仓 `npm test` 未全绿：**1350 tests / 1230 pass / 114 fail / 6 skipped**（`--test-reporter=tap`，日志 `.artifacts/root-test-2026-11-13.tap`）；失败面覆盖 voice 路径、surfcore ESM、mempalace 权限/DB、component lockfile 等，本次只单独跑了组件检查与插件测试，没有把根仓失败算作通过，也没有在本轮修它们。
- `maxCrop` 默认值在真实画面上的可读性收益未验证；C7 仍需端到端截图复看。
