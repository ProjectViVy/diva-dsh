# Live2D 表演层选型：Soullink/JEV 与鲸语两条路径：调研与设计

- 状态：调研与设计结论；**未改任何插件代码**（只新增本文与审计工具 `plugins/dsh-live2d/tools/`）
- 日期：2026-11-07
- 调研对象：`@soullink-emotion/*`（下称 **JEV 路径**）、`jingyu-live2d-agent`（下称 **鲸语路径**）、OpenRouter Decisions API 与 TypeSafe JEV、DSH 的 LLM 供应商接缝
- 关联：[角色舞台 README](../../plugins/dsh-live2d/README.md)、[相遇界面接入 Session](encounter-chat-and-session.md)
- 本地取证：
  - `/private/tmp/soullink-emotion-sdk`（HEAD `02cd75a`，`release/0.2.0-beta.1`，Apache-2.0）
  - `/private/tmp/jingyu-live2d-agent`（git `2491e69`，无根 LICENSE）
  - `deepseek-harness/packages/llm/*`（DSH checkout）
  - `$DSH_HOME/profiles/superagent-local/cordis.patch.yml`
  - `plugins/dsh-live2d/data/*`
- 审计工具：[jev-gear-audit.mjs](../../plugins/dsh-live2d/tools/jev-gear-audit.mjs)（输出 [jev-gear-audit.out.json](../../plugins/dsh-live2d/tools/jev-gear-audit.out.json)），只读、不联网、不需要任何密钥

## 1. 结论摘要

1. **JEV 不是动作模型，是决策模型，这是一条必须先纠正的前提。** 它是 TypeSafe 的 System One 模型，端点 `POST https://openrouter.ai/api/alpha/decisions`，四种原语 `choice / noul / score / box`，返回带概率的**类型化答案**，**不生成文本**。官方原话：*"It is not a drop-in replacement for a chat model. It replaces the prompt-and-parse step."* 上下位关系是：**JEV 只回答"要不要接管这个通道 / 这一帧该用哪个档位"，数值全部由本地代码算。**
2. **Soullink npm 包里的 JEV 路径走不通。** `packages/planner-openai/src/OpenAICompatibleClient.ts:72` 把路径写死成 `${baseURL}/chat/completions`，而实测 `POST /api/alpha/chat/completions` 返回 **404**。真正在跑的 JEV 链路**不在包里，只在 `scripts/`**（`conversation-service.mjs:415` 与 `test-jev-keyframes.mjs:9` 都打 `/decisions`）。**要采用 JEV 路径 = 自己写一个 Decisions 适配器，把 `scripts/` 当参考实现。**
3. **DSH 加外部 chat 供应商是配置级的事，但 JEV 进不去这个门。** `@deepseek-ai/dsh-llm-pi-ai` 的 `providers` 按 route 声明 `api`（`openai-completions` / `openai-responses` / `anthropic-messages`）、`baseURL`、`apiKeyEnv`、`models[]`，且注释明确写 **route 名不必是 pi-ai 已安装的供应商**；本部署已经用它挂了 `teakapi`（openai-completions）与 `opendesign`（anthropic-messages）两条外部路由。三种协议里**没有 Decisions API**，所以 JEV 必须走专门客户端。
4. **档位法在大肥鱼身上验证通过。** 用真实 cdi3 范围逐参数跑一遍：509 参数里 125 个进连续档位池，**双边可动 106、单边 19、完全动不了 0**；small 档位移占量程 **17.5%（双边）/ 35%（单边）**，远高于"算动过"的 1% 阈值。
5. **真正的问题不在可读性，在通道仲裁。** 审计挖出六类会翻车的地方：① Soullink 的手部开关启发式**在大肥鱼上认错了**（只认出 `Param38`/`Param40`，漏掉真正的 `Movement1/2/3`），JEV 的主手部动作单选题**选不到"抚胸"**；② 鲸语 9 个手势关节参数**全落在 JEV 可选池里**，会和 `arm_binding` 抢写；③ **89 个二值开关一个互斥组都没有**，作者的脸部开关 `key1..key13` 可能同屏点亮；④ `IDLE`、`Ani1/Ani2`、外观类不该进池，而 Soullink 的"保护性外观"规则在大肥鱼上**一个都没命中**；⑤ **13 个语义通道被判成严格 0/1 开关**（`MouthSmile_L`、`BrowInnerUp`、`CheeckPuff`…）——微笑会蹦成满格、眯眼会变成闭眼，而这些恰好是 Soullink 自己 FACS 映射的目标；⑥ **25 个编辑器分隔线通道**混进候选池（23 个量程 [-1,1] 的躲在连续池里）。
6. **分工结论：三层 + 一条旁路。** `(A) 判断 = JEV` → `(A′) 数值化 = 本地代码` → `(B) 混合回放 = engine`；`(C) 模型专属知识与互动 = 鲸语搬进来的 JS 与数据`；而**点击走 `(D)` 本地旁路，永远不进 (A)**。
6. **分工结论：三层 + 一条旁路。** `(A) 判断 = JEV` → `(A′) 数值化 = 本地代码` → `(B) 混合回放 = engine`；`(C) 模型专属知识与互动 = 鲸语搬进来的 JS 与数据`；而**点击走 `(D)` 本地旁路，永远不进 (A)**。
7. **需要新建「额外模型配置」模块，它要装两半**：一半是**外部模型路由**（按 kind × adapter，覆盖 chat / embedding / tts / asr / decision），另一半是**模型表演规则**（跟着模型走、不跟着 provider 走）。
8. **20 条决策已写入知识图谱**（见 §9）。
9. **落地第一步已完成**：规则收进共用模块 [performance-rules.mjs](../../plugins/dsh-live2d/src/performance-rules.mjs)，大肥鱼的「表演规则」写进 [deepseek.json](../../plugins/dsh-live2d/data/knowledge/deepseek.json) 的 `performanceRules`（`derived` 归工具、`declared` 归人），派生工具 [derive-performance-rules.mjs](../../plugins/dsh-live2d/tools/derive-performance-rules.mjs) 可重算，8 条测试盯着。**未改任何运行时行为**，所以不需要重启。见 §14。
10. **修正记录（两处，都是工具自身的错）**：① 早先汇报的"换成旧 20/50/80 阶梯会有 6 个通道 small 位移为 0"是初版脚本**符号写错**造成的假结论——正确是「旧阶梯的 small 只有新阶梯的一半左右（双边 10% vs 17.5%，单边 20% vs 35%）」；② 第一版审计只把危害检查跑在开关池上，漏掉 **23 个量程 [-1,1] 的编辑器分隔线**。两处都已修正留档，见 §6.2、§6.3 ⑥。

## 2. 两条路径

### 2.1 JEV 路径 = Soullink Emotion SDK

纯 TypeScript / ESM，**Apache-2.0**，8 个包，`engine` / `runtime-core` / `planner-openai` / `profile-generator` 的 `dependencies` 全部为 **None**（彼此只有 peer 依赖）：

| 包 | 干什么 | 是否要网络 |
| --- | --- | --- |
| `engine` | VAD 情绪、FACS/AU 表情、待机、反应时序、口型、参数混合 | 否 |
| `runtime-core` | 会话编排，三个可注入端口 `textModel` / `voiceModel` / `motionPlanner` | 取决注入 |
| `planner-openai` | 反应/反思/主动消息 Planner + 说话动作 Planner | 是 |
| `profile-generator` | 扫 `model3` / `cdi3` / `exp3` / `motion3` → `soullink.profile.json` | 否（可选 LLM 精修） |
| `live2d-pixi` | PIXI **v7** 渲染 | 否 |
| `classifier-embedding` | 中文语料 Embedding 分类 + 规则降级 | 可选 |
| `devtools-vue` | Vue 校准面板 | 否 |
| `api-client` | HTTP 客户端 | 是 |

**engine 的输出与渲染器解耦**：`Record<CubismId, number>` + `nativeAnimation` 指令（`resolveNativeAnimation`）。官方 quick start 就是 `renderer.setParameters(snapshot.live2dParams)`。

两条与"JEV"相关的关键事实：

- `planner-openai` 里有**两个** Planner：`SoullinkLLMPlanner`（走任意 OpenAI 兼容对话模型）与 `SoullinkSpeakingMotionPlanner`。所以"一个 JEV、一个传统模型兼容"**不是一个二选一，也不是两条管线**——是同一段代码换 provider 配置。降级也是内建的：凭据/参数/LLM 输出不可用时返回 `provider: "vad-facs"` + 空 `parameterPlan`。
- **但 `SoullinkSpeakingMotionPlanner` 实际走 `/chat/completions`，对 OpenRouter 的 JEV 是 404。** 见 §3.3。

### 2.2 鲸语路径

必须拆成两半看：

| 半边 | 内容 | 语言 | 处置 |
| --- | --- | --- | --- |
| Python 侧 | `server.py`(481) / `compiler.py`(294) / `planner.py`(237) / `model_profile.py`(81) / `arm_binding.py`(29) / `presets.py` / `patch_renderer.py`(122) | Python（**核心只用标准库**；需要 pip 的只有 VTS / Spout / 桌宠那几个后端） | **不搬**（见 §10） |
| **JS 侧** | `web/*.mjs`：指针互动 `touch-feedback` / `hold-drag` / `touch-voice`、待机事件 `idle-events`、驱动管线 `driver-pipeline`、丝袜着色器 `original-stockings` | **已经是 JS** | **直接搬，不欠 Python 一分钱** |

仓库体检：这个仓库在 `reference/`、`.artifacts/`、harness checkout 之外**一个 `.py` 都没有**。所以"不引入新的 Python 依赖"在事实层面更严——**是"别让这个 Node 项目多一个 Python 运行时"**。

### 2.3 重叠与不可替代

| 能力 | JEV / Soullink | 鲸语 | 留下 |
| --- | --- | --- | --- |
| 模型参数档案 | `profile-generator` 扫文件自动生成，模型无关 | `model_profile.py` + `core-inventory.json` | **Soullink**（鲸语降级为叠加知识） |
| 情绪 → 参数 | 连续 VAD + FACS/AU 中间层 | 直接挑 33 个语义参数 | **Soullink** |
| 待机 / 眨眼 / 呼吸 / 注视 | `IdleEngine` + 动作风格 + seed 可复现 | 手写摆动 + 6 种随机待机事件 | **Soullink** |
| 说话时动作 | 决策 + 本地数值化（§4） | `compiler.py` 轨迹/手势/表情/口型 | **Soullink** |
| 计划校验 | 顺序器（弱） | compiler（**强**：范围夹取、通道冲突、写物理输出直接报错） | **鲸语的思路**（用 ~80 行 JS 重写成独立校验器） |
| 接 LLM | 进程内 OpenAI 兼容 | 直连，**或 spawn 一个 headless DSH 子进程**（`planner.py:199`） | **Soullink** |
| 指针互动 | **零**（grep `pointerdown`/`click`/`dblclick`/`touchstart` 全无命中） | 命中区 / 长按拖拽 / 服装拖拽 + 冷却去重 | **鲸语（唯一来源）** |
| 胸部物理 | 只把物理输出**排除** | 包装 `physics.evaluate` 注入 + 1.0–1.8× 增益 | **鲸语**（两者正交，可共存） |
| 手势关节 | FACS 无对应通道 | `Param62/59/60/61`、`Param36/39/41/42/43` + 进入/退出 + arm binding | **鲸语** |
| 私有效果 | `privateEmotionMap`（声明式） | `key1..key13` 直写 | 见 §7.3 |
| 丝袜着色器 | 无 | 写死图集像素坐标 | **鲸语**（只对这张图集成立） |
| 情绪回落 / 反思 / 主动消息 | 有 | 无 | **Soullink** |
| 参数 ownership | `owned` / `passthrough` + 严格离散 0/1 | `author-physics` / `native-gesture` / `unmapped` 五分类 | **Soullink 为运行时权威** |
| 入场/释放缓动 | 0.85s / 0.6s / 保护性参数 | 无 | **Soullink** |

## 3. JEV 到底是什么

### 3.1 事实

来源：[OpenRouter JEV 文档](https://openrouter.ai/docs/guides/community/jev)、[Decisions API 参考](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request.md)、[TypeSafe SDK 指南](https://openrouter.ai/docs/guides/community/typesafe-sdk.md)。

| 项 | 值 |
| --- | --- |
| 性质 | TypeSafe 的 System One **决策**模型，不是对话模型 |
| 原语 | `choice`（几选一 + 每项概率 + 置信度）· `noul`（条件成立概率）· `score`（有序刻度上的概率加权位置）· `box`（图像里某物的框，按宽高比例） |
| 输出 | 类型化答案；**不产生推理过程，不产生自由文本** |
| 模型 ID | `typesafe/jev-1.14`；别名 `~typesafe/jev-latest`；`typesafe/jev-1.13` 仍在 |
| 上下文 | 262,144 |
| 输入 | 文本与图像，装在 `state` + `questions` 信封里 |
| 计费 | **按输入 token 计费，输出 token 免费** |

同一套 Decisions API 上还有 **OpenAI、微软、Perplexity、Cloudflare、Inception、Liquid AI、Upstage** 等（OpenRouter 有 `output_modalities=decisions` 筛选）。另有 `POST /api/alpha/extractions`（同样的信封，用 `fields` 换掉 `questions`，取类型化字段）。

### 3.2 三种接法

| 方式 | 端点 | 适用 |
| --- | --- | --- |
| 原始 HTTP | `POST https://openrouter.ai/api/alpha/decisions` | 任意语言手写 |
| 官方 TypeSafe SDK（JS/TS `@typesafe-ai/sdk`、Python `typesafe_sdk`） | 改 baseURL 为 `https://openrouter.ai/api`（SDK 自己拼 `/v1/systemone`） | 已经在用 TypeSafe SDK |
| OpenRouter 自家 Decisions 客户端 SDK（TS / Python / Go） | 同 `/api/alpha/decisions` | 用现成客户端 |

### 3.3 端点实测（无密钥，2026-11-07）

`404` = 端点不存在；`401` = 存在但要鉴权。

| 端点 | 结果 |
| --- | --- |
| `POST /api/alpha/chat/completions` | **404 Not Found** |
| `POST /api/alpha/decisions` | 401 |
| `POST /api/v1/systemone` | 401 |
| `POST /api/alpha/responses` | 401 |
| `POST /api/v1/chat/completions` | 401 |

**推论**：Soullink 的 `planner-openai`（`OpenAICompatibleClient.ts:72`）用 `JEV_BASE_URL=https://openrouter.ai/api/alpha` 会打到 404，该路径不可用；JEV 只能走 `/decisions` 或 `/v1/systemone`。

### 3.4 计费与延迟的含义

输入计价、输出免费 ⇒ **成本由随每次请求重复携带的 `state` 主导，而不是由问题数量主导**。Soullink 的两个脚本都**把完整 state 附在每一个批次上**，这就是成本结构。

延迟：Soullink 自己的文档写明"**先生成整段再播放，有明显等待时间，不是流式实时生成**"，且"生成一秒动画不是一秒的推理时限"。

⇒ **JEV 适合"整段说话表演"，不适合任何需要即时性的东西。**

## 4. 现在大家怎么用：唯一公开的 Live2D 参考实现

Soullink 有两个脚本，代表两种截然不同的做法。两者都在 `scripts/`，**不在 npm 包里**。

### 4.1 生产向：`conversation-service.mjs` 的四阶段

| 阶段 | 问什么 | 数量级 |
| --- | --- | --- |
| `jev-actions`（`:441`） | 每帧 4 个语义单选：手势（7 择 1）/ 表情（7 择 1）/ 视线（4 择 1）/ 手部道具（模型开关 N 择 1）；**外加每个受控参数一题"这整段回复要不要接管这个通道"**（`idle` / `animate`） | 帧数×4 + 通道数 |
| 本地 | 从语义时间轴推出"应该动"的通道（`inferSemanticParameterIds` + 用户点名的效果开关） | 0 |
| `jev-consistency`（`:469`） | 对第一阶段说 idle、但语义上明显需要的通道**再问一次**，只有 JEV 第二次也说 `animate` 才接管 | 少数 |
| `jev-parameters`（`:491`） | 对**被接管的**通道 × 每帧，问一个**质量档位** | 帧数×受控通道数 |

流程细节（`:413`、`docs/jev-conversation.md`）：

- **每请求最多 96 题，串行**；每题都带完整 `common` state（用户消息、回复、最近 6 轮、时长、时间轴含每帧朗读片段、约束）。
- 帧率默认 **2 关键帧/秒**（可选 1/2/4），最长 **60 秒**；末帧固定释放（`:457` 强制 `gesture=neutral, expression=neutral, gaze=contact, hand=none`）。
- 音频真实时长出来后按 **1.35× 规划时长 + 0.8 秒收尾**重排（`:66`），**不重新问 JEV**。
- 归属：`ownedParameterIds` / `passthroughParameterIds`（透传的继续跑实时 Idle/VAD 与物理）；`strictDiscreteParameterIds` / `smoothedDiscreteParameterIds`（`:505`）。
- 入场 0.85 秒 smootherstep，释放 0.6 秒；置信度**只做诊断，不做门控**（"低风险表现控制"）。

### 4.2 档位定义（`:78-107`）——这是"数值留在代码"的落点

```
neutral         = clamp(default, min, max)      // 不是 min/max 中点
smallNegative   = neutral - (neutral - min) * 0.35
mediumNegative  = neutral - (neutral - min) * 0.65
largeNegative   = neutral - (neutral - min) * 0.90
（Positive 侧对称，距离换成 max - neutral）
```

注释里写明**故意不用 20/50/80**：那样"small"的面部动作几乎看不见。答案里的档位 key 由本地映射成具体数值（`decodeChoice`），**题目里明确写 "do not estimate decimal values"**。

### 4.3 排除与归属规则（`:19-48`、`:395`）

- 排除：**物理输出**（读 `physics3.Output.Destination.Id`）、`ParamMouthOpenY`（口型归音频 RMS 包络）、**保护性外观**（`Param96/97/98` + `watermark|hidden|hide|invisible|disappear|水印|隐藏|消失|版权`）、`Param_Angle_*`。
- 二值动作开关：`min===0 && max===1` 且 id/name 不匹配连续通道正则 ⇒ 走 `{off: min, on: max}`，**严格 0/1**。
- 手部/道具开关：`isHandActionParameter` = 二值开关 ∧（已知 ID 表 ∨ `hand|arm|gesture|wave|挥手|招手|手|手臂|比心|猫手|祈祷|鞭子|碗|糖|歌|游戏|内裤|猫` 命中）。
- 连续参数：`parameterValueOptions` 生成档位。

### 4.4 实验向：`test-jev-keyframes.mjs` 的绝对锚点法

每个参数每帧**直接问"绝对值选哪个"**：9 段网格 + default 共 ≤10 个锚点，`choice` 或 `score` 两种解码；二值用 `[0,1]`。1 秒 4 帧 × 152 参数 = **608 题，一批打完**（608 就是 `--batch-size` 上限），400/413/422 时自动降到 128/32。本地校验：越界、二值非法、手部互斥、以及用 `vm` 在 Node 里跑 Cubism Core 检查几何有限性。它自己标注的限制很诚实：*"Phases are test instructions, not generated by JEV"*、*"Generating one second of animation is not a one-second inference deadline"*、回放帧"**需要运行时支持 baseline 与 step 之后才能等价播放**"。

### 4.5 两种做法的取舍

| | 绝对锚点法 | 档位法（生产向） |
| --- | --- | --- |
| 精度 | 最高 | 够用 |
| 输入 token | 最贵（每题都带全量 state） | 便宜 |
| 可控性 | 差（可能出现"没动过"的参数被拉走） | 好（neutral 就是 default） |
| 结论 | 适合做实验与标定 | **适合做产品路径** |

## 5. DSH 能不能接这个供应商

### 5.1 LLM 接缝是现成的

`@deepseek-ai/dsh-llm` = *"Provider-neutral LLM service interface"*：

- `LlmRuntime.registerAdapter(providers, adapter)`（`packages/llm/llm/src/index.ts:401`）
- `registerConfigurableProviders()`（`:495`）
- `registerModelDiscovery()`（`:569`）
- 抽象基类 `LlmAdapter`（`:208`）

### 5.2 配置级加供应商（本部署已有先例）

`@deepseek-ai/dsh-llm-pi-ai` 的 `providers` 是按 route 组织的 profile 字典（`packages/llm/llm-pi-ai/src/config.ts` 文件头注释）：

> *A route key is not required to name an installed pi-ai provider. … when it does not, the profile is the whole provider declaration.*

支持的协议只有三种（`provider.ts`）：`openai-completions`、`openai-responses`、`anthropic-messages`。

`$DSH_HOME/profiles/superagent-local/cordis.patch.yml` 里已经在这么用：

```yaml
- id: llm-pi-ai
  name: "@deepseek-ai/dsh-llm-pi-ai"
  config:
    providers:
      teakapi:
        displayName: teakapi
        apiKeyEnv: TEAKAPI_API_KEY
        api: openai-completions
        baseURL: https://teakapi.xyz/v1
        models: [{ id: deepseek-v4.1-flash-4 }, { id: deepseek-v4.1-flash }]
      opendesign:
        apiKeyEnv: OPENDESIGN_API_KEY
        api: anthropic-messages
        baseURL: https://amr-link.open-design.ai
        models: [{ id: deepseek-v4.1-flash }]
```

⇒ **加 OpenRouter 作为 chat 供应商是 ~10 行 YAML，零代码。**

### 5.3 但 JEV 进不去这个门

三种协议里没有 Decisions API；JEV 也不是 chat 模型（§3.1、§3.3）。**JEV 必须走专门的客户端或插件。**

### 5.4 两种落地形态

| | 做法 | 代价 | 适合 |
| --- | --- | --- | --- |
| **形态 A** | 在 live2d 插件宿主半边放一个 `decision-client.mjs`，`fetch` 打 Decisions API | 最小 | 只要"给角色做动作" |
| **形态 B** | 做成 DSH 插件，注册一个与 `ctx.llm` 平行的决策/外部模型服务 | 一次成型 | **"可能还有其他功能"** |

选 **B** 的三条具体理由：

1. 官方文档明确说**多个厂商共用一个 Decisions API**，且有 `output_modalities=decisions` 筛选 ⇒ **一个服务 = 一堆模型**，不绑死 JEV。
2. 四个原语里，`box`（图像定位）可直接用于我们自己的截图验证工具；`noul` / `score` 适合记忆显著性、会话路由这类窄判断题。
3. 与 DSH 架构一致（LLM 本来就是服务），且**计费模型互补**（输入计价、输出免费 ⇒ 适合小而多的类型化判断，不适合写散文），不会和 `ctx.llm` 抢活。

要过的闸：凭据（`ctx.credentials` / `apiKeyEnv`，已有两条先例）、出网（宿主半边已在出网）、**降级**（批过大自动降批 → 401/402/403 立即停掉剩余付费请求 → 全程失败退回本地规则）、**单测不打真网**（`--dry-run` 思路）。

## 6. 大肥鱼档位审计

工具：[jev-gear-audit.mjs](../../plugins/dsh-live2d/tools/jev-gear-audit.mjs)；数据源：`plugins/dsh-live2d/data/core-inventory.json`（509 参数真实 min/max/default，与鲸语逐字节相同）+ 模型目录的 `cdi3`（真实参数名）+ `physics3`（292 个物理输出）+ `data/knowledge/deepseek.json`（鲸语手挑的 33 个 primary、3 个手势、9 个关节）。

### 6.1 池子划分

| 归属 | 数量 |
| --- | --- |
| 物理输出（排除） | 292 |
| 口型 `ParamMouthOpenY`（归音频） | 1 |
| Soullink 认出的"手部开关" | 2 |
| **连续档位池** | **112** |
| **二值开关池** | **102** |
| 保护性外观（Soullink 规则命中） | **0** |

292 个物理输出与鲸语档案里的计数完全一致，可互相印证。

### 6.2 档位可读性：通过

> 本节数字是 2026-11-07 第二版审计的结果。第一版漏了两类通道（见 §6.3 ⑤⑥），所以池子规模与"单边可动"的数目都已修正。

| 指标 | 值 |
| --- | --- |
| 连续通道（只按 Soullink 规则算） | 125 |
| — 其中被排除出候选池 | 37 |
| **有效连续通道（判断层真正能碰）** | **88** |
| 双边可动 | 106 |
| 单边可动 | 19 |
| 完全动不了 | **0** |
| small 档位移占量程（新 35/65/90） | **17.5%（双边）/ 35%（单边）** |
| small 档位移占量程（旧 20/50/80） | **10%（双边）/ 20%（单边）** |

抽样（`neutral` 就是参数真实 default）：

| 通道 | 量程 / default | neg ← neutral → pos |
| --- | --- | --- |
| `AngleX/Y/Z`、`LeanInput` | [-30,30] / 0 | -27 / -19.5 / **-10.5** / 0 / **10.5** / 19.5 / 27 |
| `ParamEyeBallX`、`EyeSmile`、`ParamMouthForm` | [-1,1] / 0 | -0.9 / -0.65 / **-0.35** / 0 / **0.35** / 0.65 / 0.9 |
| `ParamEyeLOpen` | [0,1.5] / 1 | 0.10 / 0.35 / 0.65 / **1** / 1.175 / 1.325 / 1.45 |
| `ParamBreath` | [0,1] / 0 | 0 / **0.35** / 0.65 / 0.9 |
| `MouthSmile_L/R`、`BrowInnerUp`、`CheeckPuff`、`JawOpen`、`TongueOut`、`Mouthpucker`、`MouthFunnel`、`LEyeSquint`、`REyeSquint` | [0,1] / 0 | 0 / **0.35** / 0.65 / 0.9 ← 见 §6.3 ⑤ |
| `Ani1`（动画1） | [-1,1] / -1 | **-1** / **-0.30** / 0.30 / 0.80 ← 见 §6.3 ④ |

单边通道 19 个，其中代表性的：`AngleXbs3`（default=30）、`AngleXbs2`（default=-30）、`Param11` 呆滞（0..8）、`AniEyerolling` 蚊香眼（0..30）、`Ani1` 动画1（-1..1）、`ParamBreath` 呼吸（0..1），以及 §6.3 ⑤ 那 13 个被纠回来的 0..1 语义通道。

**修正记录（两处，都是工具自身的错，已修正并留档）**

1. 早先口头汇报过"换成旧阶梯会有 6 个通道 small 位移为 0（`Clothes1`、`Clothes5`、`Param`、`AngleXbs3`、`ParamSilence`、`LCryKey`）"。那是初版审计脚本把负向档位的**符号写错**（用了 `+距离×比例` 而不是 `-距离×比例`）造成的假结论。正确结论是上表的 10%/20% → 17.5%/35%：**旧阶梯的 small 只有新阶梯的一半左右**，方向上仍然支持 Soullink 修改阶梯，但不存在"塌成 0"的通道。
2. 第一版审计**只把危害检查跑在开关池上**，于是把 25 个编辑器分隔线通道里的 2 个（`Divider1`/`Divider3`，量程 0..1）当成了全部——另外 **23 个分隔线量程是 [-1,1]，落在连续档位池里**，完全没被看到（见 §6.3 ⑥）。修法是把判定收进一个共用模块，工具不再各抄一份。

### 6.3 六类事故

**① 手部开关认错，JEV 选不到"抚胸"**

| 通道 | 名字 | Soullink 认出 | 实际归属 |
| --- | --- | --- | --- |
| `Movement1` | 1. 狗尾草 | **否** | 鲸语手势 `grass` 的开关 |
| `Movement2` | 2. 抚胸 | **否** | 鲸语手势 `hand_on_chest` 的开关 |
| `Movement3` | 3. 竖食指 | **否** | 鲸语手势 `point` 的开关 |
| `Param38` | 动画 双手开关 | 是 | 内部辅助通道 |
| `Param40` | 竖手指 大臂无缝用 | 是 | 内部辅助通道 |

`h{i}`（本帧主手部动作，单选）是唯一提供互斥的地方，而它的选项来自 `isHandActionParameter` ⇒ **抚胸/竖食指/狗尾草根本不在选项里**。

**② 鲸语 9 个手势关节全部落在 JEV 连续档位池**

| 关节 | 量程 / default | 归属 |
| --- | --- | --- |
| `Param62` L 大臂z · `Param59` 大臂透视 · `Param60` L小臂Z · `Param61` L手腕Z | [-1,1] / 0 | eligible-continuous-gear |
| `Param36` R 大臂z · `Param39` 大臂透视 · `Param41` R小臂Z · `Param42` R手腕Z · `Param43` R食指 | [-1,1] / 0 | eligible-continuous-gear |

如果不做归属声明，**JEV 会给 9 个关节各挑一个独立档位，而鲸语的 `arm_binding.py` 本来要把它们按手势用相对耦合算出来**（`upper=clamp(Δupper+0.18*Δforearm,±0.42)`、`center=.45*upper`、`forearm=center+residual`、`wrist=clamp(Δwrist-.2*forearm,±0.38)`）⇒ 手臂会"散架"。

**③ 开关池里 89 个二值开关，零互斥组**

Soullink 对每个通道**独立**问 `o_{id}`（idle / animate），互斥只由 `h{i}` 提供。作者自定义的开关/外观有 **38 个**（按"非标准命名 + 名字含开关/切换/外观词"识别）：

- 脸部效果 `key1..key13`：黑脸 / 落泪 / 圈圈眼 / 爱心眼 / ><眼 / 屑屑眼 / 脸红 / 加载 / 大牙 / 大钢盆 / 黑框眼镜 / 单片眼镜 / 流冷汗
- 手势 `Movement1..3`；服装 `Clothes1..5`（长短裙 / 大小变 / 胸口衣服 / 鞋子 / 尾巴）
- 冒汗 `SweatBurst1..6`；动画开关 `F1/F2/F3Anikey`、`SWITCHA`
- 落泪双通道 `RCryKey` / `LCryKey`（同一件事两个通道）
- `Colorflicker5..8`、`Glintshift5..8`、`RColorshift`、`RShiftbuffer`（颜色/闪光系）
- `LittleFlower1..6,11`、`MicroGlows`（飘花与光点）
- `Angry`、`Angry2`、`Angry3`、`AngryMove*`（生气系）
- `LCry`、`LCry3`、`RCry`、`RCry2`、`Sweat1`、`Sweat2`（与 `*CryKey`/`SweatBurst*` **并存的第二套**同义通道）
- `ParamA/E/I/O/U`、`Param12/13/28/30/37/55/56/57/58/136/137/139/140/141/142`、`ParamSilence`（裸名字，语义未知）

⇒ 完全可能同时点亮「大钢盆 + 黑框眼镜 + 大牙 + 圈圈眼」，而脸上只有一个脸。

**④ 不该进池的通道进了池**

| 通道 | 实际情况 | 处置 |
| --- | --- | --- |
| `IDLE` | 作者的**待机动画触发开关**（鲸语档案 `idleMotion: "IDLE"`） | 排除；否则和待机系统抢控制权 |
| **`Divider1` … `Divider33`，共 25 个** | 编辑器分组**分隔线**，名字就是 `■■■■`；其中 2 个量程 0..1、23 个量程 [-1,1] | 全部排除（见 ⑥） |
| `ParamSilence`、`Param` 大小变位置、`LCryKey`、`Clothes1`、`Clothes5` | default=1 的开关 | 进 `review` 待确认；外观类直接排除 |
| `NoseNeer` / `MouthRollUpper` / `MouthRollLower` | 鲸语实测**没有可见变化**（`experimentalInputs`） | 排除（省 token） |
| `Clothes1..5` / 眼镜 / 尾巴 / 大小变 | 外观 | 排除：**换装是用户的选择，不是角色的表演**；Soullink 规则在**大肥鱼上一个都没命中** |
| `Ani1` 动画1 [-1,1] default=-1、`Ani2` 动画2 [-1,1] | **量程不是 0..1 的动画触发器**，逃过了 `isDiscreteActionParameter` | 排除（`Ani1` 档位会给出 -0.30 之类的**分数值**） |
| `AniEyerolling` 蚊香眼 [0,30] | 同上的量程问题，但它是真表情 | 留下，`gearOverrides` 标 `mode: "step"`（只允许端点） |
| `AngleXbs2/3`、`Param11` 呆滞 | default 压在端点或单边量程 | 单边档位，进 `review` 记录 |

**⑤ 13 个语义通道被判成"严格 0/1 开关"——微笑会蹦成满格**

Soullink 判断"连续 vs 离散"用的是**名字正则**，而它要求词分隔符（`(?:^|[ _-])mouth(?:$|[ _-])`）。于是：

| 通道 | cdi 名字 | 量程 / default | Soullink 判成 | 应该 |
| --- | --- | --- | --- | --- |
| `MouthSmile_L` / `MouthSmile_R` | 同名 | [0,1] / 0 | 二值开关 | 连续（微笑的程度） |
| `BrowInnerUp` | 同名 | [0,1] / 0 | 二值开关 | 连续（扬眉幅度） |
| `CheeckPuff` | 鼓脸 | [0,1] / 0 | 二值开关 | 连续 |
| `JawOpen` | 下巴开闭 | [0,1] / 0 | 二值开关 | 连续 |
| `TongueOut` | 伸舌头 | [0,1] / 0 | 二值开关 | 连续 |
| `Mouthpucker` / `MouthFunnel` | 撅嘴 / 漏斗嘴 | [0,1] / 0 | 二值开关 | 连续 |
| `LEyeSquint` / `REyeSquint` | L/R-Eye Squint | [0,1] / 0 | 二值开关 | 连续（**眯眼**，判成开关就变成闭眼） |
| `MouthRollUpper` / `MouthRollLower` / `NoseNeer` | 同名 / NosePositionY | [0,1] / 0 | 二值开关 | 连续（虽然已被实验性排除） |

危害在于：**这 10 个（去掉 3 个实验性）正好是鲸语手挑的 `primary` 语义参数**，也是 Soullink 自己 `parameterMap` 的 FACS 目标（`mouthSmile → MouthSmile_L/R`）——也就是说**上游自己的档案映射与自己的池子判定互相矛盾**。修法：模型知识里手挑的语义参数一律强制算连续通道（实现在 [performance-rules.mjs](../../plugins/dsh-live2d/src/performance-rules.mjs) 的 `selectPools`，由 `knowledge.primary` 驱动）。

**⑥ 23 个编辑器分隔线藏在连续档位池里**

`Divider1`/`Divider3` 量程是 0..1，落在开关池；另外 **23 个 `DividerN` 量程是 [-1,1]**，于是被当成"双边可动的连续通道"，混进了 112 个连续通道的统计里——第一版审计的"危害 6 个"就是这么漏掉的。修法：危害检查要跑在**整个候选池**上，不只是开关池。

### 6.4 审计结论

> **档位映射在大肥鱼身上成立且可读（有效连续池 88 个通道，0 个动不了）；但通用启发式直接开跑会出六类事故。**
> 六类事故的修法全部是同一件事：**把"谁能动、谁和谁互斥、哪些交给手势系统"从通用启发式换成每模型声明的知识。** 这正是「额外模型配置」模块第二半存在的理由，也是已经落地的第一步。
>
> 修完之后的**有效候选池**：连续 **88** + 开关 **77** = **165** 个通道（原始池 125 + 89，排除 49 项）。

## 7. 建议的分层与接缝

### 7.1 三层 + 一条旁路

```
DSH 会话 / 外部消息
      │
      ▼
(A) 判断层 ────── JEV（Decisions API，慢、贵、偶尔调）
      每帧语义单选 + 每通道"要不要接管"
      │
      ▼
(A′) 数值化 ───── 本地代码（快、免费）
      档位 → 具体数值；严格离散保持 0/1
      │
      ▼
(B) 表演层 ────── Soullink engine 混合回放（每帧）
      VAD / FACS / Idle / Lipsync / Mixer + ownership
      │
      ▼
   舞台（保留现有 PIXI 6.5.10 + 打过补丁的 cubism4.min.js）

(C) 模型专属知识与互动 ── 鲸语搬进来的 JS 与数据
      手势（开关 + 关节 + 进入/退出）· 胸部物理增益 · 互斥组 · 丝袜着色器

(D) 点击旁路 ──── 鲸语的 JS，本地，永不过 (A)
```

### 7.2 接缝 1：档案 —— Soullink 生成，鲸语叠加

Soullink `profile-generator`（Node 侧、零依赖）扫 `model3`/`cdi3`/`exp3`/`motion3` 生成 `soullink.profile.json`，`parameterMap` 走 26 个 FACS 通道。与大肥鱼参数的对照：`headX/Y/Z → AngleX/Y/Z`、`bodyX/Y/Z → PositionX/LeanInput/PositionZ`、`gazeX/Y → ParamEyeBallX/Y`、`eyeBlinkL/R → ParamEyeLOpen/ROpen`（subtract）、`mouthSmile → MouthSmile_L/R`（`targets` 多目标，schema 原生支持）。落不上的那批（`CheeckPuff`/`JawOpen`/`TongueOut`/`MouthRoll*`/`NoseNeer`）**正好与鲸语自己标 `experimentalInputs` 与 `unmapped` 的集合重合**——两边独立得出了同一结论。

⇒ 鲸语现有档案（`core-inventory.json` + `data/knowledge/deepseek.json` + `src/profile.mjs`）从"运行时必需"降级为**叠加知识与兜底**。**必须先定谁是权威，否则库里长期存在两份档案。**

### 7.3 接缝 2：参数归属 —— 冲突全在这里

| 鲸语分类 | Soullink 概念 | 处置 |
| --- | --- | --- |
| `author-physics` | 排除出 owned | 可自动转换 |
| `semantic` | `parameterMap` 的 FACS 通道 | 转换 |
| `native-gesture` | **无对应概念** | 归 (C) 层，显式声明 owner |
| `author-expression` | `expressionMap` 原生表情 | 转换 |
| `unmapped` | 无 | 留空，实测校准 |

三个具体坑：

1. **胸部物理**：Soullink 排除 `ChestX*/ChestY*` 是对的；鲸语的触摸注入在**物理之下**（包装 `physics.evaluate`）。两者正交、可以共存，**但必须写进文档**，否则以后有人把 `ChestX*` 加回 owned 就会双重驱动。
2. **`key7` 脸红**：鲸语的害羞是**连续轨迹**，而 `privateEmotionMap` 是声明式的（`activeValue`/`neutralValue` + VAD 区间），表达不了"按住的力度"。建议：**点击/长按的连续部分由 (D) 层直写**，Soullink 只负责表情那一层。
3. **眨眼 / 呼吸 / 待机**：Soullink 的 `BlinkController`/`BreathingController` 会写 `ParamEyeLOpen`/`ParamBreath`；鲸语把这些留给 Cubism；**现有舞台还开着 `motionManager.startRandomMotion('IDLE')`**；审计还把 `IDLE` 参数也列进了候选池。**四方抢同一批参数，必须收成一方**，否则接上就看得出抖。

### 7.4 接缝 3：执行位锁

Soullink 侧已有等价物：`SpeechPerformancePlanner` 的 `lifecycleToken`、`startSpeechPerformance(..., "replace")`、`ParameterPlanSequencer` 单实例。缺的是**点击 / 说话 / 消息反应的三方仲裁**，建议显式优先级表：**说话 > 点击 > 待机**。

**要提前知道的倒退**：鲸语第 5 层锁（服务端单 `ACTIVE` job 硬拦）在 JEV 路径下**不再存在**——它没有 job 概念，锁下沉到客户端 engine。可靠性从"服务端拒绝"变成"客户端自律"。是否需要宿主再补一层，待定。

## 8. 「额外模型配置」模块

### 8.1 路由半：按 kind × adapter，不按厂商

| kind | adapter 举例 | 用途 |
| --- | --- | --- |
| `chat` | `openai-completions` / `openai-responses` / `anthropic-messages` | **只引用** `llm-pi-ai` 已注册的 route，不重声明 |
| `embedding` | `openai-embeddings` | 记忆检索、情绪分类 |
| `tts` / `asr` | `openai-audio-speech` / `openai-audio-transcriptions` | 相遇窗口语音；链路仍可交给 `dsh-local-asr` / `dsh-local-voice` |
| **`decision`** | **`openrouter-decisions`** / `typesafe-systemone` | **JEV**；同 API 上还有多家 |

每条 route 一份 profile：`kind / adapter / displayName / baseURL / apiKeyEnv / model / options`（超时、批上限、重试、降级）。

### 8.2 表演规则半：跟模型走，不跟 provider 走

**已落地。** 规则分两半，这是刻意的：

- **`derived`（工具拥有、可重算）**：池子划分、强制连续名单、手势关节、危害清单、动画触发器、档位健康度。
- **`declared`（人拥有、工具不碰）**：排除名单、互斥组、档位覆写、待确认项。**这些是判断，不是推导**，所以 `derive-performance-rules.mjs` 只在缺失时起草，之后一律不覆盖。

落在模型知识文件 [deepseek.json](../../plugins/dsh-live2d/data/knowledge/deepseek.json) 的 `performanceRules` 里（跟着模型走，不跟 provider 走）：

| 字段 | 作用 | 大肥鱼的现成内容 |
| --- | --- | --- |
| `derived.poolIds` | 只按通用规则算出的池（未减排除项） | 连续 125 / 开关 89 |
| `derived.forcedContinuous` | 被通用正则误判、由模型知识纠回连续的通道 | 13 个（`MouthSmile_L/R`、`BrowInnerUp`、`CheeckPuff`、`JawOpen`、`TongueOut`、`Mouthpucker`、`MouthFunnel`、`LEyeSquint`、`REyeSquint` + 3 个实验性） |
| `derived.gestureJoints` / `gestureSwitches` | 手势的关节与开关（从 `gestureJoints` / `gestures[].switch` 读） | 9 个关节、3 个开关（`Movement1/2/3`） |
| `derived.hazards` / `animationTriggers` | 危害与量程陷阱 | 25 个分隔线 + `IDLE` + 3 个实验性；`Ani1`/`Ani2`/`AniEyerolling` |
| `declared.excluded` | 排除出候选池，按原因分桶 | `editorOnly`(25) · `idleTrigger`(1) · `experimental`(3) · `gestureSystem`(12) · `appearance`(6) · `animationTrigger`(2) = **49 项** |
| `declared.exclusiveGroups` | 互斥组 | 脸效 `key1..13` · 手势 `Movement1..3` · 冒汗 `SweatBurst1..6` · 脸部动画 `SWITCHA`+`F1/F2/F3Anikey` · 落泪 `RCryKey`/`LCryKey`（均 `single`） |
| `declared.gearOverrides` | 个别通道的档位处理 | `AniEyerolling` → `step`；`ParamEyeLOpen`/`ParamBreath`/`Param11`/`AngleXbs2/3` → `review` |
| `declared.review` | 需要人确认、暂时不动 | `ParamSilence`、`Clothes2`+`Param` 大小变、`Param38`、`Param40` |

**修完之后的账**：原始池 125 连续 + 89 开关 → 排除 49 项 → **有效候选池 连续 88 + 开关 77 = 165 个通道**。

三条已经写进去的判断：

1. **外观不交给判断层**——`Clothes1..5` + `Param`(大小变位置) 一律排除：换装是用户的选择，不是角色的表演。
2. **裸手势开关归手势系统，但保留 `gesture` 单选组**作为 JEV `h{i}` 的选项集（将来让 JEV 在语义层选"抚胸/竖食指/狗尾草"，而不是去 toggle 裸开关）。
3. **语义参数强制连续**——模型知识里手挑的 `primary` 参数不再走通用正则。

## 8.3 与 DSH 接缝的关系

**不复用** `ctx.llm.registerAdapter`（那是 chat 协议面，塞不进 Decisions）。**复用** DSH 的 `ctx.settings`（设置板块）、`ctx.credentials`（凭据）、`ctx.webServer` + `connection`（前端面板）。对外暴露一个与 `ctx.llm` 平行的服务面，方法按能力分，后续功能（记忆检索、QQ 语音、Live2D 表演）都从这里取。

## 8.4 面板

板块「额外模型配置」，列表 + 表单。每行显示：名称 / 能力 / 协议 / 端点 / 模型 / 密钥状态（**只显示"已配置 / 未配置"，绝不回显**）。

## 9. 已写入的决策

2026-11-07 写入知识图谱（项目 `dsh-superagent-template`），共 **20 条**：

| 主体 | 决策 |
| --- | --- |
| `dsh-live2d` | 模型判断管线采用 Soullink/JEV，鲸语只作为素材与模型知识来源 |
| `dsh-live2d` | 鼠标点击走本地旁路，不经过 LLM 与 JEV |
| `dsh-live2d` | 不引入 Python 运行时：鲸语 Python 不移植，可执行部分一律 JS/TS 重写 |
| `dsh-live2d` | 渲染底座保留 PIXI 6.5.10 与打过补丁的 `cubism4.min.js`，不采用 Soullink `live2d-pixi` 的 PIXI v7 |
| `dsh-live2d` | 连续参数档位映射采用 35/65/90、neutral 取 default，数值计算留在本地代码 |
| `dsh-live2d` | 不移植鲸语 `server.py`/`planner.py`/`compiler.py`/`model_profile.py`，只搬 `web/` 的 JS 与数据 |
| `dsh-live2d` | 语音改走宿主 TTS，不再依赖鲸语缺失的 13 条 wav |
| `dsh-live2d` | 大肥鱼的模型配置 key 用目录名 `DeepSeek`，不用资产名 |
| `dsh-live2d` | 落地顺序：模型表演规则 → 额外模型配置骨架 → 真 JEV 打通（含三级降级） |
| `额外模型配置` | 在设置中新建此模块，统一管理对话模型之外的外部模型路由 |
| `额外模型配置` | 路由按 kind × adapter 组织，chat 只引用 `llm-pi-ai` 已注册的 route |
| `额外模型配置` | 第二半是「模型表演规则」：`excludedIds`/`exclusiveGroups`/`gestureMap`/`jointIds`/`gearOverrides`，跟模型走 |
| `额外模型配置` | 凭据走 `ctx.credentials` 与 `apiKeyEnv`，面板只显示已配置/未配置 |
| `JEV` | JEV 是 System One 决策模型（Choice/Noul/Score/Box），不是 chat 模型，不能作为 `llm-pi-ai` 的 chat provider |
| `JEV` | 走 `POST /api/alpha/decisions`，输入计价、输出免费 |
| `soullink-emotion-sdk` | npm 包的 `planner-openai` 走 `/chat/completions`（对 OpenRouter JEV 返回 404），真链路只在 `scripts/`，需自研 Decisions 适配器 |
| `大肥鱼` | 候选池必须排除 `IDLE`、25 个编辑器分隔线、三个实验性输入与外观类通道 |
| `大肥鱼` | 38 个作者开关必须登记互斥组 |
| `大肥鱼` | 9 个手势关节从 JEV 池摘出，交给手势系统，避免与 arm binding 抢写 |
| `大肥鱼` | 509 参数原始池 125 连续 + 89 开关，排除 49 项后有效池 88 + 77；35-65-90 档位可读性已验证 |
| `大肥鱼` | 13 个语义通道（`MouthSmile_L` 等）被通用正则误判成二值开关，由模型知识强制算连续 |

## 10. 不做的

- 不搬 VTS / 桌宠 / Spout / 导出 / 弹幕 / Minecraft（鲸语 `vts_*`、`pet_control`、`layered_pet`、`media_exports`、`studio_*` 等）
- 不搬鲸语 `server.py` 与其 HTTP 面（DSH 有自己的 webServer）
- **不引入 Python 运行时**（要写语言的两块：arm binding ~40 行、renderer patch ~100 行，都用 JS 重写）
- 不改 Soullink 上游（用 `privateEmotionMap` + 自有适配器消化差异）
- 不换渲染底座
- 不移植 `data/agent-tools.json` 的 5 个工具（`l2d_capabilities` 等；JEV 路径下 agent 不再需要"先编译再执行"）
- 暂不搬 15 段 `performances`（与"每句现生成"功能重叠；等点击层跑通再定）

## 11. 风险与未验证

1. **Soullink 是 `0.2.0-beta.1`，npm 上发布的是 `0.1.0-beta.1`。** JEV 说话动作那套看着是 0.2.x ⇒ 要么用 npm 老版本、要么 vendor 源码、要么挂 git 依赖。**未定。**
2. **JEV 侧完全没有实测数据。** 本文所有 JEV 结论都来自源码与文档，**没有一次真实 Decisions 调用**：判得准不准、成本多少、延迟多少、置信度分布，全部未验证。
3. **上游 JEV 是 OpenRouter alpha 端点**，模型 ID 与协议可能变。
4. **档案会有两份**（`src/profile.mjs` 与新的 `soullink.profile.json`），形状不同，必须定权威。
5. **自动 profile 覆盖率未知**：大肥鱼私有参数多，`profile-generator` 的启发式覆盖多少未实测。
6. **参数四方抢写**（Soullink 眨眼呼吸 / Cubism 自带 / 现有 `startRandomMotion('IDLE')` / `IDLE` 参数），必须在接缝 2 一次收干净。
7. **锁的可靠性下降**（§7.4）。
8. **量程陷阱要靠通配规则，不能只列名单。** `Ani1`/`Ani2` 这类"名字像动画、量程不是 0..1"的通道已按模式识别；但同类命名还可能再出现（`AniEyerolling` 就合法），所以规则是**模式 + 覆写**两层，不是一张固定清单。
9. **"连续还是离散"不能靠名字正则。** §6.3 ⑤ 那 13 个通道就是证据：上游自己的 FACS 映射把 `MouthSmile_L` 当连续，池子判定却把它当开关。凡换模型，这一步都要重算，不能相信通用规则。
10. `docs/jev-conversation.md` 所述的 `models` 目录下 `model_prompt.txt`（每模型手写规则）在 Soullink 里是**外部输入**，我们这边没有对应物 ⇒ 需要由 `data/knowledge/*.json` 生成。
11. **`declared` 里的判断尚未经过观感验证**：`Clothes1..5` 全部排除是否可惜、`SweatBurst*` 是否真的互斥、`key10`（大钢盆）算表情还是道具——都要等接上渲染后肉眼看。

## 12. 落地顺序

1. ✅ **模型表演规则**（已完成，§14）：共用模块 + `performanceRules` 数据 + 派生工具 + 8 条测试。纯 JS，不碰网络不碰凭据。
2. **「额外模型配置」骨架**（§8.1 路由表 + 设置板块 + 凭据不回显 + dry-run）
3. **真 JEV 打通**（需要 OpenRouter key），带三级降级：批过大自动降批 → 401/402/403 立即停剩余付费请求 → 全程失败退回本地规则
4. 若 key 到手，可先做**一次 80 题的最小探针**（1 秒 4 帧 × 20 通道，1 请求），把"JEV 对大肥鱼判得准不准"从猜测变成数据
5. **接缝 2（参数归属）与表演层**：把规则接进运行时，同时收掉四方抢写（§7.3）
6. **点击旁路（D 层）**：搬鲸语 `web/*.mjs` 的指针互动

## 13. 附录：工具与复现

三个东西，一份规则源：

| 文件 | 角色 |
| --- | --- |
| [src/performance-rules.mjs](../../plugins/dsh-live2d/src/performance-rules.mjs) | 规则本体（纯函数、无 I/O）。池子划分、档位、派生、校验、专用家族都在这里。**运行时、审计、派生三方共用** |
| [tools/derive-performance-rules.mjs](../../plugins/dsh-live2d/tools/derive-performance-rules.mjs) | 从真实资产派生 `derived` 并落盘；`declared` 只在缺失时起草 |
| [tools/jev-gear-audit.mjs](../../plugins/dsh-live2d/tools/jev-gear-audit.mjs) | 逐通道看档位落点与有效池规模，输出 [jev-gear-audit.out.json](../../plugins/dsh-live2d/tools/jev-gear-audit.out.json) |

```bash
# 1. 派生 + 自校验（默认只打印，--write 才落盘）
node plugins/dsh-live2d/tools/derive-performance-rules.mjs
node plugins/dsh-live2d/tools/derive-performance-rules.mjs --write

# 2. 档位审计（只读、离线）
node plugins/dsh-live2d/tools/jev-gear-audit.mjs
node plugins/dsh-live2d/tools/jev-gear-audit.mjs --model DeepSeek --out /tmp/audit.json

# 3. 测试（其中一条需要本机有模型资产，没有会自动 skip）
node --test tests/live2d.test.mjs
```

判定口径沿用 Soullink `scripts/conversation-service.mjs`（Apache-2.0）的 `isDiscreteActionParameter` / `isProtectedAppearanceParameter` / `isHandActionParameter` / `parameterValueOptions` / `controlled`，但**不再逐个抄**：抄头一份的代价就是 §6.2 修正记录里的两次漏报。素材文件名按后缀发现（目录名是 `DeepSeek`，资产名是 `大肥鱼`）。

## 14. 第一步落地了什么

| 产物 | 说明 |
| --- | --- |
| `src/performance-rules.mjs` | 规则本体。`selectPools` / `gearShape` / `semanticGears` / `derivePerformanceRules` / `validatePerformanceRules` / 专用家族 |
| `data/knowledge/deepseek.json` 的 `performanceRules` | `derived`（工具重算）+ `declared`（人声明，49 项排除 + 5 个互斥组 + 覆写 + 待确认） |
| `data/knowledge/deepseek.json` 的 `gestures[].switch` | 补上缺失的知识：`hand_on_chest → Movement2`、`point → Movement3`、`grass → Movement1` |
| `tools/derive-performance-rules.mjs` | 可重算；`--write` 两次结果一致（幂等） |
| `tools/jev-gear-audit.mjs` | 改为共用模块，并修掉漏报 |
| `tests/live2d.test.mjs` | +8 条：id 存在性、危害/关节/开关不在有效池、语义参数不被判成开关、单选组不重叠且覆盖 `key1..13`、每个连续通道 small 档有位移、端到端派生自校验通过 |

**未改任何运行时行为**：`src/index.mjs` 还没引用这个模块，所以这次落地**不需要重启 DSH**，刷新页面都不需要。测试：`node --test tests/live2d.test.mjs` → **29/29 通过**；全量 `node --test tests/` → **1206 个，1203 通过，2 个既有失败**（`tests/surfcore-adapter.test.mjs` 的 git 状态断言，与本次改动无关），1 个 skip。

## 15. 第二步：让 15 段作者手写表演真的演出来（L1）

这一步**不接任何模型**：表演是作者一行行写好的 JSON，本地编译、本地按帧执行。
目的只有一个——先把「语义动作 → 参数轨迹 → Cubism 参数」这条管子打通并验证，
之后 L2（默认模型规划）和 L3（JEV）都只是往同一个 `tracks` 形状里填内容。

### 15.1 数据流

```
data/performances/NN-*.json        语义动作（12 种）
        │  stage/performance-compiler.mjs   compilePlan()
        ▼
{ tracks: [{id, start, duration, points:[[局部时间,值],…], owner, stage}] }
        │  stage/motion-engine.mjs          MotionEngine.tick(dt)
        ▼
coreModel.setParameterValueById()   ← 注入在 updateNaturalMovements 里
```

选择注入点的依据是 vendor 里 `update()` 的真实顺序（`vendor/cubism4.min.js` 已核对）：

```
motionManager.update → saveParameters → expressionManager → eyeBlink → updateFocus
→ updateNaturalMovements   ← 我们只在这里写
→ physics.evaluate（作者物理）→ pose → beforeModelUpdate → coreModel.update()
```

写在物理之前、`coreModel.update()` 之前，所以同帧生效，且不绕过作者的 131 组物理。

### 15.2 新增文件

| 文件 | 职责 |
| --- | --- |
| `stage/performance-compiler.mjs` | 移植鲸语 `compiler.py`：12 种动作、三条硬规矩、`sampleMotion` 四种段 |
| `stage/arm-binding.mjs` | 移植 `arm_binding.py`：手势关节片段触发时的手臂联动收束 |
| `stage/motion-engine.mjs` | 按帧采样 + 表情混合 + 平滑提交；**闲置时一次写都不做** |
| `stage/model-assets.mjs` | 只按计划所需取 motion3 / exp3；档案直接复用宿主 `/api/profile` |
| `stage/stage.mjs` | 挂注入点、`?perform=NN-name`、句柄上的 `play()/stop()/debug()` |

### 15.3 三条硬规矩（编译器拒绝，而不是「差不多照做」）

1. **物理输出通道永不可写**（292 个），那是作者手感的一半；
2. `pose` / `trajectory` / `recorded` 只能写 `primary` 语义输入，且不能碰 `ParamBreath`；
3. 同一参数被两个动作在 >15 ms 区间同时控制 → 拒绝；唯一豁免是一侧为 `expression` 且
   声明 `layer:'overlay'`、目标在 `primary`、基础动作不是手势。

### 15.4 验证记录（含两次纠错）

**编译**：15 段全部通过，44/39/44/43/16/17/13/17/63/58/59/58/55/45/46 条轨迹，
13–16 秒到 31–37 秒不等；每条轨迹的每个点都落在模型 min/max 内，且无一触碰物理输出。

**执行**（`?perform=01-curiosity`，900×1000）：

| 观测 | 数值 | 说明 |
| --- | --- | --- |
| `elapsed` | 0.901 → 1.818 → 2.716 → 3.616 s | 注入点每帧都在被调用 |
| `frames` | 213 | 帧循环真的在跑 |
| `writeCount` | 1800 | 参数真的在被写 |
| `lastWrite` | `value -0.1987` / `readback -0.1987` | **写完当场回读一致：写进了 core** |
| 像素差（表演 vs 无表演） | 1.63%（14637 px），最大通道差 195 | 画面确实不同 |
| 像素差（同一表演 3.5s vs 9.5s） | 19.00%（170958 px），最大通道差 228 | **动作在推进，不是静态偏移** |
| 无 `?perform=` 的对照 | `debug = {attached:false}` | 零回归：引擎根本没创建 |

**纠错 ①**：第一版把「帧后读参数」当证据，结果全读 0 —— Cubism 每帧末尾
`loadParameters()` 会把 `saveParameters()` 的快照还原回去，帧后读到的永远是基底值。
改成「写完当场回读」才拿到真证据。**这也意味着任何靠帧后读值的遥测都是假的。**

**纠错 ②**：`loadCatalog` 一开始把 `/api/profile` 的响应整个当档案用，而宿主返回的是
信封 `{ ok, profile }`，于是 `controlCatalog` 取不到、`params` 为空，编译器报
「模型没有参数 ParamEyeBallX」。修法是解包（`payload?.profile ?? payload`）。
这个 bug 只在浏览器真跑时才暴露——**纯 Node 测试用手搓 catalog，正好绕过它**。

### 15.5 一处对「不重启」承诺的核对

原以为中文资产名（`加载.exp3.json`、`狗尾草切换出来.motion3.json`）会在静态路由里
因为只对模型名那一段 `decodeURIComponent` 而 404。核对后确认 `safeJoin` 内部自己
做了一次 `decodeURIComponent`，所以中文文件名**本来就能取到**，不需要改宿主、不需要重启。
（预览服务的路由与生产同形，已用实际 HTTP 请求 200 验证。）

### 15.6 这一步刻意没做

- **面板「试演」按钮**：要改客户端 bundle，得重新构建；先用 `?perform=` 验证。
- **接缝 2 的所有权仲裁**：`motionManager` 还在跑 IDLE，我们的写入叠在上面。
  目前靠「只写表演碰到的通道」共处，等接缝 2 落地时再正式仲裁。
- **L2 / L3**：本步不接模型、不联网。`MotionEngine` 只吃 `tracks`，谁来生成它无所谓。

测试：`node --test tests/live2d.test.mjs` → **41/41 通过**（新增 12 条）；
全量 `node --test tests/` → **1233 个，1230 通过，2 个既有失败**，1 个 skip。

---

## 16. L2 落地：让对话模型直接编排表演（agent 工具 + 指令箱）

### 16.1 走的是哪条路，为什么

L2 的目标是「让模型把刚发生的事变成角色身上的一段表演」。有两条路：

| | (A) agent 工具 | (B) 插件里再调一次 `ctx.llm` |
| --- | --- | --- |
| 谁来编排 | **对话里正在跑的模型** | 插件里第二次推理 |
| 上下文 | 它本来就在场 | 要把对话重新序列化一遍 |
| 额外配置 | 无 | provider / model 从哪来、第二套提示词 |
| 与默认链路 | 同一条 | 可能引入试验性特性 |

选 **(A)**。三条调研事实把方向钉死了：

1. **`data/agent-tools.json` 早就设计好了这套接口**（五个 `l2d_*` 工具、jobId、`requestId`
   指令箱、`progress=1` 才算演完），但**没有任何代码引用它**——设计好的面从没接上。
2. 插件进程**拿不到 `ctx.llm`**：`inject` 里没有 `llm`，而
   `GenerateOptions.provider/model` 是必填、`LlmRuntime` 不暴露"当前默认模型"。
3. 对话模型本来就知道刚才说了什么。让它编排，是把已有的智能用起来。

同时该文件被**删除**：两份真相已经让这个项目漏报过两次（§6.2）。工具定义现在只有
`src/l2d-tools.mjs` 一处，面向模型的说明由编译器渲染（§16.3）。

### 16.2 真正的难点是投递，不是推理

插件注入了 `connection`，但它只用来鉴权（`requestRejection`），**没有推送能力**。
舞台在浏览器里，宿主不能直接调它。方案是反过来——**长轮询**：

```
对话模型 ──l2d_execute(plan)──► 工具（宿主进程，同一份 compilePlan）
                                  │
                              指令箱 perform-queue（内存、无依赖）
                                  │
舞台 ──GET /api/perform/pending?wait=25000──► 取走 job（一次性）
     ──POST /api/perform/receipt──────────► 回执
```

不开新依赖、不占端口、复用现有三道门禁（本机 Host + 同源 + 会话）。

### 16.3 五个工具与能力说明

`inject` 增加 `tools`，`src/l2d-tools.mjs` 用**普通对象**注册：

| 工具 | 作用 |
| --- | --- |
| `l2d_capabilities` | 读动作种类、语义参数范围、表情、手势、硬规矩 |
| `l2d_compile` | 只校验，返回轨迹数/时长/警告，或一句拒绝原因 |
| `l2d_execute` | 校验并交给舞台，返回 jobId；舞台没打开会拒绝 |
| `l2d_state` | 舞台是否在线、演到哪（progress=1 才算完） |
| `l2d_stop` | 请求停止，平滑回待机 |

**为什么不 import `defineTool`**：`plugins/dsh-live2d` 零依赖（没有 `node_modules`），
`@deepseek-ai/dsh-tools` 在它的模块树里解析不到。核实 `ctx.tools.register(definition)`
只校验 `output` 与 schema 子集、不要求 `defineTool` 的标记，所以手写 JSON Schema 是正路。
代价是参数校验不自动做——但真正的校验本来就在编译器里（它知道这个模型有什么）。
这条风险用测试兜住了：借 laputa 已装的 dsh-tools 真跑 `assertSupportedJsonSchema`
（没有该依赖时 skip），5 个工具 × 2 份 schema 全部通过。

**能力说明从编译器渲染**，不另抄一份动作清单：`performance-compiler.mjs` 新增
`ACTION_SPEC` / `ACTION_COMMON_FIELDS`，`src/capabilities.mjs` 只做渲染。
测试交叉检查「表里的 kind 编译器都认」。整份说明 **3812 字节**（有体积断言），
示例计划**必须能真的编译**（否则会教坏模型）。
示例里的表情按偏好表挑真表情（`脸红`），因为 23 个"表情"里有一半是换装开关，
取列表第一个会拿到 `体型1`。

### 16.4 指令箱的语义

- **一次性取走**：`claim` 立刻标记 `claimed`，两个面板同开时只有一个会演。
- **回执而非轮询队列**：演到哪由舞台主动报（started/progress/completed/failed）。
- **队列深度只算 `queued`**：已被取走的那一个属于舞台，不该把后续编排挤掉
  （这是测试暴露后改的：原本把 `claimed` 也算进去，一段 20 秒的戏会挡住后来的请求）。
- **幂等**：同一个 `requestId` 不会演两遍。
- **过期与卡住**：60 秒没人取 → `expired`；取走后 `duration+30s` 无回执 → `stalled`。
- **心跳**：只有舞台的长轮询/回执才刷新 `lastSeen`。**模型问状态不算**——
  这是冒烟测试抓到的 bug（`state()` 里误调 `touch()`，导致没打开的舞台看起来在线）。
  40 秒无心跳即 `stageAlive=false`，此时 `l2d_execute` 直接拒绝而不是排进没人取的队列。
- **性能中也能被打断**：停止标志搭在**进度回执的响应**上（舞台每秒本来就 POST 一次，
  零额外请求）。首版做不到——跟随循环卡在 `runJob` 里，只有演完才会再 `claim`，
  端到端验证时清楚地看到"5 秒请求停止、演到 9.5 秒还在动"。这条对"能不能被打断"是实质性的。

### 16.5 舞台侧

`stage/stage.mjs` 的 `mount()` 默认 `follow=true`，ready 之后起循环；`?follow=0` 可关。
**不改 `src/client.js`**，所以不需要重建客户端 bundle。
首个 job 才 lazy 建 `MotionEngine`（`loadCatalog({plan:{actions:[]}})` 只拉档案，不取资产）。
没有 job 时一次写都不做——L1 的零回归继续成立。

`destroy()` 必须**先停循环再把引擎置空**：这个 bug 也是端到端抓到的
（报错 `Cannot read properties of null (reading 'playing')`——页面采样结束调用
`destroy()` 置空引擎，跟随循环下一轮还在读它）。

### 16.6 验证证据

单元/集成（`node --test tests/live2d.test.mjs`）：**57 通过**（L1 是 41，新增 16 条）。
全量 `node --test tests/`：1247 个，1244 通过，2 个既有无关失败（`surfcore-adapter` 的
git-status 断言），1 skip。

端到端（预览服务复用**同一个** `perform-queue.mjs` 与**同一份**编译器，真浏览器）：

| 场景 | 结果 |
| --- | --- |
| 入队 3.7 秒计划 → 页面存活 | `claimedAt→finishedAt` 正好 **3.7 秒**，`status=completed`、`progress=1` |
| 表演期间参数是否真的在写 | 1.17s：377 次写入；3.17s：907 次；`MouthSmile_R` `0.0253`、`readback` 一致 |
| 演完之后 | `playing=false`、写入停在 907 不再增长、引擎回 `idle` |
| 演到一半请求停止 | 20.7 秒的计划在 **1.02 秒**被打断，`completed`、回 `idle`、写入停在 113 |
| 页面提前关闭 | job 停在 `progress`，按设计在 `duration+30s` 后判 `stalled`（不是 bug） |

### 16.7 需要重启

`inject` 增加了 `tools`、新增了工具与路由，**必须重启 DSH 一次**。
**不需要**重建客户端 bundle（`stage/*` 从磁盘读）。
重启后我这条会话就能调 `l2d_execute`，届时用 `l2d_state` 读回执自验。

### 16.8 这一步没做的事

- 面板里的"演一段"输入框：工具跑通后，UI 只是它的一个入口。
- 接缝 2（与 IDLE 动作的所有权仲裁）：仍靠"只写表演碰到的通道"共处。
- L3（JEV）：`MotionEngine` 只吃 `tracks`，谁生成都行，不受影响。
- 指令箱持久化：表演是瞬时行为，重启即清空是刻意的。

### 16.9 第一次真机验收暴露的投递缺陷（重启后追加）

L2 在预览环境里全部通过，但**在真实面板上第一次调用时失败**。这类问题只有真机才会暴露。

**现象**：`l2d_execute` 成功交付，紧接着 `l2d_state` 报「舞台没有打开」；而面板里角色
能拖动能缩放（本地渲染不需要网络），表演却一动不动。

**根因**：我把心跳窗口设成了 **40 秒**，而长轮询是 **25 秒**。面板切到后台标签页
（对话在这一侧，角色面板在另一侧）时，浏览器会节流后台页的请求，心跳间隔超过 40 秒，
于是活着的舞台被判成「没打开」；已入队的任务没人取，60 秒后过期。

证据很干净：切回角色面板的瞬间，`l2d_state` 立刻变回「舞台在线」。

**为什么自己的测试没抓到**：预览环境里页面是唯一窗口、始终在前台，不存在节流。
这是「测试环境比生产环境温柔」的典型形态，不是测试写得不够多。

**三条修改**：

| 项 | 改前 | 改后 | 理由 |
| --- | --- | --- | --- |
| 存活窗口 `STAGE_ALIVE_MS` | 40 秒 | **120 秒** | 必须明显宽于长轮询时长，容忍后台节流 |
| 排队有效期 `QUEUE_JOB_TTL_MS` | 60 秒 | **120 秒** | 人切回来之前任务不该先过期 |
| `l2d_execute` 前置判断 | 心跳过期就硬拒 | **只拒「从来没连过」**；连过则排队并附 `warning` | 硬拒把「刚好没轮到」误判成「没人在」，一次编排白扔 |

另加两处自愈与可观测：

- **`visibilitychange` 重连**：页面回到前台时若通道已停就重新拉起，不必手动刷新。
  循环体包了 `try/finally` 复位 `running`，否则一次异常逃逸会把自己的自愈逻辑挡住。
- **舞台自报可见性**：长轮询带上 `&vis=visible|hidden`，`state()` 返回 `visibility`。
  下次心跳断了，`l2d_state` 能直接说清是「面板在后台被节流」还是「通道真的挂了」，
  不用再靠人切标签页来二分。

**回归护栏**：测试里断言 `STAGE_ALIVE_MS > 长轮询 × 2` 且 `QUEUE_JOB_TTL_MS >= STAGE_ALIVE_MS`，
并覆盖「从没连过 → 拒绝；连过但心跳过期 → 排队 + warning；在线 → 正常演」三段语义。

**真机闭环证据**（修复前，切回前台那次）：`job-mw64lnmv-2`，15 条轨迹、7.3 秒，
`l2d_state` 依次读到 **41% → 96% → progress=1**。这是第一次由我亲手调用工具、
在真实面板上跑完的表演——「默认模型链路编排并演完一次」的验收到此成立。

### 16.10 推翻 §16.9 的诊断：不是节流，是循环静默死亡

§16.9 把「表演不动」归因为后台标签页节流，并据此放宽了存活窗口。**这个判断是错的**，
第二次真机验收推翻了它。

**反证**：用户明确确认「人物还在，能拖能缩放」——拖动缩放是纯本地渲染，不需要网络。
页面活着、可见、可交互，但 `l2d_state` 显示最后一次心跳在 **145 秒前**，任务一直停在
`queued`。如果真是后台节流，切回前台就该恢复；它没有。

**我犯的两个错**：

1. **把「在线」当成了「正在轮询」的证据。** 窗口放宽到 120 秒后，`stageAlive`
   变成一个**滞后指标**：它可能只是 2 分钟前还活着。我据此宣布过「十几分钟没断」，
   那是误读——实际是 120 秒内的陈旧心跳。
2. **把自愈挂在 `visibilitychange` 上。** 页面一直可见时这个事件根本不会触发，
   等于把恢复能力寄托在一件可能不发生的事上。这是设计层的错，不是实现层的错。

**真正的病因**：跟随循环抛了一个未预料的异常，逃出 `while` 之后**静默死亡**，
而页面外观毫无异样。这类故障最难发现：没有任何可见症状。

**三条修改**：

| 修改 | 作用 |
| --- | --- |
| 每轮循环体内单独 `try/catch` | 任何漏网异常都不让循环整体退出，只记录并退避重试 |
| **看门狗** `setInterval(5000)` | 不挂任何事件；每 5 秒确认通道在跑，停了就重新拉起 |
| **错误上报** | 舞台把最后一次异常通过 `&err=` 捎给宿主，`state()` 暴露 `stageError`，`l2d_state` 直接显示原因 |

同时修掉那个误导我自己的观察口径：`describeState` 现在会在心跳超过 30 秒时明确写
「心跳在 N 秒前，通道可能已停（看门狗每 5 秒会重连）」，不再让人拿「在线」当健康证明。

**教训（写给以后的自己）**：

- 放宽超时是**掩盖**问题，不是解决问题。40 秒误判的根因如果是「循环死了」，
  把窗口改成 120 秒只会让误判来得更晚、更难查。
- 自愈机制不能依赖「某个事件会发生」。要有主动巡检。
- 一个「看起来正常但功能静默失效」的组件，必须让它的内部状态可被外部读到——
  否则只能靠用户肉眼看屏幕来二分。
