# MemPalace 多向量空间 / 云端向量 / 自动召回：使用与运维

状态：已实现并通过离线验收（2026-11-13）。云端真实往返待 key。

概念与不变量见 [`docs/architecture.md` §10.4–10.5](architecture.md)。本文只回答「怎么开、怎么验、怎么退」。

## 1. 三种常见动作

### 1.1 继续用本地模型（默认）

不用改任何配置。活动空间是 `local-xenova-all-minilm-l6-v2@384`，旧库首次启动会被原地收养，并在 `<stateDir>/backups/` 留一份迁移前备份。

### 1.2 切换到云端向量

前置：世界网关面板里「向量化」插槽已启用，`kind` 是 `dashscope` 或 `siliconflow`，`baseURL` 是真实地址（不能留着 `{WorkspaceId}` 占位符），模型名填对，并填入对应 API Key。

```text
1. 面板 → 设置 → 模型与网络 → 向量来源 = 云端 / 世界网关
2. 先把 cloudEmbeddingDim 填成你预期的维度（默认 512）
3. 点「探测向量接口」：
   - 成功且显示「返回 N 维」→ 维度一致就继续；N ≠ cloudEmbeddingDim 就把它改成 N
   - 失败 → 按提示修 key / baseURL / 模型名，不要保存切换
4. 保存设置（活动空间随之切到 cloud-…@N，旧空间仍保留）
5. 点「重建缺失向量」，把旧记忆补进新空间
```

也可以在命令行先探一次（需要同名环境变量里有 key）：

```bash
node scripts/embedding-probe.mjs            # 读 $DSH_HOME 下的配置与网关插槽
node scripts/embedding-probe.mjs --dim 512 --json
```

探测不写数据库、不打印 key。

### 1.3 切回本地

把「向量来源」改回本地并保存即可。本地空间的向量一直在，`重建缺失向量` 应为 0；如果显示缺 N 条，重建一次即可，不会影响云端空间。

## 2. 迁移前先干跑

```bash
node scripts/spaces-check.mjs          # 或 --home <dir>、--json
```

它用 SQLite backup 读取线上库的一致性快照（只读连接，不改线上文件），在临时目录里依次验证：收养旧表 → 统计缺向量 → 切到 512 维云空间 → 报告空间数与被保留的行数。适合在重启前确认「换维度不会丢数据」。

## 3. 配置项

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `embeddingSource` | `local` | `local` / `cloud`，只接受显式值 |
| `embeddingDim` | `384` | 本地空间的维度 |
| `cloudEmbeddingDim` | `512` | 云端空间维度，必须与实测一致 |
| `cloudEmbeddingTimeoutMs` | `15000` | 单次请求超时 |
| `cloudEmbeddingBatch` | `16` | 每批输入条数 |
| `recallInjectionEnabled` | `true` | 是否自动注入旧事 |
| `recallTopK` | `4` | 最多注入几条 |
| `recallMinScore` | `0.4` | 综合分阈值（0–1） |
| `recallMaxChars` | `600` | 注入块字符预算 |
| `recallTimeoutMs` | `1200` | 召回超时，超时退关键字 |
| `recallExcludeSensitive` | `true` | 自动召回跳过敏感记忆 |

## 4. 接口

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/dsh-mempalace/api/spaces` | 活动空间、全部空间、缺向量数 |
| POST | `/dsh-mempalace/api/spaces/reindex` | 补齐当前空间缺失向量 |
| GET | `/dsh-mempalace/api/embedding/status` | 来源、模型、维度、熔断、错误码与建议 |
| POST | `/dsh-mempalace/api/embedding/probe` | 真实往返一次，返回实测维度与耗时 |

## 5. 失败语义（面板怎么读）

- `MEMPALACE_SLOT_MISSING/_DISABLED/_PLACEHOLDER/_KIND_UNSUPPORTED/_INVALID`：网关插槽问题，按提示改网关，不是插件 bug。
- `MEMPALACE_EMBEDDING_AUTH`：没 key 或被拒；熔断 5 分钟，期间不重试网络。
- `MEMPALACE_EMBEDDING_TIMEOUT/_NETWORK/_RATE_LIMIT/_HTTP/_RESPONSE`：网络或对端问题；正文与既有向量不受影响。
- `MEMPALACE_SPACE_MISMATCH`：宽度不一致；正文仍写入，只是没有向量。按实测维度改 `cloudEmbeddingDim` 后重建。
- `MEMPALACE_SPACE_MISSING`：注册表里有空间但物理表不见了；拒绝静默重建，去 `backups/` 找回或手工修复。

## 6. 回滚

1. 只切来源 → 直接改回 `local`。
2. 需要整库回退 → `npm run stop`，把 `<stateDir>/backups/memories-<ISO>.db` 拷回 `memories.db`（旧代码不认识 `embedding_spaces` / `memory_spaces` 两张表，缺列不影响旧代码读取）。
3. 云端空间想丢弃 → 停服后 `DROP TABLE vec_memories_cloud_…` 并删注册表对应行；不建议在运行中做。

## 7. 已验证 / 未验证

已验证（离线，`node tests/mempalace-*.test.mjs`）：384 与 512 同库并存与检索隔离、宽度不符不写向量、旧库原地收养并留备份、切换空间后旧向量仍在、缺表时报错、云端请求/重试/熔断/维度校验、召回打分与敏感过滤、超时兜底。线上库已实际完成迁移（7/7 行，备份已落盘）。

未验证：云端真实往返（等 key）、`qwen3.7-text-embedding` 的实际维度、多批次大库（>1000 行）重建耗时。
