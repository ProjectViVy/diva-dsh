# v0.1.0 Dream plan 校验可定位 + 零候选即结案

## 现象（run_9954bfd6）

自动精炼 `dream_46870627…`（request）+ `run_9954bfd6-b16b-4bb3-bc9f-a88d95406651`：

- 快照 5007 refs / 26 个会话；04:32:11Z 读快照，04:40:07Z 通过一个「1 张事实卡 + 1 条
  coverage + 0 候选」的最小计划，04:40:20Z 会话 turn 结束，**从未调用 `execute`**；
- 06:46:55Z 被 `maintain()` 判 `blocked`，请求 `timed_out`，`lastError=Dream run did not
  finish before its deadline`，并因 `lastAttemptAt` 触发 24h 冷却；
- 期间 6 次 `plan` 提交（5 拒 1 过），候选一个都没 stage。

两次更早的 run（`run_2752722a` 2026-11-12）同样是 0 候选完成——「只交事实卡」不是这一次
的偶发。

## 六次提交的真实缺陷（与 journal 的 5007 条 ref 逐条比对）

| # | 04:xxZ | 事实卡 | coverage | 候选 | 缺陷 | 校验器当时回的话 |
|---|---|---|---|---|---|---|
| 1 | 35:10 | 25 | 0 | 0 | coverage 空 + 35 个 `event:115:<hex>` | `Plan needs nonempty factCards/coverage and candidates` |
| 2 | 36:59 | 25 | 188 | 1 | 21 个 `event:<序号>:<hex>`、2 个伪造 digest、5 个跨会话引用 | `Fact card needs source-session refs` |
| 3 | 38:25 | 24 | 173 | 1 | 1 个伪造 digest、3 个跨会话引用 | 同上 |
| 4 | 39:29 | 31 | 40 | 1 | 1 个拼错的 `sessionId`（`…c7db11`，真值 `…c9db11`） | 同上 |
| 5 | 39:58 | 20 | 25 | 1 | **只差候选的 `refs` 数组** | `Candidate needs covered primary refs` |
| 6 | 40:07 | 1 | 1 | 0 | 无 | 通过 |

## 根因（四类，互相叠加）

1. **拒绝信息不定位**：四条完全不同的缺陷共用 3 句不带卡号/ref/会话的话，模型只能盲改；
   第 1 次失败甚至连「coverage 空」都没说清（消息说 candidates 也要非空，而 0 候选是合法的）。
2. **`[序号] event:<hex>` 显示格式诱导误读**：`lineOf` 打的是 `[193] event:<64hex>`，
   而同一工具的 `offset` 又是 ref 序号；模型从第一份计划起就写 `event:193:<hex>`（共 56 处）。
3. **skill 的 plan 示例没有候选**：`"candidates": []` 是空的，候选必须带 `refs` 只写在正文
   一句话里。四条候选实测 keys 都是 `[kind, skillId, expectedDigest, entry]`，一次都没带 refs。
4. **零候选计划不结案**：`plan()` 成功后停在 `planned`，而 0 候选没有任何东西可 stage；
   会话结束时也没有收尾，于是一个已经「分析完成」的 run 独占唯一精炼位 2 小时，
   最后被记成超时错误。

## 改动

| 文件 | 改动 |
|---|---|
| `plugins/dsh-evolution/src/dream.mjs` | 新增 `normalizePlanRefs`（`event:<seq>:<digest>` → `event:<digest>`，仅当 digest 在冻结快照中）、`planDefect`（逐条定位的拒绝文案）、零候选 plan 立即结案（`completed` + 消费 coverage）、`maintain()` 对已终态 run 的请求按自身结局记账 |
| `plugins/dsh-evolution/src/dream-tool.mjs` | `lineOf` 改 `seq=<n> <id>`；evidence 首页给 id 形态 note；plan 回话给 `next`（是否仍需 execute）；`runView` 透出 `repairedRefs` |
| `skills/diva-dream/SKILL.md` | plan 示例含完整技能候选（带 `refs`）；新增「Ref discipline」；读取口径改为「大快照不可能读完，抽样要写 deferred」；写清零候选即结案、有候选必须 execute、被拒计划不冻结 |
| `plugins/dsh-evolution/tests/dream.test.mjs` | 新增 6 例 |
| `plugins/dsh-evolution/tests/dream-tool.test.mjs` | 新增 2 例 |

拒绝仍发生在 `journal.update` 内（抛出不落盘），因此被拒的 plan 什么都不会冻结，改完可重交。

## 影响

- 一个「分析完成但无候选」的精炼在提交瞬间结案，不再空占精炼位、不再被记成超时；
- 引用错误从「一句通用话」变成「第几张卡 / 哪个 ref / 属于哪个会话 / 该会话的合法示例」；
- `event:<序号>:<digest>` 这类抄写错误被静默修好并如实回话 `repairedRefs`；
- 不碰数据模型：没有 ref 别名表、没有快照格式变化、没有 owner 协议变化、journal 零迁移。
