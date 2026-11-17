# 验收 —— v0.1.0-user-plugins

## 验收目标

把「私有插件放 `user-plugins/` → 一条命令注册 → 面板里生效」走通，并确认空档位零副作用。

## 步骤

1. **放源码**：把要私有安装的插件目录放进 `user-plugins/<名字>/`。最小结构见
   `user-plugins/README.md`：`package.json`（含 `dsh.bundle.patch`）、`cordis.patch.yml`、入口文件。
2. **只读检查**（面板运行中也能跑）：
   ```sh
   npm run setup:user-plugins -- --check
   ```
   预期：每个插件显示 `[就绪]` 或 `[待构建]`；若显示「未注册」是正常的（还没注册）。
   空档位预期 exit 0 且输出「空档位，无操作」。
3. **停面板后注册**：
   ```sh
   npm run stop
   npm run setup:user-plugins
   npm start
   ```
   预期：脚本打印 `== 注册 <包名>`，最后 `user-plugins 就绪：<包名>`；启动后该插件的工具/面板入口出现。
4. **改源码**：改 `user-plugins/<名字>/` 里的代码 → `npm run stop && npm start`，确认新行为（链接没变，重启即生效）。
5. **删目录再跑**：临时删掉插件目录 → `npm run stop && npm run setup:user-plugins`，预期脚本打印「清理残留 link <包名>」并成功；再启动没有该插件，也不报错。
6. **--check 复跑**：面板运行中执行 `--check`，预期 exit 0、不再有「未注册 / 残留 link」。

## 反面验收

- 放一个没有 `dsh.bundle.patch` 的目录 → `--check` 报「没有声明 dsh.bundle.patch」，`sync` 拒绝且不注册。
- 放一个与主仓插件同名的包（例如 `dsh-daily`）→ `--check` 报「已被 profile 里另一个来源占用」。
- 注册时面板没停 → 脚本报「先停面板：npm run stop」并退出，不改 profile。
