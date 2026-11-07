# vivy-tone：可拆卸的「回复标准」包 — 落地计划

- 状态：设计计划，未写代码；待确认第 6 节的三个决策
- 日期：2026-11-05
- 决定来源：载体 ②（插件包）、人格一律 Laputa、只规定回复标准、自行开发只借鉴 fish-tone 的活人感措辞、默认不强制
- 关联：[独立测试模式与 fish-tone 评估](companion-mode-and-fish-tone.md)、[OpenDots 调研](opendots-survey.md)、[个人持久化 Agent 总体架构](../architecture.md)

## 0. 先分清两个"主 agent"（2026-11-05 更正）

"主 agent"在这个部署里指两个不同的 Session，**它们的人格状态完全相反**：

| | 会话 | 提示词 | Laputa 人格 | DSH 编码提示 |
| --- | --- | --- | --- | --- |
| A | 人在 GUI / QQ 里对话的 top-level 会话 | 普通装配（非 complete） | **已生效** ✅ | 有 |
| B | Superagent 的编排主 Session（`orchestrator-5e3d5345…`，router preset） | `complete: true`，只有 Superagent 组装文本 | **没有** ❌ | 没有 |

证据（直接解出两个会话落盘的 `system/message`）：

- A 类会话（workspace = 仓库根）：系统提示 10,014 / 10,000 字符，含"我的使命"等人格文本，也含 DSH 编码提示。
- B 类会话（`orchestrator-5e3d5345…`）：系统提示 42,815 字符，**以 `[dsh-superagent prompt revision 0]` 开头**，全文检索"我的使命 / 汐 / 寻找真心之旅 / INFJ / laputa"**均为 0 处**。

原因：Laputa 按"每个 top-level agent"注入 `systemPrompt.section`（`plugins/dsh-laputa/src/adapter.ts:76`，非 complete），普通会话照常生效；只有 Superagent 自己创建的那个 router Session 注册了 `complete: true`（`superagent/src/app/sessions.ts:244-249`），DSH 规定"一个 effective complete section 成为唯一 section"，于是人格与编码提示都被它挤掉。

**所以 vivy-tone 要作用于 A 还是 B，是两条完全不同的实现路径**（见第 4 节）。这一点必须先定。

## 1. 硬约束：能力怎么送进 Superagent 的编排主 Session（B）

| 通道 | 能到达 B 吗 | 依据 |
| --- | --- | --- |
| 外部插件 `systemPrompt.section` | **不能**（被 complete 丢弃） | system-prompt.md："One effective complete section becomes the sole prompt section" |
| Laputa 人格 section | **不能**（同上；Laputa 用的是非 complete section） | `plugins/dsh-laputa/src/adapter.ts:76` |
| 团队技能（`config.skills`） | 能（技能目录是 user-role 消息，不是 system prompt），但**拉取式** | `tool-skill/README.md`："a durable user-role message before its first request" |
| **Superagent Prompts 覆盖**（owner API） | **能**，且它就是那段文本本身 | `PUT /orchestrator/api/prompts` |
| 出站 Effect 后处理 | 能，但属于"改写已写好的话"，不是"标准" | architecture §8.2 Effect 链 |

**结论：若目标是 B，vivy-tone 的送达通道只能是 Superagent 自己的 Prompts owner API。** 插件不直接写 Superagent 的数据文件（架构不变量 11），而是走它公开的回环 API。

需要知道的两个 API 事实：

- `GET /orchestrator/api/prompts` 返回 `parts`（每个内置 part 的 `key / text / base`）、`current.config` 与当前 `revision`、以及 `defaultChanged`（哪些覆盖的基线变了）。
- `PUT /orchestrator/api/prompts` 接受 `{ config, baseRevision }`，**CAS 冲突返回 409**；`validate` 会**自动丢弃**"文本又变回内置原文"的覆盖（`prompts.ts` 的 `validate`）。所以"卸载"就是把它写回内置原文，配置里自然不再留下这个覆盖。
- 回环访问要求：`Host: 127.0.0.1:<port>` + `x-orchestrator-request: 1`（`http.ts:75-79`）。仓库内已有先例：`plugins/dsh-surfcore-adapter/src/ingress.mjs`、`plugins/_shared/subject.mjs`。

## 2. 包边界：vivy-tone 只拥有"回复标准"

| 维度 | 归属 |
| --- | --- |
| 回复标准（长度、收尾、句式密度、语气松紧、不写汇报腔） | **vivy-tone** |
| 人格 / 身份 / 关系 / 使命 | Laputa（唯一事实源，vivy-tone 一个字段都不碰） |
| 记忆 | ActMem |
| 任务、授权、副作用 | Superagent |
| 语音 | dsh-local-voice |
| 什么时候主动开口（B 的前置） | **不在本包范围**（本包只规定"已经要说话时怎么说"） |

默认行为：**装上但未安装标准 = 什么都不改。** 只有人在设置页按"安装到主 Agent"，才会写一次覆盖；按"还原"就回到内置原文。这是"可拆卸、不强制"的落点。

## 3. 包结构（照仓库内 `dsh-laputa` 的约定）

```
plugins/dsh-vivy-tone/
  README.md
  package.json
  cordis.patch.yml          # - insert: - id: vivy-tone / name: dsh-vivy-tone
  dsh-plugin.json           # 可选；与 fish-tone 同风格的 manifest
  src/
    index.mjs               # 插件入口：webServer 路由 + 状态 + 开关
    standard.mjs            # 回复标准文本资产（版本号 + 内容），本包唯一权威
    check.mjs               # 确定性检查：句式密度、破折号、三段并列、句尾、字数
    superagent.mjs          # Superagent owner API 客户端（读 parts / 预览 / CAS 保存）
    config.mjs              # 存 config.json（开关、目标 part、上次安装的 revision）
  client.js                 # 设置 → vivy-tone 页
  tests/                    # 纯函数测试 + 假 Superagent 服务器的装配测试
scripts/setup-vivy-tone.mjs # 往 profile 的 cordis.patch.yml 插入 - id: vivy-tone（照 setup-laputa.mjs）
```

## 4. 三个动作

1. **preview（只读）**：给一段草稿返回统计与命中处（哪些句式扎堆、破折号几处、长度多少、有没有汇报腔词），**不改字**。对应 fish-tone 的"先判再压"思路；我们只保留"判"。
2. **install（写一次覆盖）**：
   - `GET prompts` → 取 `parts['runtime/orchestrator'].text`（内置原文）与 `revision`；
   - 合成 `override = 内置原文 + 回复标准段`（记录 `base`）；
   - `PUT prompts`（带 `baseRevision`）→ 409 就重读重试；
   - 记下本次 revision 到自己的 config，供还原用。
   - 生效无需重启：Superagent 每次模型请求都重读提示词版本（`004-prompts.md`）。
3. **uninstall（还原）**：把该 part 的覆盖文本写成内置原文再保存，`validate` 会自动丢弃它；同时清掉自己 config 里的安装记录。

附带一个自动动作：**rebase 提示**。`GET prompts` 的 `defaultChanged` 若点名 `runtime/orchestrator`，说明上游原文变了，设置页提示"标准需要重新基线"，一键用新原文 + 原 delta 重新合成。

## 5. 两种送达形式

| | 目标 | 影响面 | 用途 |
| --- | --- | --- | --- |
| **形式 1：覆盖 `runtime/orchestrator`** | 主 Session 的系统提示 | 只有主 Session 的对外回信；worker / GitHub 文案、PR 描述完全不动 | 生产使用 |
| **形式 2：独立 preset `dsh-vivy-tone-lab`** | 一个新的会话模式 | 只影响该会话，不碰标准模式 | 迭代文本、肉眼比对 |

形式 2 的 preset 行挂 `@deepseek-ai/dsh-agent-preset` + `@deepseek-ai/dsh-persona`（可选 `complete`）+ 本包宿主半端的提示词 section。**注意：在这个 preset 会话里 Laputa 人格是生效的**（它不是 complete），所以它是目前唯一能同时看到"Laputa 人格 + vivy-tone 标准"的地方。这也顺手解决了"在哪儿试"的问题。

建议顺序：**先形式 2 把文本迭代到对，再用形式 1 装到主 Agent。**

## 6. 三个必须你拍的决策

1. **人格要不要真的送进主 Agent？**
   现状：Laputa 人格**到不了** Superagent 主 Session（complete 丢弃）。所以"人格一律 Laputa"目前对普通会话和测试 preset 成立，对主 Agent 不成立。
   要送进去，只有一条符合架构的路：**Superagent 组合提示词时向 Laputa 要渲染结果**（Laputa 加一个只读的"当前 live 渲染"端点；Superagent 组合时可选拼上，并把它纳入 ContextSnapshot 的人格版本）。这是一小步独立改造，不属于 vivy-tone 包。
   选项：(a) 现在就做这一步；(b) 先只上 vivy-tone（主 Agent 有标准、无人格）；(c) 主 Agent 的人格改由 vivy-tone 承载（**不推荐**，违反"唯一人格事实源"）。
2. **覆盖的 provenance 记成 `panel` 可以接受吗？**
   HTTP 路由写死 `savePrompts(..., 'panel')`（`http.ts:208-211`），`SettingsOrigin` 只有 `panel | tool | sync`。所以 vivy-tone 写的版本在历史里会显示成"面板"改的。要么接受（毕竟是你本人在设置页点的按钮），要么给 Superagent 加一个 origin 值（很小的补丁，但动了 submodule）。
3. **标准落在哪个 part？**
   建议 `runtime/orchestrator`（主 Session 专用、只有 16 行、rebase 便宜）。备选是团队 `Communication` 段（本来就是"怎么说话"的位置），但它同时影响 worker 的 GitHub 文案——对陪伴语气是污染。

## 7. 验收方式（先写清楚，免得做成"感觉很温柔"）

- 纯函数：检查器对给定文本的统计可复现；保护区（代码块、URL、路径、表格）不误报。
- 装配：对着假 Superagent 服务器跑通 install → 覆盖出现 → uninstall → 覆盖消失（`validate` 自动丢弃）；CAS 冲突重试一次成功。
- 不越界：测试断言 vivy-tone 不 import 其他插件源码、不写 Superagent/Laputa/ActMem 的数据目录（对齐 `tests/ownership-boundaries.test.mjs` 的既有风格）。
- 不强制：未安装状态下面板可用，但 Superagent 的提示词 revision 不变。
- 人工：形式 2 里同一段意图用两套文本各回一次，肉眼判定"哪一套更像人在说话"。

## 8. 分阶段

| 阶段 | 交付 | 说明 |
| --- | --- | --- |
| P1 | 包骨架 + `standard.mjs` + preview 面板 | 只读，可以先上，零风险 |
| P2 | 形式 2 测试 preset | 独立会话，Laputa 人格自然生效 |
| P3 | install / uninstall / rebase（owner API） | 真正给主 Agent 提供能力，可一键还原 |
| P4（可选） | 第 6 节决策 1 的"人格送到主 Agent" | 独立 story，不属于本包 |

## 9. 许可与出处

- 只借鉴 fish-tone 的**思路与部分措辞**，实现自研；原作者 MIT，若直接沿用成句，在 README/NOTICE 里注明出处（本仓库已有 NOTICE 机制）。
- 本包自身建议 MIT，与本模板一致。
