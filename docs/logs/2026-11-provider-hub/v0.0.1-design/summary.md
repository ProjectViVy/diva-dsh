# v0.0.1-design 多供应商中控台 + 网关：设计

- 状态：已交付（**纯文档，未改代码/配置，未申请 key**）
- 范围：`docs/research/provider-hub-and-gateway.md`（新建）；`TODOLIST.md`（登记 DV-DOC-008）；本日志目录
- 验证：见 `verification.md`
- 未验证：见下
- 下一步：DV-DOC-008，等用户答 D1–D4
- 回滚：删除 `docs/research/provider-hub-and-gateway.md` 与本日志目录

## 改了什么

行为层面：**没有变化**。本轮只产出设计文档与状态登记。

核心结论（供下次会话直接复用）：

1. **范围收缩（用户要求）**：中控台**不管 chat**，只补 DSH 没有的能力——向量/重排、ASR、TTS、决策（以及可选图像/视频）。
   chat 与视觉继续由「设置 → 模型」独占，中控台不写 `llm-pi-ai.providers`、不插任何一跳。
2. **凭据与主设置同一个存储**：两边都调 `credentials` 服务（`set/resolve/describe/unset/listRecords`，
   `credentials-local/src/index.ts:624-676`；主设置的 key 输入框在
   `ui-settings-models/src/client/operations.ts:79` 调 `remote.credentials.set`）。所以「填 API」只有一个地方，
   主设置填过的 ref，中控台 `describe` 能看到 `configured + source`，不再重复索要。
3. **数据模型**：`endpoints`（kind/baseURL/auth ref/quota 形状/能力清单）+ `bindings`（能力 → 降级链）。
   能力枚举**不含 chat/vision**，出现即加载报错。
4. **组合 A 的三条硬事实**：MiniMax **没有 ASR**（接口概览只有语言/视频/图片/语音合成/音乐/文件）；
   Token Plan **没有 embedding/rerank**；三家是三种额度模型（月 Credits / 后付费 / 5h+周双窗口），
   三把 key 不能混用。
5. **不做网关**：只有 DSH 一个调用方，加进程只增延迟与故障面；升级条件写死为 T1 跨厂商自动降级 /
   T2 非 DSH 调用方 / T3 统一审计。
6. **参考事实**（保留备用）：`llm-pi-ai.providers` 是 `Volatile`、settings 可 live 写
   （`config.ts:222-229`、`settings/src/index.ts:224,357`）——这条留给 chat，中控台不用它。
7. **百炼为主（用户拍板，2026-11-11 06:55）**：百炼覆盖最全，产品要求是「用户只配一把 `DASHSCOPE_API_KEY`，
   ASR/TTS/向量/重排四项全通」。因此主链路 = 百炼，Token Plan（决策）、MiniMax（TTS）、硅基流动（冗余/低价）
   都是**可选增强**，不是前置条件。代价：强烈的百炼单点，且 `dashscope-asr`/`dashscope-tts` 两个原生 adapter
   必须自己写（OpenAI 形状白拿不到）；硅基流动的价值从「实现捷径」降为「冗余与备线」，本地 `sensevoice` 永远兜底。
   三家向量都无 384 维，mempalace 的维度硬编码仍必须改。
8. **端点接全（用户要求，2026-11-11 07:01）**：能力枚举扩到 9 项（`decision/asr/tts/embedding/rerank/
   image.generate/image.edit/video.generate/omni.understand`），并新增「形状与产物」一节：同步/异步两种形状、
   异步任务簿、产物落点与上限（`model-hub/artifacts/`）。百炼同时覆盖图像/全模态/视频，所以**接全之后仍只需
   `DASHSCOPE_API_KEY`**。M4 记 4–6 人日，网关顺延为 M5。
9. **MOSS-Live 评估（§6.5）**：全双工实时交互系统，本体不接（属 session 级协议，与「暂不做」的 realtime 同类），
   但它的子模型（Transcribe-Diarize / TTS / VoiceGenerator / Image）是可挂钩的能力；**唯一有开源权重的一家**，
   因此是对抗百炼单点的兜底候选，等百炼链跑通后再评估自托管。API 形状与价格未核。
10. **综合能力网关：第一批插槽（2026-11-11 07:06）**：新增 `docs/research/capability-hub-slots.md`。
    第一批四项 = `asr` / `tts` / `decision` / `embedding`（覆盖媒体进-文本出、文本进-媒体出、文本进-结构化出、
    文本进-向量出四种组合）；四个插槽 = 能力规格（含限额与形状）/ adapter（不读凭据、不校验限额、异步三件套全有全无）/
    绑定（按 `auth|limit|vendor|input` 四类错误决定是否降级，`auth` 与 `input` **不降级**）/ 消费面（同进程服务 +
    带 component token 的 HTTP，返回结构一致）。验收三件：一把 key 全绿、asr→tts 端到端、错误 key 时标红不降级。
    待决策 E1 命名 / E2 decision 是否进第一批 / E3 本地兜底放哪层。

## 影响面

- 用户可见行为：无。数据：无写入。性能：无。重启：**无**。

## 未验证

1. `ctx.settings.replace` 是否对**第三方插件**（vivy-dsh/*）开放，还是仅限核心插件；需一次最小实验。
2. 写入后 `config-reload` 是否影响正在流式的请求。
3. MiniMax OpenAI 兼容 baseURL（`api.minimaxi.com`？）与 M Plan 订阅 Key 是否同一端点。
4. 百炼 `qwen3.7-text-embedding-flash@512` 与本地 MiniLM(384) 的中文召回差距。
5. 三家均未见公开的「余额/剩余额度」API，面板的额度块可能只能显示「未提供」。

## 备注

- 本轮未提交（AGENTS.md §6）。
- `pwsh` 仍不可用（工作区 TMP，DV-OPS-001 待重启），全部核对走 `read`/`grep`/`glob`/`web_fetch`。
- 原本派了一个 subagent 做 DSH provider 链路调研，在拿到关键结论（Volatile + settings.replace）后已中止，
  其结论由主会话自行核对，未采用其未完成部分。
