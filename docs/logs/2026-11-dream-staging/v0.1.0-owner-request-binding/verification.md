# 验证

## 本轮已做的检查（静态）

- 逐行核对 `dream.mjs` 的 `plan()` / `execute()` / `authorize()` / `baseline()`：
  `execute()` 根本不调用 owner，它只检查 `current.ownerCandidateId`，
  因此「staging incomplete」只可能来自 `plan()` 阶段的 owner 失败 —— 与报错文案一致。
- 核对 `authorize()` 的请求解析分支：无 `requestId` 时按
  `state.requests.find(... && ticket.inputs.some(...))` 取**第一个**匹配请求；
  `docs/dream-executor.md` 已写明该 Ticket 在 2026-11-10 拥有两个 Dream Input。
- 核对两端摘要实现：`dream.mjs` 的 `assetDigest` 与
  `dsh-continual-harness/src/skill-owner.ts` 的 `assetDigest`、以及编译产物
  `lib/types/skill-owner.js` 的实现一致（同样的 `localeCompare` 排序 + `JSON.stringify`），
  排除「摘要算法不一致」这一解释。
- 核对 `plugins/_shared/ipc.mjs`：`body === undefined` → **GET**；`{}` → POST。
- 核对 `dsh-laputa/internal.mjs`：`/baseline` 只接受 POST，其余落入
  `Unknown Laputa owner operation`（`LAPUTA_OPERATION_UNKNOWN`）。
- 核对 `dream-tool.mjs` 的 baseline 投影与两个 owner 的真实返回形状：
  Laputa 返回 `{revision, draftDigest}`（无 `digest`），harness `status()` 返回
  publication **数组**；旧投影既丢 `draftDigest` 又按对象包装取技能，必然给空列表。

## 本轮没做的检查（命令跑不了）

`pwsh` 全部被沙箱拒绝：

```
Error: Windows ACL temp root must be outside the workspace:
workspace=C:\Users\Administrator\Desktop\diva-dsh; temp=C:\Users\Administrator\Desktop\diva-dsh\.artifacts\tmp
```

这是 DV-OPS-001 的已知待重启项（启动器已把 TMP 指向工作区外，但运行中的实例仍是旧环境变量）。
所以下面四条**一条都没跑**：

```powershell
node --test tests/dream-evolution.test.mjs
node --test tests/dream-tool.test.mjs
pnpm -C plugins/dsh-laputa test
pnpm -C plugins/dsh-continual-harness test
```

因为构建也跑不了，`plugins/dsh-continual-harness/lib/types/skill-owner-runtime.js`
（`lib/` 是被 `.gitignore` 忽略的本地构建产物）是**按 tsc 输出格式手写的同一行改动**，
让重启即可生效；重启后仍应先跑 `pnpm -C plugins/dsh-continual-harness build`，
让编译产物与源码对齐（预期输出一致）。

## 重启后必须补的验证

1. 上述四条测试全绿（新增断言：staging 携带 `requestId`、baseline 以 `{}` 调用、baseline 保留 `draftDigest`）。
2. 一次真实 refine：`plan` → `planned`，`execute` → `completed`，候选 `pending_review`。
3. `baseline` 返回 persona `{revision, draftDigest}` 与非空技能列表，而不是 `Unknown Laputa owner operation`。
4. 「进化 → 审批」里能看到 `diva-research-to-decision` 候选（若重跑仍给出该候选）。
