# 验证记录 — v0.1.0 AutoDream 独立会话类型调研

> 本轮为只读调研：下面每条都是「读到了什么」，不是「改完是否生效」。所有命令在 `C:\Users\Administrator\Desktop\diva-dsh` 下执行，时间 2026-11-13 01:31–01:52。

## 1. 证据表

| # | 命令 / 动作 | 预期 | 实际（摘录） |
| --- | --- | --- | --- |
| 1 | `Get-ChildItem .artifacts/dsh-home/profiles/superagent-local` | 看到 profile 组成文件 | `cordis.yml`(223B)、`cordis.patch.yml`(896B)、`package.json`、`pnpm-*`；无 `presets/` 目录 |
| 2 | `Get-ChildItem plugins -Directory` / `patches` / `docs -Recurse` | 盘点改动落点 | 16 个本地插件、13 个 superagent 补丁（含 `superagent-dream.patch`）、`docs/dream-executor.md` 已存在 |
| 3 | 读 `docs/dream-executor.md` | 确认 Dream 已是「专用执行模式」 | `:28-41` `DREAM_TOOLS = ['skill','dream_refine']`，由 `Sessions#workOnly` 选用；`:71-77` 准入/Ticket 仍归 Superagent |
| 4 | 读 `docs/logs/2026-11-dream-executor/v0.1.0-dream-mode/summary.md` | 上一轮取舍 | `:37-40` 当时明确否决「独立 profile/独立进程」，理由是成本高一个数量级 |
| 5 | `grep 极简|创造模式|agent preset docs/` | 找既有调研 | 命中 `encounter-chat-and-session.md:15`（superagent 两个 preset）与 `companion-mode-and-fish-tone.md:59` |
| 6 | 读 `docs/research/encounter-chat-and-session.md` | 拿 preset/建会话的既有结论 | `:64-73` 两个 preset 的工具面；`:77-85` `ctx.sessions.create({agentPreset})` |
| 7 | `grep 极简|创造模式 deepseek-harness/` | 定位原厂模式 | `packages/bundle/web-app/presets/*.patch.yml`、`ui-agent-preset` 文案（标准/创造/极简/PTС） |
| 8 | `grep agent-preset deepseek-harness/packages` | 定位 preset 包 | `packages/preset/agent-preset`、`agent-preset-registry`、各 bundle 的预设补丁 |
| 9 | 读 `superagent/cordis.patch.yml` | 看 preset 行的真实写法 | `:20-27` worker、`:125-131` router；`:18-19` 注释明确「preset 行没有从选择器隐藏的设置」 |
| 10 | 读 `.artifacts/dsh-home/profiles/superagent-local/{cordis.yml,cordis.patch.yml,package.json}` | 确认补丁层如何叠加 | `cordis.yml` 是空根，树由 `package.json` 的 bundles + `cordis.patch.yml` 叠成；`dsh-evolution` 在 bundles 列表内 |
| 11 | 读 `plugins/dsh-evolution/{package.json,cordis.patch.yml,src/index.mjs}` | evolution 是否已有 bundle 层 | `package.json:14-17` 有 `dsh.bundle.patch`；`cordis.patch.yml` 只 insert 自己；`index.mjs:11` inject 无 `sessionController` |
| 12 | 读 `superagent/src/app/sessions.ts` | 插件怎么建会话 | `:138-155` `ctx.sessionController.create({sessionId, workspaceId, agentPreset})`；`:283-297` `tools.restrict({allow})` |
| 13 | 读 `superagent/src/app/delivery.ts`、`role-models.ts`、`index.ts` | 投递与模型 seed 的最小实现 | delivery `:66-85` `agent.followup(freezeMessage(...))`；role-models `:15-44` 只对首个请求 seed；index `:8` inject 含 `sessionController` |
| 14 | 读 `deepseek-harness/packages/preset/agent-preset/src/index.ts` | preset config 字段 | `:16-23` 仅 `id/name/description/order/plugins`，无隐藏字段 |
| 15 | 读 `deepseek-harness/packages/preset/agent-preset-registry/src/mount.ts` | preset 挂载约束 | `:204-216` 缺 scope 拒绝、子行失败拒绝、服务泄漏到 root realm 拒绝 |
| 16 | `grep sessionController deepseek-harness/packages/api/session-controller/` + 读 `types.ts:288-305` | 建会话 API 面 | `SessionCreateRequest { workspaceId?, cwd?, sessionId?, agentPreset? }`；`README.md:44` 复用空白会话并写 `agent-preset/selected` |
| 17 | `cordis_inspect_list` → `cordis_inspect_query`（host/Config/`listConfigs`, `name=@deepseek-ai/dsh-agent-preset`） | 看运行时真实注册的 preset | `preset-standard / preset-ptc / preset-minimal / preset-cordis / dsh-superagent-worker-preset / dsh-superagent-router-preset / preset-qq-chat / preset-qq-chat-v2`，`total: 8` |
| 18 | `grep preset-qq-chat **/*.yml` + `grep preset scripts/` | 本部署自己的 preset 从哪来 | `plugins/surfcore/plugins/surfcore/presets/qq-chat{,-v2}.patch.yml`（上游子模块产物）；`scripts/lib/surfcore.mjs:70` 把 `presets` 纳入构建目录 |
| 19 | 读 `plugins/dsh-evolution/src/dream.mjs:120-249`、`grep authorize` | 数清 Ticket 耦合点 | `:200` `api('inputs', …)`；`:207-233` `authorize` 用 `api('tickets/<id>')` + subject + mandate + assignment；`:70,99` 证据前缀过滤 |
| 20 | 读 `plugins/dsh-evolution/src/dream-tool.mjs` | 工具如何绑定 Ticket | `:45-49` `/^worker-(...)$/`；`:102` 非 Dream 会话直接抛错；`:112` `bound.set(ticketId, request.id)` |
| 21 | `Get-ChildItem .artifacts/dsh-home/sessions -Directory` | 会话存储形态 | 三个 workspace 目录：仓库根、superagent state 目录、`…work-refine-dream-evidence-c0674ee…`（上轮工单工作目录） |

## 2. 跑不了 / 跑失败的

| 动作 | 结果 | 处理 |
| --- | --- | --- |
| `Get-ChildItem deepseek-harness/packages/preset -Recurse -Include *.ts,*.md` | 递归进 `node_modules/…/cordis-plugin-include/…` 的符号链接环，输出 196 KB 并被截断，命令转后台 `[exit code: 1]` | `job_kill pwsh-1442010f1bf74ce3`；改用 `-File` 非递归列目录，拿到 `agent-preset/src/index.ts` 等 |
| 自动会话在 UI 的实际表现（标题/标签/composer） | **未跑**——需要真建一条 preset 会话，属实施动作 | 写进 §7 未验证 |

## 3. 没有做的事（有意）

- 没有创建任何 preset、没有改 `cordis.patch.yml`、没有重启实例：本轮只调研。
- 没有改 `.artifacts/` 下任何文件（只读）。
- 没有 `git` 操作。
