# 世界网关 · v0.1.0-slots · 验收

> **已被 [`../v0.1.1-render-fix/acceptance.md`](../v0.1.1-render-fix/acceptance.md) 取代。**
> 本轮之前分区是整块空白的（客户端半把 React 保留 prop `ref` 传给了组件，渲染即抛错），
> 按本文件走第 4 步会一直"不符"。保留原文只为记录当时的预期。

> 前置：`pwsh` 恢复可用（先按 DV-OPS-001 确认 `TMP` 不在工作区内），然后按顺序执行。
> 本文件每一步都写预期结果；任何一步不符就停，不要跳到下一步。

## 1. 先停机，再接线

```bash
npm run stop
npm run setup:components
```

**预期**：`setup:components` 不会报 `Stop the local panel with "npm run stop"`（它要求面板已停）；
输出里出现组件注册；`.artifacts/dsh-home/profiles/superagent-local/package.json` 的 `dependencies` 多出
`dsh-capability-hub`，`dsh.profile.bundles` 数组里也有它（由 `plugin --profile … add link:…` 一并写入）。

## 2. 单测

```bash
node --test plugins/capability-hub/tests
```

**预期**：7 个用例全过（默认值 / 未知能力 / 未知字段与非 https / 派生与固定凭据名 / 原子写 / 损坏恢复 / resolve 只返回启用项）。

## 3. 启动并拿到端口

```bash
npm start
npm run status
```

**预期**：`status` 输出实际端口（不假设 3080/3082）。浏览器打开该地址后**硬刷新**（Ctrl+Shift+R）。

## 4. 分区出现

进入「设置」，左侧或列表里出现**世界网关**。

**预期**：标题、一行说明（只补 DSH 没有的能力；chat 去「设置 → 模型」）、右上「已启用 0 / 5」、
五张能力卡（语音识别 / 语音合成 / 决策模型 / 向量化 / 全模态理解）、一张虚线占位卡「实时语音（未接入）」、
底部灰字说明。

**不符时**：先看 profile `bundles` 是否含 `dsh-capability-hub`；再看该分区是否被别的 `order` 挤到别处；再看浏览器控制台有无 `__ModuleLoader__` 报错。

## 5. 保存与持久化

- 打开「语音识别」卡，勾「启用」，把模型改成 `qwen-audio-3.1-asr-flash-test`，点保存。
- **预期**：出现「语音识别已保存」；卡片状态点变绿；`已启用` 计数变 1。
- 硬刷新页面 → 改动仍在。
- `npm run stop && npm start` → 再看，改动仍在。
- 检查 `<DSH_HOME>/capability-hub/registry.json`：`slots.asr.enabled === true`，且全文**没有**任何 `sk-` 开头的字符串。

## 6. 凭据共用同一份存储

- 在「语音识别」卡里填入一个假 key（如 `sk-test-not-real`）→ 点「保存凭据」。
- **预期**：状态行变「凭据已配置（本地凭据文件）」。
- 打开「设置 → 模型」，看与 `DASHSCOPE_API_KEY` 同名的接入点：应显示已配置（证明两边共用一份，不是各存一份）。
- 回到世界网关 → 点「清除」→ 两处同时回到未配置。

> 若第 6 步在「设置 → 模型」里找不到对应项，是因为还没建同名 provider——这不影响「同一份存储」的结论，
> 可用 `describe` 的返回（`configured/source`）确认写入生效，并在日志里记下这一点。

## 7. resolve 面

浏览器打开 `/dsh-capability-hub/api/resolve?capability=asr`。

**预期**：`{"ok":true,"bindings":[{"capability":"asr","kind":"dashscope","baseURL":"...","model":"...","authRef":"DASHSCOPE_API_KEY"}]}`。
把该卡关掉启用再请求 → `{"ok":false,"error":"not_enabled","bindings":[]}`。
请求 `/dsh-capability-hub/api/invoke` → 404（本轮明确没有调用面）。

## 8. 占位卡不可交互

- 点「实时语音（未接入）」区域任意位置。

**预期**：没有任何输入框、按钮或网络请求（Network 面板无新请求）。
