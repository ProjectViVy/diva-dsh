# v0.7.1 日常左栏渲染 dsh-ui 围栏

## 一句话

日常页左栏的 assistant 气泡现在会把正文里的 `dsh-ui` 围栏画成 genui spec 卡片（与宿主会话里
同一个 genui 渲染器同一套 spec），文字照常显示；画不出来就退回原文，一个字都不吞。
纯浏览器半边，硬刷新即生效。

## 为什么要单做一条路

genui（`third-party/genui`，v0.16.0 / `9220925`）的浏览器半边只看 DSH 聊天通道自己渲染的
DOM（`.genui-dom-fence`，DOM 观察者挂自己的 React root），**看不见** dsh-daily 这棵
`client.js` 里手搭的 React 树；它唯一的宿主嵌入出口 `./embed` 指向未编译的
`src/client/embed.ts`（要打包器 + React 18 + CSS Modules），而 dsh-daily 没有构建步骤。
跨包直接 import genui 内部实现（`lib/client.js` 里的非导出符号）会把两个插件的版本绑死，
上游一改就碎。

所以复用 dsh-daily 已有的 vendored 渲染器（右栏 Today / 任务 / 悄悄话三页同一份），按上游
`spec.ts` / `render-node.tsx` 补了左栏常用的七个节点。代价是「左栏能画的节点是右栏的子集」，
换来零新增依赖、零构建、一份渲染器两个入口、回归测试一套复用。

## 改了什么

- `plugins/dsh-daily/client.js`
  - `SPEC_FENCE` + `splitDshUiFences()` + `parseSpecFence()`：与 html 围栏同一套 code-fence
    分段语义；语言标记只认 `dsh-ui`（大小写不敏感、吸收标签尾部手滑标点），收尾须是单独一行的
    ``````；没闭合的整段按文字处理。
  - `bubble()`：先切 dsh-ui 段（→ `.dl-spec` + `renderSpec`），文字段再切 html 段；坏 JSON /
    清洗后无节点 → 降级成原文当文字摆出来。
  - `renderSpec` 在有 `title` 时多渲染一个 `.dl-g-root-title`（右栏 spec 没有 title，行为不变）。
  - 七个新节点：`table`（columns/rows/types，num·delta 右对齐）、`chart`（bars/line/donut，
    只画 `data` 单序列）、`steps`、`timeline`、`code`、`json`、`link`（只放行 http(s)/mailto）。
  - `GENUI_LIMITS` 新增 `maxTableColumns 12` / `maxTableRows 50` / `maxChartPoints 60` /
    `maxCode 4000`。
  - CSS：`.dl-spec`、`.dl-g-root-title`、`.dl-g-table*`、`.dl-g-chart*`、`.dl-g-step*`、
    `.dl-g-timeline/.dl-g-tl*`、`.dl-g-code`、`.dl-g-link`，只用 `var(--dl-*)`，无写死颜色。
  - 1815 → 2167 行；CRLF 保持。
- `plugins/dsh-daily/VENDORED-genui.md`：新增「左栏」一节，写清分段规则、覆盖/不支持节点、
  `[genui-action]` 不接的原因、限额与回归。
- `tests/daily-client.test.mjs`：`INTERNALS` 暴露两个新函数；新增 7 条（分段、单卡、多段、
  坏 JSON 降级、未闭合、七个新节点、单组件根包装）。39 → 46 项。

## 不支持（清洗阶段整节点丢，兄弟节点照常）

表单控件（input/select/checkbox/radio/slider/textarea/editor/date-picker/submit/quiz/choices）、
tabs/accordion/carousel/copy/popover、echart/plot/mermaid/svg/diagram/scene3d、audio/video、
image-group/compare、diff、file-tree、breadcrumb、blocks、arrow、icon、entity-card。
`button`/`switch`/`segmented-control` 会画出来但**没有动作**——`[genui-action]` 回路只在宿主
聊天通道里存在，左栏这棵树不接，点了不发消息也不改会话。

## 验证

`node --test tests/daily-client.test.mjs` → **46 项 / 42 通过 / 0 失败 / 4 跳过**；
`npm test` → **1427 项 / 1417 通过 / 0 失败 / 10 跳过，exit 0**（v0.7.0 基线 1420/1410/0/10）。
真 Chrome（隔离实例 3083：真宿主 + 真模型 + 真 dsh-daily bundle）在**日常左栏**渲出带 bars 图 +
表格的卡片，同一批消息切到普通会话视图由 genui 自己渲染，两张截图并排可对。

## 未验证

- 3082 面板里的实测（不改宿主、不拿面板 token）；代码是纯客户端新增、无开关切换，硬刷新后
  应直接生效——若面板仍显示围栏原文，再按 release.md 的重启步骤处理。
- genui 上游若新增节点，左栏仍会丢（见 VENDORED-genui.md 的同步步骤，不会自动跟）。
- `[genui-action]` 交互（按钮点击回传消息）在左栏不可用，这是设计边界不是 bug。
