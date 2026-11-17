# 使用验收

1. 首次先 `npm run setup`；已有后台服务先 `npm run stop`。
2. 根目录执行 `just`，只显示中文使用教程；执行 `just dev`，才构建并启动监听与 superagent-local。
3. 已构建时可执行 `just dev --skip-build`；面板地址看输出，不固定端口。
4. 修改允许开发的源码后观察重建及浏览器变化。本地插件需其自身构建。
5. Ctrl+C 后确认开发服务与监听进程退出。

本轮只完成入口及部分运行验收，热更新和 Ctrl+C 尚需真实终端复核。
