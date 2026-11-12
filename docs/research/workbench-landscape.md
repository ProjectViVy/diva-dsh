# 三源工作台调研：本仓运行时、淋雨家工作台、PENS 应用环境

- 状态：调研完成，待拍板（**本轮未改任何代码、配置、submodule**）
- 日期：2026-11-11 (Asia/Shanghai)
- 调查对象：
  - 本仓 `diva-dsh`（= `ProjectViVy/diva-dsh`，HEAD `1e0fde8`）
  - `.workspace/luanyujia-workbench`（`mashanglinyu/luanyujia-workbench`，HEAD `ee87f1c`，MIT）
  - `.workspace/pens`（`ProjectViVy/pens`，HEAD `bf76d55`，无代码）
  - 定位级扫描：`.workspace/mnemos`、`.workspace/reference/Alife`、`.workspace/reference/grok-build`
- 方法：读仓库文件 + `git log`/`git remote`/文件统计 + GitHub API 取组织仓库目录；**没有**安装依赖、没有跑任何一方的工作台、没有在 rc.5 上实测淋雨家的壳。

---

## 0. 先说结论

1. **三份材料不是三个竞品，是同一件事的三层**：本仓在**运行时/控制平面**层（DSH + Superagent + 16 插件，单一主体、多域单一事实源）；淋雨家在**干活方式 + 桌面壳**层（同一台 DSH 引擎，多场景窗口、记忆写文件）；PENS 在**应用生态**层（PEN 包、跨 agent 可移植、明确不建第二套 loop/人格/记忆）。三方独立收敛到同一条不变量：**每类事实只有一个写者，其他人只能提请求**。
2. **记忆的真正分界不是「短期/长期」，是「每轮注入成本」**：本仓按易变性分层（稳定核心进 system、记忆卡进 runtime context、全文留工具检索）；淋雨家按字节红线分层（铁律每轮注入、§〇 交接 ≤4 KB、私有记忆 ≤25 KB、项目记忆 ≤8 KB）。两条路线不同，结论相同——**注入的东西必须极短，其余靠检索**。这为我们 memory 插件现有的开关设计提供了外部验证，也给出一组可量化的预算参照。
3. **PENS 主仓库值得读，但不能当依赖**：只有 2 个提交（2026-09-29 同日）、3 个跟踪文件、0 star，明确写着「No runtime, application package, SDK, desktop shell, or agent integration has been implemented or tested here」。它的价值是**决策记录**：6 条已确认决策 + 7 条提议 + 7 个待定项，把 VIVY 生态的边界先划好了。
4. **「可安装包 + 显式激活 + 信任边界」已被三个成熟实现做成既成事实**：grok-build（Apache-2.0；插件 = skills/commands/agents/hooks/MCP/LSP 的安装包，按 `scope/hash/name` 启用、信任门、15 类生命周期 hook）、Alife（.NET；插件 = 运行时编译的 `.cs` 文件夹 + `manifest.json`，`AssemblyLoadContext` 隔离 + 在线插件市场）、PENS（提议「安装 / 激活 / 上下文暴露」分离）。淋雨家工作台已经用「MCP 逐项开关 + token 估算」把这层实现出来了（§4.6：Blender 32 工具 ≈8.9k token/轮）。**本仓是四者里唯一「装上即全量暴露」的**——这是 G2 空白最硬的一条外部证据。
5. **淋雨家的工作台是「DSH 内核可被外部壳驱动」的现成证据**：Electron 外壳 + 场景 JSON + `sessionId/sessionTitle` 三字段绑定 + 面板注册 + 顶栏标签 + 免费 AI 桥 + 记忆工具链，96 文件 17.7 MB，MIT，2026-09-30→11-04 共 73 个提交。价值不在抄代码，在**它把「防串台、换会话归档、检查挂节奏」这些工程细节写成了可读的经验**。
6. **真正的分叉只有一处：人格是「一份」还是「多面」**。本仓 `architecture.md` §2.2 规定 Laputa 是人格唯一权威；淋雨家的「场景即人的一面」（五字段口吻表 + 六条边界）主张每个场景一套口吻。二者其实不撞车——**价值观/边界/关系跨场景不变，口吻/长度/雷区随场合变**。把口吻从人格正文里拆成「投影」即可两全（见 D2）。
7. **我们缺的不是功能，是三样「廉价但缺口」的机制**：①安装 ≠ 激活 ≠ 上下文暴露（PENS 提议，我们插件装上即进上下文）；②「应当失败的反例」作为交付硬要求（淋雨家五步法第 4 步，我们只有测试与「未验证必写」）；③检查结果自动进待办（我们靠人手写 TODOLIST）。
8. **推荐路线：先做投影层与纪律层，不做容器层。** D2（人格投影）、D3（激活/暴露）、D5（反例验收）、D6（外部参考源登记）四条都是文档 + 少量插件改动级别；「多场景桌面容器」是另一件事，若要做应单独立项评估（D1 结论：本轮不并入）。
9. **按本轮追加的原则收窄后（不带人格与记忆、只做外部功能接线、要能接 Codex/Hermes），PENS 只剩一种自洽形态：应用接线总线 + 接线清单**。由此产生三条新决策 D7–D9，并且「暴露权」必须从 PENS 挪回宿主——详见 §10。

---

## 1. 调查口径与限制

| 项 | 做法 |
| --- | --- |
| 本仓 | 读 `TODOLIST.md`、`docs/architecture.md`（663 行）、`docs/research/` 13 篇目录、`.gitmodules`、`plugins/`、`scripts/`、`docs/logs/` 目录表 |
| 淋雨家 | 读 `README.md`、`总纲.md`、`_索引.md`、`00-核心机制/README.md`、`12-源码照搬/README.md`、`12-源码照搬/说明/记忆约定.md`、`13-公开情报/README.md` 与对标篇、`08-升级与改造清单/把规矩变成机制.md`；统计全仓文件/体积/提交 |
| PENS 主仓库 | 逐字读 `README.md`（33 行）、`docs/DECISIONS.md`（144 行）、`docs/REFERENCES.md`（37 行）；`git log` 全文（2 条） |
| 组织目录 | GitHub API `orgs/ProjectViVy/repos`，取 10 个公开仓的 name/description/stars/updated_at |
| **没做** | 没 `npm install` 淋雨家外壳；没在 rc.5 上起它的 Electron 壳；没跑 `场景记忆.mjs`；没验证 PENS 的任何集成（PENS 自己也没有）；没装 mnemos；Alife/grok-build 只做定位级扫描 |
| 版本口径 | 淋雨家模板自述「在 DSH `0.2.1-rc.3` 上验证过」；本仓当前跟随 `0.2.1-rc.5`。**面板/注入接口是否仍兼容未核实**（见 §8 风险 R2） |
| 隐私口径 | 淋雨家全仓已脱敏（`<占位符>`，约 700 处）；本报告不复述其个人路径、站点、客户信息 |

---

## 2. 仓库目录

### 2.1 `.workspace/` 现有内容（4 个仓 + 1 个参考根）

| 目录 | 来源 | HEAD | 规模 | 性质 |
| --- | --- | --- | --- | --- |
| `luanyujia-workbench/` | `github.com/mashanglinyu/luanyujia-workbench`（MIT） | `ee87f1c` 2026-11-04 | 224 文件 / 44.55 MB | 中文方法论文档 + DSH 工作台纯壳模板 |
| `pens/` | `github.com/ProjectViVy/pens`（本仓同组织） | `bf76d55` 2026-09-29 | 3 个跟踪文件 | 只有决策记录，无代码 |
| `mnemos/` | `github.com/mnemos-dev/mnemos`（MIT） | `c092d98` 2026-05-01 | 90 个 `.py` / ~17.1k 行 / 52 个测试文件 | Python CLI + MCP：把 Claude Code 会话写成 Obsidian 明文记忆并回注 |
| `reference/Alife/` | `github.com/BDFFZI/Alife`（**AGPL-3.0**） | `0707f04` 2026-11-01 | 39 csproj / ~400 `.cs`+`.razor` / ~46.8k 行 | .NET 10 全插件化桌面 Live2D 陪伴 agent，自带 MCP 服务端 |
| `reference/grok-build/` | `github.com/xai-org/grok-build`（Apache-2.0） | `2bdd1d6a` 2026-09-29 | 89 crate / ~3612 `.rs` / ~1.85M 行 | xAI 终端编码 agent 全量源码（TUI + headless + ACP） |

> 按 `AGENTS.md` §4：`.workspace/` 是相邻参考项目与上游源，**不参与构建、不入库**。

### 2.2 本仓 `diva-dsh` 顶层目录

```text
diva-dsh/
├─ AGENTS.md            常设指令（红线、Rulebook、开工/收工协议）
├─ TODOLIST.md          跨会话唯一「当前任务」事实源（NOW + 活跃 + 归档索引）
├─ README.md / LICENSE / NOTICE / package.json / .gitmodules
├─ deepseek-harness/    [submodule] 上游 DSH 本体（只读）
├─ superagent/          [submodule] 上游 Superagent 控制核心（只读，改动走 patches/）
├─ plugins/             16 个插件目录（15 个 submodule：14 个本地 vivy-dsh/* + surfcore 上游；
│                       另有 capability-hub 尚未纳入 submodule，见 `git status`）
│   ├─ _shared/ asr/ memory/ voice/                    基础能力
│   ├─ dsh-actmem-recap/ dsh-mempalace/ dsh-laputa/    记忆与人格（活跃/归档/身份）
│   ├─ dsh-continual-harness/ dsh-evolution/           技能进化与审批
│   ├─ dsh-live2d/ dsh-skin-manager/ stage-app/        舞台与皮肤
│   ├─ dsh-vivy-studio/ dsh-vivy-tone/                 面板与口吻
│   ├─ dsh-surfcore-adapter/ surfcore/                 SurfCore 适配（上游只读）
│   └─ capability-hub/                                 能力插槽（asr/tts/decision/embedding/omni）
├─ third-party/dsh-context/  [submodule] 首个第三方社区插件（tag 锚定）
├─ patches/             Superagent 补丁（清单 superagent-patches.json）
├─ scripts/             15 个安装/启停/接线脚本（setup*.mjs / vivy-dsh.mjs）
├─ tests/               根测试（node --test tests/*.test.mjs）
├─ skills/              自维护 skill（more-faster-better-economical 等）
├─ docs/                architecture.md / autodream.md / dream-executor.md / feature-restoration.md
│   ├─ research/        13 篇调研（含 im-gateway、capability-hub、mnemos、mempalace…）
│   ├─ logs/            19 个迭代日志目录（四件套 summary/verification/acceptance/release）
│   ├─ proposals/ resources/
├─ stage-app/           [submodule] Live2D 舞台
├─ .artifacts/          DSH_HOME、配置、状态、日志（git 忽略）
└─ .workspace/          本目录（参考项目，git 忽略）
```

### 2.3 淋雨家工作台目录（15 个板块 / 224 文件）

| 板块 | 文件数 | 规模 | 一句话 |
| --- | --- | --- | --- |
| `00-核心机制/` | 7 | 0.1 MB | 协作 / 记忆 / 场景体系三套机制 + 派单 / GPU 优先 / 场景即人的一面 |
| `01-场景模式/` | 6 | 0.0 MB | 场景配置格式、面板类型与注册、布局网格 |
| `02-会话定位与跟随/` | 7 | 0.0 MB | 身份认领、绑定三字段、跟着窗口走、防串台、换会话归档 |
| `03-MCP接免费AI/` | 4 | 0.0 MB | 网页版 AI 桥的整体架构与加站方法 |
| `04-工作台搭建/` | 8 | 0.0 MB | 从零到能跑、启动链路、踩坑总表、事故复盘三起、自检清单 |
| `05-协作与规矩/` | 5 | 0.2 MB | 全局铁律、标准化规范、跨场景协作、身份索引 |
| `06-场景实例/` | 4 | 0.0 MB | `bilibili.json`、`pc-cleanup.json`、`self-review.json` |
| `07-顶栏与菜单栏/` | 4 | 0.0 MB | 建标签、标签交互、`tabbar.css`（可直接用的前端片段） |
| `08-升级与改造清单/` | 3 | 0.0 MB | **把规矩变成机制**（五步法）+ 机制清单 |
| `10-源码/` | 13 | 0.4 MB | 启动链路、换会话、免费 AI 桥、四个机制小工具、三个面板实现 |
| `11-最小可运行壳/` | 2 | 0.0 MB | **零依赖单文件 demo**（`index.html`，双击即开） |
| `12-源码照搬/` | 96 | 17.7 MB | 完整可分发模板（Electron 外壳 + 场景 + 工具 + 说明） |
| `13-公开情报/` | 7 | 0.0 MB | DeepSeek 更新追踪、执行层方案对比、AivyOS 对标、Super-agent 分层 |
| `模板/` | 8 | 0.0 MB | 场景 JSON 模板、定位卡、项目信息、HelloWorld 面板、MCP 站点薄壳 |
| `配图/` | 14 | 2.0 MB | 拓扑 SVG / 记忆网络 PNG |

根文件：`总纲.md`（六层结构）、`_索引.md`、`新手必读.md`、`工具与技能目录.md`、`更新清单.md`、`README.md`（248 行）。

### 2.4 PENS 主仓库目录（完整）

```text
pens/
├─ README.md              33 行：定位、状态、产品方向
└─ docs/
   ├─ DECISIONS.md        144 行：6 条已确认决策 + 7 条提议 + 7 个待定项
   └─ REFERENCES.md       37 行：历史来源（agent-diva c565bb2、agent-vivy 1fefaca）
```

**这就是全部内容。** 没有 `package.json`、没有源码、没有 CI、没有 LICENSE 文件。

### 2.5 `ProjectViVy` 组织仓库目录（10 个公开仓，API 取自 2026-11-11）

| 仓库 | 描述 | star | 最近更新 |
| --- | --- | --- | --- |
| `diva-dsh` | seek for heart with your whale girl | 24 | 2026-11-11 |
| `agent-diva` | Next Generation AI Agent | 67 | 2026-11-11 |
| `laputa` | MemoryOS for AGI | 2 | 2026-11-02 |
| `agent-vivy` | Seek for heart | 0 | 2026-11-04 |
| `vivy-whitepaper` | 寻找真心之旅：人与硅基，诗与远方 | 0 | 2026-10-31 |
| `hare` | Living is alive | 0 | 2026-10-19 |
| `vivy-bundle` | vivy-bundle | 0 | 2026-10-12 |
| `pens` | 一种很新的agent外挂系统 | 0 | 2026-09-29 |
| `agent-diva-docs` | Docs of Agent-Diva | 0 | 2026-03-19 |
| `.github` | Project Vivy: Liberate AI, and let them decide their own future | 0 | 2026-08-09 |

> 结论：**PENS 与本仓是同一个组织里的一对兄弟项目**，不是外部竞品。这决定了读 PENS 的正确姿势——它是「VIVY 生态里另一块地的规划书」，不是「别人家的方案」。

---

## 3. 本仓现状：分层与所有权

`docs/architecture.md` §2 的六条核心决策，是理解本仓的钥匙：

| # | 决策 | 内容 |
| --- | --- | --- |
| 2.1 | 一个控制核心 | Superagent 拥有输入接纳、授权、任务、执行分配、副作用、回执、恢复；不是人格/记忆的集中库 |
| 2.2 | 一个人格核心 | Laputa 是人格唯一权威（身份、使命、关系、边界、版本、回滚）；人格不授予权限 |
| 2.3 | 一个活跃记忆事实源 | ActMem 拥有衰减、重要度、关系、会话状态、合并、更正、归档、召回 |
| 2.4 | 一个长期归档与知识仓库 | MemPalace 拥有归档长期内容；对电脑原文件只拥有派生索引 |
| 2.5 | 一个进化子系统 | Evolution 负责证据/候选/验证/发布记录，不建与 Superagent 重叠的主链 |
| 2.6 | 逻辑统一、物理分库 | 统一的是身份键、版本、所有权、写路径、回执、查询投影，不是存储格式 |

配套的「唯一事实源」表（§6）把 11 类数据域的各自主写者钉死，并明列**禁止的平行事实源**。这是本仓最强的一条资产，也是与另两份材料对话时的参照系。

当前任务面（`TODOLIST.md` NOW 三条，全部 waiting-user）：IM 统一网关路线（DV-DOC-001）、主动消息官方规则核实（DV-DOC-002）、千问 Token Plan 接入（DV-DOC-007）。插件侧有一批「代码已改、待重启验收」的条目（记忆卡投递、退役归档条件、审批原子性、世界网关渲染）。

---

## 4. 淋雨家工作台：做法与可验证的机制

### 4.1 它到底是什么

> 「同一台机器上常驻多个 AI 场景（相当于同事）：**共用一套规则与台账，各自有独立记忆；活按项目派给 owner，干完必须留证据和回执。** 核心只有一句：**记忆在文件里，不在会话里**。」——`总纲.md`

技术上：一个 Electron 外壳（`12-源码照搬/外壳`）驱动**用户自己安装的 DSH 引擎**（端口 3083），场景 = 一块网格面板 + 一个常驻 AI 会话；场景配置是 JSON，靠 `sessionId`/`sessionTitle` 绑定存量会话；面板类型有 file / view / harness-AI / MCP 桥等，可注册新面板类型。

### 4.2 六层结构（东西归谁、谁能写）

| 层 | 放什么 | 谁能写 |
| --- | --- | --- |
| L0 宪法 | 铁律与附则（版本化，改一次 +1） | 只有宿主 |
| L1 共享层 | 宿主画像 / 场景区域表 / 项目清单 / 通知待办 / 总索引 / 体检快照 | 分区写 |
| L2 场景私有 | 场景私有记忆（§〇 交接）/ 身份卡 / 画像 / 项目记忆 / 专属技能 / 归档 | 只有本场景 |
| L3 个人层 | 个人档案与知识库 | 只有本人与授权者，不进共享层 |
| L4 运行时 | 引擎 / 外壳 / 工具 / MCP / 插件 / 计划任务 | 专人维护；工具在代码仓外，升级不破坏数据 |
| L5 归档 | 备份 / 会话冷备 / 场景归档 | 只进不改 |

判据：**每个东西只属于一层，只在一个地方是「真源」**，其他地方只放指针。

### 4.3 记忆的三层与字节红线

```
引擎数据\.dsh\场景记忆\
  命令\场景私有记忆.md    ← 唯一真源（主文件 ≤25 KB）
  命令\_文件索引.md
  命令\归档\             ← 交接才归档，只进不改
  _共享记忆\             ← 多场景共用
```

- `## §〇 当前交接`：四小节（上次交接 / 当前项目 / 私有记忆变更 / 下一步·卡点），**≤4 KB**——只写「下一轮接手要知道的」；
- `## §一 ~ §五`：职责边界 / 现状接口 / 坑与决策，**只追加**；
- 四条铁律：§〇 ≤4 KB · 交接才归档 · 只追加 · **check 不过不许换会话**；
- 项目记忆：一个项目一份 `项目记忆\<项目id>.md`（≤8 KB），字段固定：状态/一句话/成果证据/下一步/坑/已有档案。

与我们的对照：我们用「易变性」分层（ActMem 卡 + 衰减 + MemPalace 归档），它用「注入频率 + 字节上限」分层。**两者是同一约束的两种实现**：每轮都要进上下文的必须极短。

### 4.4 「把规矩变成机制」五步法（本轮最值得吸收的一篇）

判据：**没有「会失败的检查」的规矩 = 一句口号。**

| 步 | 做法 |
| --- | --- |
| 1 | 写清「违规长什么样」——必须可判定（`§〇 超过 4096 字节`，不是「不要太长」） |
| 2 | 找到唯一判据出处——同一个判断只写一个地方（两处判据 = 两份结论 = 早晚打架） |
| 3 | 写一个能 `exit` 非 0 的检查——输出必须能说出**差异集合**，不是 0/1 |
| 4 | **给它一个「应当失败的反例」**——反例不报 = 这个检查是假的（90% 的人漏这步） |
| 5 | 挂到节奏上——手动跑的检查等于没跑；失败输出要**进待办**，不能只躺日志 |

三个已落地例子：临时文件三处白名单（哨兵扫违规并 exit 1）、体检 ⛔ 自动进待办（同一件只许一行）、回执双向自动销账（列出「我发出没回的 / 别人等我回的」）。

> 与本仓 `AGENTS.md` 的 `validation-required` / `未验证必写` 同构，但我们缺第 4 步（反例）与第 5 步的后半（自动进待办）。

### 4.5 它自己承认的边界

- 「这不是装完就能用的软件」——路径全是占位符，照抄一定失败，MCP 需现场排查；
- 「如果你现在只有 1~2 个会话，别全抄」——三条机制是被事故逼出来的，不是设计出来的；
- 「规模数字随版本变化，不写死」；
- 公开的分寸：`08-升级与改造清单` 只公开「已变成机制」的部分，不公开待排期清单与未修隐患；`13-公开情报` 只提炼机制、不复制商业软件代码/界面/文案。

---

### 4.6 它其实已经接了一堆外部应用——但没有「第二个 agent」

`12-源码照搬/外壳/renderer/mcp-panel.js` 是右上角的「MCP 开关」面板：数据直接写进引擎 profile patch（`disabled: true`），靠 `patchReload=live` 热重载即时生效。面板里 9 个 MCP，工具数与 token 估算都要求「照实测抄」（`est = ceil(JSON.stringify(tools).length / 4) + 4`，与引擎 `token-meter` 同公式）：

| MCP | 工具数 | ≈ token/轮 | 做什么 |
| --- | --- | --- | --- |
| `mcp-blender` | 32 | 8902 | 三维建模 / 改材质 / 读场景 / 渲染出图 / 导出 GLB·FBX |
| `computer-use-cua-driver-mcp` | 57 | 26801 | 桌面操控：找窗口 / 点击 / 打字 / 截屏 / 摆位 |
| `mcp-comfy` | 39 | 14746 | 文生视频 / 图生视频（MiniMax H3） |
| `mcp-jianying` | 8 | 1271 | 剪映草稿：识别视频 / 自动剪辑 / 字幕 / 批量出片 |
| `mcp-webai-{deepseek,doubao,tongyi,chatglm,kimi}` | 各 1 | 128–136 | 免费问网页版 AI（5 站各一个 MCP，内核共用一份） |

三条结论：

1. **「外部功能接线」的现成形态就是 MCP**，而且**你举的 Blender 已经在里面**——32 工具、≈8.9k token/轮，功能覆盖建模、材质、读场景、渲染出图、导出。这条直接给 §10.4 的路线判断加了实证：应用侧以 MCP 暴露动作面，是已经有人跑通的接法。
2. **它没有「别的 agent」**：这 9 个都是挂在同一个 DSH 会话上的**工具面**。5 个网页版 AI 是**出站**当顾问——它自己的规矩写得很清楚：「站外服务，看不到你的磁盘、没有记忆、不能验证 ⇒ 第二/第三意见，不是代工」。全仓没有 Codex / Hermes / Claude 的接入代码；唯一相关线索是它自己在 `13-公开情报/DeepSeek-更新追踪.md` 记的一条**社区说法**（DSH `0.2.2-alpha.2` 的 `subagent_oar` 可统一调度 Codex / Claude CLI），并明确标 ⚠ 二手、未经官方确认。
3. **暴露成本是可测的，而且它把开关做出来了**：5 个网页 AI 全开 ≈660 token/轮、Blender 一个面 ≈8.9k/轮、桌面操控 ≈26.8k/轮；所以它给了逐项开关，并写下「不常用的站关掉就是白省」。这正是 §9 的 D3 / §10.8 的 D9 的**参照实现**，也解释了为什么「接线」必须自带按需暴露——否则每接一个应用就是一笔固定的 token 税。

---

## 5. PENS 主仓库：决策记录全文解读

### 5.1 定位（D-001）

> PENS 是「agent 的手机操作系统 / 游戏机」：agent 带来自己的推理与感知，**PEN 应用**提供游戏、媒体、社交等人类活动的接入；PENS 运行并管理这些应用。**独立项目**，VIVY 只是潜在消费者之一。

明确写下的意图：服务不同 agent（Hermes、OpenClaw、Codex、Claude、Grok…），**VIVY 可以消费 PENS，但不能成为使用 PENS 的前置**。名单是「意图覆盖」，不是「已验证兼容」。

### 5.2 六条已确认决策

| # | 决策 | 要点 |
| --- | --- | --- |
| D-001 | 独立应用环境 | 一包一应用；PENS 不是 VIVY 子系统 |
| D-002 | 生活类补充能力外置 | 游戏/影视/社交这类「大、吵、运维复杂」的应用放到可复用的应用边界后面；**干扰是否真减少必须测量**，仅把代码移出核心不算证明 |
| D-003 | 世界感知留在 agent 核心 | 图像/视频输入与理解属于核；PEN 只提供播放、媒体访问、位置、交互等接口。**这条推翻了「让基础世界感知依赖装 PEN」的旧读法** |
| D-004 | 应用以包分发 | 包格式/安装/更新/分发/商店均未定；提议「一包一个连贯应用」，粒度待验证 |
| D-005 | 简单主面板 | Apple 桌面式的视觉简洁；是产品方向，不是选框架 |
| D-006 | 首批验证用 Hermes 与 Codex | 不用 VIVY 起步，避免把假设绑死在作者自己的框架上；版本必须在集成调研中钉死 |

### 5.3 七条提议技术方向（未冻结）

Go 做 PENS 核心服务 · TypeScript 做面板 · PEN 包语言中立 · 独立服务 + 公开 agent 接口 · 能复用就复用（MCP 是候选机制，不是完整契约）· **安装 / 激活 / 上下文暴露三者分离** · 按应用决定状态跨连接保留。

一句关键的自我约束：

> 「Discussion 没有授权在 PENS 内部做第二个通用 agent loop、模型 provider 栈、人格系统或记忆系统。」

### 5.4 首个验证（六项证据）

独立性（不装 VIVY 也能起）· 可移植性（两个 agent 用同一包版本、业务代码不变）· 完整交互（读状态/执行/收结果/停止）· 连续性（断连重连符合声明的状态与授权规则）· 干扰（上下文/工具暴露、事件量、模型调用、后台活动）· 失败行为（退出、超时、取消、被拒操作对两端可见）。

并有一条反自欺的限定：**「调用成功一次，只对那一次调用是证据」**；流式、非请求事件、唤醒、多媒体输入、恢复必须逐 host 报「已验证 / 不支持 / 未测」。PENS 不能赋予宿主不具备的能力。

### 5.5 待定项（7 条）与历史来源

待定：①钉死 Hermes/Codex 客户端与集成路径 ②首个完整应用场景与初始 OS ③宿主语言/面板框架/进程边界 ④最小包-身份-权限-生命周期-观察-动作-事件契约 ⑤状态归属、密钥、取消、重连 ⑥是否需要桌面壳 ⑦商店与分发。

来源链（`REFERENCES.md`，均为 pinned commit）：`agent-diva@c565bb2`（2026-08-23 原始研究包，状态 Research/Proposal）、`agent-vivy@1fefaca`（2026-09-29 归档迁移，12 个文件保留原 blob hash）。历史概念 Neuro-Link / Mirror / Workbench / Companion Node **不自动进入 PENS v1**。

### 5.6 与我们的直接关系

- **同组织**：读它等于读「自家另一块地的规划」，而非外部方案；
- **它把我们的位置写清楚了**：如果未来 VIVY 消费 PENS，我们的 Superagent 就是那个「通用 agent loop + provider 栈 + 人格 + 记忆」；PENS 明确不碰这四样——这正好印证我们不该把它们塞进任何「应用包」；
- **D-003 是一条反向红线**：我们 `capability-hub` 正在做「感知/推理能力外包给 provider」（asr/tts/decision/embedding/omni 插槽）。这两件事不冲突（一个是「要不要装 PEN」，一个是「用哪个 provider」），但必须写清：**provider 是能力来源，不是应用包**；
- **「安装 ≠ 激活 ≠ 上下文暴露」是我们目前没有的**（见 D3）。

---

## 6. 三源对照

### 6.1 一张矩阵看完

| 维度 | 本仓 `diva-dsh` | 淋雨家工作台 | PENS |
| --- | --- | --- | --- |
| 所在层 | 运行时 + 控制平面 | 干活方式 + 桌面壳 | 应用生态 |
| 扩展单位 | 插件（15 本地 + 1 第三方 submodule） | 场景（面板组合 + 会话绑定） | PEN 包（一包一应用） |
| 记忆事实源 | ActMem（活）/ MemPalace（档） | `场景私有记忆.md`（文件唯一真源）+ 共享记忆 | **未定义，且明确不建** |
| 上下文注入 | system section / runtime context（记忆卡带开关） | 铁律每轮注入 + §〇 4 KB 开场读 | 安装≠激活≠暴露（提议） |
| 人格 | Laputa 唯一权威 | 「场景即人的一面」（五字段口吻） | 明确不建人格系统 |
| 主体 | 单一 Subject | 多场景，一人面一会话 | 跨 agent（Hermes/Codex） |
| 检查机制 | `npm test` + validation-required + 未验证必写 | 五步法 + exit 非 0 + 反例 + 节奏 + 进待办 | 六项证据检查 |
| 分发 | git submodule + `npm run setup` | MIT 模板 zip + DSH 改造集市 | 未定（仅方向） |
| 成熟度 | 19 submodule、13 篇调研、19 组日志 | 73 提交、224 文件、可跑模板 | 2 提交、纯文档 |

### 6.2 三方共识（独立收敛，说明是硬约束）

1. **单一事实源 + 禁止平行写者**：我们 §6 所有权表 / 它 A–E 修改权分层 / PENS 的包与权限契约——同一句话的三种粒度。附带推论一致：**跨边界只能提请求，不能代写**（我们「框架只写各自域」，它「场景之间只许请求，不许改对方记忆」）。
2. **记忆不能住在会话里**：我们「DSH Session 保存原始执行事实，不被记忆改写」；它「记忆在文件里，不在会话里，会话可以无限换」；PENS「状态保留要按应用声明，不要假设另一个 agent 继承凭据或授权」。
3. **注入的东西必须极短**：我们的易变性分层、它的字节红线、PENS 的「不要把每个已安装工具和后台事件都塞进 agent」。

### 6.3 分叉（需要拍板的真问题）

| 分叉 | 本仓立场 | 对方立场 | 判断 |
| --- | --- | --- | --- |
| F1 人格：一份还是多面 | Laputa 唯一权威 | 场景即人的一面（口吻随场合） | **不冲突，需拆层**：价值观/边界=人格正文；口吻/长度/雷区=投影（见 D2） |
| F2 场景容器：要不要 | 无场景概念，只有项目（TODOLIST）与一个 Web GUI | 场景 = 一类会反复回来的活，独立窗口 + 独立记忆 | 真缺口，但属产品决策，且与「单一 Subject」存在张力（见 D1） |
| F3 能力外包的方向 | 把 asr/tts/向量/决策外包给 provider | 把生活应用外包成 PEN，感知留核 | 不冲突但**必须写清边界**：provider 是能力来源，PEN 是应用（见 D4） |
| F4 检查怎么算数 | 测试 + 交付必填「未验证」 | 必须有一条应当失败的反例 + 挂节奏 + 进待办 | 它更狠，**建议吸收**（见 D5） |

### 6.4 空白清单（按影响排序）

| # | 空白 | 证据 | 影响 |
| --- | --- | --- | --- |
| G1 | 没有「场景」容器：一个 GUI、一个主体、记忆按项目组织 | `TODOLIST.md` 只有项目维度；`plugins/dsh-vivy-studio` 是单面板 | 若要同时做 QQ 陪聊 / B 站理解 / 工作台操作，上下文会互挤 |
| G2 | 插件「装上即进上下文」，没有激活/暴露策略 | `.gitmodules` 19 项全量 setup；技能全量注入；对照 grok-build 的 enable/disable + folder-trust（§7.2） | 与 PENS 提议正相反；技能与事件越多，每轮成本越高 |
| G3 | 没有「应当失败的反例」硬要求 | `AGENTS.md` §7 validation-required 只要求「跑匹配的验证」 | 真实事故已证明：DV-DOC-008 的 React `ref` 崩溃被 `SlotErrorBoundary` 吞成空 div，测试全绿 |
| G4 | 检查失败不会自动进待办 | 体检/测试失败靠人手写 TODOLIST | 报告会躺在日志里过期（它用「体检 ⛔ 自动进待办」解决） |
| G5 | 外部参考源没有登记表 | `.workspace/` 4 仓、`docs/research/` 13 篇之间无「谁是谁的来源」索引 | 重复调研风险：mnemos 已有深挖报告，本轮差点再调一遍 |

---

## 7. 参考物扫描（mnemos / Alife / grok-build）

> 本节是定位级到详读级的混合：mnemos 已有独立深挖报告（`docs/research/mnemos-deep-dive.md`），此处只补它没覆盖的**实测数字**；Alife / grok-build 为本轮新读。

### 7.1 三者给出了什么

**mnemos —— 记忆该长什么样**

- **叙事优先，不是原子碎片**：一次对话 = 一条结构化 Markdown 笔记；vault 是唯一真源，向量库（ChromaDB 或 sqlite-vec）只是可重建索引，`watchdog` 增量同步；
- `[[wikilink]]` 图**按需扫描**（`_WIKILINK_RE`），SQLite 三元组库被作者主动退役；
- Identity Layer：`_identity/L0-identity.md` 作为每次简报的基础层，且按「积压精炼比例」解锁；
- `SessionEnd` 钩子 100 ms 内返回、5 s 宽限窗内起**脱离进程的 worker**（`CREATE_BREAKAWAY_FROM_JOB`）跑「提炼 → 重建简报缓存 → 条件刷新画像」；
- **零 API 成本**：精炼走 `claude --print` 复用宿主订阅，并把 `ANTHROPIC_API_KEY` 从子进程环境剥离。

**Alife —— 插件怎么打包 + IM 网关**

- **全插件化**：连 29 个内置功能都是插件；插件 = 一个含 `manifest.json`（Version / Dependencies / Environments: nuget+pip）的源码文件夹，**运行时编译**进 `Runtime/CompiledPlugins`，`AssemblyLoadContext` 隔离、热重载、依赖自动安装；
- 扩展点刻意只有三种：`[Module]`、成对的 `[InitializeOnLoad]`/`[UninitializeOnUnload]`、`UIAttribute` 派生——插件因此能同时注入 UI；
- 在线插件市场（`Alife.PluginMarket`）+ 主版本兼容门 + 强制升级；
- MCP **双向**：既消费 MCP，又是 MCP 服务端（30 个工具，`127.0.0.1:18765/mcp`，Streamable HTTP），外部 AI 可以通过它开发这个应用本身；
- **IM 网关可直接参考**：`Alife.Function.QChat` 走 **OneBot v11**，群/私聊抽象成 `MessageSource`，带消息缓冲合并与 per-source 最近使用跟踪；
- 记忆不让 AI 自己写：对对话做多级指数压缩，每条摘要带 `[记忆存档(index)]` 与覆盖时段，配 bge-small-zh + DuckDB 检索；工具调用故意不用原生 tool calling，改流式 XML（省 token）。

**grok-build —— 标准清单**

- **插件 = 可安装的组合单元**：skills + 斜杠命令 + agents + hooks + MCP + LSP，经 git/本地 marketplace 分发（`marketplace.json` 索引、sha 锁定），作用域 session/process/project/user/自定义，**folder-trust 统一门禁**，按名字或 `<scope>/<hash>/<name>` 启停、热重载，策略「最严者胜」且**配置写错就锁死而非放行**；
- **15 个生命周期钩子事件**（SessionStart / UserPromptSubmit / PreToolUse / PostToolUse·Failure / PermissionDenied / Stop·Failure·Cancelled / SubagentStart·Stop / Notification / Pre·PostCompact / SessionEnd），可命令可 HTTP，能阻断、能改写工具输出；
- **会话 = 磁盘上一个目录**（`summary.json` + `updates.jsonl` 权威流 + plan/rewind/tool_definitions/compaction/subagents），配 **Agent Dashboard** 做多会话编排；
- **MCP + ACP 双协议**（ACP 供编辑器嵌入）；
- 记忆 v2：Markdown `topics/` + `observations/_inbox/`，向量 0.7 / BM25 0.3 + MMR + 30 天半衰期衰减 + `/flush` + `/dream` 归并 + 压缩前 flush（默认关闭，自称实验性）。

### 7.2 映射到我们的缺口

| 缺口（§6.4） | 谁已经解决 | 可借的形状 | 硬约束 |
| --- | --- | --- | --- |
| G1 场景容器 | grok-build（会话目录 + Agent Dashboard）、淋雨家（场景面板 + 三字段绑定） | 「一会话一目录」+ 多会话编排台 | 与本仓单一 Subject 有张力，先拍 D1 |
| G2 激活/暴露 | grok-build（enable/disable + 三级 scope + folder-trust）、Alife（插件市场 + 版本门）、PENS（提议三分） | **包 → 显式激活 → 上下文暴露** 三层分离 | Alife 是 AGPL，只可读设计 |
| G3 反例验收 | 淋雨家（五步法第 4 步） | 每条检查配一条「应当失败」的样本 | 无 |
| G4 检查进待办 | 淋雨家（体检 ⛔ 自动进待办、去重） | JSON bad 列表 → 待办一行 | 无 |
| 记忆语义 | mnemos（叙事优先 + 可重建索引） | 明文真源、索引可弃、按需派生图 | 停更 6 个月，只读 |
| IM 网关 | Alife（OneBot v11 + MessageSource 缓冲合并） | 群/私聊抽象 + 批处理 + 最近使用跟踪 | AGPL；.NET 代码不可移植 |
| 工具协议 | Alife（流式 XML 调用）、grok-build（MCP + ACP） | 编辑器嵌入走 ACP | grok-build 不接受外部贡献 |

### 7.3 一条值得记住的反证

mnemos 的作者用真实数据量过「原子片段 + 向量检索」这条路线：**约 600 个碎片，RRF 分数挤在 0.014–0.017**，600 节点图「好看但走不通」，于是 v1.0 整条删掉（~3000 行、~200 个测试）改成「一次会话一篇笔记」。

对我们的意义：**MemPalace 的「碎片化 + 向量」不是天然更优的默认答案**。这条实测适合作为「Obsidian / 笔记类接入」与「记忆粒度」两个议题的证据，避免我们为了「上向量库显得专业」而重复别人已经否掉的路线。

### 7.4 许可与可用性（一句话）

| 仓库 | 许可 | 能用什么 | 不能用什么 |
| --- | --- | --- | --- |
| mnemos | MIT | 读设计、抄数据模型与钩子时机 | 当依赖（停更） |
| Alife | **AGPL-3.0** | 只读设计（插件 manifest、OneBot 网关、扩展点） | **不能把代码搬进本仓**；.NET 也不可移植 |
| grok-build | Apache-2.0 | 读标准、对照清单 | 整体移植（185 万行）、提 PR（不接受外部贡献） |

---

## 8. 风险与健康度

| # | 风险 | 级别 | 说明 / 缓解 |
| --- | --- | --- | --- |
| R1 | 把淋雨家「场景容器」直接并入本仓 | 高 | 与「单一 Subject + 单一控制核心」存在架构张力；应先拍板 D1，再谈实现 |
| R2 | 版本漂移：它的模板自述在 `0.2.1-rc.3` 验证，本仓跟 `0.2.1-rc.5` | 中 | 面板注册/注入接口是否兼容**未核实**；真要用，先跑 `11-最小可运行壳` 再跑 `12-源码照搬` 做一次端到端 |
| R3 | 直接搬它的代码 | 中 | MIT，可搬，但需保留 `Copyright (c) 2026 淋雨家 (mashanglinyu)`；且其模板含大量占位符，直接搬会「指错地方」 |
| R4 | 把 PENS 当依赖 | 中 | 2 个提交、0 star、明确无实现；只能当决策记录引用 |
| R5 | 三方术语冲突（人格/记忆/场景/包） | 中 | 建议在 `docs/architecture.md` 增一节术语对照，避免插件作者各说各话 |
| R6 | 淋雨家材料的权威性 | 低 | 单人维护、非官方；文中数字自述「随版本变化」；与官方文档冲突时以官方为准 |

**健康度速览**：本仓活跃（当日有提交）；淋雨家 73 提交集中在 2026-09-30→11-04，之后无更新（约一周）；PENS 自 2026-09-29 起未动；mnemos 2026-05-01 后停更（已有结论：参考其复盘而非代码）；Alife 活跃（插件 5.0.x/5.1.x，数日内有提交，浅克隆无历史）；grok-build 上游活跃，本仓只收周期批量同步（51 提交，末次 2026-09-29），且**不接受外部贡献**。

---

## 9. 决策清单（D1–D6）

> 规则：**不拍板不实施**。每条给出选项、推荐、影响面。

### D1 — 是否引入「场景」容器（独立窗口 + 独立记忆 + 面板组合）

- 选项：A 不引入（保持单 GUI、项目维度组织）｜B 只借概念，不建容器（在 TODOLIST 里加「场景」分区，仍是同一主体）｜C 建容器（独立壳或多面板工作台，参考淋雨家模板）
- **推荐：B（本轮），C 另立调研**。理由：B 只改文档组织，零架构风险；C 会碰到「单一 Subject / 单一控制核心」两条已确认决策，必须先出设计。
- 影响面：`TODOLIST.md`、`docs/architecture.md`；若走 C 则牵连 `plugins/dsh-vivy-studio`、`stage-app`、会话路由。

### D2 — 人格是否允许「场景投影」

- 选项：A 维持单一人格（所有场合同一腔调）｜B 人格核心 + 口吻投影（投影只是参数，不写事实源）
- **推荐：B**。理由：与 Laputa 唯一权威不冲突——投影不含价值观/边界/关系，只是长度、称呼、语气、雷区；落点在 `plugins/dsh-vivy-tone`，由 Laputa 版本钉住投影集。
- 影响面：`dsh-laputa`（人格正文边界）、`dsh-vivy-tone`（投影存储与注入）、`docs/architecture.md` §2.2 补一句「投影不是人格事实源」。

### D3 — 是否引入「安装 ≠ 激活 ≠ 上下文暴露」三分

- 选项：A 维持现状（装上即生效、全量注入）｜B 引入 per-session 激活与暴露策略（插件启用集 + 技能订阅 + 事件订阅），形态可参 grok-build 的「包 → 激活 → 暴露」三层（§7.1）
- **推荐：B，分两步**：先做「技能/工具的会话级暴露清单」（纯配置 + 注入过滤），再谈插件级启用。理由：这是 PENS 提议里对我们最直接可用的那条，也能直接降低每轮 token；风险低于场景容器。
- 影响面：`deepseek-harness` 侧只能走插件或 patches；`plugins/dsh-*` 的注册入口；记忆卡投递开关（已有先例）。

### D4 — 能力插槽与「应用包」的边界怎么写

- 选项：A 不写｜B 在 `architecture.md` 增一节「provider 是能力来源，PEN/应用包是应用」，并禁止把 provider 凭据/路由带进应用包
- **推荐：B**（纯文档）。理由：`capability-hub` 与 PENS 方向相反但语义相邻，不写清会在未来产生第二套凭据或第二套模型栈（PENS 提议明确不授权）。
- 影响面：`docs/architecture.md`、`docs/research/capability-hub-slots.md` §10 交叉引用。

### D5 — 是否采纳「反例验收」为仓库硬规则

- 选项：A 不采纳｜B 写进 `AGENTS.md` §7：新增/修改检查类代码时，必须附一条「应当失败」的用例或说明为何不可构造；交付日志 `verification.md` 增「反例」一栏
- **推荐：B**。理由：成本是一次模板改动，收益是防住「永远通过的检查」；DV-DOC-008 已经用一次真实事故付过学费。
- 影响面：`AGENTS.md`、`docs/logs/_TEMPLATE/verification.md`、`tests/`。

### D6 — 是否建立「外部参考源登记表」

- 选项：A 不建｜B 在 `docs/resources/` 建 `references.md`：仓库 / HEAD / 许可 / 对应调研报告 / 结论（可用/仅参考/不用）
- **推荐：B**。理由：`.workspace/` 已有 4 仓、`docs/research/` 已有 13 篇，本轮 mnemos 差点重复调研；一页表能省下重复工作，并让「读过什么、什么版本」可追溯。
- 影响面：`docs/resources/references.md`（新）、各调研报告 §参考互链。

> **D7–D9 见 §10.8**：按 2026-11-11 追加原则（无记忆、无人格、只接线、可接 Codex/Hermes）产生，分别定首个 PEN 选型、接口形状、暴露权归属。

---

## 10. 追加洞察：按「无记忆、无人格、只接线」收窄后的 PENS

> 触发：2026-11-11 16:2x，用户给出原则——**不带人格和任何记忆系统，仅做「外部附加功能接线」（例如 Blender 这类），并且最好能接 Codex、Hermes 等**。以下是把这条原则代进 §5 决策记录后，结论发生了哪些变化。

### 10.1 一句话定义（收窄后）

**PENS = 应用接线总线 + 接线清单**：把一个外部应用（Blender、浏览器、播放器…）变成 agent 可调用的**受限动作面**与可**拉取**的观察面，并管理进程、连接、作业与授权；它**不持有语义状态、不写记忆、不管人格、不注入上下文**。

它因此不再是三样东西：不是工作台（没有场景/派单/记忆）、不是 OS（不管 UI 主体与桌面）、不是 agent 框架（不建 loop / provider 栈 / 人格 / 记忆——PENS 文档自己已经这么写）。

这个收窄的好处：**与任何 agent 的重叠面积归零**，于是「能被 Codex/Hermes 接」不再是宣传语，而是设计前提。

### 10.2 「无记忆」的三条硬推论

| # | 推论 | 具体含义 | 外部先例 |
| --- | --- | --- | --- |
| 1 | **状态归应用** | Blender 的 scene、浏览器的 DOM、播放器的进度都归应用本身；PENS 只持**句柄**（pid / 端口 / 路径 / 窗口 id），句柄失效即重连，不做语义缓存 | 本仓 MemPalace：「原文件系统是内容事实源，MemPalace 只拥有派生索引」 |
| 2 | **「做到哪」归 agent** | PENS 不写交接、不写进度、不记「上次参数」；连续性由调用方负责（我们的 ActMem、Codex 的 session、Hermes 自己的记忆） | PENS D-001 的反向：VIVY 可消费但不是前置 |
| 3 | **暴露权在宿主，不在 PENS** | PENS 只回答「能不能调」，不回答「要不要让模型看见」；哪些动作进上下文由每个 agent 宿主决定 | 这条把 PENS 提议的「安装≠激活≠暴露」反转了一半：**前两段归 PENS，第三段必须归宿主** |

第 3 条是本轮最重要的修正。收窄之前，我把「上下文暴露」当作 PENS 的分内事；收窄之后它必须交还宿主——否则 PENS 就在做上下文管理，那是记忆与人格的邻域，正是用户明确排除的。

### 10.3 接线的最小抽象：三面 + 一个作业

| 面 | 内容 | 合格判据 |
| --- | --- | --- |
| 打开 / 附着 | 起进程、附着到已有实例、连接应用内 addon | 失败要能说清「没装 / 没起 / 版本不对」 |
| 执行 | **受限动作集**（不是 `run_anything`）；执行单元是**作业**：job id、进度、取消、超时 | 渲染、模拟这类分钟级操作不能占着一次调用 |
| 观察 | 操作后读回自证：结构化状态优先，截图兜底 | 「点了 ≠ 生效」（AivyOS 对标与 Alife 独立得出同一条） |
| 制品 | 产物路径 + 校验和（PNG / EXR / GLB / .blend / 日志） | 制品交给 agent 的记忆与交付层，PENS 不存 |

配套一条不变量：**PENS 持久化只允许「句柄 + 权限账本 + 包元数据」**；一旦出现业务字段（上次用了哪个灯光、上次渲染到第几帧），就是影子记忆（R11）。

另有一条成本事实（§4.6 实测）：**一个应用的动作面本身就是 token 成本**——淋雨家工作台里 Blender 32 工具 ≈8.9k token/轮、桌面操控 57 工具 ≈26.8k/轮、5 个网页 AI 全开 ≈660/轮。所以接线必须自带**工具裁剪/按需暴露**，否则每接一个应用就是一笔固定的每轮税；这也解释了为什么它把 MCP 开关做成逐项可关。

### 10.4 Blender 作为首个 PEN 的解剖

三条路线，按我们既有的判据排序（官方脚本接口 → 文件/CLI → GUI/像素）：

| 路线 | 做法 | 优点 | 代价 / 风险 |
| --- | --- | --- | --- |
| **A 官方 Python API（推荐）** | `blender -b file.blend -P script.py` 批处理；或在应用内装 addon 暴露本地 socket/HTTP，由 PENS 调用 | 可读回 bpy 状态、无需 GPU 视觉、天然支持作业与取消、产物直接落盘 | 等于给外部应用开了一个**任意代码执行面** → 必须动作白名单 + 沙箱 + 人审；4.x / 5.x API 漂移 |
| B 文件 / CLI 契约 | 输入 `.blend` + 参数 + 输出目录，一次一作业 | 最简单最稳，像渲染农场 | 交互性弱（改一个参数=重跑一次），观测只到产物级 |
| C GUI 自动化 | 控件树操作 / 像素点击 | 无需应用配合 | 3D 视口是自绘，控件树基本无效 → 像素级代价最高（参见淋雨家 `13-公开情报/执行层-界面自动化方案对比.md` 的六路线与五判据：许可 / 常驻 / GPU / 可读回 / 权限面） |

结论：**Blender 的接线必须落在它自己的脚本接口上**。这也正是「外部附加功能接线」能长期活的前提——**应用侧提供接线点，PENS 只做适配与治理，不去 hack UI**。凡是只能靠点鼠标的应用，接线成本会高一个数量级，应当排在后面。

首个 PEN 的最小验收（对齐 PENS 的六项证据）：

1. 不装 VIVY 也能起；
2. 两个 agent 用同一包、业务脚本不改；
3. 能读状态（场景对象数 / 渲染设置）、能执行（改材质 / 加物体 / 渲染）、能拿结果；
4. 取消一次渲染，应用仍在且状态可读；
5. 断连重连不丢应用状态（因为状态本来就在应用里）；
6. 拒绝一次越权动作，两个 host 都能看到。

### 10.5 跨 agent（Codex / Hermes）的最小可移植面

**必须标准化的只有三样**：

1. **调用形状**：MCP（tools / resources / progress / cancellation）——三个宿主里最容易同时支持的形状；需要编辑器嵌入时再加 ACP；
2. **包与生命周期清单**：manifest（启动方式、依赖、版本约束、动作集、权限声明、制品声明）；
3. **身份与授权**：agent 身份 × 会话 × 应用 × 动作 × 有效期（一个「租约」概念）。

**明确不标准化**：UI、提示词、记忆、人格、上下文组装。任何一样标准化，都会要求宿主改架构，跨 agent 立刻失效。

还要写死一条边界：**PENS 不承诺「无人请求的主动唤醒」**。MCP 是拉取模型；主动唤醒应由宿主自己的 job / schedule 承担（我们的 DSH Jobs、grok-build 的 hooks + ACP、Codex 自身的调度）。否则 PENS 就变成了第二套控制平面。

接入前必测的能力矩阵（避免「大概支持」）：`tools` / `resources` / `progress` / `cancellation` / 通知方向 / 单次超时上限 / 并发上限——每项对每个 host 记「已验证 / 不支持 / 未测」，与 PENS 六项证据同一口径。

### 10.6 与我们关系的重排

| 轴 | 归属 | 进入 agent 的方式 | 不该做什么 |
| --- | --- | --- | --- |
| 模型能力（chat / 视觉 / ASR / TTS / 向量 / 决策） | capability-hub（provider） | 宿主 provider 注册表 | 不长成应用商店 |
| 外部应用（Blender / 浏览器 / 播放器） | PENS 或第三方 MCP server | 宿主作为 MCP client 调用 | 不把应用状态塞进记忆卡 |
| 人格 | Laputa | 人格正文 + 口吻投影 | 不进 PEN、不进 provider |
| 记忆 | ActMem / MemPalace | 卡 + 归档 + 检索 | 不在 PENS 侧缓存「上次做到哪」 |

**一条判据**：需要「记住做到哪」的能力属于 agent；需要「启动一个外部世界」的能力属于 PENS。

于是 PENS 与我们的关系是**外设总线 vs 主体**，正交、无重叠。我们该做的是一个 **PENS consumer adapter**（或者干脆只作为 MCP client），不是一个内建的 PENS 模块。这条同时把 §8 的 D4 钉死：provider 是能力来源，PEN 是应用，**两者都不得携带人格与记忆**。

### 10.7 新风险

| # | 风险 | 级别 | 缓解 |
| --- | --- | --- | --- |
| R7 | 同质化：若 PENS 只是「一堆 MCP server」，生态里可被直接替代 | 高 | 差异化放在 manifest + 作业模型 + 权限账本 + 读回契约，而不是协议本身 |
| R8 | Blender 类应用等于开一个任意代码执行面 | 高 | 动作白名单（不提供万能 `run_script`）+ 沙箱 + 人审；参照 grok-build 的 fail-closed 策略 |
| R9 | 两个 agent 抢同一个应用实例 | 中 | 租约（owner/lease）+ 冲突可见；参照 grok-build 的 subagent 归属与 Alife 的 per-source last-use |
| R10 | 版本矩阵：Blender 4.x/5.x、各宿主 MCP 能力差异 | 中 | 能力探测表 + 降级路径；结论必须带版本号，不写「大概支持」 |
| R11 | 「无记忆」被悄悄破坏（缓存参数、记住最近文件） | 高 | 硬不变量：持久化只允许句柄 / 权限 / 包元数据；出现业务字段即视为影子记忆 |

### 10.8 新决策（并入 §9 清单）

- **D7 — 首个 PEN 选型**：A Blender（推荐）｜B 浏览器｜C Minecraft。推荐 A：非编码、有官方脚本接口、产物可验证（渲染图）、两个宿主演示成本最低。
- **D8 — 接口形状**：A MCP + manifest 扩展（推荐）｜B 自定义 SDK。推荐 A：Codex/Hermes 接入零改造；B 会立刻退化成「每个 agent 一个适配器」。
- **D9 — 暴露权归属**：A 宿主决定（推荐，落到 D3 的会话级暴露清单）｜B PENS 决定。推荐 A，理由见 §10.2 推论 3。

---

## 11. 参考

| 来源 | 版本/提交 | 访问日期 |
| --- | --- | --- |
| `ProjectViVy/diva-dsh` 本地仓 | `1e0fde8`（2026-11-10） | 2026-11-11 |
| `mashanglinyu/luanyujia-workbench` | `ee87f1c`（2026-11-04），MIT | 2026-11-11 |
| 同上：`总纲.md` / `_索引.md` / `00-核心机制/README.md` / `08-升级与改造清单/把规矩变成机制.md` / `12-源码照搬/README.md` / `12-源码照搬/说明/记忆约定.md` / `13-公开情报/*` | 同上 | 2026-11-11 |
| `ProjectViVy/pens`：`README.md` / `docs/DECISIONS.md` / `docs/REFERENCES.md` | `bf76d55`（2026-09-29） | 2026-11-11 |
| `mnemos-dev/mnemos`：`README.md` / `STATUS.md` / `pyproject.toml` / `server.py` / `search.py` / `session_end_hook.py` / `watcher.py` | `c092d98`（2026-05-01），MIT | 2026-11-11 |
| `BDFFZI/Alife`：`README.md` / `AGENTS.md` / `PluginSystem.cs` / `PluginContext.cs` / `AlifeMcpTools.cs` / `MemoryManager.cs` / `QChatService.cs` / manifest 样例 | `0707f04`（2026-11-01），AGPL-3.0，浅克隆 | 2026-11-11 |
| `xai-org/grok-build`：`README.md` + `docs/user-guide/{09-plugins,10-hooks,13-memory,17-sessions,23-dashboard}.md` + `crates/codegen/{memory,plugin-marketplace,mcp,hooks,shell,acp-lib}` 目录树 + `SOURCE_REV` | `2bdd1d6a`（2026-09-29），Apache-2.0 | 2026-11-11 |
| GitHub API `orgs/ProjectViVy/repos` | REST v3 | 2026-11-11 |
| 本仓 `docs/architecture.md`（六条核心决策、§6 所有权表） | 2026-11-03 | 2026-11-11 |
| 本仓 `docs/research/mnemos-deep-dive.md`（已有结论，不复述） | commit `c092d98` | 2026-11-11 |

**未核实项**（不写进结论）：

1. 淋雨家外壳在 DSH `0.2.1-rc.5` 上能否正常运行（其自述验证于 rc.3）；
2. 其面板注册与 `sessionId` 绑定接口与本仓 `dsh-vivy-studio` 的兼容性；
3. PENS 的任何集成（PENS 自身也未实现）；
4. `reference/Alife`、`reference/grok-build` 的可借鉴点已做**读源码级**扫描（§7.1），但**未实际运行**其中任何一个；
5. 淋雨家「免费 AI 桥」（网页版 AI 经 MCP 接入）在本机的可用性；
6. Alife 的 QQ 网关在其本机实机联调情况（本轮只读代码，未见运行证据）。
