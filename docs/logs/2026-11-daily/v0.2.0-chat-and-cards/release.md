# 发布说明

## 变更

- `plugins/dsh-daily/client.js`（63243 → 约 80 KB，1707 行）：右栏四页改为 genui `dsh-ui` spec 渲染，vendored 19 种节点 + `validateSpec` + `renderSpec`；手写卡片 DOM 与只服务它的常量删除；左栏聊天未改动。
- `plugins/dsh-daily/VENDORED-genui.md`（新）：上游仓、commit `3357603`、MIT 原文、保留/删除清单、魔改点、再同步步骤。
- `plugins/dsh-daily/README.md`：新增「右栏由 genui spec 驱动」一节（怎么加卡、示例卡是假数据、限额、交互契约）。
- `tests/daily-client.test.mjs`：18 → 23 项；另把写死的「今天，11 月 14 日」改成 `todayStamp()`。
- `.artifacts/dsh-daily-check/{render3,shot-page}.mjs`：四页断言与真 Chrome 截图（本机验证资产，不入库）。

## 依赖与许可

- vendor 代码来自 `dsh-genui` v0.16.0（MIT），保留了许可声明与来源 commit；没有安装该插件，也没有引入构建工具或新依赖。

## 回滚

- 用 `.artifacts/dsh-daily-backup/20261115-before-genui/` 里的三份原始文件覆盖回去即可（`plugins/dsh-daily/` 在根仓库中未被跟踪，没有 git 兜底）。

## 注意

- 全仓 `npm test` 的 1 项失败是 `tests/memory-actmem.test.mjs` 的既有时间窗缺陷（本地 0:00–3:59 必挂，`dailyHour: 4`），与本轮无关，已在 `verification.md` 留证据，未修。
