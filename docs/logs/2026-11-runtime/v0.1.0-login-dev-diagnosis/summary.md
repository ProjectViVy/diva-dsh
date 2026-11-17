# DeepSeek 账号资料 403 与 inspector 致命退出诊断

- 状态：诊断有交付；没有修复或更改运行配置。等待崩溃前日志，以确定 inspector 首次关闭原因。
- 已验证：账号资料接口被 CloudFront 拦截；现有账号凭据仍能读取账户摘要。
- 已验证：inspector source 关闭后，Cordis 状态变化会触发与用户相同的未捕获异常；不需要账号或网络请求。
- 未验证：本次运行中 source 最初为何关闭、tsc watcher 是否曾独立故障、任何修复后的端到端运行。

## 结论与证据

1. **账号凭据存在且至少被账户摘要接口接受。** 使用本机存储凭据，只向原发行方 `https://platform.deepseek.com` 发送 GET，`/api/v0/users/get_user_summary` 返回 HTTP 200、`code: 0`、`biz_code: 0`。不输出账号资料、余额、token 或响应原文。
2. **资料读取被平台 CDN 拦截。** `/auth-api/v0/users/current` 在直连和现有代理下均返回 HTTP 403、`text/html`、`x-cache: Error from cloudfront`，HTML 命中 Request blocked。携带账号凭据和客户端身份头后结果相同。上游把所有非成功 HTTP（401 特判除外）都标成 `network`，该日志不能等同于断网或授权过期。公开无凭据探针与带凭据探针分开执行。
3. **inspector 能独立杀死宿主。** 使用当前只读上游的真实 `Context`、`HostInspectorSource`、`publishCordisTree`，关闭 source 后发出一次 Cordis 状态事件，Node exit 1，栈为 `HostBridgePublisher.setState` → `HostInspectorSource.setState` → shared/cordis/publisher → observer，文件行号与用户日志一致。`setState` 在 closed 后抛异常，微任务监听器不捕获；source 的异常关闭也不解除树监听。此复现没有登录或任何网络请求。
4. **开发启动器会放大一个宿主故障。** `scripts/dev.mjs` 监听任一子进程退出，在 Windows 对两个子进程树执行 `taskkill /T /F`；宿主先崩时，watcher 也会被结束。因此结尾的 tsc exit 1 可以是次生退出。单独运行 `tsc -b tsconfig.client.json --pretty false` exit 0；这不排除当时 watcher 有独立问题。

当前 DSH 为 `b830ec950f` / `0.2.1-rc.5`，上游工作树干净。没有证据将这两种故障归因于最近的 genui/Superagent 本地改动；本轮也没有完成所有插件的排除实验。

## 最小处理建议与备选

最小止损：在插件管理中禁用 `experimental-inspector`（实验性开发者工具），日常使用 `npm start`，绕开该诊断组件的致命退出路径。`npm start` 本身不会自动禁用 inspector。备选：按仓库规则在根 `patches/` 修复 source 失效与树监听器的生命周期，并接入构建与源运行两条路径；不直接改上游源码。前者影响小、恢复运行更快；后者保留调试能力，但需要针对关闭路径的回归验证。本轮没有执行任一方案。

账号资料端需平台调整拦截策略。反复重登、换代理或仅改 User-Agent 不能视为可靠修复；重新授权可能利用 `auth_exchange` 返回的可选 user 填充内存缓存，但缓存不跨宿主重启。本轮未注销、重登或测试真实推理请求。

## 上游对应报告（用户实测报告，非官方修复承诺）

- [资料接口遭 CloudFront 拦截 #11601](https://github.com/deepseek-ai/deepseek-harness/discussions/11601)
- [inspector source 关闭后宿主崩溃 #11485](https://github.com/deepseek-ai/deepseek-harness/discussions/11485)

下一步：补崩溃栈之前约 30 行日志，区分 Worker 异常退出（例如 ECONNRESET）、bridge 收帧失败或正常关闭竞态；确认后选择禁用 inspector 或做生命周期补丁。
