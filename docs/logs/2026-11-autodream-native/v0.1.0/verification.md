# 验证（v0.1.0）

全部命令在 `C:\Users\Administrator\Desktop\diva-dsh` 下执行；时间 2026-11-13 03:15–03:45。

## 构建

| 命令 | 结果 |
| --- | --- |
| `npm run build:bundle` | exit 0（`✔ Build complete`，两次内联构建；末尾 `Bundle rebuilt`） |
| `git -C superagent status --short` | 空（补丁只在构建期存在，构建后被还原） |
| `git -C superagent grep -n "dsh-autodream\|DREAM_PRESET"` | 无匹配（exit 1） |

清单：`patches/superagent-patches.json` 12 → 11 条；`patches/superagent-dream.patch` 已移出到 `.artifacts/retired/superagent-dream.patch`。

## 插件单测

| 命令 | 结果 |
| --- | --- |
| `node --test plugins/dsh-evolution/tests/*.mjs` | **24 pass / 0 fail**（`dream.test.mjs` 18 条 + `dream-tool.test.mjs` 6 条） |
| `cd plugins/dsh-laputa; npm run typecheck` | 无输出（clean） |
| `cd plugins/dsh-laputa; npm test` | 274 pass / 7 skipped / 17 files；`tests/index.spec.ts` 有既有 unhandled error（与本改动无关，仅使进程退出码为 1） |
| `cd plugins/dsh-continual-harness; npm run typecheck && DSH_HOME='' npm test` | typecheck clean；686 pass / 2 fail（均为 Windows 文件 mode 断言：`expected 438 to be 384`，既存环境问题） |

注意：harness 套件必须 `DSH_HOME=''` 运行——从本会话 shell 继承的 `DSH_HOME` 带相对 `home`，会让 `tests/plugin.spec.ts`「manual Dream control plane」4 条误失败（`DSH_HOME=''` 时 4/4 通过）。

## 根仓测试

`node --test tests/*.test.mjs` 中与本改动相关的全部通过：

| 用例 | 结果 |
| --- | --- |
| `tests/source-runtime.test.mjs`「applies eleven patches in order」 | ✔ |
| `tests/dream-preset.test.mjs`（4 条） | ✔（preset 行、无工作区工具、唯一收窄点、补丁与其清单项已消失） |
| `tests/evolution-dream-client.test.mjs`（13 条） | ✔（面板文案、手动精炼、审批 diff、刷新失败保留快照） |
| `tests/harness-owner-candidates.test.mjs` | 4 pass / 7 fail，全部失败点在 `t.after` 的 `rmSync`：`EPERM ... harness-owner-*`。这些临时目录里是 `evolution/evolution.db`，进程退出后同一个目录可正常删除 → 失败原因是 teardown 时 sqlite 句柄尚未释放（Windows 语义），断言内容本身没有失败 |

### 与本改动无关的既有失败（平台/环境）

- `tests/evolution-records.test.mjs`：整文件按 POSIX 断言（`/tmp/dsh/evolution`、目录 0700、库 0600），Windows 上必然失败（`actual: C:\tmp\dsh\evolution`）。
- `tests/harness-owner-candidates.test.mjs` 的 7 条：teardown `EPERM`（同上 sqlite 句柄）。
- `tests/source-runtime.test.mjs` 的 3 条：mempalace 缓存路径、两个 profile 路径迁移（既有）。
- surfcore / 语音 / ASR / QQ 对齐等：子进程加载器在 Windows 下的既有失败。

判定方法：逐条读失败断言定位性质——`evolution-records` 的断言本身写的是 POSIX 路径与 unix mode；`harness-owner-candidates` 的失败点是 `t.after` 里的 `rmSync` 抛 `EPERM`（Windows 上 sqlite 文件句柄未释放）；其余文件（surfcore、语音、ASR、QQ、profile 迁移）本轮完全没有触碰。这些文件在本次改动前就是同一批失败面（上一轮 DV-EV-019 日志 `docs/logs/2026-11-autodream-preset/v0.1.0-b/verification.md` 记录了同一批既有失败）。本轮真正需要同步的是补丁计数、Dream 面板文案与 `ticketId → requestId`，均已按新行为改写并通过。

## 静态检查

- `node --check` 覆盖 `plugins/dsh-evolution/src/{index,dream-session,dream,dream-tool}.mjs`、`plugins/dsh-laputa/internal.mjs`、`scripts/dream-refine.mjs`：全部通过。
- `Select-String` 全仓扫描 `startDreamOnce|registerDreamTool|ticketOf`：无残留引用。
- `Select-String` 扫描 `superagent-dream.patch` 的剩余引用：只剩历史日志/调研记录（保留作为决策留档），无代码或清单引用。
- `docs/` 中 `dream-executor.md`、`autodream.md` 已按新链路重写；`docs/research/autodream-session-type.md` 追加 §5.1 记录最终决策。

## 改名后的针对性复跑

| 命令 | 结果 |
| --- | --- |
| `node --test tests/dream-preset.test.mjs tests/evolution-dream-client.test.mjs` | 13 pass / 0 fail |
| `cd plugins/dsh-laputa; npx vitest run tests/{http,internal,candidates}.spec.ts` | 52 pass / 0 fail |
| `cd plugins/dsh-continual-harness; npx vitest run tests/{owner-candidates,skill-owner,panel}.spec.ts` | 32 pass / 1 skip |

## 工作副本行尾

`patches/superagent-patches.json`、`tests/harness-owner-candidates.test.mjs`、`plugins/dsh-continual-harness/tests/owner-candidates.spec.ts`、`plugins/dsh-laputa/tests/http.spec.ts` 的工作副本是 CRLF，而仓库里存的是 LF，导致 `git diff` 把整文件算成改动。已把这四个文件规范化回 LF：现在 `git diff --stat` 只显示真实改动（分别为 3 / 26 / 6 / 2 行）。
