# dsh-see-now · v0.3.1-debug · 发布

- 性质：`plugins/dsh-see-now/client.js` 的本地 UI 增量；未提交（按 AGENTS.md，用户说提交才提交）。
- 改动：
  - `SN_TABS` 增加 `['debug','调试']`，排在「记录」后。
  - 新增 `SnDebug`：实时状态卡、最近错误、最近 6 条动作、原始状态 JSON。
  - `SeeNowPanel` 在 `tab==='debug'` 或采集运行时每 1.5 秒轮询 `/lifecycle`；开始成功后自动切调试页。
  - `test/client-wiring.test.mjs` 新增导航断言。
- 不改服务端：复用 v0.3.0 的 `/api/see-now/lifecycle` 状态，不新增路由、不落盘新数据。
- 补丁：`patches/see-now-vivy-core.patch` 更新为 **45,047 字节**，7 文件；干净 HEAD 上 `git apply --check` 通过。
- 测试：插件 **511/490/0/21 skip**；客户端接线 20/20。
- 运行期：host PID 32504；开始看后自动切调试页，14 秒读到 `156 帧 / 0 张`；停止后 `没在看`。
- 回滚：`git -C plugins/dsh-see-now checkout -- client.js test/client-wiring.test.mjs`（先备份），再 `npm run setup:see-now` 可重放旧补丁；不删除日志与配置。
- 风险 / 限制：
  - 每 1.5 秒两次 GET 只在调试页/采集时发生；长期运行的稳定性未测。
  - 帧数增长不等于出图；静止画面 0 张是预期，需用变化画面复验。
  - 六标签在窄窗口可能横向滚动；未做移动端适配。
