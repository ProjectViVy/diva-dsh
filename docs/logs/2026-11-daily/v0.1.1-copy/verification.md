# 「日常」· v0.1.1-copy · 验证

## 跑了什么

| 命令 | 结果 |
| --- | --- |
| `node --check plugins/dsh-daily/client.js` | 通过 |
| `node --test tests/daily-client.test.mjs` | **12 / 12 通过** |
| `node .artifacts/dsh-daily-check/render2.mjs` | **ALL PASS**（四页逐行比对 + 8 项交互） |
| `node .artifacts/dsh-daily-check/shot-page.mjs` | 真 Chrome 1440×900 四页截图，**0 页面错误**，`overflow: false` |

## 逐行比对怎么做的

先把参考原型（`index.html` + `assets/app.css` + `assets/app.js`）在无头 Chrome 里渲染，
按页导出可见文字（`.artifacts/dsh-daily-check/ref/ref-text.txt`、`tab-1-任务.txt`、
`tab-2-记忆.txt`、`tab-3-能力.txt`）；再用 jsdom + 真 React 渲染本插件，把本页文字里
**是否包含参考的每一行**逐条断言。规则是「包含」而不是「相等」：CSS 会把 `→` 之外的
空白折成一种，包含比对对排版差异不敏感，但少一句话就会红。

结果：Today 93 行、任务、记忆 119 行、能力 —— 四页全部命中。两处不是文案而是属性
（`问问 Today…` 是 `placeholder`）的单独断言。

第一轮红的两行，恰好是照搬时漏掉的两处真内容：

```
✖ Today 视图 — 缺「→」
✖ 记忆 视图 — 缺「最近 7 天」
```

`→` 被换成了 chevron 图标（原型里是文字箭头）；`最近 7 天` 是我漏写的周条标题。
两处都改回原型写法后转绿。

## 离线像素

`shot-page.mjs` 把 `client.js` 装进一张自带 DIVA 变量的离线页（真 React UMD + 真 CSS），
四页各截一张：`.artifacts/dsh-daily-check/new-{today,tasks,memory,skills}.png`。
量到的两栏是 818 / 576 px（原型 808 / 562），页面高度正好 900 不外溢，
`.dl-card` 4 张、`.dl-panel` 3 张，与结构一致。

同时抓到一个只在真 React 下才炸的错（假 React 的测试看不出来）：
图标第一版写成 `{type:'svg', props:{…}}` 字面量，真 React 报
`Element type is invalid`。改成 `React.createElement` 后归零。

## 交互（render2.mjs）

| 检查 | 结果 |
| --- | --- |
| 勾选第一项 → `data-done="true"` 且出现对勾，条目数不变 | 通过 |
| 任务页筛选「进行中」→ 4 条变 1 条；「已完成」→ 只剩「汇总设计评审反馈」 | 通过 |
| 能力页「声音」开关 `aria-checked` 翻转 | 通过 |
| 输入框可输入 | 通过 |

## 没验证

- **真 GUI 的像素**：面板 URL 需要 `?token=`，打印在 `dsh web` 的终端里；本轮仍拿不到。
  离线页与shell 的差别只在字体与外壳纸纹，布局与配色已经能看见。
- **左栏位置**：本轮的 client 侧没变（`order: -5`），但「不被折进 VIVY心核」依赖
  `sidebar-core.js` 的 `KEEP` 白名单，而它是宿主启动时注入 index.html 的 —— 必须
  `npm run restart` 才能印证。**未验证**，见 `acceptance.md` 第 1 步。
- 1440 以下的窄窗：CSS 有 1080/680 两个断点，但没量过。
