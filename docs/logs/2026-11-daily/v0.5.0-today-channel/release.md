# 发布记录 v0.5.0

- 是否发布：**是**，但**需要重启**（宿主半边新增了一条路由）
- 不发布原因：—

## 发布步骤

1. `npm run stop`
2. `npm start`
3. 浏览器硬刷新 3082（Ctrl+Shift+R）

端口不固定，用 `npm run status` 或 `.artifacts/` 里的记录，别硬编码。

## 发布后必做

- **先验路由活着**：`GET /dsh-daily/api/today?date=<今天>` 应当 404（还没有人写）。
  - 401/403 = `connection.requestRejection` 拦了自建路由。这是本版最可能的失败点，`dsh-superagent-reset` 用同一套写法但它自己那行也还没在真 host 里验收过，所以不能拿「有先例」当安全。
  - 500 = 看 `.artifacts/` 下的 host 日志，`daily api failed:` 那行。
- **用户手动放一页**验一次右栏（见 `acceptance.md` 第 1 节）。这一段没验过，等于通道还没通。
- 需要回头核对的信号：
  - 框高是否贴着内容（左栏那条曾量错对象，右栏共用同一段代码，所以同理）。
  - 若某天文件很大（>512 KB）→ 右栏静默回落示例卡，只会在宿主侧当作「没有」。如果真出现，说明该给 worker 一条「一页别写太大」的约束，而不是把上限调高。
- **worker 还不会写这个文件**：现在只能手动放。要让 worker 真写，得加提示词规则（下一条任务），本版不包含。

## 回滚

客户端与宿主两边都是我们自己的插件（`plugins/dsh-daily/` 未被根仓库跟踪）：

1. `index.js` 回到空 `apply()`（只是注册一个能被 bundle 加载的入口）。
2. `client.js` 删 `TODAY_API` / `todayKey` / `fetchToday` 与 `DailyPage` 里那段 effect；`TodayView` 回到只渲 `DAILY_CARDS`；删 `.dl-today*` CSS。
3. 重启 + 硬刷新。

回滚后右栏 Today 仍是示例卡，与 v0.4.0 一致；左栏的自由 UI 不受影响。
