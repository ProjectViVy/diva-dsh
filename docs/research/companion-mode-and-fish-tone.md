# 独立「主 agent 测试模式」与 fish-tone 评估

- 状态：调研与方案，未改代码
- 日期：2026-11-05
- 关联：[OpenDots 调研](opendots-survey.md)、[个人持久化 Agent 总体架构](../architecture.md)
- 本地取证：`/tmp/fish-tone-probe`（浅克隆 commit 见仓库）、`superagent/src/app/sessions.ts`、`deepseek-harness/packages/preset/*`、`.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml`

## 1. fish-tone 是什么

`MX3a48c5/dsh-fish-tone`，MIT，两个 DSH 插件的 monorepo：

| 包 | 作用 | 默认 |
| --- | --- | --- |
| `packages/dsh-fish-tone` | 人味层：确定性文本变换 + 一节系统提示 + 3 个工具 + 1 个技能 + 设置页 | 开 |
| `packages/dsh-fish-tone-flavor` | 性格层：77 条梗 + 24 个句式 | 关 |

它的技术骨架（**这才是对我们最有价值的部分**）：

- **提示词注入**：`root.inject(['systemPrompt'], ctx => ctx.systemPrompt.section({ name: 'fish-tone:voice', order: 920, text: PROMPT }))`，返回 `dispose`，可以在设置页里**当场开关，不用重启**（`lib/index.js:584-607`）。
- **工具**：`ctx.tools.register({ name, description, parameters, execute })`，工具描述本身也带"什么时候用"的说明。
- **技能**：`ctx.skills.register({ name, description, whenToUse, content, source: 'runtime' })`，把"怎么写"的判断流程做成技能，而不是检查表。
- **HTTP**：`ctx.inject(['webServer'])` 挂 `/api/fish-tone`（status / config / preview）。
- **客户端设置页**：`client.js` 自注册 `settings.section`；`package.json` 的 `dsh.client` 声明 `platform: web` 与要 inject 的 UI 包。
- **装载方式**：`dsh-plugin.json`（manifest 0.15）+ `cordis.patch.yml`（`- insert:` 一行）+ `dsh plugin --profile web add link:...`。
- **可复现性**：所有随机都走 seed，同一个 seed + 同一段话 = 同一个结果——所以它 83 个用例能测。

### 它给我们的两个直接启发

1. **技术样板**：形态 A（语气层）如果不需要挂在 superagent 主 Session 上，完全可以照这个结构做一个 DSH 插件：一节可开关的提示词 + 设置页 + 可选工具。
2. **切分方式**：README 里那句"性格是偏好，不是语言能力，所以拆出去了：**不装附属包，主包一个字都不变**"。这正是我们 A（通用语气）与 B（生活/陪伴）该有的关系：**A 是能让所有会话都用的一层；B 是只有生活模式装的另一层，互不影响。**

## 2. 一个必须先知道的事实：superagent 主 Session 的提示词是"独占"的

`superagent/src/app/sessions.ts:244-249`：

```js
agent.ctx.systemPrompt.section({
  name: 'dsh-superagent-policy', order: 9999, interpolate: false,
  text: context => { /* Prompts.compose(config, master ? 'orchestrator' : 'worker') */ },
  ...(master ? { complete: true } : {}),   // ← 主 Session 是 complete
})
```

而 DSH 的 [system-prompt 子系统](../../deepseek-harness/docs/subsystems/system-prompt.md)规定：

> One effective `complete` section becomes the sole prompt section after cooperative assembly.
> More than one effective complete section makes assembly fail.

三个结论，直接决定 A 怎么做：

1. **主 Session 的系统提示 = 只有 superagent 自己 compose 出来的那段文本。** 任何第三方插件（含 fish-tone）贡献的 section 在主 Session 里都会被丢弃。
2. 所以 **A 不能靠在主 Session 外挂一个"语气插件"实现**，只能改 superagent 自己的提示词内容：内置 part 覆盖、团队 section，或 Policy 文本——也就是 `orchestrator_prompts_save` 与版本机制本来就管的地方。
3. **不会炸**：非 complete 的 section 只是被忽略；只有第二个 `complete: true` 才会让装配失败。所以全局装 fish-tone 对普通会话有效、对 superagent 主 Session 静默无效——不会互相打坏。

（对照：worker Session 不是 `complete`，所以 worker 的提示词是"DSh 编码提示 + 仓库 AGENTS.md + superagent 组装文本"叠加的，这也和 `004-prompts.md` 的描述一致。）

## 3. 独立测试模式的三种载体

"独立的 superagent 主 agent 模式用做测试"最自然的落点是 **DSH 的 agent preset**：一个独立的预设（自己的插件树、自己的提示词、自己的工具集），在 Web 的新会话模式选择器里可选。

`deepseek-harness/packages/preset/agent-preset/README.md`：

> Define an Agent's child plugins in ordinary Cordis YAML. Declare several presets and let sessions select one. Definitions load eagerly, and edits affect subsequently created Agents.

而 superagent 自己的两个预设就在 `superagent/cordis.patch.yml` 里：
`dsh-superagent-worker`（执行器，带 persona / agent-instructions / time-context / shell / 工具 / 技能 / compaction 的完整树）与 `dsh-superagent-router`（主 Session，`tool-fs` 只读、命令与任务等待 5 秒）。

| 载体 | 怎么加 | 优点 | 代价 |
| --- | --- | --- | --- |
| **① profile patch 直接插一行** | 在 `.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml` 插一个 `@deepseek-ai/dsh-agent-preset` 行（`scripts/setup-laputa.mjs` 就是这种改法的先例） | 最快，零打包，不动任何 submodule | 手工、无版本、重装 profile 会丢 |
| **② 做成插件包（像 fish-tone）** | 新包 `plugins/dsh-superagent-life`：`cordis.patch.yml` 插自己的 preset 行 + 宿主半端注册提示词/工具；配一个 setup 脚本写 profile | 与仓库现有插件同构、可测试、可开关、可随时卸 | 要写包与安装脚本，约 1–2 天 |
| **③ 改 superagent 源码加第三个角色** | 在 `Prompts.compose` 里加 `life` 角色，在 `Sessions` 里加对应 preset（走 `patches/superagent-*.patch`，D1 决定） | 能复用 Ticket/Policy/Effect 全套控制链 | 动 submodule 补丁，升级要重生成；每个升级周期都要维护 |

**推荐 ②**：它满足你说的两点——"标准模式照常工作"（完全不碰 router/worker 两个预设）与"独立、用来测试"（独立包、独立开关、独立 session）。等测明白要什么，再决定是否值得走 ③ 把生活控制链接进 Superagent。

## 4. 测试模式应该长什么样（形状）

一个 preset 行能挂的插件树，正好覆盖我们需要的四件事：

```yaml
- insert:
    - id: superagent-life-preset
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: dsh-superagent-life          # 会话保存的预设身份
        name: 生活测试模式                 # 选择器上露出的名字（预设没有隐藏开关，见下）
        description: 用于验证陪伴式对话与生活类行为，不参与正常工作票。
        order: 92
        plugins:
          - id: persona
            name: '@deepseek-ai/dsh-persona'
            config:
              prefix: <生活向人格前言>
              # complete: true → 只保留这段前言，压掉其他所有 section
          - id: agent-instructions
            name: '@deepseek-ai/dsh-agent-instructions'
          - id: time-context
            name: '@deepseek-ai/dsh-time-context'
          - id: <我们自己的语气/生活插件>
          - id: tool-fs / tool-jobs / skill-filesystem / skill / compaction ...
```

- `@deepseek-ai/dsh-persona` 是"给一个 preset 自己的身份"的官方行：`prefix` / `suffix`（模板，会做变量插值）/ `complete`（只用 prefix 当整个系统提示，压掉身份、工具指引、监听器贡献）/ `includeRuntimeContext`。它**必须挂在一个 preset 组合里**，挂到全局会和提示词注册表冲突并报错。
- 这样一来，语气层（A）在测试模式里既可以用 `persona.prefix` 做，也可以由我们自己的插件用 `systemPrompt.section` 叠（没有 complete 就没有冲突）。而生产的主 Session（complete）仍然只能走 superagent 自己的 Prompts。
- 如果以后要把测试模式接到 Superagent 控制链（Ticket/Effect/Policy），那就是载体 ③，需要给 `Prompts.compose` 加角色；在那之前，测试模式是**纯 DSH 会话**：有 DSH 的工具、记忆注入（ActMem/Laputa 等按各自作用域决定）、没有 Ticket 与 Policy。

## 5. 关键约束与坑（都已核实）

1. **不会被 superagent 抢走**：`sessions.ts:232-238` 里 `decorate()` 只处理 `masterId` 与 "ticket 的 worker session"，其它会话直接 `limitSubagent()` 返回。测试 session 既不是 master、也没有父会话 → 完全不被装饰、不注入 superagent 提示、不装 superagent 工具。
2. **预设不会被强行改回去**：`sessions.ts:122-131` 的强制重选只针对 master / worker session（"Opening a Session in DSH's Web UI before its first turn may select the default preset for it: select ours again"）。
3. **预设行没有"隐藏"开关**：superagent 自己的 worker preset 注释里写明"a preset row has no setting that hides it from the preset picker, so its name and description say whom it is for"。所以测试模式的名字与描述要写清楚"这是试验用的"，避免误选。
4. **改动只影响之后新建的 Agent**（agent-preset 明确说明），已经开着的会话不受影响 → 天然安全，适合测试。
5. **第二个 `complete` 会装配失败**：如果将来有人在测试 preset 里既挂 `persona.complete: true`，又挂一个 `complete: true` 的插件 section，会直接报错。测试 preset 只能有一个 complete。
6. **升级路径**：载体 ② 与 superagent submodule 无关，superagent 升级不影响它；载体 ③ 每次升级都要重生成补丁（D1 已确认这个代价）。

## 6. 和 A、B 的对应关系

| | 落在哪 | 测试模式的作用 |
| --- | --- | --- |
| **A 语气/说话方式** | 生产：superagent Prompts（内置 part 覆盖 / 团队 section / Policy 文本）；普通会话：可参考 fish-tone 的 section 插件 | 在独立 preset 里先试各种 prefix/语气文本，确认读起来对，再决定要不要进 superagent 的正式 part |
| **B 生活语义** | 生产：Source + Policy + Effect（复用现有 InputEnvelope / Schedule / Effect / 审批） | 先在测试模式里验证"主动开口的时机、长度、频道"这些**只能靠相处才知道**的东西，不碰生产 Policy |

也就是说：**测试模式是 A/B 的试验田，不是它们的实现。** 它让我们在不影响标准工作票的前提下，把"说话"和"相处"调到对为止，然后再往正式层搬。

## 7. 下一步（仍不改代码）

1. 定测试模式的**名字与范围**（例如 `dsh-superagent-life`，描述写明试验用）。
2. 定**人格来源**：测试预设用 `dsh-persona` 内联一段前言（自包含、最好卸），还是挂 Laputa（生产唯一人格事实源，但它是全局注入、不是 preset 作用域）。
3. 定**第一轮要测什么**：只测语气（A）？还是也测主动开口的时机（B 的前置）？这决定要不要给测试 preset 装工具与记忆。
4. 定**载体**：我建议载体 ②（独立插件包 + setup 脚本），与 `dsh-laputa` / `dsh-actmem-recap` 同构。
5. 跑起来之后，把每一轮"什么样的话读起来像人"的结果记成证据，再决定搬进 superagent 的哪个 part。
