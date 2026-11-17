# 变更

- `plugins/dsh-daily/client.js`：直接返回插件对象，移除对浏览器不存在的 `module.exports` 的依赖。
- `tests/daily-client.test.mjs`：不再向客户端脚本伪造 CommonJS module，保留现有入口、页面与交互断言。
- 最简方案为直接返回对象；备选是在工厂内加 CommonJS 包装。宿主已消费工厂返回值，直接返回成本最低，与其他插件一致。
- 无依赖、接线与上游源码改动；未暂存或提交其他既有改动。
- 后续运维：用户要求挂代理并重启；通过既有 CLI 保存本机 HTTP 代理 `127.0.0.1:7890`，成功重启 superagent-local。代理配置只在忽略的 `.artifacts/proxy.json` 中。
