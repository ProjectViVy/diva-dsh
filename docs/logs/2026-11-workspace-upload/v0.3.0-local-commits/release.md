# 本地提交与回滚

## 子仓提交

| 仓库 | 分支 | 提交 | 内容 |
| --- | --- | --- | --- |
| plugins/voice | main | 7627bc88 | fix: repair mixed-separator voice pack paths |
| plugins/dsh-continual-harness | codex/native-refinement-20261117 | f3bf638c | refactor: bind refinement candidates to Dream requests |
| plugins/dsh-evolution | codex/native-refinement-20261117 | f0d4e36c | feat: run Dream refinement in native DSH sessions |
| plugins/dsh-laputa | main | 74fb9e67 | refactor: authorize persona candidates through Dream requests |
| plugins/dsh-laputa | main | a1c889d8 | fix: exclude executor presets from persona injection |
| plugins/dsh-mempalace | main | 0729a0f9 | feat: add memory spaces with cloud embeddings and recall |
| plugins/dsh-vivy-studio | main | 2157f847 | feat: keep the daily workspace outside sidebar groups |
| plugins/dsh-see-now | main | 2070f77d | feat: expose capture lifecycle controls and event history |
| stage-app | main | 828bf5c3 | chore: exclude bundled Hiyori model assets |
| plugins/dsh-daily | main | 00f05c32 | feat: add the daily workspace and structured today cards |
| plugins/dsh-superagent-reset | main | 0cd5bea8 | feat: queue reversible Superagent session resets |
| plugins/dsh-ui-scope | main | 034a0757 | feat: scope genui access to Superagent sessions |

## 根仓提交

基线：`a431930`。

| 提交 | 内容 |
| --- | --- |
| df07d87f | fix: make source runtime and regression fixtures portable on Windows |
| e9dac034 | feat: add a project-local web development loop |
| 56c60d5c | refactor: move Dream refinement out of Superagent tickets |
| b6d0771a | feat: wire memory spaces, embedding probes and recall checks |
| 3ec9a7fe | fix: give the SurfCore panel a fixed frame and scrolling body |
| 403d3bf8 | chore: pin the stage without bundled Hiyori assets |
| f2d5e9d4 | feat: integrate the daily workspace and source-installed plugin tiers |
| 本目录所在 docs 提交 | 补齐项目文档、历史交付记录、任务状态与本轮四件套 |

## 上传与回滚

本轮全部是本地提交。新插件远端尚无源码；上传前先把各子仓提交推送到其远端分支，确认可获取后再推送根仓，不能只推根仓。Harness/Evolution 的新提交位于表内命名分支，勿误把旧 main 当成本轮成果。

如需回滚，按相反顺序用 `git revert` 回退主题提交，并同时回退对应子模块指针，不使用 reset 重写共享历史。子仓原 HEAD 与完整分支状态记在 `.artifacts/workspace-commits-20261117/before.json`；初始 staged/worktree 补丁快照同目录保留。

Hiyori 模型仍在本机原位；取消跟踪前的索引与文件清单仍在 `.artifacts/workspace-upload-20261117/`。daily 原 README 在本轮 artifacts 目录备份；私人插件目录完全保留。
