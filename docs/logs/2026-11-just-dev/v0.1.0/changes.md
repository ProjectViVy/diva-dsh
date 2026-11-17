# 变更与取舍

- `Justfile`：默认 recipe 显示教程，dev recipe 启动服务；调用 Node 脚本，Windows 显式使用 PowerShell。
- 后续按用户要求收窄默认行为：`just` 与 `just dev --help` 复用同一份中文使用教程。
- `scripts/dev.mjs`：项目内 pnpm 构建、上游 no-serve 监听和独立 profile 服务；继承本仓环境/代理；后台服务存在时拒绝启动；退出清理子进程树。
- `README.md`：开发入口、先决条件、停止方式和插件监听边界。
- `TODOLIST.md`：登记 DV-OPS-003。

最简方案是复用上游 dev:web。实测其服务阶段写死 web profile，不能追加 superagent-local，故只复用监听阶段。备选包装 npm start 代码更少，但缺少开发监听，不满足用途。没有新增依赖，也没有改动上游仓源码或子模块指针。
