# 验证记录

只记录本轮实际跑过的命令、预期与实际。

## 1. 仓库与上游位置

| 命令 | 预期 | 实际 |
| --- | --- | --- |
| `git -c safe.directory='*' ls-tree HEAD deepseek-harness superagent` | 两个 gitlink 指针 | `b830ec95…`（DSH）、`6337fc82…`（Superagent） |
| `git -C deepseek-harness log -1` | 空或当前提交 | `b830ec950f… Merge PR #7572 release-dsh-0.2.1-rc.5`（2026-10-29） |
| `git -C deepseek-harness status --short` | 空 | 空 |
| `git -C deepseek-harness rev-list --count origin/master` | 上游提交数 | **1**（shallow，`fcc0ad46`），`merge-base HEAD origin/master` 为空 |
| `git -C deepseek-harness fetch origin --tags` | 更新引用 | **失败**：`cannot create standard input pipe for remote-https: Permission denied`（沙箱），未取得新引用 |
| `node --version` | ≥24.9 | `v24.14.1` |

> 因为 fetch 被拒且历史是 shallow，版本结论全部改用 GitHub API（见报告 §9），本地不产出 diff。

## 2. 版本门复算（本地可执行）

`node .artifacts/research-dsh-upgrade/semver-check.mjs`（用 `deepseek-harness/node_modules/semver`）：

```
0.2.2-rc.3   ^0.2.1-alpha.2                               includePrerelease=true plain=false
0.2.2-rc.3   >=0.1.5-rc.1 <0.2.1                          includePrerelease=false plain=false
0.2.1-rc.5   >=0.1.5-rc.1 <0.2.1                          includePrerelease=true plain=false
0.2.2-rc.3   >=0.2.0-rc.2 || >=0.2.1-rc.2 || >=0.2.2-rc.1 includePrerelease=true plain=true
```

预期：Superagent（`^0.2.1-alpha.2`）对 0.2.2-rc.3 为 true；两个 TS 插件（`<0.2.1`）为 false。
实际：一致。判定代码 `app-boot/src/plugin-compatibility.ts:51-53` 用的是 `includePrerelease: true`；rc.5 与 rc.3 两版该文件内容一致（raw 对比）。

## 3. 补丁机制复核

| 命令 | 预期 | 实际 |
| --- | --- | --- |
| `git -C superagent status --short` | 空（补丁只在构建窗口内） | 空 |
| `git -C superagent apply --check ../patches/superagent-windows.patch` | exit 0 | exit 0 |
| 12 个补丁一次性 `apply --check` | —— | exit 1（**方法错误**：串行补丁不能一次性对原始树校验，不作为证据） |
| `Get-Content patches/superagent-patches.json` | 12 条 | 12 条，顺序与 `source.mjs:207` 一致 |

## 4. 命中点计数（grep）

| 模式 | Superagent | 插件/脚本 |
| --- | --- | --- |
| `agent/request` | 1 文件 1 处（`role-models.ts:31`） | 0 |
| `sessionProjections` | 1 处（`sessions.ts:277`） | 8 处（`dsh-continual-harness`） |
| `ctx.tools` | 5 文件 6 处 | 15 文件 |
| `DSH_TOOLS_MODE` / `tools.mode` | 0 | 0 |
| `dsh-official-bundles` / `dsh-app-boot` | 0 | 0 |
| `ctx.setInterval` / `ctx.setTimeout` / `ctx.timer` | 0 | 0 |
| `ctx.fiber` | 2（`src/index.ts:13,19`） | 0 |

## 5. 未执行的验证（拍板后）

- `npm run setup` 在 0.2.2 源码上（需要先 checkout 指针 + 改版本断言）。
- 起面板看 `skippedBundles` 是否只有那两个 TS 插件。
- Superagent 真会话（角色模型种入、日常页收发）。
- 10 个 client 插件的 slot/菜单/主题实点。
