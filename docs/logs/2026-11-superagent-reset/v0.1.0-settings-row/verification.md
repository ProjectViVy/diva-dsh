# 验证

## 单元与集成测试

```
node --test tests/superagent-reset.test.mjs
ℹ tests 11
ℹ pass 11
ℹ fail 0
```

覆盖：`masterSessions` 只认 `state-superagent-local` 工作区里的 `orchestrator-*`；目标清单三条；
排队标记写/读/取消/坏标记；`applyReset` 成功（3 项搬进 `backups/reset-20261115050000/`、标记清空、
普通会话不受影响、结果落盘）；`applyReset` 失败（同名文件挡路 → `ok:false`、保留排队、原件不动）；
`describe` 只回相对路径；路由的 `GET /status`、非本机 403、`POST /queue` 无 `confirm` 400、
重复提交幂等、`POST /cancel`、跨站 403、无 JSON 415；客户端注册形状（`settings.general.item`、
id `superagent-reset`、`inject: ['slots']`、样式只挂一次）。

## 全仓

```
npm test
ℹ tests 1397
ℹ pass 1391
ℹ fail 0
ℹ skipped 6
```

（上一轮 1385；本轮多了 12：11 例新插件 + 1 例过期分界。）

## 语法

```
node --check plugins/dsh-superagent-reset/client.js
node --check plugins/dsh-superagent-reset/index.js
node --check scripts/vivy-dsh.mjs
```

三条都 exit 0。

## 没验证的

- **真 host 里的注册与渲染**：要注册进 profile 得停服务跑 `npm run setup:components`，本轮没有停（我在 host 里说话，停它就是停我自己）。所以「设置 → 通用」里眼下还看不到这一行。
- 那一行在设置页的实际排版（标题/说明/按钮的间距、深色主题下的对比）——用的是 `--dsw-*` 变量加兜底色，没在真主题下看过。
- `connection.requestRejection` 在自建 prefix 路由上是否照旧可用：写法抄自 dsh-laputa 面板，但那条路由是 GET 为主，本插件多两个 POST。
- 启动器消费标记那条路径没在真机上跑过一次（要有标记 + 重启）。
