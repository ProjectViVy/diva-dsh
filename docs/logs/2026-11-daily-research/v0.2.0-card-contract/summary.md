# 卡片契约决策 · v0.2.0-card-contract · 总结

- 触发：用户 19:32「先看 hanako / openmuse / opendot 的方案再决定；可以把 genui 克隆到临时目录研究」。
- 交付：`docs/research/card-contract-decision.md`（四方案契约对比 + genui 源码事实 + D-A…D-F 决策建议）。
- 克隆：`.workspace/genui`（`omdsh-dev/dsh-genui`，v0.16.0，MIT，commit `33576039f27a4f62eb60d4307902ee65252eded6`）。只读研究，未安装、未构建、未运行。
- 结论：**spec 统一（借 genui 的 `dsh-ui` 语言）、渲染分期（第一期自研薄渲染器只吃内容子集）、资产自持（storage 域存 spec）**；装 genui 当聊天内复杂卡渲染器与模型写作规范来源；不装 visualize。
- 关键事实：
  1. genui 的 spec 是白名单 + 深校验 + **确定性修复**，参数 schema 故意松（`plugin/tool.ts:47–78`），修复在 `guard.ts`。
  2. 限制值 `maxDepth 8 / maxNodes 200 / maxString 2000`（`genui-runtime/limits.ts`），与上一轮凭直觉写的数字一致。
  3. 词汇表分四层交付：系统提示精简契约（约 3400 字符预算）+ `SKILL.md` 62KB + 模板中心 + `validate_dsh_ui`；**新增一种节点要改 8 处**（`AGENTS.md`）。
  4. 动作回流 = `conversation.send("[genui-action] …")` 一条用户消息（`client/index.tsx:54–83`），离散立即、滑块 300ms 尾防抖（`GenuiBlock.tsx:28–71`）。
  5. 主题靠 `--dsw-*` token（188 处 / 145 文件）→ 我们页面重绑即可纸墨化（未实测）。
  6. 两条渲染通道：`render_ui` 工具卡（keyed toolview）+ `dsh-ui` 围栏（**DOM 观察**，`dom-fence.tsx:77`）。
- 可行性核对：DSH `0.2.1-rc.5` 存在 genui 依赖的 DOM 契约（`data-chat-anchor-key`/`data-chat-flow-key` 见 `ChatNodeSeat.tsx:150–151`；`data-code-block-content`/`.md-code-block` 见 `CodeBlock.tsx:188,209`）；但**没有 `fence-registry`**（全仓零命中）→ 只能走 DOM 通道。
- 未验证：`GenuiBlock` 跨包编译、`--dsw-*` 重绑后的观感、在 `superagent-local` 里的真实表现、DOM 观察在滚动/重放下的稳定性。
- 下一步：等用户就 D-A…D-F 拍板；拍板后另开实施条目（装 genui → 薄渲染器 → storage 域 → 再评估换 `GenuiBlock`）。
