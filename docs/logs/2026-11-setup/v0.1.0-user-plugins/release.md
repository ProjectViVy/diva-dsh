# 交付与回滚 —— v0.1.0-user-plugins

## 交付物

| 文件 | 性质 |
| --- | --- |
| `user-plugins/README.md` | **规则说明书**：三档对比、目录格式、最小包结构（package.json + cordis.patch.yml + 入口）、四条硬性校验、命令、边界、故障处理 |
| `scripts/lib/user-plugins.mjs` | 新增，只读纯函数：扫描、入口解析、结构校验、包名冲突、失效 link 判定 |
| `scripts/setup-user-plugins.mjs` | 新增，`--check` / `--remove` / `--dir` / 默认 sync（构建 → 注册 → prune → 复核） |
| `tests/user-plugins.test.mjs` | 新增，13 项 |
| `scripts/setup.mjs` | +2 行：`setup-components` 之后接一步 user-plugins（空档位零操作） |
| `package.json` | +1 行 `setup:user-plugins` |
| `.gitignore` | +3 行：排除 `user-plugins/*`，只跟踪 README |
| `AGENTS.md` | §1 表格「新插件 / 新能力」加一句声明（一句话，细节在 README） |
| `TODOLIST.md` | 新增 DV-SETUP-001 条目 |

## 为什么这样切

- **第三档而不是塞进 `plugins/`**：`plugins/` 语义是「本仓维护、进 `componentPackages()`、进 `npm test`」；私人小工具放进去会污染清单、被评测与迁移逻辑碰到，而且 git 上就得进主分支。
- **不混进 `third-party/`**：那档要求钉 tag + 声明 DSH 兼容版本，私人工具没有可钉的版本，混进去会把「第三方可复现」这条规则弄松。
- **规则写在 README 而不是 AGENTS.md**：AGENTS.md 有 160 行上限、只回答「在这个仓库怎么干活」；档位规则属于使用说明，放 `user-plugins/README.md` 最就手，AGENTS.md 只留一句指路。
- **只走 `dsh plugin add/remove`**：不手改 profile 清单，不碰上游；注册状态用现有 `inspectComponents` 复核，和另外两档同一套判断。
- **prune 是必须的**：手动删掉插件目录后，profile 里指向它的 `link:` 会残留；没有清理，下次 `npm run setup` 或启动时会撞上「依赖指向不存在的目录」。
- **`--dir` 保留**：默认就在仓库内 `user-plugins/`（主人说「可以丢源码当前目录」），但想完全放仓库外时不用改脚本。

## 风险

1. **插件是可执行代码**：只做结构检查，不审代码；与主仓插件同等信任。README 已写明。
2. **不进 `npm test`**：私有插件的行为没有回归保护，坏了只影响自己。
3. **注册时要求面板停**：与 `setup-components` / `setup-third-party` 一致；如果有人绕过脚本手改 profile，prune 的归属判定只认 `user-plugins/` 下的 `link:`，不会误删别处的依赖。
4. **包名冲突被拒**：叫 `dsh-daily` 之类的名字注册会被拒绝并提示改名——这是刻意的，防止劫持主仓插件。

## 回滚

本轮**没有注册任何东西**（真实空档位 `--check` exit 0），所以 profile 无需回退。要撤销本轮：

1. 删除 `user-plugins/README.md`、`scripts/lib/user-plugins.mjs`、`scripts/setup-user-plugins.mjs`、`tests/user-plugins.test.mjs`、`docs/logs/2026-11-setup/`。
2. 回退 `scripts/setup.mjs` 的两行、`package.json` 的 `setup:user-plugins`、`.gitignore` 的三行、`AGENTS.md` §1 表格那句、`TODOLIST.md` 的 DV-SETUP-001 条目。
3. 若之后已注册过插件：先 `npm run setup:user-plugins -- --remove <名字>` 逐个注销，再删目录。

未提交（按 AGENTS.md：用户说提交才提交）。
