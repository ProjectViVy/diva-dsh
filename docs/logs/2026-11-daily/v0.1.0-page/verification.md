# 「日常」页面插件（dsh-daily）· v0.1.0-page · 验证记录

只记录本轮实际跑过的命令与读到的结果，时间 2026-11-14（Asia/Shanghai）。

## V1 语法与清单

| 检查 | 命令 | 实际 |
| --- | --- | --- |
| client.js 语法 | `node --check plugins/dsh-daily/client.js` | 退出 0 |
| index.js 语法 | `node --check plugins/dsh-daily/index.js` | 退出 0 |
| package.json | `JSON.parse` | ok |
| 样式表 | `.artifacts/dsh-daily-check/css-audit.mjs` | 14760 字符、花括号平衡、123 个规则块、3 个 `@media`、21 处 `color-mix`、81 种属性 |
| CSS 变量 | 同上脚本对 `--dl-*` 做定义/使用交叉 | 16 个 `--dl-*` 全部有定义且都被用到，无悬空引用；引到的外壳 token 逐个核对存在（`--dsw-alias-brand-primary` 在 diva 调色板里是 `#ea5560`，`--dsw-alias-bg-layer-2` 是 `#fbf6f1`） |

## V2 接线（活的宿主，未重启）

| 检查 | 方式 | 实际 |
| --- | --- | --- |
| 装进 profile | `plugin_manager` `install_bundle`（目标 `plugins/dsh-daily`） | `application: applied`，`warnings: []`，pnpm `+ dsh-daily 0.1.0` |
| profile 清单 | 读 `.artifacts/dsh-home/profiles/superagent-local/package.json` | `dependencies["dsh-daily"] = link:C:/…/plugins/dsh-daily`；`dsh.profile.bundles` 末位 `dsh-daily` |
| 软链 | 读 profile `node_modules/dsh-daily` | `SymbolicLink → ..\..\..\..\..\plugins\dsh-daily` |
| 槽位 | `cordis_inspect_query` client `Slots.listSubTree` root=`sidebar.panellist` | 首位 `registrant: dsh-daily, id: daily, order: -5, active: true`；其后 `plugins`(0)、`surfcore`/`dsh-superagent`/`schedules`(10)、`memory`(12)… |

注：`相遇`(dsh-live2d) 当时不在 occupant 列表里（舞台未开），-5 的定位依据是它的注册值 -10，不是本次观测。

## V3 结构（jsdom + 真 React，一次性脚本 `.artifacts/dsh-daily-check/render.mjs`）

30 项全过：包名/`inject`/两个槽位/`order`/标签/样式注入；页头品牌行与日期行；今天视图三条线 3 行、条形 6 段、轴刻度 5 个、统计 3 格、待办 4 条、今日一句；勾选可翻转（`true → false`）；本周七格且只有一格 `data-today`；记录页 3 笔、空输入时「记下」禁用、回车记下一笔并清空、页头「写一笔」跳到记录并聚焦。

过程中真发现并修掉一处：已在「记录」页时再点「写一笔」，`setTab` 值不变不触发 effect，焦点没落到输入框 —— 改为该分支直接 `focus()`。

jsdom 的两个环境坑（不是产品缺陷）：① 它不支持 `input` 事件探测，React 会走 IE polyfill 并在 `attachEvent` 上抛错，改用 `Simulate.change`；② `color-mix`/`clip-path` 会让 cssom 刷「Could not parse CSS」。两者都只影响这套假环境。

## V4 仓内测试

| 命令 | 结果 |
| --- | --- |
| `node --test tests/daily-client.test.mjs` | 8/8 通过 |
| `node --test tests/component-setup.test.mjs` | 3 通过 / 4 失败；**失败与本次无关**：A/B 复测为「去掉我加的那一行」时 2 通过 / 5 失败，只加一行让第 1 项（`default registration includes every local plugin bundle`）由红转绿；余下 4 项都在 `relocateProfileDependencies` 的锁文件夹具上，且该文件在本会话开始前已是 ` M` 状态 |

未跑：`npm test` 全量（根仓既有 Windows 失败 DV-TEST-001，与本改动无关，按 AGENTS「与改动面匹配」只跑相关面）。

## V5 像素

**未做**。`http://127.0.0.1:3082` 需要 `?token=`，启动时只打印在 `dsh web` 的终端里；`.artifacts/` 里最早那份日志带的是另一个进程的 token（该 PID 已退出）。`.artifacts/dsh-daily-check/shot.mjs` 已写好（点开入口、截 today/week/notes 与 1024/1180 窄窗、回收页面错误），拿到地址即可跑。

2026-11-14 13:29 询问用户后，用户选择「自己刷新看一眼、按验收单走」，故本轮不取 token、不截图。像素项转入 `DV-UI-007` 的「未验证」。
