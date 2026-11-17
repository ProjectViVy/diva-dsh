# 用户自定义插件源码级安装目录（user-plugins）—— DV-SETUP-001

主人 2026-11-16 23:0x：「我想为 diva 添加一个用户自定义插件源码级安装目录……我现在有一个插件，我希望遵守源码级安装规则，但是我不想让他上主分支，只是我自己方便用的一个小工具。」
随后定调：「规则写进说明书，脚本里写，AGENTS.md 一句话声明；user-plugins 可以丢源码当前目录。」

## 现状：已有两档源码级安装

| 档位 | 目录 | 机制 |
| --- | --- | --- |
| 自己的插件 | `plugins/<name>/` | 独立 git 仓，登记在 `scripts/lib/component-setup.mjs` 的 `componentPackages()`，`npm run setup` 自动接线 |
| 社区插件 | `third-party/<name>/` | submodule + `third-party/pins.json` 钉 tag + 兼容声明，`scripts/setup-third-party.mjs` 构建并注册 |
| **新增：私有插件** | `user-plugins/<name>/` | 源码目录 + `scripts/setup-user-plugins.mjs`，不钉、不追踪、不登记 |

三档装进 profile 的底层动作相同：包里声明 `dsh.bundle.patch`，然后
`dsh plugin --profile superagent-local add link:<绝对路径>` 写三处
（`dependencies` 的 `link:`、`dsh.profile.bundles` 的包名、`node_modules` 软链）。
差别只在版本来源与归属策略。

## 做法（最简方案 A）

不放宽 DSH、不加通用安装器，只加一个档位 + 一套发现/注册脚本：

- **目录**：`user-plugins/<name>/`，一个子目录一个包；以 `.` / `_` 开头的目录留给草稿。
  `.gitignore` 排除 `user-plugins/*`，只跟踪 `user-plugins/README.md`。
  `--dir` 可把整档指到仓库外（默认就是当前目录下的 `user-plugins/`）。
- **规则说明书**：`user-plugins/README.md`（三档对比、最小包结构、命令、边界、故障处理），
  规则正文不塞进 AGENTS.md。AGENTS.md §1 表格加一句声明。
- **校验**（`scripts/lib/user-plugins.mjs`，纯函数、只读）：
  - 包名合法；`dsh.bundle.patch` 存在且指向包目录内真实文件（否则 DSH 只当普通依赖，永远不激活）；
  - 入口存在（`main` / `exports["."]` / `lib/index.js` / `index.js` 任一），或声明 `scripts.build` 待构建；
  - 包名不能被 profile 里别的来源占用（防止叫 `dsh-daily` 劫持主仓插件）；
  - 扫描跳过非插件目录与无清单目录。
- **注册**（`scripts/setup-user-plugins.mjs`）：
  - `--check` 只读报告（面板运行中可跑）；默认 sync 需面板停；
  - 缺产物且声明了 build 才用项目内 pnpm 构建（有 lockfile 才冻结安装），构建后复查；
  - 幂等注册：`inspectComponents` 判已注册且指向同一目录就跳过；
  - **prune**：profile 里 `link:` 指向本档、但源码目录已不存在的依赖 → `plugin remove`，
    防止删目录后残留 link 让下次启动变难看；
  - `--remove <名字>` 只注销本档 link，源码保留；`--dir <路径>` 换档位。
- **接入**：`scripts/setup.mjs` 在 `setup-components` 之后加一步；`package.json` 加
  `setup:user-plugins`。空档位时脚本打印「空档位，无操作」并 exit 0，零行为变化。

## 为什么不用备选

**备选 B：零代码**——手动 `dsh plugin add link:<dir>` + 一节 README。只有一两个插件时够用；
但目录删掉后 profile 残留 link 需要手工收拾，换机器/重装 profile 后没有一条命令恢复，
也不会有「构建 → 注册 → 复核」的一致性。主人明确要「一个目录」，A 的边际成本只有
一个 lib + 一个脚本 + 一组测试，值得。

不把 user 插件混进 `third-party/pins.json`：那档的语义是「社区插件 + 可复现的 tag + 兼容声明」，
私人工具不钉 tag，混进去会把第三方档的可复现性弄松。

## 边界

- 插件是**可执行代码**，与主仓插件同等信任；脚本只做结构检查，不审代码。
- 不进 `componentPackages()`、不进 `npm test`、不被根仓库跟踪（`git status` 干净）。
- 只走 DSH 公开接口 `dsh plugin add/remove` 改 profile，不手改 profile 清单。
- 改源码要重启宿主才生效（插件是常驻进程）。

## 真实安装（2026-11-17 00:1x）

`dsh-oil-ui` 已装好并生效：源码在 `user-plugins/dsh-oil-ui/`（clone main，含已提交的 `lib/` 与 `skills/`），生产依赖装好；用 DSH 官方在线安装通道 `plugin_manager install_bundle link:<目录>` 注册，**没有停宿主**。profile `bundles` 末位出现 `dsh-oil-ui`，`--check` exit 0，`oil_ui_skill_status` 返回 `skillReady: true`（内置 Lite Skill v0.33.4，45 文件）。

在线安装这条通道对 `user-plugins/` 场景可用：DSH 会立即加载新 bundle，不必重启；`scripts/setup-user-plugins.mjs` 的停面板路线仍保留（冷启动/批量恢复时用）。

## 未验证（下一步）

1. 带 `scripts.build` 的插件真跑一次构建（本轮只覆盖判定，没有真构建）。
2. `--remove` 与 prune 的真实 `dsh plugin remove` 路径（只有纯函数级覆盖）。
3. 宿主重启后重新加载（本次是在线加载；重启会重新读同一 profile，预期一致）。
4. 已知启动器盲点：不由 launcher 启动的 DSH 进程没有 pid 记录，`npm run stop` 会打印 stopped 却杀不掉（已单独立条目 DV-SETUP-002）。
