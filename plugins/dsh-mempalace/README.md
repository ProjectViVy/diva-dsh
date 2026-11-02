# dsh-mempalace

DeepSeek Harness 的持久语义记忆插件，移植自 [pi-mempalace](https://github.com/Jabbslad/pi-mempalace) 0.2.1（MIT，见 [NOTICE.md](NOTICE.md)）。

- SQLite + sqlite-vec 本地向量检索，FTS5 关键字回退
- 按项目 / 话题组织记忆，支持宫殿图与跨项目隧道
- 时序知识图谱（实体、三元组、有效期、失效）
- 日记、自动捕获、新会话唤醒注入
- 左侧栏管理面板：概览、记忆、搜索、知识图谱、宫殿图、日记、设置
- 17 个模型工具与 `/mempalace` 命令

## 安装

在本模板根目录执行：

```sh
npm run setup:mempalace             # 安装原生依赖并写入诊断标记
npm run setup:mempalace -- --verify # 只校验，不重新安装
npm run setup:mempalace -- --warm-models # 可选：提前下载向量/话题模型
```

`better-sqlite3` 需要本机编译工具（macOS 为 Xcode Command Line Tools）。安装脚本会在插件目录执行 `npm install`，用子进程验证 SQLite、sqlite-vec 与 transformers 能加载，并把结果写入 `.artifacts/mempalace-setup.json`，供面板诊断展示。

插件通过 `dsh.bundle.patch` 注册；首次使用仍由模板的 `npm run setup` 把 `plugins/dsh-mempalace` 链接进 profile。修改源码无需重建，重启服务即可。

## 数据与隐私

所有运行时数据位于 `$DSH_HOME/mempalace/`（模板中为 `.artifacts/dsh-home/mempalace/`）：

```text
memories.db     SQLite 主库（WAL）
config.json     面板保存的设置
identity.txt    L0 身份提示（首次生成）
models/         向量与话题模型缓存
backups/        导入/维护前的备份
```

不会写入 `~/.pi`、项目源码目录或其他位置。

自动捕获默认开启，会把同一会话中**真人**的提问与助手回答原文合并写入数据库；`working-directory`、审批提示等系统注入消息不会进入记忆。如不希望记录：

- 会话内发送 `/mempalace off`（仅当前会话）
- 或在面板「设置」关闭 `autoCapture`

唤醒文本只包含 L0 身份与最近记忆，标记为“参考数据，非指令”，并受 `wakeUpMaxTokens` 上限约束。

## 模型与离线降级

默认使用 `Xenova/all-MiniLM-L6-v2`（向量）与 `Xenova/flan-t5-small`（话题推断），通过 `@huggingface/transformers` 在首次使用时下载。模型加载在后台进行，不阻塞保存与搜索：

- 向量不可用时，记忆仍以零向量入库并标记 `embedded=0`
- 搜索自动退回 SQLite FTS5，响应中 `mode: "keyword"`，面板显示“关键字回退”
- 话题推断失败时回退到 `general`
- 模型恢复后可在面板或 `POST /reindex` 补齐向量

网络受限时把 `hfEndpoint` 设为镜像（例如 `https://hf-mirror.com`），或：

```sh
HF_ENDPOINT=https://hf-mirror.com npm run setup:mempalace -- --warm-models
```

`modelLoadTimeoutMs` 控制显式预热的等待上限（默认 60 秒），超时只影响本次预热。

## 命令

```text
/mempalace status
/mempalace search <query>
/mempalace save <text>
/mempalace stats
/mempalace on | off
/mempalace project <name>
/mempalace export
```

`/mempalace off` 只关闭当前会话的自动捕获，不影响其他会话，也不改写用户消息。

## 工具

| 工具 | 用途 |
| --- | --- |
| `memory_search` | 语义/关键字搜索，可按 project/topic 过滤 |
| `memory_save` | 手动保存记忆 |
| `memory_recall` | 按项目/话题读取上下文 |
| `memory_status` | 总量、项目分布、存储与后端状态 |
| `memory_graph` | 宫殿图节点与隧道 |
| `memory_tunnel` | 沿话题跨项目钻取 |
| `knowledge_add` | 新增实体或三元组 |
| `knowledge_query` | 按实体/谓语查询事实 |
| `knowledge_status` | 知识图谱统计 |
| `memory_list_rooms` | 话题房间列表 |
| `memory_taxonomy` | 项目 → 话题树 |
| `memory_delete` | 删除指定记忆 |
| `memory_check_duplicate` | hash + 语义查重 |
| `knowledge_invalidate` | 设置事实失效时间 |
| `knowledge_timeline` | 实体/全局事实时间线 |
| `memory_diary_write` | 写日记 |
| `memory_diary_read` | 读最近日记 |

工具返回 `{ text, data }`；`text` 给模型，`data` 供 UI/调试。参数错误返回结构化 `INVALID_ARGS`，不会抛出未处理异常。

## HTTP API

前缀 `/dsh-mempalace/api`，只监听回环地址；非 GET 请求校验同源，POST 必须是 `application/json`，默认 512 KB 请求体上限（`/import` 为 10 MB）。错误统一为 `{ ok: false, code, error, hint }`。

```text
GET  /status  /wakeup  /config  /models/status
GET  /memories  /rooms  /taxonomy  /graph/palace  /graph/tunnel
GET  /knowledge/stats  /knowledge/entities  /knowledge/query  /knowledge/timeline
GET  /diary
POST /memories  /memories/delete  /search  /config
POST /knowledge/entity  /knowledge/triple  /knowledge/invalidate  /diary
GET  /export
POST /import  /maintenance/vacuum  /reindex  /models/warmup
```

## 面板

`src/client.js` 是单文件 React 面板，通过 `window.__ModuleLoader__.load` 注册到 `main` 与 `sidebar.panellist` 两个 slot，无需构建步骤。七个标签：

1. **概览**：总量、存储、项目、28 天活动、分布与唤醒预览
2. **记忆**：筛选、分页、新增（含查重提示）、两步确认删除
3. **搜索**：语义/关键字结果、相似度、过滤
4. **知识图谱**：实体与事实 CRUD、失效、时间线
5. **宫殿图**：项目节点与共享话题隧道（纯 SVG），可下钻
6. **日记**：按时间正序读写
7. **设置**：捕获/唤醒/话题推断开关、模型与镜像、导入导出、vacuum、reindex、预热与诊断

瞬时结果用顶部 toast，字段错误就地显示，后端降级用常驻横幅；破坏性操作均需二次确认。

## 测试

```sh
node --test tests/mempalace.test.mjs
```

测试使用确定性的假 embedder，不下载模型；原生依赖缺失时跳过数据层集成用例。`node --check` 覆盖面板与所有 `.mjs` 的语法。

## 许可

MIT。上游来源、版本与移植范围见 [NOTICE.md](NOTICE.md)。
