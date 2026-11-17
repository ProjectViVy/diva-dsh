# 交付物

| 文件 | 说明 |
| --- | --- |
| `docs/research/dsh-0.2.2-upgrade.md` §10 | 追加：本地真 diff 与上游位置复核、体量、新东西三层清单、决策影响（D1 增候选、D6/D7）、未核实 |
| `docs/logs/2026-11-upstream-dsh/v0.1.1-local-diff-survey/{summary,verification,acceptance,release}.md` | 本轮四件套 |
| `TODOLIST.md` DV-UP-002 | 追加本轮事实与新的候选；状态仍 `waiting-user` |

## 没有交付的

- 任何代码、配置、profile、submodule 指针改动（本轮只读）。
- 升级方案的实施文档（按纪律等拍板后再写）。

## 回滚

本轮唯一副作用是 submodule 的 `origin/master` 引用被更新（`.git` 内部），以及 `deepseek-harness/` 里新增的远程跟踪分支；工作树与指针未变。要回到「没有 origin/master」的状态，删掉该 remote-tracking ref 即可，不影响 pin。
