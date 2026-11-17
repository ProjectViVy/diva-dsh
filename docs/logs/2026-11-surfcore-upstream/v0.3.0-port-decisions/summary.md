# v0.3.0 移植决策记录 + P0–P2 排序（只读）

- 状态：已交付（决策已入档，未改代码）
- 范围：`docs/research/surfcore-port-decisions.md`（新建）、`plugins/dsh-mempalace`（只读）、`plugins/memory`（只读）、上游 `src/vector-memory.js`（只读）
- 验证：见 `verification.md`
- 未验证：sqlite-vec 动态维度建表、`bili-memory.recallBlock` 调用点、DSH 自身压缩机制、上游 `session-rollover` 实现
- 下一步：DV-UP-002，等 P0-1 开工
- 回滚：无代码改动

## 改了什么

没有改代码。产出：

1. `docs/research/surfcore-port-decisions.md`：11 条口径逐条映射、逐条调研、P0/P1/P2 表、依赖顺序、明确不纳入清单。
2. 读完上游 `src/vector-memory.js` 全文（约 700 行），提取出它真正的机制（分空间索引、四段打分、敏感闸门、脱敏、manifest 原子写），而不是照 changelog 复述。
3. 核实本仓现状：MemPalace 是单 `vec0(float[384])` 单空间、无 `model` 列、维度硬校验；`plugins/memory/src/bili-memory.mjs:848` 已有非向量的 `recallBlock`。

## 影响面

- 无运行时影响。
- 决策面：把「向量记忆移植」从「搬一整个系统」收窄成「4 件管线 + 1 个前置改造」；把「多模型空间」从可选功能提升为 P0 前置（否则 512 维接不进来）。
- 明确排除 8 类条目，避免以后反复讨论（多群隔离、语音、云端四家、Ollama runtime、模型代理、更新器壳、记忆卡语义、tone 层）。

## 未验证

- `vec0(embedding float[512])` 能否与 `float[384]` 在同一库共存（sqlite-vec 版本依赖）：未跑，属实施第一步。
- `bili-memory.recallBlock` 是否在生产被调用（只读到定义，没找到调用点）。
- DSH 0.2.1-rc.5 自身是否有上下文压缩/收割：`docs/architecture.md` 无条目，未查 `deepseek-harness/` 源码。
- 上游 `src/session-rollover.js` 的交接块格式：只读 changelog 描述。

## 备注

- **追加（2026-11-13 03:55，用户「决策先记录在案」）**：把 11 条口径固化成报告 §0「决策台账（已定案）」D1–D11，含每条的状态（已定案 / 不采纳 / 部分采纳）与**复盘触发条件**；同时写进知识图谱 7 条事实（surfcore-port 的 5 条 rejected/decided + dsh-mempalace requires 多索引空间）。台账规则：后续会话不得自行翻案，翻案只在表末追加行、不删旧行。
- 取舍：第 7/8 条（QQ 修复）本来想给「最小可搬清单」，读完落点后放弃——`safe-text.js` 这类新模块的调用点在 `bridge.js`，单独搬是死代码。这比给一张看起来可执行的清单更诚实。
- 与 DV-UP-001 的关系：DV-UP-001 决定「整体升不升级」，本条决定「不升级也能拿走什么」。两条不冲突：P0 全部落在 `plugins/` 内，不碰锚点面。
