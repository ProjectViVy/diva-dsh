# 验收（要你动手）

## 1. 停、搬、起

在外部终端（不是这个页面里）依次：

```
npm run stop
node .artifacts/dsh-home/reset-master-session.mjs
npm start
```

预期：脚本打印三行「搬走 …→ .artifacts\dsh-home\backups\20261115-master-session\…」，最后一句「搬完了，备份在 …。现在 npm start」。

若脚本报 `端口 3082 还在监听：host 没停`，说明 stop 没杀掉进程，先查有没有残留 node 进程。

## 2. 起来之后看这四件事

1. 硬刷新 `http://127.0.0.1:3082`，打开「日常」：左栏应该**一条气泡都没有**，头部按钮「新建聊天」是灰的（会话里没有消息）。
2. 发一句「在吗」：应该**立刻**出现在左栏，不被任何折叠行收着。若被收着 → 说明过期分界没作废，把浏览器 `localStorage` 里 `dsh-daily/fold/orchestrator-4d1802aebad9163249a492fde7acb59a` 删掉再刷新，并回报我。
3. DSH 侧边栏里那条 `dsh-superagent orchestrator` 应该还在（id 不变），但点进去是空的。
4. 「上下文洞察」面板首屏会重新统计，数字和以前不一样属正常。

## 3. 没有变的东西

- `orchestrator.sqlite`（工单、提示词修订、设置、模型）：没动。
- ActMem 记忆卡、MemPalace 归档、人格文件、skills：没动。
- 日常页右栏四页：没动。

## 4. 还原

把 `.artifacts\dsh-home\backups\20261115-master-session\` 下的三样按原路径搬回，再 `npm start`。还原前同样要先 `npm run stop`。
