# 卡片契约决策 · v0.2.0-card-contract · 验证记录

## V1 克隆

- `git clone --depth 1 https://github.com/omdsh-dev/dsh-genui .workspace/genui`（沙箱默认拒绝启动 `git.exe`，经一次提权后成功）。
- HEAD `33576039f27a4f62eb60d4307902ee65252eded6`，`package.json` 版本 `0.16.0`，MIT。
- 同时核对 npm 包名 `@changfenhuang/dsh-genui` 与 `cordis.patch.yml` 的 `insert: genui` 行。

## V2 genui 源码取证（`.workspace/genui`）

| 主题 | 位置 |
| --- | --- |
| spec 白名单与 v1 说明 | `src/client/spec.ts:1–10`；节点 union `:52–115`（约 59 种） |
| 限制值 | `src/client/genui-runtime/limits.ts`（maxDepth 8 / maxNodes 200 / maxString 2000 / maxTableRows 50 / maxChartPoints 60） |
| `render_ui` 参数刻意松 | `src/plugin/tool.ts:47–78`；注释解释「schema 只挡真正不可修复的形状」 |
| 系统提示精简契约 | `src/plugin/index.ts:87–119` |
| 动作回流 | `src/client/index.tsx:54–83`、`:103–110`；防抖策略 `src/client/GenuiBlock.tsx:28–71` |
| 模板中心 | `src/client/templates.ts:21–51`（instruction + 合法 demo spec） |
| 资助/导出 | `src/client/artifact/*`（`.html` / `.genui.json`、`analyzeGenuiPortability`） |
| 嵌入导出 | `src/client/embed.ts`（`GenuiBlock`、`GenuiActionContext`、`processGenuiSpec`） |
| 两条渲染通道 | `src/client/toolview.tsx`（工具行）+ `src/client/dom-fence.tsx:77`（DOM 观察选择器） |
| 主题 | 全仓 188 处 `--dsw-*`，145 个文件 |
| 新增节点的成本 | 仓库 `AGENTS.md`「新增节点：一份清单」（8 处）+ 系统提示 3400 字符硬预算 |

## V3 宿主可行性核对（`deepseek-harness/`，0.2.1-rc.5）

- `data-chat-anchor-key` / `data-chat-flow-key` 存在：`packages/client/ui-chat/src/client/chat/ChatNodeSeat.tsx:150–151`；且 `ui-tool/README.md:72` 称其为 DOM 约定。
- `data-code-block-content` 与 `.md-code-block` 存在：`packages/client/ui-primitives/src/markdown/CodeBlock.tsx:188,209`。
- `fence-registry` **不存在**：全仓 grep 零命中 → genui 的「registry 通道」在本宿主用不上。

## V4 未做

- 未安装 genui、未改 profile、未构建、未跑测试、未开 GUI。
- `GenuiBlock` 跨包编译（TSX + CSS Modules）与 `--dsw-*` 重绑后的观感均未实测。
