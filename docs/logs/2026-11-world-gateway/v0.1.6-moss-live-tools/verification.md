# 验证记录 · v0.1.6（MOSS-Live 工具调研）

只读调研：没有跑代码测试，没有调用外部 API。下面记录「读了什么、用什么命令读的、看到什么」。

## A. MOSS-Live 文档

页面：`https://platform.moss.cn/en/docs/reference/moss-live`（canonical
`https://platform.mosi.cn/en/docs/reference/moss-live`），已存 `.artifacts/moss-docs/reference-moss-live.txt`
（68677 字节，去标签正文）。

| 检查 | 命令 | 实际 |
| --- | --- | --- |
| 「Custom tool calls」小节出现次数 | `$t.IndexOf('Custom tool calls')` 循环 | 2 次（目录与被引处） |
| 工具定义字段 | 读该小节 | `type=function`、`name`、`description`、`parameters`、`execution_mode`、`read_only` |
| 调用事件 | 读 `response.function_call_arguments.done` 表 | `call_id / item_id / name / arguments / output_index / response_id`，异步时另有 `execution_mode / task_id / revision / arguments_sha256` |
| 回传流程 | 读「Send back tool results…」 | `conversation.item.create` → `conversation.item.created` → `response.create{response:{call_ids}}` |
| 异步限额 | 读「Each session allows up to 128 async tasks…」 | 128 任务 / 32 修订 / 4 并发 / 单次 ≤120 秒 |
| `MCP` / `mcp` | 全文计数 | **0** |
| `tool_choice` | 全文计数 | **0** |
| `parallel` | 全文计数 | **0** |
| 浏览器连接限制 | 读「Browser connection limitation」 | 「浏览器原生 WebSocket 不能设置 Authorization 请求头；需服务端代理或集成适配器」 |

## B. MOSS Chat Completions

页面：`https://platform.mosi.cn/en/docs/reference/chat-completions`（存 `.artifacts/moss-docs/reference-chat.txt`）。

- 请求参数含 `tools`（「Supports function tools executed by the client. Server-hosted tools are unavailable.」）、
  `tool_choice`（auto / none / object）。
- 响应含 `choices[].message.tool_calls`（client 执行的结构化调用）、`finish_reason: tool_calls`。
- 结论：**HTTP 侧 OpenAI 兼容，Live 侧不是**。

## C. OpenAI 现行文档

| URL | HTTP | 取到的关键内容 |
| --- | --- | --- |
| `https://developers.openai.com/api/docs/guides/realtime-mcp.md` | 200 | Realtime 支持 `function`（应用执行）与 `mcp`（API 执行）两类工具；`session.tools` 或 `response.tools`；`tool_choice`；`function_call_output` 回传；`mcp_list_tools` / `mcp_approval_response` |
| `https://developers.openai.com/api/docs/guides/function-calling.md` | 200 | Chat Completions 的 `tools`（多一层 `function`）、`tool_calls`、`role:"tool"`；Responses/Chat 的通用形状 |
| `https://developers.openai.com/api/docs/guides/realtime.md` | 200 | 浏览器流程：服务端签 ephemeral client secret → 前端 `RealtimeSession` 直连 |
| `https://developers.openai.com/api/reference/resources/realtime.md` | 200 | WS `wss://api.openai.com/v1/realtime`、Bearer 鉴权、事件模型 |

注意：`platform.openai.com` 的文档 URL 会 302 到 `developers.openai.com`，`web_fetch` 不跟随跨域
重定向，第一次取 `platform.openai.com/...` 失败；改取 `developers.openai.com/...` 后成功。

## D. 未执行

- 未发起任何 MOSS 请求（无 key）。
- 未发起任何 OpenAI Realtime 会话（无 key，且不属于本轮问题）。
- 未改代码，因此无单元测试可跑。
