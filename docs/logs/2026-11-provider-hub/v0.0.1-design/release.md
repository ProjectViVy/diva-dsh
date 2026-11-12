# 发布记录 v0.0.1-design

- 类型：设计文档（无代码、无配置、无依赖、无迁移）
- 是否发版：否；不涉及版本号，不需要 setup 或重启。
- 运行中状态：DSH 与全部插件保持原样（`http://127.0.0.1:3082` 未受影响）。

## 交付清单

| 文件 | 说明 |
| --- | --- |
| `docs/research/provider-hub-and-gateway.md` | 中控台 + 网关设计（结论/三家对照/DSH 接缝/数据模型/阶段/风险/待决策） |
| `docs/research/capability-hub-slots.md` | 实施篇：现状一屏、第一批四项候选、四个插槽（规格/adapter/绑定/消费面）、骨架与验收 |
| `docs/logs/2026-11-provider-hub/v0.0.1-design/summary.md` | 本轮做了什么、未验证 |
| `docs/logs/2026-11-provider-hub/v0.0.1-design/verification.md` | 13 次文档抓取 + 7 处源码核对的证据表 |
| `docs/logs/2026-11-provider-hub/v0.0.1-design/acceptance.md` | 用户视角验收 |
| `docs/logs/2026-11-provider-hub/v0.0.1-design/release.md` | 本文件 |
| `TODOLIST.md` | 登记 `DV-DOC-008`（waiting-user）；`DV-DOC-007` 条目保留 |

## 回滚

1. 删除 `docs/research/provider-hub-and-gateway.md`。
2. 删除 `docs/logs/2026-11-provider-hub/`。
3. 从 `TODOLIST.md` 移除 `DV-DOC-008` 条目。

未触碰代码、配置、密钥、子模块。

## 后续

- D1 选「先做 M0」→ 新建 `plugins/dsh-model-hub`（独立仓）+ 根 `scripts/setup-model-hub.mjs`，按 §3 实现 registry/投影/面板。
- D1 选「先手工接三家」→ 只改 `cordis.patch.yml` + 三处凭据，中控台顺延；这条路 0.5 天可验证全部 key。
