# 上游贡献 · v0.1.0-superagent-windows · 总结

- 目标：把「本地为跑通而打的补丁」里**与业务无关、上游会想要**的部分，整理成可以直接开 PR 的提交。
- 结论：本轮只筛出一条合格候选——`Superagent` 的 Windows 可移植性修复（`patches/superagent-windows.patch`）。工作副本、分支与 PR 文案都已备好，**卡在推送凭据**：本机没有 git 凭据（`git push --dry-run` 提示 `could not read Username`），`gh` 也未登录（`hosts.yml` 有用户 `mastwet`，无 token）。PR 未开。

## 为什么是这一条

| 候选 | 结论 | 依据 |
| --- | --- | --- |
| `patches/superagent-windows.patch` → `deepseek-ai/dsh-superagent-prototype` | **做** | 纯可移植性缺陷；不含 diva 业务；上游 `main` 至今仍是 `/^\//`、`executable()` 只找裸名、探针用 `env` 前缀 |
| `plugins/dsh-see-now` 的「我看到了」面板 → `SAOS-3624/dsh-see-now` | 暂不做 | 我们的 `HEAD` 与上游 `main` 同为 `1d98dd5`，差异只有未提交的面板（品牌名「我看到了」、移除 `settings.section`、VIVY 侧栏）。这是产品取舍，应先在 issue 里问上游要不要，而不是直接 PR |
| `scripts/lib/surfcore-*.mjs` 锚点补丁 → `Mieksido/surfcore` | 不做 | 读代码确认是**本项目集成层**（组件 IPC、记忆委托、面板外壳、按字符串替换上游 console DOM），不是上游 bug 修复 |
| `third-party/dsh-context` | 无可贡献 | 子模块干净，与 pin `v0.83.1` 一致 |

## 做了什么

1. 在上游 `main`（`8c32a9d`）上验证补丁可直接应用：`git apply --check` 通过。
2. `.artifacts/upstream/superagent-windows` 建了干净克隆与分支 `fix/windows-support`，提交 `9e56763`（作者 `mastwet <1136523089@qq.com>`，沿用本仓既有提交身份）。
3. 修正补丁里的一处不足：`absolute()` 的正则原来只认 `/` 与 `C:\`，**不认 UNC（`\\server\share`）**；改为 `/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\])/`，与 `policy.ts` 里用的 `path.isAbsolute()` 语义对齐。
4. 补了两条跨平台单测（`describe('windows')`，用 `process.platform` 打桩），并确认**去掉源码修复后这两条会红**。
5. 用 `withTemporaryPatch` 在钉住的 `superagent/` 上把 11 个补丁全打上跑 `tsc --noEmit`，退出 0，跑完工作区恢复干净。

## 现在的状态

- 产物：`.artifacts/upstream/superagent-windows`（分支 `fix/windows-support`，1 个提交，4 文件含测试）；`patches/superagent-windows.patch` 同步为 **7,048 字节 / 3 文件**——只收 `src/`，因为根仓 `tests/windows-deployment.test.mjs` 会把这个补丁打进只含 `superagent/src` 的临时夹具，带上 `tests/deployment.spec.ts` 会让 `git apply` 找不到目标文件。
- 开 PR 需要用户侧动作，见 `acceptance.md`。
- 未验证：上游 CI（Linux/macOS）未跑；本机只验证了 Windows 11 + Node 24。
