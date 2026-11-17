# 验证记录

## 机制确认（先查后改）

| 检查 | 依据 | 结果 |
| --- | --- | --- |
| prompts 是运行时读 | `superagent/src/app/context.ts:7-9`、`src/app/skill-files.ts:29-32`、`src/infra/paths.ts:7-19` | `promptFile()` 在模块加载时 `readFileSync(packagePath('prompts', name + '.md'))`；`packageRoot()` 向上找 `dsh-superagent` 的 `package.json`，`lib/` 没有自己的，落到 `superagent/` 根 |
| 构建不打包 prompts | `Get-ChildItem superagent/lib` / `Test-Path superagent/lib/prompts` | lib 只有 js/d.ts；`prompts` 目录 False；`tsdown.config.ts` 没有 copy 步骤 |
| 构建期补丁会还原 | `scripts/lib/source.mjs:213-250` | `withTemporaryPatch` 在 finally 里对每条补丁 `git apply --reverse` |
| 运行期读盘可用 | `node -e "await import('./superagent/lib/index.js')"` | 加载成功，未报 `Missing packaged file`（说明包根 + `prompts/` 的运行时读取成立） |

结论：补丁只改 `prompts/worker.md` 不会持久（构建后文件被还原）；规则必须编译进 `lib`，所以补丁改 `src/app/context.ts`。

## 补丁与产物

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 补丁可应用 | `git -C superagent apply --check ../patches/superagent-worker-today.patch` | exit 0 |
| 补丁范围 | 应用后 `git -C superagent diff --numstat` | `12 1 src/app/context.ts`，只此一文件；不含 `prompts/*.md`、不含 master 段 |
| 清单登记 | `patches/superagent-patches.json` | 13 条，末位 `superagent-worker-today.patch` |
| 重建 | `node scripts/build-bundle.mjs` | `Already up to date` → 13 条补丁 → tsdown `lib/index.js 489.59 kB`，exit 0 |
| 产物含规则 | `Select-String superagent/lib/index.js -Pattern '收工写今日卡'` | 命中 |
| 产物上下文 | `const todayCards = [...]` / `const workerPrompt = \`${promptFile("worker")}\n\n${todayCards}\`` | 四句全文都在 `lib/index.js` |
| 上游干净 | `git -C superagent status --short` | 构建前后都为空 |

## 角色装配取证（真实配置 revision 1）

- 配置来源：`.artifacts/dsh-home/state/superagent-local/orchestrator.sqlite` 的 `kv['prompt-version:1']`（`revision=1`、`source=panel`）。它的 `overrides` 是 `runtime/orchestrator`、`runtime/handoff/orchestrator`、`runtime/environment`、`runtime/policy`、`runtime/policy/none`——**没有** `runtime/worker`，所以 worker 的内置正文在运行期不会被覆盖。
- 探针：把补丁临时应用到 `superagent/src`，`node --experimental-transform-types` 调 `promptParts` / `composePrompt`（`Prompts.compose` 就是这两步）；跑完 `git apply --reverse`，`git -C superagent status --short` 为空。
- 真实输出（节选）：

```text
=== worker ===
parts: runtime/shared, runtime/worker, communication, scope, delivery, runtime/subscriptions, runtime/replies, runtime/work, runtime/handoff, runtime/environment
chars: 32005
  runtime/worker: chars=1318 marker=true
prompt has rule: true | has path: true
=== orchestrator ===
parts: runtime/shared, runtime/orchestrator, communication, scope, delivery, runtime/subscriptions, runtime/replies, runtime/dispatch, runtime/admission, runtime/handoff, runtime/environment, runtime/policy
chars: 39866
prompt has rule: false | has path: false
=== verdict ===
worker has rule: true; master has rule: false; master has runtime/worker part: false
```

- worker 的 `runtime/worker` 段尾就是追加的四句：

```text
收工写今日卡：在 orchestrator_report 之前，把这一单里主人能看见的变化写进 `$DSH_HOME/today/<YYYY-MM-DD>.json`（用收工那天的本地日期），文件形如 `{"cards":[{"title":"事件标题","body":"一两句内容"}]}`。
一天一张文件：先读当天已有文件再追加，绝不覆盖已有的卡；同一件事一天只写一条，之后又有进展就并进那一条，不要重复开卡。
只写这一单真实发生的事：计划、猜测、没做成的都不写；卡里不写日期，日期由文件名和右栏的分区头承担。
标题最多 200 字、正文最多 2000 字、一天最多 50 张；缺标题或正文的卡会被整张丢掉，坏 JSON 会被当成今天没有卡。
```

## 测试

| 命令 | 结果 |
| --- | --- |
| `node --test tests/source-runtime.test.mjs tests/windows-deployment.test.mjs` | **32/32 通过**（17.0s，含 `thirteen patches in order`） |
| `npm test` 第一遍 | 1441 项 / 1430 通过 / **1 失败** / 10 跳过（`memory-plugin.test.mjs:2408`「Bilibili network refresh does not block unrelated memory writes」的 200ms 时序竞态），exit 1 |
| 同上单测单独重跑 | `--test-name-pattern` 1/1 通过（435ms） |
| `npm test` 第二遍 | **1441 项 / 1431 通过 / 0 失败 / 10 跳过**，exit 0（与基线 1441/1431/10 一致） |

第一遍那 1 条在 memory 插件的时序用例上，与 Superagent 补丁没有调用关系；单独重跑与第二遍全量都通过，判为慢速全量下的既有 flake，不是本轮引入。

## 未验证

- 重启后的运行期：worker 会话提示词是否真带这四句、master 是否真没有、真实收工后 `$DSH_HOME/today/` 与右栏 Today 是否出卡（本轮没有停/重启 3082）。