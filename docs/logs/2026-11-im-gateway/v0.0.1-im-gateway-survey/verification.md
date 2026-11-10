# 验证记录 v0.0.1-im-gateway-survey

> 只写事实：命令、预期、实际。禁止只写「通过」。
> 本轮为**纯文档交付**，无代码行为变化，因此验证形式是「只读核对」而非「跑测试」。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `Get-NetTCPConnection -LocalPort 3082 -State Listen` | 找到 GUI 进程 | PID 17356，`node`，路径 `C:\nvm4w\nodejs\node.exe` |
| 2 | `Get-CimInstance Win32_Process -Filter "ProcessId=17356"` | 拿到 profile 名 | `apps/cli/src/bin.ts --profile superagent-local --no-open` |
| 3 | `$env:DSH_HOME` | 真实 home 路径 | `C:\Users\Administrator\Desktop\diva-dsh\.artifacts\dsh-home`（**不是 `~/.dsh`**） |
| 4 | 读 `profiles/superagent-local/package.json` | 确认已挂插件 | 17 个 bundle，含 `dsh-superagent` / `surfcore` / `dsh-surfcore-adapter`；**无 dsh-im** |
| 5 | 读 `<DSH_HOME>/<组件>/runtime.json` | 判断哪些组件在跑 | adapter / voice / memory / asr 有 runtime.json（均指向 `127.0.0.1:3082`）；**surfcore 无** |
| 6 | 探测 3000 / 3001 / 3100 端口 | 判断 SnowLuma 与桥接 | **三者均无监听** → SnowLuma 未启动、桥接未运行 |
| 7 | 读 `<DSH_HOME>/surfcore/config.json` | 看 snowluma 配置 | 顶层键仅 `platforms, updates, extensions, memoryCard`；**无 `snowluma` 段**；`platforms.start={qq:false,bili:false}` |
| 8 | `Select-String` 统计 `bridge.js` | 量化 SnowLuma 耦合 | 16,218 行 / 873 KB；关键词命中 330 行（2%）；**11 个裸 `fetch(\`${httpUrl}/…\`)`**；13 个不同 OneBot action |
| 9 | 按文件统计 SnowLuma 引用 | 找出四个客户端 | bridge 251 / snowluma-conn 32 / mcp-host-server 18 / mcp-snowluma-safe 17 / adapter egress（端点引用 12） |
| 10 | 查谁 import `snowluma-conn.js` | 验证「隐式 token 中介」 | **只有** `bridge.js:33` 与两个脚本（`probe-snowluma-heartbeat.mjs`、`test-snowluma-conn.mjs`）；mcp-safe / mcp-host / adapter 均**未引用** |
| 11 | 读 `scripts/surfcore-loader.mjs:41-60` | 验证「内存打补丁」 | `registerHooks({ load })` 在 import 时替换模块源码；`assertFreshPatch` 比对 `sourceSha256`，不符抛 `SURFCORE_PATCH_DRIFT` |
| 12 | 读 `scripts/lib/surfcore-component-patch.mjs` | 验证补丁落点 | 写 `destinationRoot`（`.artifacts/surfcore-adapter/bundle`），不写 `sourceRoot` |
| 13 | grep 锚点补丁的 `path:` 目标 | 列出上游禁区 | 9 个文件：`src/bridge.js`、`src/character-persona.js`、`src/bili-share-scheduler.js`、`lib/index.js`、`lib/scheduler.js`、`lib/align.js`、`tools/lib/msgfeed.mjs`、`tools/lib/state-paths.mjs`、`tools/commands/dm-await.mjs` |
| 14 | 读 `superagent/src/sources/kind.ts` | 核对 SourceKind / SourceChannel 契约 | `SourceChannel` 仅 `allowed?` / `send(text): 'sent'\|'gone'` / `link()`；无审批、提问、产物、卡片能力 |
| 15 | 读 `superagent/src/core/intake.ts` | 验证「扇出不走 Eval」 | `if (!this.owners(trigger).length) this.queueForEval(trigger)` |
| 16 | 读 `superagent/src/executor/dsh.ts:24` | 验证会话稳定性 | `workerSessionId = (ticketId) => \`worker-${ticketId}\`` |
| 17 | `Invoke-RestMethod api.github.com/.../contents/...` | 量化 dsh-im 规模 | `src/channels` 14 个渠道目录；`shared/` 约 95 个模块，`bot-workspace-store.mjs` 134 KB、`text-harness-bridge.mjs` 106 KB、`harness-client.mjs` 103 KB；`channels/qq/` 12 个文件，`qq-bridge.mjs` 73 KB |
| 18 | 读 `plugins/surfcore/package.json` 的 `license` | 判断能否 fork | `MIT` |
| 19 | `git submodule status` / `.gitmodules` | 确认只读边界 | `superagent`、`deepseek-harness`、`plugins/surfcore` 均为 submodule |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| `plugins/surfcore npm run test:audit` | 本轮未改代码，无需跑；但也无法用它证明任何文档结论 | 真正动手做 A 时必跑 |
| dsh-im 实际安装与加载 | 未安装，且与 `dsh 0.2.1-rc.5` + `app.asar` 补丁的兼容性未验证 | 决定走路线乙或 B1 时 |
| 真实 QQ 收发闭环 | SnowLuma 未启动、桥接未运行、qq/bili 启动开关均关闭 | 用户打开 `platforms.start.qq` 并启动 SnowLuma 后 |
| dsh-im 源码行为 | 只抓了公开文档与文件清单，未读源码 | 落地前用 `git clone` 读 `src/channels/shared/harness-client.mjs` 等 |

## 反向验证

- 未做。本轮无代码改动，无可回滚的行为；文档回滚路径 = 删除 `docs/research/im-gateway-unification.md` 与本目录。
- 已确认 `git status` 中本轮改动仅限 `docs/` 与 `TODOLIST.md`，未触碰 `plugins/`、`superagent/`、`deepseek-harness/`。
- **补充（同一轮内核对）**：`git status` 另外显示 ` M plugins/surfcore`、` M plugins/dsh-continual-harness`
  （submodule 指针与 superproject 记录的提交不一致），以及未跟踪的 `AGENTS.md` / `docs/proposals/`。
  这些**不是本会话产生**：前者即「子模块 checkout 的提交 ≠ 父仓记录的提交」，
  也就解释了上文「跑不了的验证」表格里「子模块内 9 个 ` M` 但 `git diff` 为空」的现象；
  后者来自另一会话的 `docs/logs/2026-11-methodology/v0.1.0-todolist-log-bootstrap` 交付。
  **本会话对它们零写入**。
