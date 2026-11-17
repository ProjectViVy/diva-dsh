# 验证记录 —— v0.1.0-user-plugins

环境：Windows，DSH profile `superagent-local`，面板 3082 在跑。
全仓测试用一次 `danger-full-access` 审批跑完（`node --test` 需要为每个测试文件 spawn 子进程，`workspace-write` 沙箱会拒绝）。

## 通过

| # | 命令 | 结果 | 证据 |
| --- | --- | --- | --- |
| 1 | `node tests/user-plugins.test.mjs` | **13/13 pass，0 fail** | 扫描跳过草稿/隐藏/无清单目录；包名非法、缺 `dsh.bundle.patch`、patch 越界、patch 文件缺失、入口缺失且无 build、包名占用均被拒；`exports["."]` 入口、有 build 待构建、幂等自指、prune 归属判定均通过 |
| 2 | `node scripts/setup-user-plugins.mjs --check`（真实空档位） | **exit 0** | 输出「空档位。放一个 user-plugins/<name>/ 进去…」；真实 profile 清单可读，无残留 link |
| 3 | `node scripts/setup-user-plugins.mjs --check --dir .artifacts/user-plugins-check` | **exit 1（预期）** | 样例插件输出 `demo-tool [就绪]` + `demo-tool: 未注册 —— npm run stop && npm run setup:user-plugins` |
| 4 | `node tests/third-party-setup.test.mjs` | **14/14 pass** | 相邻的第三方档未受本轮改动影响（pin/兼容/构建判定全部通过） |
| 5 | `npm test`（全仓，wider sandbox） | **1463 项 / 1453 通过 / 0 失败 / 10 跳过，exit 0** | 与改动前基线（1450/1440/0/10）相比 +13 项（新增 `user-plugins.test.mjs`），0 失败；**确认没有改动任何既有测试断言** |

## 旁证（说明沙箱限制，非改动引起；全仓通过后已不再需要）

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `node tests/component-setup.test.mjs`（workspace-write） | 4/7 | 2 条 `spawnSync`/离线 pnpm 被沙箱挡；1 条 junction 断言失败。本轮未改 `component-setup.mjs` 与该测试，`danger-full-access` 下全仓含该文件 0 失败。 |
| `node tests/windows-deployment.test.mjs`（workspace-write） | 0/3 | `spawnSync git EPERM`，沙箱挡子进程；全仓通过后确认非改动引起。 |

## 真实安装验收（2026-11-17 00:1x，dsh-oil-ui）

| # | 动作 | 结果 |
| --- | --- | --- |
| 1 | `git clone --depth 1 https://github.com/oil-oil/dsh-oil-ui user-plugins/dsh-oil-ui` | 成功；仓库已提交 `lib/index.js` 与 `skills/oil-ui/`（45 个 Skill 文件），无需构建 |
| 2 | 项目内 pnpm `install --prod --frozen-lockfile`（插件目录） | 成功，12 个包（schemastery/acorn/parse5/postcss/postcss-value-parser/yaml） |
| 3 | `node scripts/setup-user-plugins.mjs --check` | `dsh-oil-ui [就绪]`，随后「未注册」（预期） |
| 4 | DSH 官方在线安装 `plugin_manager install_bundle` target=`link:<目录>` | `stage: enable` / `enabled: true` / `application: applied`；pnpm exit 0；profile `bundles` 末位出现 `dsh-oil-ui`。**未停宿主**。 |
| 5 | `node scripts/setup-user-plugins.mjs --check`（安装后） | **exit 0「全部就绪」** |
| 6 | `oil_ui_skill_status`（插件自己的状态工具） | `skillReady: true`、`nativeSkillReady: true`、内置 Lite Skill v0.33.4（45 文件）、`updateNotice` 0.33.4→0.33.5；`proInstalled: false` |

注：
- 在线安装时 pnpm 重新链接了 `dsh-ui-scope`（输出里有一次 `node_modules/.ignored` 移动再恢复），安装后 profile `bundles` 里它仍在。
- pnpm 警告 `dsh-oil-ui` 的 peerDependencies（`@deepseek-ai/dsh-*`）不会被 link 目标解析；但插件实际加载并工作正常（第 6 条），peer 由宿主解析。
- 宿主没有重启；本次是在线加载。重启后的行为仍未验证（预期一致，会重新读同一 profile）。

## 未验证（下一步）

1. **带 `scripts.build` 的插件真构建**：只覆盖了「判定为待构建」，没有真跑 pnpm install/build。
2. `--remove` 与 prune 的**真实** `dsh plugin remove` 路径：只有纯函数级覆盖。
3. **宿主重启后的加载**：本次在线安装已生效，但没有重启过；重启验证留给下一次重启窗口。
