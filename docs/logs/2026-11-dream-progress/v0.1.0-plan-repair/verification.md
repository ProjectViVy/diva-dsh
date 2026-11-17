# 验证记录 · v0.1.0-plan-repair

## 1. Dream 相关测试

```
node --test tests/dream-evolution.test.mjs tests/dream-tool.test.mjs tests/dream-skill-install.test.mjs
ℹ tests 34   ℹ pass 34   ℹ fail 0
```

新增 8 例（全部通过）：

| 测试 | 证明了什么 |
|---|---|
| `a plan that cites an unknown ref names the card, the ref and the id shape` | 报错含 `Fact card #0`、该 ref、`64 hex` 提示 |
| `a card that cites another session ref is refused with both sessions named` | 报错含 `belongs to <别的会话>, not <本会话>` |
| `a candidate without refs is refused by index and told what to cite` | 报错含 `Candidate #0 (skill:…) has no refs array` |
| `a ref written as event:<seq>:<digest> is repaired to the frozen id and counted` | 归一化生效、`planRepairs === 1`、存储的是规范 id |
| `an empty plan settles the run without execute and frees the gate` | 零候选提交即 `completed`、consumed=coverage、`execute` 幂等、再 plan 报 immutable、下次 startup 是 cooldown |
| `a request whose run already finished is recorded as completed, not timed out` | 过 deadline 的已完成 run 不再被写成 `timed_out`、不 abandon |
| `evidence lines keep the sequence out of the ref id and explain the id shape` | 行形如 `seq=1 event:1 …`；首页有 note，后续页没有 |
| `the plan response says whether execute is still required` | 0 候选回「settled」，有候选回「Call execute」 |

回归面：原有 26 例（含 `analyzed no-op completion consumes covered facts and prevents
terminal plan mutation`、`owner staging holds candidate bodies…`、`repeated execute` 幂等）
全部保持通过，说明新结案路径与既有 `execute` 契约不冲突。

一次未通过的中间态：改写 SKILL.md 第 5 步时把 `approves or rejects them in` 拆行，触发
`tests/dream-skill-install.test.mjs` 的措辞契约断言（该测试要求保留
`approves or rejects them in|human approves or rejects`）。已改回原措辞，随后 34/34 通过。

## 2. 全量测试

```
npm test
ℹ tests 1371   ℹ suites 10   ℹ pass 1252   ℹ fail 113   ℹ skipped 6
```

113 条失败**全部是既有失败**，与本次改动无关，证据：

- 抽样失败原因是 Windows 路径分隔符比较：断言期望 `plugins/dsh-evolution/src/records.mjs`，
  实际得到 `plugins\\dsh-evolution\\src\\records.mjs`（`tests/ownership-boundaries.test.mjs`
  的 5 条里 4 条是这个原因，涉及 `plugins/memory`、`plugins/dsh-mempalace`）；
- 另一族是 `ERR_UNSUPPORTED_ESM_URL_SCHEME … protocol 'c:'`（`scripts/surfcore-loader.mjs`
  在 Windows 上收到非 `file://` 路径），发生在加载 dream 代码之前；
- `TODOLIST.md` DV-UI-007「未验证」一行早已记录「根仓 `npm test` 仍有 114 条 Windows 既有失败
  （1350/1230/114/6），未修」，本次 1371/1252/113/6 与之同源（测试数 +8 为本轮新增，失败数 −1）。
- 失败清单里没有任何 dream / evolution 用例。

未修这些既有失败：超出本次变更面，按 AGENTS「不改无关失败」处理。

## 3. 技能安装

```
node -e "Promise.all([import('./scripts/lib/dream-skill.mjs'),import('./scripts/lib/vivy.mjs')])
  .then(([s,v])=>console.log(s.installDreamSkill(process.cwd(),v.home())))"
→ .artifacts/dsh-home/skills/diva-dream/SKILL.md
Get-FileHash 两侧：8B4BF5E6AB21AD12CC18FDF2937ABA521F9C4E316D93F384FD09042B1CC40F26（相同）
```

示例里的 id 最终写成 `event:<64 hex>` 占位而不是 `event:8b1d…`：截断的 hex 会被逐字抄进计划，
而占位符不会；被误抄时恰好由新的拒绝文案指回真实示例。

**与计划的偏差**：原计划跑 `npm run setup:components`，但该脚本要求先 `npm run stop`，且会连带
做组件迁移、profile 注册、SurfCore adapter 重建——对「只更新一个 SKILL.md」过重。改为直接调用
同一个 `installDreamSkill`（内部就是 `installProjectSkill`，幂等、保留 user-owned 副本），
效果等价。重启后 DSH 从 `$DSH_HOME/skills/diva-dream/SKILL.md` 读取，无需再跑 setup。

## 4. 未做的验证（明确未验证）

- **运行期未验收**：插件以源码 `./src/index.mjs` 加载，改动必须重启宿主才生效；重启会结束当前
  会话，因此留给你执行。重启前的所有结论都来自单元测试与 journal 回读，不是活体观察。
- **没有用真实 5007-ref 快照重放**：六次历史提交的缺陷类别已由 8 个新测试逐类覆盖，未做整包重放。
- **非空 plan + 从不 execute 的 2 小时空转**：本轮只加了明确提示，未改协议（需要会话结束钩子）。
- **上下文压缩、快照规模/时限、人格候选 baseline 缺口**：均未触及，见 summary 的「影响」边界。
