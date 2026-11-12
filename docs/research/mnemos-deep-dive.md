# mnemos 深挖报告：把 Claude Code 会话做成 Obsidian 记忆宫殿

> 上游：<https://github.com/mnemos-dev/mnemos>（MIT）· PyPI `mnemos-dev`
> 调查对象：commit `c092d98`（2026-05-01，main 最新）· 克隆于 `.workspace/mnemos/`
> 调查时间：2026-11-11 · 方法是**读源码**，不是读 README

---

## 0. 先说结论

1. **它是一个产品，不是一个插件。** 仓库里没有任何 `manifest.json`、没有 TypeScript、没有 `main.js`；「Obsidian 原生」在这里的意思是**把记忆写成 Obsidian 能直接读的 markdown**，而不是长在 Obsidian 里。所谓 Obsidian 插件只是 ROADMAP v0.6.0 的一句 `[ ]`（约 1–2 天估工），从未开工。
2. **它和 MemPalace 是同一问题的相反答案。** v0.x 它就是 MemPalace 那套（wings/rooms/halls/drawers + ChromaDB + 图），作者自己跑了几个月后**判定这套路线失败并整条删掉**（~3000 行、~200 个测试），v1.0 改成「一次会话 = 一篇 note」。这个转弯的复盘（`HISTORY.md`）是这次调研里最有价值的东西，比代码本身值钱。
3. **它不读 MemPalace 的数据，接不进我们的宫殿。** 它没有 `mempalace` 依赖、没有导入器、没有 MCP 客户端；它只消费 `~/.claude/projects/*.jsonl`。想「把 MemPalace 接进 Obsidian」不能靠它。
4. **它证明了「vault 当真源」这条路走得通，也把这条路最容易踩的坑踩了一遍。** 我们如果要做同类事，抄它的数据模型和触发时机；不要抄它的代码（Python + Claude Code hooks + Windows 专用 hack）。
5. **健康度偏弱**：单人维护、385 个 commit 集中在 19 天内（2026-04-12 → 05-01），之后 6 个多月零提交；4 星、0 open issue、PyPI 近 30 天 24 次下载。当参考读没问题，当依赖用要慎重。

---

## 1. 调查口径

| 项 | 做法 |
| --- | --- |
| 代码 | `git clone` 到 `.workspace/mnemos/`，读 `mnemos/*.py` 全部 28 个模块的关键路径、52 个测试文件、CI、skills、prompts |
| 文档 | `README` / `STATUS` / `HISTORY` / `CHANGELOG` / `ROADMAP`（75KB）/ `docs/prompts/*` |
| 数值 | `git log`、`Get-ChildItem` 统计；GitHub API、PyPI stats API |
| **没做** | 没装依赖、没跑 `pytest`、没在 Windows 上实测 hook。文中「测试 496 个函数」是静态计数，不是跑通数；作者自述「556 pass」来自 `STATUS.md` |
| 版本口径 | 仓库 HEAD = v1.2.1；PyPI 上最新也是 1.2.1（`STATUS.md` 里「Stable PyPI: v0.3.3」是过期行） |

---

## 2. 它到底是什么

一句话：**给 Claude Code 装长期记忆的 Python 工具**——把 `~/.claude/projects/*.jsonl` 里的历史会话，用「用户自己的 Claude 订阅额度」精炼成 markdown 会话笔记，存进 Obsidian vault，再通过 MCP 工具和 SessionStart 简报喂回给 Claude。

三件事同时成立，缺一不可：
- **存储**：vault 里的 `.md` 是唯一真源，向量库只是可重建索引；
- **精炼**：不自己调 LLM API，而是 spawn `claude --print` 跑自己的 skill（省钱，但把产品焊死在 Claude Code 上）；
- **注入**：SessionEnd 触发精炼、SessionStart 注入简报。

**与 MemPalace 的关系**：哲学对立。README/CHANGELOG 明确把 MemPalace 当对标（「Match MemPalace's 96.6% recall without API calls」），v0.x 照抄了宫殿分层，v1.0 反过来打了它一枪——「small chunks don't beat narrative for conversational memory」。

**与我们的关系**：不是桥。它既不读 `dsh-mempalace` 的库，也不暴露「导入外部记忆」的入口。它回答的是「AI 该记住什么、以什么粒度记」，不是「怎么把已有宫殿接到编辑器里」。

---

## 3. 运行链路

```
~/.claude/projects/<slug>/<uuid>.jsonl
   │
   │ ① SessionEnd hook（settings.json，5s 超时，<100ms 返回）
   ▼
detached worker（Windows: CREATE_BREAKAWAY_FROM_JOB；POSIX: start_new_session）
   │
   ├─ ② refine：claude --print "/mnemos-refine-transcripts <jsonl>"
   │     └─ 写 <vault>/Sessions/YYYY-MM-DD-<proj>-<topic>.md
   ├─ ③ brief：claude --print "/mnemos-briefing <cwd>" → .mnemos-briefings/<cwd-slug>.md
   └─ ④ identity：满足阈值时 claude --print 增量刷新 _identity/L0-identity.md
   │
   │ ⑤ SessionStart hook：读缓存简报 → 注入首轮上下文（或在 readiness 不足时静默）
   ▼
Claude Code 首轮 prompt
```

- **兜底**：SessionStart 还有一条同步 fallback，处理 X-close 中途、kill -9 等 SessionEnd 漏掉的场景；一次最多补 3 个 JSONL（`SUB_B2_PENDING_CAP = 3`）。
- **MCP 工具 5 个**：`mnemos_wake_up` / `mnemos_search` / `mnemos_recall` / `mnemos_graph` / `mnemos_timeline`。
- **索引后端 2 个**：ChromaDB（默认）或 sqlite-vec，用 `mnemos reindex --backend X` 切换。
- **并发控制**：`claim_jsonl_for_refine` 用 per-JSONL `filelock`（`<ledger>/locks/<stem>.lock`）+ ledger（`路径\tOK|SKIP\t时间`）双保险，解决 v1.1 真实踩到的「两个 worker 同时精炼同一 JSONL，产生重复 Session 或互相覆盖」数据丢失。

---

## 4. 数据模型

### 4.1 一篇 Session 笔记（精炼产物）

```markdown
---
date: 2026-04-28
project: Mnemos            # 等价于 wing
cwd: C:\Projeler\mnemos     # 绝对路径，用于 cwd 归属
tags: [session-log, proj/mnemos, tool/chromadb, person/tugra, skill/mnemos-catch-up]
duration: ~2h
---

# 2026-04-28 — 标题（跟随会话主语言）

## Summary / ## Decisions / ## Done / ## Next Steps / ## Problems / ## See Also
```

关键约束（写死在 `docs/prompts/refine-transcripts.md`）：
- 文件名 `YYYY-MM-DD-<project-slug>-<topic-slug>.md`，≤60 字符，土耳其字符转 ASCII；
- **标题跟随正文语言**（TR 会话就写 `## Özet`），下游解析器双语都吃；
- wikilink 只给「会重复出现的实体」，一次性文件名不链；
- 空章节直接删掉，不留空壳。

### 4.2 身份层（L0）

`<vault>/_identity/L0-identity.md`：Working Style（≤8 条）/ Technical Preferences（≤12，带 `proj/<x>` 前缀）/ Rejected Approaches（≤10）/ Active Projects（≤8）。

- `bootstrap`：一次 `claude --print`，输入「全部 Session（≤150K token，超了取最近 100 + 基线抽样）」；
- `refresh`：每 10 个新 Session 或 7 天触发一次增量；
- 阈值：`bootstrap_threshold_pct: 25`（精炼覆盖率不到 25% 不给 bootstrap）。

### 4.3 简报（SessionStart 注入物）

`skills/mnemos-briefing/prompt.md` 里的预算表（**注意：HISTORY 说硬上限 15K，prompt 里写的是 25K，代码里两者都没有强制校验**）：

| 层 | 预算 | 优先级 |
| --- | --- | --- |
| Anchor（上一份简报） | 4K | 固定 |
| Identity | 3K | 固定 |
| 2A 本项目全部 decisions | 6K | P1 |
| 2B 最近 5 篇完整 | 8K | P1 |
| 跨上下文（wikilink 邻居） | 4K | P2 |
| **硬上限** | **25K** | |

`readiness_gate`：cwd 的历史精炼覆盖率 `< 60%` 就不注入（「宁可不给，也不给一份会误导的简报」）。

---

## 5. 工程事实

| 项 | 数值 |
| --- | --- |
| Python | 17,100 行 / 90 文件；核心包 `mnemos/` 7,809 行 / 28 模块 |
| 测试 | 52 个文件、496 个 `def test_`（作者自述 556 pass） |
| 提交 | 385 个，2026-04-12 → 2026-05-01，**19 个活跃日**，峰值 04-26 单日 57 个 |
| 作者 | 1 人（Tugra Demirors / GYP Energy），另有 `kavunkarpuz-debug` 发版账号 |
| 依赖 | `chromadb>=1.5`、`sqlite-vec>=0.1.9`、`mcp>=1.0`、`pyyaml`、`filelock`、`watchdog`；可选 `anthropic`（未启用） |
| CI | GitHub Actions：ubuntu + windows × py3.10/3.12 矩阵；**一条 grep 硬规则**：`mnemos/` 与 `skills/` 里出现 `anthropic.Anthropic` 就 fail（保证「不花用户 API 钱」） |
| 发布 | v1.2.1（2026-05-01）PyPI + GitHub release；v1.1.0/v1.2.0 只打 tag 不上 PyPI |
| 社区 | 4★ / 2 fork / 0 open issue / 0 discussion；近 30 天 PyPI 下载 24 次 |

代码组织是「一个模块一件事」：`search.py`（后端）、`recall_briefing.py`（注入）、`session_end_hook.py`（触发）、`auto_refine.py`（调度 + ledger）、`refine_lock.py`（并发）、`identity.py`、`readiness.py`、`normalizer.py`（5 种聊天格式归一化）、`obsidian.py`（frontmatter）。没有服务层、没有插件系统——**刻意的小**，`HISTORY.md` 的原话是「the codebase fits in your head」。

---

## 6. 值得抄的六个决策

| # | 决策 | 为什么成立 | 代价 |
| --- | --- | --- | --- |
| 1 | vault 是唯一真源，向量库可随时重建 | 用户可读、可改、可删、可 git；换后端只需 `reindex` | 每次全量重建有成本；索引与真源的一致性要靠流程保证 |
| 2 | 触发放在 **SessionEnd** 而不是 SessionStart | SessionEnd 有明确的「输入结束」语义，不会撞上进行中的 transcript | 依赖宿主一定发这个事件；X-close/kill 必须有兜底 |
| 3 | 不调 LLM API，走用户已有订阅（`claude --print`） | 边际成本 0，用户敢开自动精炼 | 产品焊死在 Claude Code；换宿主就没了 |
| 4 | per-JSONL filelock + ledger 幂等 | 三个入口（SessionEnd / SessionStart / catchup）并发下不重复、不丢 | ledger 会脏，于是又需要 `refine-ledger --normalize` 这种修复 CLI |
| 5 | readiness gate「宁可不注入」 | 半成品简报会把 AI 的认知锚在错误历史上 | 新 cwd 前几次会话完全静默，用户以为是坏的 |
| 6 | 把失败的赌注写进 HISTORY | 后来者不用重付学费 | 没有技术代价，只有面子代价 |

第 6 条是我们最该学的：`HISTORY.md` 直说 v0.x 的原子宫殿「把 600 个节点做成了一张海报」，并给出三个可复现的量化信号（下节）。

---

## 7. v0.x → v1.0 的转弯（本次调研最有价值的部分）

### 7.1 旧范式：原子宫殿

v0.2 的完整形态：wings/rooms/halls/drawers 四层、172 个正则标记（87 EN + 85 TR）、72+ 房间模式、双 ChromaDB collection（raw + mined）、RRF 融合、SQLite 时序三元组图、文件监听自动同步。LongMemEval 上从 70% → **90% R@5**（chunk 3000→800、RRF ×3、加 source-path metadata 之后）。

`CHANGELOG 0.2.0` 还留着一张对标表：Recall@5 自身 70%（10 题）、**MemPalace 96.6%**、目标 95%+。

### 7.2 崩掉的四个信号（`HISTORY.md` 原数据）

1. **RRF 分数带塌缩**：k=60 时所有分数挤在 **0.014–0.017**，等于没有信号；
2. **LLM 用整篇会话比用碎片总结得好**：碎片喂进去输出发虚，整篇喂进去干净——碎片化在**伤害**下游质量；
3. **图没人走**：600 节点，人不去浏览，AI 也不会自己遍历；
4. **抽屉大量冗余**：663 个抽屉承载 ~860 个实体实例，**约一半**只是 `Mnemos` / `ProcureTrack` / `GYP` 这类 wing 名；全库真正「唯一实体」只有 40–60 个。

### 7.3 代价与残留

- 删掉 ~3000 行、~200 个测试；`legacy/atomic-paradigm` 分支和 `v0.4.0-archived` tag 留作化石；
- **但新范式没跑基准**：ROADMAP v1.3.0「Polish + LongMemEval benchmark（R@5 ≥ 93% 基线）」至今是 `⏸`。也就是说，「整篇比碎片好」目前只有**定性证据**，90% 这个数字仍然是旧范式打出来的；
- 残留包袱：`search.py` 还留着 `mined` collection、`index_drawer`、wing/room/hall 过滤参数；`obsidian.py` 还是「drawer 文件管理」的注释；`CLAUDE.md` 整篇仍在描述 v0.x 的 dual collection。

**这段历史对我们的直接启示**：我们的 `dsh-mempalace` 现在也在抽屉粒度上做召回。如果哪天要论证「该不该改成整篇」，mnemos 提供了**反面样本**（碎片化的分数带塌缩、实体冗余）和**方法论样本**（先量化再改架构，改完补基准）。

---

## 8. 硬伤与风险（按影响排序）

| 级别 | 问题 | 证据 | 影响 |
| --- | --- | --- | --- |
| **P0** | **语义索引不会自动更新** | 全仓只有 `reindex.py:95` 调 `index_raw_bulk`；SessionEnd worker 三步（refine/brief/identity）都不建索引；README 只把 `reindex` 描述成「换后端」 | 新会话写进 `Sessions/` 后，`mnemos_search` 查不到，直到用户手动 `mnemos reindex`。graph/timeline/briefing 走文件扫描所以是新的，唯独语义检索是旧的——**同一系统内两套新鲜度** |
| P1 | 检索粒度=整篇单向量 | `reindex` 对每个 `.md` 只生成 1 个 doc，无 chunk | 长会话被 all-MiniLM 的 256 token 窗口静默截断；frontmatter 也在正文里，向量更偏「元数据+摘要」而非全文 |
| P1 | `wing` / `room` / `hall` 过滤已是空过滤 | 索引 metadata 只有 `{path, type: "session"}`；过滤代码仍在（`search.py:379`） | 调用方传 wing 会得到空结果，且不报错 |
| P1 | Windows 钩子耦合 | `CREATE_BREAKAWAY_FROM_JOB`、5s 超时、`cmd.exe` 引号剥离、`_managed_by`/`_version` 兼容层 | 换成任何别的宿主（包括我们）都要重写这段；作者自己的 v0.3.7 六个 bug 全在这 |
| P2 | 单人 + 停更 6 个月 | 385 commits / 1 作者 / 最后提交 2026-05-01 | 没有社区接力，issue 区空也无从判断是「没问题」还是「没人用」 |
| P2 | 文档漂移 | `CLAUDE.md` 仍写原子范式；`STATUS.md` 仍写 PyPI v0.3.3；HISTORY 说简报 15K cap、prompt 写 25K；briefing prompt 兜底路径写死作者本机 `...OneDrive/Masaüstü/kasamd` | 照着文档用会踩坑；也说明「文档即产品」这件事它只做到了 HISTORY 那一层 |
| P2 | 单用户硬编码 | refine prompt 里的 wing 映射表是作者自己的 `C--Projeler-*` 目录表 | 新用户必须手改 prompt，这是「开箱即用」的缺口 |
| P2 | identity bootstrap 是一次巨型 `claude --print` | ≤150K token 输入、`sonnet`；失败只留 `.bak` 快照 | 成本与失败模式都不可控，且不在 CI 覆盖范围内 |
| P3 | 没有 Obsidian 插件 | 全仓 0 个 `manifest.json` | 「Obsidian-native」是营销词，不是功能 |

---

## 9. 我们能拿走什么

**能拿的三条（都可落地到 `dsh-mempalace` / 我们的 Obsidian 方案）**

1. **笔记 schema 直接可用**：`date/project/cwd/tags/duration` frontmatter + `Summary/Decisions/Done/Next Steps/Problems/See Also` 六段 + 首现实体 wikilink。我们的 `mempalace` 抽屉如果要做「导出成 Obsidian 可读笔记」，这是现成的、经过真实 vault（90 篇）验证的模板。
2. **readiness gate 的思路**：注入前先算「该 cwd 的历史覆盖率」，低于阈值宁可静默。我们的记忆卡注入可以照这个思路加一道「记忆新鲜度」闸门，避免拿半份记忆误导模型。
3. **幂等账本的写法**：`claim → 落账 → 失败可 supersede`，配一把 per-target `filelock`。我们要做「会话结束自动入库」时，这是被真实数据丢失事故打磨过的模式。

**明确不要抄的一条**

4. **不要把产品耦合到宿主的 hook 生命周期**。它现在的全部自动化都建立在「Claude Code 会发 SessionEnd」上，于是 Windows 特例、5s 窗口、settings.json 篡改检测全成了核心代码。我们如果做 Obsidian 侧，触发点应该在我们自己的事件总线上，插件只做展示。

---

## 10. 与 `dsh-mempalace` 对照

| 维度 | mnemos | dsh-mempalace（我们） |
| --- | --- | --- |
| 真源 | vault markdown | SQLite（memory body 由 ActMem 写，插件只读） |
| 写入者 | 用户订阅里的 `claude --print` | ActMem（唯一写入口） |
| 检索 | ChromaDB / sqlite-vec 单向量整篇 | better-sqlite3 + sqlite-vec，按抽屉 |
| 图 | wikilink 共现扫描（O(n) 读文件） | SQLite 三元组 + 版本账本 |
| 注入 | SessionStart 简报（≤25K）+ 5 个 MCP 工具 | 记忆卡（runtime context / system）+ 14 个只读工具 |
| 成本 | 0（用户订阅） | 0（本地） |
| 平台 | Claude Code + Windows 优先 | DSH 宿主无关 |
| 观察 | 单人、停更 6 个月 | 在维护 |

结论：**两者不是替代关系**。mnemos 是「面向 Claude Code 用户的记忆产品」，我们是「面向 DSH 的只读档案 + 宫殿检索」。它值钱的地方是那份失败复盘和笔记 schema，不是代码。

---

## 11. 核实状态

| 结论 | 依据 | 状态 |
| --- | --- | --- |
| 无 Obsidian 插件代码 | `Get-ChildItem -Filter manifest.json` 全仓 0 命中 | 已核实 |
| 索引只有手动 reindex 更新 | 全仓 grep `index_raw_bulk` 仅 `reindex.py:95`；worker 三步无索引 | 已核实（读代码） |
| wing/room/hall 过滤失效 | `reindex.py` metadata 仅 path/type；`search.py:379` 仍在过滤 | 已核实（读代码） |
| v1.0 未跑 LongMemEval | ROADMAP v1.3.0 `⏸`；CHANGELOG 90% 为 v0.x 数据 | 已核实 |
| 简报 15K vs 25K 冲突 | HISTORY 文本 vs `skills/mnemos-briefing/prompt.md` 预算表 | 已核实（文档内部冲突） |
| 「556 pass」 | `STATUS.md` 自述 | **未核实**（未装依赖、未跑测试） |
| Windows hook 真机行为 | 读代码 + STATUS 里的实测记录 | **未核实**（未在 Windows 跑） |
| PyPI 下载量 | pypistats API：24/月、18/周、0/日 | 已核实（快照） |
| 星标/fork/issue | GitHub API：4 / 2 / 0 | 已核实（快照） |

---

## 12. 参考

- 仓库：<https://github.com/mnemos-dev/mnemos>
- 历史复盘：<https://github.com/mnemos-dev/mnemos/blob/main/HISTORY.md>
- v1.0 设计规格：`docs/specs/2026-04-25-v1.0-narrative-pivot-design.md`
- 精炼 prompt：`docs/prompts/refine-transcripts.md`
- 简报 skill：`skills/mnemos-briefing/prompt.md`
- PyPI：<https://pypi.org/project/mnemos-dev/>
- 同期调研（生态全景）：[`docs/research/mempalace-obsidian-integration.md`](mempalace-obsidian-integration.md)
