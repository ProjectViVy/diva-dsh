# dsh-see-now · v0.3.0-vivy-core · 发布

- 性质：**源码级 submodule 的本地 UI/生命周期改造**；未提交（按 AGENTS.md，用户说提交才提交）。
- 基线：`plugins/dsh-see-now` HEAD `1d98dd5bf1fdcad58fbf27b6906bb8c525ccccb3`（`vivy-dsh/dsh-see-now`）。
- 新增：
  - `src/lifecycle-store.mjs`：`lifecyclePath` / `appendLifecycle` / `readLifecycle` / `clearLifecycle`，JSONL，512KB 截断，坏行跳过。
  - `test/lifecycle-store.test.mjs`（2 条）、`test/lifecycle-api.test.mjs`（5 条）。
- 改动：
  - `client.js`：新增 `SeeNowPanel`（总览/会话/记录/配置/隐私）、状态卡与动作按钮、记录表、隐私区；`main` 改为渲染该面板；`sidebar.panellist` label 改「我看到了」；**删除** `settings.section` 注册。
  - `src/settings-api.mjs`：新增 `/api/see-now/lifecycle`；GET 返回状态/流水/路径，POST 接受 `start` / `stop` / `window-open` / `window-close` / `clear`；动作失败回 `{ok:false,rejected}` 并写失败流水。
  - `src/index.js`：`installSettings` 接收 `lifecycle` 闭包，接 `runner.start/stop`、`ensureLoop`、`stopLoop`、`openWindow`、`closeWindow`、`windowReport`。
  - `test/client-wiring.test.mjs`：断言 2 槽位、无 settings、label「我看到了」、首帧外壳；不再按 settings 取首帧。
  - `patches/see-now-vivy-core.patch`：重新生成，**39,930 字节，7 文件**。
- 可复现：
  1. `git submodule update --init plugins/dsh-see-now`
  2. `npm run setup:see-now`（或 `npm run setup`）
  3. `npm run stop` / `npm start`；硬刷新 GUI。
- submodule 状态：工作区含上述 7 个文件的本地改动（4 改 + 3 新），未提交。`git submodule update --checkout` 会清掉；`npm run setup:see-now` 可重放。补丁的 reverse-check 与「已应用」幂等已验证；没有另建临时 clone 做正向 apply 全流程。
- 回滚：
  1. 把 `plugins/dsh-see-now` 的本地改动 rename 到隔离目录（或 `git checkout -- .`，但先备份）。
  2. `npm run setup:see-now` 可重新应用；若不再需要面板，删补丁里的 `client.js`/`src/*` 改动并重跑 setup，或按 `v0.2.0-install/acceptance.md` 第 7 条移除接线。
  3. 不直接不可逆删除；配置与流水在 `.artifacts/dsh-home/see-now/`，可保留。
- 风险 / 已知限制：
  - 「记录」只记动作，不是画面/会话历史；要帧级历史需另立隐私与存储决策。
  - start 后 6 秒 `0 帧` 未定因，真实出图/ token/CPU 未验。
  - 悬浮窗按钮只做了代码/单测，未真实点击。
  - host 重启在本机曾留下旧进程；`npm run restart` 的 `ResourceUnavailable` 是控制台标题写入错误，不代表服务没起，但必须按端口/进程确认，不能只看 exit code。
  - 根仓 `npm test` 的 114 条 Windows 既有失败未修，与本补丁无关，也未计为通过。
