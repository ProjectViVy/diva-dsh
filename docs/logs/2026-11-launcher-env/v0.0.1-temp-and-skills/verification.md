# 验证记录 v0.0.1-temp-and-skills

## 针对性测试

命令：`node --test tests/source-runtime.test.mjs tests/dream-skill-install.test.mjs`

结果：31 项，28 通过，3 失败。3 个失败均为**既有 Windows 路径分隔符断言**，与本次改动无关：

| 失败用例 | 实际 | 期望 | 性质 |
| --- | --- | --- | --- |
| standalone mempalace installation… | `\project\plugins\dsh-mempalace` | `/project/plugins/dsh-mempalace` | 测试用 POSIX 假路径，Windows `join` 产生反斜杠 |
| a fresh profile receives… | patch 内为 `/` 分隔 | `join()` 产生 `\` | 既有分隔符断言 |
| setup relocates its own profile… | `configuredStateDirectory` 返回 `/` | `join()` 产生 `\` | 既有分隔符断言 |

本改动直接相关的用例全绿：

- `child processes keep DSH data, package caches and temporary files in the project`（改为断言 temp 在项目外）
- `npm lifecycle receives the project-local native build cache`
- `Dream workflow installation is idempotent and preserves user-owned skills`
- `project skills install idempotently and preserve user-owned copies`
- `setup refuses a package-cache / control directory symlink pointing outside the project`

## 运行时验证

```
TMPDIR=C:\Users\Administrator\AppData\Local\diva-dsh-tmp\be9c629af419
outsideProject=true
installed=...\.artifacts\dsh-home\skills\diva-dream\SKILL.md
installed=...\.artifacts\dsh-home\skills\more-faster-better-economical\SKILL.md
```

随后 `skill` 工具目录热刷新，`more-faster-better-economical` 出现在可用列表并成功加载，说明安装目标目录就是 DSH 的扫描根。

## 语法与工作区

- `node --check` 四个改动文件：通过。
- `git diff --stat` 复核：9 个文件、+116/−35，无整文件重写。
- 行尾复核：4 个被误写成 CRLF 的文件已还原 LF。

## 全量测试

命令：`npm test`，退出码 1。失败集中在既有环境问题，分类：

1. Windows 分隔符：`ownership-boundaries`、`voice-plugin`、`vivy-tone`、`voice-core`、`mempalace-retire`、`surfcore-runtime-transform`、`source-runtime` 的部分用例。
2. `EPERM` 删除失败：`mempalace*.test.mjs` 的 `after` 钩子，Windows 文件锁。
3. SurfCore loader：`ERR_UNSUPPORTED_ESM_URL_SCHEME ... protocol 'c:'`，Windows 绝对路径未转 `file://`。
4. 少量行为断言（`mempalace-retire` 字节数、`voice-installer-runner` 前缀）同属分隔符/平台差异。

未逐条与基线对比；只声明：本次改动新增/修改的用例通过，失败项都不读取 `localEnvironment` 的临时根。

## 未验证

- 重启后 `pwsh` 实测（必须重启）。
- 停面板后完整 `npm run setup`。
