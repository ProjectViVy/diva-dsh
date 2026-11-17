# 本轮验证

原始输出保存在 `.artifacts/workspace-commits-20261117/`，不入库。

| 命令 / 范围 | 结果 |
| --- | --- |
| 提交前根全量 | 1475 项，1465 通过，10 跳过，0 失败，exit 0，80.1 秒 |
| 整理后根全量 | 1475 项，1465 通过，10 跳过，0 失败，exit 0，65.6 秒 |
| Harness `npm test` | 689 项，686 通过，2 失败，1 跳过，exit 1 |
| Laputa `npm test` | 首轮并行运行时 1 项超过 5 秒；单独完整复跑 287 项，280 通过、7 跳过，exit 0 |
| see-now `npm test` | 513 项，492 通过，21 跳过，0 失败，exit 0 |
| Evolution `node --test tests/*.test.mjs` | 32 项全部通过，exit 0 |
| Harness / Laputa `npm run typecheck` | 均 exit 0 |
| daily 两个测试文件 | 79 项，75 通过、4 跳过，exit 0 |
| daily `npm pack --dry-run --json --ignore-scripts` | exit 0，文件表包含 VENDORED-genui.md |
| `node scripts/setup-see-now.mjs` | exit 0，补丁已应用且反向检查可识别 |

根全量仅在该测试进程环境设置 `GIT_CONFIG_COUNT=1`、`GIT_CONFIG_KEY_0=core.autocrlf`、`GIT_CONFIG_VALUE_0=false`，执行 `node --test --test-timeout=120000 tests/*.test.mjs`，没有修改系统或全局 Git 配置。默认系统 `core.autocrlf=true` 的五项换行断言问题见上一轮 v0.2.0。

Harness 两项失败仍为 `tests/logfile.spec.ts:151`、`tests/plugin.spec.ts:255`：Windows 返回 `0666`，断言要求 `0600`；已登记 DV-TEST-001。本轮是用户授权的本地成果提交，不宣称所有插件检查通过。

## 审查与边界

只读审查覆盖根仓包装、跨仓依赖、安装路径和资产/凭据边界。审查指出首次安装说明缺第三方步骤，以及模块清单过期，均以最小文档修正处理。没有把安装脚本扩成新的自动第三方安装流程。

子仓提交前均执行 worktree/index 的 `git diff --check`。根仓每组暂存后执行 `git diff --cached --check`；新加入文件的多余 EOF 空行按检查结果清理，统一 diff 的必要上下文标记保留。

最终核对 25 个子模块工作树均干净，根仓 gitlink 全部与其本机 HEAD 一致；上游三仓 HEAD 与本轮开始时相同。stage-app 已提交树不含 Hiyori 或专有 Core，18 个 Hiyori 本机文件仍在原位。最终暂存文档另做常见密钥、私钥与带凭据 URL 扫描，未命中。

未跑完整 setup、未重启主宿主、未重新验证业务 GUI 或 worker 自动写卡。新提交尚未推送；尤其三个新插件远端仍为空，因此不能声称他人已能递归克隆这些新版本。根仓必须等子仓提交先推送后才适合上传。
