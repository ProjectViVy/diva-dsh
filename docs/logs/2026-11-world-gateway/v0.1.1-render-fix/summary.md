# v0.1.1-render-fix 世界网关分区空白：根因与修复

- 状态：done（**待重启后看端内**）
- 范围：`plugins/capability-hub/src/client.js`、`src/catalog.mjs`（新）、`src/http.mjs`、`src/index.mjs`、`tests/catalog.test.mjs`（新）、`tests/client-render.test.mjs`（新）、`tests/http-catalog.test.mjs`（新）
- 现象：设置里能看到「世界网关」导航项，点进去整块空白；用户问"为什么不显示模型之类的东西"
- 验证：见 `verification.md`（jsdom 复现 + 修复后 5 张卡 + 21 项测试 + 活体 HTTP 端到端）
- 未验证：`/api/catalog` 的活体响应（新路由要重启才挂上）；浏览器点击流
- 回滚：`git checkout -- plugins/capability-hub` 不适用（未提交），见 `release.md`

## 根因

`client.js` 把一个 prop 命名为 **`ref`**：

```js
function CredentialRow({ capability, ref, cred, ... })          // 197
h(CredentialRow, { capability, ref: value.authRef ?? '', ... }) // 278
```

`ref` 是 React 的保留 prop。把**字符串**塞给它并挂到函数组件上，React 18 直接抛：

```
Function components cannot have string refs
```

于是 `WorldGatewaySection` 整个子树渲染失败，被 `SlotErrorBoundary`（`scoped-slots.tsx:419`）替换成 `<div data-slot-error="settings.section"/>` —— 一个空 div。导航项还在，因为它由注册时的 `label()` 提供，不依赖渲染。

## 为什么前一轮没发现

- 上一轮**没有执行任何命令**（`pwsh` 被 Windows ACL temp root 卡死），单测只覆盖了 host 半的 registry，客户端半从没被渲染过。
- 我这次第一版复现用的是 SSR（`react-dom/server`），**SSR 忽略 `ref`、不报这个错**，所以假阴性；换成 `jsdom` + `react-dom/client` 才复现。

## 改了什么

1. **修崩溃**：四处 `ref` → `authRef`（解构、placeholder 插值、disabled 判断、调用处），并在组件上方写明「`ref`/`key` 是 React 保留 prop，不准当参数名」。
2. **补真实模型候选**：新增 `src/catalog.mjs`，只读宿主 `ctx.get('llm')` 注册表——`decision` 拿同名 provider 的全部模型，`omni` 只留声明支持 `audio`/`video` 输入的。`asr`/`tts`/`embedding` 宿主没有注册表，**如实返回空并附原因**，不编列表。
3. **新路由** `GET /dsh-capability-hub/api/catalog`，与既有路由同一套本机访问 + 会话校验。
4. **面板**：进入分区时并行拉 `/state` 与 `/catalog`（目录失败不影响主流程）；「模型」保持手填输入框，候选存在时多一个「从 N 个候选填入…」的取词器；没有候选时显示一行说明。

## 关键取舍

候选目录**只在有真实来源时才出现**。给音频类能力硬造一份模型清单（`qwen-audio-3.1-asr-flash` 这些）看起来更"满"，但那份清单会随供应商漂移，而我们没有任何机制校验它——宁可空着并写明原因。真要接音频模型，正确的下一步是让语音插件注册到 `speechToText`，而不是在这里抄字符串。
