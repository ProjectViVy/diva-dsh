# 验证记录 v0.5.0

## 1. 宿主半边：HTTP 路由

`node --test tests/daily-today.test.mjs` → **7 项 / 7 通过**。用假 ctx 抓住 `webServer.register`，直接调 handler，不起真服务器（写法照 `tests/superagent-reset.test.mjs`）。

| # | 场景 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1.1 | 注册 | `kind: 'prefix'`、`path: '/dsh-daily/api'`、只依赖 `webServer` + `connection` | 通过 |
| 1.2 | 有文件 | 200，`ok: true`，`html` 原样，`date` 回显 | 通过 |
| 1.3 | 缓存头 | `no-store`（worker 可能刚改过） | 通过 |
| 1.4 | 没文件 | 404，`ok: false` | 通过 |
| 1.5 | 没文件时的日志 | **空**（不把常态刷成错误） | 通过 |
| 1.6 | 坏日期 `''` / `../secret` / `../../etc/passwd` / `2026-11-15.html` / `20261115` | 全部 400，且不返回 `html` | 通过（五个全拒） |
| 1.7 | 600 KB 文件 | 当作没有 → 404 | 通过 |
| 1.8 | 外部 host | 403 | 通过 |
| 1.9 | 跨站非 GET | 403 | 通过 |
| 1.10 | `DSH_HOME` 未设置 | 503，话里带 `DSH_HOME` | 通过 |

## 2. 浏览器半边：右栏 Today 的三种状态

`node --test tests/daily-client.test.mjs` → **32 项 / 32 通过**（原 29 + 3 条）。

| # | 场景 | 预期 | 实际 |
| --- | --- | --- | --- |
| 2.1 | 宿主有页面 | 一个 iframe、`sandbox="allow-scripts"`、`srcdoc` 含 worker 的 HTML 与 `connect-src 'none'`、示例卡 0、标签「worker 写的」 | 通过 |
| 2.2 | 请求形态 | 只问一次；`/dsh-daily/api/today?date=YYYY-MM-DD` | 通过（正则断言日期格式） |
| 2.3 | 404 | 不长框、示例卡还在、标签说清是示例 | 通过 |
| 2.4 | fetch 抛错 | 不炸、不空白、整页还在 | 通过 |
| 2.5 | 语法 | `node --check` client.js / index.js | 通过 |

## 3. 真 Chrome 像素

`.artifacts/dsh-daily-check/today-shot.mjs`（离线页 + 假 `fetch`，回一份 4 卡的 worker 页面）

| # | 指标 | 实际 |
| --- | --- | --- |
| 3.1 | `.dl-today-frame` 数量 | 1 |
| 3.2 | 框尺寸 | 572 × 249（右栏宽 576，扣掉边框与内距） |
| 3.3 | 框高度 | `style="height: 249px"`——是内容回报的，不是默认 200 |
| 3.4 | 示例卡 `dl-g-card` | **0**（worker 的页面在场时示例卡退场） |
| 3.5 | 标题条 | 「今天的界面 · worker 写的」 |
| 3.6 | 页面错误 | 无 |
| 3.7 | 回落态 | `shot-page.mjs` + `new-today.png`：「还没有人写，下面是示例」+ 刷新按钮，示例卡在位 |

## 4. 全仓回归

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 4.1 | `npm test` | 无新增失败 | **1409 项 / 1403 通过 / 0 失败 / 6 跳过**（上一轮 1399/1393：+7 宿主用例 +3 浏览器用例） |

## 5. 未做的验证

- **真宿主的这条路由没跑过**：`connection.requestRejection` 在自建 prefix 路由上放不放行，要重启后才知道。`dsh-superagent-reset` 用了同一套写法，但它自己那行在真 host 里也还没验收过（DV-UI-013 同样在排队），所以这一点不能算「有先例就安全」。
- **离线截图里的 CORS 报错是噪声**：`file://` 页去 fetch `/dsh-daily/api/...` 必然被挡。真页面是同源，不受影响；但这意味着「offline 页回落态」测的是 fetch 失败分支，不是 404 分支（404 分支由单测覆盖）。
- **worker 真写一次没验**：规则不存在，只能手动放文件。所以「worker 写出来的 HTML 长什么样」还没有一次真实样本——现在 `worker-today.html` 是我为了看像素手写的。
