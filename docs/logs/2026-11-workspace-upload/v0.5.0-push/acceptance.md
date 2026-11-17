# 验收清单

1. 打开 `https://github.com/ProjectViVy/diva-dsh/commits/main`，最新三条依次是 `fix: pin superagent to its upstream commit`、`docs: record the world gateway voice and moss work`、`feat: wire the capability hub setup and gateway voice tests`。
2. `https://github.com/vivy-dsh/dsh-local-voice/commits/main` 最新是 `feat(voice): add the world gateway dashscope route pack`（`6cebdf6`）。
3. `https://github.com/vivy-dsh/word-gateway/commits/main` 最新是 `feat: add the in-process speak service and the moss realtime slot`（`1fb9bc3`）。
4. `https://github.com/vivy-dsh/dsh-evolution/commits/codex/native-refinement-20261117` 最新是 `feat: run Dream refinement in native DSH sessions`（`f0d4e36`）；`dsh-continual-harness` 同名分支最新 `f3bf638`。
5. 本机任意仓库执行 `git status --short`：本轮三个仓应干净；根仓只剩另一处进行中的 ASR 接线。
6. 换一台机器 `git clone --recurse-submodules https://github.com/ProjectViVy/diva-dsh.git && npm run setup`：submodule 应能全部初始化（superagent 不再指向取不到的本地提交）。

不通过时看 `summary.md` 的「未同步」一节，并核对 `git rev-list --all --not --remotes` 是否仍为 0。
