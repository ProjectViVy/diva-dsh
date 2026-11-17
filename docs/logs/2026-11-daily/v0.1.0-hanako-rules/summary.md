# v0.1.0 调研：openhanako 的规则能不能搬过来

- 性质：**只读调研，零代码改动**（没改 `superagent/`、没改配置、没重启）
- 报告正家：`docs/research/hanako-rules-port.md`
- 状态：waiting-user，等 §6 的 D1–D6
- 样本：本机克隆 `C:\Users\Administrator\Music\openhanako`（`package.json` v0.450.0），未运行

## 一句话结论

有 10 条现成的规则小节可抄；**能生效且不用动上游源码**——因为 master 的提示词是数据驱动的版本化配置，管理面保存即生效、不重启。最值钱的是行动纪律、记忆使用规则、输出契约三条。

## 三条值得记的发现

1. **我们 master 的提示词里没有「日常」这一面。** `shared.md`（847 B）讲路由、`orchestrator.md`（1037 B）讲接单、`team/communication.md`（9726 B）全在讲 PR 就绪才发 IM。闲聊口径、工具纪律、行动纪律、记忆口径**一条都没有**——这跟「左栏像派活接口」是同一个根因，不是提示词风格问题。
2. **`runtime/policy` 不是通用规则位。** 它是「接单规则」（能接什么活、谁审 PR），渲染成一行一条带 id。看着像规则注册表，塞行为纪律进去会污染派工口径。
3. **hanako 的规则约 1/3 我们抄不了**（SessionFile/stage_files、`ui_context`、`computer`、`learn_skills`），因为它们依赖它自己的桌面工具集。这说明两个产品形态不同：它是桌面个人助手，我们是「派活 + 日常表达」。

## 没做 / 没验

- 没跑 hanako，规则效果是文本判断，不是效果证明。
- `approval-gateway`、`diary`、`memory/prompts/{dream,compile,rolling-summary}`、`fresh-compact`、`skills2set` 只扫了开头，可能还有规则。
- ActMem 注入是否也遵守「静态前缀在前」的 cache 顺序没核。
- 无 A/B 手段：抄完只能重启后靠实聊观察。
