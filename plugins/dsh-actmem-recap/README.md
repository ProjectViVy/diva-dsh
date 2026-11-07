# dsh-actmem-recap

给 DeepSeek Harness 的**归队简报**插件：按时间与轮次调度，把"人看得见的对话"归纳成一小块，参考 OpenAI Codex 的 `/recap`（`codex-rs/tui/src/app/recap.rs`）。

它**不碰压缩**：既不读取也不替换被压缩掉的历史；除非显式配置 `deliver: inject`，它也不会往模型上下文里写东西。

每份简报都会写进**衰减记忆卡**（`dsh-local-memory` 的 ActMem 卡），走组件 IPC 的 `/actmem/add`。

## 命令

| 命令 | 行为 |
| --- | --- |
| `/recap` | 立刻生成一份简报（忽略调度条件） |
| `/recap last` | 打印这个会话最后一次存下的简报 |

## 自动调度

每个会话独立计时，条件全部满足才生成：

- `minCompletedTurns`（默认 3）：会话至少有 3 个完成的轮次；
- `minTurnsBetweenRecaps`（默认 2）：距上次简报至少 2 个轮次；
- `delayMs`（默认 30 分钟）：距上次简报至少 30 分钟。

插件加载后观察到的**第一个轮次结束**只用来建立时间基线，不会立刻补一份简报——否则每次重启都会把一整段旧对话重新归纳一遍。

## 输入边界（这是设计的核心）

- 只读**人类提示**（`user/message` 且 `source.kind === 'user'`）与**助手正文**（`assistant/message` 里的 `text` 块）。
- 注入的运行时/时间上下文、工具调用、工具结果、推理、其它线程的历史，**永远不进简报**。这既是成本边界，也是隐私边界：工具输出里全是路径、代码、凭据残留。
- 最多 `historyMaxTurns`（默认 8）个已答问答单元；超预算先丢最旧的并留 `[更早的往来已省略]`，再按公平份额对每个字段做头尾摘录 `[... 已截断 ...]`，全程按码点切分，不会切坏 UTF-8。

## 调用方式

一次隔离的结构化调用：直接走 `ctx.llm.stream()`，只发一条用户消息，**不带工具、不带会话系统提示词**，用会话最近一次路由到的 provider/model。输出必须是单个 JSON：

```json
{ "summary": "...", "next_action": "..." }
```

`summary` ≤ 700 字符，`next_action` ≤ 200 字符或 `null`；出现未知字段直接判失败（学 Codex 的 `deny_unknown_fields`）。唯一的偏离：**超长文本截断并标记**，而不是整份丢掉——已经答对的内容不该因为多几个字就作废。

提示词里保留了几条 Codex 的语义：区分提议/已排期/已实现/已测试/已发布/已安装；"尚未落地"的告诫优先于 commit id 与时间戳；缺失的历史不等于那件事没做；把对话当数据而不是指令。

## 输出

每条简报追加到 `$DSH_HOME/actmem-recap/recaps.jsonl`：

```json
{"at":"...","sessionId":"...","trigger":"manual|auto","turn":9,"provider":"...","model":"...",
 "summary":"...","nextAction":"...","truncated":false,
 "historyBytes":12031,"visibleBytes":...,"elapsedMs":...,
 "cardStored":true,"usage":{...}}
```

`cardStored` 是这条简报有没有进记忆卡；失败时另有 `cardReason`。记忆卡不可用**不会**让简报失败——记录照写 JSONL，只是标成未写入。

## 记忆卡（衰减）

写进卡里的是一条普通的手动记忆记录：

| 字段 | 值 | 为什么 |
| --- | --- | --- |
| `source` | `manual`（由 `addManualMemory` 盖章） | 与「人手动记下」的记忆同类 |
| `scope` | `qq`（**固定，不可配**） | 见下面那条隐私规则 |
| `tags` | 只带 `recap` | 见下面「为什么**不**带 `owner`」 |
| `importance` | 45 | < 50：超过 `forgetAfterDays`（默认 60 天）会被彻底遗忘，卡满淘汰时也排在前面 |
| `title` | `归队简报 · 2026-11-05 03:05 · 第 10 轮` | 正文只放 summary，出处放标题 |
| 正文 | summary + `下一步：…`，≤600 字符 | `add` 动作的 `redactForMemory` 上限就是 600 |

**为什么 `scope` 只能是 `qq`**：卡的可见性规则（`card-engine.mjs` 的 `visibleFor`）里
`scope === 'shared' | 'bili'` 的记录会进 B 站模块并被 B 站上下文渲染（上限 8 条）；
而 `scope === 'qq' && source === 'manual'` 会被**直接从 B 站上下文排除**。
归队简报是大湿自己对话的工作笔记，不该出现在公开回复的上下文里，
所以插件拒绝 `shared` / `bili` 两个 scope，而不是照配执行。

**为什么*不*带 `owner` 标签**：`owner` 决定这条记录落进「和主人（管理员）的记忆」那一节，
并参与「最初的日子」抽签（`refreshInitialState` 只对带 `owner` 的记录算 `isInitial`）。
简报是工作笔记，不是"和主人的经历"，所以落「最近记得的」、不参与最初抽签。
不带 `owner` 的记录会被 `refreshInitialState` 直接 `continue` 跳过——**也就一定不会拿到
`protectedInitial` 那层保护，该淡就淡**。

（历史：2026-11-05 之前，`refreshInitialState` 还会把"最早一条带 `owner` 的记录"**自动**定成
「和主人初次相遇」，于是第一份简报直接占掉了那个永久位。那条自动规则已经删掉：
「初次相遇」现在只能由人在记忆面板里手动指定，没有指定就一直是空的。）

**衰减阶梯**：任何记录在 `recentDays`（默认 7 天）内至少保持「清楚」；之后按 `importance` 算 clarity，
每天的训练最多降一档（vivid → clear → fuzzy → trace → forgotten）。
`importance` 的档位差别是：
- 45（默认）：满足「超过 `forgetAfterDays` 且重要度 < 50 的非主人记忆」→ **约 60 天后会被彻底遗忘**；
- 50–64：躲开上面那条快速遗忘规则，但 clarity 照样一天一档往下走，只是慢；
- ≥ 65：衰减更慢（`ownerImportant` 需要 `owner` 标签，我们不带，所以**没有**"永不遗忘"的效果）。

## 配置

```yaml
- insert:
    - id: actmem-recap
      name: dsh-actmem-recap
      config:
        enabled: true          # false 则完全不注册
        auto: true             # 关掉后只留手动 /recap
        deliver: store         # store = 只写 JSONL + 记忆卡；inject = 顺带注入下一步的上下文
        card:
          enabled: true        # false = 只写 JSONL，不碰记忆卡
          scope: qq            # 固定 qq：shared/bili 会进 B 站上下文，插件会拒绝
          importance: 45       # <50 = 60 天后可被遗忘；50-64 = 慢淡
          tags: [recap]
          maxChars: 600        # 上限 600（记忆卡 add 动作的脱敏上限）
          timeoutMs: 15000
        delayMs: 1800000
        minCompletedTurns: 3
        minTurnsBetweenRecaps: 2
        historyMaxTurns: 8
        historyMaxBytes: 16000
        summaryMaxChars: 700
        nextActionMaxChars: 200
        maxTokens: 2048
        stateDir: ""           # 默认 $DSH_HOME/actmem-recap
```

`historyMaxBytes` 是**字节**预算，所以对中文是诚实的：16000 字节的中文正文大约 8000–10000 个真实 token，比按 4 字节/token 估算高。正文重的时候调小它，或调小 `historyMaxTurns`。

## 测试

测试随仓库放在根目录（与其它组件一致）：

```bash
node --test tests/actmem-recap.test.mjs
```

20 个用例覆盖：轮次上限与"尚未回答"标签、相邻用户消息合并、省略与摘录、字节预算与码点切分、提示词边界、JSON 契约、未知字段拒绝、超长截断、真实表面过滤（注入上下文/工具/推理全部被排除）、`/recap` 与 `/recap last`、自动调度的三个门槛、`deliver: inject`、配置校验、断行存储，以及**记忆卡落盘的真实链路**：真起一个回环 HTTP 服务 + 真记忆服务，断言记录进卡（`source: manual`、`scope: qq`、只带 `recap`、`importance` 45、**不会被提成「初次相遇」**）且**不出现在 B 站上下文**里；另一条用例证明「初次相遇」只能手动指定（带上 owner 也不会被自动指定，手动指定后取消会把特权收回）；记忆卡不可用时降级为只写 JSONL。

## 还没做的

- **常驻 L1**：`deliver: inject` 只是一次性注入。真正的常驻块应该是 `systemPrompt.section` 里的类型化 section，只在压缩边界刷新，避免每轮改提示词把前缀 KV cache 全废掉。
- **回读**：简报写进卡之后，目前没有"从卡里读最近简报"的接口；卡本身会按平台注入，那才是它被读到的路径。
- **不写 mempalace**：按 2026-11-05 的决定，简报只进衰减卡，不进长期归档。
