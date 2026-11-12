# v0.0.2-deep-dive mnemos 源码级深挖

- 状态：已交付（**纯文档，未改任何代码/配置/依赖**）
- 范围：`docs/research/mnemos-deep-dive.md`（新建）；`docs/research/mempalace-obsidian-integration.md`（§5 修正 + 深挖链接）；`TODOLIST.md`（登记）；本日志目录
- 验证：见 `verification.md`（克隆后逐条只读核对，带命令与输出）
- 未验证：见下「未验证」段
- 下一步：等用户就 `mempalace-obsidian-integration.md` §7.2 的 A/B/C 路线拍板
- 回滚：删除深挖报告与本日志目录，并把 survey 的两处改动还原即可；未触碰运行时

## 改了什么

行为层面：**没有变化**。本轮把上一轮的候选 `mnemos` 从「读 README」升级为「读源码」。

产出的六件事：

1. **定性**：`mnemos` 是产品不是插件——全仓 0 个 `manifest.json`，「Obsidian-native」指数据格式，不是 UI 集成。
2. **架构链路**：`JSONL → SessionEnd hook → detached worker（refine/brief/identity）→ Sessions/*.md → SessionStart 简报 / 5 个 MCP 工具`。
3. **数据模型**：Session 笔记六段骨架 + frontmatter 字段、tags 前缀、`_identity/L0-identity.md`、简报五层预算。
4. **失败复盘**：v0.x 原子宫殿被作者整条删除（~3000 行、~200 测试），四个量化信号（RRF 0.014–0.017、663 抽屉/860 实体一半是 wing 名、600 节点图无人走、整篇胜碎片）。
5. **八条硬伤**：最重的是 **P0 语义索引不自动更新**（全仓只有 `reindex` 写索引），其次是单向量整篇截断、wing/room/hall 空过滤、Windows 钩子耦合。
6. **借鉴清单**：笔记 schema、readiness gate、幂等账本三条可落地；「别把产品焊在宿主 hook 上」一条明确不抄。

## 对上一轮结论的修正

| 上一轮说法 | 源码事实 |
| --- | --- |
| 「文件监听：vault 增删改自动同步向量索引」 | v1.0 已删除 watcher，只剩配置字段；索引靠手动 `mnemos reindex` |
| 「R@5 0.90，说明检索可用」 | 0.90 是 v0.x 原子范式的数；v1.0 新范式的基准（ROADMAP v1.3.0）仍是 `⏸` |

## 影响面

- 用户可见行为：无。
- 数据：无写入、无迁移（`.workspace/mnemos/` 是参考克隆，不参与构建、不入库）。
- 性能：无。
- 依赖方：无。
- 重启要求：**无**（纯文档）。

## 未验证

1. **作者自述「556 pass」**：本机没装 `chromadb`/`mcp` 等依赖，未跑 `pytest`；496 是静态统计的 `def test_` 数。
2. **Windows hook 真机行为**：`CREATE_BREAKAWAY_FROM_JOB`、5s 窗口、settings.json 写入都只是读代码，没实测。
3. **索引陈旧的实际体感**：结论由「全仓只有 `reindex` 调 `index_raw_bulk`」推断，未跑真实 vault 复现。
4. **社区数据（4★/2 fork/0 issue/24 下载/月）是快照**，会变。

## 备注

- 本机 `pwsh` 在文件策略切到 `danger-full-access` 后恢复可用，`git clone` 与统计命令均为真实执行（上一轮因 sandbox temp-root 校验全部不可用）。
- 按 `AGENTS.md` §6「不自动提交」，本轮未提交。
