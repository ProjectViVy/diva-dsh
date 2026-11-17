# 验收（要你动手）

## 1. 注册、重启

在外部终端：

```
npm run stop
npm run setup:components
npm start
```

`setup:components` 只补缺的那一个：`dsh-superagent-reset` 的 link 与 bundle 行。若它报还有别的缺项，
说明之前那批插件也没注册完，一起补上即可。中途它可能打印 surfcore / see-now 的检查信息，属正常。

## 2. 看这一行

硬刷新 `http://127.0.0.1:3082` → 右上角更多 → 设置 → 通用，应当出现：

> **初始化 Superagent 会话**
> 把 master 会话的历史连同两份投影缓存搬进 backups/。工单、设置、提示词修订、记忆卡、人格都不动…
> 会搬走 3 项：master 会话日志、会话投影缓存、上下文洞察缓存 · 240 KiB 左右
> 　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　　[初始化]

## 3. 走一遍

1. 点「初始化」→ 变成「确认初始化」+「算了」。
2. 点「算了」→ 回到「初始化」（这一步只验能反悔）。
3. 再点「初始化」→「确认初始化」→ 右上方变「已排队」，出现「取消」。
4. 这时刷新页面，仍是「已排队」（标记在磁盘上，不是内存里）。
5. 停服务再起：

```
npm run stop
npm start
```

预期在 `npm start` 输出里看到 `Superagent reset: moved 3 item(s) to backups/reset-<时间戳>`。

6. 硬刷新 → 日常页左栏应当**一条气泡都没有**；发一句「在吗」立刻出现，不被折叠行收着。

## 4. 没变的东西

`orchestrator.sqlite`（工单、设置、提示词修订）、ActMem 记忆卡、人格、skills、右栏四页都没动。
侧边栏里那条 `dsh-superagent orchestrator` 还在，只是空的。

## 5. 还原

把 `$DSH_HOME/backups/reset-<时间戳>/` 下的三样按原路径搬回（搬之前先 `npm run stop`）。

## 6. 出问题怎么报

- 设置页没这一行 → 先看控制台有没有 `dsh-superagent-reset` 的加载错误，再看 `npm run setup:components` 的输出。
- 点「初始化」报 403 → 说明 `connection.requestRejection` 或同源校验没过，把浏览器控制台的网络条目状态码告诉我。
- `npm start` 没有 `Superagent reset:` 那行而设置页显示「已排队」 → 说明标记在、但启动器没走到那一步，贴启动日志。
