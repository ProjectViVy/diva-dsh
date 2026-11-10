# 方案：把 `agent-diva/dev` 的 TODOLIST + 日志方法论迁移到 diva-dsh

- 状态：方案（仅文档，不含代码改动）
- 日期：2026-11-10
- 来源：`ProjectViVy/agent-diva` @ `dev`（`c565bb2`）
- 范围：diva-dsh 根仓库 + 本地插件仓（渐进）
- 目标：让任何会话在**第一次模型调用**时就知道「我在做什么、做到哪、下一步是什么」

---

## 0. 结论摘要

| 迁移什么 | 迁 | 不迁 | 理由 |
| --- | --- | --- | --- |
| TODOLIST（L0/L1/L2 分层、sev 分级、决策闸门、归档索引） | ✅ 必须 | | 它是跨会话唯一可靠的「当前任务」事实源 |
| 迭代日志 `docs/logs/<theme>/<version>/{summary,verification,release,acceptance}` | ✅ 必须 | | 它是「凭什么说做完了、什么没验证」的证据层 |
| 规则化（Rulebook：捕捉必录、日志必写、验证必跑） | ✅ | | 没有规则约束的文件三天就烂 |
| LOCK.md（并行互斥文件：owner/scope/heartbeat/expiry） | | ❌ | diva-dsh 的并行边界是 git submodule 仓 + DSH 会话，不是同一棵工作树 |
| 自动提交、命令机制、`/init` 等治理附件 | | ❌（可后置） | 与当前痛点无关，先别扩散 |

一句话：**把「agent 记住自己在做什么」改成「文件写着自己在做什么」**，并让 DSH 在第一次模型调用前就把文件指给它看。

> **2026-11-10 决定：只迁协议，不迁历史数据。** 旧 backlog、旧日志、surfcore 的 HANDOFF 快照一概不搬、不改写、不合并；`TODOLIST` 从空态开始，第一条记录是下一个真实任务。方法论的价值在**形状**，不在内容；把垃圾数据洗进唯一事实源，等于开局就污染锚点。详见第 7 节。

---

## 1. 现状诊断：为什么第一次召回会「不知道自己在做什么」

已核实的五个事实（不是推测）：

1. **根目录没有 `AGENTS.md`。** `diva-dsh/AGENTS.md` 不存在。DSH 的 `dsh-agent-instructions` 会从会话 cwd 向上发现 `AGENTS.md` 风格的指令文件；根目录没有，就意味着**这个工作区里从根启动的会话，第一次模型调用前拿不到任何项目级指令**。
   - 反证：本会话在读到 `plugins/surfcore/AGENTS.md` 覆盖的文件时，该文件被自动注入——「触达即注入」是生效的，缺的是根的那一份。
2. **根目录没有 `docs/logs/`，也没有任何持久任务状态文件。** 全仓库搜索 `TODOLIST*` / `docs/logs/**` 均无结果。
3. **`todo_write` 是会话内工具，不是状态。** 它只影响当前会话的执行清单，不进系统提示、不落盘；会话结束、压缩、重开即归零。**跨会话的「我在做什么」当前没有任何载体。**
4. **已有的一份好实践被关在子仓里。** `plugins/surfcore` 自己长出了 `docs/HANDOFF.md`（当前做到哪/什么没验证）、`docs/cases/*.md`（六段模板）、`RELEASE-QUEUE.md`，并在 `AGENTS.md` 里写了「开工前必读」七步。但它是**一个仓库的私有约定**：从根启动的会话、在别的插件里干活的会话，读不到；格式也不统一（HANDOFF 是流水快照，cases 是按 bug 的档案）。
5. **文档在指向不存在的东西。** `docs/architecture.md` §19 引用 `superpowers/plans/vivy-dsh-ecosystem/index.md` 等路径，本 checkout 中 `superpowers/` 不存在（不是 submodule）。入口文档把人指向空文件，等价于把人指向空白。

**与架构的冲突点：** 架构 §7.2 规定 Recap「只能是从当前任务和 ActMem 生成的可重建投影」。但当前「当前任务」没有权威来源——投影从空集合生成，召回自然只剩「关于用户的记忆」，没有「我在做什么」。**这不是召回算法的 bug，是事实源缺位。**

结论：第一次召回时 agent 缺的不是更多记忆，而是**任务锚点**。锚点必须是确定的、可读的、在第一次模型调用之前就进上下文的。

---

## 2. 从 `agent-diva/dev` 迁移的机制（原样保留的部分）

### 2.1 TODOLIST 机制

`agent-diva/dev/TODOLIST.md`（32KB）的实际形状：

- 分层：`L0 计划/大型 WBS → L1 工作流 → L2 事项`；只保留**仍可执行、仍待决策、仍需验证**的条目，完成项进归档目录。
- 条目带编号与严重度：`sev-P0`（阻断）/`P1`（高）/`P2`（中）/`P3`（低），实际用到 `P4`（样式类）。
- 条目正文足够自恢复：日期、当前判断、硬约束、**待决策**（谁拍板）、相关文件/文档链接、已完成的子项 `- [x]` 与交付记录链接。
- 专门分区：`L0-决策闸门（先拍板、后实施）`、`L0-生产路径证明`、`L0-人工验收遗留`、`L0-可靠性与测试债务`。
- 顶部有**收口横幅**：`> 2026-08-30 正式关闭…Epic`，链接到 `completed-*.md` 归档记录。
- 底部 `Archive Index`：最新归档在前，指向归档目录。

### 2.2 日志机制（Iteration Protocol）

`AGENTS.md` 的原文规定：

- 每次迭代建一个主题目录 `docs/logs/<date-or-theme>/`，其下每个版本一个 `vX.Y.Z-<slug>/`。
- 版本目录至少四件套：`summary.md`（改了什么/影响面）、`verification.md`（怎么验的/结果）、`release.md`（怎么发/不适用要写原因）、`acceptance.md`（用户视角验收步骤）。
- 可选：`prd.md`、`notes.md`（讨论记录）、`rollback.md`。
- 规则条目 `iteration-log-required`：没有日志与验收记录，不算交付完成。

### 2.3 规则化（Rulebook）

`AGENTS.md` 末尾的 Rulebook 每条固定五段：约束/适用范围、正例、反例、执行方式、维护者。迁移时保留的关键四条：

- `todolist-capture-required`：发现的问题不进 TODOLIST 就算没发现（同一迭代修完的除外）。
- `iteration-log-required`：每个交付必须有版本目录与四件套。
- `post-dev-stage-validation`：每阶段跑验证命令，跑不了要说明原因。
- `use-chinese-when-communicating`：与用户沟通用中文。

### 2.4 为什么不迁 LOCK

LOCK.md 解决的问题是「多个 Codex/Cursor/人工会话共用**同一棵工作树**」。diva-dsh 的并行事实是：

- 15 个本地插件 + 3 个上游**各自是独立 git 仓（submodule）**，天然文件隔离；
- DSH 的并行是**多会话/多 workspace**，`dsh-agent-instructions` 按 cwd 发现指令，会话之间不共享工作树；
- 真正的共享面只有根仓库的 `scripts/`、`tests/`、`docs/`、`patches/` 与 submodule 指针。

所以 LOCK 的**冲突安全属性**用三件事保留，而不是加一个互斥文件：

1. **条目内认领**：TODOLIST 每条带 `owner: <session-id> ｜ 开始: <时间> ｜ Scope: <具体路径>`；同一个 Scope 上已有别的 owner 就停手或换条目。
2. **仓级隔离**：写操作发生在哪个 submodule，就在哪个仓提交；根仓只动自己的路径。
3. **git 写操作串行**：同一仓同一时刻只允许一个会话跑 `git` 写命令（surfcore 已有这条血泪规则，直接上升为全局规则）。

`Scope` 精确到文件/模块，`GLOBAL` 类比（迁移、批量格式化）保留为「必须先问用户」的标记。

---

## 3. 目标模型：三层，各管一件事

```text
┌─ 指令层（第一次调用前就在上下文里）──────────────────────┐
│ diva-dsh/AGENTS.md   常设指令：开工三读、收工三写、Scope 规则  │
│                        ≤ 120 行，只写「怎么干活」，不写状态     │
└──────────────────────────────┬───────────────────────────┘
                               │ 指向
┌─ 状态层（唯一「当前任务」事实源）────────────────────────┐
│ diva-dsh/TODOLIST.md  NOW 块（≤40 行，≤3 条）+ 活跃条目       │
│                        每条：目标/状态/下一步/验收/Scope/日志 │
└──────────────────────────────┬───────────────────────────┘
                               │ 指向
┌─ 证据层（只追加，不改写）──────────────────────────────┐
│ docs/logs/<YYYY-MM-theme>/vX.Y.Z-slug/                       │
│   summary.md  verification.md  release.md  acceptance.md     │
└──────────────────────────────────────────────────────────────┘
```

三条不变式：

1. **写状态的地方不写证据，写证据的地方不改状态。** TODOLIST 只写「现在」，日志只写「发生过」。
2. **状态必须一条链接直达证据。** 每个活跃条目必须有 `日志:` 字段；没有日志目录的条目只能是 `todo` 状态，不能是 `doing`。
3. **证据一旦发布不改写。** 发现错误就新开目录或追加 `notes.md`，不改历史 `verification.md`。

---

## 4. 文件规范

### 4.1 `diva-dsh/TODOLIST.md`

建议骨架（约 120 行起步，随条目增长）：

```markdown
# TODOLIST

> 本仓**活跃**待办。跨会话唯一「当前任务」事实源。
> 只写状态，不写设计（设计进 docs/），不写历史（历史进 docs/logs/）。
> 完成项移入 Archive Index 指向的归档文件，不原地删除。

## NOW（会话先读这里，≤40 行）

> 更新时间：2026-11-10 09:20 (Asia/Shanghai) ｜ 规则：最多 3 条；没有就写「无」，不要编。

### DV-SC-012 记忆卡衰减阈值在群聊里过早触发
- 状态：doing ｜ owner：session-3f7a ｜ 开始：11-10 09:10
- 目标：群聊场景 decay 阈值 7 天 → 21 天，私聊不变
- 下一步：先在 src/memory-card.js 打点复现 → 再改阈值 → 补测试
- 验收：test-memory-card 新增 2 条断言；真机群聊观察 1 天无过早衰减
- Scope：plugins/surfcore/src/memory-card.js, plugins/surfcore/scripts/test-memory-card.mjs
- 日志：docs/logs/2026-11-memory-decay/v0.7.24-decay-window/
- 阻塞：无

## 活跃（按区域，L0 → L1 → L2）
### L0 启动器与编排
#### L1 scripts / tests / patches
- [ ] DV-INF-003 安装脚本在 Node 24 下 …（sev-P2，owner 未认领）

### L0 插件
#### L1 surfcore（详见 plugins/surfcore/docs/HANDOFF.md，此处只放指针与跨仓事项）
- [ ] DV-SC-012 …（见 NOW）

## L0 决策闸门（先拍板、后实施）
- [ ] DV-DEC-001 是否把 `plugins/memory` 的社交记忆并入 ActMem（待用户拍板）

## L0 可靠性与测试债务
- [ ] DV-REL-002 根 `npm test` 在 Windows 上的偶发超时（sev-P2）

## Archive Index
- [2026-11-10 关闭 DV-INF-001](docs/logs/archive/completed-2026-11-10-inf-001.md)
```

字段规则（写进 AGENTS.md 的 Rulebook）：

- **编号**：`DV-<区域>-<三位序号>`。区域：`INF`（scripts/tests/patches）、`SC`（surfcore）、`MEM`（memory/voice/asr）、`AM`（actmem-recap）、`ME`（mempalace）、`LA`（laputa）、`EV`（evolution/continual-harness）、`UP`（DSH/superagent 升级与补丁）、`REL`（发布/真机验收）、`DOC`（文档/架构）。
- **状态**：`todo` / `doing` / `blocked` / `waiting-user` / `done`。只有 `doing` 需要 owner 与 Scope。
- **sev**：`P0` 阻断 → `P4` 观感，与 agent-diva 一致。
- **下一步必须可执行**：动词开头，写清在哪个文件/跑哪条命令；禁止写「继续优化」。
- **未验证必须显式**：条目里写「未验证：…」，不允许用「应该没问题」代替。

### 4.2 `docs/logs/<YYYY-MM-theme>/vX.Y.Z-slug/`

- 主题目录按**月 + 主题**（`2026-11-memory-decay`），版本目录按**语义版本 + slug**（`v0.7.24-decay-window`）；没有版本号的仓用 `v0.0.1-slug`。
- `summary.md` **前 6 行必须是块**，供召回时 5 秒读完：

```markdown
# v0.7.24 群聊衰减窗口

- 状态：已交付 / 部分交付 / 已回滚
- 范围：plugins/surfcore/src/memory-card.js（1 文件 + 1 测试）
- 验证：test-memory-card 14/14；test:audit 108/108
- 未验证：真机群聊 1 天观察未做
- 下一步：DV-SC-012 关闭前补真机观察
- 回滚：`git revert <sha>`
```

- `verification.md`：命令 + 预期 + 实际输出 + 跑不了的原因。禁止只写「通过」。
- `release.md`：怎么发、发给谁、需要重启什么；不适用要写原因。
- `acceptance.md`：用户视角的验收步骤（点哪、看什么）。
- 归档：`docs/logs/archive/completed-YYYY-MM-DD-<id>.md`；TODOLIST 只留一行横幅 + 链接。

### 4.3 `diva-dsh/AGENTS.md`（≤120 行）

只写常设指令，每条 1–3 行并链到「正家」（DSH 文档标准：根 `AGENTS.md` 是 standing orders，不是手册）。骨架：

```markdown
# AGENTS.md — diva-dsh 工作区常设指令

## 0. 每次开工（顺序别改，三次工具调用内完成）
1. 读本仓 `TODOLIST.md` 的 `## NOW` 一段。空 → 直接问用户做什么，不要自己找活。
2. 读该条目 `日志:` 指向目录里的 `summary.md`（最近一篇）。
3. 需要更多历史再读同目录 `verification.md`；**不要从会话记忆推断进度**。

## 1. 认领（没有 LOCK 文件，认领写在条目里）
- 动手前把 `状态: doing ｜ owner: <session-id> ｜ 开始: <时间> ｜ Scope: <具体路径>` 写进条目。
- 同 Scope 已有别人 owner → 停手、换条目或问用户。
- 同一 git 仓同一时刻只跑一个写操作（避免 index.lock）。

## 2. 收工（缺一项不算完成）
1. 条目状态改 `done/blocked/waiting-user`，写清下一步或阻塞原因。
2. 有交付 → 新建/补齐 `docs/logs/.../` 四件套；没交付 → 在条目里写「本轮无交付」。
3. 新发现的问题进 TODOLIST（同一轮修完的除外）。
4. 未验证项写进 `summary.md` 的「未验证」，不许省略。

## 3. 边界
- submodule 内不改上游源码（deepseek-harness / superagent）；需要改动走 `patches/` 或插件。
- 不碰 `config.json` / `state/` / `~/.dsh` 里的密钥；输出前脱敏。
- 删除/覆盖前备份或 rename 到隔离目录。
```

> 注意：DSH 会把根 `AGENTS.md` 注入每个会话，子目录 `AGENTS.md` 在触达时注入（本会话已观察到 `plugins/surfcore/AGENTS.md` 在读到该目录文件时被注入）。所以**根文件必须短**，细节留给子仓自己的 `AGENTS.md`。

---

## 5. 会话协议（这是修复「第一次召回」的核心）

### 5.1 冷启动三读

第一次模型调用时，上下文里已经有根 `AGENTS.md`；它要求三读：

1. `TODOLIST.md` 的 `## NOW`（≤40 行，5 秒）；
2. 当前条目链接的 `summary.md` 前 6 行；
3. 需要时 `verification.md` 里的「未验证」段。

读完 agent 应能一句话回答：「我在做 DV-SC-012，群聊衰减窗口；上一步打点复现没完成；下一步在 memory-card.js 加日志；验收是新增 2 条断言 + 真机观察。」——这就是验收标准。

### 5.2 压缩/续跑后恢复

DSH 压缩会话后，消息历史会被摘要，但 `TODOLIST` 与日志不变。规则加一条：**压缩后或恢复会话后，第一件事重读 `NOW`**。这也顺便解决了「压缩后 agent 不知道自己做到哪」的老问题。

### 5.3 与 `todo_write` 的分工

- `todo_write`：**本次会话内**的执行清单（工具层，可随时改写）。
- `TODOLIST`：**跨会话**的任务状态（文件层，改动要克制）。
- 规则：`todo_write` 里完成一项，若它对应 TODOLIST 条目，同步一次状态；反之不要求逐条镜像。

### 5.4 与 `agent-handoff` 技能的分工

交接只在**跨 agent / 上下文溢出 / 换人**时生成，落到 `docs/logs/.../handoff.md` 或直接写进条目的「下一步」，**不做常驻文档**。常驻的是 TODOLIST（状态）与日志（证据），交接是它们的临时快照。

---

## 6. 与现有体系的接缝（联邦，不另立第二事实源）

| 现有物 | 迁移后定位 | 避免重复的做法 |
| --- | --- | --- |
| `plugins/surfcore/docs/HANDOFF.md` | surfcore 的**仓级状态文档**（保留，继续按它的快照格式写） | 根 TODOLIST 只放一行指针 + 跨仓事项，不复制内容 |
| `plugins/surfcore/docs/cases/*.md` | surfcore 的**bug 档案层** | 与 `docs/logs/` 不重叠：cases 按 bug，logs 按交付批次；一条 bug 可被一个 log 批次引用 |
| `plugins/surfcore/docs/ROADMAP.md` | 方向/路线守则 | 不迁成 TODOLIST；TODOLIST 只放「能执行的事项」 |
| `plugins/surfcore/docs/RELEASE-QUEUE.md` | 发布队列 | 发布仍是独立职责（编辑会话/发布会话分离），TODOLIST 只记「待发布」一句 |
| `docs/architecture.md` | 架构正家 | TODOLIST 不复制架构结论，只链接 |
| `$DSH_HOME` 下 ActMem / Recap | 召回通道 | 召回是概率的、有预算的、会被压缩的；TODOLIST 是确定性的。**不要把任务状态塞进记忆卡** |
| Superagent Ticket | 控制面任务 | 后续（代码阶段）建立 `ticket_id ↔ DV-<id>` 映射，现在只在条目里写 `Ticket:` 字段 |

**渐进策略：** 先只落根仓（一个 TODOLIST + 一个 AGENTS.md + 日志协议）。子仓按「有待办才建」：某插件第一次有跨会话任务时，才在它仓里建 `TODOLIST.md`，格式照抄根仓。**不要一次性给 15 个插件建空文件**——空文件会立刻腐烂，也会和它们各自的 AGENTS.md 打架。

---

## 7. 数据边界：只迁协议，不迁历史

2026-11-10 决定：**只搬方法论（文件形状 + 规则 + 模板），不搬数据。**

| 类别 | 处理 |
| --- | --- |
| 旧 backlog（agent-diva 的 Epic / WBS / C0–C6 条目） | 不搬 |
| surfcore 的 `HANDOFF.md` 快照、`docs/cases/*`、`RELEASE-QUEUE.md` | 原地不动，不回填进根 TODOLIST |
| `docs/architecture.md` 里的历史「落地」段落 | 保留原文，不摘抄进 TODOLIST |
| 旧 `docs/logs/`（agent-diva 的迭代记录、docs 归档） | 不复制、不引用、不迁目录 |
| 协议、模板、命名、字段、规则、冷启动步骤 | 迁 |

三条硬约束：

1. **不洗白**：不能把旧结论换个格式写进新系统——那等于把垃圾数据升格成「权威事实」。
2. **不半迁**：不做「一部分搬到新结构、一部分留在旧结构」的中间态，否则召回时要在两套里拼图。
3. **只向前**：新系统的第一条记录必须是**下一个真实任务**；`Archive Index` 从空开始，不补历史。

为什么这样更好：

- 唯一事实源的价值来自**可信**。混入未验证的旧结论，agent 会先信错再纠正，比没有更糟。
- 方法论是**形状**：什么时候写、写什么字段、写在哪里、谁读。形状对了，内容会自己长对。
- 旧资料不是销毁：留在原位置，需要考古时按路径去读，不进日常上下文。

**空态规则（重要）**：`TODOLIST` 起步时 `NOW` 写「无」。此时 agent 的正确行为是**直接问用户做什么**，而不是从旧文档里猜一个任务、或从「值得做」的清单里自己找活。空态是合法状态，不是待填的坑。

**可选（待你定）**：`## 仓级状态入口` 放 1 行/仓，只写「surfcore 的当前状态见 `plugins/surfcore/docs/HANDOFF.md`」这类**指针**，不摘内容。不写也不影响协议成立。

---

## 8. 落地步骤（不改代码）

| 阶段 | 内容 | 产出 | 预估 |
| --- | --- | --- | --- |
| P0 骨架 | 写根 `AGENTS.md`、`TODOLIST.md`（`NOW` 写「无」，分区是骨架，`Archive Index` 为空）、`docs/logs/README.md`（协议 + 模板 + 空态规则） | 3 个文件 | 半天 |
| ~~P1 回填~~ | **取消**（2026-11-10 决定）：不搬任何历史条目。旧 backlog / HANDOFF / cases 原地不动，不回填、不改写 | — | 0 |
| P1 启用 | 只挂协议，不补内容；先跑一次空态：新会话必须问「现在做什么」，而不是自己找活 | 空态验收记录 | 10 分钟 |
| P2 试运行 | 用 3 个真实任务跑「三读 → 认领 → 收工三写」；每次收工补齐日志目录；记录卡点。**从这一批开始积累第一批干净记录** | 3 个日志目录 + 一份复盘 | 1–2 天 |
| P3 收敛 | 去重（surfcore HANDOFF 与 TODOLIST 的边界写死）、补 `docs/logs/_TEMPLATE/`、定归档节奏（每月把 done 项归档） | 更新后的协议 | 半天 |
| P4（可选，需改代码） | 校验脚本：NOW 超行数、条目缺 Scope/验收/日志链接、日志缺四件套 → CI 失败；Recap 注入当前 DV 条目 id | 脚本 + 注入 | 后续另议 |

P4 明确**不在本次范围**：本次只交付文档与协议，不改代码、不加 CI 门禁。

---

## 9. 验收指标（可测，别写成感觉）

1. **冷启动测试**：新开一个会话，只说「继续」，agent 能在 3 次工具调用内说出：条目 id、上一轮做了什么、下一步具体动作、验收条件。连续 3 次通过算达标。**空态测试**：`NOW` 为「无」时，agent 必须直接问「现在做什么」，不得自行挑任务。
2. **覆盖度（前瞻，不回溯）**：自协议生效日起的每一次交付都有 `docs/logs/` 目录与四件套（100%）；生效日之前的历史不计入、不补写、不考核。
3. **链接有效性**：TODOLIST 里所有 `日志:` 与归档链接可解析（0 死链）。
4. **陈腐度**：`NOW` 的「更新时间」不超过 3 天；超过即视为流程失效，必须复盘而不是补一句「最近没动」。
5. **体积**：`NOW` ≤ 40 行；活跃条目 ≤ 30 条；超了必须归档或拆分。

---

## 10. 风险与反模式

| 风险 | 表现 | 对策 |
| --- | --- | --- |
| 第二事实源 | TODOLIST 里粘贴了完整设计/验收细则，与架构文档打架 | 只写状态 + 链接；设计进 `docs/`，证据进 `docs/logs/` |
| 文档膨胀 | 三个月后 TODOLIST 变成 800 行流水账 | 硬上限 + 归档节奏 + 「done 立即移出活跃区」 |
| 假完成 | 状态 `done` 但没有日志目录 / 日志没有「未验证」段 | 规则：无日志不得 `done`；review 时看四件套 |
| 与子仓打架 | 根 TODOLIST 和 surfcore HANDOFF 各说一套 | 联邦：根只放指针与跨仓事项；仓内细节以仓内文档为准 |
| 子模块误改 | 条目要求改 `deepseek-harness/` 源码 | 条目里禁止出现上游源码路径；只允许 `patches/`、插件、根 `scripts/` |
| 空文件腐烂 | 15 个插件各建空 TODOLIST | 只在「第一次有跨会话任务」时创建 |
| 旧数据被洗白 | 把旧结论换个格式搬进 TODOLIST 当事实 | 只迁协议；旧资料留原地、不引用、不归档迁移 |
| 冷启动编任务 | `NOW` 为空时 agent 自行发明待办 | 空态规则写进根 `AGENTS.md`：没有就问 |

---

## 11. 与「不改代码」的边界

本方案只涉及：

- 新增 `TODOLIST.md`（空态起步，不含任何历史条目）、`AGENTS.md`、`docs/logs/README.md`、`docs/logs/_TEMPLATE/*`；
- 更新 `docs/architecture.md` 里指向不存在路径的链接（可选，属于文档修正）；
- 在子仓（如 surfcore）不新增任何东西，继续用它的 HANDOFF/cases。

不涉及：任何 `src/` 代码、npm 脚本、CI 配置、DSH 插件行为、Recap 注入逻辑。P4 的校验脚本与注入属于后续独立提案。

---

## 附录 A：`docs/logs/README.md` 需要写清的六件事

1. 目录命名（主题 + 版本）与创建时机（有交付才建，不是每次会话）。
2. 四件套各自的判据（什么是合格的 `verification.md`）。
3. `summary.md` 前 6 行块的固定字段。
4. 归档规则与归档文件命名。
5. 「不改写历史」的例外（只允许追加 `notes.md`）。
6. 与 TODOLIST 的双向链接要求。

## 附录 B：迁移对照表（agent-diva → diva-dsh）

| agent-diva | diva-dsh | 备注 |
| --- | --- | --- |
| `TODOLIST.md`（L0/L1/L2 + sev + 决策闸门） | 同构 | 编号改 `DV-<AREA>-<NN>`，因为是多仓 |
| `docs/logs/<theme>/vX.Y.Z-slug/` | 同构 | 多一条「前 6 行块」要求 |
| `AGENTS.md` Rulebook 五段式 | 保留四段（约束/正例/反例/执行方式），维护者省略 | 单人维护，维护者字段是噪音 |
| `LOCK.md` | 条目内 `owner + Scope + 开始时间` | 用户明确不要独立互斥文件 |
| `parallel-state-worktree-isolation` | 「submodule 仓隔离 + git 写操作串行」 | 语义等价，载体不同 |
| `auto-commit-each-completed-update` | 暂不迁 | 提交节奏由用户/会话决定 |
