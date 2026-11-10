# AGENTS.md — diva-dsh 常设指令

> DSH 在每个会话第一次模型调用前注入本文件。它只回答「在这个仓库怎么干活」：
> 状态在 `TODOLIST.md`，证据在 `docs/logs/`，架构在 `docs/architecture.md`。
> 上限 160 行；要写细节就写进 `docs/` 再链过来。

**开工第一件事：读 [`TODOLIST.md`](TODOLIST.md) 的 `## NOW`。** 那里写着这个仓库当前在做什么、做到哪、下一步；为空就直接问用户，不要猜。

## 0. 这个仓库是什么

- **源码级启动器**：在一个目录里构建并运行 DSH、Superagent 和 15 个本地插件，不装全局 `dsh`/`pnpm`，不改 shell 配置。
- **18 个 submodule**：3 个上游（`deepseek-harness/`、`superagent/`、`plugins/surfcore/`）+ 15 个本地仓（`vivy-dsh/*`），每个插件都是独立 git 仓。
- 根仓库自己只有：`scripts/`（安装/启停/接线）、`tests/`（启动器与插件行为）、`patches/`（Superagent 补丁）、`docs/`、`skills/`、`stage-app/`，以及 submodule 指针。

## 1. 改哪里

| 想改的东西 | 落点 | 不要 |
| --- | --- | --- |
| Superagent 行为 | `patches/superagent-*.patch`（清单在 `patches/superagent-patches.json`） | 直接改 `superagent/` |
| SurfCore 行为 | `scripts/lib/surfcore-*.mjs` 的锚点补丁（内存打补丁 + `sourceSha256` 漂移校验） | 直接改 `plugins/surfcore/`：子模块只读，`setup` 重渲染会覆盖 |
| DSH 本体行为 | 优先用插件实现；确实要改才进 `patches/` | 直接改 `deepseek-harness/` |
| 新插件 / 新能力 | `plugins/<name>`（独立仓）+ 根 `scripts/setup-<name>.mjs` 接线 | 把实现塞进根仓库 |
| 启动器 / 安装 / 编排 | `scripts/*.mjs` + `tests/*.test.mjs` | — |
| 设计文档 | `docs/`（架构正家 `docs/architecture.md`） | 散落在根目录 |

## 2. 开工 / 认领 / 收工

**开工（三次工具调用内）**：读 `TODOLIST.md` 的 `## NOW` → 读条目 `日志:` 目录的 `summary.md` 前 6 行 → 按需读 `verification.md` 的「未验证」。
`NOW` 为「无」→ 直接问用户要做什么，不要猜、不要自己找活。压缩或续跑后第一件事同样是重读 `NOW`。

**开发前必读（硬性）**：任何改代码、改配置、加依赖、动架构的活，动手前先加载 `more-faster-better-economical` skill（`skills/more-faster-better-economical/SKILL.md`，多·快·好·省）。不要求为它写报告，但产出要体现它：设计与取舍给「最简方案 + 一个备选 + 依据」，审查按影响排序，不加需求外功能、不加没有测量支撑的性能机器。

**认领（没有 LOCK 文件）**：动手前在条目写 `状态: doing ｜ owner: <session-id> ｜ 开始: <时间> ｜ Scope: <路径>`；同 Scope 已有他人 owner 就停手或问用户；同一 git 仓同一时刻只跑一个 git 写操作。

**收工**：状态改 `done`/`blocked`/`waiting-user` 并写下一步；有交付 → `docs/logs/` 四件套，无交付 → 条目写「本轮无交付」；未验证项写进 `summary.md`，禁止「应该没问题」。

## 3. 构建、启动、验证

- 首次安装或依赖变化：`npm run setup`（初始化 submodule、装依赖、编译、生成独立配置）。重跑前先 `npm run stop`。
- 起停：`npm start` / `npm run stop` / `npm run status`。端口不固定（见过 3080/3082/48994），用 `status` 或 `.artifacts/` 里的记录，别硬编码。
- 验证：`npm test`（`node --test tests/*.test.mjs`）。改插件时再跑该插件自己的测试（SurfCore 是 `npm run test:audit`）。
- 组件接线改动：跑对应的 `npm run setup:<component>`。
- 改了代码要重启才生效：`npm run stop && npm start`（插件与 DSH 都是常驻进程）。
- Node 版本：`^22.19.0 || >=24.0.0`。

## 4. 环境事实

- `DSH_HOME` 在项目内：`.artifacts/dsh-home`，**不是** `~/.dsh`。会话、配置、状态都在这里。
- 真实 profile 名是 `superagent-local`（不是 README 里的 web/desktop）。
- `.artifacts/` 是本机缓存、配置、状态与日志，不入库；不要把它当文档或提交。
- `.workspace/` 是相邻参考项目与上游源，不参与构建。
- 验证 `pwsh` 是否可用：本机沙箱曾因临时根落在工作区内而拒绝执行任何命令（`sandbox-windows-acl` 的 path-boundary 校验）。跑不了 shell 时先查这一条，别怀疑改动。

## 5. 红线

1. **上游三仓只读**：`deepseek-harness/`、`superagent/`、`plugins/surfcore/`。要行为改动走 `patches/`、`scripts/lib/surfcore-*.mjs` 或插件。
2. **不含资产**：Live2D Cubism Core（`stage-app/vendor/live2dcubismcore.min.js`，专有，需使用者自备）、鲸鱼娘模型（只在 `$DSH_HOME/live2d/models/`）、`stage-app/demo/Hiyori/`（Live2D 官方条款）。`.gitignore` 已排除的不要加回来。
3. **不含密钥**：不提交 `config.json`、`.artifacts/dsh-home` 下的凭据、插件内的 token；输出与日志前脱敏。
4. **删除要可回滚**：先备份或 rename 到隔离目录，禁止不可逆删除。
5. **升级后先自检**：DSH/Superagent 升级会覆盖 `app.asar` 与补丁锚点，升级后先 `npm run setup` + 相关 check，再动别的。

## 6. 写作与提交

- 与用户沟通用中文；提交信息用英文 Conventional Commit（`feat:` / `fix:` / `docs:` / `chore:`）。
- 一次提交一件事；不把无关改动、`node_modules`、`.artifacts/` 混进来。
- 提交前看 `git status`：submodule 指针脏不脏、属不属于本次改动，不属于就不要 stage。
- **不自动提交**：用户说提交才提交。
- 设计进 `docs/`，交付记录进 `docs/logs/`，状态进 `TODOLIST.md`；三者不互相复制。

## 7. Rulebook

**upstream-read-only**：上游三仓只读。
　正例：DSH 行为不符 → 写插件或 `patches/`。　反例：直接编辑 `deepseek-harness/packages/...`。　执行：提交前 `git status` 看 submodule。

**submodule-pointer-discipline**：submodule 指针变化必须属于本次改动。
　正例：升级 `plugins/dsh-laputa` 并连同指针一起提交。　反例：把别的活儿留下的脏指针顺手 stage 了。

**asset-license-guard**：`.gitignore` 排除的专有资产不得加回仓库。
　正例：模型走 `node scripts/import-model.mjs` 让用户自备。　反例：为了「跑通」把 Cubism Core 或模型提交进去。

**no-secret-commit**：任何凭据不进代码、文档、提交与日志。
　正例：`config.example.*` 里只放占位符。　反例：把真实 AppID/AccessKey 写进示例配置。

**validation-required**：交付前跑与改动面匹配的验证，跑不了要说明原因。
　正例：改根 `scripts/` → `npm test`；改插件 → 该插件测试 + `test:audit`。　反例：「已改好」但没有任何命令输出。

**state-and-evidence-required**：发现的问题进 `TODOLIST`，有交付必须有 `docs/logs/` 四件套。
　正例：本轮不修的 TODO → 一条带路径的条目。　反例：只在聊天里说「以后要修」；状态 `done` 却没有日志目录。

**principles-before-dev**：改代码前必须读 `more-faster-better-economical`。
　正例：先读 skill，再给「最简方案 + 一个备选 + 取舍依据」。　反例：直接开写，事后补一句「符合多快好省」。　执行：动手前一句话说明读了、准备用哪条原则。
