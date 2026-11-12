# 验证记录

本轮在 Windows / Node v24.14.1 执行。原始输出留在本机 `.artifacts/workspace-upload-*-tests.log`，不提交缓存日志。

| 检查 | 实际结果 |
| --- | --- |
| 首次 `npm test` | 出现失败且 voice 测试子进程不退出；为完成盘点，终止本轮测试树，没有停止开发服务器 |
| `node --test --test-timeout=30000 tests/*.test.mjs` | 1317 tests：1160 pass、151 fail、6 skipped，退出 1，约 62 秒 |
| 本轮变更相关 9 文件测试 | 132 tests：123 pass、9 fail；失败集中于 source-runtime 与 tone 配置断言，未全部定因 |
| 7 个界面/接线文件测试 | 60 pass、0 fail |
| Harness `npm test` | 686 pass、2 fail、1 skipped；失败为 logfile.spec.ts / plugin.spec.ts 要求 POSIX mode 0600，Windows 返回 0666 |
| Harness `npm run build` + `npm run typecheck` | 两项退出 0 |
| Laputa `npm test` | 274 pass、7 skipped、0 fail |
| Laputa `npm run build` + `npm run typecheck` | 两项退出 0 |
| Evolution `node --test tests/*.test.mjs` | 20 pass、0 fail |
| 世界网关 `node --test tests/*.test.mjs` | 26 pass、0 fail |
| SurfCore `npm run test:audit` | 有大量通过输出，但在脚本子进程未结束时中断；不计全量通过 |
| `npm run setup:third-party -- --check` | 退出 0；dsh-context v0.83.1 已构建、已登记，声明覆盖 DSH rc.5 |
| 自有脏仓 `git diff --check` | 退出 0 |
| 上传候选密钥格式扫描 | 182 个改动/新文件，0 命中；扫描私钥、GitHub token、长 sk key、带长 token 的 URL，仅为模式扫描，不代替代码审计 |

7 文件命令：`node --test --test-timeout=15000 tests/dream-skill-install.test.mjs tests/evolution-dream-client.test.mjs tests/laputa-panel.test.mjs tests/vivy-sidebar-core.test.mjs tests/vivy-skin-css.test.mjs tests/vivy-tone-client.test.mjs tests/third-party-setup.test.mjs`。

9 文件检查在以上基础上加 `tests/source-runtime.test.mjs` 和 `tests/vivy-tone.test.mjs`，timeout=20000。

## 已看到的失败类别

- Windows 路径分隔符与 `/tmp`、`/project` 字面量不一致。
- ESM 动态导入直接传 `C:` 绝对路径，报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
- POSIX 文件权限断言与 Windows 实际 mode 不一致。
- voice 测试子进程长期存活，首次全量没有结束；二次增加 test timeout 才完成输出。
- 其他 schema、迁移、loader、路径与脚本断言仍需逐项复现和基线比较；不能将全部 151 fail 归为环境问题。

## 未验证

真实模型 key、外部 IM、完整 setup、端内交互、像素验证与 SurfCore audit 全量结果没有在本轮补做。没有因上传备份修改业务代码或屏蔽失败测试。

## 上传核对

六个自有插件已成功推送各自 origin/main；主仓库前五组提交已推到 origin/main，并读回远端 a1934e4 与本地一致。本轮状态与四件套另作最后一笔 docs 提交，提交后再次推送和比对 HEAD。

主仓库保留的唯一上游脏状态为 SurfCore。未上传 node_modules、.artifacts、.workspace、凭据或许可排除资产。
