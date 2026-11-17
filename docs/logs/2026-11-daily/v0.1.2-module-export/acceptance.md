# 运行期验收

1. 在运行宿主的终端停止旧服务并重新启动。此次启动器没有识别现存服务 PID，不能靠重复启动替代重启；不要同时运行两份服务。
2. 浏览器硬刷新。
3. 确认不再出现 `dsh-daily: import failed: module is not defined`，且「日常」可打开。
4. 按 `../v0.1.1-copy/acceptance.md` 继续检查四页与交互。

后续已完成第 1 步：保存本机 7890 代理后重启成功，runtime ready。第 2–4 步仍待浏览器验收。离线回归命令：`node --test tests/daily-client.test.mjs`。
