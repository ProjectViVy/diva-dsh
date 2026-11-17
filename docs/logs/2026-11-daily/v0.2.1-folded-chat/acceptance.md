# 验收清单（硬刷新后执行，不用重启）

`client.js` 是浏览器半边，改完刷新页面就生效（`npm start` 起的 host 不用动）。

## 左栏

1. 头部「日常 / 会话标题 / 在」右侧出现「新建聊天」；接不上主会话时它是灰的。
2. 点一次：上面的气泡全部收进一行「展开更早的 N 条」，下面空出来，提示「新的一段，从这句话开始。」。
3. 点那一行：旧气泡回来，行文案变「收起」；再点收起。
4. 收起状态下直接说话：新气泡出现在折叠行下面，旧的一段仍然收着。
5. 硬刷新页面：仍收着（分界在 `localStorage` 的 `dsh-daily/fold/<sessionId>`）。
6. 收起后再点一次「新建聊天」：分界挪到当前最后一条，之前那段继续收着。
7. 全程没有新建会话：DSH 侧栏的会话列表条数不变，master 那条的历史一条不少（打开 master 会话能看到）。

## 回滚

- 分界数据：清掉浏览器的 `dsh-daily/fold/<sessionId>` 这一项，或点「展开」即可看到全部历史。
- 代码：删掉 `client.js` 里这六处（`CHAT` 的五条文案、`foldThread` 里的 `seq` 字段、
  `splitThread` + `FOLD_KEY/foldStore/readFold/writeFold` 块、`ChatPane` 的 `fold/unfolded`
  状态与 `newChat`、折叠行与空态文案分支、CSS 的 `.dl-fold*` 与 `.dl-btn:disabled` 三行），
  再把 `tests/daily-client.test.mjs` 的新增 3 项与 `INTERNALS` 里的 `splitThread` 去掉。
  `plugins/dsh-daily/` 在根仓库中未被跟踪，没有 git 兜底。
