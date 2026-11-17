# MOSS-Live 能不能挂工具？和 OpenAI 那套差在哪

2026-11-18。只读调研：读官方文档与 OpenAI 现行文档，没有 key、没有跑过 MOSS-Live、没有改代码。

## 0. 先说结论

1. **能。** MOSS-Live 原生支持「客户端执行的函数工具」：`session.update.session.tools`，最多 128 个，
   模型通过 `response.function_call_arguments.done` 把调用交给你，你执行完用
   `conversation.item.create`（`function_call_output`）+ `response.create` 回传结果。
2. **它和「OpenAI compatible」不是同一层。** OpenAI Chat Completions 的 `tools / tool_calls / role:"tool"`
   是 HTTP 请求-响应里的结构；MOSS-Live 是常驻 WebSocket 的会话事件。**两者不能互换。**
   MOSS 的 HTTP 侧（Nex N2.6）倒是完全 OpenAI 兼容，`tools`、`tool_choice`、`choices[].message.tool_calls`
   都有——所以「MOSS 支持 OpenAI 工具标准」这句话只说对了一半：**文本侧兼容，实时侧不兼容。**
3. **但 Live 的工具协议明显照着 OpenAI Realtime 抄。** 连事件名都一样：
   `session.update`、`conversation.item.create`、`function_call_output`、`response.create`。
   差异是外壳与语义：MOSS 用 `action` 信封（OpenAI 用 `type`），多了**异步任务对象**（task/revision/取消），
   少了 `tool_choice`、`parallel_tool_calls`、MCP 和临时令牌。
4. **对世界网关的直接影响：没有。** 插槽只记地址/模型/凭据；要挂工具得等 Live 适配器那一轮，
   写一层事件桥。**建议现在不做**，理由见 §5。

## 1. 调查口径与限制

- 「接入工具」指：模型能发起函数调用、应用执行、把结果送回会话并让模型继续回答。
- 依据：MOSS 官方文档 `https://platform.mosi.cn/en/docs/reference/moss-live`（canonical；`platform.moss.cn`
  是同一站，2026-11-18，Beta）；OpenAI 官方 `realtime-mcp`、`function-calling`、`realtime` 指南
  （2026-11-18，GA 接口）。
- 限制：MOSS 文档是 Beta；无 `MOSS_API_KEY`，**没有实测**；OpenAI 只按现行文档对照，未跑会话。
  两者都只按文档原文判断，不包含「实际延迟/稳定性/工具选择准确率」。

## 2. MOSS-Live 的工具协议（文档原文归纳）

### 2.1 定义

`session.update.session.tools[]`，每条：

| 字段 | 说明 |
| --- | --- |
| `type` | 固定 `function` |
| `name` | 字母/下划线开头，字母数字下划线，≤64 字符，列表内唯一 |
| `description` | 必填、非空 |
| `parameters` | JSON Schema，可省略（省略即空对象） |
| `execution_mode` | `sync`（默认）/ `async_query`（只读长查询）/ `async_effect`（有副作用的长操作） |
| `read_only` | `async_query` 必须 true、`async_effect` 必须 false；`sync` 也可标 true（同参数同轮复用结果） |

要点：**列表整表替换**（`tools: []` 清空），官方要求跨会话保持稳定、别把用户/时间/订单号写进
description；初始化时一次 `session.update` 配完再开音频。

### 2.2 调用与回传

```
服务端 → response.function_call_arguments.done
  data: { call_id, item_id, name, arguments, output_index, response_id,
          execution_mode?, task_id?, revision?, arguments_sha256? }
应用执行 →
应用 → conversation.item.create { item: { type: "function_call_output", call_id, output } }
服务端 → conversation.item.created（确认收到）
应用 → response.create { response: { call_ids: [call_id] } }
```

- `output` 是文本或 JSON 字符串；`response.done` 里也可能带同一次调用，**按 `call_id` 去重、只执行一次**。
- 同步工具会卡住本轮回复，等待有上限，**超时按「没收到结果」处理**；文档建议 >2 秒的工具改成异步。

### 2.3 异步工具（MOSS 独有）

- 模型先说一句「在处理」，本轮结束，用户可以继续说话；应用在 WS 收发与音频循环之外执行。
- 每个 revision 生成新的 `call_id`；用 `arguments_sha256` 做幂等。
- 可修订/取消：`session.tool_task.revise`（带 `expected_revision`）、`session.tool_task.cancel`，
  服务端回 `session.tool_task.updated`；模型侧会发 `response.function_call.cancel_requested`
  让应用停手并丢弃迟到结果。
- 上限：每会话 128 个异步任务（含已完成）、每任务 32 次修订、同时最多 4 个在跑、单次从派发到收结果
  **最多 120 秒**；满了拒新任务，不驱逐在跑的。

### 2.4 另一个口子：client delegation

`attach_session.delegation.type = "client"` 时，后台模型/Agent/工具在**你的环境**里跑，
服务端发 `session.delegation.created` 等事件协调。它和前端自定义工具是两件事，
但工具在 `client` 与 `none` 两种模式下都能用。这比 OpenAI Realtime 的「函数调用」多一层任务编排语义。

### 2.5 明确没有的

- 文档里 **没有 `tool_choice`**、**没有 `parallel_tool_calls`**、**没有 MCP/服务端托管工具**。
- 浏览器不能直连：文档原话「浏览器原生 WebSocket 不能设置 Authorization 头，需服务端代理或集成适配器」；
  也没提临时令牌（ephemeral token）。

## 3. OpenAI 的两套标准

### 3.1 Chat Completions（MOSS 的 HTTP 侧兼容这套）

请求：`tools: [{ type: "function", function: { name, description, parameters } }]` + `tool_choice`；
响应：`choices[].message.tool_calls[]`（`id`、`function.name`、`function.arguments`），
`finish_reason: "tool_calls"`；回传：追加一条 `{ role: "tool", tool_call_id, content }` 再请求。
MOSS 的 Nex N2.6 文档逐项对得上（`tools`、`tool_choice`、`tool_calls`，且明说**只支持客户端执行**、
无服务端托管工具）。**注意多一层 `function` 包装**，这和 Live 的工具定义不同。

### 3.2 Realtime API（MOSS-Live 照着这套）

- 传输：`wss://api.openai.com/v1/realtime`，事件用 `type` 信封；浏览器走
  `POST /v1/realtime/client_secrets` 拿临时密钥直连。
- 工具：`session.update.session.tools`，也可在 `response.create.response.tools` 里只给一轮；
  `type: "function"` 的形状与 MOSS 相同（`name/description/parameters`），外加
  `tool_choice`（auto/none/required/指定）与 `parallel_tool_calls`。
- 还有 `type: "mcp"`：远程 MCP 由 **OpenAI 服务端执行**，客户端只配置 `server_url`/`connector_id`、
  听 `mcp_list_tools` / `mcp_call` 生命周期，必要时回 `mcp_approval_response`。
- 回传：同样 `conversation.item.create`（`function_call_output`, `call_id`, `output`）+ `response.create`，
  但**不需要 `call_ids`**；没有异步任务对象、没有 revision/取消事件、没有 delegation。

## 4. 逐项对照

| 维度 | MOSS-Live | OpenAI Realtime (GA) | OpenAI Chat Completions |
| --- | --- | --- | --- |
| 传输 | WS，客户端 `{action,...}` / 服务端 `{action,data}` | WS/WebRTC，`{type,...}` | HTTP + SSE |
| 定义位置 | 仅 `session.update.session.tools` | `session.update` 或 `response.create` | 每次请求 `tools` |
| 工具形状 | `{type,name,description,parameters,execution_mode,read_only}` | `{type,name,description,parameters}` | `{type,function:{name,description,parameters}}` |
| 数量 | ≤128 | 未在本文档给硬上限 | 未给 |
| 选择控制 | 无 `tool_choice` / 无并行开关 | `tool_choice` + `parallel_tool_calls` | `tool_choice` + `parallel_tool_calls` |
| 调用事件 | `response.function_call_arguments.done`（含 call_id/name/arguments） | 函数调用输出项 + 参数事件（`response.output_item.done` / `function_call_arguments.*`） | `message.tool_calls`（流式拼 delta） |
| 结果回传 | `conversation.item.create` → 确认 → `response.create{call_ids}` | `conversation.item.create` → `response.create` | 新请求带 `role:"tool"` |
| 异步长任务 | **有**：task_id/revision/取消/幂等/120s/4 并发 | 无协议级任务对象 | 无 |
| 服务端工具 | 无（只有客户端执行 + delegation） | 有 MCP（API 执行、审批事件） | Responses API 有 MCP；Chat 侧以函数为主 |
| 浏览器认证 | 必须服务端代理（不能设 Authorization 头） | 临时 client secret 直连 | 服务端持有 key |
| 工具列表变更 | 整表替换，要求跨会话稳定 | 可整表替换 | 每请求自带 |

一句话：**MOSS-Live = OpenAI Realtime 的事件骨架 + 自己的异步任务层 − MCP/tool_choice/临时令牌。**

## 5. 对我们的意义与建议

1. **想做「实时语音里调用 DSH 工具」，技术路是通的**：MOSS 是客户端执行模型，和 DSH 的工具循环同构；
   要写的是一层事件桥（收 `function_call_arguments.done` → 执行 → 回 `function_call_output` →
   `response.create`），不是改工具系统。
2. **别直接套 OpenAI Realtime SDK**：信封（`action` vs `type`）、`call_ids`、会话初始化流程都不同；
   MOSS 也没有临时令牌，浏览器端必须经我们的服务端代理。
3. **异步工具正好能承接长任务，但代价不小**：要把 `call_id` 去重、`revision` 冲突、取消与 120 秒上限
   都实现，还要决定「工具执行到一半用户又说话」的产品语义。第一版建议只做 `sync` 工具。
4. **不建议现在做**：Live 还是 Beta、单会话并发 1 条、没有 key 实测；先把语音闭环（连接/打断/播放确认）
   跑通，再挂工具。现在做等于在未验证的协议上叠一层未验证的编排。
5. 若要做，**最简方案**：服务端代理 + 只支持 `sync` 工具 + 一个 `tool_call` 内部事件；
   备选是直接照抄 OpenAI Realtime 形状做抽象层（便于换供应商，但多一层转换且 MOSS 的 async 语义会丢失）。

## 6. 决策清单（未拍板不实施）

- **D1 什么时候做 Live 工具桥**：A 现在（不推荐）｜ **B 等语音闭环跑通后（推荐）** ｜ C 不做，只做转写/合成。
- **D2 桥的形状**：A 直接按 MOSS 原生事件（**推荐**，薄）｜ B 抽象成 OpenAI Realtime 兼容层（可换供应商，厚）。
- **D3 第一版工具范围**：A 只 `sync`（**推荐**）｜ B `sync` + `async_effect`（要任务/取消/幂等）。
- **D4 是否接受 Beta 限制**：128 工具 / 128 异步任务 / 4 并发 / 120 秒 / 单会话并发 1 / 无 MCP——接受才做。

## 7. 未验证

- 没有 `MOSS_API_KEY`：上述事件名、字段、限制全部来自文档，**没有一条经过真实会话**。
- 同步工具「等待上限」具体多少秒、超时后会话如何继续，文档没给数值。
- 同一轮是否能并发多个工具调用（有 `call_ids` 数组，但没有并行语义说明）。
- `output` 的大小上限、二进制/图片结果如何表达，文档未说明。
- OpenAI Realtime 的调用事件在不同 SDK/版本里既有 `output_item` 也有 `function_call_arguments` 系列，
  本文按现行指南写；若要对齐到具体 SDK 版本需再核。

## 8. 参考

- MOSS-Live 参考（Beta）：https://platform.mosi.cn/en/docs/reference/moss-live ｜ 访问 2026-11-18
  （`platform.moss.cn/docs/reference/moss-live` 同一页，文档站域名 302）
- MOSS Chat Completions（Nex N2.6）：https://platform.mosi.cn/en/docs/reference/chat-completions ｜ 同上
- OpenAI「Realtime with tools」：https://developers.openai.com/api/docs/guides/realtime-mcp ｜ 同上
- OpenAI「Function calling」：https://developers.openai.com/api/docs/guides/function-calling ｜ 同上
- OpenAI Realtime API 参考：https://developers.openai.com/api/reference/resources/realtime ｜ 同上
