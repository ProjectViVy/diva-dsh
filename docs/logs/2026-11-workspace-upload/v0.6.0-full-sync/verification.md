# v0.6.0 验证记录

## 1. 上传前盘点（25 个 submodule + 根仓）

| # | 命令 | 结果 |
| --- | --- | --- |
| 1 | `git -C <每个 submodule> rev-list --count HEAD --not --remotes`（25 个） | **全部 0**：没有任何「本地有、上游没有」的提交 |
| 2 | `git -C <每个 submodule> status --porcelain` | 只有 3 个仓有未提交改动：`plugins/asr`、`plugins/voice`、`plugins/capability-hub` |
| 3 | 根仓 `git status --porcelain --ignore-submodules=all` | 3 改 + 1 新增（`TODOLIST.md`、`scripts/setup-capability-hub.mjs`、`tests/voice-settings-client.test.mjs`、`tests/asr-gateway-engine.test.mjs`） |
| 4 | 25 个 gitlink 与各自实际 HEAD 逐对比较 | 全部一致（没有脏指针） |
| 5 | 后端 behind 计数（`deepseek-harness` 4803、`third-party/genui` 53、`plugins/surfcore` 3） | 只是本地没拉最新，**不是**本轮问题；判断依据是第 1 行 |

## 2. 测试

| # | 命令 | 结果 |
| --- | --- | --- |
| 6 | `node plugins/capability-hub/tests/asr.test.mjs` | 13 / 13 / 0 |
| 7 | `node tests/asr-gateway-engine.test.mjs` | 8 / 8 / 0 |
| 8 | `node tests/voice-settings-client.test.mjs` | 22 / 22 / 0 |
| 9 | `node tests/capability-hub-setup.test.mjs`（断言已按新行为改） | 5 / 5 / 0 |
| 10 | `node tests/asr-mount.test.mjs`（假 ctx 已补 `inject`） | 3 / 3 / 0 |
| 11 | `npm test`（`node --test tests/*.test.mjs`） | **1495 项 / 1485 通过 / 0 失败 / 10 跳过，exit 0**，68.5 s |

说明：本轮环境一开始的沙箱禁止子进程使用命名管道，`node --test` 的 runner 起不了子进程，
逐文件跑会得到一堆 `EPERM` 假失败（`asr-mount` 还会因为异常路径不退出而挂住）。
上面的第 11 行是**放开文件权限后**用标准命令跑出来的结果，不是把假失败当通过。

## 3. 提交

| # | 仓 | commit |
| --- | --- | --- |
| 12 | `plugins/asr` | `e9dc44b` `feat(asr): add the world gateway recognition engine` |
| 13 | `plugins/voice` | `0e87e6b` `feat(voice): surface the current voice source in the settings panel` |
| 14 | `plugins/capability-hub` | `937e811` `feat: add the in-process transcribe service and the asr route` |
| 15 | 根仓 | `c84b578` `feat: wire the capability hub asr slot and cover the gateway engine` |
| 16 | 根仓 | 本目录所在 `docs:` commit |
| 17 | 三个插件仓 `git status --short` | 全部空 |

## 4. 推送与远端核对

| # | 命令 | 结果 |
| --- | --- | --- |
| 18 | `git -C plugins/asr push origin main` | `49f6a48..e9dc44b`（快进） |
| 19 | `git -C plugins/voice push origin main` | `6cebdf6..0e87e6b`（快进） |
| 20 | `git -C plugins/capability-hub push origin main` | `1fb9bc3..937e811`（快进） |
| 21 | 根仓 `git push origin main` | `9c272c3..c107c7d`（快进） |
| 22 | 四个仓 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 逐对比较 | **逐个相等**：根 `c107c7d…`、asr `e9dc44b…`、voice `0e87e6b…`、capability-hub `937e811…` |
| 23 | 26 个仓（根 + 25 个 submodule）`git rev-list --count HEAD --not --remotes` | **全部 0**：没有任何「本地有、上游没有」的提交 |
| 24 | 根仓 `git status --porcelain`（推送后） | 空；三个插件仓同样为空 |

全程普通 `git push`，没有 `--force`、没有重写任何远端历史；四条推送都是 fast-forward。
推送顺序是**先三个子仓、后根仓**，这样根仓的 gitlink 指向的提交在被引用之前就已经在上游可取。
