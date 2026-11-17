# 验收 v0.1.0 AutoDream 定因

> 本轮是只读调研，交付物是文档，**没有可执行验收**；下列为「报告可核对项」，供用户抽查。

## 可核对项（读报告时逐条对照）

1. `docs/research/autodream-auto-admission.md` §2.1 的 manifest 片段能在
   `.artifacts/dsh-home/evolution/dream/subject_9a005bfc-433b-42b6-aecb-079903d8a485/manifest.json` 里逐字找到（`lastCheck` / `lastAttemptAt` / `lastCompletedAt`）。
2. §2.3 的 decision 行能在 `orchestrator.sqlite` 的 `decision` 表按 `id=97813868d6ec1573a5c52816a90391c2` 查到，`kind` 与 `reason` 一致。
3. §2.4 的哈希复算可在本机重跑（命令见 `verification.md` 第 9 行），结果必须是 `9fbbf9a0cf77f5da1785bc7d03d13b0b`。
4. §2.5 的「手动能成、自动不能」可由 `manifest.json` 的 4 条 manual 请求 + 1 条 automatic 请求的 `status` 对照确认。
5. §6 决策清单 D1–D6 每条都有选项、推荐、影响面，符合 `diva-research-to-decision` 的交付要求。

## 不适用

- 改代码/重启/面板点击流验收：本轮未改任何实现，故不适用。
- 性能与依赖验收：无依赖变动。

## 拍板后才做的验收（先记在这里）

- D1=A 时：重启后自动检查产生新 Input，`decision` 表出现 `kind:accept`，`ticket` 表新增 Ticket，Dream worker 出现 `dream_refine` claim 记录，`lastCompletedAt` 前进。
- D1=B 时：同上，另加 `superagent` 侧 input patch 测试通过、`npm run setup` 重渲染后 `--check` 通过。
- D3=F1 时：人为让一次自动请求被忽略，面板「最近尝试」旁必须出现「上次尝试被忽略：ignoredFromCard」。
