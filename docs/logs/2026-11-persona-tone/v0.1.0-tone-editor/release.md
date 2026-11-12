# release — v0.1.0-tone-editor

## 交付物

| 文件 | 变化 |
|---|---|
| `plugins/dsh-vivy-tone/src/zh.mjs` | `runtime/orchestrator` 拆成 `ORCHESTRATOR_HEAD` + `DEFAULT_TONE`，`TRANSLATIONS` 由两者拼回（文本不变） |
| `plugins/dsh-vivy-tone/src/tone.mjs` | 新增：`tone.md` 原子读写、`composeOrchestrator`、`normalizeTone`、`toneTable` |
| `plugins/dsh-vivy-tone/src/install.mjs` | 启动安装按存储的语气拼 `runtime/orchestrator`；新增 `saveTone`（先写提示词，后落语气文件） |
| `plugins/dsh-vivy-tone/src/server.mjs` | 新增：`GET/PUT /dsh-vivy-tone/api/tone`，带 Host/同源/JSON/会话守卫与错误映射 |
| `plugins/dsh-vivy-tone/src/index.mjs` | 挂载语气接口（`webServer` + `connection`），与 `autoInstall` 解耦 |
| `plugins/dsh-vivy-tone/src/client.js` | 新增：语气卡片，注册进 `settings.laputa.item` |
| `plugins/dsh-vivy-tone/package.json` | 加 `dsh.client`（web）与 `exports["./client"]`，版本 0.1.1 |
| `plugins/dsh-vivy-tone/README.md` | 语气块说明、测试命令 |
| `plugins/dsh-laputa/src/client.js` | 设置页标题改「人格与语气」，声明并渲染 `settings.laputa.item`，未启用提示文案同步 |
| `plugins/dsh-laputa/README.md` | 设置页改名与插槽说明 |
| `docs/architecture.md` | §6.1 增加一条：语气块不是第二套人格正文 |
| `tests/vivy-tone.test.mjs` | 新增语气 / saveTone / 路由 17 项 |
| `tests/vivy-tone-client.test.mjs` | 新增语气卡片 5 项 |
| `tests/laputa-panel.test.mjs` | 新增设置页改名与插槽 1 项 |

## 部署

```bash
npm run stop && npm start      # 必须重启：新增 dsh.client 半册与语气路由
# 浏览器硬刷新
```

不需要重跑 `npm run setup`：profile 已注册 `dsh-vivy-tone`，客户端半册随包扫描出现。

## 风险与取舍

- **整段覆盖**：`runtime/orchestrator` 的保存是整段替换（Superagent 的覆盖以 part 为单位）。若曾在它的面板里手改这段的编排器规则，在这里保存会以插件文本覆盖；提示词历史可回退。取舍：不做按标题切分的「只替换尾段」，避免标题被改后切分失败；代价在 acceptance 的「已知限制」里写明。
- **不自动重试 409**：与用户直接点保存的语义一致，冲突交给人重试；无后台静默写入。
- **无新依赖**、无构建步骤：浏览器半册沿用手写 `window.__ModuleLoader__` 形式（与 dsh-laputa 一致）。
- **没有重启验证**：本轮由运行中的实例托管，重启会终止回合；端内验收见 `acceptance.md`。
