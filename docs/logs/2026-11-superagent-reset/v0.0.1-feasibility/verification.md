# 验证记录（只读）

只读纪律：没有改动代码、配置、数据、依赖；本轮只新增 `docs/research/superagent-reset.md`、本日志目录与 `TODOLIST.md` 一条决策项。

| 检查 | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| superagent 状态清单 | `Get-ChildItem .artifacts/dsh-home/state/superagent-local -Force` | 看到 sqlite 及 wal/shm、work、worker-bin | `orchestrator.sqlite` 253,952 B（11-13 04:07）、`-shm` 32,768 B（11-15 **11:02:21**）、`-wal` 0 B、`work/`、`worker-bin/`、`worker-gitconfig` |
| host 是否持有 sqlite | 上表 `-shm` 的 mtime vs 本次启动时刻 | mtime ≈ 启动时刻即证明在开着 | 11:02:21 = 本次 host 启动时刻，吻合 |
| 会话目录 | `Get-ChildItem .artifacts/dsh-home/sessions -Directory` | 三个 workspace：根、superagent 状态、refine work | 三个都在（`--…diva-dsh--`、`--…state-superagent-local--`、`--…work-refine-dream-evidence-…--`） |
| 设置分区能力 | `grep 'settings.section'` in `deepseek-harness/packages/client` | root 级 list slot，多插件注册 | `contract/slots.ts:57`；`ui-settings-account`、`ui-settings-models`、`ui-settings-plugins`、`ui-agent-preset` 均注册；`dsh-see-now` 历史记录见 `TODOLIST.md:416-418` |
| 通用设置内嵌行能力 | `grep 'settings.general.item'` | root 级 list slot | `contract/slots.ts:92`；`GeneralSection.tsx:17` 用 `renderSlot('settings.general.item', {})` |
| host 路由模板 | `plugins/dsh-laputa/src/http.ts:205-250` | `webServer.register({kind:'prefix'})` + host/origin/session 三层校验 | 三层都在：`allowedHost` → `sameOrigin`（非 GET）→ `connection.requestRejection(req)` |
| 启动器插入点 | `scripts/vivy-dsh.mjs:178-228` | spawn 之前有干净位置 | `pruneLogs()` 之后、`resolveProxy`/`spawn` 之前 |
| 已有的可复用清理件 | `Get-Content .artifacts/dsh-home/cleanup-autodream.mjs`（前 40 行） | rename 到 backups、停机要求 | 与预期一致：四个 TARGETS、`backups/20261114-autodream-cleanup`、端口探活 |
| masterId 规则 | `superagent/src/app/runtime.ts:104-105` | 由 stateDir 哈希兜底 | `store.get(KV.runtime.masterId) ?? 'orchestrator-' + key(stateDir)` |

## 未验证

- 自建 prefix 路由上 `connection.requestRejection` 是否可直接用（只读了 laputa 的用法，没有新插件实测）。
- 设置分区在新插件里的实际挂载顺序与外观。
- 清空后 DSH 侧栏该 workspace 的空会话条目表现（推断为「变空不消失」）。
