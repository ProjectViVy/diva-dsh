# 发布记录 v0.0.1-model-selection

- 类型：研究文档（无代码、无配置、无依赖、无迁移）
- 是否发版：否。不涉及任何组件版本号变化，不需要 `npm run setup`、不需要重启。
- 运行中状态：DSH 与全部插件保持原样（`http://127.0.0.1:3082` 未受影响）。

## 交付清单

| 文件 | 类型 | 说明 |
| --- | --- | --- |
| `docs/research/qwen-platform-model-integration.md` | 新建 | 千问AI平台的模型选型评估（P0–P3 + 不接清单 + 成本 + 风险 + 待决策） |
| `docs/logs/2026-11-qwen-platform/v0.0.1-model-selection/summary.md` | 新建 | 本轮做了什么、影响面、未验证 |
| `docs/logs/2026-11-qwen-platform/v0.0.1-model-selection/verification.md` | 新建 | 15 次文档抓取 + 7 处只读核对的证据表 |
| `docs/logs/2026-11-qwen-platform/v0.0.1-model-selection/acceptance.md` | 新建 | 用户视角验收步骤 |
| `docs/logs/2026-11-qwen-platform/v0.0.1-model-selection/release.md` | 新建 | 本文件 |
| `TODOLIST.md` | 修改 | 登记 `DV-DOC-003`（waiting-user），列入 `## NOW` |

## 回滚

1. 删除 `docs/research/qwen-platform-model-integration.md`。
2. 删除 `docs/logs/2026-11-qwen-platform/`（整目录）。
3. 从 `TODOLIST.md` 的 `## NOW` 移除 `DV-DOC-003` 条目。

以上三步无不可逆操作；未触碰代码、配置、密钥、子模块，回滚后仓库回到本会话开始前的状态（仅文档层差异消失）。

## 后续（不在本轮）

- 用户拍板 D1 后的实施轮：P0 需在 profile 的 `llm-pi-ai.providers` 增路由 + 一次最小验证；P1 需新增 `plugins/asr/src/engine-openai-asr.mjs` 与测试。
- 两者都会触发「改配置 → 重启 DSH → 复测」，届时按 AGENTS.md §3 走 `npm run stop && npm start`。
