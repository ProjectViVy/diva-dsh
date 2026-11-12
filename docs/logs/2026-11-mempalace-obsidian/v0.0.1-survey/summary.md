# v0.0.1-survey MemPalace × Obsidian 开源项目调查

- 状态：已交付（**纯文档，未改任何代码/配置/依赖**）
- 范围：`docs/research/mempalace-obsidian-integration.md`（新建）；`TODOLIST.md`（登记）；本日志目录
- 验证：见 `verification.md`（只读核对，逐条有输出）
- 未验证：见下「未验证」段
- 下一步：等用户在 A（插件直连）/ B（markdown 导出）/ C（vault 真源）中选定路线，再开实施条目
- 回滚：删除报告与本日志目录即可；未触碰运行时

## 改了什么

行为层面：**没有变化**。本轮只产出调研文档与状态登记。

报告回答的三件事：

1. **那个项目是哪个**：不存在官方 Obsidian 插件；`topic:mempalace` 77 个仓库里 Obsidian 相关的只有 6 个，最接近的四个按「记忆点」对号入座（§2.3）。
2. **它们各是什么**：
   - `mempalace-explore`（0★）唯一直接读宫殿，但形态是 Web 应用（L3）；
   - `mnemos`（4★）把记忆做成 Obsidian 原生 markdown，插件只在 roadmap（L2）；
   - `reliquery`（5★）反向：vault 当真源、palace 当索引（L2）；
   - `minhlucvan/mempalace-obsidian`（0★）空仓，已排除。
3. **我们该走哪条**：A 插件直连只读切片最省；当前真正缺口是「第三方本机客户端读通道」——面板 API 有 DSH 会话鉴权（`http.mjs:85-92`）且无 CORS，Obsidian 拿不到数据。给出 M0–M2 里程碑与验收口径。

## 影响面

- 用户可见行为：无。
- 数据：无写入、无迁移。
- 性能：无。
- 依赖方：无。
- 重启要求：**无**（纯文档）。

## 未验证

1. **Obsidian `requestUrl` 绕 CORS**：结论来自官方 API 文档存在该函数，未在真实插件里实测。
2. **Obsidian 原生 Graph View 不可注入节点**：社区经验判断，无官方 API 文档背书。
3. **上游 `mempalace serve` v3.8+ 的 token/streamable HTTP**：只读 `mempalace-explore` README，未独立核实。
4. **`sqs-agent-memory` / `memoriki` 的许可证**：未抓 LICENSE。
5. **Obsidian 官方社区插件目录未全量核对**：jsDelivr 抓取被截断，报告里未据此下结论。
6. **检索计数（77 / 13 / 6 / 1 / 2）是 2026-11-10 匿名 GitHub API 的快照**，会随生态变化。

## 备注

- `web_search` 在本机不可用（缺 `DEEPSEEK_API_KEY`），本轮全部走 GitHub API + raw + `r.jina.ai` + DuckDuckGo HTML。
- 按 `AGENTS.md` §6「不自动提交」，本轮未提交。
