# 「新建聊天」只折叠左栏显示（会话仍是 superagent 主会话）

- 起因：用户要在「日常」左栏加「新建聊天」。先调研 superagent 源码：主 Session 是单数设计
  （`docs/001-domain.md:80`；id 存 KV、启动 `ensure`、`masterId` 28 处引用），第二条会话不可能
  接上编排与派活。用户 2026-11-15 定稿：**维持主 agent 接入原判，新建只折叠显示上下文**。
- 做法：左栏仍绑 `orchestrator-<stateDir hash>`；头部加「新建聊天」，点一次记下当前最后一条气泡的
  `seq` 作分界，不晚于它的气泡收进「展开更早的 N 条」一行，可展开、可再收；再点一次重新划界。
- 不碰会话：不发消息、不建会话、不删不改历史——`splitThread(bubbles, fold)` 只决定给不给用户看。
  分界按会话 id 存 `localStorage`（`dsh-daily/fold/<sessionId>`），刷新后仍收着；存不进去
  （隐私模式）就只活在这个页面里。
- 文案：有分界且没有新消息时提示「新的一段，从这句话开始。」；无分界仍是「说第一句话吧。」
- 验证：`tests/daily-client.test.mjs` 26/26；jsdom `render3.mjs` ALL PASS；真 Chrome
  `shot-fold.mjs` 三态 + 刷新复现，页面无错误。
- 未验证：真 host 里点一次的手感（会话历史长、折叠行位置、滚动到底）。
