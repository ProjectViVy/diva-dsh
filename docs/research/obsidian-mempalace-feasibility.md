# 可行性评估：Obsidian 笔记 ↔ MemPalace 双向

> 需求原文：笔记内容生成索引进 mempalace；允许 agent 对笔记读写；mempalace 关联的 Obsidian 放在特殊 wings 分区，不与其它分区打架。
> 评估对象：`plugins/dsh-mempalace`（HEAD 工作区）+ `plugins/dsh-actmem-recap` 的归档契约
> 结论时间：2026-11-11 · 方法：读源码定位约束，未改任何代码

---

## 0. 结论

**可行，但要先拆一件事**：你说的「索引」和「读写」不能走同一扇门。

| 你的设想 | 可行性 | 一句话 |
| --- | --- | --- |
| 笔记 → 索引进 mempalace | **可行**，需新代码 | 分块、嵌入、FTS 都有现成的，缺的是「扫描 vault + 增量更新 + 可变更的存储单元」 |
| 特殊 wings 分区隔离 | **可行**，需绕一道坎 | `project` 就是 wing，但归档入口有白名单，未知项目会被强制改成 `other` |
| agent 读笔记 | **可行**，几乎零成本 | 检索工具已在；加 `scope: notes` 即可 |
| agent 写笔记 | **可行，但与现有契约冲突** | mempalace 是**只读归档**：`POST /memories` 已删（返回 404），正文只由 ActMem 经内部接口写入且不可改写 |
| 中文笔记的语义检索 | **当前不可用** | 默认嵌入模型是英文 MiniLM，FTS5 用 `unicode61` 不切中文，`normalizeTopicLabel` 还会把中文 topic 洗成 `general` |

**推荐路线 A**：笔记走**独立的 notes 存储域**（同库不同表），`project` 标签固定为 `obsidian` 作为隔离 wing；记忆归档表一行不动。见 §5–§7。

> **2026-11-11 决策**：用户已排除 C（笔记必须是 mempalace 的专属能力，不是记忆），选择 **A 作为存储底座**，但同时要求**D 的可见性**（能在图里从笔记跳到项目）。定稿方案见 §11：A 的隔离存储 + D-lite 的稀疏投影 + **指针式检索**（检索结果自带 `path/heading/行号`，agent 两步就能读到原文）+ 自动索引链路。

---

## 1. 现状：mempalace 能做什么、不能做什么

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| 存储 | SQLite `memories` 表，`project`/`topic` 自由文本，`project` 即 wing | `memory_store.mjs:125-146` |
| 写入 | 只经 ActMem → 内部接口 `/dsh-mempalace/internal/archive`，带 `x-component-token` | `README.md:123-132` |
| 公开写入口 | `POST /memories`、`/memories/delete`、`/diary` 已删除，均 404 | `README.md:112` |
| agent 工具 | 14 个，记忆类**全只读**；只有 `knowledge_add`/`knowledge_invalidate` 写三元组 | `tools.mjs` + `README.md:75-94` |
| 分块 | `chunkText`：800 字符 / 100 重叠 / 最小 50，按段落或行切 | `store/chunk.mjs:3-40` |
| 嵌入 | `Xenova/all-MiniLM-L6-v2`，384 维，`vec0` 虚拟表 | `store/embeddings.mjs` + `memory_store.mjs:200` |
| 关键字回退 | FTS5，`tokenize='unicode61'` | `memory_store.mjs:238-239` |
| vault 感知 | **零**：全仓 0 处 `obsidian`/`vault`/`.md` 引用 | `grep` 结果为空 |
| 变更检测 | **无**：没有 watcher、没有 mtime 扫描、没有删除检测 | 同上 |
| 导入导出 | `/import` 是整库 JSON 备份恢复，不是笔记导入 | `service.mjs:301-310` |

一句话：**它现在是一间只进不出的档案室**，不是文件索引器。

---

## 2. 四个硬卡点

### C1 归档白名单会把你的「特殊 wing」吃掉

```js
// archive.mjs:24
const PROJECTS = new Set(['qq', 'bili', 'owner', 'pet', 'other'])
// archive.mjs:107
project: normalizeProjectLabel(PROJECTS.has(meta.project) ? meta.project : 'other'),
```

如果笔记走 ActMem 归档通道，`project: 'obsidian'` 会被**静默改写成 `other`**——正好和你要的隔离相反。要么扩充白名单，要么（推荐）笔记根本不走归档通道。

### C2 归档行不可变，笔记是可变文件

- `(archive_id, chunk_index)` 唯一索引 + digest 校验：同 ID 不同正文 → `conflict`，不写；
- 没有 update/delete 路由；`reindex` 只重算向量，不改正文（`README.md:132`）；
- 笔记改一个字，在归档语义里就变成**新修订**，旧版本永久留着。

这不是 bug，是 ActMem 账本设计的核心。让文件索引去蹭这套账本，等于把「不可变档案」的契约弄脏。

### C3 没有 vault I/O，也没有变更检测

全仓没有读 `.md` 的代码。要做索引，得新写：遍历、忽略规则（`.obsidian/`、`Templates/`、附件、`.trash/`）、frontmatter 解析、按标题/段落切块、路径去重、改名/删除处理。

### C4 中文索引能力（这条最容易被忽略）

三个独立的问题叠在一起：

1. **嵌入模型是英文的**：`Xenova/all-MiniLM-L6-v2` 是英文语料训练，中文语义相似度基本随机；
2. **FTS5 不切中文**：`unicode61` 会把一串连续汉字当成**一个 token**，`"部署流程"` 只能整串命中，搜「部署」搜不到；
3. **topic 归一化会吃掉 CJK**：

```js
// chunk.mjs:66
.replace(/[^a-z0-9\s-]/g, '')   // 中文 → 空 → 'general'
```

所以如果笔记标题是「部署流程」，topic 会变成 `general`，房间全塌到一个格子里。

**结论**：中文 vault 要么换多语嵌入模型（`Xenova/paraphrase-multilingual-MiniLM-L12-v2` 同为 384 维，可切换）**并全量 reindex**（新旧向量不同空间，不能混用），要么给 notes 用独立的 trigram FTS 表。前者影响现有记忆，后者只影响笔记——我倾向后者：**笔记域自己决定索引策略，不绑架记忆域**。

---

## 3. 三种方案

### A（推荐）独立 notes 域：同库、不同表、独立工具

```
memories.db
├── memories / vec_memories / memories_fts     ← ActMem 归档，一行不动
└── notes / note_chunks / note_fts / note_vec  ← 新增（笔记）
        │
        └── project = 'obsidian'（wing）· topic = 文件夹或 H1（room）

工具：obsidian_search / obsidian_read / obsidian_append / obsidian_create / obsidian_reindex
```

- **隔离**：wing 用固定 `project='obsidian'`；`memory_*` 工具默认看不见笔记，只有显式 `scope: notes|all` 才合并；
- **可变**：笔记行按 `path` 主键 upsert / delete，和归档账本互不干扰；
- **中文**：notes 自己的 FTS 用 `trigram`，嵌入模型可单独选多语（加一列记录 model，避免混用）；
- **代价**：面板、taxonomy、palace 图要一层薄投影才能看见这个 wing；代码量最大。

### B（次选）复用 `memories` 表 + 作用域可变

把笔记写成 `source='obsidian-note'`、`project='obsidian'` 的 `memories` 行，删除/更新只允许作用于这一类行（`archive_id IS NULL`）。

- **白拿**：`memory_search` / `memory_taxonomy` / `memory_graph` / 面板全部立即可用，代码量最小；
- **代价**：①`README.md` 明写「面板记忆页是只读归档」，语义要改；②中文 topic 仍会被 `normalizeTopicLabel` 洗掉，必须绕过；③`importAll`/`exportAll`、`recentMemoryPreview` 会把笔记混进记忆预览，要逐处加过滤；④「归档只读」的契约从「全表」缩成「非笔记行」，需要写清楚。

### C（不推荐）笔记当 memory body 投给 ActMem

- 白名单要扩、编辑=新修订、删除不存在、importance/会话语义错位；
- 笔记的「一篇=一个对象」和记忆的「一条=一条记忆」根本不是一种东西。

### 对比

| 维度 | A 独立域 | B 复用表 | C 走归档 |
| --- | --- | --- | --- |
| 代码量 | 大（~600–800 行） | 中（~300–400） | 小（~150） |
| UI 白拿 | 否，需薄投影 | 是 | 是 |
| 契约干净度 | 高 | 中 | 低 |
| 中文支持 | 可独立解决 | 需绕归一化 | 受制于归档 |
| 可删除/可改名 | 是 | 是（限定 source） | **否** |
| 风险 | 多写代码 | 污染记忆语义 | 语义错位 + 与 ActMem 抢写 |

---

## 4. 推荐：A 的最小切片

| 阶段 | 内容 | 估工 | 验收 |
| --- | --- | --- | --- |
| **M0 只读索引** | `scan.mjs`（遍历 + 忽略 + frontmatter/标题切块）+ `note_store.mjs`（4 张表）+ `obsidian_search` / `obsidian_read` / `obsidian_reindex` 三个工具 + `POST /obsidian/reindex` | 1.5–2 人日 | vault 里 200 篇笔记全量入索引；改一篇后 reindex 只更新该篇；删一篇后检索不再返回；`memory_search` 默认不返回笔记 |
| **M1 写** | `obsidian_append`（追加到文件尾或指定 H2）、`obsidian_create`（仅当不存在时新建，默认落 `_inbox/`）+ 写后只重建该篇索引 | 1 人日 | append 后文件 mtime/内容正确、索引即时可搜；对已存在文件 create 必须拒绝；写入原子（tmp+rename） |
| **M2 可见性** | 面板新增「笔记」页签（只读浏览器 + 跳转 Obsidian URI）、taxonomy/palace 的 `obsidian` wing 薄投影 | 1–2 人日 | 面板能按文件夹浏览、能搜、点开显示全文；宫殿图多一个 `obsidian` 节点且不与项目隧道混淆 |

**不建议首版就做**：删除工具、整篇改写、wikilink 自动补全、双向图。前两个是不可逆操作，后两个会把「索引」变成「编辑器」。

---

## 5. 数据结构草案（A）

```sql
CREATE TABLE notes (
  path TEXT PRIMARY KEY,          -- vault 内相对路径，正斜杠
  sha256 TEXT NOT NULL,           -- 内容哈希，变更检测 + 幂等
  mtime INTEGER NOT NULL,
  title TEXT, folder TEXT,        -- folder → room
  frontmatter TEXT,               -- 原始 YAML 文本，不做语义解释
  size INTEGER, updated_at INTEGER
);
CREATE TABLE note_chunks (
  path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL, content TEXT NOT NULL, hash TEXT,
  PRIMARY KEY (path, chunk_index)
);
CREATE VIRTUAL TABLE note_fts   USING fts5(content, content='note_chunks', content_rowid='rowid', tokenize='trigram');
CREATE VIRTUAL TABLE note_vec   USING vec0(embedding float[384]);
```

要点：
- **主键是路径**，不是内容哈希——笔记会变，身份不该变；
- 一篇多块（`chunkText` 复用 800/100）；短笔记 1 块；
- 嵌入向量记 `model` 列（在 chunks 表里），换模型时只重建自己的向量，不碰 `vec_memories`；
- 中文 FTS 用 `trigram`，英文仍可走 trigram（SQLite ≥ 3.34 支持）。

---

## 6. 写路径的安全规则（M1）

1. **只允许 append / create，不做 replace / delete**——不可逆操作留给用户手动；
2. **原子写**：写 `*.tmp` 再 `rename`，避免 Obsidian 读到半截文件；
3. **读到写的前置校验**：`obsidian_read` 返回 `sha256`，写工具要求带上；文件已变则拒绝（防止覆盖用户在 Obsidian 里的编辑）；
4. **路径白名单**：只写 vault 内、只写 `.md`、拒绝 `..`、拒绝 `.obsidian/`、`Templates/`、`.trash/`；
5. **create 幂等**：目标存在直接报错，不给「静默覆盖」留口子；
6. **写后立刻更新该篇索引**（重新切块 + 嵌入），并在返回里带 `path`/`sha256`/`chunk_count`。

冲突提示写进工具描述：**Obsidian 正在编辑同一文件时，外部写入会让编辑器提示「文件已在磁盘上更改」**；建议 agent 默认写 `_inbox/`，由用户合并。

---

## 7. 索引更新策略

- **触发**：①服务启动时后台全量对账（遍历 → 只处理 sha 变化的）②`obsidian_reindex` 手动 ③写工具写后单篇更新。**不做文件监听**（跨平台坑多，且 Obsidian 自己会频繁 touch 文件）。
- **改名/移动**：路径变了 → 旧路径行删除、新路径插入（等于丢一次历史，可接受）；
- **删除**：扫描时发现文件不存在 → 删行；
- **忽略**：`.obsidian/`、`.trash/`、`Templates/`、非 `.md`、空文件、`.excalidraw.md` 可选；
- **规模**：1000 篇 × 3 块 = 3000 向量，本地 MiniLM 首次全量约几分钟，之后增量只算变化篇。

---

## 8. 与现有组件的边界

| 组件 | 边界 |
| --- | --- |
| ActMem | 继续独占 `memories` 归档写入口；notes 域**不向 ActMem 汇报**，也不进记忆卡 |
| 记忆卡 / `recentMemoryPreview` | 明确排除 notes（`project='obsidian'` 的行不在 `memories` 表里，天然排除） |
| `memory_search` 等 14 个工具 | 默认不返回笔记；新增 `scope` 参数后才合并，避免记忆检索被笔记淹没 |
| 面板「记忆」页 | 不改语义；笔记是**新页签**，不是混进记忆列表 |
| 知识图谱 | 笔记的 wikilink 可以以后作为三元组来源（`[[A]]` → `A co-mentioned`），但**首版不做** |

---

## 9. 未验证 / 风险

1. **中文嵌入质量**：没有实测多语模型在中文 vault 上的 R@5；建议 M0 用 50 条真实笔记做一次小评测再定模型。
2. **trigram FTS 的磁盘与性能**：trigram 索引通常比 unicode61 大 2–4 倍，1000 篇量级需实测。
3. **Obsidian 的写冲突体感**：没在真实 Obsidian 里验证「外部 append 后编辑器如何提示」。
4. **面板改动**：`client.js` 是 70KB 单文件 React，加页签的成本按经验估 0.5–1 人日，未实测。
5. **多 vault**：当前设计按单 vault；多 vault 需要 `obsidian:<vault>` 前缀，本轮未展开。

---

## 10. 建议

先做 **M0（只读索引）**，用你自己的 vault 跑一周：能搜到、够快、中文不拉胯，再决定要不要 M1 的写。

理由：M0 不触碰任何现有契约，失败成本最低；而「写」一旦开放，最先出问题的不是代码，是**用户正在 Obsidian 里编辑时被 agent 覆盖**。先把「读得好不好」验证掉，再谈写。

如果只想要「agent 能改笔记」，其实 DSH 的文件工具已经能做；mempalace 在这里的价值只有三个：**可检索、有 wing 隔离、能进面板**。值不值得做，取决于你要不要第三个。

---

## 11. 定稿方案（2026-11-11）

用户约束：**C 禁用**（笔记是 mempalace 的专属能力，不是记忆）；存储用 **A**；可见性要 **D**；检索链路是「搜记忆 → 拿到笔记位置 → 读原文」三步，因此**索引必须自带定位信息**，并且要有**自动索引链路**。

### 11.1 一句话架构

> 笔记有自己的表、自己的索引、自己的工具；检索结果永远带 `path + heading + 行区间`；索引靠「启动对账 + 定时增量 + 写入即更新」三条自动链路保鲜；图里只投影**枢纽笔记**，不逐篇展开。

### 11.2 三步检索链路

```
① memory_search({ query, scope: 'all' })
     → [{ kind:'memory', project, topic, snippet, score },
        { kind:'note', note:{ path, title, heading, line_start, line_end }, snippet, score }]

② obsidian_read({ path, heading? })
     → 只返回该标题下的原文（±窗口），附 frontmatter 与 sha256

③（可选）obsidian_read({ path }) 全文 / obsidian_read({ path, line_range:[a,b] })
```

两个关键点：

1. **命中即定位**。每个 note chunk 在入库时就记好 `heading_path`（如 `部署 > 回滚`）、`line_start`、`line_end`。检索命中第 3 块，就直接告诉你「哪篇、哪一节、第几行」，agent 不需要二次搜索。
2. **读走插件，不走裸文件系统**。`obsidian_read` 自己做路径白名单与切片，避免依赖宿主的 fs 沙箱策略（vault 常在 workspace 之外），也避免把 5000 行的长笔记整个塞进上下文。

### 11.3 数据结构（相对 §5 增补）

```sql
CREATE TABLE notes (
  path TEXT PRIMARY KEY,        -- vault 相对路径，正斜杠
  sha256 TEXT NOT NULL,         -- 内容哈希：变更检测 + 幂等
  mtime INTEGER NOT NULL,
  title TEXT, folder TEXT,      -- folder → room
  frontmatter TEXT, size INTEGER, updated_at INTEGER
);
CREATE TABLE note_chunks (
  path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading_path TEXT,            -- '部署 > 回滚'，定位用
  line_start INTEGER, line_end INTEGER,
  content TEXT NOT NULL, hash TEXT,
  PRIMARY KEY (path, chunk_index)
);
CREATE VIRTUAL TABLE note_fts USING fts5(content, content='note_chunks', content_rowid='rowid', tokenize='trigram');
CREATE VIRTUAL TABLE note_vec USING vec0(embedding float[384]);
CREATE TABLE note_index_meta (key TEXT PRIMARY KEY, value TEXT);  -- last_scan_at / model / dim
```

`note_chunks` 用的是普通 rowid 表（复合主键但非 `WITHOUT ROWID`），FTS5 外部内容表可直接引用。

### 11.4 自动索引链路（三条触发 + 一条手动）

| 触发 | 时机 | 做什么 | 成本 |
| --- | --- | --- | --- |
| T0 启动对账 | 插件 ready 后延迟 20s | 遍历 vault，`stat` 比对 `mtime`，只处理 `sha256` 变化的篇 | 1000 篇约 1–2s 的 stat |
| T1 定时增量 | 默认每 300s（`obsidian.scanIntervalMs`，0 关闭） | 同 T0，只处理变化；顺带清理已删除文件的行 | 同上，忽略无变化 |
| T2 写入即更新 | M1 的写工具执行后 | 只重建该篇 | 单篇毫秒级 |
| T3 手动重建 | `obsidian_reindex` | 全量或按路径 | 全量几分钟（首次） |

**不做 `fs.watch`**：Obsidian 自己会频繁 touch 文件（同步、索引、插件），Windows 上还有重命名风暴；监听换来的实时性，用 300s 扫描就能覆盖。这是从 mnemos 的 hook 事故里学到的取舍——**触发点越少，系统越稳**。

**新鲜度要可见**：`obsidian_status` 返回 `last_scan_at / notes / chunks / pending / index_age_seconds`；`obsidian_search` 结果里也带 `index_age_seconds`，超过 `2 × scanInterval` 时提示 stale。否则 agent 会拿旧索引当真相。

### 11.5 D 的落地方式：只投影枢纽笔记

D 的诉求是「能从笔记跳到项目」，不是「把几百篇笔记塞进图」。所以：

- 宫殿图里固定出现一个 **`obsidian` wing 节点**，rooms = 顶层文件夹（折叠展示，不逐篇展开）；
- **只有枢纽笔记成为图节点**：被其它笔记 wikilink 引用 ≥2 次，或 frontmatter 写了 `hub: true`；
- `memory_tunnel` 允许「`obsidian` 的某个 room ↔ 某个记忆项目」沿共享 topic 钻取，但同样只对枢纽笔记生效。

这样：稀疏性保住（图里通常几十个节点，不是几百），而「从笔记跳到项目」的路径存在。

### 11.6 跨域融合：按排名，不按分数

记忆域用英文 `all-MiniLM-L6-v2`，笔记域建议用多语模型——**两个向量空间的分数不可比**（余弦 0.7 在不同模型里含义不同）。所以 `scope:'all'` 时用 **RRF（按名次融合，k=60）**，不用分数加权。

配置项：`obsidian.embeddingModel: 'inherit' | 'multilingual'`。选 `inherit` 则两域同空间、可直接比分数；选 `multilingual` 则笔记域独立空间、跨域走 RRF。

### 11.7 与 §4 估工的差异

| 阶段 | 原估 | 现估 | 增量原因 |
| --- | --- | --- | --- |
| M0 只读索引 | 1.5–2 人日 | **2–2.5 人日** | 多了行号/标题路径采集、自动扫描三条触发、staleness 展示 |
| M1 写 | 1 人日 | 1 人日 | 不变（写后单篇重建已并入 T2） |
| M2 可见性 | 1–2 人日 | 1.5–2.5 人日 | 多了枢纽识别与折叠投影 |

### 11.8 仍需你拍的四件事

1. **图投影范围**：只投影枢纽笔记（推荐）／全部笔记／完全不进图。
2. **索引触发**：定时扫描 300s + 启动对账（推荐）／再加 `fs.watch` 实时／只手动。
3. **中文嵌入**：笔记域换多语模型（需下载约 120MB，跨域走 RRF，推荐）／先只上 trigram FTS（零下载，纯关键字）／继承现有英文模型（不推荐，中文等于随机）。
4. **M1 写**：这轮做／先只读跑一周再说（推荐）。

---

## 12. 能不能接「额外的向量化模型 API」

能，但先要把「中文搜不准」拆成三件事，因为只有第一件是模型问题：

| 症状 | 根因 | 换 API 能治吗 |
| --- | --- | --- |
| 语义搜不到（搜「怎么回滚」找不到讲回滚的段） | 嵌入模型是英文的 `all-MiniLM-L6-v2` | **能** |
| 关键字搜不到（搜「回滚」找不到「回滚流程」） | FTS5 `unicode61` 不切中文 | 不能，要 trigram |
| 房间全挤在 `general` | `normalizeTopicLabel` 把 CJK 删光 | 不能，要绕归一化 |

### 12.1 三条路

| 方案 | 质量 | 成本 | 隐私 | 新接缝 |
| --- | --- | --- | --- | --- |
| **L1 换本地多语模型**（`Xenova/paraphrase-multilingual-MiniLM-L12-v2`，仍 384 维） | 中上 | 下载约 120MB，零调用费 | 不出本机 | 无，改配置 + 重建 |
| **L2 接外部嵌入 API**（BGE-M3 / Qwen3-Embedding / text-embedding-3 等） | 最好 | 首次全量小额费用，之后增量几乎为零 | **笔记正文出本机** | 需要 provider 接缝 |
| **L3 混合**：记忆域留本地，笔记域走 API | 笔记最好、记忆不变 | 同 L2 | 同上 | 同 L2 |

**推荐顺序：L1 先跑评测 → 不够再上 L2/L3。**

理由：L1 零网络、零费用、维度不变（384），改一个配置项加一次重建就能验证「中文语义到底够不够」。如果 L1 够用，API 这一层永远不用建。

### 12.2 真上 API 的话，接缝这么长

```js
// src/store/embedding_provider.mjs
export interface EmbeddingProvider {
  id: string           // 'local:all-MiniLM-L6-v2' | 'http:bge-m3'
  dim: number
  embedBatch(texts: string[]): Promise<Float32Array[]>
}
```

- **为什么是 `embedBatch` 而不是 `embed`**：现有 `EmbeddingService.embed(text)` 一次一条（`embeddings.mjs:175`）。1000 篇笔记约 3000 块，按条调 API 就是 3000 次 HTTP；批量接口决定重建能不能在一分钟内跑完。
- **维度解耦**：因为笔记走独立 `note_vec` 表（§11），它的维度可以不是 384；`vec_memories` 一行不用动。API 返回 1024/1536 维都行，只要 `note_index_meta` 记住 `modelId + dim`，换模型自动触发重建。
- **必须 L2 归一化**：`distanceToSimilarity = 1 - d²/2`（`chunk.mjs:44`）**假设向量已归一化**。多数 API 返回未归一化向量，适配层不做归一化，分数会系统性偏移且不报错——最容易踩、最难发现的坑。
- **降级沿用现有模式**：拿不到向量就写零向量 + `embedded=0`，检索回退 FTS 并标注 `mode:'keyword'`（README 既有行为）；API 挂了不能整个搜索不可用。
- **密钥不进 `config.json`**：面板会把配置回显出来。用环境变量（配置里只存变量名，如 `embeddingApiKeyEnv: 'MNEMOS_EMBED_KEY'`）或宿主凭据服务。
- **跨域融合**：两个模型空间的分数不可比，`scope:'all'` 走 RRF（§11.6）。

### 12.3 费用与延迟（粗算）

- 1000 篇 × 平均 3 块 × 每块约 400 token ≈ **120 万 token** 首次全量；
- 按主流嵌入 API 单价，首次全量成本在**几分到几毛钱**量级，之后每天增量通常几十条；
- 延迟取决于批大小与并发：批 32、并发 4，3000 块大约几分钟，可放进 T0 启动对账后台跑；
- 真正的成本不是钱，是**每次重建都要重新联网**——所以 API 方案要给「重建中断可续」的进度记录，不能一失败全量重来。

### 12.4 结论

- **能帮，但它治的是语义那一半**；关键字与 topic 两个问题仍要在代码里解决（trigram + 绕开 CJK 归一化）。
- **先 L1 再 L2**：用本地多语模型跑真实 vault 的小样本评测（50 条已知答案的查询看 R@5），数据说话再决定要不要引入 API。
- 接缝可以**现在就预留**：`EmbeddingProvider` 只有三个成员，local 实现包一层现有 `EmbeddingService`，约 0.5 人日；这样 L1→L2 只是换实现，不返工。

### 12.5 决策点变化

原 §11.8 第 3 条拆成两条：

- **3a**：M0 用本地多语模型（L1，推荐）／先只上 trigram FTS（零下载）／继承英文模型（不推荐）。
- **3b**：M0 就预留 `EmbeddingProvider` 接缝（推荐，0.5 人日）／等评测完再说。
