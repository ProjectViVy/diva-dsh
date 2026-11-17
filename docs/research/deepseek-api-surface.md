# DSH 上游的 DeepSeek API 接入面，与「导入在线聊天记录」的真相

> 调研日期：2026-11-17（Asia/Shanghai）｜只读调研，未改代码、配置与数据
> 证据基线：本地 `origin/master`（=`39163dd`，0.2.2-rc.3 + 608 个未发版提交）与本仓 pin `b830ec9`（0.2.1-rc.5）；两类对照都跑了本地命令，输出见 `docs/logs/2026-11-upstream-dsh/v0.1.2-deepseek-api-surface/verification.md`。

## 0. 结论

1. **你记得没错，但大部分不是「0.2.2 才加的」，而是我们 pin 里就有、而且已经在这台机器上跑着。**本机 profile 的默认模型就是 `deepseek-account` / `deepseek-flash`（effort high），凭据里存着账号 token；DeepSeek Files 上传缓存里有 **26 条**记录（2026-11-16 22:54 → 11-17 02:36）。也就是说：账号登录、Messages 适配器、图片走 Files API、Search/Fetch 的底座、两个请求扩展，**我们在 rc.5 上就都有了**。
2. **0.2.2 真正新增的 DeepSeek 相关能力只有三类**：①「DeepSeek 会话导入」实验 bundle（pin 里没有，默认关）②Search 的默认提供方从「旧 Messages 搜索」换成**直连 DeepSeek Search API**（不再每次搜索烧一个模型轮次），同时凭据模式与端点改为跟随模型路由、Exa/Perplexity 移除 ③Files 上传超时从 60s 改 20s、账号 Remote 重构、账号赠送通知字段化（内部/边角）。
3. **「导入在线聊天记录」不准确——那是离线 ZIP，不是在线拉取。** 你要先在 chat.deepseek.com 点「导出全部会话」拿到 `deepseek_data-*.zip`，再在 DSH 里上传；Host 解析 ZIP，把**最近最多 1000 个会话**写成你选的工作区里的 DSH 会话，保留原标题/时间、思考、联网搜索卡片、阅读链接与图片；只 owner 能导。
4. **对我们最要紧的两条**：①升级后搜索默认走 Search API → 需要 DeepSeek 凭据（账号或 API key），缺凭据时 `web_search` 会从模型工具里被撤掉；我们现在有账号登录所以能继续搜，但计费口径从「模型 token」变成「Search API 按次/额度」。②base 默认挂 `session-log-deepseek` 与 `plugin-package-inventory-deepseek` 两个请求扩展，文档说会把**规范会话日志**与**活跃插件清单**随官方 API 请求上报；本机 78 份会话日志里**没有找到投递水位事件**，所以「是否真在上传」未核实——但这是个可以关的开关。

## 1. 口径与限制

- 「上游」= `origin/master` 源码与升级指南原文；「新增」= 该包在 pin 里不存在，或升级指南标注了行为变化。
- 「本机现状」= 读 `.artifacts/dsh-home` 下的 profile patch、凭据**名称**、Files 缓存、会话日志（zstd 解压后扫描）；**没有读出任何 token 值**。
- 限制：**没有发起真实 API 调用**（不花账号额度、不动 token），所以账号 token 是否仍有效、Search API 在账号计费下的实际单价与额度、`deepseek-flash` 是否在账号 `GET /models` 列表里，均未实测。

## 2. 上游有什么（观测）

### 2.1 模型接入：两条路由，共用一套 Messages 适配器

| 路由 | 插件 | 凭据 | 模型来源 |
| --- | --- | --- | --- |
| `deepseek-official` | `deepseek-llm-deepseek-api-key` | `DEEPSEEK_API_KEY`（或 YAML 指定） | 官方模型列表；**无 key 时目录为空、分组隐藏**（`v0.2.1-alpha.1/deepseek-model-discovery`） |
| `deepseek-account` | `deepseek-llm-deepseek-account` | 浏览器登录账号，token 存本地凭据库 | 账号 `GET /models`；不再可手配 `models` 目录，只能 `modelOverrides`；模型可要求更新版 DSH，否则 `CLIENT_UPGRADE_REQUIRED`（`v0.2.1-alpha.2/deepseek-account-model-catalog`） |

- 适配器走 `https://api.deepseek.com/anthropic`（Anthropic Messages 协议）：思考强度用 `output_config.effort`；图片优先走 Files API（beta 头，带上传缓存/刷新/配额恢复，失败回退内联 base64，128 MiB 保留图片预算）；保留 `ReplayEnvelope` 签名回放；会话中途的 system 更新按原生 system 轮次发在原位置（`2026-09-07-deepseek-messages-adapter.zh.md`）。
- 端点：`DEEPSEEK_BASE_URL` 只从启动环境或 `$DSH_HOME/.env` 接受，**不从项目 `.env`**。

### 2.2 请求扩展：官方 API 请求上可以挂字段（默认就有两个）

`deepseek-llm-api-extensions` 注册 `ctx.deepseekLlmApiExtensions`，插件各自认领一个顶层字段。base 组合默认挂了两个：

| 包 | 默认 | 贡献字段 | 说明 |
| --- | --- | --- | --- |
| `session-log-deepseek` | **开** | `dsh_session_log` | 增量上传**规范会话日志**：从已接受水位之后取最长连续事件段，单请求上限 8 MiB；有 Web 开关「设置 → 通用 → 在使用官方模型 API 时上传 Session Log」 |
| `plugin-package-inventory-deepseek` | **开** | `dsh_plugin_packages` | 上报活跃 Loader 包清单，用于请求诊断 |

- 另有一条独立路径：`session-telemetry-otel`（OTel），默认 `FEEDBACK_ONLY`，只在你给反馈/评分时上传截至该事件的前缀。
- 两者都可以在 profile 里 `enabled: false` 关掉。

### 2.3 搜索与抓取：直连 API vs 旧 Messages 搜索

| | 旧版 Messages 搜索（`deepseek-official`） | DeepSeek Search/Fetch API（`deepseek-search-api` / `deepseek-fetch-api`） |
| --- | --- | --- |
| 形态 | 一次辅助模型请求（`deepseek-v4-flash` + 服务端 `web_search`） | 一次直接 HTTP 请求，不调模型 |
| 计费 | 模型 token | Search API 计费（账号或 API key 二选一） |
| 端点 | 独立 | 会话模型路由 origin + `/v1/tools`，追加 `/search` 或 `/fetch`；官方即 `https://api.deepseek.com/v1/tools` |
| 参数 | — | Search：`query`、`count`（1–50，默认 10）、`need_content:false`、`ori_question`（最近用户提示前 128 字，可关） |
| 返回 | 结构化搜索块 | Search：title/url/snippet/summary/date（summary 给模型，默认每条截 800 字）；Fetch：页面 Markdown |
| 限速 | — | 默认 5 QPS（`searchRequestsPerSecond`） |
| 默认 | pin 时代：**是** | 0.2.2-alpha.2 起：**是**（base 的 `web.searchProvider` 改了默认） |

- 凭据三档：`auto`（跟会话路由：账号路由先账号 token 再 key；官方路由只 key）/ `account` / `api-key`；也可以用 YAML 的 `searchBaseURL`+`searchApiKeyEnv`（Fetch 对应 `fetch*`）单独固定，此时**从不发账号 token**。
- 缺凭据 → 提供方 `ready()` 为 false → `dsh-tool-web` **从该请求里撤下 `web_search` 与 `web_fetch`**（rc.2 起的行为，pin 已有）。抓取默认仍是本地 `http` 抓取，所以 web_fetch 在没 DeepSeek 凭据时还能用。

### 2.4 账号本身：登录、通知

- `credentials/deepseek-account`：系统浏览器授权登录，token 存现有本地凭据库；登出/取消处理迟到回调。
- 账号通知（0.2.1-alpha.4 起字段化）：`getUnnotifiedBonuses()` 返回 `campaign/amount/currency/grantedAt/orderId/title/expiresAt`；`ui-account-notifications` 在账号菜单旁展示。**也就是说，账号登录能看到「赠送额度到账」这类通知。**

### 2.5 会话导入（0.2.2 新增，实验性 bundle，默认关）

- 包：`packages/experimental/deepseek-chat-import`（bundle id `deepseek-chat-import`），已列入 `OPTIONAL_BUNDLES`，**默认不挂载**。
- 入口：侧栏「新建会话」右侧的按钮 → 上传 `deepseek_data-*.zip` → 选工作区 → 导入。
- 上限（可配）：`maxSessions` 1000（按导出索引最近更新取）、`maxUploadBytes` 512 MiB（整包在内存里）、`maxEntryBytes` 256 MiB、`maxTitleBytes` 80。
- 映射：官网消息树**只保留 `current_message_id` 指定那条链**（分叉丢弃）；思考写进 step 时间、联网搜索写成 `web_search` 调用、打开网页写成 `web_fetch`、`READ_LINK` 写成行内 Markdown 链接；图片走附件服务（png/jpg/jpeg/webp/gif），其他文件只生成「文件卡片」（**模型读不到内容**）；模板回答、`CONTENT_FILTER` 撤回、进行中的搜索导入时略去。
- 权限：**只有 owner 能导**（上传路由只接受 owner Peer）。
- 重复导入同一 ZIP 会再写一组会话（不会去重）。

## 3. 本机现状（观测，2026-11-17）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 默认模型 | `provider: deepseek-account`、`model: deepseek-flash`、`reasoningEffort: high` | `.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml` |
| 额外 provider | `llm-pi-ai` 里 `opendesign`（`openai-responses`，`OPENDESIGN_API_KEY`） | 同上 |
| 账号凭据 | `deepseek-account-platform/default`、`deepseek-account-platform/device` 两条记录存在（**值未读取**） | `.artifacts/dsh-home/.credentials.yaml`（只看了键名） |
| API key | **没有** `DEEPSEEK_API_KEY`，没有 `.env` | 环境与目录检查 |
| Files 上传缓存 | **26 条** `file-api-*`，2026-11-16 22:54 → 11-17 02:36 | `.artifacts/dsh-home/llm-deepseek/files-v3.json` |
| 两个请求扩展 | base 组合默认挂载（`session-log-deepseek`、`plugin-package-inventory-deepseek`） | pin 的 `packages/bundle/base/cordis.patch.yml:43,85` |
| 实际上传取证 | 解压本机 **78 份**会话日志扫描 `session-log-deepseek` / `dsh_session_log`：**0 命中** | `probe-session-log.mjs` 输出 |
| pin 里缺的 | `packages/experimental/deepseek-chat-import` **不存在**（其余相关包都在） | 本地 `Test-Path` |

## 4. 卡点

- **K1 账号态是否可用未知**：DV-RUN-001 记过 DeepSeek 登录 403；本轮没验证 token 是否仍有效、额度是否够。
- **K2 账号模型目录改了语义**：0.2.1-alpha.2 起账号路由的模型来自 `GET /models`，不再能手配；我们 profile 里写死 `deepseek-flash`，若账号列表里没有这个名字，界面会显示「请选择模型」。**未实测。**
- **K3 搜索计费口径变了**：从「模型 token」变成「Search API 计费」，账号计费与 API key 计费的单价/额度不同；5 QPS 也是账号级限制。
- **K4 会话导入只写 Session**：不进 ActMem、不进记忆宫殿；要变成「可检索的记忆」得额外做一个作业（现有 `plugins/memory`、`dsh-mempalace` 都有写入边界，不能顺手塞）。
- **K5 导入会占会话列表**：1000 条上限、重复导入翻倍；命名/分组会挤爆侧栏。
- **K6 两个请求扩展是隐私边界**：文档默认开，本机又走官方账号路由；**是否真在上传未取证**（78 份日志无水位事件），但开关清晰（Web 开关或 `enabled:false`）。
- **K7 这些都挂在 DSH 0.2.2 上**：会话导入、Search 默认切换都要求先拍 DV-UP-002 的升级（推荐 rc.3 tag）。

## 5. 决策清单（不拍板不实施）

- **D1 什么时候动**：A（推荐）跟 DV-UP-002 一起，升到 rc.3 后再动 DeepSeek 这摊；B 先只升 rc.3、DeepSeek 一律保持现状；C 在 pin 上先手工验证账号态（不改版本）。
- **D2 搜索走哪条**：A（推荐）升级后接受新默认（直连 Search API），先实测一次账号计费下的响应与额度；B 把 `web.searchProvider` 改回 `deepseek-official`（模型 token 计费、每次搜索一个模型轮次）；C 搜索全关，只留 `http` 抓取。
- **D3 会话导入**：A（推荐）升级后启用 bundle，先导最近 200 条试水，确认侧栏与会话可用后再导全量；B 不导；C 先手工解压一份看结构再定。
- **D4 两个上报扩展**：A 保持默认开；B（推荐先关）`enabled:false` 两个都关，需要官方诊断时再开；C 只关会话日志、留插件清单。
- **D5 导入后的用途**：A 只当历史浏览；B（推荐）抽成记忆卡/宫殿条目（走现有写入边界，不改上游）；C 当 few-shot 素材（会增加每轮 token）。
- **D6 是否加 `DEEPSEEK_API_KEY` 兜底**：A 加（账号掉登录时搜索/模型不断）；B 不加，只靠账号；C 只在 `.env` 里放但要接受「项目 `.env` 不被读取」的规则。

## 6. 参考（访问/读取日期 2026-11-17）

- 包文档：`packages/llm/{llm-deepseek,llm-deepseek-account,llm-deepseek-api-key,deepseek-llm-api-extensions}/README.zh.md`、`packages/web/{web-deepseek-api,web-search-deepseek}/README.zh.md`、`packages/session/session-log-deepseek/README.zh.md`、`packages/llm/plugin-package-inventory-deepseek/README.zh.md`、`packages/experimental/deepseek-chat-import/README.zh.md`、`packages/credentials/deepseek-account/README.zh.md`、`packages/client/ui-settings-web-search/README.zh.md`
- 设计取舍：`.agents/notes/implemented/feature/2026-09-07-deepseek-messages-adapter.zh.md`、`2026-10-15-deepseek-search-fetch-api.zh.md`、`2026-11-11-deepseek-chat-export-import.zh.md`
- 升级指南：`docs/upgrade-guide/v0.2.2-alpha.2/{web-search-default-provider,web-search-credential-modes}`、`v0.2.1-rc.3/web-search-defaults`、`v0.2.1-alpha.1/deepseek-model-discovery`、`v0.2.1-alpha.2/{deepseek-account-model-catalog,stored-credentials-precedence}`、`v0.2.1-alpha.4/account-notification-fields`、`v0.2.2-rc.1/account-remote-provider`、`v0.2.2-rc.2/deepseek-files-timeout`
- 组合默认值：pin 与 master 的 `packages/bundle/base/cordis.patch.yml`（搜索默认值 470–471 vs 487；扩展行 43、85；模型路由行 525–529）
- 外部：`https://api-docs.deepseek.com/zh-cn/guides/search`（Agent Note 引用）

## 7. 附：web_search 之后会用本地浏览器吗（2026-11-17 追问）

**上游的答案是不会，方向还相反。** 0.2.2 的 Search 改动是「少一跳」：从「一次辅助模型请求」换成「一次直接 HTTP 请求」，没有引入任何浏览器依赖；`packages/web/*` 里没有任何 playwright/puppeteer/selenium 依赖。`dsh-web` 的提供方面仍是 HTTP：搜索侧 `deepseek-search-api`、旧 Messages 搜索 `deepseek-official`；抓取侧 `deepseek-fetch-api` 与匿名本地 `http`。

**浏览器在另一条缝上**：`@deepseek-ai/dsh-browser-use` + 实验性 provider（`browser-use-playwright-mcp`、`browser-use-stagehand-native`、`browser-use-chrome-devtools-mcp`、CUA）。它们给 **Agent 操作网页**，不是搜索提供方；而且这些包**不在** `OPTIONAL_BUNDLES` 里——插件页没有开关，只能显式挂到 profile，或走按需目录（当前目录里只有 `subagent-codex` / `subagent-claude-code`）。Playwright MCP 支持 `mode: launch|attach`、`executablePath`、`headless`，`attach` 可以接管你正在用的 Chrome（连登录态一起）。另外 `client-ui-sidebar-browser` 是面板右侧的浏览器标签页（iframe / `<webview>`），跟搜索无关。

**要真想让搜索走本地浏览器，是自己写 provider，不是升级带来**：`ctx.web` 每次调用解析提供方 id，插件注册 `searchProvider` / `fetchProvider` 即可，profile 里把 `web.searchProvider` 指向它。代价：每次调用起浏览器或接管标签页（慢、内存高）、解析规则自己维护、无头/CI 环境更脆；收益只在「需要登录态或反爬」的站点。本机现已具备条件（Chrome 在 `C:\Program Files\Google\Chrome\Application\chrome.exe`，`%LOCALAPPDATA%\ms-playwright` 也在）。

**建议**：先不写浏览器版搜索。升级后先用 Search API + `http` 抓取；真遇到「必须登录态才看得到」的站点，优先用 browser-use `attach` 到你现有 Chrome（一条明确的能力，不污染 web seam），而不是自己造一个浏览器搜索 provider。
