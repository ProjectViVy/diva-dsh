# 上游贡献 · v0.1.0-superagent-windows · 验收（需要用户动手）

推送与开 PR 都缺凭据，这一步只能由用户完成。两条路选一条。

## A. 用本机已备好的分支直接推（推荐）

```powershell
cd .artifacts/upstream/superagent-windows
# 首次推送会用凭据管理器问你 GitHub 账号（用户 mastwet）
git push -u origin fix/windows-support
```

推完之后在 GitHub 上从 **你的 fork** 向 `deepseek-ai/dsh-superagent-prototype:main` 开 PR：

- 标题与正文：直接复制 [pr.md](pr.md) 的「正文」一节。
- 若 `origin` 不是你的 fork（当前指向 `deepseek-ai/dsh-superagent-prototype`，你没有写权限），先改远程再推：

```powershell
git remote set-url origin https://github.com/<你的账号>/dsh-superagent-prototype.git
```

## B. 用 GitHub CLI（需要先登录）

```powershell
gh auth login
cd .artifacts/upstream/superagent-windows
git remote set-url origin https://github.com/<你的账号>/dsh-superagent-prototype.git
git push -u origin fix/windows-support
gh pr create --repo deepseek-ai/dsh-superagent-prototype --base main --head <你的账号>:fix/windows-support --title "fix(deployment): accept Windows absolute paths and resolve .exe commands" --body-file ../../../docs/logs/2026-11-upstream-contrib/v0.1.0-superagent-windows/pr.md
```

## 通过判据

- 上游仓库出现一条指向 `main` 的 PR，内容是 4 个文件（`src/deployment.ts`、`src/policy.ts`、`src/app/sessions.ts`、`tests/deployment.spec.ts`）。
- PR 的 Checks 里，Linux/macOS 的 `typecheck` 与 `test` 不应因为这次改动变红（本地只在 Windows 上验证过；若红了，先看是不是 `absolute()` 的正则在 POSIX 侧有边角用例）。

## 如果不想开 PR

同一份内容仍以补丁形式留在本仓 `patches/superagent-windows.patch`，构建期照旧应用；不做贡献也不影响本地运行。
