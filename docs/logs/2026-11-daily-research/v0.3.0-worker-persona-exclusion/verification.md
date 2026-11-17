# laputa 人格注入收窄 · 验证记录

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 单测 | `npm test`（`plugins/dsh-laputa`） | **17/17 文件通过；Tests 280 passed · 7 skipped**；新增 6 条用例全绿 |
| 类型 | `npm run typecheck` | 通过 |
| 构建 | `npm run build` | 通过 |
| 运行期 | — | **未做**：需重启宿主；当前 GUI 正在承载对话 |

## 逐条对照（改动前 → 改动后）

| 场景 | 前 | 后 |
| --- | --- | --- |
| 普通会话（无 preset） | 人格段 + `laputa_init` | 不变 |
| subagent / delegated child | 不注入 | 不变 |
| `dsh-superagent-router`（main Session） | 人格段 + `laputa_init` | **不变（符合项目目的）** |
| `dsh-superagent-worker`（Executor） | 人格段 + `laputa_init` | **都不注入** |

## 遗留

- `vitest` 退出码仍为 1：`tests/index.spec.ts` 产生 7 个 unhandled rejection（`Component web server port is unavailable`，来源 `src/index.ts:124` → `_shared/ipc.mjs:39`）。属测试环境缺 webServer 端口，与本次改动无关；**未取证改动前基线**（工作区存在他人未提交改动，未做 stash）。
- 工作区另有既有未提交改动：`internal.mjs`、`src/candidates.ts`、`tests/{candidates,http,internal}.spec.ts`——非本次改动，提交时须排除。
