# MemPalace × Obsidian：开源项目调查与接入路线

> 调查时间：2026-11-10（Asia/Shanghai）
> 问题：上次提到的「把 MemPalace 原生接进 Obsidian」的 GitHub 项目到底是哪个？它做了什么？我们要不要/怎么做？
> 状态：纯文档，未改任何代码、配置、依赖。星数、推送时间均为调查时刻快照。

---

## 0. 先说结论

1. **不存在「MemPalace 官方 Obsidian 插件」**。MemPalace 官方组织下只有 `mempalace` 与 `mempalace-triage` 两个仓库，没有 Obsidian 相关项目。
2. **「原生接入」在公开生态里仍是空白**。`topic:mempalace` 共 77 个仓库，描述里同时出现 Obsidian 的只有 6 个；逐个看过文件树的 5 个里**没有一个是 Obsidian 插件**（无 `manifest.json`），第 6 个（jarvis-os）是独立 OS。`minhlucvan/mempalace-obsidian` 名字最像，但是空仓。
3. **最接近你想法的、可考的四个项目**：
   - `raman325/mempalace-explore`（0★）——唯一**直接读宫殿**的项目：wings/rooms/drawers/tunnels + 知识图谱，Obsidian 风格图，但形态是**独立 Web 应用**，不是插件。
   - `mnemos-dev/mnemos`（4★）——把「记忆宫殿」做成 **Obsidian 原生 markdown**，roadmap 里明确排了 Obsidian 插件（未开工）。
   - `the-essential/reliquery`（5★）——反方向：**Obsidian vault 当真源**，MemPalace 只做索引/检索。
   - `minhlucvan/mempalace-obsidian`（0★）——名字最像，但**空仓库、0 提交**，无法构成「项目」。
4. 对我们（`plugins/dsh-mempalace`）而言，**最省的做法是 A 路线：只读侧边栏插件直连后端 API**；当前缺口不是 UI，而是「第三方客户端读通道」——面板 API 有 DSH 会话鉴权、无 CORS，Obsidian 插件拿不到数据。这是本报告最可执行的一条结论（§7）。

---

## 1. 调查口径

### 1.1 什么算「原生接入 Obsidian」

「原生」有三种强度，本报告分开计：

| 档位 | 定义 | 判据 |
| --- | --- | --- |
| **L1 插件内** | 在 Obsidian 内以社区插件加载，有侧边栏/命令/视图 | 仓库含 `manifest.json`，或列入社区插件目录 |
| **L2 vault 内** | 数据以 markdown 落在 vault（可被 Obsidian 原生搜索/图谱/双链消费） | 仓库有明确的 vault 目录约定 |
| **L3 外部 UI** | 浏览器/桌面独立界面，只是长得像 Obsidian 图谱 | Web/Electron 应用，不读 vault |

用户原话「原生接入」最接近 **L1**；但生态里实际存在的多是 **L2 或 L3**，这一点是后面所有判断的前提。

### 1.2 方法与限制

- `web_search` 在本机**不可用**（无 `DEEPSEEK_API_KEY`），改用：GitHub REST 搜索 API（匿名）、`ungh.cc` 元数据、`raw.githubusercontent.com` 原文、`r.jina.ai` 渲染 GitHub 页面、DuckDuckGo HTML 端点。
- GitHub API 匿名限流，部分搜索结果被工具截断，因此**计数（如 77、13、6）是抓取时刻的快照**，不是永久事实。
- `minhlucvan/mempalace-obsidian` 经 `/commits` 接口返回 `409 Git Repository is empty`，可判定为空仓。
- 未逐行读三个项目的全部源码：mnemos 只读了 README/ROADMAP/STATUS 与文件树；reliquery 读了 README/CHANGELOG/文件树；mempalace-explore 读了 README/文件树。涉及内部实现的说法已在 §9 标注「未读源码」。

---

## 2. 生态全景（截至 2026-11-10）

### 2.1 检索命中

| 查询 | 命中 | 说明 |
| --- | --- | --- |
| `topic:mempalace` | **77** | MemPalace 生态主集合 |
| `topic:mempalace obsidian in:description` | **6** | 真正把 Obsidian 写进定位的项目 |
| `mempalace obsidian`（全字段） | 13 | 含 README 提及，噪声大 |
| `obsidian in:name mempalace` | **1** | 即空仓 `minhlucvan/mempalace-obsidian` |
| `"memory palace" obsidian in:description` | 8 | 多为 3D 笔记可视化，与 MemPalace 无关 |
| `orgs/MemPalace/repos` | **2** | `mempalace`、`mempalace-triage`，无 Obsidian 项目 |

### 2.2 全景表

| 项目 | 形态 | 星 | 许可 | 最近推送 | 与「MemPalace 原生接入 Obsidian」的关系 |
| --- | --- | --- | --- | --- | --- |
| [MemPalace/mempalace](https://github.com/MemPalace/mempalace) | Python CLI + MCP + Chroma/SQLite | — | MIT | 活跃 | 上游本体；存储不在 markdown 里，没有 Obsidian 集成 |
| [raman325/mempalace-explore](https://github.com/raman325/mempalace-explore) | FastAPI + sigma.js Web | 0 | Apache-2.0 | 2026-09-01 | **L3**，唯一直接读宫殿并画 Obsidian 风格图的项目 |
| [mnemos-dev/mnemos](https://github.com/mnemos-dev/mnemos) | Python CLI + MCP + skills | 4 | MIT | 2026-05-01 | **L2**，记忆以 markdown 落在 vault；插件在 roadmap 未开工 |
| [the-essential/reliquery](https://github.com/the-essential/reliquery) | Claude skills（纯 markdown） | 5 | MIT | 2026-05-21 | **L2 反向**，vault 为真源、MemPalace 为索引 |
| [letsloose501/sqs-agent-memory](https://github.com/letsloose501/sqs-agent-memory) | Claude Code plugin + vault 模板 | 2 | 未核实（有 LICENSE） | 2026-11-03 | L2 反向，同 reliquery 思路，是目前最「工程化」的一个 |
| [HR-909/Compiled-Memory-Architecture](https://github.com/HR-909/Compiled-Memory-Architecture) | Claude 命令 + wiki 脚手架 | 2 | 未核实 | 2026-04-18 | 与 memoriki 同类：`.claude/commands` + `mempalace.yaml`，无插件 |
| [minhlucvan/mempalace-obsidian](https://github.com/minhlucvan/mempalace-obsidian) | 空仓 | 0 | — | 从未 | 名字最像，但 0 提交 |
| [porokka/jarvis-os](https://github.com/porokka/jarvis-os) | 个人 AI OS | 26 | MIT | 2026-11-05 | 同时用 MemPalace 与 vault，非通用集成 |
| [AyanbekDos/memoriki](https://github.com/AyanbekDos/memoriki) | wiki + mempalace 脚手架 | 124 | 未核实（有 LICENSE） | 2026-04-14 | 只有 `wiki/` 骨架与 `mempalace.yaml`，无代码 |

> 「星少」这条线索反而帮不上忙：三个最相关的项目是 0/4/5 星，都不是知名项目。**你上次看到的很可能就是这三个之一**，按记忆点对号入座见 §2.3。

### 2.3 按记忆点对号入座

- 记得「**名字里就带 obsidian**」→ `minhlucvan/mempalace-obsidian`。空仓，没有可调查的内容，基本可排除。
- 记得「**把宫殿画成一张图、能点开抽屉**」→ `mempalace-explore`（0★）。它是唯一读真实宫殿数据的项目。
- 记得「**Obsidian 里直接长出一个记忆宫殿**」→ `mnemos`（4★）。它的自我定位就是 “Obsidian-native, markdown-first”。
- 记得「**用 Obsidian 笔记库喂 MemPalace**」→ `reliquery`（5★）或 `sqs-agent-memory`（2★）。

---

## 3. 候选一：`mempalace-explore` —— 把宫殿搬成图谱（L3）

**它是什么**：一个只读的 Web 浏览器，通过 MCP 连到运行中的 MemPalace，把「wings → rooms → drawers + 跨翼 tunnel + 知识图谱」渲染成可交互 WebGL 图（sigma.js）。README 原话是 “Obsidian-graph-style”。

**架构**（README + 文件树，未读源码）：

```
浏览器 (sigma.js) ── HTTP ──▶ FastAPI ── MCP (streamable HTTP) ──▶ mempalace serve (v3.8+)
                                  └── 快照缓存（内存 + 磁盘，原子替换）
```

- 环境变量：`MEMPALACE_URL`、`MEMPALACE_TOKEN`（`mempalace serve --token` 的 bearer）、`PORT`、`CACHE_DIR`、`REFRESH_INTERVAL`。
- API：`GET /api/graph`、`GET /api/drawer/{id}`、`GET /api/search?q=`、`POST /api/refresh`、`GET /healthz`。
- 有 Dockerfile / compose 示例 / CI / pytest；但**创建与最后推送是同一天**（2026-09-01），属于一次性上传的完整小项目。

**功能**：

- Structure 模式：翼 + 房间 + 隧道；点房间就地展开抽屉；「all drawers」星场。
- KG 模式：实体为点、三元组为边，过期事实划线；实体面板反链到提及它的抽屉。
- 搜索：先过滤节点，Enter 走宫殿自己的语义搜索并高亮命中抽屉。
- 翼级显隐 + “filed since” 时间滑块；宫殿不可达时显示陈旧快照与横幅。

**与「原生」的距离**：

- 不是 Obsidian 插件，**不读 vault**；它读的是 MemPalace 的 MCP 接口。
- 但对「在 Obsidian 里看宫殿」这件事，它已经解决了 80% 的信息架构：图快照的形状、抽屉详情、搜索联动、陈旧缓存策略。
- 它的 `/api/graph` 与本项目 `GET /dsh-mempalace/api/graph/palace` 的语义几乎一一对应，**可以直接借来当插件的数据模型**。

**可复用点**：图快照 + 抽屉详情 + 搜索高亮三件套；「后端不可达时降级到快照」的产品决策。

---

## 4. 候选二：`reliquery` —— vault 当真源（L2，反向）

**它是什么**：一套 **Claude 技能**（6 个 `SKILL.md` + 2 个 references + 一个 `.plugin` 打包，纯 markdown），把「结构化 markdown 设定集」变成 Claude 的长期记忆。名字是 Relic + Query。

**架构**：

```
原始内容 → [Chronicle] → vault 里的 relics(.md + YAML frontmatter)
                              ↓ [Memorize]
                    mempalace mine → drawers（向量检索）
                              ↓ [Cartograph]
                    MemPalace 知识图谱（SQLite 三元组）
```

- 安装：`pip install mempalace` → `claude mcp add mempalace -- python -m mempalace.mcp_server` → 装 `.plugin` → `mempalace init <vault>` → 按文件夹 `mempalace mine ... --wing <name>`。
- 五个技能：Chronicle（收稿）、Memorize（索引）、Cartograph（关系图谱）、Forget（受控删除）、Study（一条龙）。
- 每次会话的「记忆协议」：`mempalace_status` 看宫殿布局 → 识别实体 → 检索散文与结构化状态 → 冲突时「图谱赢事实、散文赢语气」。
- Obsidian 是**推荐但不必需**的编辑器；vault 就是文件夹。

**成熟度**：v1.0.0 发布于 2026-05-05，之后无推送（约 6 个月）。但没有代码，维护面几乎为零——它的「代码」就是提示词。

**同路线的工程化变体**：`letsloose501/sqs-agent-memory`（2★，2026-09-26 创建、2026-11-03 仍在推送）。同样是「Obsidian vault 由 MemPalace 索引」，但它多了 `.claude-plugin/`、`hooks/hooks.json`、`templates/vault/*`，以及 `scripts/vault_index.py`、`skills/notes/scripts/mempalace_doctor.py` 这类运维脚本——可以说是 reliquery 的「可安装、有 CI、有发布流程」版本。它证明这条路线在工程上能走通，也再次说明：**做这条路线的人，选的是「Claude 插件」，不是「Obsidian 插件」**。

**它解决的真正问题**：不是「在 Obsidian 里看 palace」，而是「**别让 palace 成为第二份真相**」。作者明确说 vault 是 “source of truth for all authored content”，MemPalace 只是可重建的索引。这个取舍值得记住。

**它的局限（对我们）**：

- 全部价值绑在 Claude Code / Claude Desktop + MemPalace Python MCP 上；与 DSH 无关。
- 索引是**手动/半自动**的（`study this`），不是持续同步。
- 写入方向与我们的 ActMem→MemPalace 归档流**相反**：我们是从 ActMem 往 palace 单向写入，vault 没有参与。

---

## 5. 候选三：`mnemos` —— 把宫殿做成 Obsidian 原生 markdown（L2）

**它是什么**：Claude Code 的长期记忆，存储是 **vault 里的纯 markdown**，检索是 MCP + 嵌入索引（ChromaDB 或 sqlite-vec，可切换）。自我定位 “Obsidian-native, markdown-first”。

**架构**：

```
~/.claude/projects/*.jsonl
      │  refine（Claude Code skill，用订阅额度，不调 API）
      ▼
<vault>/Sessions/YYYY-MM-DD-slug.md   ← 一次会话一篇，含 Decisions/Problems/Next steps + [[wikilinks]]
<vault>/_identity/L0-identity.md      ← 跨项目用户画像
      │  SessionStart hook → briefing skill 沿 wikilink 走图
      ▼
Claude Code 首轮上下文
```

- MCP 工具 5 个：`mnemos_wake_up` / `search` / `recall` / `graph` / `timeline`。
- 文件监听：v0.x 有（watchdog），v1.0 已随原子范式一起删除，只剩配置字段；**语义索引不再自动更新**，只能手动 `mnemos reindex` 全量重建（详见深挖报告 §8）。
- 有 LongMemEval 基准；作者称 ChromaDB 与 sqlite-vec 在 2026-04-17 的对齐测试中 R@5 都是 0.90——但这是 v0.x 原子范式的数，v1.0 新范式的基准在 ROADMAP v1.3.0 里仍是 `⏸`。

**关键历史（也是最有价值的一课）**：v0.x 就是「原子宫殿」路线——把对话切成 ~600 个记忆碎片，按 wings/rooms 写进 `<vault>/Mnemos/wings/`，再索引。到 v1.0 作者把这条路线**否掉了**，理由写在 README 里：

1. 碎片化之后向量召回分布收敛（0.014–0.017），精度提升没有兑现；
2. LLM 更擅长从完整叙述里做总结，而不是把碎片再拼回去；
3. 600 节点图「是海报，不是导航」。

于是 v1.0 改成「一次会话 = 一篇 note」，用 wikilink 连成稀疏图。旧 `Mnemos/wings/` 文件保留但不再读取。

**Obsidian 插件**：两处 roadmap 都列了、都没开工——README 的 “What's next” 写 v1.3「native sidebar：memory browser / timeline / briefing inbox」；ROADMAP 的 v0.6.0 §6.2 写「TypeScript, in-vault UI, graph view, Obsidian canvas integration，~1–2 天」。截至调查时**没有 `manifest.json`、没有插件代码**。

**它是不是你要找的那个？** 如果记忆点是「Obsidian 里长出一个记忆宫殿、而且有人已经在做原生插件」——是它，但插件只是计划。如果记忆点是「把 MemPalace 本体的数据接进 Obsidian」——不是它，它压根不读 MemPalace 的库。

> 深挖：源码级调研（架构链路、笔记 schema、v0.x→v1.0 转弯的量化复盘、八条硬伤、可借鉴清单）见 [`mnemos-deep-dive.md`](mnemos-deep-dive.md)。

---

## 6. 为什么「原生」这么稀缺

不是没人想，是四道结构性摩擦：

1. **存储栈不同**。上游 MemPalace 是 Python + ChromaDB + SQLite，抽屉正文在向量库里，不在 markdown 里。Obsidian 插件是 Electron/TS，要「读宫殿」必须隔着 MCP 或 HTTP，不能像读笔记那样直接读文件。
2. **双真源问题**。只要把 palace 数据也写成 markdown，就有两份真相：vault 里编辑和数据库里更新谁赢？reliquery 的答案是「vault 赢、索引可重建」；mnemos 的答案是「vault 就是库」；mempalace-explore 干脆不落盘（只读）。
3. **Obsidian 原生 Graph View 没有节点注入 API**。想在原生图谱里加「宫殿节点」做不到；所有做图谱的插件都是自绘视图。这意味着插件必须自带一套图渲染。
4. **MCP 是 agent 协议，不是 UI 协议**。MCP 适合「模型调用工具」，不适合「渲染 2000 个节点的交互图」；所以要么加一层 HTTP 快照 API（mempalace-explore 的做法），要么在插件里跑一个本地代理。

再叠加一层现实：这类项目多是「一个人 + 一个周末」的产物（mempalace-explore 创建与推送同日；mempalace-obsidian 建了空仓），**没有维护承诺**。引用它们的设计，比依赖它们的代码更划算。

---

## 7. 三种接入架构（放到我们身上）

### 7.1 我们的现状

`plugins/dsh-mempalace` 不是上游的移植版数据层，而是 **JS + SQLite 的实现**：`better-sqlite3` + `sqlite-vec`，FTS5 回退，知识图谱带版本账本。记忆正文的写者只有 ActMem（经 `/internal/archive`，组件 token）；记忆页是只读投影，知识图谱另有显式写入入口（工具与面板）。

已有 HTTP 面（`src/http.mjs`，前缀 `/dsh-mempalace/api`）：

- 读：`/status` `/recent-memory` `/memories`（分页/筛选/`q`）`/rooms` `/taxonomy` `/graph/palace` `/graph/tunnel` `/knowledge/*` `/diary` `/export`
- 写：`/knowledge/entity` `/knowledge/triple` `/knowledge/invalidate` `/config` `/import` `/reindex` 等

**两个关键约束（决定插件能不能直连）**：

1. **鉴权**：`http.mjs:85-92` 用 `ctx.get('connection').requestRejection(req)` 校验 DSH 会话；**外部客户端（Obsidian）没有这个会话**，会被 403。
2. **CORS**：响应头只有 `content-type` / `cache-control`，没有 `Access-Control-Allow-Origin`；非 GET 还会校验 `Origin` 与 `Host` 同源（`http.mjs:80-84`）。浏览器 `fetch` 读不到响应；**必须用 Obsidian 的 `requestUrl`**（绕过 CORS 的官方 API），或者由后端放行。

所以「插件直连」不是写个 UI 就行，**先要有一条给本机第三方客户端的只读通道**。

### 7.2 三条路线

```
A. 插件直连（L1）
   Obsidian plugin (TS) ──requestUrl/HTTP──▶ dsh-mempalace API ──▶ SQLite
   vault 不落数据；插件只读，写入仍走 DSH 面板/工具

B. markdown 投影（L2，单向）
   dsh-mempalace ──export──▶ <vault>/Palace/*.md（frontmatter 带 mem_id）
   Obsidian 原生搜索/双链/图谱；编辑不回流

C. vault 真源（L2，反向）
   vault/*.md ──mine/归档──▶ dsh-mempalace
   Obsidian 成为唯一的作者面；palace 只是索引
```

| 维度 | A 插件直连 | B markdown 投影 | C vault 真源 |
| --- | --- | --- | --- |
| 真源 | SQLite | SQLite | vault |
| 读 | 插件调 API | Obsidian 原生读 | Obsidian 原生读 |
| 写 | 经后端显式接口 | 不回流 | vault 编辑 → 重建索引 |
| 离线 | 后端必须在跑 | **可以离线** | 可以离线 |
| 实现成本 | 中（TS 插件 + 后端 token/CORS） | **低**（导出脚本 + 约定） | 高（要改写入链路与语义） |
| 与 ActMem 归档流 | **兼容**（只读旁路） | 兼容（只读快照） | **冲突**（方向相反、双写） |
| 主要风险 | 鉴权、端口漂移、图渲染自绘 | 数据陈旧、双份副本、双链断 | 退色/淘汰语义打架、两套写者 |

**落地证据**：A 的可行性由 mempalace-explore 证明（MCP/HTTP 快照 + 图 + 搜索即可撑起完整体验）；B 的成本上限由 mnemos 证明（纯 markdown 即可被 Obsidian 消费）；C 的代价由 reliquery 自己承认（vault 必须是真源，索引随时可重建——而我们做不到「随时重建」，因为 ActMem 的归档是单向流）。

---

## 8. 建议（最简方案 + 一个备选 + 依据）

**最简方案（推荐 A 的只读切片）**：给 `dsh-mempalace` 增加一条**本机只读 token 通道**（复用 `runtime.json` 的组件 token 模式，或新增 `obsidian` scope），让 Obsidian 插件用 `requestUrl` 调 4 个只读接口——`/search`、`/graph/palace`、`/graph/tunnel`、`/knowledge/query`——在侧边栏画出「搜索 + 宫殿图 + 实体卡」。不碰写入面，不引入 vault 镜像，不新增依赖；写入继续留在 DSH 面板与工具里。

**备选（B 的单向导出）**：在设置页加「导出到 vault」——把项目/话题/记忆导出成带 `mem_id` frontmatter 的 markdown，每天或手动一次。1 天内可完成，换来 Obsidian 原生搜索与双链，但它是快照，不能交互查询，且要接受两份数据。

**依据**：A 复用已有 20+ 路由与 SQLite 索引，新增的只有鉴权开口和渲染层，是「最小连贯系统」；B 虽然更便宜，但解决不了「问一句、看结果」的核心诉求，只能算附属能力；C 与我们「ActMem 单向归档、MemPalace 只读」的既定语义直接冲突，不应为 Obsidian 破例。代价明确：A 的图要自绘，且必须先做安全开口（本机 token + 只允许 loopback），这两项无法省。

**建议的最小里程碑**（估算，未验证）：

| 里程碑 | 内容 | 估算 |
| --- | --- | --- |
| M0 | 只读 token 通道 + `/search` 打通（Obsidian 命令面板可搜） | 1–2 人日 |
| M1 | 宫殿图 + 隧道下钻（自绘 SVG/Canvas，仿面板「宫殿图」页） | 2–3 人日 |
| M2 | 实体卡 + 时间线（`knowledge/*` 只读） | 1–2 人日 |
| 以后 | 打开 drawer 原文、跳回 DSH 面板、真实双向（不做） | — |

验收口径（M0）：Obsidian 里执行命令 → 输入关键词 → 返回 top-5（含 `project`/`topic`/`similarity`）→ 点击可看正文片段；未启动 DSH 时给出明确错误而不是空白；非本机请求一律 403。

---

## 9. 核实状态

| 结论 | 证据 | 状态 |
| --- | --- | --- |
| 官方无 Obsidian 项目 | `orgs/MemPalace/repos` 返回 2 个仓库 | 已核实 |
| `mempalace-obsidian` 为空仓 | `/commits` 返回 409 `Git Repository is empty` | 已核实 |
| 三个候选的星数/推送时间 | `ungh.cc/repos/<owner>/<repo>` | 已核实（快照） |
| mnemos / reliquery 为 MIT | 各自 README 的 License 段 | 已核实（文档） |
| mempalace-explore 读 MCP、只读、API 形状 | 其 README | 已核实（文档） |
| reliquery 是技能而非代码 | 文件树只有 6 个 `SKILL.md` + 2 个 references + 示例 vault + `.plugin` | 已核实 |
| 6 个 Obsidian 相关仓库都不是 Obsidian 插件 | 文件树：mnemos / reliquery / mempalace-explore / sqs / HR-909 无 `manifest.json`；jarvis-os 按 README 判断为 Next.js + systemd | 已核实 |
| mnemos 插件未开工 | README「What's next」与 ROADMAP §6.2 均为计划；无 `manifest.json` | 已核实 |
| mnemos v0.x 曾写 `Mnemos/wings/` | README「Migration v0.x → v1.0」 | 已核实（文档） |
| 我们的 API 有会话鉴权、无 CORS | `plugins/dsh-mempalace/src/http.mjs:80-92` | 已核实（源码） |
| Obsidian `requestUrl` 可绕 CORS | Obsidian 官方 API 文档存在该函数 | **未实测** |
| Obsidian Graph View 不可注入节点 | 社区经验，无官方 API | **未实测**（按经验陈述） |
| 上游 `mempalace serve` v3.8+ 与 token | mempalace-explore README | 未独立核实 |
| `sqs-agent-memory` / `memoriki` 许可 | 未抓 LICENSE | 未核实 |

---

## 10. 参考链接

- MemPalace 上游：<https://github.com/MemPalace/mempalace>
- mempalace-explore：<https://github.com/raman325/mempalace-explore>
- mnemos：<https://github.com/mnemos-dev/mnemos> ・路线图：<https://github.com/mnemos-dev/mnemos/blob/main/docs/ROADMAP.md>
- reliquery：<https://github.com/the-essential/reliquery>
- sqs-agent-memory：<https://github.com/letsloose501/sqs-agent-memory>
- 空仓：<https://github.com/minhlucvan/mempalace-obsidian>
- 旁证（同一模式的实践文章）：<https://www.georgesiosi.com/essays/infinite-ai-memory-mempalace-obsidian>
- 本项目相关：`plugins/dsh-mempalace/README.md`、`plugins/dsh-mempalace/src/http.mjs`、`plugins/dsh-mempalace/src/internal.mjs`
