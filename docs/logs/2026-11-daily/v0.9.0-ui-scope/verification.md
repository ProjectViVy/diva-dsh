# 验证记录（DV-UI-021）

## 机制确认（先查后改）

| 检查 | 依据 | 结果 |
| --- | --- | --- |
| genui 的围栏段名 | `third-party/genui/src/plugin/index.ts:219-220` | `name: 'genui:fence'`；顺序取 `getSectionOrder('STRUCTURED_OUTPUT')` |
| genui 的工具名 | 同文件 `:228-235` | `render_ui`（可配置关闭）、`validate_dsh_ui` |
| genui 的技能名 | 同文件 `:172-195` | 只有一条，`name: 'genui'`，provider `dsh-genui` |
| 空段会被滤掉 | `deepseek-harness/packages/core/system-prompt/src/index.ts:336` | `filter(section => section.text.length > 0)` |
| scoped 段遮蔽全局段 | 同文件 `:470-478` | 「A scoped section shadows a global section with the same name」 |
| `complete` 段整段替换 | 同文件 `:681-687` | 有 complete 段时 `sections: [completeSection]`——这正是 master 收不到全局围栏段的原因 |
| `restrict` 对未知名抛 | `deepseek-harness/packages/core/tools/src/index.ts:1125` | `unknown global tool ...` |
| `restrict` 需要 scoped ctx | 同文件 `:1105-1113` | 根 ctx 调会抛；`agent.ctx` 是 scoped |
| 技能按名字合并、近层顶远层 | `deepseek-harness/packages/skill/skill/src/index.ts:551-565` | `merged.set(entry.candidate.name, entry)` |
| 工具表变更事件 | `deepseek-harness/packages/core/tools/src/index.ts:209` | `'tools/change'(): void`，注册变化时 emit |
| agent 事件可用于按会话挂载 | `plugins/dsh-laputa/src/adapter.ts:114-116` | `ctx.agents.list()` + `ctx.on('agent/created'/'agent/disposed')` 的先例 |
| superagent 会话 id 形状 | `superagent/src/app/runtime.ts:104`、`src/executor/dsh.ts:23-26` | master `orchestrator-<stateDir hash>`、worker `worker-<ticketId>` |
| 上游没有 genui 痕迹 | `grep -r "dsh-ui\|genui" superagent/` | 0 命中 |

## 补丁

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 生成基线正确 | 先按 `withTemporaryPatch` 的顺序手工重放 13 条补丁（CRLF 归一化后），再取 diff | 只有我改的两处进入补丁 |
| 补丁可应用 | `git -C superagent apply --check ../patches/superagent-genui.patch`（在 13 条之后） | exit 0 |
| 改动面 | 补丁文件 | 只含 `src/app/prompts.ts`（`uiPrompt` + `composePrompt`）、`src/app/sessions.ts`（`WORK_TOOLS`、master allow 列表） |
| 清单登记 | `patches/superagent-patches.json` | 14 条，末位 `superagent-genui.patch` |
| 上游干净 | `git -C superagent status --short` | 生成补丁后与重建后都为空（12 个新文件按补丁清单手工清掉） |

## 构建与产物

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 重建 | `node scripts/build-bundle.mjs` | `Already up to date` → 14 条补丁 → tsdown `lib/index.js 491.46 kB`，exit 0 |
| 产物含教学 | `superagent/lib/index.js` 搜 `画界面（本安装独有的额外能力）` | 命中 |
| 产物含工具名 | 同文件 `WORK_TOOLS` 尾部 | `"interrupt_agent", "render_ui", "validate_dsh_ui"` |
| 闸门插件语法 | `node tests/ui-scope.test.mjs` | 9/9 通过 |

## 测试

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 闸门单测 | `node tests/ui-scope.test.mjs`（进程内跑，避开沙箱 spawn 限制） | **9/9** |
| 补丁清单断言 | `tests/source-runtime.test.mjs` | 十三条 → 十四条，通过 |
| 全仓回归 | `npm test` | **1450 项 / 1440 通过 / 0 失败 / 10 跳过**，exit 0 |

`ui-scope` 的 9 条覆盖：三处闸门同时落、master/worker 放行、孙 agent 通过 parentSession 追到 worker、断链与超 8 层拦下、启动扫描 + 重复 created 不重复登记、工具晚注册由 `tools/change` 补 deny、agent 走掉后清待办、出错只 warn 不抛。

## 沙箱边界（本轮实际踩到，记下来免得下次怀疑改动）

- `git apply` 手工跑会失败：`patches/superagent-personal.patch` 等大补丁是 CRLF，而工作树是 LF；构建脚本里 `patchText()` 会归一化（`scripts/lib/source.mjs:176-186`），所以必须照它的做法先转 LF。
- `node --test`、`npm test`、`node scripts/build-bundle.mjs` 在 workspace-write 沙箱下都 `EPERM`（子进程管道被拒）；这三条各提升一次权限跑完，其余命令都在沙箱内。

## 未验证（没重启宿主，留给验收）

- 运行期：普通会话的工具表/技能目录里是否真的没有 genui；master 与 worker 是否真的拿到两个工具与教学段。
- 面板提示词预览里 `## 画界面（本安装独有的额外能力）` 是否出现在 master 与 worker 两侧。
