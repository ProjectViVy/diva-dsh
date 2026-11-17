# 验证记录 v0.2.0

> 只写事实：命令、预期、实际。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `web_fetch https://raw.githubusercontent.com/Mieksido/surfcore/v0.8.9/CHANGELOG.md` | 拿到 0.8.7–0.8.9 全量条目 | HTTP 200，含 `[0.8.9]` / `[0.8.8]` / `[0.8.7]` 三节全文（0.8.7 节最长，跨十余个子节） |
| 2 | `web_fetch /contents/src?ref=v0.8.9` | 确认 v0.8.9 有哪些 `src/` 模块 | HTTP 200，含 `web-search.js`(25KB)、`vector-memory.js`、`embedding-packs.js`、`session-rollover.js` 等 |
| 3 | `git cat-file -e <v0.8.6>:src/command-spam.js` 等 15 个路径 × 两版本 | 哪些模块是钉点之后新增 | 8 个新增：`command-spam.js`、`safe-text.js`、`dsh-model-follow.js`、`vector-memory.js`、`embedding-packs.js`、`session-rollover.js`、`wake-batch.js`、`schema-values.js`；6 个既有：`dsh-health.js`、`v2-wait.js`、`group-policy.js`、`web-search.js`、`bili-memory.js`、`state-acl.mjs`、`dsh-port.js`（其中 `dsh-port.js` 亦为既有） |
| 4 | `git log --oneline --no-decorate HEAD..origin/main` + `rev-list --count` | stable 线上的新提交数 | 1 个提交（`0ce8580 release: v0.8.9`），据此确认 0.8.7/0.8.8/0.8.9 是 squash 式累积发布，changelog 才是特性来源 |
| 5 | `git tag --contains` / `for-each-ref refs/tags` | 本地能否凭 tag 定位版本 | 本地仅有 `v0.8.9` 一个 tag（shallow 子模块），故版本归属改用 GitHub API `refs/tags` 与 changelog |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 逐条读 diff 确认修复→文件归属 | 只读纪律下不 checkout v0.8.9；`git show`/`diff` 的 stdout 被沙箱管道限制阻断，只能靠 `git archive` 落盘（上一轮只取了 9 个锚点文件） | D1 选 B 开工后，`git archive` 取全量 `src/` 再逐条核 |
| `git fetch --tags` 刷新本地 ref | 沙箱拒绝 `git` 的 stdout 管道（`\\.\pipe\LOCAL\dotnet_*` denied） | 需要提权或沙箱外执行 |

## 反向验证

确认「按版本号排序」会误导：0.8.7 单节里同时含 rc.5 生死线（`agentPreset`）与纯 UI 条目（网盘弹窗、管理员输入框 border-box），二者对决策的权重差几个数量级——所以报告改用「价值 × 成本类型」两维排序。
