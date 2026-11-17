# 「日常」页面插件（dsh-daily）· v0.1.0-page · 发布

**未提交**（AGENTS：用户说提交才提交）。

## 新增

| 路径 | 说明 |
| --- | --- |
| `plugins/dsh-daily/package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client.platform: web`；`files` 含 README |
| `plugins/dsh-daily/cordis.patch.yml` | `insert: [{ id: dsh-daily, name: dsh-daily }]` |
| `plugins/dsh-daily/index.js` | 宿主半身：`name`/`inject: []`/空 `apply`，只为让 bundle 能加载 |
| `plugins/dsh-daily/client.js` | 全部界面（约 600 行，手写 ModuleLoader 包，只 `require('react')`） |
| `plugins/dsh-daily/README.md` | 用途、位置理由、视觉规则、接线与关闭步骤 |
| `tests/daily-client.test.mjs` | 8 项：注册形状 + 页面骨架（无浏览器、无依赖） |
| `docs/logs/2026-11-daily/v0.1.0-page/` | 四件套 |

## 修改

| 路径 | 改动 | 为什么 |
| --- | --- | --- |
| `plugins/dsh-vivy-studio/sidebar-core.js` | `KEEP` 白名单加 `日常`（+ 注释说明 -10/-5 的位置意图） | 否则它被折进 `VIVY心核`，分组表头插到它上面、收起时它一起消失 |
| `plugins/dsh-vivy-studio/README.md` | 分组例外那段同步加 `日常` | 文档与行为一致 |
| `scripts/lib/component-setup.mjs` | `componentPackages()` 末位加 `dsh-daily` | 否则 `npm run setup` 重建 profile 时漏装，且 `tests/component-setup.test.mjs` 第 1 项必红 |
| `TODOLIST.md` | 新增 `DV-UI-007` | 状态入账 |

## 环境（不入库）

- profile `.artifacts/dsh-home/profiles/superagent-local/package.json`：`dependencies["dsh-daily"]`、`bundles` 末位；`node_modules/dsh-daily` 软链到本目录。由 `plugin_manager install_bundle` 写入，已 `applied`。
- `.artifacts/dsh-daily-check/`：一次性验证脚本（`render.mjs` jsdom 结构检查、`shot.mjs` 真 Chrome 截图），不入库。

## 回滚

1. 从 profile `package.json` 删 `dependencies["dsh-daily"]` 与 `bundles` 里的 `dsh-daily`，删 `node_modules/dsh-daily`。
2. `git checkout -- plugins/dsh-vivy-studio/sidebar-core.js plugins/dsh-vivy-studio/README.md scripts/lib/component-setup.mjs`（**注意**：这三个文件在本会话开始前已有他人未提交的改动，`checkout` 会一并丢弃，回滚前先确认）。
3. 删 `plugins/dsh-daily/`、`tests/daily-client.test.mjs`。
4. 刷新页面。

## 需要重启吗

不需要。`client.js` 是浏览器半身，刷新页面即加载（本轮已在活宿主上确认槽位注册成功）；`index.js` 那半身是空的。
