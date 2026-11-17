# user-plugins —— 私有插件的源码级安装档

这是**第三档**源码级安装，前两档分别是 `plugins/`（本仓自己的插件）和
`third-party/`（社区插件）。三档装进 profile 的方式相同：源码留在磁盘上，
profile 只记一条 `link:<绝对路径>` 依赖 + 一个 bundle 名；不同之处在版本与归属。

| | `plugins/` | `third-party/` | `user-plugins/` |
| --- | --- | --- | --- |
| 谁维护 | 本仓 | 社区上游 | 你自己 |
| 版本来源 | 独立 git 仓 | submodule + `pins.json` 钉 tag | 你放进去的那份源码 |
| 兼容声明 | 不强制 | 必须声明 DSH 版本 | 不强制 |
| 进 `componentPackages()` | 是（`npm run setup` 自动接线） | 否（独立脚本） | 否（独立脚本） |
| 进 `npm test` | 是 | 部分 | 否 |
| 进根仓库 git | 是 | 是（指针） | **否**（本目录只跟踪这份 README） |

适合放：只给自己用的工具、还没定型的小插件、不想让主分支看到的实验。
不适合放：要给别人复用或要长期维护的东西——那些应该进 `plugins/` 或 `third-party/`。

## 目录格式

```
user-plugins/
└── my-tool/              ← 一个插件一个子目录，名字随意（以 _ 或 . 开头的会被跳过）
    ├── package.json      ← 包名、dsh.bundle.patch、可选 scripts.build
    ├── cordis.patch.yml  ← 把插件挂进 profile 的补丁
    └── index.js          ← 入口（main / exports 指向它）
```

最小可用的 `package.json`：

```json
{
  "name": "my-tool",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./index.js",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

`cordis.patch.yml` 最少一行：

```yaml
- insert:
    - id: my-tool
      name: my-tool
```

硬性要求（脚本会逐条检查，不满足就拒绝注册，不会「装了但没生效」）：

1. `package.json` 可读，包名是 npm 接受的格式（小写，可带 `@scope/`）。
2. 声明了 `dsh.bundle.patch`，且它指向包目录内真实存在的文件——没有这一条，
   DSH 只会把它当普通依赖，永远不会作为 profile bundle 激活。
3. 入口文件存在（`main` / `exports["."]` / `lib/index.js` / `index.js` 任一命中），
   或者声明了 `scripts.build` 让脚本先构建。
4. 包名不能被 profile 里别的来源占用（例如叫 `dsh-daily` 就会劫持仓库自带插件）；
   脚本会拒绝并要求改名。

## 命令

```sh
npm run stop && npm run setup:user-plugins    # 构建缺的产物、注册缺的、清理失效 link
npm run setup:user-plugins -- --check         # 只读报告；面板运行中也能跑
npm run setup:user-plugins -- --remove my-tool  # 注销一个（源码保留）
npm run setup:user-plugins -- --dir D:\plugins  # 换一个档位目录（默认仓库内 user-plugins/）
```

`npm run setup` 会顺带跑一次默认档位（空目录就是零操作）。注册必须在面板停止时
进行，因为要改 profile 并跑 pnpm；`--check` 不受此限制。

**改源码后要重启宿主才生效**：`npm run stop && npm start`。插件是常驻进程，
链接不变，重启即读到新代码。

## 边界

- **信任**：这里的插件和主仓插件一样是可执行代码，脚本只做结构检查，不审代码。
  别把来路不明的源码丢进来。
- **不进主仓 git**：`.gitignore` 排除 `user-plugins/*`，只跟踪这份 README。
  想给某个插件做版本控制，在它自己的子目录里 `git init` 即可，不受父目录忽略影响。
- **不进 `npm test`**：没有测试覆盖，坏了只影响自己。
- **只走公开接口**：脚本用 `dsh plugin add/remove` 改 profile，不手改 profile 清单。
- **不删除源码**：`--remove` 只注销 link，目录原样保留。

## 故障处理

- 删掉插件目录后忘了注销：再跑一次 `npm run setup:user-plugins`（或
  `npm run setup`），脚本会把源码已不存在的 link 清掉。
- 注册后没反应：先 `--check` 看是「未注册」还是「待构建」；再看面板日志里
  该 bundle 的加载错误。
- 想临时停用一个：从 profile 面板的插件管理里停用，或先 `--remove`。
- 想整体回退：`npm run setup:user-plugins -- --remove` 掉每一个，再删
  `user-plugins/` 目录；profile 会回到没有这一档的状态。
