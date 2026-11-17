# dsh-see-now · v0.3.0-vivy-core · 总结

- 目标：把 see-now 从「设置里的一张表单」改成 `VIVY心核` 里的**「我看到了」**管理页，覆盖看/陪看/记录/配置/隐私的整条生命周期；按用户要求，DSH 设置里不再保留独立分区。
- 结论：第一版已落地并运行期验证到「面板可开、生命周期 start/stop 可执行、记录可写、配置页可读」。**还没有验证真实画面出图与 token/CPU**，这两项单独列为未验证，不写成已通过。

## 方案（最简 + 备选）

- 选：**一个插件内聚面板**，`main` + `sidebar.panellist` 两个槽位，侧栏 id `see-now`、order 16、label「我看到了」；面板内五个标签：总览 / 会话 / 记录 / 配置 / 隐私。
  - 「配置」直接复用原 `SettingsPage`，不重写字段与校验；「隐私」「记录」只读元数据。
  - 宿主侧新增一条 `/api/see-now/lifecycle`：GET 返回采集/窗口/循环状态 + 流水；POST 接受 `start` / `stop` / `window-open` / `window-close` / `clear`。
  - 流水 `~/.dsh/see-now/lifecycle.jsonl` 只写动作与结果，不写画面、帧、窗口标题；超过 512KB 保留最近 500 行。
- 备选：保留 `settings.section` 并只改 label。否决原因：用户明确说设置里不用保留；两套入口会让「配置在哪」分裂。
- 备选：把记录做成帧级历史。本轮否决：see-now 上游不落盘画面，新增图像历史会改变隐私面与存储成本，需单独决策；先交付可用的动作生命周期。

## 落点

- `plugins/dsh-see-now/client.js`：新增 `SeeNowPanel` 与五个标签、状态卡、动作按钮、记录表、隐私区；移除 `settings.section` 注册；侧栏 label 改「我看到了」。
- `plugins/dsh-see-now/src/lifecycle-store.mjs`（新）：JSONL 追加/读取/清空/截断。
- `plugins/dsh-see-now/src/settings-api.mjs`：新增 `/lifecycle` GET/POST，动作转发给宿主闭包并写流水。
- `plugins/dsh-see-now/src/index.js`：把 `runner` / `loop` / `ensureLoop` / `stopLoop` / `openWindow` / `closeWindow` 包成 `lifecycle`，传给设置接口。
- 测试：`test/client-wiring.test.mjs` 改断言（2 槽位、无 settings、label「我看到了」、首帧外壳）；新增 `test/lifecycle-store.test.mjs`、`test/lifecycle-api.test.mjs`。
- 根仓：`patches/see-now-vivy-core.patch` 重新生成（**39,930 字节，7 文件**）；`scripts/setup-see-now.mjs` 仍幂等；profile 接线未改。

## 测试与运行期

- 插件全量：**510 tests / 489 pass / 0 fail / 21 skipped**。
- 新增 API 契约：5/5 通过；生命周期流水：2/2 通过；客户端接线：21/21 通过（含既有纯函数）。
- 运行期：旧 host（PID 34084，02:18 启动）在 `npm run restart` 后仍占用 3082；强制停掉后新 host（PID 41848，06:19:24）起来。浏览器里点「我看到了」→「开始看」：出现「正在看」「陪看循环在跑」、toast「开始看：完成」、流水写入 `{"action":"start","ok":true,"note":"screen"}`；点「停止」：出现「没在看」「无循环」、流水写入 `{"action":"stop","ok":true}`；`see_now status` 确认采集/循环/窗口均停。
- 设置分区：`settings.section` 的 live occupants 中已无 `see-now`；侧栏 `sidebar.panellist` 中 `dsh-see-now` 的 `see-now` order 16 为 active。
- 配置页：标签内仍能读出转写服务/常用/高级字段；隐私页显示文件路径与三个动作。

## 未验证 / 限制

- 真实抓屏出图：开始 6 秒时面板显示「0 帧」；可能是静止画面、ffmpeg 启动慢或当前桌面无变化，**不能据此判断抓屏失败**，也不能判断成功。需要再跑静态文档 + 视频两段并记录。
- token/CPU、端到端时延未记录。
- 桌面悬浮窗视觉未在本次验收中打开/截图；`window-open` 路由只做了代码与单元测试，未点真实按钮。
- 记录是**动作流水**，不是帧/会话历史；没有「按天归档、删除某次会话」这类能力。
- 根仓 `npm test` 仍有 114 条 Windows 既有失败（1350/1230/114/6），本轮未修，也不计为通过。
- 补丁仍是 submodule 的本地未提交改动；`git submodule update --checkout` 后需 `npm run setup:see-now` 重放。

## 下一步

1. 让用户硬刷新后按 `acceptance.md` 走一遍；重点看「开始看」后是否真的出图、画面描述能否对上。
2. 若 0 帧持续：查 `runner.status().lastError`、ffmpeg 路径、`see_now({action:"watch"})` 单次路径，而不是先加功能。
3. 出图成立后再决定是否要「帧级历史/会话归档」；那会改隐私面，单独立项。
4. 可选：把本地面板补丁推回 `vivy-dsh/dsh-see-now`，让 submodule 恢复干净。

## 06:55 后续

- 按用户要求新增「调试」页：开始看后自动切换，1.5 秒刷新采集/循环/窗口/心跳/帧数与原始状态；见 `docs/logs/2026-11-see-now/v0.3.1-debug/`。本版结论不变，出图仍未验；补丁现为 **45,047 字节**（含调试页）。
