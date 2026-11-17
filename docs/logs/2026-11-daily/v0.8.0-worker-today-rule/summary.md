# 把「收工写今日卡」规则移进 Superagent worker 提示词

## 机制（先查后改）

- `superagent/prompts/*.md` 是**运行时读盘**：`src/app/context.ts:7-9` 在模块加载时调 `promptFile()`，`src/app/skill-files.ts:29-32` 经 `packagePath('prompts', '<name>.md')` 读文件；`src/infra/paths.ts:7-19` 的 `packageRoot()` 从模块所在目录向上找 `dsh-superagent` 的 `package.json`，`lib/` 没有自己的 package.json，所以落到 `superagent/` 根。
- `lib/` 里**没有** `prompts/` 目录（构建产物只有 js/d.ts），`tsdown.config.ts` 没有 copy 步骤；`package.json` 的 `files` 同时带 `lib` 与 `prompts`，说明发布包靠两个目录并列，不是把提示词打包进 lib。
- 现有补丁走 `withTemporaryPatch`（`scripts/lib/source.mjs:213-250`）：应用 → `tsdown` 构建 → **反向还原**。所以改 `prompts/worker.md` 的补丁在构建结束时就消失，运行时读不到；唯一能持久生效的落点是把规则**编译进 lib**。

## 做法

- `patches/superagent-worker-today.patch` 只改 `src/app/context.ts` 一处：新增 `todayCards` 常量（四句中文规则），`workerPrompt` 从 `promptFile('worker')` 变成 `` `${promptFile('worker')}\n\n${todayCards}` ``。`workerPrompt` 只喂 `runtime/worker` 这个 part（`src/app/prompts.ts:57`，roles=WORKER），master 的 `runtime/orchestrator` 不经过它。
- `patches/superagent-patches.json` 末尾加第 13 条；`tests/source-runtime.test.mjs` 的清单断言 12 → 13。
- 重建：`node scripts/build-bundle.mjs`（`pnpm install --frozen-lockfile` + 应用 13 条补丁 + tsdown）exit 0；`superagent/lib/index.js` 里 `const todayCards = [...]` 四句全文与 `const workerPrompt = ...${todayCards}` 都在。
- 规则内容：收工（`orchestrator_report` 之前）把这一单让主人看得见的变化写进 `$DSH_HOME/today/<YYYY-MM-DD>.json`；一天一张、读后追加不覆盖；同一件事一天一条；只写真实发生的事；卡里不写日期；标题 ≤200 字 / 正文 ≤2000 字 / 一天 ≤50 张；缺标题或正文的卡整张丢。
- 语言选中文：这单写的是主人右栏能看见的卡，与面板其它中文文案一致。备选是英文（与上游 `prompts/worker.md` 一致），代价是主人读提示词预览时要多翻一层；没有事实差异。

## 只进 worker 的取证

用安装里真实的 prompt revision 1（`orchestrator.sqlite` 的 `kv['prompt-version:1']`，source=panel）跑 `promptParts`/`composePrompt`：worker 的 `runtime/worker` part 含规则；master 的 parts 里没有 `runtime/worker`，也搜不到规则。细节与输出见 `verification.md`。

## 需重启

`npm run stop` → `npm start`（当前 3082 宿主进程内已加载旧 lib；本轮没有停/重启宿主，避免断面板）。

## 覆盖边界（不试图在代码里解决）

本仓库日常这单活是 lead 用 DSH 子 agent（`spawn_teammate`）干的，它们不是 Superagent 的 ticket worker：`superagent/src/app/sessions.ts:232-237` 只给 master 与有 ticket 的 worker 挂提示词段，其余 agent 直接走 `limitSubagent`（`:303-312` 只加工具限制），`:127` 的 preset 选择同样只认这两种。所以这条规则**不会自动传到**这类子 agent。它此前写在 AGENTS.md 时，子 agent 因为读仓库 AGENTS.md 反而能收到；现在这层覆盖**没有了**。要覆盖它们只能另用 skill，或由 lead 下发任务时带上——不在本补丁里解决。

## 未验证

- 重启后的运行期：新开的 worker 会话提示词是否真带这四句、master 会话是否真没有、真实收工后右栏 Today 是否出卡（本轮没重启 3082）。