# 卡片契约决策：抄 hanako 的分层，借 genui 的 spec，页面渲染先自研

- 日期：2026-11-14 20:05（Asia/Shanghai）
- 性质：只读研究 + 决策建议。**未改任何代码/配置/依赖**；只在 `.workspace/genui` 放了一份克隆，供阅读。
- 触发：用户 19:32「先去看一下 hanako 和 openmuse、opendot 的方案再做决定，可以把 genui 克隆到临时目录研究一下」。
- 关联：`agent-ui-card-spec.md`（卡片形式）、`daily-page-integration.md`（页面接入）、`TODOLIST.md` DV-DOC-016。

## 0. 结论

**卡片的「内容语言」借 genui 的 `dsh-ui` spec（不另造词汇表）；卡片的「分层契约」抄 openhanako（壳固定、内容自由、词汇表以文档交付、安全边界独立、资产挂内容）；页面的「渲染」第一期自研薄渲染器（只吃 spec 的内容子集），第二阶段再评估直接嵌 `GenuiBlock`。**

一句话：**spec 统一，渲染分期，资产放自己手里。**

## 1. 四份实现的契约对比（全部带证据）

| | openhanako | openmuse | OpenDots | dsh-genui |
| --- | --- | --- | --- | --- |
| 谁写内容 | **模型写整张卡**：`show_card{title, code}`（`lib/tools/show-card-tool.ts:33–47`），HTML 即内容；另有服务端模板+填空线 | 混合：模型写选项（`apps/server/src/jev/tools.ts:10–19`），服务端写数据与标题（`service.ts:872–883`），前端写死配色（`agent-ui.tsx:750–761`） | 混合：模型写 Markdown 正文（`shared/page-review.ts:2–8`），前端定骨架（`PageReviewCard.tsx:149–163`） | **模型写 JSON 组件树**（`spec.ts:52–115`，约 59 种节点），宿主渲（`blocks/render-node.tsx`） |
| 词汇表怎么交付 | **文档**：`hana_card_guide` 400 行手册当工具返回值（`card-guide-tool.ts:16–407`）+ 模板（`:300–399`）+ 兜底规则（`:401–406`） | 硬编码严格 zod（`packages/domain/src/jev.ts:23–68`，`.strict()`） | 硬编码组件（`ComputerToolCard.tsx:20–33` 的 label 表） | **四层**：系统提示精简契约（`plugin/index.ts:93–119`，约 3.4k 字符预算）+ `SKILL.md` 62KB 全量映射 + 模板中心（`templates.ts`）+ `validate_dsh_ui` 工具（`plugin/tool.ts`） |
| schema 外的东西 | **HTML 逃生舱**（`InteractiveCard.tsx:146–153`，CSP 见 `cards.ts:22–39`）——但无回流 | 降级为纯文本（`assistant-response.tsx:20–24`） | 通配返 `null`，直接不渲染（`Chat.tsx:230–246`） | 白名单内不存在「外」；字段写错 → **只丢该节点，其余照渲**（`plugin/index.ts:119`） |
| 动作回流 | typed 卡走 REST 阻塞确认（`SettingsConfirmCard.tsx:95–113`）；HTML 卡**没有**回流通道 | **编码成用户消息**开新一轮（`jev-actions.ts:102–110`），三层防重 | HITL `respond` 结掉工具调用、同轮继续（`PageReviewCard.tsx:79–105`） | `conversation.send("[genui-action] …")`（`client/index.tsx:54–83,103–110`）；离散动作立即发、滑块 300ms 尾防抖（`GenuiBlock.tsx:28–71`） |
| 资产化 | code 存 session JSONL，渲染态 LRU 瞬态（`cards.ts:8–11`），**无模板库** | artifact 落库（数据资产），卡本身不资产 | 草稿变持久页面（**内容资产化最强**，`page-routes.ts:29–47`） | 模板中心（内置 7 类，`instruction` + 合法 `demo` spec，`templates.ts:32–51`）；导出 `.html` / `.genui.json`（`artifact/*`）；会话内指纹 LRU 200 |
| 表达力上限 | 任意 HTML | 两个变体 | 一个工具族 | 59 节点，含 3D/地图/图表/表单/图解 |

## 2. 从 genui 源码里读到的、真正值钱的东西

1. **spec 是白名单 + 深校验 + 确定性修复**，不是靠 schema 挡：`render_ui` 的参数 schema 故意松（`plugin/tool.ts:47–78`），深校验与修复在 `guard.ts`（120KB）里，理由写在注释里——「模型写出来的树天然不完美，schema 只会把它们卡死」。
2. **限制值是活的、且很小**：`maxDepth 8 / maxNodes 200 / maxString 2000 / maxTableRows 50 / maxChartPoints 60`（`genui-runtime/limits.ts`）。这与我上一轮凭直觉写的 8/200/2000 完全一致——可以当作行业锚点。
3. **词汇表以文档交付，且分两层**：系统提示只放「围栏语法 + 类型清单 + 行为铁律」（`plugin/index.ts:93–119`），全量字段映射放 `SKILL.md`，另有模板中心和 `validate_dsh_ui` 自查工具。**新增一种节点要改 8 处**（`AGENTS.md` 的清单：spec → schema → guard → render-node → 组件+CSS → i18n → SKILL → 测试），且系统提示有 **3400 字符硬预算**（测试会拦）。
4. **动作 = 一条用户消息**：`conversation.send("[genui-action] …")`（`client/index.tsx:54–83`）——不发明新的 turn 机制，直接复用人话通道。这正是我们 C4 难题的现成答案。
5. **主题靠 token**：源码里 188 处 `--dsw-*`（145 个文件）。意味着**我们的页面只要在子树里重绑 `--dsw-*` 到纸墨值，genui 组件会跟着变**——这是「复用 genui 渲染 + DIVA 视觉」之间的唯一接缝。
6. **两条渲染通道**：`render_ui` 工具（工具行卡，走 `tool.call.toolview`，`toolview.tsx`）+ `dsh-ui` 围栏（回复内联，靠 DOM 观察：`dom-fence.tsx:77` 的 `.md-code-block, .code-block, .code-block-small` 与 `data-code-block-content`）。**DOM 观察是它唯一能在 stock 宿主上工作的方式**，也是它最大的脆点。

## 3. 我核对过的可行性事实（决定能不能复用）

| 事实 | 结论 |
| --- | --- |
| genui 依赖的 DSH DOM 属性在本仓是否存在 | **存在**：`data-chat-anchor-key`/`data-chat-flow-key`（`ui-chat/src/client/chat/ChatNodeSeat.tsx:150–151`）、`data-code-block-content` 与 `.md-code-block`（`ui-primitives/src/markdown/CodeBlock.tsx:188,209`）。且 `ui-tool/README.md:72` 把 `data-chat-anchor-key` 写成「DOM 约定」 |
| 有没有 `fence-registry` | 本仓 `0.2.1-rc.5` **没有**（全仓 grep 零命中）→ genui 只会走 DOM 通道 |
| 能否嵌进我们自己的页面 | 有 `/embed` 导出（`src/client/embed.ts`：`GenuiBlock` / `GenuiActionContext` / `processGenuiSpec` / artifacts）。但它指向 **TS 源码 + CSS Modules**，我们的插件打包要能吃下 `tsx` + `.module.css`；资产（mermaid/three）由它自己的 `/plugins/@changfenhuang/dsh-genui/assets` 路由供给，需要插件已安装 |
| 视觉能不能变纸墨 | 大概率能（重绑 `--dsw-*`），但圆角/阴影/字体阶梯来自它的 CSS Modules，**必须实测** |
| 装它要改什么 | profile `dependencies` + `bundles` + `cordis.patch.yml` 一行 `insert: genui`（`cordis.patch.yml` 已给） |

## 4. 决策建议

| 编号 | 问题 | 建议 | 理由 |
| --- | --- | --- | --- |
| **D-A** | 卡片内容语言 | **采用 `dsh-ui` spec 作为唯一线格式**，页面内的卡也用它 | 同一张卡在聊天里、在页面上长得一样；模型只学一种语言；genui 生态的模板/校验/导出直接受益 |
| **D-B** | 页面卡渲染器 | **第一期自研薄渲染器，只实现内容子集**（约 16 种：text/row/col/grid/card/divider/stat/progress/list/table/keyvalue/steps/timeline/callout/badge/link/image/chart） | 视觉与布局归我们；不背 genui 的 59 节点与 CSS Modules；spec 相同 → 以后换渲染器零成本 |
| **D-C** | genui 怎么用 | **不作为全局插件安装**；只借它的 spec 与写作规范 | 用户 20:00 要求「genui 只在日常生效」，而它装成插件后是全局的：宿主半注入全局系统提示（`plugin/index.ts:93`）、客户端半是全局 DOM 观察者且不按会话过滤（`dom-fence.tsx:196,199,210`）。局部使用只能靠「不装 + 日常页自渲染 + 规范按 scope 注入」 |
| **D-D** | 卡片资产化 | **自己存**：storage 域 `card` = `{id, title, spec, kind, createdBy}`；内置模板来自 genui 的 7 个 demo spec（同格式） | 资产要在我们手里才能被页面「钉住」、被用户编辑、被跨会话复用 |
| **D-E** | 是否装 visualize | **不装** | 无回流；与 genui 功能重叠 |
| **D-F** | 若 genui 装不上/渲染冲突 | **保留 Plan B**：薄渲染器 + 自己写系统提示片段（照抄 genui 的 §「先问一句」那套判断规则） | 我们的页面卡本来就不依赖它 |

## 5. 落地顺序（拍板后，另开实施条目）

1. 取 genui 的 spec 子集与写作规范（抄「先问一句」那套判断规则），**不装插件**。
2. 日常页写薄渲染器（吃 spec 子集）→ 卡只在日常页出现。
3. 卡片写作规范按 scope 注入日常会话（`systemPrompt.section()` 的 scoped 注册，`deepseek-harness/packages/core/system-prompt/src/index.ts:471–486`），其它会话看不到这套语言。
4. 加 storage 域与 `card_save` / `card_list`。
5. 若日后确认愿意全站生效，再评估直接嵌 `GenuiBlock`（重绑 `--dsw-*` 做纸墨）——**用实测决定，不预先承诺**。

## 5.1 与 supervisor 的关系

卡片是**前台**的表达手段，编排在**后台**，但两者是同一个会话：superagent 的 main Session **本身就挂着 DIVA 人格**（`laputa:persona`），日常页接的就是它（详见 [daily-page-integration.md](daily-page-integration.md) §3.7）。所以卡片规范注入的 scope 是 main Session（以及日常页那个只读视图），worker Session 不注入——与人格注入的收窄规则一致。

## 6. 未核实

- `GenuiBlock` 在我们自己的 bundle 里能否编译通过（CSS Modules + TSX 跨包）——未试。
- 重绑 `--dsw-*` 后 genui 组件的观感是否可接受（圆角/阴影/字体）——未试。
- genui 在本 profile（`superagent-local`，Electron/Web 同栈）里的实际表现——未装、未跑。
- 它 0.16.0 的 DOM 观察在 0.2.1-rc.5 上是否随滚动/重放稳定——只核对了属性存在，未核运行时。

## 7. 参考

- 克隆：`.workspace/genui`（`omdsh-dev/dsh-genui` @ `33576039f27a4f62eb60d4307902ee65252eded6`，v0.16.0，MIT）
- 上游：https://github.com/omdsh-dev/dsh-genui
- 本仓前序：[agent-ui-card-spec.md](agent-ui-card-spec.md)、[daily-page-integration.md](daily-page-integration.md)
