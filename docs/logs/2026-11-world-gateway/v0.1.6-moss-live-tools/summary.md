# v0.1.6 · MOSS-Live 的工具调用调研

2026-11-18。只读调研，零代码改动。回答主人「他这个 live 是不是也能接入工具？和 openai compatible
的工具接入标准，区别有吗」。

## 结论

1. **能挂工具，但是客户端执行的函数工具**：`session.update.session.tools`（≤128），模型发
   `response.function_call_arguments.done`，应用执行后用 `conversation.item.create`
   （`function_call_output`）+ `response.create` 回传并续答。
2. **和「OpenAI compatible」不是一层**：`tools / tool_calls / role:"tool"` 是 HTTP Chat Completions 的
   请求-响应结构；MOSS 的 HTTP 侧（Nex N2.6）完全兼容它，但 **Live 不用这套**。
3. **Live 更像 OpenAI Realtime**：事件名 `session.update` / `conversation.item.create` /
   `function_call_output` / `response.create` 都相同；差异是 `action` 信封（OpenAI 用 `type`）、
   多出**异步任务层**（task_id/revision/取消/幂等/120 秒、4 并发）、少了 `tool_choice`、
   `parallel_tool_calls`、MCP 与浏览器临时令牌。
4. **对世界网关无影响**：插槽只记地址/模型/凭据；工具桥属于 Live 适配器轮。建议等语音闭环跑通后再做，
   第一版只支持同步工具。

完整对照、事件字段、限制与决策清单见 `docs/research/moss-live-tool-calling.md`。

## 本轮做了什么

- 读 MOSS-Live 官方参考的「Custom tool calls / Async tools / client delegation」全部小节，
  以及 MOSS Chat Completions 的 `tools/tool_choice/tool_calls` 字段。
- 读 OpenAI 现行 `Realtime with tools`、`Function calling`、`Realtime API` 文档，逐项对照。
- 把结论写成报告，并在 `moss-world-gateway-wiring.md` §4 加了指向报告的钩子。
- 没有改任何代码、配置、数据与依赖；没有调用 MOSS/OpenAI（没有 key）。

## 未验证

- 没有 `MOSS_API_KEY`，所有事件名/字段/限额来自文档，**没有一条跑过真实会话**。
- 同步工具的等待上限秒数、同轮能否并行多个工具、`output` 大小上限、结果能否带二进制，文档未给。
- OpenAI 只按现行文档对照，未跑会话；不同 SDK 版本的函数调用事件名可能不同。

## 下一步

主人读报告 §6 拍 D1–D4（何时做、桥的形状、第一版范围、是否接受 Beta 限额）。可只回「按推荐来」。
