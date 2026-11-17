# 发布与回滚

## 影响面

- **运行时**：新增一个本地 bundle（host 路由 + 设置行）；启动器多一步「有标记才搬」。
- **数据**：只在用户点过「初始化」并且下次启动时，才把 master 会话与两份缓存 rename 进 `backups/`。
- **仓库**：`plugins/dsh-superagent-reset/` 未被根仓库跟踪（与 `dsh-daily` 同）；`scripts/vivy-dsh.mjs`、
  `scripts/lib/component-setup.mjs`、`tests/superagent-reset.test.mjs` 是跟踪文件。
- **配置**：`npm run setup:components` 会往 profile 的 `package.json`（dependencies + bundles）与
  `node_modules` 加一条 link；这是可回滚的（删该行 + 删 link 目录）。

## 回滚

1. 只停用不删：把 profile 的 `package.json` 里 `dsh-superagent-reset` 从 `dsh.profile.bundles` 和
   `dependencies` 去掉，删 `node_modules/dsh-superagent-reset`，重启。设置页那一行随之消失，排队标记仍在
   （想彻底断掉就删 `$DSH_HOME/superagent-reset.json`）。
2. 撤启动器那一步：删 `scripts/vivy-dsh.mjs` 里 `pendingRequest`/`applyReset` 那段和顶部那行 import。
3. 撤已执行的搬移：把 `backups/reset-<时间戳>/` 下的东西搬回原路径（先 `npm run stop`）。
4. 撤注册登记：从 `scripts/lib/component-setup.mjs` 的 `componentPackages()` 去掉那一行。

## 没做的

- CLI 入口（`npm run reset:superagent --dry`）。
- sqlite 档位（连工单/设置一起回出厂）。
- 日常页过滤 relay 回复 —— 根治残留的那条，仍在待办里。
