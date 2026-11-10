# 验证记录 v0.2.0

> 只写事实：命令、预期、实际。禁止只写「通过」。

| # | 检查 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `(Get-Content AGENTS.md).Count` | ≤160 行（文件自称上限） | **86 行** |
| 2 | `Get-ChildItem scripts/lib -Name` | 存在 `surfcore-*.mjs` 锚点补丁文件 | 有 `surfcore-bridge-hooks.mjs`、`surfcore-component-patch.mjs`、`surfcore-runtime-transform.mjs`、`surfcore-console.mjs`、`surfcore-panel.mjs`、`surfcore.mjs` |
| 3 | `Test-Path patches/superagent-patches.json` | True | **True** |
| 4 | `Test-Path stage-app/vendor/live2dcubismcore.min.js` | False（专有资产需自备） | **False** —— 与「不入库」一致，规则措辞已改为「需使用者自备」 |
| 5 | `Test-Path .artifacts/dsh-home` | True（`DSH_HOME` 落在项目内） | **True** |
| 6 | `node --version` | 满足 `^22.19.0 或 >=24` | **v24.14.1** |
| 7 | `package.json` 脚本名 | AGENTS.md 里引用的 `setup`/`start`/`stop`/`status`/`test` 均存在 | 六个全部存在；另有 `setup:<component>` 系列 |
| 8 | 死链：AGENTS.md 引用的路径 | 全部存在 | `TODOLIST.md`、`docs/logs/`、`docs/architecture.md`、`patches/`、`plugins/`、`scripts/`、`tests/`、`skills/`、`stage-app/`、`.workspace/` 均存在 |
| 9 | 注入验证 | 改写后被 DSH 重新注入 | 写入后本会话立即收到“Updated instructions from: AGENTS.md”，内容与磁盘一致 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| `npm run setup` / `npm test` | 本次是纯文档改动，跑安装会重写 `.artifacts` 与 submodule 状态，风险大于收益 | 下一次真正改代码时 |
| 规则被遵守的程度 | 只能观察后续会话行为，无法静态验证 | 第一个真实任务 |

## 反向验证

未做。纯文档改动，破坏面为零；回滚是一条 `git checkout -- AGENTS.md`。
