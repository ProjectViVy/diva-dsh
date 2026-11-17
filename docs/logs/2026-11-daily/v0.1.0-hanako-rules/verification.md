# 验证记录 v0.1.0（openhanako 规则调研）

本轮是只读调研，没有代码可跑测试。这里记的是**读到的证据**，按 命令 → 输出 → 结论。

## 1. 样本存在与版本

| # | 命令 | 实际 | 结论 |
| --- | --- | --- | --- |
| 1.1 | `Get-ChildItem C:\Users\Administrator\Music\openhanako` | 顶层 17 个目录 + 40 余文件 | 克隆在，非空 |
| 1.2 | `package.json` 的 `version` / `name` | `0.450.0` / `hanako` | 结论里写死这个版本 |

## 2. hanako 的规则位（观测）

| # | 位置 | 实际内容 | 结论 |
| --- | --- | --- | --- |
| 2.1 | `core/agent.ts:1245-1554` | `buildSystemPrompt()` 逐段拼：平台 → 环境 → 用户档案 → 人格 → 输出契约 → 工具纪律 → SessionFile → ui_context → subagent → computer → 行动纪律 → 网页优先级 → 主动技能 → 团队 → **cache 分界线** → 记忆规则/置顶/记忆 → 时间 | 规则是 10 个固定小节，写死在组装函数里，不是外置文件 |
| 2.2 | 同文件 `1333-1336` | 「所有文本输出都会直接展示给用户…不允许只产生内部思考就结束回复」 | 输出契约原文 |
| 2.3 | 同文件 `1471-1478` | 「方案失败时先诊断原因再换方向…按可逆性与影响范围决定要不要先问」 | 行动纪律原文 |
| 2.4 | 同文件 `1343-1361` | 「记忆只在你提到相关内容时参与，而且方式是无声的…禁止『我记得』『你之前说过』」 | 记忆口径原文 |
| 2.5 | 同文件 `1549-1551` | 「你的一天从 04:00 开始。04:00 之前的对话属于前一天。」 | 日期口径 |
| 2.6 | `core/provider-prompt-patches.ts` | DeepSeek 输出契约补丁，注释写明「临时，等 DeepSeek reasoning 模型稳定就不需要」 | 我们同样吃 DeepSeek，这条直接相关 |
| 2.7 | `lib/yuan/hanako.md` | 整篇是 MOOD 区块（Vibe/Sparks/Reflections/Will） | 人格机制，不是规则；每轮多几百 token |

## 3. 我们这边的规则位（观测）

| # | 位置 | 实际 | 结论 |
| --- | --- | --- | --- |
| 3.1 | `superagent/src/app/prompts.ts:102-119` | `promptParts()` 顺序：shared → role → 团队三段 → subscriptions/replies/dispatch → admission → handoff → environment → policy | master 提示词 = 12 段拼接 |
| 3.2 | 同上 `77-78`、`135-144` | 覆盖（`config.overrides`）优先于内置文本；`Versions<PromptVersion>` 存编号版本；`compose()` 每次请求现取 | **数据驱动、版本化，保存即生效** |
| 3.3 | `superagent/prompts/shared.md` | 847 B，全文讲路由边界 | 没有日常/工具/行动纪律 |
| 3.4 | `superagent/prompts/team/communication.md` | 9726 B，全部围绕「PR 就绪才发 IM」 | 交付口径，不是对话口径 |
| 3.5 | `superagent/src/app/sessions.ts:263` | `allow: ['skill','bash','read','read_image','job_output','job_list','job_kill']` | master 没有 web_search/web_fetch → hanako 的网页规则对 master 无效 |
| 3.6 | `prompts.ts:65` + `prompts.ts:92-97` | `runtime/policy` 只是接单规则，一行一条带 id | 看着像规则表，但不是行为纪律位 |
| 3.7 | `superagent/prompts/` 文件清单 | 16 个 md，含 `team/{communication,scope,delivery}` | 团队三段是纯文本、可直接改 |

## 4. 未验证（不许当结论用）

- 没有运行 hanako，没有实测它这些规则对它自己的效果。
- 没有实测「管理面改提示词后 master 下一轮就吃到新版」——这是**读代码得出的**（`compose()` 在每次请求里现取版本），不是实验结论。要证实得在重启后改一次、看行为变化。
- 没有统计常驻 token 的真实增量（报告里 +400 / +2.5k 是按字数估的，标了「估」）。
- ActMem 注入位置与「静态前缀在前」缓存顺序的关系没核。
