# 验证记录

日期：2026-11-16，Windows，Node v24.14.1。

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| `git -C deepseek-harness log -3 --oneline` | 当前 b830ec950f，0.2.1-rc.5 | 未升级 |
| `git -C deepseek-harness status --short` | 空 | 未改上游源码 |
| `npm run status` | pids 空，manually_stopped true；现有代理为本地 HTTP 代理 | 开发入口不由后台 launcher 登记，不能只据此排除所有 dev 进程 |
| `node .artifacts/runtime-network-probe.mjs`（沙箱外复核） | 直连/现有代理：current 均 403 HTML / CloudFront Error；summary 均 200 JSON | 无凭据；summary 的 HTTP 200 不单独证明登录有效 |
| `node .artifacts/account-readonly-probe.mjs` | 本机 grant 存在、issuer 为官方；带凭据 current 403 HTML；summary 200、code 0、bizCode 0 | 只读，未输出 token、账户信息、余额、完整正文；最后一遍使用上游的五个 x-client 头 |
| `node --import ./deepseek-harness/node_modules/tsx/dist/esm/index.mjs .artifacts/inspector-close-repro.mjs` | 预期复现失败，exit 1，四层堆栈与用户一致 | 人工关闭真实 source 后触发状态事件；并未复现 source 首次关闭原因 |
| `node deepseek-harness/node_modules/typescript/bin/tsc -b deepseek-harness/tsconfig.client.json --pretty false` | exit 0，无输出 | 单次增量类型构建；不等价于全新构建或持续 watch |

公开探针首次在沙箱内直连为 EACCES，按权限规则提升后重新执行；外部直连结果同样为 CloudFront 403。代理请求在两种执行环境下都能复现。没有将沙箱 EACCES 当作产品故障。

## 源码依据

- `deepseek-harness/packages/credentials/deepseek-account-platform/src/protocol.ts:181-189`：401 才分类 expired；其他非成功 HTTP 分类 network，并取消响应正文。
- 同包 `src/details.ts:76-87`：资料网络失败投影为 status failed。
- 同包 `src/index.ts:191-202`：资料缓存只在内存；`:255-267`：取不到资料且无缓存时账号身份查询失败；`:593-598`：授权交换中的可选 user 可填初始资料。
- `deepseek-harness/packages/experimental/inspector/src/host/bridge/publisher.ts:31`：source 关闭后 setState 抛异常。
- 同插件 `src/shared/cordis/observer.ts:25-33` 与 `src/shared/cordis/publisher.ts:22-24`：微任务发快照到 source，无异常捕获。
- 同插件 `src/host/bridge/controller.ts:265-276`：Worker 意外停止时关闭 source；`src/host/bridge/transport.ts:44-49`：收帧/处理异常也会关闭 source。后者 catch 未输出异常。
- `scripts/dev.mjs:64-87`：任一子进程退出后对两个子进程树强制结束。

## 未验证

- 原始运行日志中的 source 首次关闭触发事件；已向用户索取前文。
- 当时 tsc watcher 是否有独立报错，或仅被启动器清场。
- 网页授权的 auth_init / auth_exchange 本轮是否成功；本轮只证明已有授权被账户摘要接受。
- 真实模型推理、禁用 inspector 后长期稳定性、修复后运行。未声称已修好。
- 未运行 npm test：本轮没有修改产品代码、配置或依赖，仅交付诊断文档与 .artifacts 一次性探针；根测试不能证明远端 WAF 或原始退出时序。
