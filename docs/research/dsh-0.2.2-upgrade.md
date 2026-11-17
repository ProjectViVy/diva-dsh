# DSH 上游 0.2.2 升级评估：能不能「不影响 Superagent」整体升级，以及补丁路线是否成立

> 调研日期：2026-11-15（Asia/Shanghai）｜ 只读调研，未改代码、配置与数据
> 结论先行，证据带路径/URL 与日期；观测、推断、未核实三类分开写。

## 0. 结论

**能做，但不是「零影响升级」。**准确说是一次「DSH 指针 + 7 处本仓改动 + 1 处 Superagent 补丁内容」的中等工程，且**不需要弄脏 Superagent 源码**。

三条直答：

1. **整体升级 Harness 可行。** `deepseek-harness/` 是干净的上游 submodule（`git status --short` 为空），本仓**没有任何 Harness 补丁**——12 个补丁全部打在 `superagent/`，`see-now-vivy-core.patch` 打在 `plugins/dsh-see-now/`。升级只动：submodule 指针、`scripts/setup.mjs` 的版本断言、Node 引擎下限。
2. **「不影响 Superagent」做不到，但影响是可控的、单点的。**版本门不拦它（实测见 §2）；真正的破面是 0.2.2 把 `agent/request` 改成**不允许改路由**，而 Superagent 唯一一处 `agent/request` 监听（`superagent/src/app/role-models.ts:31-36`）正是靠它给新会话种角色默认模型。后果是**静默降级**（初始模型种不上），不是崩溃。
3. **补丁路线成立，而且现在就是这么干的。**`scripts/lib/source.mjs:213` 的 `withTemporaryPatch` 在构建时逐个 `git apply` 12 个补丁、构建后还原；`superagent/` 工作树保持清洁（本次复核 `git status --short` 空、首个补丁 `apply --check` exit 0）。**升级后要改的只是补丁内容，不是源码。**

**推荐路线：两段式（§5 方案 A）。**先升到 `dsh-v0.2.2-rc.3` 让面板跑起来，用真实运行定位破面（已确定的只有 `agent/request` 一处），第二段再补 Superagent 补丁。一次性全改（方案 B）验证面太大且 Superagent 无法编译期发现，不建议。

## 1. 口径与限制

- **「整体升级」** = `deepseek-harness` submodule 从 `b830ec95`（`dsh-v0.2.1-rc.5`）换到上游最新 `dsh-v0.2.2-rc.3`（`38a6a5c9`），随源码重建，不改任何插件语义。
- **「不影响 Superagent」** 分两层：**版本门**（manifest 校验是否允许它加载）与**行为面**（它调用的 DSH API 是否还按老语义工作）。两层结论相反，必须分开说。
- **「打补丁不动源码」** = 补丁在构建窗口内应用、窗口外还原，`superagent/` 提交指针与工作树都不变。
- **方法限制（重要）**：本机 `deepseek-harness` 的 git 是 **shallow** 克隆——`origin/master` 引用只有 1 个提交（`fcc0ad46`，2026-11-04 的 0.2.2-rc.1 合并），与 HEAD 无共同祖先（`merge-base` 空、`rev-list --count origin/master` = 1），**本机做不了离线 diff**；`git fetch` 又被沙箱拒绝（`cannot create standard input pipe for remote-https`，需一次 danger-full-access）。因此版本与差异**全部以 GitHub API / raw 文件为准**，本地只做面向我们自己代码的 grep 与 semver 复算。
- **已全文核对**：`dsh-v0.2.2-alpha.2`、`dsh-v0.2.2-rc.1`、`dsh-v0.2.2-rc.3` 的 release 正文（中文段逐条读过）。其余版本只取标题级。

## 2. 现状盘点

### 2.1 上游位置（观测）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 本仓 pin | `b830ec95` = `dsh-v0.2.1-rc.5`（2026-10-29） | `git ls-tree HEAD deepseek-harness`；`deepseek-harness/package.json` |
| 上游最新 tag | `dsh-v0.2.2-rc.3` = `38a6a5c9`（2026-11-13） | GitHub API `/tags`（2026-11-15 访问） |
| 序列 | rc.5 → 0.2.2-alpha.1/2/3 → rc.1(11-04) → rc.2 → rc.3(11-13) | 同上 |
| 上游 Node 要求 | `>=24.9.0`（rc.1 起改；rc.5 是 `^22.19.0 \|\| >=24.0.0`） | raw `package.json@38a6a5c9` |
| 本机 Node | **24.14.1 ✓** | `node --version` |
| pnpm | 两边都是 `11.28.5` ✓ | 两个 `package.json` |
| 上游 Superagent 仓 | **只有一个 commit** `8c32a9d`（2026-10-31），与本仓 pin 的 `6337fc8` 不同 | GitHub API `/commits` |

**判读**：Superagent 上游停更，不会有「面向 0.2.2 的新版 Superagent」。所有适配只能落在我方补丁——这既说明补丁路线是唯一路，也说明**升级的适配成本不会随上游减少**。

### 2.2 本仓构建链（观测）

- `scripts/setup.mjs:63-66`：**硬断言** `deepseek-harness/package.json` 的 version 必须是 `0.2.1-rc.5`，否则报错退出——升级第一处必改。
- `scripts/setup.mjs:75-81`：DSH 走 `pnpm install --frozen-lockfile` + `pnpm run build:artifacts`（源码构建，非 app.asar）；Superagent 走 `withTemporaryPatch(...superagentPatches...) → pnpm run build`。
- `scripts/lib/source.mjs:207-228`：`superagentPatches()` 读 `patches/superagent-patches.json`（12 个）；`withTemporaryPatch()` 逐个 apply、失败即抛「Cannot apply the build patch … without changing existing edits」，构建后还原。
- 本次复核：`git -C superagent status --short` 为空；`git apply --check ../patches/superagent-windows.patch` **exit 0**（多补丁串行只能累计验证，一次性 `apply --check` 全部会对原始树重复校验而误报，不作依据）。
- profile：`.artifacts/dsh-home/profiles/superagent-local/package.json` 里 21 个 bundle（含 `dsh-superagent`、`dsh-continual-harness`、`dsh-laputa`、`surfcore`、`dsh-context`）。

### 2.3 版本门（观测 + 本地复算）

判定逻辑在 `deepseek-harness/packages/boot/app-boot/src/plugin-compatibility.ts`（**rc.5 与 rc.3 两版内容一致**）：

- 有 `engines.dsh` 就**只看它**，忽略 peer；否则逐个检查 `@deepseek-ai/dsh*` peer。
- 比较用 `semver.satisfies(runtime, range, { includePrerelease: true })`（`:51-53`）——预发布版本参与区间。
- 不兼容的 **bundle 不会让启动失败**：`profile.ts:750-767` 把它塞进 `skippedBundles` 后跳过（不打印错误）。

本机复算（`.artifacts/research-dsh-upgrade/semver-check.mjs`，用 harness 自带的 semver）：

| 主体 | 声明的范围 | 0.2.2-rc.3 | 0.2.1-rc.5 |
| --- | --- | --- | --- |
| `dsh-superagent`（`engines.dsh`） | `^0.2.1-alpha.2` | **true** | true |
| `dsh-continual-harness` / `dsh-laputa`（无 `engines.dsh`，peer 上界） | `>=0.1.5-rc.1 <0.2.1` | **false** | true |
| `dsh-context` v0.83.1 | `>=0.2.0-rc.2 \|\| >=0.2.1-rc.2 \|\| >=0.2.2-rc.1` | true | true |

**判读（关键）**：
- **Superagent 不会被版本门拦**；真正会被**静默跳过**的是两个 TS 插件 `dsh-continual-harness`、`dsh-laputa`——它们的 peer 上界写死在 `<0.2.1`，今天正好卡在上界内，升到 0.2.2 就越界。被跳过＝人格与进化两条线直接消失，且**不报错**，只在 `skippedBundles` 里留痕。
- `dsh-context` 的第三方 pin 校验（`scripts/lib/third-party.mjs:104-108` 的 `dsh.compatibility.dshReleases`）**通过**，不用动。

## 3. 上游新特性（用户可见，0.2.2-rc.1 正文汇总「自 rc.5 以来」）

只列与本仓体验直接相关的：

- 统一右键/键盘菜单（会话、工作区、侧栏），并允许插件扩展；文件预览带常驻目录树与定位。
- 工作步骤收起后**保留全部助手文字回复**，可切「仅最终回答」——与本仓「日常页只要她的话」的诉求同向。
- 聊天文本可作**引用**插入输入框；完整历史可复制为 Markdown。
- 新增日语/西/法/德/俄/巴葡界面；模型选择器支持拖拽排序、一次增删候选。
- 实验性：`subagent_oar`（交给本机 Codex/Claude CLI）、开发者统计面板、**变更请求与工作树**、个性化推荐。
- 默认关闭的 `apply_patch`（一次多文件增删改移）；Web 静态资源 ETag、WS 压缩。
- 修复：Windows 管理员权限/Windows Sandbox 下受限沙箱命令无法启动（与本仓 Windows 环境直接相关）、会话头部菜单、Markdown 单 `~`、Windows 路径反斜杠、目录选择框。

## 4. 破坏面 × 本仓命中点

逐条来自 rc.1/alpha.2 正文（官方原文），第二列是本仓实际命中（grep 计数，非推测）。

| # | 上游变更（原文要点） | 本仓命中 | 影响判断 |
| --- | --- | --- | --- |
| B1 | 逐步固定模型；**`agent/request` 不再允许改路由**，插件应用 `agent.model` 选择 | `superagent/src/app/role-models.ts:31-36`（唯一一处） | **确定破**：角色默认模型种不上；静默 |
| B2 | Session 投影注册改**异步**并需持有句柄；旧释放函数与按 key 读取**保留兼容**（带弃用提示） | `superagent/src/app/sessions.ts:277`（`ctx.get('sessionProjections').stateOf`）；`dsh-continual-harness` 8 处（`projection.ts`、`session-state.ts`、`store.ts`） | 可用但吃弃用；需真跑核对 |
| B3 | 工具按步骤条件启用；**插件需迁移 `tools.resolve/executable` 与提示词组装** | 15 个文件注册工具（`ctx.tools`）：continual-harness、laputa、see-now、mempalace、live2d、evolution 等 | 旧 `execute` 是否仍兼容＝**未核实**，需实测 |
| B4 | Cordis Core→4.1.0、Loader→1.1.0、Include→1.1.0；Fiber 统一配置访问 | `superagent/src/index.ts:13,19` 用 `ctx.fiber`；插件 peer `^4.0.1` 仍满足 | 低风险，需真跑 |
| B5 | Cordis Timer 同步上游，**返回值变化** | `ctx.setInterval/setTimeout/ctx.timer` 命中 **0**（只有普通 `setInterval` 27 处） | 无影响 |
| B6 | pi-ai 1.3.0；**未声明容量的自定义模型默认 1M 上下文 / 128K 输出** | profile 用 `llm-pi-ai` 自定义 `openai-responses` provider（无 capacity 字段） | 需显式写容量，否则压缩时机变 |
| B7 | **文件读前校验与外部修改防护默认关闭** | AGENTS 的 read-before-write 默认值依赖它 | 需显式恢复观察策略，否则规则变「软要求」 |
| B8 | 官方组合包列表改由 `@deepseek-ai/dsh-official-bundles` 导出 | 本仓引用 **0** | 无影响 |
| B9 | `tools.mode` 与 `DSH_TOOLS_MODE` 迁移；原生/PTC 执行拆插件 | 本仓 **0** 命中 | 无影响 |
| B10 | 整单元 JSON/SQLite **读旧写新**（单向） | 全部会话与状态在 `.artifacts/dsh-home` | **回滚风险**：升完再退版本可能读不回新格式 |
| B11 | Git 工作树独立插件需从 `dsh.profile.bundles` 移除 | 未装 | 无影响 |
| B12 | Node 最低 24.9 | 24.14.1 | 无影响（其余机器需先升） |
| B13 | PTC birpc、SSH 协议 2→3、`run_code` 取消改 ABORTED | 本仓不跑 PTC/SSH helper | 无影响 |
| B14 | 网页搜索默认改为**直连 DeepSeek Search API**；端点/凭据跟随模型路由；Exa/Perplexity 移除 | profile 只有 `opendesign` 中转，无 `deepseek-official`/`deepseek-account` 路由 | **web_search 工具会消失**（详见 §4.1） |

### 4.1 上游 API 接入面的变化（2026-11-15 追问后补充）

0.2.2 有四处「让 DSH 去调上游」的变化，按对本仓影响排序：

**① 网页搜索/抓取改成直连 DeepSeek 的 Search/Fetch API（alpha.2，影响最大）**

- rc.5 的现状：base bundle `searchProvider: deepseek-official`（`deepseek-harness/packages/bundle/base/cordis.patch.yml:470`），每次搜索是一次「辅助 Messages 请求 + 服务端 `web_search` 工具」，按模型 token 计费；`web-deepseek-api` 只有共享的 `baseURL` / `apiKeyEnv`（默认 `DEEPSEEK_API_KEY`）/ `apiKey`（`packages/web/web-deepseek-api/src/index.ts:35-50`）。
- 0.2.2 的行为：默认 `deepseek-search-api`，每次搜索是一次直接发往 `/v1/tools` 的请求，不调用模型，按 Search API 计费；Search 与 Fetch 可**分别**选「计费账号」或「API Key」；**端点取自模型路由**——登录 `deepseek-account` 时用账号令牌打「账号路由 origin + `/v1/tools`」，否则用 `deepseek-official` 路由的 `apiKeyEnv` 打该路由 origin + `/v1/tools`，两者都没有时退回 `DEEPSEEK_API_KEY` + `https://api.deepseek.com/v1/tools`。旧的共享字段移除，改为成对字段 `searchBaseURL` + `searchApiKeyEnv`（Fetch 为 `fetchBaseURL` + `fetchApiKeyEnv`）。Exa 与 Perplexity 提供方包删除。
- **本仓影响**：profile 只配了 `opendesign`（自定义 `openai-responses` 中转，`https://amr-link.open-design.ai/v1`），既没有 `deepseek-official` 也没有 `deepseek-account` 路由；当前 shell 无 `DEEPSEEK_API_KEY`，`.artifacts/dsh-home` 里也没搜到这个凭据名。升级后搜索会落到 `api.deepseek.com` 且缺凭据，而 rc.2 起「缺少所需凭据时不向模型提供 Web 搜索工具」——**搜索工具会直接从工具列表消失，不报错**。
- 三条处理路：a) 显式 `searchBaseURL` + `searchApiKeyEnv` 指向一个支持 `/v1/tools` 的中转（我们的 opendesign 中转是否提供该端点＝**未核实**）；b) 配一个真正的 DeepSeek key（走官方 Search API 计费）；c) 显式保留 `searchProvider: deepseek-official` 退回旧行为（仍需要 DeepSeek 路由或密钥）。

**② 自定义模型提供方支持 Gemini 原生接口（rc.2）**：可拉模型列表、设推理等级。rc.5 的 pi-ai 只有一条 `google` 的 env/baseURL 数据（`packages/llm/llm-pi-ai/src/provider-data.generated.ts:21`），没有原生 Gemini 接口 → 对用 Gemini 的人是新增能力；本仓不用，影响 0。

**③ 账号服务具体化（rc.1）**：`@deepseek-ai/dsh-deepseek-account` 成为具体服务，移除 platform 抽象与 `api-account-controller`，保留 `ctx.remote.account`、已存凭证（**不需要重新登录**）；rc.2 起账号通知支持公告类消息。本仓无账号相关代码，影响 0，但**登录态决定 ① 走哪条凭据**。

**④ 其他「接外部」的新入口**：rc.3 的实验性「DeepSeek 会话导入」插件（从 DeepSeek App/网页导入历史并继续对话，直连上游）；rc.2 起插件可动态注册/移除 **MCP** 服务、查状态、重启、探测连接。本仓均未安装。

## 5. 候选方案

**A. 两段式（推荐）**
第一段只做「能让 0.2.2 起来」的最小集：submodule 指针、`setup.mjs` 版本断言、根 `engines`、两个 TS 插件 peer 上界、B6 容量、B7 观察策略。跑起来后用真实会话定位破面——已确定的只有 B1，其余 B2/B3 看兼容垫是否真在。第二段只补 B1（Superagent 补丁，改走 `agent.model`/pre-step），顺带处理第一段实测出的问题。
代价：约 0.5–1 人日（本地 setup 一次 + 面板验证一遍）；风险集中可控。
依据：12 条破坏里 7 条本仓零命中，1 条确定、2 条「官方说保留兼容」；先升再验比先改再验的信息量大。

**B. 一次到位**
同时：改 Superagent 补丁、把 Superagent 26 个 devDeps/peerDeps 从 `0.2.1-alpha.2` 指向 0.2.2、迁移两个 TS 插件到新投影句柄与新工具接口。
代价：3–5 人日，且验证面（面板、语音、记忆、人格、SurfCore、日常页）要一次过。
风险：Superagent 的 26 个 peer 是 `^0.2.1-alpha.2`，**编译期不报错**，类型安全是假的，一次到位等于盲赌。

**C. 不升，留在 0.2.1-rc.5**
代价：错过 Windows 管理员/沙箱启动修复、工作步骤折叠、引用、多语、`apply_patch`；且下次跨版本跳得更远。
判断：本仓重度依赖 Windows 与 UI，C 只适合「近期有 P1 事务要收尾」的情况。

**D. 只升到 0.2.2-rc.1**
rc.2/rc.3 相对 rc.1 主要是少量修复与新插件（DeepSeek 会话导入、Windows 应用内更新修复）。想少变量可选，收益略低。

## 6. 升级改动清单（拍板后实施，本轮不动）

| 落点 | 现状 | 需要改成 |
| --- | --- | --- |
| `deepseek-harness` submodule | `b830ec95` | `38a6a5c9`（`dsh-v0.2.2-rc.3`） |
| `scripts/setup.mjs:63-66` | 硬断言 `0.2.1-rc.5` | 断言 `0.2.2-rc.3`（或从 root `package.json` 读一个常量） |
| 根 `package.json` `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9.0` |
| `plugins/dsh-continual-harness/package.json` | peer `<0.2.1`、devDeps `0.2.0-rc.2` | 加 `engines.dsh: ^0.2.2-rc.1`；devDeps 升 0.2.2 |
| `plugins/dsh-laputa/package.json` | 同上 | 同上 |
| `patches/superagent-*.patch` | 12 个，B1 依赖 `agent/request` 改路由 | 新增一处补丁：角色模型改走 `agent.model`；`superagent-patches.json` 同步 |
| `.artifacts/.../cordis.patch.yml` | `llm-pi-ai` 无 capacity | 显式写上下文/输出容量；恢复文件观察策略 |
| `README.md:209` 等文档 | 写着 rc.5 与 SurfCore 注册冲突 | 按新版本改写 |
| SurfCore 0.8.6（`plugins/surfcore/` pin + `scripts/lib/surfcore-*.mjs` 锚点） | 锚点打在 **SurfCore 源码**上，与 DSH 版本无关 | 锚点不用改，但 `@deepseek-ai/dsh-host-apiproxy@0.1.1-rc.2` 与 0.2.2 host 的线协议**待实测** |

## 7. 决策清单（不拍板不实施）

- **D1 升不升、升到哪**：A（rc.3）／D（rc.1）／C（不升）。推荐 **rc.3**。
- **D2 两个 TS 插件的版本声明怎么放宽**：推荐**加 `engines.dsh: "^0.2.2-rc.1"`**（有 engines 就只看它，peer 仅作文档），比改 6 行 peer 区间更稳。
- **D3 B1 怎么补**：推荐**改补丁走 `agent.model`/pre-step**；备选是先给 `dsh-superagent` 加**精确版本豁免**（`dsh plugin allow-version`）先跑起来，之后再补——豁免会带「可能崩溃或丢数据」的官方警告语，只适合短窗口。
- **D4 要不要把 Superagent 的 devDeps 指向本地 harness 源码做真编译**：推荐**要**（一次性，作为升级的回归门槛）；否则 0.2.2 的接口变化只能靠运行时炸。
- **D5 回滚策略**：因 B10（读旧写新单向），推荐**升级前整包备份 `.artifacts/dsh-home`** 并记录 submodule 指针；不做备份就等于放弃回滚。

## 8. 未核实（禁止当成结论）

- Superagent 在 0.2.2 上**能否正常启动与收发**（未实测；只确认版本门放行）。
- B3：旧 `tools.execute` 注册在 0.2.2 是否仍被接受（官方只说「需迁移」，未说旧接口是否保留）。
- SurfCore `apiproxy@0.1.1-rc.2` 客户端与 0.2.2 host 的线协议兼容性（SurfCore 自述「DSH 升级不影响它」属作者口径，非验证）。
- 10 个 client 侧插件（`client.js`）在 slot/菜单/主题 token 变化下的表现（需真机点一遍）。
- `dsh-context` v0.83.1 在 0.2.2 的实际行为（版本声明通过 ≠ 行为通过）。
- 会话存储「读旧写新」的具体不可逆边界（回滚后旧版本读新格式会怎样，未验证）。

## 9. 参考（访问日期 2026-11-15）

- 上游 tag 列表：`https://api.github.com/repos/deepseek-ai/deepseek-harness/tags?per_page=30`
- rc.3 release：`https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.2.2-rc.3`
- rc.1 release（自 rc.5 汇总）：`https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.2.2-rc.1`
- alpha.2 release（破坏面最集中）：`https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/tags/dsh-v0.2.2-alpha.2`
- rc.3 的兼容判定源码：`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/boot/app-boot/src/plugin-compatibility.ts`
- rc.3 的模型选择源码：`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/packages/core/agent/src/model-selection.ts`
- rc.3 的 `package.json`（Node 引擎）：`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/38a6a5c965aa99ab525161efb7cc5cf1fe62fced/package.json`
- 上游 Superagent 提交：`https://api.github.com/repos/deepseek-ai/dsh-superagent-prototype/commits?per_page=10`

## 10. 追加（2026-11-17）：本地真 diff、上游位置复核与「新东西」清单

> 本节的动机：§1 的「本机做不了离线 diff」已经过期。2026-11-17 用一次 `danger-full-access` 跑通了 `git fetch origin master`（沙箱拦的是 remote-https 建管道，不是网络），`origin/master` 已落在本地 submodule 里；工作树仍干净、submodule 指针未动。下列数字都是本地 `rev-list`／`diff` 的实测，不再依赖 GitHub API 转述。

### 10.1 上游位置（观测，2026-11-17）

| 项 | 值 | 来源 |
| --- | --- | --- |
| 本仓 pin | `b830ec9` = `dsh-v0.2.1-rc.5`（2026-10-29） | `git ls-tree HEAD deepseek-harness` |
| 最新 release tag | `dsh-v0.2.2-rc.3` = `38a6a5c9`（2026-11-13 07:37Z） | GitHub `/tags`；本地 `merge-base --is-ancestor 38a6a5c9 origin/master` = 0 |
| master tip | `39163dd`（2026-11-13 15:37 +08，`release(dsh): sync 0.2.2-rc.3 back to master`） | 本地 `origin/master` |
| master 相对 rc.3 tag | **+608 commit**（非 merge 433）、3309 文件、+104,100 / −36,870 | 本地 `rev-list`／`diff --stat` |
| npm dist-tags | `latest`=`0.2.2-rc.1`、`next`=`0.2.2-rc.3`、`alpha`=`0.2.2-alpha.3` | `registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags` |
| master 最后提交时间 | 2026-11-13 15:37 +08（**此后 3.5 天无新提交**） | 本地 `log -1` |

**判读**：对「升到哪个版本」来说，安全线仍是 **rc.3 tag（`38a6a5c9`）**。master tip 是「rc.3 + 433 个未发版提交」，里面有 timeline、script-realm、cua-windows、ui-session-status、authentication-*、text-search 这些新包，也有 `ptc-runtime-python` 的移除；但 npm 没有把它们发成新版本，**master tip 不等于「新版本」，只是「未发版的增量」**。

### 10.2 我们从 pin 到 master 的体量（本地实测，替换 §1 的「做不了 diff」）

- pin → master：**4803 commit**、**11,665 文件**、**+653,803 / −798,230 行**（净减约 14 万行，说明这是一次大规模重构＋删减，不是纯增量）。
- 其中 pin → rc.3 tag 的增量是主体；rc.3 → master 是上表那 608 commit。
- **新增中文升级指南 117 条**（另有 2 条修改）：`v0.2.1-alpha.2` 起一路到 `v0.2.2-rc.2`，覆盖 Node 24、组合包列表搬迁、Team 改版、fs 先读策略、工具执行器、PTC、包导出清理等。完整清单见 `docs/logs/2026-11-upstream-dsh/v0.1.1-local-diff-survey/verification.md`。
- 方法论更正：本机现在能对 `b830ec9…origin/master` 做 `rev-list`／`diff --stat`／`git show`。`rev-parse --is-shallow-repository` 仍报 true（历史边界还在），但本报告需要的两个端点都在本地，结论不受限。

### 10.3 新东西清单（相对本仓 pin，按「是否与我们有关」分三层）

**A. 直接改变我们已用能力的（升级就必须处理）**

| 变化 | 证据 | 对我们的命中 |
| --- | --- | --- |
| Agent Teams 从 experimental bundle 变核心（`packages/team/agent-team`、`packages/team/tool-agent-team`），`@deepseek-ai/dsh-experimental-agent-team-profile` 进 `RETIRED_BUNDLES` | `origin/master:packages/util/official-bundles/src/bundles.ts`；`upgrade-guide/v0.2.1-rc.2/{agent-team-subagents,session-team-mode,team-mode-menu,team-projection,inbox-only-agent-wait}` | 我们 profile 里现在就有那条 retired bundle，加载时会被自动移除；新语义：按 Session 开关、默认关、`spawn_teammate` 移除、控制工具用 `agent_id`、`/team on`、`/team off` 两个命令移除、`wait_agent` 移进普通 subagent 控制工具 |
| `fs-observation-policy` 默认 `disabled: true`：`write`/`edit` 不再要求先读，新增 `apply_patch` | `upgrade-guide/v0.2.2-alpha.2/fs-observation-policy-default-off` | 本仓 AGENTS.md 的「先读后写」与各插件写盘习惯依赖它；要保留就在 profile patch 里写 `disabled: false` |
| 工具执行器拆成显式插件（`tool-executor-native`／`tool-executor-ptc`），`dsh-tools` 不再读 `mode`/`DSH_TOOLS_MODE` | `upgrade-guide/v0.2.1-rc.2/tool-executor-plugins` | 自定义组合必须挂一个执行器；内置 profile 已挂 |
| Python PTC 移除，只剩 TypeScript 运行时（`ptc-runtime-node`） | `upgrade-guide/v0.2.2-rc.2/python-ptc-removal`；`packages/experimental/ptc-runtime-python` 已删 | 我们 profile 没选它；但 `workflow-ptc`/`tool-ralph` 的启用条件随之变化，要复核 |
| 组合包列表/模板 API 搬到新包 `@deepseek-ai/dsh-official-bundles` | `upgrade-guide/v0.2.1-rc.2/official-bundle-lists` | 本仓 `scripts/` 没有 import 这些名字（已 grep 确认），不影响启动器；第三方插件若 import 会炸 |
| plugin-manager：`BundleInfo.updatable` → `update`，新增 `unexpected-package` 错误码 | `upgrade-guide/v0.2.2-rc.1/plugin-update-method` | `scripts/setup-*.mjs` 用的是 `dsh plugin add/remove` CLI，不读这个字段 |
| Node **24.9+** 硬要求 | `upgrade-guide/v0.2.1-rc.2/node-24`；master `package.json` `engines.node` | 本机 `v24.14.1` ✓；但本仓 `package.json` 的 engines 仍允许 Node 22（`^22.19.0`），要收紧成 `>=24.9.0` |
| cordis loader 1.0.0-rc.8 / include 1.1.1；包导出清理（`/brand` 等 7 个子路径移除） | `upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees`、`v0.2.2-rc.2/package-export-cleanup` | 本地 vendored cordis `4.0.5` → master `4.1.0`；`superagent/package.json` 的 peer 钉着 `4.0.5-alpha.1`（见 §10.4 D3） |
| Session 团队模式新增必读事件 `team/mode` | `upgrade-guide/v0.2.1-rc.2/session-team-mode` | 旧版本读取器会拒绝该未知事件 → 升级后回滚的会话读取风险加一条 |

**B. 全新的东西（可以选装的）**

上游现在的 `OPTIONAL_BUNDLES`（18 个，master 实测）里，我们没装过的新面孔：

- `forge-bundle`（＋`forge`/`forge-github`/`forge-session`/`client-ui-forge`）：代码宿主 provider + 变更视图面板（分层审查、viewed 标记、审查线程、worktree、GitHub PR 概览）。对我们这种 git 仓库流程最可能有用，但要 GitHub 凭据。
- `timeline`：跟随 agent 的任务与进度汇报（**rc.3 之后才进 master，未发版**）。
- `cua-bundle`/`cua-mcp`/`cua-windows`：Computer Use，含原生 Windows provider（桌面自动化）。
- `liveshare`（＋`liveshare-protocol`）：把 Session 通过独立 server 共享给观众。
- `deepseek-chat-import`：导入 DeepSeek 官网对话导出为 Session。
- `personalized-recommendations`（＋creation/plugin recommendations）。

非 bundle 的新能力：`action-cards`（`propose_action` 工具＋卡片状态/用户动作，可做「她给你一张卡让你选」）、`mcp-manager`（运行时增删/启停/探测 MCP server）、`office-kit`＋office 工具（Office 渲染/转换/重算，技能改常驻）、`script-realm`（客户端脚本环境）、`ui-session-status`、`message-quotes`、`file-drag`、`terminal-panel`、`context-menu`、`util/ripgrep`＋`text-search`、`authentication-desktop`/`-token`。

DeepSeek 接入面的单独盘点见 [deepseek-api-surface.md](deepseek-api-surface.md)：0.2.2 与 DeepSeek 有关的新增主要是**会话导入 bundle**（离线 ZIP，不是在线拉取）、**搜索默认改成直连 Search API**、Files 上传超时与账号 Remote 重构；账号路由、Messages 适配器、Search/Fetch 底座与两个请求扩展在 pin 里就已经存在（本机也已在用）。

**C. 移除/无关**：`web-search-exa`、`web-search-perplexity`、`api/account-controller`、`credentials/deepseek-account-platform`、`document/office-to-pdf`、`ui-deepseek-model-label-1017`、`experimental/{agent-team,agent-team-profile,client-ui-agent-team,tool-agent-team}`（迁到核心）、`ptc-runtime-python`。

**另：上游没有 TTS（2026-11-17 复核）。** 全仓 `packages/`＋`apps/` 里 `-w -i "tts"` **0 命中**，没有 `speechToSpeech` 服务，`packages/client` 里也没有 `new Audio(`（没有播放路径）；语音相关包只有 5 个、全是「语音→文字」方向：`speech-to-text`、`speech-to-text-sensevoice`、`api-speech-to-text`、`client-ui-voice-input`、`voice-input-bundle`。两个 README 原文明确写「不提供……语音合成」「服务没有流式识别或语音合成方法」（`packages/experimental/{client-ui-voice-input,speech-to-text}/README.zh.md:70`）。所以升级 DSH 不会带来 TTS，也不会改我们 `dsh-local-voice` 这条自建线路（上游无对应物，TTS 永远是我们自己的事）。

### 10.4 对 §7 决策的影响

- **D1 多一个候选**：C1 = rc.3 tag `38a6a5c9`（推荐，可复现、对齐 npm `next`）；C2 = master tip `39163dd`（rc.3 + 433 未发版提交，**只在「想要 timeline / cua-windows / script-realm」时才考虑**，且要接受未发版风险）；C3 = 不升；C4 = 只到 rc.1。推荐顺序 **C1 → C4 → C3 → C2**。
- **D2/D3/D4/D5 不变**，但新增两条支撑事实：①`superagent/package.json` 的 peer 钉 `@deepseek-ai/cordis@4.0.5-alpha.1`，而 0.2.2 的 vendored cordis 是 `4.1.0`，比「`agent/request` 不许改路由」更早撞墙；②上游 Superagent 只有一个 commit（`8c32a9d`，2026-10-31），与本仓 pin（`6337fc8`）分叉 1/1，**不会有面向 0.2.2 的新版**，适配只能落我方补丁。
- **新增 D6（建议）**：升级时是否在 profile patch 里把 `fs-observation-policy` 恢复为先读后写（A：恢复，保住 AGENTS.md 与全部插件的既有习惯；B：接受新语义，只改文档；C：先恢复、观察一轮再决定）。推荐 A。
- **新增 D7（可选）**：要不要把 `dsh-experimental-agent-team-profile` 那条历史 bundle 从 profile 清理掉，改由 base 提供（升级时官方会自动移除，但我们可以先手清，避免「以为改了」）。

### 10.5 未核实（本节新增，不混进结论）

- rc.3 之后那 433 个未发版提交是否**再引入**第二处 Superagent 破面：本轮只按主题分类，没有逐条核对 117 条指南对我们 14 个本地插件的命中。
- Forge / Timeline / Action Cards / CUA / Office 的**实际可用性**：包只在清单里见过，没安装、没运行。
- 本地 `dsh-*` 插件（尤其 10 个带 `client.js` 的）在 0.2.2 新 slot/菜单契约下的表现：只确认 `conversation.input.activity`、`settings.section`、`sidebar.panellist` 三个槽位名在 master 仍存在（`git grep` 命中），**没做运行时验证**。
- `superagent` 在 cordis `4.1.0` 下能否构建：peer 版本矛盾是静态读到的，未真编译。
- master tip 的 608 commit 里是否包含会改 `dsh homes`／profile 目录布局的变更：未逐条核。
