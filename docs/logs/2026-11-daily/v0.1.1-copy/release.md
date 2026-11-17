# 「日常」· v0.1.1-copy · 发布

**未提交**（AGENTS：用户说提交才提交）。

## 修改

| 路径 | 改动 | 为什么 |
| --- | --- | --- |
| `plugins/dsh-daily/client.js` | 整篇重写（855 行）：两栏工作台，内容照搬参考原型，皮换成 DIVA 纸墨 | v0.1.0 把原型「重新设计」成三视图，用户要的是照搬内容 |
| `tests/daily-client.test.mjs` | 整篇重写（12 项）：两栏骨架 + 四页逐条文案 + 三个交互 | 结构变了，原测试断言的是旧骨架 |
| `plugins/dsh-daily/README.md` | 按照搬后的结构重写；补「要重启」的原因与验证脚本清单 | 文档与实现一致 |
| `docs/logs/2026-11-daily/v0.1.1-copy/` | 新增四件套（本目录） | 交付记录 |

## 未改动（v0.1.0 已接线，仍然有效）

| 路径 | 状态 |
| --- | --- |
| `plugins/dsh-daily/package.json` / `cordis.patch.yml` / `index.js` | 原样 |
| `plugins/dsh-vivy-studio/sidebar-core.js` | `KEEP` 白名单里的 `日常` 仍在（v0.1.0 加的） |
| `plugins/dsh-vivy-studio/README.md` | 分组例外那段仍含 `日常` |
| `scripts/lib/component-setup.mjs` | `componentPackages()` 的 `dsh-daily` 一行仍在 |

## 环境（不入库）

- profile `.artifacts/dsh-home/profiles/superagent-local/package.json`：
  `dependencies["dsh-daily"]`、`bundles` 末位、`node_modules/dsh-daily` 软链 —— v0.1.0 装的，未动。
- `.artifacts/dsh-daily-check/`：一次性验证脚本与截图（`render2.mjs` / `shot-page.mjs` /
  `page.template.html` / `new-*.png` / `ref/`），不入库。

## 回滚

1. `git checkout -- plugins/dsh-daily/client.js plugins/dsh-daily/README.md tests/daily-client.test.mjs`
   —— 注意这三个文件是**新建**的（未提交），`checkout` 对未跟踪文件无效；回滚等于删掉
   `v0.1.1-copy` 的版本、恢复 v0.1.0。要留证据就先 `cp` 一份到隔离目录。
2. 删 `docs/logs/2026-11-daily/v0.1.1-copy/`。
3. 刷新页面。

## 需要重启吗

**需要一次**，但这次重启不是为了新界面（`client.js` 刷新页面就生效），而是为了让
`dsh-vivy-studio/sidebar-core.js` 的改动生效：那份脚本在宿主启动时被
`readFileSync` 进 `index.html`，运行中的宿主手里还是旧版本，所以「日常」此刻仍会被折进
`VIVY心核`。**这不是本次改动带来的新阻塞**，v0.1.0 交付时同样存在，只是当时归入
「等用户刷新」。

重启命令：`npm run restart`；随后硬刷新页面（Ctrl+Shift+R）。
