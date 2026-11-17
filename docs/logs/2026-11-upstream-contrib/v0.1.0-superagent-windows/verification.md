# 上游贡献 · v0.1.0-superagent-windows · 验证

时间：2026-11-14 00:25–01:05（Asia/Shanghai）。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git ls-remote --heads https://github.com/deepseek-ai/dsh-superagent-prototype` | 取到上游 `main` | `8c32a9d` |
| 2 | `git -C superagent diff --stat HEAD origin/main` | 钉住的 `6337fc8` 与上游树一致 | 空输出（只有提交号不同） |
| 3 | `git apply --check patches/superagent-windows.patch`（上游 `main` 克隆） | 直接可应用 | 通过 |
| 4 | `node node_modules/typescript/bin/tsc --noEmit`（打补丁后的克隆） | 0 报错 | `tsc exit: 0` |
| 5 | `vitest run tests/deployment.spec.ts`（**修改前**，上游 `main`） | 记录基线 | **5 failed / 0 passed**（5 条全红：`env`/`#!/bin/sh`/`/^\//`） |
| 6 | `vitest run tests/deployment.spec.ts`（**修改后**） | 不再全红 | **3 failed / 2 passed** |
| 7 | 新增 `describe('windows')` 两条（打补丁后） | 绿 | `2 passed / 5 skipped`（`-t windows`） |
| 8 | 同上，但 `git stash` 掉 `src/` 三个文件 | **必须红**（证明用例真的覆盖修复） | **2 failed** |
| 9 | `vitest run tests/deployment.spec.ts tests/policy.spec.ts`（打补丁后） | 不引入新失败 | 330 passed / 3 failed（3 条同 #6，均为 POSIX 夹具） |
| 10 | `node .artifacts/checks/typecheck-superagent.mjs`（钉住的 `superagent/` + 全部 11 个补丁） | 补丁仍可应用且类型通过 | `tsc exit: 0` |
| 11 | 上一步之后 `git -C superagent status --porcelain` | 工作区恢复干净 | 空输出 |
| 12 | `patches/superagent-windows.patch` 重新生成（`src/` 范围） | 构建期补丁可应用 | **7,048 字节 / 3 文件**；对钉住树 `git apply --check` 退出 0 |
| 12b | `node --test tests/windows-deployment.test.mjs`（根仓） | 3 条补丁行为用例全绿 | **3 tests / 3 pass**（含测试文件的 `4 文件` 版会让这三条全红，已排除） |
| 13 | `git push --dry-run origin main`（fork 仓库） | 能否推送 | **失败**：`could not read Username for 'https://github.com'` |
| 14 | `gh auth status` | 能否开 PR | **未登录**（`hosts.yml` 仅有用户 `mastwet`，无 token） |

## 未验证

- 上游 CI 的 Linux / macOS 矩阵；本机只有 Windows 11 + Node 24。
- 真实 `gh` / `lark-cli` 在 Windows 上被 `executable()` 解析后的实际启动（用例用的是空文件与打桩平台）。
- 上游是否接受这条 PR（需要先能推送才能谈）。
