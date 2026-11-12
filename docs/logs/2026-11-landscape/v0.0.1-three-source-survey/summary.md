# v0.0.1 三源工作台调研：本仓 / 淋雨家 / PENS（含参考物扫描）

- 状态：已交付（**纯文档，未改代码/配置/submodule**）
- 范围：新建 `docs/research/workbench-landscape.md`（450 行）；本目录四件套；`TODOLIST.md` 增 DV-DOC-010
- 验证：见 `verification.md`（读文件 + git 元数据 + GitHub API，未跑任何一方程序）
- 未验证：淋雨家壳在 rc.5 的兼容性、面板接口、Alife/grok-build 实机运行、免费 AI 桥可用性
- 下一步：等用户就报告 §9 的 D1–D6 拍板
- 回滚：删除 `docs/research/workbench-landscape.md` 与本日志目录，撤销 TODOLIST 条目

## 改了什么

1. 新增调研报告 `docs/research/workbench-landscape.md`，结论先行，含：
   - 仓库目录：`.workspace/` 5 个参考仓总表、本仓顶层目录树、淋雨家 15 板块表、PENS 完整目录、
     `ProjectViVy` 组织 10 个公开仓清单（证明 PENS 与本仓同组织、是兄弟项目而非外部竞品）；
   - 本仓现状（`docs/architecture.md` 六条核心决策 + 单一事实源表 + TODOLIST NOW）；
   - 淋雨家工作台：六层结构、记忆三层与字节红线、「把规矩变成机制」五步法、它自述的边界；
   - PENS 主仓库：6 条已确认决策、7 条提议、首个验证的六项证据、7 个待定项、历史来源链；
   - 三源对照矩阵（8 维度）、3 条共识、4 处分叉、5 项空白；
   - 参考物扫描：mnemos（记忆语义 + 「600 碎片 / RRF 0.014–0.017」实测反证）、Alife（插件打包 + OneBot v11 网关，AGPL 只读）、grok-build（插件=多组件捆绑 + 15 类 hook + 会话目录 + MCP/ACP 的标准清单）；
   - 风险 R1–R6、决策 D1–D6（每条含选项、推荐、影响面）、参考 URL 表与未核实项。
2. 未改动任何代码、插件、配置、`.gitmodules`、`.artifacts/`；`.workspace/` 下两个新仓为本次 clone，未纳入版本控制。

## 影响面

- 用户可见：无（纯文档）。
- 数据/性能/依赖：无。
- 重启要求：无。

## 未验证

1. 淋雨家 Electron 壳在 DSH `0.2.1-rc.5` 上能否运行（其模板自述验证于 `0.2.1-rc.3`）；
2. 其面板注册与 `sessionId` 三字段绑定接口与本仓 `dsh-vivy-studio` 的兼容性；
3. PENS 的任何集成（PENS 自身未实现任何运行时）；
4. Alife / grok-build 只做读源码级扫描，未运行、未编译；
5. 淋雨家「免费 AI 桥」（网页版 AI 经 MCP 接入）在本机的可用性。

## 备注

- 取舍：本轮只写报告与决策清单，**不实施 D1–D6 中任何一条**（按 `diva-research-to-decision` skill 要求，拍板前不开工）。
- 反例意识：报告特意把「未核实项」单列（§10 末），避免把推测写成结论。
- 报告内部已用 `AGPL-3.0` / `Apache-2.0` 标注 Alife 与 grok-build 的代码可用边界，防止后续误拷。
