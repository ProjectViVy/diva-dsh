# 验证记录：v0.8.1 worker 今日卡规则 v2

## 1. 补丁可应用、上游干净

```
git -C superagent apply --check ../patches/superagent-worker-today.patch   → exit 0
git -C superagent status --short                                          → 空
```

- 补丁只改 `src/app/context.ts` 的 `todayCards` 文本：4 句 → 6 句；
  hunk `@@ -6,7 +6,18 @@` → `@@ -6,7 +6,20 @@`。
- 机制未动：`workerPrompt = ${promptFile('worker')}\n\n${todayCards}` 一行不变；
  `patches/superagent-patches.json` 未动（仍 14 条）；无新文件、无新依赖。
- 改法：把旧补丁应用到 `superagent/src` → 替换 `todayCards` → `git diff` 生成新补丁
  → `git apply --reverse` 还原 → `apply --check`。上游仓最终 `status` 为空。

## 2. 重建与产物

```
node scripts/build-bundle.mjs   → exit 0
lib/index.js 492.31 kB（构建日志：Build complete，11 files）
```

- `superagent/lib/index.js:3259` 起是新的 `const todayCards = [...]`，六句全文都在；
  搜 `最多 40 个节点` / `genui spec` / `badge` / `内容底线` 均命中。
- 旧契约的 `"body":"一两句内容"}]}` 旧形状在产物里 0 命中。
- 构建日志：`.artifacts/worker-prompt-probe/build-v2.log`。

## 3. worker / orchestrator 真实配置取证

- 配置来源：`.artifacts/dsh-home/state/superagent-local/orchestrator.sqlite` 的
  `kv['prompt-version:1']`（真实 revision 1，source=panel）。
- 探针：临时应用新补丁到 `superagent/src`，`node --experimental-transform-types`
  跑 `promptParts` / `composePrompt`，跑完 `git apply --reverse`，上游 `status` 为空。
- 探针与原始输出：`.artifacts/worker-prompt-probe/assemble-v2.mjs` /
  `assemble-v2-output.txt`。

```text
=== worker ===
parts: runtime/shared, runtime/worker, communication, scope, delivery, runtime/subscriptions, runtime/replies, runtime/work, runtime/handoff, runtime/environment
chars: 32421
  runtime/worker: chars=1734 marker=true
prompt has rule: true | has path: true
prompt missing new keys: （空）
=== orchestrator ===
parts: runtime/shared, runtime/orchestrator, communication, scope, delivery, runtime/subscriptions, runtime/replies, runtime/dispatch, runtime/admission, runtime/handoff, runtime/environment, runtime/policy
chars: 39866
  runtime/orchestrator: chars=964 marker=false
prompt has rule: false | has path: false
prompt missing new keys: nodes,genui spec,最多 40 个节点,嵌套最多 6 层,最多 2000 字,badge,chart,callout,keyvalue,steps,timeline,线索级,待核实,仅知悉,以官方当天排期为准,数字照抄,不把线索写成结论,图片
=== verdict ===
worker has rule: true; master has rule: false; master has runtime/worker part: false
worker has all new keys: true; master has all new keys: false
```

- worker 的 `runtime/worker` part 从 1318 字涨到 1734 字；新增 416 字就是 v2 规则。
- master 的 parts 里没有 `runtime/worker`；`nodes` / `genui spec` / `最多 40 个节点` /
  `线索级` 等规则专属字样 0 命中（`table` / `list` 这类通用词可能出现在其它 prompt 段，
  所以“master 所有 key 都不含”为 false 属预期；专属 key 的缺失清单见上）。
- 两侧的 `table` / `list` 通用词命中不作为“规则泄漏”证据；判定以 `runtime/worker`
  part 与 `收工写今日卡` 标记为准。

## 4. 测试

```
node --test tests/source-runtime.test.mjs tests/windows-deployment.test.mjs
ℹ tests 32   ℹ pass 32   ℹ fail 0   ℹ skipped 0   (14.6s)
```

全量（本地时间 00:29，Asia/Shanghai）：

```
npm test
ℹ tests 1472   ℹ pass 1461   ℹ fail 1   ℹ skipped 10   (exit 1)
```

唯一失败是 `tests/memory-actmem.test.mjs:175`「records, updates and restores from
another subject are rejected」，起因是本地时间是 00:29、早于记忆维护的 `dailyHour = 4`：
`service.maintenance()` 没有生成备份，`(await service.backups())[0]` 为 undefined。
**与本补丁无关**（该测试不 import Superagent，只调 memory 插件）：

```
$env:TZ='UTC'（等价本地 16:29）；node --test tests/memory-actmem.test.mjs
ℹ tests 17   ℹ pass 17   ℹ fail 0
```

同一窗口下全量复跑（`TZ=UTC`）：

```
npm test
ℹ tests 1472   ℹ pass 1462   ℹ fail 0   ℹ skipped 10   (exit 0, 40.3s)
```

结论：**0 新增失败**；本地那次 1 条是既有的「00:00–04:00 时间窗」测试缺陷，UTC 复跑
与基线 1472/1462/0/10 一致。证据：`.artifacts/worker-prompt-probe/npm-test-v2.txt`
（本地）、`npm-test-v2-utc.txt`（UTC）。

## 5. 没验的

- 重启后的运行期：3082 里 worker 提示词预览 / 新 worker 会话是否真带六句、
  master 是否真没有（本轮没有停/重启 3082，只有源码级 compose 取证）。
- 真实 ticket worker 收工是否照新规则写出带 `nodes` 的卡（触发链 + 模型遵循度）。
- DSH 子 agent（spawn_teammate）仍收不到这条规则，覆盖边界同 v0.8.0。
