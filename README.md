# dsh-superagent-template

`dsh-superagent` 的纯源码模板：一份可直接拷贝、改造、再分发的 fork 源码，外加一个指向上游的 git submodule 用于对照。

与 `vivy-dsh/` 的分工：那边是**能跑起来的运行时**（锁 dsh 版本、启停脚本、profile 配置）；这里只有**源码**，不带 `node_modules`、不带 `lib` 构建产物、不带运行配置。

## 目录结构

```
dsh-superagent-template/
├── superagent/   纯源码副本（含本项目的 Windows 补丁），拷贝走的就是它
├── upstream/     git submodule → deepseek-ai/dsh-superagent-prototype（只读对照）
└── README.md
```

`superagent/` 与 `upstream/` 只差两个文件，就是下面这两处补丁；其余逐字节相同。这条等式可以用来验证模板没有走样：

```sh
diff -rq upstream/src superagent/src
```
```
Files upstream/src/deployment.ts and superagent/src/deployment.ts differ
Files upstream/src/policy.ts and superagent/src/policy.ts differ
```

## 补丁清单

上游假定 POSIX 绝对路径（必须以 `/` 开头），Windows 盘符路径永远匹配不上，因此配置校验会直接失败。

| 文件 | 上游 | 本模板 |
| --- | --- | --- |
| `src/deployment.ts` | `absolute()` 用 `/^\//` 校验 `stateDir` | 改为 `/^(\/|[A-Za-z]:[\\/])/`，同时接受 POSIX 与盘符绝对路径 |
| `src/policy.ts` | `executor.directory` 用 `path.startsWith('/')` | 改用 `node:path` 的 `isAbsolute()` |

除此之外 `superagent/` 与上游 `6337fc8` 一致。

## 用法

**只读查阅上游**

```sh
git submodule update --init --recursive
```

**改源码并构建**

```sh
cd superagent
pnpm install
pnpm run build          # 产物在 superagent/lib
```

**跟进上游新版本**

```sh
git -C upstream fetch --tags
git -C upstream checkout <新的 tag 或 commit>
# 重新核对两处补丁是否仍然适用：上游若已修好路径校验，补丁就可以删掉
diff -rq upstream/src superagent/src
```

**接进运行环境**：把 `superagent/` 目录以 `link:` 方式装进某个 DSH profile，例如 `vivy-dsh` 里的做法：

```sh
dsh plugin --profile superagent add "link:$PWD/superagent"
```

## 说明

- `upstream/` 是 submodule，本身不参与构建，只用于对照和取新版本；它记录的是 `6337fc8`。
- 模板不含 `engines.dsh` 之外的版本约束，选 dsh 版本时看 `superagent/package.json` 的 `engines` 字段：`^0.2.1-alpha.2`，实测 `0.2.1-rc.5` 满足、`0.2.2-alpha.2` 不满足。
- 上游 `superagent/scripts/dsh-superagent` 是 Python + tmux 的启停脚本，Windows 上不适用；替代方案见 `vivy-dsh/scripts/vivy-dsh.mjs`。
