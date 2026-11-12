# 验证记录 v0.0.1-feasibility

> 只写事实：调用、预期、实际。禁止只写「通过」。
> 本轮是只读代码核对，验证形式是「定位约束并给出文件行号」。未改代码、未跑测试。

| # | 调用 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | 读 `src/archive.mjs:20-24` | 归档接受哪些 project 标签 | 白名单写死 `['qq','bili','owner','pet','other']`，其余归 `other`（`:107`） |
| 2 | 读 `src/archive.mjs:125-198` | 归档写入是否幂等/可改写 | `archive_id+digest` 校验，重复=duplicate，不同正文=conflict，无 update 路径 |
| 3 | 读 `src/store/memory_store.mjs:220-240` | 归档唯一性与索引 | `UNIQUE(archive_id, chunk_index) WHERE archive_id IS NOT NULL`；FTS5 `tokenize='unicode61'` |
| 4 | 读 `src/store/memory_store.mjs:125-146` | 表结构 | `memories(id, content, content_hash, project, topic, source, timestamp, session_id, importance, chunk_index, parent_id, embedded, archive_id, archive_digest, subject_id, archive_meta)` |
| 5 | `Select-String 'DELETE FROM' memory_store.mjs` | 是否存在删除路径 | 有 `deleteMemory`/`deleteVec` 语句（内部维护/迁移用），但**没有 HTTP 或工具暴露** |
| 6 | 读 `src/http.mjs:95-290` | 公开路由清单 | 无 `POST /memories`、无 `POST /memories/delete`；`/import` 是整库 JSON 恢复 |
| 7 | 读 `README.md:112,125-132` | 契约口径 | 「三者都返回 404」；归档只经 internal 接口 + `x-component-token`；`reindex` 只重算向量 |
| 8 | `Select-String "name: '" src/tools.mjs` | 工具面 | 14 个；记忆类全只读，仅 `knowledge_add`/`knowledge_invalidate` 写三元组 |
| 9 | `grep 'obsidian|vault|\.md' src/*.mjs src/*.js` | vault 感知 | 0 命中 |
| 10 | 读 `src/store/chunk.mjs:3-40` | 分块能力 | `chunkText`：800/100/50，段落→行→硬切 |
| 11 | 读 `src/store/chunk.mjs:57-74` | topic 归一化 | `[^a-z0-9\s-]` 全删 → 中文标题归一化为 `general` |
| 12 | 读 `src/store/memory_store.mjs:200` | 向量表 | `vec0(embedding float[384])` |
| 13 | 读 `src/store/embeddings.mjs` + `config.mjs` | 默认嵌入模型 | `Xenova/all-MiniLM-L6-v2`（英文），可配 `embeddingModel` |
| 14 | 读 `src/service.mjs:301-310` | `/import` 语义 | `exportAll`/`importAll` 整库 JSON，不是笔记导入 |
| 15 | 读 `src/project.mjs` | project 从哪来 | `defaultProject > sessionProject > cwd basename > 'general'` |
| 16 | `Get-ChildItem tests -Filter 'mempalace*'` | 现有测试面 | 5 个文件：archive/archive-store/knowledge/retire/主测试；无 vault 相关用例 |

## 未做的验证

- 未安装插件依赖、未跑 `node --test`（本轮不改代码，结论不依赖运行时）。
- 未实测多语嵌入与 FTS trigram 的检索质量。
- 未在真实 Obsidian vault 上验证外部写入的冲突提示。
