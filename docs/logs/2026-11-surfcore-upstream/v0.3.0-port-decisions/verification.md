# 验证记录 v0.3.0

> 只写事实：命令、预期、实际。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `web_fetch raw.githubusercontent.com/Mieksido/surfcore/v0.8.9/src/vector-memory.js` | 拿到上游向量记忆真实实现 | HTTP 200，约 700 行全文：`DEFAULT_VECTOR_MEMORY_CONFIG`（modelSpace `bge-m3@1024-f16-v1`）、`vectorIndexPaths()` 按空间分文件、`rankVectorMemories()` 四段打分、`redactVectorText()`、`SENSITIVE_RE`、`writeVectorIndex()` 先 bin 后 manifest |
| 2 | `grep embedding\|向量\|vector in plugins/dsh-mempalace` | 我方向量栈现状 | SQLite + sqlite-vec，`Xenova/all-MiniLM-L6-v2`；`vec0(embedding float[384])`（`memory_store.mjs:200`）；`embeddingDim !== 384` 直接抛错（`config.mjs:70`、`memory_store.mjs:68-70`） |
| 3 | `grep CREATE TABLE\|model\|chunk in memory_store.mjs` | 是否有 model 列 / 空间概念 | `memories` 表列：id/content/content_hash/project/topic/source/timestamp/session_id/importance/chunk_index/parent_id/embedded/archive_*；**无 model 列**；只有一张 `vec_memories` |
| 4 | `grep palace\|mempalace\|recall in plugins/memory/src` | 是否已有自动召回 | `bili-memory.mjs:848 recallBlock(query,{maxChars,limit})` 存在（触发词 + bigram 词法 + 新近度，无向量）；宫殿检索仅经工具与 `index.mjs:33 archiveSend` |
| 5 | `ls plugins/` | 是否有 mempalace 插件 | 有 `dsh-mempalace`；另有 `memory`（ActMem）、`capability-hub`（embedding 插槽）、`dsh-surfcore-adapter` |
| 6 | `grep 压缩\|compact\|会话滚动 in docs/architecture.md` | 我方是否有上下文滚动机制 | 仅 1 处命中（`revision` 语义里的「压缩」），**无会话滚动条目** |
| 7 | `grep 向量 in docs/` | 已有向量决策 | `capability-hub-slots.md`：embedding 插槽「只算不换库」；`provider-hub-and-gateway.md`：三家 512/1024 都无 384、`dsh-mempalace` 卡 384；`qwen-platform-model-integration.md`：P3 暂缓，等 20 条中文 query 对照测 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| `vec0` 同库多维度共存实测 | 需建库改 schema，属实施动作，非调研 | P0-1 开工第一步 |
| 当前 `memories` 行数与被标记 `embedded=0` 的比例 | 需读运行态 SQLite（`.artifacts/dsh-home` 数据库），有改动风险 | P0-1 开工时用只读连接查 |
| DSH 侧上下文压缩机制 | 需读 `deepseek-harness/` 源码，本轮未展开 | 决定 P2-8 时 |

## 反向验证

确认「不能只搬模块」这条判断：`safe-text.js` / `command-spam.js` / `wake-batch.js` 在 v0.8.6 都不存在（新增），但 `bridge.js` 是唯一调用它们的地方（`src/bridge.js` 979 KB，本次 diff +1881 行）——单独复制模块文件不会产生任何行为，只会留下死代码。
