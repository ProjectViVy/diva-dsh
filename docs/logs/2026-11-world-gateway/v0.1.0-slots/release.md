# 世界网关 · v0.1.0-slots · 发布

## 交付清单

| 文件 | 类型 |
| --- | --- |
| `plugins/capability-hub/package.json` | 新增 |
| `plugins/capability-hub/cordis.patch.yml` | 新增 |
| `plugins/capability-hub/src/index.mjs` | 新增（host 入口） |
| `plugins/capability-hub/src/capabilities.mjs` | 新增（能力目录与默认值） |
| `plugins/capability-hub/src/registry.mjs` | 新增（持久化 + 校验 + resolve） |
| `plugins/capability-hub/src/http.mjs` | 新增（四条面板路由，无 invoke） |
| `plugins/capability-hub/src/client.js` | 新增（设置页「世界网关」分区） |
| `plugins/capability-hub/tests/registry.test.mjs` | 新增（7 条） |
| `plugins/capability-hub/README.md` | 新增 |
| `scripts/lib/component-setup.mjs` | 改 2 处（`componentPackages`、`mappings`） |
| `docs/logs/2026-11-world-gateway/v0.1.0-slots/*` | 新增四件套 |
| `TODOLIST.md` | 改 DV-DOC-008 |

**未改动**：DSH 上游、Superagent、SurfCore、profile 的 `cordis.patch.yml`、任何 `config.json`、任何凭据。

## 运行时影响

- 新增一个 host 插件（注册 `/dsh-capability-hub/api/*` 前缀路由）与一个设置分区。
- 首次加载会在 `<DSH_HOME>/capability-hub/` 建目录并写 `registry.json`（仅默认值，无密钥）。
- 不增加后台进程、定时器、外部网络连接。

## 回滚

1. `plugins/capability-hub/` 整目录移出（不要直接删，先 rename 到隔离目录）。
2. `scripts/lib/component-setup.mjs` 撤两处新增行。
3. 从 profile `package.json` 移除 `dsh-capability-hub` 的 `link:` 依赖与 `bundles` 条目（或重跑一次 `npm run setup:components` 后再手删）。
4. 需要的话删掉 `<DSH_HOME>/capability-hub/`。
5. 重启 DSH。

以上不会影响 chat 配置与其它插件。

## 独立仓与 submodule（待执行，需 shell）

用户已定仓库名：`vivy-dsh/word-gateway`（path 仍为 `plugins/capability-hub`，插件包名仍为 `dsh-capability-hub`——
GitHub 仓名与 npm 包名不必一致）。本轮 `pwsh` 不可用，以下命令**没有执行**，留给恢复 shell 后跑：

```powershell
# 1) 插件目录建立独立仓并首推
cd C:\Users\Administrator\Desktop\diva-dsh\plugins\capability-hub
git init
git add .
git commit -m "feat: world-gateway settings section with five capability slots"
git branch -M main
git remote add origin https://github.com/vivy-dsh/word-gateway.git
git push -u origin main

# 2) 主仓登记为 submodule（path 与 .gitmodules 一致）
cd C:\Users\Administrator\Desktop\diva-dsh
git submodule add https://github.com/vivy-dsh/word-gateway.git plugins/capability-hub
git status --short      # 预期：.gitmodules 与 plugins/capability-hub 两处变更
```

注意：

- 仓库内已有 `README.md`，**不要**再执行 `echo "# word-gateway" >> README.md`（会出现重复标题）。
- `git submodule add` 会复用已存在的嵌套仓（读到 `.git` 与 `origin` 即认账），不必先删目录。
- 若仓库名其实是 `world-gateway`，只需改上面两处 URL；`.gitmodules` 里的 path 不受影响。
- 根仓库的 `.gitmodules` 与 submodule 指针是否提交由用户决定——本会话不自动提交。

## 提交注意

- **本轮未提交**（仓库规则：用户说提交才提交）。
- 提交信息建议：`feat(capability-hub): add world-gateway settings section with five capability slots`。
