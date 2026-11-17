# 发布说明

## 变更

- 新增 `patches/superagent-worker-today.patch`：只改 `superagent/src/app/context.ts`，把今日卡规则拼进 `workerPrompt`（worker 角色的内置正文）。
- `patches/superagent-patches.json` 追加该补丁（共 13 条）。
- `superagent/lib` 已按 13 条补丁重建，运行期加载的就是这份产物。
- `tests/source-runtime.test.mjs`：补丁清单断言十二条 → 十三条。
- 仓库根 `AGENTS.md` **没有动**：lead 删掉的那段保持删除（工作区里 AGENTS.md 的改动是 lead 的，不属于本轮）。

## 影响面

- 只有新开的 Superagent ticket worker 会话吃到这段；master、普通 DSH 会话、lead 的 DSH 子 agent 都吃不到。
- 运行中的 3082 宿主仍是旧 lib，需要重启一次才生效。

## 回滚

- 从 `patches/superagent-patches.json` 移除 `superagent-worker-today.patch` → `node scripts/build-bundle.mjs` → 重启。
- 本轮没有单独备份旧 `superagent/lib`：`withTemporaryPatch` 每次重建都是确定性的，移除补丁重建即回到旧提示词。

## 注意

- 上游 `superagent/` 未改：`git -C superagent status --short` 为空，改动只在 `patches/`。
- 规则正文只在补丁里一份，本目录不复制，避免两处不一致。