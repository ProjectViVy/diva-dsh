# 推送分支与提交

| 本地仓库 | 远端分支 | 已推送 SHA |
| --- | --- | --- |
| plugins/voice | main | 7627bc88 |
| plugins/dsh-continual-harness | codex/native-refinement-20261117 | f3bf638c |
| plugins/dsh-evolution | codex/native-refinement-20261117 | f0d4e36c |
| plugins/dsh-laputa | main | a1c889d8 |
| plugins/dsh-mempalace | main | 0729a0f9 |
| plugins/dsh-vivy-studio | main | 2157f847 |
| plugins/dsh-see-now | main | 2070f77d |
| stage-app | main | 828bf5c3 |
| plugins/dsh-daily | main | 00f05c32 |
| plugins/dsh-superagent-reset | main | 0cd5bea8 |
| plugins/dsh-ui-scope | main | 034a0757 |

根仓：`ProjectViVy/diva-dsh` 的 `main`，源码提交已推送至 `aa0112e`；本目录所在文档提交是后续推送回执。

Harness/Evolution 的 `main` 未合并本轮命名分支，根仓 gitlink 直接锚定已发布分支上的 SHA。无需先合并 main 才能初始化子模块。

没有创建 PR、tag 或 release。需要回滚时新增 revert 提交并配套回退根仓指针，不通过强推删除历史；Hiyori 本机文件继续保留，旧历史中的资产本轮未清除。
