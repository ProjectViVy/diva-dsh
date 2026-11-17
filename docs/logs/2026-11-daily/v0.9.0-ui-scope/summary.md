# genui 收口到 superagent（DV-UI-021）

主人 2026-11-16 06:0x：「这个工具可以限定范围为仅 superagent 和其 worker 可用吗？还有 html 我觉得也最好限定一下？」→ 选 A。

## 先查后改：现状是反的

| 事实 | 依据 |
| --- | --- |
| genui 是 profile 级 bundle，段/工具/技能对**每条**会话可见 | `third-party/genui/src/plugin/index.ts:219-235`（`systemPrompt.section` 与 `tools.register` 都注册在根 ctx）；本会话（普通 DSH 会话）实测能画卡 |
| superagent master **收不到**围栏教学 | master 的提示词段是 `complete: true`（`superagent/src/app/sessions.ts:249`），`complete` 段的语义是整段替换（`deepseek-harness/packages/core/system-prompt/src/index.ts:681-687`），全局段被丢掉 |
| master/worker 也**没有**两个工具 | master 的 `restrict({allow})` 白名单（`sessions.ts:276`）与 worker 的 `WORK_TOOLS`（`sessions.ts:64-66`）都不含 `render_ui` / `validate_dsh_ui` |
| superagent 源码里没有任何 `dsh-ui` / `genui` 字样 | `grep -r "dsh-ui\|genui" superagent/` → 0 命中 |

结论：要做「只给 superagent 和它的 worker」，得同时做**关掉别人**和**打开它自己**，只做前一半等于谁都用不了。

## 做法（三处闸门 + 一处开启）

**新插件 `plugins/dsh-ui-scope`**（本地仓，无 client 半边）：

- 白名单：会话 id 匹配 `^(orchestrator|worker)-`，或 `parentSession` 链 8 层内追到这样一条（与 `superagent/src/app/sessions.ts:303-312` 的 `limitSubagent` 同深度）。断链、超过 8 层一律按普通人处理。
- 闸一（段）：同名 scoped 段遮蔽 `genui:fence`，文本写空——`renderPrompt` 只渲染非空段（`system-prompt/src/index.ts:336`），scoped 段遮蔽全局段是官方语义（同文件 `:471-478`）。
- 闸二（工具）：`agent.ctx.tools.restrict({deny: ['render_ui','validate_dsh_ui']})`。genui 在依赖纤维里注册工具，闸门可能先跑，所以未出现的名字挂在 `pending` 里等 `tools/change` 补；`restrict` 对未知名会抛（`packages/core/tools/src/index.ts:1125`）。
- 闸三（技能）：本域注册同名 `genui` 残桩技能，`modelInvocable` / `userInvocable` 都是 false。技能目录按**技能名**合并、近层顶远层（`packages/skill/skill/src/index.ts:551-565`），所以这条顶掉全局那条 genui。只遮蔽围栏段是不够的：模型仍会从技能目录里看到「可以画界面」并主动加载。
- 挂不上闸只记 warn，不拖垮会话（宁可漏，也不让 agent 起不来）。
- 接线：`scripts/lib/component-setup.mjs` 的 `componentPackages()` 加一行 `['dsh-ui-scope', …]`，与 `dsh-daily` / `dsh-superagent-reset` 同一套本地组件机制。

**补丁 `patches/superagent-genui.patch`**（第 14 条，落在全部既有补丁之后）：

- `src/app/prompts.ts`：新增 `uiPrompt`（中文三句：先 `skill` 加载 `genui` 拿规范、围栏写正文、≥3 节点或含 table 先 `validate_dsh_ui`），`composePrompt` 把它插在 `runtime/handoff` / `runtime/environment` / `runtime/policy` **之前**——上游测试要求 worker 提示词以 handoff/环境段收尾（`superagent/tests/prompts.spec.ts:54`、`:237`），插在最后会把这两条打掉。
- `src/app/sessions.ts`：`WORK_TOOLS` 与 master 的 allow 列表各加 `render_ui`、`validate_dsh_ui`，并把两处注释改成「这一安装的例外」。

**html 自由 UI**：不动。它本来就只活在日常左栏（`plugins/dsh-daily/client.js:1277` 只绑 `orchestrator-*`），且 `FREE_HTML_UI = false`（`:1365`）已停用；边界写进 `plugins/dsh-ui-scope/README.md`。

## 取舍（最简 + 一个备选）

- 选新插件而不是改 genui：genui 是 pin 住的第三方子模块，不能塞本地逻辑；也不塞进 `dsh-laputa`（人格）或 `dsh-daily`（面板），那是混关注点。
- 备选 1：只 deny 不遮蔽技能——省 6 行，但模型能从技能目录主动加载 genui，边界漏。
- 备选 2：把教学做进新的 `PartKey`（`runtime/ui`）——语义更干净，代价是要同步 superagent 的 panel 文案表（`promptPart.<key>`）与 `prompts.spec.ts:51` 的顺序断言，改面更大，收益只是「可在面板里单独覆盖这一段」。

## 需重启

`npm run stop` → `npm start`。运行中的 3082 宿主加载的是旧 profile 与旧 lib。

## 未验证

- 重启后的运行期：普通会话是否真的看不到两个工具与 genui 技能、master/worker 是否真的拿到它们（本轮没重启宿主）。
- 面板里 worker/master 的提示词预览是否出现 `## 画界面（本安装独有的额外能力）`。
