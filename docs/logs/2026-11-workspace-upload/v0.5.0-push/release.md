# 推送分支与提交

| 本地仓库 | 远端 | 分支 | 推送后 SHA |
| --- | --- | --- | --- |
| plugins/voice | vivy-dsh/dsh-local-voice | main | `6cebdf6` |
| plugins/capability-hub | vivy-dsh/word-gateway | main | `1fb9bc3` |
| 根仓 | ProjectViVy/diva-dsh | main | `e2d0a7f`（源码 `52d18ab` + 文档 `d7bc24b` + 重钉 `e2d0a7f`） |

`superagent` gitlink 由 `6337fc8` 改为 `8c32a9d`，只改指针，子模块内容不变（树相同），子模块仓本身仍是上游只读。

没有创建 PR、tag 或 release；没有强推；没有合并 `dsh-evolution` / `dsh-continual-harness` 的 `codex/native-refinement-20261117` 到 `main`（沿用 v0.4.0 的决定）。

回滚方式：新增 revert 提交并同步回退根仓 gitlink，不删除历史。
