# 验证记录

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `git -c safe.directory='*' -C <repo> rev-list --count --all --not --remotes`（27 个仓） | 全部 0 |
| 2 | `git -C . status --short`（根仓，提交后） | 只剩另一处未提交的 ASR 接线 |
| 3 | `git -C plugins/voice status --short`（提交后） | 空 |
| 4 | `git -C plugins/capability-hub status --short`（提交后） | 空 |
| 5 | `git -C . ls-remote origin refs/heads/main` | `e2d0a7f…`，与本地 HEAD 相同 |
| 6 | `git -C plugins/voice ls-remote origin refs/heads/main` | `6cebdf6…`，与本地 HEAD 相同 |
| 7 | `git -C plugins/capability-hub ls-remote origin refs/heads/main` | `1fb9bc3…`，与本地 HEAD 相同 |
| 8 | `git -C plugins/dsh-evolution branch -r --contains HEAD` | `origin/codex/native-refinement-20261117` |
| 9 | `git -C plugins/dsh-continual-harness branch -r --contains HEAD` | `origin/codex/native-refinement-20261117` |
| 10 | `git -C plugins/surfcore fetch --unshallow origin` 后复算 | 本地独有提交 0；HEAD 是 `origin/main` 的祖先（在 tag `v0.8.6` 上） |
| 11 | `git -C superagent fetch --unshallow origin` 后复算 | 本地独有提交 0；`8c32a9d` 可读 |
| 12 | temp depth-1 clone superagent 后 `cat-file -e 6337fc8` / `8c32a9d` | 旧 pin 取不到（exit 1），新 pin 存在（exit 0） |
| 13 | temp depth-1 clone surfcore 后 `fetch origin 59ec306 --depth 1` | 成功（可达 SHA 直取可用） |
| 14 | `node --test plugins/capability-hub/tests/*.test.mjs` | 49 通过 / 0 失败 |
| 15 | `node --test tests/voice-plugin.test.mjs tests/voice-gateway-inprocess.test.mjs tests/capability-hub-setup.test.mjs` | 167 项、165 通过、2 跳过、0 失败 |

未跑：`npm test` 全量（本轮只做同步，被测内容与 TODOLIST 中记录的验证一致；全量已知有 1 项 `memory-actmem` 时间窗既有失败）。
