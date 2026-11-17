# v0.4.0 左栏「自由 UI」：她写的 html 围栏渲成沙箱 iframe

- 状态：已交付（浏览器半边，硬刷新即生效，**不用重启**）
- 范围：`plugins/dsh-daily/client.js`、`tests/daily-client.test.mjs`
- 验证：单测 29/29；真 Chrome 沙箱探针 **SANDBOX OK**；像素截图 `ui-frame.png` 无页面错误
- 未验证：真宿主 3082 里的手感（本轮没重启）；模型侧规则未做（见「还缺什么」）
- 回滚：删 `splitUiFences` / `uiDocument` / `UI_*` 常量 / `uiFrame`，`bubble()` 回到按行成段，删三条 `.dl-ui*` 与 `.dl-msg--ui` 的 CSS

## 为什么是这条路

用户 2026-11-15 15:4x 在两个方案里选了「允许 agent 自由创建 UI」，参考 OpenClaw / hanako。对照过三条路：

| | 白名单 spec（右栏现用 / genui） | **自由 HTML（本版）** | agent 写插件 |
| --- | --- | --- | --- |
| 表达力 | 40–60 种节点 | 任意 HTML/CSS/JS | 任意 |
| 一致性 | 高 | 靠她自觉 | 中 |
| 每次成本 | 几百 token | 几百行 | 一次性 |
| 失败形态 | 坏节点只丢自己 | 白屏 | 面板不出现 |
| 生效方式 | 刷新 | 刷新 | 构建 + 重启 |

选自由 HTML 的代价我认了：**一致性不再由框架保证**，由她每次自己保证。换来的是「想做就能做」。

## 安全边界（三层，缺一层都不发）

1. `sandbox="allow-scripts"`，**没有** `allow-same-origin` → 独立 opaque 源：碰不到父页面 DOM / localStorage / cookie；也没有 top-navigation / popups / forms。
2. srcdoc 里再压一层 CSP：`connect-src 'none'`（fetch / XHR / WebSocket 全断）、`img-src data: blob:`、`form-action 'none'`、`base-uri 'none'`。
3. 父页面只认 `event.source === 那一帧的 contentWindow` 的高度回报，别的消息一律不理。

**真 Chrome 实测**（`frame-probe.mjs`，用 client.js 里真正的 `uiDocument()`）：

| 检查 | 结果 |
| --- | --- |
| 框内脚本执行 | 跑了（她可以写交互） |
| 读父页面 `document.title` | 被挡住 |
| 写父页面 `localStorage` | 被挡住 |
| 读自己的 `document.cookie` | 抛 SecurityError（沙箱文档没有 cookie） |
| `fetch('http://127.0.0.1:3082/')` | 被 CSP 挡住 |
| 高度回报 | 3 次，值 131px（内容高度，不是视口） |

## 实现要点

- `splitUiFences(text)`：把一条气泡切成「文字段 / 界面段」。**未闭合的围栏当文字**——宁可显示一段源码，也不要把后面的正文一起吞掉。
- 只认 `html` / `htm` 两种围栏名。`dsh-ui` 围栏**不**走这里（那是右栏 spec 的语言，左栏不负责）。
- `uiFrame()`：不用 React state，直接写节点 `style.height`——界面高度是浏览器反馈，不是组件状态，省一次重渲染。
- 高度：夹在 80–620；量 `body.getBoundingClientRect().height`。起初量的是 `documentElement.scrollHeight`，短页面也会报 200（被视口撑满），框里会留一片空白，已改。
- 带界面的气泡放宽到整栏：`.dl-msg--ui .dl-bubble{flex:1 1 auto}`。只改 `max-width:100%` 没用——flex 项的宽度是内容撑的，不铺满，实测 379px。

## 还缺什么（重要，别当已完成）

**渲染通了，但她还不知道可以这么写。** master 的系统提示词里没有「你可以用 html 围栏画界面」这条规则，所以现在只能由用户在聊天里明说才触发。两条补法：

1. **零代码**：在左栏里跟她说一次「你可以在回复里用 ```html 围栏直接画界面」——ActMem 会记住，下一轮起她就有这个上下文。粗糙但立刻可验。
2. **正经补**：给 master 加一段 scoped 说明（要动 `patches/superagent-*.patch`，跟 DV-UI-010 一起重启验收）。这条要用户点头，因为它是「她又多一个输出通道」的取向问题。

另一件没做的：**没有降级卡片**。她写坏了就是一个坏页面，消息本体还在、字一个不丢，但没有「看源码」的入口。等真用过一次再决定要不要加。
