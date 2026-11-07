# dsh-superagent-template

在一个目录内构建和运行 [dsh-superagent](https://github.com/deepseek-ai/dsh-superagent-prototype) 与 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的源码。项目不会安装全局 `dsh` 或 `pnpm`，也不需要修改 shell 配置。

个人持久化 Agent 的控制核心、人格、记忆、进化与外部系统边界见[总体架构](docs/architecture.md)。项目路线、依赖波次与当前可执行任务见[项目开发计划](docs/superpowers/plans/vivy-dsh-ecosystem/index.md)。

## 启动

需要 Node.js 22.19.x 或 24 及以上版本、npm、Git，以及首次安装时的网络连接。在本目录执行：

```sh
npm run setup
npm start
```

`setup` 会按主仓库记录的提交初始化 Git submodule，在项目内安装 DSH、Superagent 和 SurfCore 的依赖、安装记忆宫殿的 SQLite 原生依赖、编译所需源码，并创建独立配置。运行中的服务需要先用 `npm run stop` 停止，才能重新执行 `setup`。也可以在克隆时使用 `git clone --recurse-submodules <仓库地址>`。

`npm start` 在后台启动服务，将本项目根目录登记为 DSH 工作区，并输出带临时 token 的面板链接。默认面板地址为 `http://127.0.0.1:3082`；若需要找回链接，可查看 `.artifacts/` 下最新的 `vivy-dsh-superagent-local-*.log`。每次重启后请使用新的链接。已有工作区和会话会保留。

首次启动时，Superagent 会等待配置，状态码为 `3`。打开面板左侧的 **Superagent**，填写 GitHub 仓库、允许发起工作的用户和执行目录；实际运行任务还需要配置模型及用于该仓库的 GitHub 账号。

## 日常命令

```sh
npm start                 # 启动并输出面板链接
npm run status            # 查看运行和配置状态
npm run proxy -- http://127.0.0.1:7897   # 保存出站代理，重启后生效
npm run proxy -- off        # 关闭出站代理（即使 shell 导出过代理变量）
npm run proxy -- status     # 查看配置值、已启动值与是否需重启
npm run stop              # 停止
npm run restart           # 重启
npm run setup:surfcore    # 服务停止时重新安装并注册 SurfCore
npm run setup:components  # 服务停止时迁移并注册独立语音、记忆、记忆宫殿、持续进化与进化管理插件，生成 SurfCore 组件补丁
npm run setup:mempalace   # 安装并校验记忆宫殿的原生依赖
npm run setup:mempalace -- --verify      # 只校验，不重新安装
npm run setup:mempalace -- --warm-models # 额外下载向量模型（可选）
npm run setup:continual-harness          # 安装依赖并构建持续进化插件源码
npm run setup:continual-harness -- --force  # 强制重新安装并构建
npm run setup:laputa                     # 构建人格插件（不创建人格）
npm run setup:laputa -- --init vivy      # 创建空人格模板并启用 vivy（首次对话引导填写）
npm run setup:laputa -- --verify         # 只校验插件能否加载
npm run build:bundle      # 修改 superagent/ 后重建插件
npm test                  # 全量单测：本地路径、迁移、组件边界、补丁与插件行为
```

`start`、`status` 和 `restart` 的退出码：`0` 为正常；`1` 为未运行或启动失败；`2` 为某个部件报错；`3` 为服务正在运行但等待配置。

## 网络代理

服务的出站请求统一走一个进程级代理策略：模型调用、web 搜索、页面抓取、走 HTTP 的 MCP 服务器，以及 DSH 派生的子进程（`git`、`gh`、`curl`、stdio MCP、Node 子进程）都在内。开启方式三种，优先级从高到低：

1. 一次性开关：`npm start -- --proxy http://127.0.0.1:7897`，或 `--no-proxy` 强制直连。
2. 保存配置：`npm run proxy -- http://127.0.0.1:7897`，写入 `.artifacts/proxy.json`（已在 gitignore 内，可带 `noProxy` 字段）。`npm run proxy -- off` 删除配置并强制直连。
3. 不配置：启动器不干预，`$DSH_HOME/.env`（本项目为 `.artifacts/dsh-home/.env`）或 shell 里导出的 `HTTPS_PROXY` 照旧生效。

配置在启动时解析一次，改完需要 `npm run restart`；`npm run status` 的 `proxy.needs_restart` 会指出运行中的进程是否落后于配置。

- 地址可省略协议，`127.0.0.1:7897` 按 `http://` 处理。
- **不支持 SOCKS**：请指向代理软件的 HTTP 端口（Clash 类软件的混合端口可以直接用）。
- `NO_PROXY` 按主机名或域名后缀匹配，**不支持 CIDR**；loopback 始终直连，不必写。
- 带凭据的代理 URL 会随环境传给 DSH 运行的所有子进程，包括模型写的命令，建议改用免密入口。
- TLS 拦截型代理需要 `NODE_EXTRA_CA_CERTS`；该变量只能 shell 导出，写进 `.env` 会被拒绝。
- 只覆盖 DSH 服务本身：`npm run setup`、`pnpm install`、submodule 拉取仍需在 shell 里导出代理变量。

## 目录与版本

```text
dsh-superagent-template/
├── deepseek-harness/   DSH 源码 submodule，固定在 b830ec950faba0a46dda564be3e2d854afed94f1
├── superagent/         Superagent 源码 submodule，固定在 6337fc823ce20251c8de8085948165c81aaa701e
├── plugins/surfcore/   SurfCore 源码 submodule，固定在 59ec3066f7d42a0452fae01f170c9a8484d5dbe5
├── plugins/            本地各模块已拆成独立仓库（见下「模块仓库」），根仓库不再跟踪其源码
├── stage-app/          独立的 Live2D 舞台进程，同样是独立仓库
├── patches/            Superagent 的 Windows 路径兼容补丁
├── scripts/            本地安装、构建和启停脚本
├── tests/              启动器的本地路径、配置及补丁测试
├── .npmrc              将根目录 npm 缓存放在项目内
└── .artifacts/         本地工具、依赖缓存、配置、状态、临时文件和日志
```

DSH 固定提交对应 `dsh-v0.2.1-rc.5`，SurfCore 固定提交对应 `v0.8.6`。主仓库的 Git submodule 指针记录这些完整提交；`setup` 不会自动升级它们，如果本地子模块切换到其他提交，它会提示并保留现状。检出 submodule 时仍会有源码目录，但主仓库不再重复存放源码副本。

### 模块仓库

除三个上游 submodule 外，本地模块各自独立建仓维护，统一建在 <https://github.com/vivy-dsh> 下。
根仓库用 `.gitignore` 排除它们；每个模块的 README 末尾都有「来源与许可」章节，记录同一份上游信息。
**移植类模块的版权归上游原作者，本仓库只做 DeepSeek Harness / 本项目的移植与适配。**

| 目录 | 仓库 | 上游来源 | 原作者 | 上游许可 |
| --- | --- | --- | --- | --- |
| `plugins/_shared` | `dsh-plugin-shared` | 本项目原创 | — | — |
| `plugins/asr` | `dsh-local-asr` | [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 实验性语音输入四件套 | DeepSeek | MIT |
| `plugins/memory` | `dsh-local-memory` | [Mieksido/surfcore](https://github.com/Mieksido/surfcore) v0.8.6 + QQ 桥接 | Derpyu520 and qq-bridge / QSH contributors | MIT |
| `plugins/voice` | `dsh-local-voice` | 同上 | 同上 | MIT |
| `plugins/dsh-actmem-recap` | `dsh-actmem-recap` | 本项目原创；设计参考 [OpenAI Codex](https://github.com/openai/codex) 的 `/recap` | — | — |
| `plugins/dsh-continual-harness` | `dsh-continual-harness` | [jasen215/dsh-continual-harness](https://github.com/jasen215/dsh-continual-harness) | dsh-continual-harness contributors | MIT |
| `plugins/dsh-evolution` | `dsh-evolution` | 本项目原创 | — | — |
| `plugins/dsh-laputa` | `dsh-laputa` | [ProjectViVy/laputa](https://github.com/ProjectViVy/laputa) @ `c4d649d` | dashimaki | MIT |
| `plugins/dsh-live2d` | `dsh-live2d` | 本项目原创 | — | — |
| `plugins/dsh-mempalace` | `dsh-mempalace` | [Jabbslad/pi-mempalace](https://github.com/Jabbslad/pi-mempalace) 0.2.1 | Jabbslad | ⚠️ 上游无 LICENSE 文件 |
| `plugins/dsh-skin-manager` | `dsh-skin-manager` | [hust-open-atom-club/oh-dsh](https://github.com/hust-open-atom-club/oh-dsh) 的四个配色 | hust-open-atom-club | MIT |
| `plugins/dsh-surfcore-adapter` | `dsh-surfcore-adapter` | 本项目原创（配合 [Mieksido/surfcore](https://github.com/Mieksido/surfcore)） | — | — |
| `plugins/dsh-vivy-studio` | `dsh-vivy-studio` | [mastwet/vivy-studio](https://github.com/mastwet/vivy-studio)；内嵌 LXGW WenKai 字体 | mastwet / LXGW | SIL OFL |
| `plugins/dsh-vivy-tone` | `dsh-vivy-tone` | 本项目原创 | — | — |
| `stage-app` | `dsh-stage-app` | 本项目原创；`demo/` 为 Live2D 官方示例模型 | Live2D Inc.（仅 `demo/`、`vendor/`） | 专有 |

⚠️ 两处**公开分发前必须确认**的授权问题：

- `dsh-mempalace`：上游 `pi-mempalace` 仓库没有 LICENSE 文件（GitHub 许可证检测为 `null`）。
  缺许可文件时默认「保留所有权利」，公开再分发前应先与上游确认。
- `dsh-stage-app`：`vendor/live2dcubismcore.min.js` 是 Live2D Cubism SDK 的专有 Core，**不随仓库分发**
  （`.gitignore` 已排除，见 `vendor/README.md`）；`demo/Hiyori/` 是 Live2D 官方示例模型，
  其使用与再分发同样受 Live2D 授权条款约束。

SurfCore 可通过 DSH 左侧与 Superagent 同级的 **SurfCore** 入口直接打开。DSH rc.5 与上游注册方式有冲突，项目在 `.artifacts/surfcore-adapter/` 生成本地兼容文件和界面产物，源码仍从固定的 submodule 加载。启动器把已发现的旧 `.dsh` 路径指向项目数据目录，并关闭 QQ、B 站、扩展、自动更新及相关自动任务的启动；这些进程级设置不会写入系统环境。

手动启用的 SurfCore 扩展可以通过 `api.memory` 访问独立记忆插件：`memoryStatus()`、`previewQqForBili()`、`syncQqToBili()`、`refreshBiliToQq()`、`biliToQqStatus()` 和 `auditTail()` 均为异步方法，需要 `await`。状态和审计以独立插件的数据格式为准；审计最多返回最近 40 条。`memoryStatus()` 在单个方向失败时保留另一方向的结果，并在失败方向返回 `ok: false` 和错误信息；两侧都失败时抛错。插件不可用时调用报错，QQ 公开群同步仍受独立插件的开关与群白名单限制。

记忆作为独立插件注册在左侧栏，数据保存在 `.artifacts/dsh-home/memory/`；语音数据保存在 `.artifacts/dsh-home/voice/`。迁移会先在 `.artifacts/backups/` 创建带校验清单的备份，保留原始数据；重复执行不会再次覆盖迁移结果。QQ 私聊不会进入 B 站上下文，QQ 群聊共享默认关闭。

语音识别与语音合成的界面只有一处：**DSH 设置 → 语音**。`dsh-local-voice` 的客户端注册唯一的 `settings.section`，通过两个插件的公开 HTTP 接口管理总开关、ASR 参数、TTS 参数、语音包、语音库、云端配置、自检与试听。左侧栏不再有「语音」或「语音识别」面板；输入框工具栏的麦克风仍由 `dsh-local-asr` 提供。任一插件未启用时只显示该侧不可用，另一侧仍可操作。见 [语音插件](plugins/voice/README.md)。

### 记忆与语音组件边界

记忆和语音已从 SurfCore 拆成独立插件，SurfCore 只保留 QQ/B 站传输与会话环境：

- `dsh-local-memory`：记忆卡、完整会话记忆、QQ 公开消息同步、B 站公开记忆、会话映射去重、对话收尾、黑话学习、上线补历史和上下文快照。配置、数据、收件箱和备份都在 `.artifacts/dsh-home/memory/`，公开消息流由 SurfCore 写入、插件读取。
- `dsh-local-voice`：TTS、语音包安装与导入、音频库、ffprobe/ffmpeg 处理、触发规则、分钟/小时限流、发送审计、`prepare-send` / `commit-send` / `abort-send` 发送编排，以及「设置 → 语音」的客户端页面。发送经 Superagent `voice` Effect 记录回执；同一 token 重复 commit 复用回执，结果未知时不自动重投，abort 拒绝在途或终态。配置、语音包、语音库、限流账本和审计在 `.artifacts/dsh-home/voice/`。
- SurfCore 适配层在 `.artifacts/surfcore-adapter/patches/` 生成构建期补丁并记录 `patched-manifest.json`。每个改动有具名锚点和源码 sha256；上游源码变化导致锚点或哈希不匹配时，构建和启动会报 `SURFCORE_PATCH_DRIFT`，不会静默使用半成品。不要直接修改 `plugins/surfcore/`。

人格、角色和桌宠不迁移，新代码不得 import 这些模块；`tests/component-boundaries.test.mjs` 会对此做守卫。配置字段、状态文件、HTTP 与组件 IPC 详见 [记忆插件](plugins/memory/README.md)、[语音插件](plugins/voice/README.md) 和 [语音识别插件](plugins/asr/README.md)。

QQ 会话的话题、待说事项和成员印象由记忆插件管理，首次加载时从旧会话状态读取，原文件和迁移备份会保留。面板里修改会先保存会话备份；桥接与记忆插件之间的待处理事件保存在项目内，插件恢复后自动重试。记忆插件还会在本地定期整理记忆，衰减前先备份，不会因此主动发送消息。两个插件可分别停用，停用的能力会显示为不可用。

B站公开记忆可在记忆面板手动刷新；定期刷新默认关闭，只有在面板显式打开后才会读取 B站公开数据。QQ 群聊共享同样需要单独开启。

记忆面板另提供 QQ 公开群消息摘要：须先显式开启并填写群白名单；定时同步默认关闭。修改白名单或同步规则会使旧摘要失效，需要重新同步。摘要经过脱敏并生成话题汇总；功能迁回进度及未完成项目见 [功能核对清单](docs/feature-restoration.md)。

记忆面板只保留概览、记忆卡和设置三个标签，会话、同步与备份收在设置页。概览中的“归档出站”只读显示待投递、冲突、已确认、无效与最近错误；面板不再提供全量归档浏览、归档搜索或归档容量上限设置，归档投递仍由内部意图与回执处理。

语音包可从解压后的离线目录检查并导入到项目内；没有完整性清单的包需要在界面明确选择继续。导入不会删除源目录；移除语音包时会先移到项目内的备份目录，可从语音面板恢复。现有离线包提供 Windows 运行时；其他系统若使用自备引擎，需提供本机回环地址。

**记忆宫殿**（`dsh-mempalace`）是独立的语义记忆插件，入口在左侧栏与记忆、语音同级，提供概览、记忆浏览、搜索、知识图谱、宫殿图、日记和设置七个标签。它把对话存为带本地向量和全文索引的 SQLite 数据，按项目与话题组织，并可沿共享话题跨项目检索。数据位于 `.artifacts/dsh-home/mempalace/`（`memories.db`、`config.json`、`migration.json`、`archive/`、`models/`、`backups/`），不会写入 `~/.pi` 或其他项目外目录。它与 `dsh-local-memory` 分工不同：后者负责会话、QQ 与 B 站等社交上下文，记忆宫殿负责可检索的长期语义记忆，两者可分别停用。

向量模型（all-MiniLM-L6-v2）和话题模型（flan-t5-small）在首次使用时才下载到 `.artifacts/dsh-home/mempalace/models/`。网络受限时可在面板设置或 `config.json` 中把 `hfEndpoint` 指到镜像（例如 `https://hf-mirror.com`），或先运行 `HF_ENDPOINT=https://hf-mirror.com npm run setup:mempalace -- --warm-models`。模型不可用时插件不会阻塞宿主启动：既有归档仍可检索，检索自动退回 SQLite 关键字模式，面板会显示“语义检索未就绪”，模型恢复后可在设置页执行重建索引。

记忆宫殿不再自动捕获对话或向系统提示注入身份；新个人记忆由 ActMem 写入，历史归档仍可检索。面板的记忆页为只读归档与检索投影，不再提供新增或删除入口。启动迁移会备份旧 `config.json`、移除捕获与注入字段，并把旧 `identity.txt` 备份后移入 `archive/`。近期记忆只在面板与只读的 `GET /recent-memory` 中预览，不进入系统提示。命令行提供 `/mempalace status|search|stats|project|export`；模型侧使用 14 个只读记忆工具与显式知识写入工具（`memory_search`、`memory_recall`、`memory_diary_read`、`knowledge_add`、`knowledge_invalidate` 等）。手工记忆写、删除与日记写已退役：`memory_save`、`memory_delete`、`memory_diary_write` 三个工具、`POST /memories`、`POST /memories/delete`、`POST /diary` 三个路由与 `/mempalace save` 都不再提供，三者返回 404；`GET /diary` 仍是只读入口。知识图谱写入保持显式，且不再有绕过账本的直写面：`knowledge_add`/`knowledge_invalidate` 与 `POST /knowledge/entity|triple|invalidate` 都经 `knowledge_commits` 账本写入、返回 `r<revision>`，CAS 锚点默认取 head revision，提交键以 `kg:` 前缀与进化账本的 `evo:` 隔离。面板与模型的全部操作都经过本地回环 API，非 GET 请求会校验同源。

**持续进化**（`dsh-continual-harness`）以源码形式放在 `plugins/dsh-continual-harness/`（上游 v0.3.3），不直接安装 npm 发布包；`setup` 会按其 `pnpm-lock.yaml` 安装依赖并构建到被 `.gitignore` 忽略的 `lib/`。它注册 `harness_refine`、`harness_wrapup`、`harness_benchmark` 等工具，并在每一步注入当前经验状态；数据默认位于 `.artifacts/dsh-home/harness/`（`harness_state.json`、`refinements.jsonl`、`benchmark/`）。写入边界收敛为只写 `skill`：`prompt`、`memory`、`subagent` 的直写会被拒绝并提示所有者（Laputa/Superagent 提示词、ActMem、Agent 注册表），删除旧条目与回滚重放仍允许，系统提示只注入 `skill`。何时精炼由 Superagent 编排器决定：插件不再注册按轮次或压缩触发的自动驱动，`harness_refine`、`/refine` 与 `harness_wrapup` 仅在显式调用时执行；旧 profile 中的 `autoRefine.*` 与 `auditReviews` 仍被接受，但不会启动评审、门禁或清理。

**进化管理**（`dsh-evolution`）是持续进化的伴生面板，入口在左侧栏「人格」之后，同时在 **设置 → 通用** 提供状态和「管理」入口。面板提供概览、条目、精炼记录、会话、基准和设置六个标签：经验条目、精炼历史、复审、会话级 store 与基准结果均为只读展示；设置页通过宿主 `configEditor` 写入 profile 的 `cordis.patch.yml`，校验后重新加载 `continual-harness`。面板不再提供自动精炼开关，配置白名单与状态载荷也不再携带 `autoRefine` / `auditReviews`——这两个键已归编排器所有，面板不再暗示一个不会启动任何东西的控制。条目的固定、归档、删除与回滚仍由模型工具或 `/refine rollback <id> --global` 完成，面板不会直接改写状态文件，避免技能物化与运行时内存失配。

**进化记录存储**（同属 `dsh-evolution`）保存在 `.artifacts/dsh-home/evolution/evolution.db`（可用 `DSH_EVOLUTION_STATE_DIR` 改位置），包含证据、候选、验证和发布四类 append-only 记录：状态变化写成同一条记录的更高版本行，更新或删除历史会被库级触发器拒绝；候选正文和资产字节不入库，只保存内容指纹、一行说明和可回溯定位符。数据库在首次读写请求时才打开，Node 缺少 `node:sqlite` 或状态目录不可写时概览仍正常返回，只把记录能力标为不可用。发布必须绑定一条针对该候选且判定通过的验证记录，一条验证只能支撑一次发布；尚不具备版本化写入能力的所有者（记忆宫殿、Skill、行为 Prompt、Subagent）会被拒绝发布，候选保持 Proposal 状态。写入只经本机回环 API `/dsh-evolution/api/*`，与读取同样受回环、同源和 DSH 会话校验约束，面板仍是只读展示方；字段、状态机与错误码见 [进化插件](plugins/dsh-evolution/README.md)。

**人格（`dsh-laputa`，Phase 1）** 把用户手写的人格文档注入系统提示词，并在人格为空时引导首次填写。数据默认位于 `.artifacts/dsh-home/laputa/<personaId>/`，包含六份 Markdown；`IDENTITY.MD` 与 `MISSION.MD` 都非空才算已初始化，`RELATIONSHIP.MD`、`REDLINE.MD`、`DREAM.MD`、`DARK.MD` 可为空。插件按固定顺序用空行拼接非空文件，并检查符号链接、硬链接、world-writable、UTF-8、单文件字节数和总字符数。编辑保存后发送下一轮即可生效；读取出错时保留上一份可用文本，不会把非法内容注入提示词。

侧边栏中与 Superagent、语音、记忆、记忆宫殿同级的「人格」面板提供只读概览和六份文件编辑：概览显示启用/初始化状态、待填写文件、目录、字符数、指纹和最近错误；文件页一次保存一个文件，保存时校验预算并比对加载时的摘要，若文件已被其他方式修改会提示重新加载而不是覆盖。面板只编辑内容，不修改 profile；启用或切换人格仍使用 `npm run setup:laputa`。API 仅限本机回环、同源，并通过 DSH 会话校验，只接受六个固定文件名。

未初始化时插件不会报错，而是在会话里或面板中引导回答两个问题：“我是谁？”（IDENTITY，可以是名字，也可以是名字之外的身份、语气、价值观）和“我的使命是什么？”（MISSION）。也可以选择高级初始化，补充 RELATIONSHIP 与 REDLINE，DREAM / DARK 由 agent 根据对话生成。模型只能通过 `laputa_init` 填充缺失或空白文件，已有非空内容不会被覆盖；工具不接受路径，且只对顶层 agent 开放。

```sh
npm run stop
npm run setup:laputa -- --init vivy   # 创建空模板并启用；首次对话会引导填写
npm start
```

之后在侧边栏「人格」面板直接查看和编辑，或在会话内使用 `/laputa status`、`/laputa validate`、`/laputa reload`、`/laputa init`。人格段与引导段只注入顶层 agent，子 agent 不包含；原文中的 `{{...}}` 保持字面量，且会附带“人格不改变工具权限、审批和安全规则”的固定说明。用 `--no-enable` 只创建文件不启用，或在 profile 的 `- id: laputa` 中把 `enabled` 改为 `false` 后重启。自动提案、改写已有内容的工具、SOUL.md、版本 pin、回滚、审批和面板内启停属于 Phase 2，当前不包含。详见 `plugins/dsh-laputa/README.md`。

SurfCore 上游主要面向 Windows，QQ 所需的 SnowLuma 和 B 站完整功能尚未在 macOS 上验证；现有语音包也只提供 Windows 启动脚本。插件可以按配置启动外部程序或访问网络；本项目不是操作系统沙箱，手动启用这些功能前请先检查其设置和路径。详见 `plugins/surfcore/README.md`。

`patches/superagent-windows.patch` 保留原模板对 Windows 绝对路径的兼容修改，`patches/superagent-personal.patch` 让 GitHub 成为可选来源并在未配置时以个人模式运行，`patches/superagent-subject.patch` 持久化稳定的主体身份并提供本机主体 API，`patches/superagent-input.patch` 统一输入为 InputEnvelope、持久化去重键并提供本机输入源与提交 API，`patches/superagent-effects.patch` 为外部副作用记录 Effect/Receipt 显式关联、把“结果未知”作为一等状态并在重试前先查询远程，同时提供对账查询与 Ticket 详情展示，`patches/superagent-surfcore.patch` 让提交的 InputEnvelope 可携带可选 `channel`（`source`、`thread`、`address`，且 `source` 必须等于提交的 `sourceId`）并把它写入 Trigger，使受信任的外部边缘适配器（如 `plugins/dsh-surfcore-adapter` 的 QQ/B站通道）能把回复送回原会话，`patches/superagent-voice.patch` 增加 `voice` Effect 与 `VoiceEffectHost`：语音 `commit-send` 经 Effect 投递并记录 `externalId` 回执，`retryUnknown: false` 使未知结果不自动重投，`abort-send` 拒绝在途或终态。`patches/superagent-context.patch` 为每个 Assignment 保存不可变 ContextSnapshot（schema 13），记录提示词 revision 与 skills/policy/section/环境摘要而不复制记忆或知识正文，并新增 `GET assignments/:id/snapshot` 与 Ticket 详情页内的只读“执行追踪”节。`patches/superagent-schedule.patch` 增加 `settings.schedule` 规则块、`Schedules` 服务与 `orchestrator_evolution_request` 工具：到期槽位在既有 pass 循环内提交一次本地 trusted Input，显式进化请求在一次工具调用内创建并接受 Ticket。`patches/superagent-schedule-panel.patch` 在面板设置中增加“定时”分组，可增删改规则并“立即运行”已保存规则；手动运行走同一条输入提交路径并消费当前槽位，不新增定时器或 HTTP 端点之外的后台执行。构建时按 `patches/superagent-patches.json` 的顺序临时应用补丁，结束后逆序还原；若用户已自行应用某个补丁，脚本会保留用户的修改。补丁与本地编辑冲突时，构建会停止并保留文件。

DSH 的 profile、状态和凭据配置位于 `.artifacts/dsh-home/`。请在清理或迁移 `.artifacts/` 前备份需要保留的数据。启动脚本只为子进程设置项目内的路径，不会把这些变量写入终端或系统配置。项目不提供操作系统级沙箱：之后配置的 GitHub CLI、凭据管理器或执行任务仍会按其自身配置访问相应位置。

如果移动整个项目目录，请先停止服务并重新执行 `npm run setup`。对于能通过旧迁移记录确认的默认 `stateDir` 和项目自有依赖链接，安装流程会备份原文件并更新路径；其他路径仍需手动核对。完整项目及 Windows 搬迁流程尚未全面验证，请在移动前保留备份。

## ContextSnapshot 与执行追踪

每个 Assignment 在启动时写一份不可变的 ContextSnapshot（schema 13 的 `context_snapshot` 表）。快照记录提示词 revision、skills 摘要、Policy/Eval 摘要、可用系统提示 section 摘要、工具摘要和执行环境摘要，以及三个 owner 各自提供的 section 摘要；记忆召回正文和 MemPalace 知识正文仍归各自所有者，不复制进快照。同一 Assignment 首次写入即定稿，重试复用原快照，只有新 Assignment 才产生新版本。快照在 worker 收到任何消息之前捕获；捕获失败会让该 Assignment 直接失败，而不是让它无快照继续运行。

worker Session 读取提示词时按“显式 KV revision → 快照 pin → 当前版本”的顺序取值；快照 pin 指向的 revision 读不到时回退当前版本，master Session 不受快照影响。`GET assignments/:id/snapshot` 返回该 Assignment 的快照或 `null`。

Ticket 详情页在授权详情与未送达的输入之间有一节只读的“执行追踪”：显示提示词 revision、捕获时间、各摘要前 12 位、三个 owner 的版本（未贡献时为 `absent`），逐条列出原始状态的 Receipt（`pending`/`sent`/`dropped`，并附丢弃原因，不合并成聚合状态），以及经 `GET /dsh-evolution/api/records?ticket_id=` 读取的 Evolution 记录。该节不写任何数据，也不新增顶层标签。

## MemPalace 知识版本

长期知识由记忆宫殿的 `knowledge_commits` 追加式账本版本化：提交带确定性 `commitKey`，按 `expectedRevision` 比较并交换，`provenance`、`conflict`、`integrity`、`retrieval` 四项检查全部通过才落账；回滚追加新修订并标记原 head 为 `rolled_back`，历史永不删除。

进化只能通过所有者接口发布或回滚知识：`POST /dsh-evolution/api/publish-knowledge` 与 `POST /dsh-evolution/api/rollback-knowledge` 先校验候选、验证记录、摘要与 CAS 锚点，再经组件内部 IPC 调用记忆宫殿，并记录 owner 版本引用。通用 `/publish`、`/rollback` 拒绝 MemPalace 候选（`EVOLUTION_OWNER_API_REQUIRED`），不接受自报的 owner 引用。结果未知时用 `knowledgeStatus({ commitKeys })` 对账，不盲目重试。字段与错误码见 [记忆宫殿插件](plugins/dsh-mempalace/README.md) 和 [进化插件](plugins/dsh-evolution/README.md)。

面板的知识页底部有只读的“知识版本账本”卡片，经 `GET /knowledge/commits?assetScope=<scope>&limit=<n>` 按时间倒序展示本安装 subject 的提交（`assetScope` 别名 `asset_scope`，可省略；`limit` 1–200，默认 50）。它只读，发布与回滚仍只经所有者接口。

## Schedule 与 EvolutionRequest

定时规则以 `settings.schedule` 块保存，每条规则是固定间隔加固定文本（`id`、`enabled`、`everyMinutes`、`text`），最多 20 条。运行中的检查只发生在既有 pass 循环里（`Passes.pumpOnce`：先 kick effects，再跑 Schedule，最后跑 Engine 的到期评估），不新增定时器。每个到期槽位最多提交一次本地 trusted Input（`sourceId: 'local'`、`layer: 'schedule'`、`human: true`、`dedupeKey: schedule:<ruleId>:<slot>`）；首次见到规则、间隔变化或时钟回拨都会重新基线化而不是立刻触发；暂停（`paused`）或关闭（`closing`）时不产生任何输入，恢复后只按当前槽提交一次，不补历史槽。槽位状态保存在 KV（`schedule-rule:<id>` 的 `{ everyMinutes, slot }`），提交抛错时不推进槽位，下一次 pass 重试。

显式进化请求由 `orchestrator_evolution_request` 工具一次完成：先以 `evolution` 层本地 trusted Input 进入 Engine（`dedupeKey: evolution:<request_key>`，默认 key 为文本的 sha256），再在同一个调用内显式 accept 为 Ticket。同一请求重复调用返回同一 Trigger/Ticket；自定义 `request_key` 最长 180 字符。工具不直接创建 Ticket，也不绕过 Engine 的 Ticket 构造。

面板设置中的“定时”分组提供规则的增删改与每条的启用开关，并可对已保存规则点“立即运行”。手动运行是显式人工动作：忽略暂停、禁用与关闭状态，仍经同一条 `Inputs.submit` 路径提交当前槽位并写入 KV；同一槽重复点击返回 `duplicate`，提交抛错时不写槽位。修改规则 ID 等同于新建规则并重新基线化。保存定时规则只产生 `scheduleRules` 设置历史，不改变 Policy revision。

## 进化记录浏览

Evolution 面板新增“进化记录”页：输入 Ticket ID 后经 `GET /dsh-evolution/api/records?ticket_id=…` 读取证据、提案、验证与发布四类记录，按类型筛选，全部只读。提案与发布可展开版本历史（`/proposal`、`/publication` 的 `history=1`）；证据与验证服务端没有详情端点，只显示列表。该页不提供发布、回滚或编辑，也不新增 HTTP 端点。

## 人格版本来源

Laputa 的每个 revision manifest 可带可选 `source: { actor, note? }`，记录这次发布来自面板、助手工具、CLI 命令还是首次初始化；面板在版本历史与详情中显示来源与备注。旧版本没有该字段时照常读取；恶意或损坏的来源判 `revision_state_corrupt`，不静默降级。

`retainRevisions` 控制发布或回滚后保留的版本数，默认 `0` 表示全部保留；`retainRevisions: 3` 表示含新版本在内保留最近 3 个，更早的目录被删除。清理前会逐个重新校验候选，候选损坏则整个发布/回滚中止；删除只发生在新版本与 `current.json` 指针提交之后，当前版本永不被清理。被清理的版本不再是回滚目标。面板概览与 `/status` 的 `revisionRetention` 显示当前策略。

## 主动行为归属

SurfCore 只生成主动候选，不再自行投递主动 prompt：目的投递、chat 模式主动搭话、社交观望期主动开话题、reserved2 `proactiveCheck` 四条路径统一经组件 IPC 转发到 `dsh-surfcore-adapter` 的 `/proactive`，封装为 `layer: 'wake'`、`human: false`（inferred 强度）的 Input，由 Superagent Policy 决定是否成为 Ticket；被 Policy 忽略的候选只留下 Decision。候选携带 QQ 地址（`channel.thread` 与 `channel.address`），去重键为 `proactive:<kind>:<key>:<slot>:<hash16>`。外部发送仍由 Effect 承担，晨间问候是固定日程问候而非主动聊天，保留在 SurfCore 侧。SurfCore 的频率与概率配置继续生效；本批只改转发路径，不改变运行时重渲染时机。

## 上游许可

Superagent 与 DSH 分别沿用其源码目录中的许可文件。记忆和语音插件从 SurfCore v0.8.6（MIT）移植，来源文件与移植范围见根目录 `NOTICE` 及各自的 `LICENSE`。记忆宫殿插件由 [pi-mempalace](https://github.com/Jabbslad/pi-mempalace) 0.2.1 移植而来，遵循其 MIT 许可；来源与移植范围见 `plugins/dsh-mempalace/NOTICE.md`。持续进化插件源码来自 [dsh-continual-harness](https://github.com/jasen215/dsh-continual-harness) v0.3.3，遵循其 MIT 许可。人格插件移植自 [laputa](https://github.com/ProjectViVy/laputa) 的宿主无关语义（固定提交 `c4d649d`），遵循其 MIT 许可；来源与未移植部分见 `plugins/dsh-laputa/NOTICE.md`。
