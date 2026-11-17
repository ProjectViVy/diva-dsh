# 二次推送核对（2026-11-18）

- 状态：done。v0.4.0 推送之后新增的世界网关语音 / 模思接线已全部推送到上游；`superagent` 的本地独有 pin 改成上游可达的提交。
- 起因：主人 2026-11-18 07:1x「再次检查一下，本地的所有内容已经同步到上游，例如 evo 和 dream。不要本地有的特性上游还没有的。」

## 做了什么（先子仓、后根仓）

1. `plugins/voice` → `6cebdf6`（7 文件 / +364）：第三条线路 `voice-dashscope`、进程内合成（`capabilityHub` 服务，拿不到才退回 HTTP）、百炼 wav 头修复、网关错误分类与回退。
2. `plugins/capability-hub` → `1fb9bc3`（17 文件 / +896）：`capabilityHub.speak()` 与 `POST /dsh-capability-hub/api/tts`、百炼 TTS 适配器、模思第五接入点与 `realtime`（`wss://`）插槽、面板真插槽。
3. 根仓：
   - `52d18ab` 接线：`setup:capability-hub`、网关探测脚本、两套测试、两个 gitlink 指针；
   - `d7bc24b` 文档：4 个世界网关日志目录、3 份调研、TODOLIST；
   - `e2d0a7f` superagent 重钉。
4. `superagent`：`6337fc8` → `8c32a9d`。两者树逐字节相同，旧 SHA 不在上游任何 ref 上（`refs/pull/*` 也没有），depth-1 克隆后取不到，fresh `git submodule update --init` 会失败；换成上游 `main` 上的同树提交。

## 验证

- 27 个本地仓（根仓 + 25 个 submodule + `user-plugins/dsh-oil-ui`）`git rev-list --all --not --remotes` 全部为 0：没有任何「本地有、上游没有」的提交。
- 工作区干净（本轮三个仓）且远端 tip 与本地 HEAD 逐字相等：`diva-dsh` `e2d0a7f`、`dsh-local-voice` `6cebdf6`、`word-gateway` `1fb9bc3`。
- `plugins/surfcore`、`superagent` 原有 shallow 边界造成的「本地独有」计数，unshallow 后复算均为 0；`surfcore@59ec306` 在上游 tag `v0.8.6` 上，`deepseek-harness@b830ec9` 在上游 `master` 上。
- evo / dream：`plugins/dsh-evolution` `f0d4e36`、`plugins/dsh-continual-harness` `f3bf638` 都在 `origin/codex/native-refinement-20261117` 上；`main` 按 v0.4.0 的决定没有合并该分支（根仓 gitlink 直接锚定分支 SHA，fresh clone 可初始化）。

## 未同步（如实记下）

核对期间工作区出现另一处**未提交**的 ASR 接线（不是本轮改动）：`capability-hub` 的 `src/adapters/dashscope-asr.mjs`、`asr` 的 `src/engine-gateway.mjs`、`voice` 的客户端改动、根 `scripts/setup-capability-hub.mjs` 的 asr 插槽。它没有随附测试，按「不替别人提交半成品」留在工作区；落定并验证后需要单独同步一轮。

无强推、无远端历史重写，没有改动任何远端默认分支。
