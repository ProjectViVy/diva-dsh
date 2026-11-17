# laputa 人格注入收窄 · 验收

| 编号 | 标准 | 状态 |
| --- | --- | --- |
| A1 | `dsh-superagent-router` 会话仍获得 `laputa:persona` 与 onboarding 段 | 单测覆盖（`carriesPersona` + 注入用例） |
| A2 | `dsh-superagent-worker` 会话两者都不再获得 | 单测覆盖（注入用例断言 `injectedWith` 为空） |
| A3 | 普通会话行为不变 | 单测覆盖（无 preset 用例） |
| A4 | `laputa_init` 与人格段同进同退 | 代码：同一 `carriesPersona` 守卫 |
| A5 | 类型与构建通过 | `typecheck` / `build` 通过 |
| A6 | 运行期生效 | **未完成**：需重启宿主，留待用户确认时机 |

## 重启后要看的（运行期验收）

1. 新建一个会话问「你是谁」→ 应仍答 DIVA（人格未受影响）。
2. 主 Session（superagent）任一回合结束后，检查其系统提示仍含 `laputa:persona`（Laputa 面板 sections 视图或会话自述）。
3. 触发一个 worker 任务，在其 Executor 会话里查看系统提示 → **不应**再有 `laputa:persona`，`laputa_init` 也不在工具表里。
