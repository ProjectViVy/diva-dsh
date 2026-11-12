# v0.3.0 · PENS 预研：两仓功能盘点 + 交界洞察

- 主题：`2026-11-landscape`
- 版本：`v0.3.0-pens-preresearch`
- 日期：2026-11-12 (Asia/Shanghai)
- 关联条目：`DV-DOC-012`
- 性质：**纯文档**，未改任何代码、未提交

## 做了什么

1. 五个子代理并行只读盘点两套工作台：淋雨家（场景/面板、外部应用与 MCP、机制规矩）× 本仓（插件清单、平台能力面）；每条结论带 `路径:行号`，区分「有代码 / 仅文档 / 占位」。
2. 两份专项调研：租约与权限（DSH/Grok/Alife/本仓架构对照）、四宿主 MCP 端到端实测（隔离配置，不碰用户真实配置）。
3. 产出两份文档：
   - `docs/research/pens-preresearch-inventory.md`（功能清单，两仓对照）
   - `docs/research/pens-preresearch-insights.md`（十条洞察 + 租约八字段 + 对设计的七条修订）

## 关键结论

1. 外部应用接线在生态里碎成三态（引擎侧 MCP / 壳 spawn 进程 / 页面自动化桥），跨形态没有统一生命周期——**PENS 的位置是收敛状态机，不是第四条通道**。
2. 有 API 的应用已被现成 MCP server 覆盖（Blender 32 / CUA 57 / ComfyUI 39 / 剪映 8）→ 适配器族的价值在**无 API 的应用**；设计 §4 需加「第 0 族：复用现成 server」。
3. **生态里没人把租约过期与抢占做全**（DSH 有 owner 围栏无 TTL、Grok 无租约、Alife 无 owner 无 TTL）→ 这是 PENS 的真空白，已给出八字段契约。
4. 本机零外部应用 → **M0 验收对象从模拟器改为 CDP 网页族**。
5. 调研纪律：三个「文档说有、代码没有」的实例（假配置 / 死 UI / 注释当契约），必须写进规矩。
6. 四宿主 MCP 实测：**能连 4/4，能调通 1/4**（Codex；Claude/pi 卡在既有凭证 401，DSH 走仓内 e2e）。并发现**工具面是协商结果**（同一 server：Codex 15 / Claude 15 但集合不同 / pi 14）与**Windows 上 `npx` 静默失败**。

## 未验证（本轮）

- Claude Code / pi 的实际 `tools/call`：两处既有凭证均 401，按约束未改用户配置、未交互登录。
- Codex 的 resources/prompts 是否真的不发（只观察到 `initialize`+`tools/list`）。
- 淋雨家 `patchReload=live` 是否真热重载（注释与文档互相矛盾）。
- Electron 壳置顶/穿透/30fps（未写 demo）。
- CDP 对 canvas 游戏的可读性（M0 第一天验）。
- 「生态没人做租约过期」仅 4 个实现抽样。

## 下一步

1. 回填四宿主实测矩阵 → 更新 insights §6/§10。
2. 用户拍板：M0 是否开工、M0 验收对象（CDP）、是否把七条修订折叠进 `pens-design.md` v0.3.0。
3. 若开工：先做 `pens-core` 的 4 工具 + 租约 + 错误码，接 CDP 族。
