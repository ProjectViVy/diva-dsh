# 验证 · v0.0.1-full-bleed-shell

全部命令在本机 `C:\Users\Administrator\Desktop\diva-dsh` 下执行，Node v24.14.1，DSH 面板运行中（`http://127.0.0.1:3082`，profile `superagent-local`）。

## 1. 生成与语法

| 步骤 | 命令 | 结果 |
| --- | --- | --- |
| 重建生成物 | `node -e "const m=await import('./scripts/lib/surfcore.mjs'); m.ensureSurfcoreAdapter(process.cwd(), undefined, { splitComponents: true })"` | 返回 `bundle` / `qq-mode`，`surfcore-panel.client.js` 被 `updateManagedFile` 重写 |
| 语法 | `node --check .artifacts/surfcore-adapter/bundle/surfcore-panel.client.js` | 通过 |
| 外壳存在 | `Select-String ... -Pattern 'surfcore-panel\{'` | 生成文件第 4469 行是新的 `panelShellCss` |
| 变更面 | `git diff --stat -- scripts/lib/surfcore-panel.mjs` | `16 insertions(+), 1 deletion(-)`（无换行符噪声） |

## 2. 单测

| 文件 | 结果 | 说明 |
| --- | --- | --- |
| `tests/surfcore-integration.test.mjs` | 25 run / 21 pass / 4 fail | 面板相关用例全绿（`the SurfCore panel no longer offers role and desktop pet tabs`、`the panel adapter accepts a CRLF checkout…`、`the split SurfCore client removes the moved panels…`、`adapter writes the split panel only when component cutover is enabled` 等） |
| `tests/surfcore-adapter.test.mjs` + `tests/surfcore-component-adapter.test.mjs` | 34 run / 32 pass / 2 fail | 失败为 `a send whose result never came back…`（adapter egress token）与 `the pinned SurfCore sources carry the ingest anchors…`（子模块报 9 个 modified，属 2026-11-13 工作区上传日志记录的既有状态） |

4 条既有失败的归因（与本次改动面无关，改的是面板外壳 CSS）：

1. `a moved project can rebuild its own SurfCore adapter links` — Windows 上 junction `renameSync` `EPERM`。
2. `Bilibili night planning honors zero limits…` — `scripts/surfcore-loader.mjs` 报 `The pinned SurfCore source no longer matches the local automation safeguards.`，属锚点漂移（DV-UP-001 范围）。
3. `Bilibili selftest reads the project configuration…` — 上一条的连带结果（子进程输出为空）。
4. `Bilibili dependency probe preserves existing files…` — 同上（JSON 输出为空）。

## 3. 活体测量（headless Chrome 157 + CDP）

授权入口取自 `panelLinkFromLogs('.artifacts', 'superagent-local', 'http://127.0.0.1:3082')`（`.artifacts/vivy-dsh-superagent-local-*.log` 里的 `dsh web: <带 token 的 URL>`；token 未写进任何文件或输出）。脚本为一次性脚本 `.artifacts/tmp/shot*.mjs`。

### 1440×900（铺满）

```
app   x=280 y=0   w=1160 h=900   display:flex  （面板区左边界与顶边，铺满）
body  x=280 y=152 w=1160 h=698   overflow-y:auto  bodyScrolls:true
foot  x=280 y=850 w=1160 h=50    position:static
documentScrolls:false           （面板外没有第二条滚动条）
```

### 1024×768

```
app   x=280 y=0 w=744 h=768
body  x=280 y=152 w=744 h=566
foot  x=280 y=718 w=744 h=50
documentScrolls:false
```

### 页签一致性（1440×900，逐页点击）

| 页签 | 外框 | 内容区滚动范围 | 说明 |
| --- | --- | --- | --- |
| 概览 | 1160×900 | 207px | 头/标签/页脚不动 |
| QQ | 1160×900 | 1266px | 同上 |
| Token 额度 | 1160×900 | 514px | 同上 |

### 前后对照（同一页面注入旧外壳样式再移除）

| 指标 | 旧外壳 | 新外壳（铺满） |
| --- | --- | --- |
| `.surfcore-panel` 是否滚动 | `true` | `false` |
| `.qbw-body` 是否滚动 | `true` | `true`（唯一滚动区） |
| `.qbw-foot` `position` | `sticky` | `static` |
| 面板占用 | 1061×854（`x=328`，28px 留白 + 1200 上限） | 1160×900（`x=280`，铺满面板区） |

中间版本（已废弃）：居中内置框版为 1114×872（`x=303`，`max-width:1120px` + 14px 留白），用户要求改成铺满后删除。

截图（本机 `.artifacts/surfcore-panel/`，不入库）：

- `before.png`（旧外壳：面板与内容双滚动、页脚 sticky）
- `after.png`（现在的铺满外壳）
- `centered-frame.png`（已废弃的居中内置框版，仅留作对照）
- `narrow-1024.png`（1024 宽）
- `qq-tab.png`（QQ 页签，表单拉满整宽）

## 4. 没跑的

- 插件内 `test:audit`：上游子模块当前报 9 个 modified（既有状态），跑它只会复述既有红灯。
- 深色主题与大字号下的观感：没有对应主题开关的自动化路径，只验证了当前浅色主题。
- 非 split（`settings.section`）模式：本 profile 走 split，设置页 section 不经过 `.surfcore-panel`，本次未改也未验。
