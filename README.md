# dsh-superagent-template

一个**便于部署、可以直接启动**的 [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) 模板。

拿到这个目录，三条命令就能跑起来一个能用的 superagent 面板：

```sh
npm install
npm run setup
npm start
```

它把上游原本散在四处的东西收成了一个自包含的项目：

- **源码在手**：`superagent/` 是上游的纯源码副本，可以直接改，不是黑盒依赖。
- **版本锁定**：dsh 用 npm 发布版 `0.2.1-rc.5`，装在项目自己的 `node_modules` 里，不碰你终端里的全局 `dsh`。
- **不依赖 tmux**：上游的启停脚本是 Python + tmux，Windows 上根本跑不了；这里用 Node 启动器替代。
- **Windows 可用**：上游要求配置路径以 `/` 开头，盘符路径永远校验不过；这里已经打好补丁。

## 和上游的关系

`superagent/` 与上游 `6337fc8` 只差两个文件，就是下面两处补丁；其余逐字节相同。`upstream/` 是一个 git submodule，指向原仓库，用来对照和取新版本。

| 文件 | 上游 | 本模板 |
| --- | --- | --- |
| `superagent/src/deployment.ts` | `stateDir` 用 `/^\//` 校验，只认 POSIX 绝对路径 | 改为 `/^(\/|[A-Za-z]:[\\/])/`，同时接受 `C:/…` |
| `superagent/src/policy.ts` | `executor.directory` 用 `startsWith('/')` | 改用 `node:path` 的 `isAbsolute()` |

随时可以自己核对：

```sh
diff -rq upstream/src superagent/src
```

## 目录结构

```
dsh-superagent-template/
├── superagent/      纯源码（含补丁），要改就改这里
├── upstream/        git submodule → deepseek-ai/dsh-superagent-prototype（只读对照）
├── scripts/
│   ├── setup.mjs       一次性安装：校验版本 → 建 profile → 装 bundle → 写配置
│   ├── vivy-dsh.mjs    start / stop / restart / status（无 tmux）
│   ├── build-bundle.mjs 改完源码后重建
│   └── lib/vivy.mjs    路径、管理 API、进程台账
├── .artifacts/      运行日志与启停控制文件（自动生成，不入库）
└── README.md
```

## 启动之后

面板地址 `http://127.0.0.1:3082`，需要带 token —— token 在启动日志的前几行：

```sh
ls -t .artifacts/*.log | head -1 | xargs cat | head -5
```

首次启动会以退出码 `3` 停下，并在日志里说明缺什么。这是**预期状态**，不是故障。进面板左侧的 **Superagent**，依次补三样：

1. **Source → GitHub**：要接的仓库 `owner/name`。
2. **Policy**：允许哪些 GitHub 用户向 agent 提需求，先给最小名单。
3. **Execution**：本地 checkout 目录与 prepare 命令。

真要让它干活，还需要一个专用 GitHub 账号和它的 `gh` 包装（凭据只能进这个包装）：

```sh
mkdir -p ~/.local/bin
cat > ~/.local/bin/gh-agent <<'EOF'
#!/bin/sh
GH_CONFIG_DIR="$HOME/.config/gh-agent" exec gh "$@"
EOF
chmod +x ~/.local/bin/gh-agent
gh-agent auth login
```

## 命令与退出码

```sh
npm start      # 后台启动，等到就绪或报告缺什么
npm run status # 打印健康状态
npm run stop   # 停止（写入“手动停止”标记）
npm run restart
```

`status` / `start` / `restart` 的退出码与上游一致：`0` 正常，`1` 没跑起来或 runtime 报错，`2` 某部件持续报错（重启修不好），`3` 在跑但等配置。

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VIVY_DSH_PROFILE` | `superagent-template` | DSH profile 名。默认不叫 `superagent`，避免和同机其他实例抢同一个 profile |
| `VIVY_DSH_PORT` | `3082` | 面板端口，同时写进 profile 的机器配置 |
| `VIVY_DSH_URL` | `http://127.0.0.1:3082` | 健康检查地址，改端口时要跟着改 |
| `VIVY_DSH_STATE_DIR` | `~/.dsh/state/<profile>` | 状态库、锁、worker 命令的位置 |
| `DSH_HOME` | `~/.dsh` | DSH 的根目录 |

机器配置落在 `~/.dsh/profiles/<profile>/cordis.patch.yml`，`setup` 只在缺失或没写 `stateDir` 时生成，不会覆盖你的改动。

如果同机已有别的实例占着 `3082`（比如另一个 `vivy-dsh`），三个变量一起改，`setup` 和 `start` 都用同一组值：

```sh
VIVY_DSH_PORT=3083 VIVY_DSH_URL=http://127.0.0.1:3083 npm run setup
VIVY_DSH_PORT=3083 VIVY_DSH_URL=http://127.0.0.1:3083 npm start
```

## 改源码后

```sh
npm run build:bundle   # 在 superagent/ 里 pnpm install && pnpm run build
npm run restart
```

## 跟进上游

```sh
git submodule update --init --recursive
git -C upstream fetch --tags
git -C upstream checkout <新的 tag>
diff -rq upstream/src superagent/src   # 看两处补丁是否还需要
```

## 已知限制

- **停止不是优雅退出**：Windows 没有可投递的 SIGINT，`npm run stop` 走 `taskkill /T`，正在执行的会话会被中断。
- **没有小时巡检**：上游靠 DSH 计划任务自愈，这里不含，需要的话自己用 Windows 任务计划程序封装 `npm run status`。
- **只接了 GitHub**：飞书 Source 在 `cordis.patch.yml` 里保持注释，需要时再开。
- **上游 Python 脚本保留但不适用**：`superagent/scripts/dsh-superagent` 依赖 tmux，仅供参照。

## 排障

| 现象 | 处理 |
| --- | --- |
| `$.stateDir expect string to match regexp /^\//` | 用的是没打补丁的 bundle，`npm run build:bundle` 后 `npm run restart` |
| `Unexpected token '�' ... is not valid JSON` | 依赖解析读到了上级目录里损坏的 package.json；本项目已在本地提供 `@modelcontextprotocol/sdk` 绕开 |
| `Lock file is already being held` | 上一个实例被强杀后锁未释放；`npm run restart` 会自动清理 |
| `An existing service answers at …` | 已有实例占用该端口，先 `npm run status`，或换 `VIVY_DSH_PORT` / `VIVY_DSH_URL` |
| 退出码 `2` | 某部件持续报错，按 `status` 输出的 `errors` 名字去面板对应卡片修 |

## 许可

`superagent/` 与 `upstream/` 沿用上游 MIT 许可，见 `superagent/LICENSE`。
