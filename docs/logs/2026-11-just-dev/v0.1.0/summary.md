# Justfile 开发入口

- 状态：已交付 Justfile、scripts/dev.mjs 与 README 用法；未提交。
- 默认行为按用户修订：`just` 只显示中文教程，`just dev` 才启动；已实际执行 `just` 验证。
- 方案：复用上游构建监听，单独启动 superagent-local；不改上游源码。
- 验证：Justfile 解析/参数转发、脚本语法及帮助通过；真实服务监听并返回 HTTP 401。
- 未验证：首次完整构建、浏览器热更新、真实终端 Ctrl+C；Vite 临时文件权限错误；根测试失败并挂起。

详见 [verification.md](verification.md) 和 [acceptance.md](acceptance.md)。
