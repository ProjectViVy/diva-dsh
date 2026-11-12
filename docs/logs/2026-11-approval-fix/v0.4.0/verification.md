# v0.4.0 验证记录

日期：2026-11-11 ｜ 环境：Windows / Node 24 / 沙箱 `danger-full-access`

## 类型检查与构建

```text
pnpm -C plugins/dsh-continual-harness typecheck   # tsc -p tsconfig.json --noEmit，无输出
pnpm -C plugins/dsh-laputa typecheck             # 同上
pnpm -C plugins/dsh-continual-harness build      # tsc -p tsconfig.build.json，无输出
pnpm -C plugins/dsh-laputa build                 # 同上
```

## 自动化测试

| 范围 | 命令 | 结果 |
| --- | --- | --- |
| 技能 owner + 面板 | `pnpm -C plugins/dsh-continual-harness exec vitest run tests/skill-owner.spec.ts tests/panel.spec.ts` | 23 passed / 1 skipped |
| 人格候选 + 版本 + HTTP | `pnpm -C plugins/dsh-laputa exec vitest run tests/candidates.spec.ts tests/revision.spec.ts tests/http.spec.ts` | 77 passed |
| 进化面板客户端 | `node tests/evolution-dream-client.test.mjs` | 9 passed |
| Dream/Evolution 后端 | `node --test plugins/dsh-evolution/tests/dream.test.mjs plugins/dsh-evolution/tests/dream-tool.test.mjs tests/dream-evolution.test.mjs` | 35 passed |
| Evolution 根测试 | `node --test tests/evolution.test.mjs tests/evolution-dream-client.test.mjs tests/dream-evolution.test.mjs` | 38 passed / 1 failed（见下） |

新增用例覆盖：批准成功=1 条发布+1 条决定；发布失败不落决定且候选仍在 `pending`；删除回执后重放返回同一条发布；`decisions()` 含拒绝且未发布的批准可重试；`pending()` 暴露渲染 bundle 与基线；`POST /rollback` 只生成候选；人格批准同步草稿、崩溃后不覆盖手工编辑、旧草稿发布被 `persona_draft_stale` 拒绝；面板渲染 diff/附件/已处置/回滚请求体，以及截断候选不显示伪 diff。

## 行为探针

`node .artifacts/audit/skill-owner-probe.mjs`（对编译产物 `lib/types`，只写 `.artifacts/audit/probe-state`）：

```text
wrongDigestRefused:        "Reviewed digest does not match the staged candidate"
missingConfirmRefused:     true
approved:                  { version: 1, decision: "approved" }
replay:                    1
flipDecisionRefused:       "Candidate already decided; a new candidate is required"
secondPublicationRefused:  "This approval was already used for another publication"
failedPublish:             "Skill baseline conflict"
staleStillPending:         true
staleDecisionRecorded:     false
staleVisibleInHistory:     false
rebuiltDecision:           { decision: "approved", publicationId: "0964dd1a-…" }
publicationCount:          1
rejectedHistory:           [{ decision: "rejected", publication: null }]
```

## 既有失败（与本次改动无关）

- harness 全量套件：`681 passed / 7 failed / 1 skipped`。失败项为 `tests/logfile.spec.ts` 的 `mode 0o600`（Windows 下实测 0o666，单独跑也失败）、`tests/plugin.spec.ts` 的 4 项 `manual Dream control plane`（断言 summary 含 `DSH_HOME`，本机环境走了真实 Dream 分支）以及 `tests/benchmark.integration.spec.ts` 的 1 项并行挂载锁冲突（**单独跑 4/4 通过**，属套件并行抖动）。这些文件均未被本轮修改。
- 根套件：`npm test` → `1293 tests / 1143 passed / 144 failed`。失败集中在 Windows 路径分隔符断言、`.artifacts/test-tmp` 清理 `EPERM`、`scripts/surfcore-loader.mjs` 的 `c: URL` 协议错误；`tests/evolution*.test.mjs` 中只有 `tests/evolution.test.mjs` 的 `the plugin mounts a lazy record store…` 失败，栈在 `plugins/dsh-evolution/src/dream-tool.mjs:79`（`ctx.tools` 未注入），该文件是 DV-EV-016 的未提交改动，不属于本轮。
- 沙箱：vitest 首次加载配置时 `spawn EPERM`（vite 的 `optimizeSafeRealPathSync`）。本轮在放开子进程后运行；`node <file>` 方式不受影响。

## 活体验收（2026-11-11 16:03 重启后）

实例 16:03:09 启动，harness 与 evolution 均加载新构建。用本机会话 token 直连面板 API，夹具技能 `acceptance-probe-skill`，脚本 `.artifacts/audit/acceptance-live.ps1`。

| 步骤 | 输入 | 实测 |
| --- | --- | --- |
| A/B 拒绝 | 暂存 `review` → `/decide` rejected | 200；无发布；待批清空；「已处置」出现 1 条已拒绝；live 无该技能 |
| C 首次批准 | `first`（baseline null） | 200；v1；待批清空 |
| C 基线暂存 | v1 之后暂存 `stale-b`、`stale-a` | 两者 `baselineDigest` 均等于 v1 摘要 |
| C 正常前进 | 批准 `stale-a` | 200；v2 |
| C 原子性回归 | 批准 `stale-b`（基线仍是 v1） | **422 `SKILL_OWNER_BLOCKED`「Skill baseline conflict」**；候选仍在待批；未写决定；live 仍 v2 |
| D 回滚入口 | `POST /rollback` | 200；生成回滚候选（目标 v1）；live 仍 v2 |
| D 回滚发布 | 批准回滚候选 | 200；v3；`bundleDigest` 等于 `first` 摘要 |
| F 记录空态 | `/records?ticket_id=…` 与四个列表接口 | 均 200，四组 0 条 |
| F 设置 | `GET /config` | `fields` 15 项，无 `requireGlobalApproval`；`values` 仍残留旧键（页面不渲染） |
| G 清理 | `cleanup-acceptance-state.mjs --yes` | live 只剩 `diva-research-to-decision` v1；publications/keys/candidates/decisions/versions/stage-keys 各 1；夹具移入 `.trash-acceptance-2026-11-11T08-12-13-391Z`（17 项） |

补充实测：`/pending` 返回 `{pending, decided, live}`；对已批准候选重放 `/decide` 返回同一条发布且 `owner-state.json` mtime 未变；`/rollback` 对只有 v1 的技能返回 422 `ROLLBACK_UNAVAILABLE`；客户端 bundle（`rev=aa14aade068e`）已含「已处置 / 回滚到上一版 / 逐行差异 / 没有运行时生产者」。另修正 `acceptance.md` C 步的暂存顺序（`stale-a/b` 必须在 v1 之后暂存，否则基线对不上）。

## 未验证

- 浏览器点击流未执行（DOM 渲染与请求体由 `tests/evolution-dream-client.test.mjs` 9 项覆盖）。
- 人格 E 步未做：活体人格未初始化（六个文件 0 字节），以单测结论代替。
- 响应体 4 MiB 截断分支没有构造大候选实测，只做了代码审阅。
- 清理后技能目录若仍缓存 `acceptance-probe-skill`，需再重启一次（夹具已从 owner 状态移除）。
