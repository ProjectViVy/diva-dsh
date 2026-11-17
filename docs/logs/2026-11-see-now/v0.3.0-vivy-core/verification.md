# dsh-see-now · v0.3.0-vivy-core · 验证

时间：2026-11-13 06:00–06:30（Asia/Shanghai）。只列命令、真实输出与真实 UI 观察；「没看到」不写成「没问题」。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node --check`：`client.js`、`src/settings-api.mjs`、`src/index.js`、`src/lifecycle-store.mjs`、两个新测试 | 全部可解析 | `syntax ok`；client 首轮有括号错误，修正后 exit 0 |
| 2 | `node --test test/client-wiring.test.mjs test/lifecycle-store.test.mjs` | 接线与流水通过 | **21 tests / 21 pass / 0 fail** |
| 3 | `node --test test/lifecycle-api.test.mjs` | `/lifecycle` 契约 | **5 tests / 5 pass / 0 fail**：GET 空流水、start 落回调并记一条、window-open/stop、未知 action 400、clear 后只剩 clear 审计条 |
| 4 | `node --test`（插件目录） | 不回归 | **510 tests / 489 pass / 0 fail / 21 skipped**，约 48.3s |
| 5 | `npm run setup:see-now`（补丁已应用） | 幂等 | `dsh-see-now: VIVY心核 panel patch already applied` |
| 6 | `patches/see-now-vivy-core.patch` | 覆盖全部本地改动 | 重新生成后 **39,930 字节**，7 文件（4 改 + 3 新） |
| 7 | `npm run restart` | host 换成新代码 | **exit 1**：`ResourceUnavailable … 设置控制台窗口标题 … 管道的另一端上无任何进程`；旧 host（PID 34084，02:18 启动）仍占 3082 |
| 8 | `Stop-Process -Id 34084 -Force` 后检查端口 | 旧进程释放 | 3082 由新 PID **41848**（06:19:24 启动）监听；`runtime=ready` |
| 9 | Client Slot 检查 `sidebar.panellist` | see-now 在、order 16 | `registrant=dsh-see-now, id=see-now, order=16, active=true` |
| 10 | Client Slot 检查 `settings.section` | 不再有 see-now | occupants 为 general/skins/laputa/voice/world-gateway/models/plugins/agent-presets，**无 see-now** |
| 11 | 浏览器点侧栏「我看到了」 | 打开新面板 | UIA 读到：`VIVY · 感知`、`我看到了`、五个标签（总览/会话/记录/配置/隐私）、四张状态卡、开始/停止/打开/关闭/刷新按钮 |
| 12 | 点「开始看」 | 起采集与循环、写流水 | 出现 `正在看`、`陪看循环在跑`、toast `开始看：完成`；流水 `{"at":"2026-11-12T22:25:36.810Z","action":"start","ok":true,"note":"screen"}`；6 秒时卡片显示 `screen · 0 帧 · 0 秒` |
| 13 | 点「停止」 | 停采集/循环、写流水 | 出现 `没在看`、`无循环`、toast `停止：完成`；流水追加 `{"at":"2026-11-12T22:25:54.891Z","action":"stop","ok":true}` |
| 14 | 「配置」标签 | 复用原设置表单 | 读到 `看你看的东西`、`常用`、`用哪个转写服务`、转写服务区块、`保存`/`重新读取` |
| 15 | 「隐私」标签 | 隐私边界与动作 | 读到隐私说明、`停止一切采集`/`关闭悬浮窗`/`清空动作记录`、`画面不落盘`、生命周期路径 |
| 16 | `see_now({action:"status"})`（停止后） | 采集/循环/窗口均停 | `没在采集（37s 前停的）`、`循环：没起`、`窗口：没开过` |
| 18 | 干净 HEAD 临时目录：`git archive HEAD` + `git init` + `git apply --check` / `git apply` | 补丁能正向重放 | `forward apply --check: OK`；`forward apply: OK`；临时目录 174 个文件，验证后删除 |
| 19 | `Invoke-WebRequest /api/see-now/lifecycle`（无浏览器 cookie） | 可选直连验证 | **401**（内核 `connection.admit` 认证）；浏览器内同源请求正常，见 12–13；未把 401 当路由失败 |

## 未验证（不得写成「已通过」）

- 真实出图：开始后 6 秒为 `0 帧`，没有足够证据判断抓屏成功或失败；静态文档与视频两段未跑。
- 模型是否真的收到图并描述正确（`see_now` / `/seenow` 端到端）。
- 每张 token、CPU、端到端时延。
- 「打开悬浮窗 / 关闭悬浮窗」按钮的真实点击；只验证了路由与 `window.js` 既有测试。
- 记录页在多次 start/stop 后的滚动、清空后的空状态（clear 只在 API 测试里覆盖）。
- 根仓 `npm test`：1350/1230/**114 fail**/6 skip，Windows 既有失败，未修、未计入本插件通过。
- submodule 补丁的正向 apply 已在临时干净 HEAD 上验证（`--check` 与真实 apply 都通过）；未在另一台机器、另一 OS 或不同 Node 版本上验证。
