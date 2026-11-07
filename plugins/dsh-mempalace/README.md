# dsh-mempalace

DeepSeek Harness 的持久语义记忆插件，移植自 [pi-mempalace](https://github.com/Jabbslad/pi-mempalace) 0.2.1（MIT，见 [NOTICE.md](NOTICE.md)）。

- SQLite + sqlite-vec 本地向量检索，FTS5 关键字回退
- 按项目 / 话题组织记忆，支持宫殿图与跨项目隧道
- 时序知识图谱（实体、三元组、有效期、失效、版本账本）
- 只读日记、只读近期记忆预览
- 左侧栏管理面板：概览、记忆（只读归档与检索）、搜索、知识图谱、宫殿图、日记、设置
- 14 个模型工具与 `/mempalace` 命令

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
memories.db     SQLite 主库（WAL；含归档列）
config.json     面板保存的设置
migration.json  一次性退役标记（已备份配置与身份文件的路径、sha256、警告）
archive/        旧 identity.txt 的归档位置
runtime.json    本机组件 IPC 地址与令牌（0600）
models/         向量与话题模型缓存
backups/        导入/维护前的备份
```

不会写入 `~/.pi`、项目源码目录或其他位置。

本插件不再自动捕获对话，也不向系统提示注入人格或记忆。手工记忆写、删除与日记写已退役；活跃个人记忆由 ActMem 提交，MemPalace 只读归档，知识图谱写入保持显式（`knowledge_add` / `knowledge_invalidate`）。历史 `source='auto-capture'` 行保留且仍可检索。面板的记忆页是只读归档与检索投影，不提供新增或删除入口。启动时的一次性迁移会备份旧 `config.json` 并移除已删除的捕获/注入字段，把旧 `identity.txt` 备份后移入 `archive/`，并写 `migration.json`；之后不再读取身份文件。近期记忆预览只在面板和 `GET /recent-memory` 中展示，标记为不可信参考数据，受 `wakeUpMaxTokens` 上限约束。

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
/mempalace stats
/mempalace project <name>
/mempalace export
```

`/mempalace save` 已移除：手工记忆写由 ActMem 负责。

## 工具

14 个模型工具；记忆工具全部只读，知识图谱写入保持显式。

| 工具 | 用途 |
| --- | --- |
| `memory_search` | 语义/关键字搜索，可按 project/topic 过滤 |
| `memory_recall` | 按项目/话题读取上下文 |
| `memory_status` | 总量、项目分布、存储与后端状态 |
| `memory_graph` | 宫殿图节点与隧道 |
| `memory_tunnel` | 沿话题跨项目钻取 |
| `knowledge_add` | 新增实体或三元组（显式写入） |
| `knowledge_query` | 按实体/谓语查询事实 |
| `knowledge_status` | 知识图谱统计 |
| `memory_list_rooms` | 话题房间列表 |
| `memory_taxonomy` | 项目 → 话题树 |
| `memory_check_duplicate` | hash + 语义查重（只读，只报告不写入） |
| `knowledge_invalidate` | 设置事实失效时间（显式写入） |
| `knowledge_timeline` | 实体/全局事实时间线 |
| `memory_diary_read` | 读最近日记（只读归档） |

工具返回 `{ text, data }`；`text` 给模型，`data` 供 UI/调试。参数错误返回结构化 `INVALID_ARGS`，不会抛出未处理异常。

## HTTP API

前缀 `/dsh-mempalace/api`，只监听回环地址；非 GET 请求校验同源，POST 必须是 `application/json`，默认 512 KB 请求体上限（`/import` 为 10 MB）。错误统一为 `{ ok: false, code, error, hint }`。

```text
GET  /status  /recent-memory  /config  /models/status
GET  /memories  /rooms  /taxonomy  /graph/palace  /graph/tunnel
GET  /knowledge/stats  /knowledge/entities  /knowledge/query  /knowledge/timeline
GET  /knowledge/commits
GET  /diary
POST /search  /config
POST /knowledge/entity  /knowledge/triple  /knowledge/invalidate
GET  /export
POST /import  /maintenance/vacuum  /reindex  /models/warmup
```

`POST /memories`、`POST /memories/delete` 与 `POST /diary` 已删除，三者都返回 404；`GET /diary` 仍是只读入口。

## 知识版本账本

`GET /knowledge/commits?assetScope=<scope>&limit=<n>` 只读列出本安装 subject 的知识版本账本：

- `assetScope`（别名 `asset_scope`）可选；省略时返回该 subject 在全部资源范围内的提交。
- `limit` 取 1–200，默认 50。
- 按 `created_at` 倒序、同毫秒按写入顺序倒序排列；不提供写入、发布或回滚入口。
- 面板知识图谱页底部有同一份数据的只读卡片：可填资源范围与条数，只有刷新按钮。

## 归档内部接口

前缀 `/dsh-mempalace/internal`，仅回环地址并要求 `x-component-token`（`$DSH_HOME/mempalace/runtime.json`）。公开面板 API 不暴露归档写入口。

```text
POST /archive         幂等归档一批 item，逐项返回 archived|duplicate|conflict|rejected 与 receipt
POST /archive/status  按 archive_id 查询 archived|absent|conflict
```

归档正文写入 `memories` 表，并追加 `archive_id`、`archive_digest`、`subject_id`、`archive_meta` 四列，`source = 'actmem-archive'`。`(archive_id, chunk_index)` 部分唯一索引保证同一 `archive_id` 重投只写一次；不同 digest 复用同一 `archive_id` 返回冲突，不写任何行。`reindex` 只重算向量，不改写归档正文。

## 知识版本与回滚

长期知识以 `knowledge_commits` 追加式账本版本化。账本只追加、不删除：状态变化写成 `state` 列的 `live` / `superseded` / `rolled_back`，失效与回滚只改三元组有效期，历史行始终保留。

- `knowledgeId = kn_ + sha256(subjectId\0assetScope).slice(0, 32)`。同一主体与资产范围恒定映射到同一账本；某个 `commitKey` 已属于另一账本时返回 `MEMPALACE_KNOWLEDGE_CONFLICT`，不写任何行。
- 每次提交必须给出 `commitKey`；同一 key 重放返回首次落账的修订，不重复写入。
- 提交按 `expectedRevision` 比较并交换：缺省 `0` 表示要求该资产还没有 live 修订，不匹配返回 `MEMPALACE_KNOWLEDGE_REVISION`。
- 四项检查 `provenance`、`conflict`、`integrity`、`retrieval` 必须全为 `true` 才落账，缺一项返回 `MEMPALACE_KNOWLEDGE_CHECKS`，账本与三元组都不变。
- 回滚追加一个新修订并写 `restores_revision`，同时把原 head 标为 `rolled_back`；目标修订必须早于当前 head，区间内若含更早的回滚修订则拒绝（`MEMPALACE_KNOWLEDGE_TARGET`），只允许回滚到该回滚修订或其后的普通提交。
- 回滚修订的 digest 以空 `checks` 计算，是检查门禁的显式豁免：它重放既有提交的 inverse，不引入新内容。

写入只经组件内部 IPC（前缀 `/dsh-mempalace/internal`，回环地址并要求 `x-component-token`）：

```text
POST /knowledge/commit    提交一条知识修订
POST /knowledge/status    按 knowledgeId 或 subjectId + assetScope 列出账本，或按 commitKeys 查指定提交
POST /knowledge/rollback  回滚到更早的修订
```

公开面板 API 不暴露这三个路由。已有的 `knowledge_add`、`knowledge_invalidate` 工具和知识图谱页签仍是直接写三元组的旧入口，不经过版本账本；可发布、可回滚的写入只有这一条所有者接口。结果未知时用 `knowledgeStatus({ commitKeys })` 对账：按 key 返回已落账的修订，查不到即未提交，不需要盲重试。

## 面板

`src/client.js` 是单文件 React 面板，通过 `window.__ModuleLoader__.load` 注册到 `main` 与 `sidebar.panellist` 两个 slot，无需构建步骤。七个标签：

1. **概览**：总量、存储、项目、28 天活动、分布与近期记忆预览
2. **记忆**：筛选、分页与只读检索；由 ActMem 写入，面板不提供新增或删除
3. **搜索**：语义/关键字结果、相似度、过滤
4. **知识图谱**：实体与事实 CRUD、失效、时间线，底部为只读知识版本账本
5. **宫殿图**：项目节点与共享话题隧道（纯 SVG），可下钻
6. **日记**：只读归档，按时间正序读取；写入已退役
7. **设置**：话题推断、预览上限与模型设置、导入导出、vacuum、reindex、预热与诊断

瞬时结果用顶部 toast，字段错误就地显示，后端降级用常驻横幅；破坏性操作均需二次确认。

## 测试

在仓库根目录执行：

```sh
node --test tests/mempalace.test.mjs tests/mempalace-retire.test.mjs tests/mempalace-knowledge.test.mjs
```

测试使用确定性的假 embedder，不下载模型；原生依赖缺失时跳过数据层集成用例。`node --check` 覆盖面板与所有 `.mjs` 的语法。

## 许可

MIT。上游来源、版本与移植范围见 [NOTICE.md](NOTICE.md)。
