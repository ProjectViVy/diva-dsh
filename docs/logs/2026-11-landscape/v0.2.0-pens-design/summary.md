# v0.2.0 PENS 设计与接入：四工具 + 五族适配器 + 深度分级

- 状态：已交付（**纯设计文档，未写代码、未装依赖、未跑游戏**）
- 范围：新建 `docs/research/pens-design.md`（约 380 行）；本目录四件套；`TODOLIST.md` 增 DV-DOC-011
- 追加（同日，§15）：四宿主（DSH / Codex `0.167.0` / Claude Code `2.1.216` / pi `0.80.7`）能力矩阵，基于本机 `--help` 与子命令实测；定出 P0/P1/P2 适配优先级与四条架构决定（双入口、一份 AGENTS.md 文档、用户域常驻服务、治理自持）
- 验证：见 `verification.md`（仅文档结构与事实一致性检查）
- 未验证：libretro 内存接口、CDP 对 canvas 的可读性、BepInEx 版本绑定、两 host 的 MCP 能力、任何一款游戏的实际可玩性
- 下一步：等用户对「M0 是否开工」与 D7–D9 的修订版（双 PEN）拍板
- 回滚：删除 `docs/research/pens-design.md` 与本日志目录，撤销 TODOLIST 条目

## 改了什么（结论层面）

1. **接口恒定 4 工具**：`pens_catalog` / `pens_attach` / `pens_observe` / `pens_act`；动作集走 `schema_uri` 资源按需拉取，不按应用注册工具。依据是淋雨家 MCP 面板的实测（Blender 32 工具 ≈8.9k token/轮、桌面操控 57 ≈26.8k）。
2. **覆盖杠杆改为「族」不是「游戏」**：5 个接口族适配器（libretro / CDP / Mod 框架 / UIA / 像素）+ 每游戏一份声明式 profile。核心公式：可玩数 ≈ Σ族 × profile 覆盖率 × host 支持深度。
3. **深度分级 D0–D3**（旁观/有限操作/能玩完一局/跨会话续局），账本只报实测值。
4. **观察压缩**：summary / region / frame 三档 + delta + 帧去重 + 预算护栏（超限自动降档）。
5. **时间模型**：回合制由 agent 驱动；实时由 PENS 驱动时钟；合帧不积压、超时即停、不可暂停的实时只给 D0。
6. **接入协议**：MCP 传输 + profile 清单 + 身份/租约（play 独占、spectate 只读）+ 权限四级（含 `network` 默认拒绝）+ 6 类结构化错误码 + 制品只给路径与 sha256。
7. **分期 M0/M1/M2**：M0 = 4 工具 + 模拟器族 + 3 份 profile + 租约 + 错误码，两 host 各玩 10 分钟；明确不做商店/桌面壳/反作弊/联网竞技。
8. **D7 修订**：首个 PEN 改为两个——Blender（有 API 的生产力应用）+ 模拟器族（覆盖杠杆），理由是单一选择学不到产品形状。

## 影响面

- 用户可见：无（纯文档）。
- 对既有决策：D7 被建议改为「双 PEN」；D8 增加硬约束「工具面恒定、schema 走资源」；D9 给出落地方式（catalog 分级 + observe 档位由宿主传参 + 总线只降档）。
- 重启要求：无。

## 未验证

1. libretro / BizHawk 的内存接口在不同核心上的可用性与稳定性——未跑过任何模拟器；
2. CDP 能否读到 canvas 自绘游戏的状态（很可能只能退化到像素）——未测；
3. BepInEx/SMAPI 与游戏版本的绑定成本与灰度策略——未测；
4. Codex / Hermes 的真实 MCP 能力（是否支持 resources、progress、cancellation）——未测；
5. 任何一款游戏的可玩性（D1/D2/D3 的验收口径是设想的，未经实战）；
6. 观察压缩的实际省幅（「≤400 token/轮」是估算，不是测量）。

## 备注

- 取舍：按 `more-faster-better-economical` 的「最小一致系统」，首版只做一族一 host 链，不做商店/面板/多族并行；像素兜底只做 D0。
- 备选：若用户坚持「先证明能玩一款商业大作」，则把 M0 换成 C 族（Mod 框架）单游戏深适配，代价是覆盖杠杆为零、且绑定具体游戏版本——不推荐，但可行。
