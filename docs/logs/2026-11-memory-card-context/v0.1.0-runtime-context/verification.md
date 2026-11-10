# 验证记录 v0.1.0

> 只写事实：命令、预期、实际。禁止只写「通过」。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node --test tests/memory-card-prompt.test.mjs` | 9 项通过 | 9 pass / 0 fail（含「注册 context 且不注册 section」「router 也投递」「subagent 不投递」） |
| 2 | 真实 `SystemPrompt` 装配探针（`packages/core/system-prompt` 下用 `node --input-type=module` 装载 `lib/index.js` + `card-prompt.mjs`） | router 的 `assemble().contexts` 含 `actmem:card` 文本；subagent 文本为空；`refreshContext` 换文案后取到新文本 | 三处均符合（`router` 有卡、`subagent` 空文本、`refresh` 返回 v2） |
| 3 | `npm test` | 根测试全通过 | 未通过：大量与本次无关的既有失败（voice 用例、sqlite 0700/0600 权限断言、mempalace、evolution 等）。失败的测试文件不 import `memory`；`tests/voice-plugin.test.mjs`、`tests/voice-registration.test.mjs` 单独运行也失败（Windows 路径断言 + `scripts/surfcore-loader.mjs` 的 `file://` URL 处理），属本机既有问题 |
| 4 | `git -C plugins/memory status --porcelain` / 根 `git status --porcelain` | 只含本次改动；不混入他人未提交内容 | 子模块内 `README.md`、`src/card-prompt.mjs`、`src/service.mjs`；根仓库 `tests/memory-card-prompt.test.mjs`、`TODOLIST.md`、`docs/logs/2026-11-memory-card-context/`（其余脏文件为其它会话既有改动，未 stage） |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 普通会话的 runtime context 快照含 `【记忆卡` | 运行中的 DSH 进程仍是旧代码；重启会终止当前托管会话 | 用户重启后按 `acceptance.md` 第 1–2 步 |
| router 主 Session 收到卡 | 同上 | 同上第 4 步 |
| subagent 不收到卡 | 同上 | 同上第 5 步 |
| 关开关后下一步快照无卡 | 同上 | 同上第 7 步 |

## 反向验证

- 注册用例断言 `section` 未被调用（测试名 `… installs one non-interpolated runtime context and no section`）。把注册改回 `systemPrompt.section(...)` 会让该用例变红。
- 白名单用例断言 router 为 true、subagent 为 false。把 `excludePresets` 分支加回来会让 router 断言变红。
- provider 用例断言「指纹变了但内容没变时不重渲染」。把内容 hash 判据换成指纹判据会让该用例变红。
