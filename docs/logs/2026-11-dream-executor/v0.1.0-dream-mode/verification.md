# 验证记录

## 已执行

| 命令 | 结果 |
| --- | --- |
| `node .artifacts/tmp/apply-patches.mjs`（按清单顺序重放 11 个补丁 + 新补丁） | 12/12 `git apply` 成功；`superagent` 树事后已还原为干净状态 |
| `npm run build:bundle` | exit 0，`Bundle rebuilt`——补丁经过 rolldown/tsdown 与 `tsc` 类型检查 |
| `node --test tests/dream-tool.test.mjs tests/dream-evolution.test.mjs tests/dream-skill-install.test.mjs` | 20 passed / 0 failed（ticket 绑定、分页、单条全文、plan 透传、execute、非 worker 拒绝、Input 正文、skill 文案） |
| `node --test tests/source-runtime.test.mjs` | 26 passed / 3 failed；清单测试通过（12 个补丁、顺序固定），3 条失败均为与本次无关的 Windows 路径分隔符断言（历史基线） |
| `npm test`（全量根测试） | 1274 tests / 1122 pass / 146 fail / 6 skipped；基线 1269/1119/144。新增 5 条工具测试全过；修复了 1 条因 SKILL.md 改写而失败的旧断言 |
| `git -C superagent status --porcelain` | 0（补丁只在构建期存在，源码树未被改动；重建 bundle 后再验一次仍为 0） |

## 本轮修掉的一个真实歧义

审计发现上一次运行的一个 Ticket 拥有 **两个** Dream Input（`dream_a454…` 与 `dream_4dc1…`）。而
`authorize()` 在没有 `requestId` 时取「这个 Ticket 拥有的第一个请求」，会让工具读到错误的那份材料。
现在 `claim` 会把 ticket → request 绑定进内存，后续每个命令都带上该 request；未 claim 就调其它命令直接
报错（`Call claim first`）。测试覆盖了这条路径。

## 未执行 / 未验证

- **运行中实例仍是旧 Executor**：补丁改的是 Superagent 源码，构建产物已重建，但当前进程（PID 17356）
  加载的是旧代码；本会话由该进程托管，不能自行 `npm run stop`。
- `dream_refine` 在真实 worker Session 中的工具可见性未经实测。理论路径：插件在根 ctx 注册 →
  `agent.ctx.tools.get(name, parent)` 可见 → `restrict({allow})` 放行。若不可见，Dream 会话只剩
  `skill`，表现为 Ticket 卡住而不是越权（fail-closed）。
- `evidence` 分页对真实 4.4 MB 材料的峰值内存与首屏延迟未测量；内存缓存上限为 1 个请求。
- 未做「故意让 Dream 会话执行 `rm -rf`」的对抗测试——需要重启后的真实运行。
