# 交付与发布

## 版本

- `patches/`：新增 `superagent-dream.patch`，清单从 11 个变 12 个（`dsh-evolution` 自身版本不变，本轮未改插件包版本）。
- 构建产物：`superagent` bundle 已用 `npm run build:bundle` 重建（含新补丁），等待重启加载。

## 生效步骤（需要用户执行）

```powershell
cd C:\Users\Administrator\Desktop\diva-dsh
npm run stop
npm start
```

浏览器硬刷新后：

1. 「进化 → 概览」正常；
2. 触发一次手动 refine（「进化 → AutoDream」里的手动请求），观察新 Ticket；
3. 打开该 Ticket 的 worker 会话，确认工具面板只有 `skill` 与 `dream_refine`。

`npm run setup` 不需要重跑（补丁与插件源码不涉及依赖变化）；如需重跑，必须先 `npm run stop`。

## 回滚

1. 从 `patches/superagent-patches.json` 删掉 `superagent-dream.patch`；
2. `tests/source-runtime.test.mjs` 的清单断言改回 11；
3. `npm run build:bundle`；
4. 重启。

Dream 会话会退回普通 worker 工具集（旧行为），`dream_refine` 工具仍在但没人调用它。

## 提交建议

一个提交即可：`feat(dream): run refinement in a shell-less executor mode`。涉及根仓库
（`patches/`、`docs/`、`skills/`、`tests/`）与 `plugins/dsh-evolution` 子模块两处指针；未提交，等用户指示。
