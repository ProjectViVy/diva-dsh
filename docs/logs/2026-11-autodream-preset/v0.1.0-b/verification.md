# 验证记录 — v0.1.0 B（`dsh-autodream` 模式）

执行环境：`C:\Users\Administrator\Desktop\diva-dsh`，2026-11-13 02:00–02:30（Asia/Shanghai），Node v24.14.1。等待验证的运行时步骤单列在 §3。

## 1. 构建

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `npm run build:bundle`（首次，workspace-write 沙箱） | **失败**：`spawnSync git EPERM`（Node 用管道调用 git，被沙箱 named-pipe 限制拒绝） |
| 2 | `npm run build:bundle`（danger-full-access） | **失败**：`Cannot apply the build patch superagent-dream.patch … patch failed: src/app/sessions.ts:24`（补丁上下文按 pristine 生成，未考虑前 11 个补丁） |
| 3 | 重写补丁后 `npm run build:bundle` | **成功** exit 0：`tsdown` 产出 `lib/index.js`(490 kB)、`lib/client.js`(378 kB)；提示 `Run "npm run restart" to load it` |
| 4 | `Select-String superagent/lib/index.js -Pattern 'dsh-autodream' / 'workerPreset'` | 均为 `True` —— 新逻辑确实进了产物 |
| 5 | `git -C superagent status --porcelain` | 空 —— 补丁只在构建期存在，工作树干净 |

## 2. 测试

| # | 命令 | 结果 |
| --- | --- | --- |
| 6 | `node --test tests/dream-preset.test.mjs` | 4/4 通过（首跑 1 条失败：`name:`/`order:` 断言漏了 `m` 标志，已修） |
| 7 | `node --test tests/dream-skill-install.test.mjs` | 2/2 通过 |
| 8 | `node --test tests/source-runtime.test.mjs tests/evolution.test.mjs tests/evolution-dream-client.test.mjs tests/dream-evolution.test.mjs plugins/dsh-evolution/tests/dream-tool.test.mjs plugins/dsh-evolution/tests/dream.test.mjs` | 89 个中 85 过、4 失败 |
| 9 | 同上两条失败文件，**先把 `patches/superagent-dream.patch` 与 `plugins/dsh-evolution/cordis.patch.yml` 还原到 HEAD 再跑** | 仍然是同样的 4 条失败 → 与本改动无关（既有问题） |
| 10 | `node --test tests/contracts.test.mjs tests/component-boundaries.test.mjs tests/alignment-scan.test.mjs` | 17/18 过；失败的是 `QQ alignment scan retries rotation before writing any candidates`，路径与本改动无关（surfcore QQ），未单独还原复验 |
| 10b | `node --test tests/evolution-records.test.mjs` | 17/73 过：**环境问题**，不是本改动。每个用例的 `afterEach` 里 `rmSync(.artifacts/test-tmp/evolution-records-*)` 被 Windows 权限拒绝：`.artifacts` 上有 `Everyone: Deny DeleteSubdirectoriesAndFiles`（DSH 沙箱自带的既有 ACE，`diagnose-windows-sandbox-acl` 明确说这是预期项，不算冲突）；空目录能删、带子文件的目录删不掉，所以 56 条一起挂。该文件不 import 本次改动 |
| 10c | 用 harness 自带的 `yaml@2.9.0` 解析 `plugins/dsh-evolution/cordis.patch.yml`，并与内置 `deepseek-harness/packages/bundle/web-app/presets/cordis.patch.yml` 对照行形状 | `parsed=ok rows=2`；`preset.id=dsh-autodream / name=自动精炼 / order=92`；`plugins=skill-filesystem,tool-skill,compaction`；`compaction` 组（`group: true` + `isolate: {compaction, toolResultPruner}` + `compaction-basic`/`tool-result-pruner` 与三个阈值）与内置 `cordis` preset **逐字段一致**；内置 `standard` preset 也同样把 `skill-filesystem`+`tool-skill` 平铺挂载（不 isolate），说明这组插件可以单独成 preset |

失败明细（既有）：

- `the plugin mounts a lazy record store and still renders /overview when it cannot open`（evolution.test.mjs:289）
- `standalone mempalace installation confines caches and temporary files to the project`（source-runtime.test.mjs:3）
- `a fresh profile receives a local state directory and requested port`（source-runtime.test.mjs:94）
- `setup relocates its own profile state path after the whole project moves`（source-runtime.test.mjs:114，断言 `join()` 的反斜杠路径与 YAML 里的正斜杠不等）

## 3. 待重启后才能做的验证（本轮**未做**）

| # | 动作 | 期望 | 为什么本轮不做 |
| --- | --- | --- | --- |
| 11 | `npm run restart` | 进程带着新 bundle 与新 profile 起来 | 重启会终止当前会话所在的 DSH 进程（本回合会中断），留给下一轮或用户执行 |
| 12 | `cordis_inspect_query`(host/Config, `name=@deepseek-ai/dsh-agent-preset`) | 9 条，含 `dsh-autodream` | 依赖 11 |
| 13 | 面板「进化 → 概览 → 精炼」发一次手动精炼 | 生成 Ticket 并建出 Dream 会话 | 依赖 11，且需要浏览器交互 |
| 14 | 读会话日志 `agent-preset/selected` | `dsh-autodream` | 依赖 13 |
| 15 | 读会话首个 `request/header` 的工具清单 | 恰为 `skill`、`dream_refine` | 依赖 13 |
| 16 | 面板「进化 → 审批」 | 候选出现，行为与今天一致 | 依赖 13（模型跑完一轮可能需要数分钟） |

## 4. 没有做的事

- 没有 `git commit`（用户未要求）。
- 没有改 `superagent/` 源码留痕：补丁手术用完即 `reset --hard`，已确认干净。
- 没有重启、没有改 `.artifacts/` 下任何状态（临时脚本已删除）。
