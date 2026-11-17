# 验收清单（重启后执行）

重启会断当前面板，本轮没有跑：

```powershell
npm run stop
npm start
```

## 一、普通 DSH 会话应当「一个都拿不到」

1. 开一条普通会话，问「画一张卡试试」。
2. 期望：她**不画**，或明说这条会话没有这个能力。
3. 反证：如果她照样画出来，说明闸门没生效，按下面「排查」走。

## 二、superagent 主会话应当「能画」

1. 在日常面板（主会话）里让她画一张卡（比如「用卡片列一下今天的三件事」）。
2. 期望：回答里出卡；工具行里能看到 `render_ui` / `validate_dsh_ui` 存在。
3. 面板 → 提示词 → master 预览：搜 `## 画界面（本安装独有的额外能力）` 应命中；worker 预览同样应命中。

## 三、html 边界不变

1. 日常左栏仍是唯一能渲自由 HTML 的地方（只绑 `orchestrator-*` 那条会话）。
2. `plugins/dsh-daily/client.js` 的 `FREE_HTML_UI` 仍是 `false`；右栏 Today 仍走 genui 卡。

## 排查

- **普通会话仍有工具**：先确认宿主是重启后的（旧进程里没有新插件）；再看启动日志有没有 `dsh-ui-scope` 的加载行；最后确认 `$DSH_HOME/profiles/superagent-local/package.json` 的 `bundles` 末尾有 `dsh-ui-scope`。
- **master 没教学**：确认 `superagent/lib/index.js` 是 14 条补丁重建的产物（搜 `画界面（本安装独有的额外能力）`）；再确认安装里没有 `runtime/shared` 的提示词 override 把它顶掉。
- **两边都拦**：`plugins/dsh-ui-scope` 的 `SUPERAGENT_SESSION` 正则与会话 id 实际形状不符（例如 master id 不是 `orchestrator-` 前缀）。

## 回滚

1. 从 `patches/superagent-patches.json` 移除 `superagent-genui.patch` → `node scripts/build-bundle.mjs`。
2. 从 profile 的 `package.json` 里删掉 `dsh-ui-scope` 依赖与 `bundles` 条目（或跑 `npm run setup:components` 前先删 `scripts/lib/component-setup.mjs` 里那一行）。
3. 重启宿主。上游 `superagent/` 工作树不需要还原——补丁随时可逆。
