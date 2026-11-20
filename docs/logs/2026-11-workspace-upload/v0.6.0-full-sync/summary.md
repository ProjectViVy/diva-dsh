# v0.6.0 全量上传：世界网关 ASR 能力服务同步到上游

主人 2026-11-21 05:34：「最近的开发已经够多了，看看能不能先全量上传一下 diva-dsh 同步一下最新开发进度。」

## 一句话结论

工作区里**最后一处未提交的开发**（世界网关 = 能力服务 / ASR 接入那批改动）已提交并推送到上游：
3 个插件仓各 1 条 commit、根仓 3 条 commit（代码 + 文档 + 推送核对）。全量套件
**1495 项 / 1485 通过 / 0 失败 / 10 跳过，exit 0**。四条推送都是 fast-forward，
推送后 26 个仓（根 + 25 个 submodule）的「本地有、上游没有」提交全部为 0。
其余 22 个 submodule 本来就没有未推送提交，本轮没动它们的指针。

## 上传前的工作区状态（先核，再传）

对 25 个 submodule 逐个查了 `rev-list --count HEAD --not --remotes`：

- **有未推送提交的：0 个**。
- **有未提交改动的：3 个** —— `plugins/asr`、`plugins/voice`、`plugins/capability-hub`。
- **根仓未提交**：`TODOLIST.md`、`scripts/setup-capability-hub.mjs`、`tests/voice-settings-client.test.mjs`、
  新增 `tests/asr-gateway-engine.test.mjs`。
- 25 个 gitlink 指针原本与实际 HEAD 全部一致（没有「指针脏了」的情况）。

这正是 v0.5.0 那份日志末尾写下的「未同步（如实记下）」那一处：当时判为半成品、留在工作区，
落定并验证后再单独同步一轮。本轮就是那一轮。

## 上传了什么

### 插件仓

| 仓 | commit | 内容 |
| --- | --- | --- |
| `plugins/asr`（`dsh-local-asr`） | `e9dc44b` `feat(asr): add the world gateway recognition engine` | 新增 `src/engine-gateway.mjs`（+128）；`src/index.mjs` 订阅 `capabilityHub` 并注册第二引擎（+14/−1） |
| `plugins/voice`（`dsh-local-voice`） | `0e87e6b` `feat(voice): surface the current voice source in the settings panel` | `src/client.js` 收口线路→语音包映射、四处写清来源、修掉 dashscope 被写成「本地合成」（27+/10−） |
| `plugins/capability-hub`（`word-gateway`） | `937e811` `feat: add the in-process transcribe service and the asr route` | `createTranscribe` + `POST /api/asr`（12 MiB 上限）+ 百炼 ASR 适配器 + 13 条测试（392+/17−） |

### 根仓

| commit | 内容 |
| --- | --- |
| `c84b578` `feat: wire the capability hub asr slot and cover the gateway engine` | `scripts/setup-capability-hub.mjs` 接 asr 插槽；新增 `tests/asr-gateway-engine.test.mjs`（8 条）；`tests/voice-settings-client.test.mjs` +47；**修掉两条测试回归**（见下）；3 个 gitlink 指针 |
| `c107c7d` `docs: record the gateway asr capability service and this full sync` | 补 `docs/logs/2026-11-world-gateway/v0.2.0-capability-service-asr/` 四件套 + 本目录 + `TODOLIST.md` |
| 紧接着的 `docs: record the push verification` | 把推送后的远端 tip 与 26 个仓的未推送计数写进本目录 `verification.md` §4 |

## 上传核对时发现的问题（都已修，且都在本轮）

1. **`plugins/asr` 新增 `ctx.inject` 但挂载契约测试的假 ctx 没有 `inject`** → `apply()` 抛错，
   3 条挂载测试全红，且**测试进程不退出**（HTTP server 没人关，120 秒后被超时杀掉）。
   修：给假 ctx 补 `inject`，3/3 通过、进程正常退出。
2. **`scripts/setup-capability-hub.mjs` 改成接线 asr 插槽，但它的测试仍断言「脚本不碰 asr」** →
   5 条全红。修：断言改成 asr 被接线 + 幂等不改用户手填值 + `DSH_ASR_MODEL` 覆盖，5/5 通过。
3. **两处换行符污染**：`tests/voice-settings-client.test.mjs`（工作树 CRLF / 索引 LF，diff 假装改了
   1391 行，真实 47 行）、`plugins/asr/src/index.mjs`（同病，整文件重写）。提交前统一成 LF。

不修这三处，这次「全量上传」推上去的就是一个红着的套件。详细原因与验证见
`docs/logs/2026-11-world-gateway/v0.2.0-capability-service-asr/verification.md` §3–§4。

## 未做 / 未验（如实列）

- **没有重启 3082**，也没有跑隔离实例：本轮的运行期现象（面板观感、麦克风到出文字）仍未验证，
  验收清单在 `docs/logs/2026-11-world-gateway/v0.2.0-capability-service-asr/acceptance.md`。
- **没有改任何远端默认分支的历史**：全程普通 `git push`，无强推、无重写。
- 22 个没有改动的 submodule 本轮**没有 fetch 到最新**，它们的 behind 计数不代表上游没更新，
  只代表本地没拉——本轮的判断依据是「本地有没有上游没有的提交」，不是「上游有没有新提交」。

## 日志

- `verification.md`：逐条命令与结果（含推送后的远端核对）
- `release.md`：影响面与回滚
