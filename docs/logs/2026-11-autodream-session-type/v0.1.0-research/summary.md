# v0.1.0 AutoDream 独立会话类型（「自动精炼模式」）调研

- 状态：已交付（**纯只读调研，未改代码/配置/数据**）
- 范围：新建 `docs/research/autodream-session-type.md`；本目录四件套；`TODOLIST.md` 增 DV-EV-019（决策闸门）、更新 DV-EV-018 的下一步
- 验证：见 `verification.md`（读源码/配置 + 运行时 `cordis_inspect_query` 读 preset 注册表）
- 未验证：见 §「未验证」
- 下一步：等用户就报告 §5 的 D1–D7 拍板；D1 定了才动手

## 目标

用户提出：Superagent 能路由事件是优点，但「不是所有 session 都该是 Superagent 子 agent」，普通/创造/极简各有各的必要；
AutoDream 应该是一种**独立的 session 类型**（「autodream 模式」）。本轮只调研这条方向能不能做、卡在哪、推荐怎么走。

## 结论（一句话）

能做，而且不需要新机制：DSH 的「模式」就是 agent preset，Superagent 能建会话只是因为它是个插件——dsh-evolution 是同一层插件，
同样可以自己声明一条 `dsh-autodream` preset 并自己建/喂/收尾；真正要拆的是 `dream.mjs` 里对 Ticket 的三处耦合。
推荐 **B（先换 preset）→ A（摘掉 Ticket）** 两步，不建议独立 profile/子进程。

## 改了什么

1. 新增 `docs/research/autodream-session-type.md`，结论先行，含：
   - 「模式 = preset」的机制盘点（4 条原厂 + 运行时 8 条注册，其中 `preset-qq-chat*` 是本部署自己的，证明新增 preset 是常规操作）；
   - Dream 现状链路与三处 Ticket 耦合的精确行号；
   - 候选 A/B/C/D 的「是什么 / 怎么接 / 代价 / 风险」与对比表；
   - 卡点 K1–K8、决策 D1–D7、拍板后的实施顺序、未验证清单。
2. `TODOLIST.md`：新增 DV-EV-019 决策闸门；DV-EV-018 的「下一步」改为指向本报告并注明 D1 可能取代上一轮方案选型。

## 影响面

- 用户可见：新增一份方向性调研与一个决策闸门条目；实现仍是 0。
- 数据/性能/依赖：无。未写 `.artifacts/`。
- 重启要求：无。

## 未验证

1. preset 会话上直接 `agent.ctx.tools.restrict` 是否可用（superagent 在 host 侧做过，evolution 未实测）；
2. dsh-evolution 的 bundle 层引用 `@deepseek-ai/dsh-tool-skill` / `skill-filesystem` 的解析基；
3. JS 插件不 import `@deepseek-ai/dsh-llm` 时能否完成等价投递；
4. 会话归档/删除是否有公开接口；
5. 自动会话在 Web UI 里点开的表现；
6. 所有改动量均为估算。

## 备注

- 取舍（`more-faster-better-economical`）：最简方案 B 先验证唯一未知（preset 能否挂载、`dream_refine` 是否可达），再拆 Ticket；
  备选是一步到位的 A。不做 C，因为 Dream 已无 shell，OS 级隔离换不来等价的复杂度。
- 反例意识：没有把「preset 存在」当成「工具面已受限」——报告里明确写了 preset 不是工具边界（root 工具仍可见），
  restrict 仍必须保留，只是改由 evolution 拥有。
- 与上一轮的关系：DV-EV-018 的方案 B（给 Input 加显式强度）仍然成立，但若采纳本条 D1=A/B，它是过渡手段而不是终局。
