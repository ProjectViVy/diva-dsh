# PR · dsh-superagent-prototype：Windows 绝对路径与可执行文件解析

> 目标仓库：`deepseek-ai/dsh-superagent-prototype`
> 分支（本地）：`.artifacts/upstream/superagent-windows` → `fix/windows-support`（提交 `9e56763`，基于 `main@8c32a9d`）
> 标题：`fix(deployment): accept Windows absolute paths and resolve .exe commands`

## 正文（可直接粘贴）

DSH 在 Windows 上跑这套 Superagent 时，启动检查有三个独立的硬伤，全部挡住「跑起来」这一步：

1. `src/deployment.ts` 的 `absolute()` 用 `/^\//` 校验绝对路径，`stateDir: "C:\\..."`
   直接报 `$.stateDir expect string to match regexp /^\//`。
2. `executable()` 只用裸名去 PATH 里找，Windows 上真正存在的是 `gh.exe` / `lark-cli.cmd`，
   于是报 `The agent GitHub CLI was not found.`（CLI 明明装了）。
3. `workerProbe()` 把环境变量拼成 `env PATH=... cmd` 前缀，而 Windows 没有 `env` 这个命令；
   `sessions.ts` 里 worker 的工具白名单也写死了 `bash`。

## 改动

- `src/deployment.ts`
  - `ABSOLUTE` 改为 `/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\])/`：POSIX 路径、盘符路径（`C:\` 或 `C:/`）、UNC 共享（`\\server\share`）。
  - `executable()`：Windows 且名字没有扩展名时，候选名同时包含 `<name>` 与 `<name>.exe`，**保持 PATH 目录顺序**；显式给了扩展名就不再补。
  - `Probe` 增加可选 `env`；`workerProbe()` 改为把 `PATH` 通过 `runAsWorker(..., env)` 传入（该签名上游已支持），不再拼 `env` 前缀；飞书的两个 `LARKSUITE_*` 同样改走 `env`。
- `src/policy.ts`：执行目录的校验从 `startsWith('/')` 换成 `isAbsolute()`。
- `src/app/sessions.ts`：worker 白名单里的 shell 按平台取 `pwsh` / `bash`。
- `tests/deployment.spec.ts`：新增 `describe('windows')` 两条（打桩 `process.platform`），覆盖盘符/UNC 校验与 `.exe` 解析；POSIX 行为有回归断言（`gh` 不会解析到 `.exe` 兄弟文件）。

## 行为影响

- Linux/macOS：路径校验与命令解析**不变**（`process.platform !== 'win32'` 时不补 `.exe`；`absolute()` 的正则仍接受所有原有用例）。
- Windows：`stateDir`、执行目录可填盘符/UNC；`gh`、`lark-cli` 这类 CLI 能被找到；启动探针不再依赖 `env`。

## 验证（Windows 11 / Node 24）

- `tsc --noEmit`：0 报错。
- `tests/deployment.spec.ts`：修改前 **5 failed / 0 passed**，修改后 **3 failed / 2 passed**。
  剩下的 3 条是**测试夹具本身只支持 POSIX**（`program()` 写 `#!/bin/sh` 脚本再 `chmod 755`，Windows 上根本执行不了），与本 PR 的产品代码无关，建议另开一条 PR 把它们换成 `.cmd` 夹具。
- 新增的两条 `windows` 用例：有修复时绿，把 `src/` 的三个文件回退后红（已验证）。

## 备注

- 未跑上游 CI 的 Linux/macOS 矩阵，本机只有 Windows。
- 仓库内 `patches/superagent-windows.patch` 只同步 `src/` 三个文件（构建期用）；带测试的完整提交在分支 `fix/windows-support` 上。
