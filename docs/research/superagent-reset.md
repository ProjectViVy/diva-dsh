# Superagent 一键初始化：能不能做成设置里的一个分区

> 2026-11-15 · 只读调研（未改代码/配置/数据）· 结论先行

## 0. 结论

**能做，而且不用碰上游三仓。** 拆成两半：

| 半 | 结论 | 证据 |
| --- | --- | --- |
| 界面：设置里的专用分区 | 可以。`settings.section` 是 root 级 list slot，任何已挂载的插件都能注册一节；本仓 `dsh-see-now` 早前就注册过一节（后按你要求撤掉），DSH 自带 `ui-settings-account` 是同一写法 | `deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts:57`；`ui-settings-account/src/client/index.ts:313-321`；`TODOLIST.md:416-418`（see-now 撤分区记录） |
| 真删东西 | **不能在 host 运行时做**，只能「排队，下次 `npm start` 前执行」。原因是 sqlite 被 host 开着（`orchestrator.sqlite-shm` 的 mtime 就是本次启动时刻 11:02:21），master 的会话日志也正被 host 写 | `.artifacts/dsh-home/cleanup-autodream.mjs:1-6` 的原话就是「必须在 host 停着的时候跑——那条 master 会话日志就是 host 正在写的文件」 |

**推荐路线 A**：新插件 `plugins/dsh-superagent-reset`（host 一条 prefix 路由 + client 一节设置）+ `scripts/lib/reset-superagent.mjs`（搬到备份，可回滚）+ `scripts/vivy-dsh.mjs` 的 `start()` 里加一步「有排队就先执行」。点按钮 = 排队；`npm start` = 真的清。

**备选路线 B**：只做 CLI（`npm run reset:superagent [--all] [--dry]`），设置页不介入。约 150 行，零 host 代码，最省。

**不推荐 C**：改 `patches/` 让 superagent 运行中自清（免重启），会去删 host 正在写的日志、并让内存表与 sqlite 不一致，不可回滚。

## 1. 口径与限制

- 「初始化 superagent」在本报告里指：把它**在本机的持久状态**恢复到刚装好——① 对话历史（master + worker 会话日志）；② 编排板数据（工单、评估、触发、提示词修订、模型/开关设置）。
- **不含**：ActMem 记忆卡（`dsh-home/memory`、`actmem-recap`）、人格文件（`dsh-home/laputa`）、skills、其他插件（see-now / skin / voice）的状态。这些各有各的所有者，见 §5 D3。
- 方法：只读源码与运行期文件；没有跑过任何删除。日期 2026-11-15。

## 2. 现状盘点

### 2.1 状态都在哪（观测）

```
.artifacts/dsh-home/state/superagent-local/
  orchestrator.sqlite        253,952 B   11-13 04:07   ← 编排板 + KV（masterId/工单/评估/触发/提示词修订/设置）
  orchestrator.sqlite-shm     32,768 B   11-15 11:02   ← host 正开着（mtime = 本次启动）
  orchestrator.sqlite-wal          0 B   11-15 00:13
  work/                      （refine 等工单的工作目录）
  worker-bin/ worker-gitconfig         （启动时重建，不用清）
.artifacts/dsh-home/sessions/
  --…-state-superagent-local--/orchestrator-4d1802…/      ← master 的会话日志（host 正在写）
  --…-state-superagent-local-work-refine-…--/             ← worker 会话工作区
```

### 2.2 清掉 sqlite 不会换会话 id（推断，有源码依据）

`masterId = store.get(KV.runtime.masterId) ?? 'orchestrator-' + key(stateDir)`
（`superagent/src/app/runtime.ts:104-105`）。等号右边是 stateDir 路径的哈希，路径不变则结果不变；所以「全初始化」之后 master 仍是同一条 `orchestrator-4d18…`，日常页照旧绑得上，只是里面空了。**这是好事**：不用改日常页的认会话逻辑。

### 2.3 现成可复用的东西

- `.artifacts/dsh-home/cleanup-autodream.mjs`：已经有「停机 → rename 到 `backups/` → 可回滚」的完整写法（含端口探活拒跑）。
- `scripts/vivy-dsh.mjs:178-228` `start()`：`pruneLogs()` 之后、`spawn` 之前有一段干净位置，插一步即可。

## 3. 候选方案

### A（推荐）设置分区 + 启动器排队执行

- **host**（新插件 `index.js`）：`ctx.inject(['webServer','connection'], …)` → `webServer.register({kind:'prefix', path:'/dsh-superagent-reset/api'})`，三条路由：`GET /status`（要清什么、多大、现在有没有排队）、`POST /arm`（写标记）、`POST /cancel`。校验抄 laputa 的现成三条：`allowedHost` → `sameOrigin`（非 GET）→ `connection.requestRejection(req)`（真正的会话验证）。
- **标记**：`.artifacts/dsh-home/reset-pending.json`，内容 `{scope:'history'|'all', at, by}`。放在 `state/superagent-local` 外面，免得自己被清掉。
- **client**（同插件 `client.js`）：`ctx.slots.register({name:'settings.section', id:'superagent', order:40, label:'Superagent'}, Section)`；一屏三块——现在多大/多少条、范围二选一、按钮。点「全初始化」要手打 `RESET` 才能排队。
- **执行**：`reset-superagent.mjs` 读标记 → 目标逐个 rename 到 `.artifacts/dsh-home/backups/reset-<stamp>/` → 删标记 → `npm start` 正常起。`--dry` 只打印。
- **代价**：新插件 1 个（host ~110 行、client ~220 行、package/patch 接线）、启动器 ~40 行、脚本 ~120 行、测试 ~150 行。
- **风险**：误触发（用手打 RESET + 可取消 + 只在下次启动生效把后果压到最低）；Windows 文件占用（本来就必须停机，天然满足）。

### B（备选，最省）只做 CLI

`npm run reset:superagent -- --history|--all|--dry`：搬移 + 打印，没有 UI、没有路由、没有新插件。约 150 行。设置页可以做，也可以不做——不做就少一个入口，但少一整个插件仓和它的接线。
取舍：A 的价值只在「你看得见」，你自己本来就天天开终端；如果不想再加一个插件，B 足够。

### C（不推荐）上游 patch：运行中自清

在 superagent 加 `POST /orchestrator/api/reset`：清 KV 表 + 轮换 masterId + 删会话日志。
- 免重启，但：删的是 host 自己正在 append 的 jsonl（`cleanup-autodream.mjs` 明确禁止）；`store` 是内存 KV + sqlite，删表后运行中的缓存与磁盘不一致；masterId 一换要牵动 9 处引用（relay 投递、通知注入、preset 守卫、评估投递、资源页归属、启动 ensure、关机取消列表、HTTP state、面板按钮）。不可回滚。

## 4. 卡点

- **K1 必须停机**：sqlite 与 master 日志都由 host 持有。→ 决定「排队 + 下次启动执行」是唯一安全形态（对应 A/B，排除 C 的免重启卖点）。
- **K2 范围会误伤**：sqlite 里不只有历史，还有你调过的**提示词修订**与模型/开关设置。→ 必须两档，默认只清历史。
- **K3 日常页折叠分界要一起清**：`localStorage` 的 `dsh-daily/fold/<sessionId>` 记的是旧日志的 seq；清完历史后它会指向不存在的消息（界面不会崩，但会出现悬空提示）。→ 重置时给日常页一个约定：session id 不变时，检测「最大 seq < 分界」自动丢弃分界（一行代码，跑到 dsh-daily 里）。
- **K4 清完 master 会立刻被重建**：`Sessions.ensure` 下次启动就建一条空会话——这正是想要的；DSH 侧栏那条会话会变空而不会消失，别当 bug。
- **K5 弱边界**：loopback + `Origin` 只是弱校验，真正的闸门是 `connection.requestRejection`；即便如此，一条本地进程仍可能伪造。→ 手打 RESET + 取消 + 延后生效。

## 5. 决策清单（不拍板不实施）

- **D1 放在哪**：① 独立分区「Superagent」（推荐，settings 导航里多一项）；② 只塞「通用设置」里当一行（`settings.general.item`）；③ 两处都放（分区为主，通用设置里放一行指路）。
- **D2 范围档位**：① 只清对话历史，保留工单/评估/提示词/设置（推荐默认）；② 完全初始化，连 sqlite 一起搬走。两档都给，需要各自文案。
- **D3 要不要连 ActMem 记忆卡一起清**：那是另一个所有者（ActMem / 记忆宫殿），有自己接口；本轮不并进来，需要单独开关（推荐单独立项）。
- **D4 生效方式**：① 排队到下次 `npm start`（推荐）；② 走 C 的 live 重置（不推荐）。
- **D5 要不要 CLI 入口**：① 要（`npm run reset:superagent`，取证与回滚都靠它，推荐）；② 只要 GUI。
- **D6 插件形态**：① 新插件 `plugins/dsh-superagent-reset`（推荐，语义独立）；② 塞进 `dsh-daily`（省一个插件，但「日常页」与「清空 superagent」混在一个包里）。

## 6. 参考（访问日期 2026-11-15，均为本机源码）

- `deepseek-harness/packages/client/ui-settings/src/client/contract/slots.ts:57`（`settings.section`）、`:92`（`settings.general.item`）
- `deepseek-harness/packages/client/ui-settings-account/src/client/index.ts:313-321`（分区注册写法）
- `deepseek-harness/packages/client/ui-settings-general/src/client/GeneralSection.tsx:14-17`（通用设置如何渲染 item）
- `deepseek-harness/packages/client/ui-settings-general/src/client/index.ts:81-100`（`settings.general.item` 注册写法）
- `plugins/dsh-laputa/src/http.ts:205-250`（host 路由 + 三层校验的现成模板）
- `plugins/dsh-laputa/src/index.ts:114-124`（`ctx.inject(['webServer','connection'])` 挂路由）
- `superagent/src/app/runtime.ts:104-105`（masterId 规则）、`:210`（启动 ensure）
- `.artifacts/dsh-home/cleanup-autodream.mjs:1-6`（停机要求）
- `scripts/vivy-dsh.mjs:178-228`（start 的插入点）
- 状态实测：`state/superagent-local/` 与 `sessions/` 列表（见 §2.1）
