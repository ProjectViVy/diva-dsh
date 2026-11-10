# v0.1.0 Dream 执行器模式

## 目标

AutoDream 的 worker 曾经是普通 agent：`bash`/`pwsh`/`write`/`edit` 全开，
工作目录又在仓库里（`.artifacts/dsh-home/state/superagent-local/work/<ticket>/`）。
2026-11-10 那次运行虽然审计确认没有改动任何源码（85 次工具调用全部落在工作目录内），
但它确实在仓库里写了 9 个 `.mjs` 辅助脚本和约 4.9 MB 证据 dump——因为 4.4 MB 的
`evidence.json` 装不进上下文，只能自己写脚本切块。

本轮把它改成专用执行模式：工具集收窄到 `skill` + `dream_refine`，材料由工具分页提供，
计划由工具内联接收。没有 shell 就写不出脚本，也改不了源码。

## 改动

| 文件 | 改动 |
| --- | --- |
| `patches/superagent-dream.patch`（新） | `DREAM_TOOLS = ['skill', 'dream_refine']`；`Sessions#workOnly` 按 Ticket 起源 Input 判定 Dream 并选用该子集 |
| `patches/superagent-patches.json` | 清单追加该补丁（第 12 个，排在最后） |
| `plugins/dsh-evolution/src/dream-tool.mjs`（新） | `dream_refine` 工具：claim / evidence（分页 + 单条全文）/ baseline / plan（内联）/ execute / status，全部绑定 `worker-<ticketId>` |
| `plugins/dsh-evolution/src/index.mjs` | 注入 `tools`，注册该工具 |
| `plugins/dsh-evolution/src/dream.mjs` | Input 正文改为指向 `dream_refine`，不再下发 CLI 路径；移除 `fileURLToPath` |
| `skills/diva-dream/SKILL.md` | 改写为工具工作流（无 shell、分页读、内联 plan），删掉 `plan --file` 与 CLI 说明 |
| `docs/dream-executor.md`（新） | 模式判定、工具契约、边界与回滚 |
| `docs/autodream.md` | 流程图与 Executor 工作流程改为 Dream 执行器；批准入口改为「进化 → 审批」 |
| `README.md` | 自我进化条目指向 Dream 执行器文档 |
| `tests/dream-tool.test.mjs`（新）+ 插件内测试 | 5 条工具测试 |
| `tests/source-runtime.test.mjs`、`tests/dream-skill-install.test.mjs` | 清单数量 11→12；skill 断言改为新文案 |

## 判定依据

Ticket 的起源 Trigger 带 `meta.input.layer === 'evolution'` 且 `externalEventId` 以 `dream_` 开头
（`dream.mjs` 提交 Input 时就是这么写的）。不用标题文字，也不用 `human` 标志——手动 refine 的
`human` 同样是 `true`。

## 取舍

- **最简方案**：一个补丁改工具子集 + 一个工具模块。备选是「独立 profile/独立进程」，能给出更强的
  OS 级隔离，但要新增 profile 引导、进程数与部署路径，成本高一个数量级，而 Dream 现在没有任何需要
  shell 的步骤。
- 不引入 Docker/Python（与 DV-EV-014 的决定一致），也不加自动验证。
- `scripts/dream-refine.mjs` 保留给带 shell 的人调试；Dream 会话不再收到它。
