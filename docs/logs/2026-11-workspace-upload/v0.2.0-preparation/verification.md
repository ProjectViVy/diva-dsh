# 验证记录

## 文件与仓库

- 开始时根仓 `main`：`a431930`，对本地缓存的 `origin/main` 为 `0/0`，不是实时远端同步声明。
- 原有暂存项：`.gitmodules`、`plugins/dsh-see-now`、`third-party/genui`；本轮没有重写根仓 index。
- 原有 7 个自有子仓有改动：voice、continual-harness、evolution、laputa、mempalace、vivy-studio、see-now。新增 stage-app 的资产排除整理。
- 3 个新远端：`gh repo view --json nameWithOwner,isEmpty,visibility,url` 均返回 `isEmpty: true`、`PUBLIC`；本地 origin 与之对应。
- 三个新插件 `git check-ignore` 确认 `.env`、`node_modules/`、`.artifacts/` 被排除；根 `.artifacts/` 与私人 `user-plugins/dsh-oil-ui/` 被排除，仅私人目录 README 是候选文件。
- Hiyori 18 项在取消跟踪后全部仍存在；`git -C stage-app ls-files -- demo/Hiyori vendor/live2dcubismcore.min.js` 无输出，`check-ignore` 确认两类路径命中排除规则。
- `git diff --check` 与 `git diff --cached --check`：根仓、stage-app 均通过；其余既有子仓审计未发现空白错误。
- 初始候选清单跨根仓及子仓共 19,376 个文件；按私钥、常见服务 token、JWT、凭据 URL、长字面量秘密规则扫描文本。自有文件仅命中 `tests/proxy-config.test.mjs` 的测试用 URL，未发现真实密钥。此扫描不是完整安全审计；未审计既有 Git 历史、二进制或所有上游测试误报。
- 初始大于 5 MB 的候选仅第三方既有演示视频（约 63 MB）；未新增或改动该子模块 pin。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| 根全量，无沙箱、默认 Git 设置 | 1475 项，1460 通过，5 失败，10 跳过，exit 1 |
| 根全量，仅测试进程关闭 autocrlf | 1475 项，1465 通过，0 失败，10 跳过，exit 0（64.4 秒） |
| Harness `npm test` | 689 项，686 通过，2 失败，1 跳过，exit 1 |
| Laputa `npm test` | 287 项，280 通过，7 跳过，exit 0 |
| see-now `npm test` | 513 项，492 通过，21 跳过，exit 0 |
| Evolution `node --test tests/*.test.mjs` | 32 通过，exit 0 |
| Harness / Laputa `npm run typecheck` | 均 exit 0 |
| 资产排除后的 `node --test tests/live2d.test.mjs` | 46 项，44 通过，2 跳过，exit 0 |

根全量 5 项失败都位于 `tests/source-runtime.test.mjs`，实际文本为 CRLF、断言要求 LF。`git config --show-origin --get core.autocrlf` 确认系统配置为 `true`。复验仅设置测试进程环境 `GIT_CONFIG_COUNT=1`、`GIT_CONFIG_KEY_0=core.autocrlf`、`GIT_CONFIG_VALUE_0=false`，执行 `node --test --test-timeout=120000 tests/*.test.mjs`，不修改持久 Git 配置。

Harness 两项失败为 `tests/logfile.spec.ts:151` 和 `tests/plugin.spec.ts:255`，Windows `stat.mode & 0777` 返回 `0666`，断言要求 `0600`。本轮保留测试与产品实现，继续由 DV-TEST-001 跟踪。

最初的沙箱 `npm test` 另遇临时目录 EPERM、计时失败与两个 voice 子进程不退出，不能当作有效通过。本轮只终止该次检查的两个 voice 测试进程树；后续无沙箱完整复验已正常结束。原始日志保留为 `root-tests.tap`，无沙箱结果为 `root-tests-unrestricted.tap`，临时关闭换行转换的结果为 `root-tests-lf.tap`。

## 未验证

- 没有重跑完整 setup、重建 Superagent bundle、宿主重启或业务 GUI 验收；既有任务中的待验收项保持不变。
- SurfCore 源码本轮未改，未重跑其 audit；上游三仓工作树最初及结束时均干净。
- 三个新仓没有首个提交，尚未注册成根仓子模块；提交推送后才可从新环境克隆验证。
- Hiyori 资产仍在 stage-app 的既有历史中；没有重写历史或删除远端内容。
