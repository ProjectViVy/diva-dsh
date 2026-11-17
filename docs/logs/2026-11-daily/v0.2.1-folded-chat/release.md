# 发布说明

## 变更

- `plugins/dsh-daily/client.js`（1781 行 → 约 1850 行）：
  - 头部加「新建聊天」（ghost 按钮，位置在「停止」左侧、头像左侧；接不上主会话或没有气泡时禁用）。
  - `foldThread` 的气泡多带一个 `seq`；新增纯函数 `splitThread(thread, fold)` 与
    `FOLD_KEY / foldStore / readFold / writeFold`（`localStorage` 键 `dsh-daily/fold/<sessionId>`）。
  - `ChatPane` 增加 `fold / unfolded` 两个状态：折叠行「展开更早的 N 条 / 收起」、`aria-expanded`、
    有分界时的空态文案「新的一段，从这句话开始。」；气泡渲染抽成一个 `bubble()`，折叠段与新消息共用。
  - CSS 新增 `.dl-fold` / `.dl-fold-btn` 与 `.dl-btn:disabled`。
- `plugins/dsh-daily/README.md`：新增「新建聊天只是折叠显示」一节（为什么不能新建会话、折叠做了什么、
  分界存在哪、刷新与换会话的行为）。
- `tests/daily-client.test.mjs`：23 → 26 项（`splitThread` 分界语义、「新建聊天」收起且不发消息不建会话、
  刷新后仍收着）；`INTERNALS` 里多导出 `splitThread`；新增内存版 `localStorage` 并在 `reset()` 清空。
- `.artifacts/dsh-daily-check/{page-fold.template.html,shot-fold.mjs,fold-0-before.png,fold-1-new-chat.png,fold-2-expanded.png}`：
  真 Chrome 三态取证（本机验证资产，不入库）。

## 没有改的

- `superagent/` 一行没动：多编排会话需要改 `masterId` 相关的 9 处与通知投递语义，用户本轮明确不要。
- 会话、历史、提示词、工具白名单都没动；折叠纯显示层。

## 回滚

`plugins/dsh-daily/` 在根仓库中未被跟踪，没有 git 兜底。撤这一轮就按 `acceptance.md` 末尾列的
六处删除；删掉浏览器里的 `dsh-daily/fold/*` 可清干净分界。

## 注意

- 全仓 `npm test` 1385 项 0 失败；上一轮记录的 `tests/memory-actmem.test.mjs` 时间窗缺陷
  （本地 0:00–3:59 必挂）本轮因运行时段在窗口外而没有出现，没有修。
