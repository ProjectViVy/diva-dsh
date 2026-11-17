# DSH 上游本地真 diff 复核（2026-11-17）

## 一句话

上游从我们 pin 的 `dsh-v0.2.1-rc.5`（`b830ec9`）到 master（`39163dd`）是 **4803 commit / 11,665 文件 / +653,803 −798,230**；最新 release tag 仍是 `dsh-v0.2.2-rc.3`（`38a6a5c9`），master 比该 tag 多 **608 commit（433 非 merge，未发版）**；**master 自 2026-11-13 15:37 起没有新提交**。所以「有没有新东西」的答案是：新东西都在 rc.3 里（我们没升），rc.3 之后还有 433 个未发版提交（timeline / script-realm / cua-windows / ui-session-status / authentication-* / text-search 新包，ptc-runtime-python 移除），但**没有新版本号**。

## 本轮做了什么

- 补上 v0.1.0 调研的缺口：那次因沙箱拦住 `git fetch`，只能用 GitHub API；本轮用一次 `danger-full-access` 完成 `fetch origin master`，改为本地真 diff。
- 更新 `docs/research/dsh-0.2.2-upgrade.md` 的 §10（上游位置、体量、新东西三层清单、D1 多一个候选、新增 D6/D7、未核实）。
- 不改代码、不改配置、不动 submodule 指针（`b830ec9` 仍是 HEAD，`git status --porcelain` 为空）。

## 结论（对拍板的直接影响）

1. 目标版本仍是 **rc.3 tag `38a6a5c9`**，不是 master tip；master tip 只在「想要 timeline / cua-windows」时才值得考虑，且要接受未发版。
2. 比 v0.1.0 多出的硬事实：Agent Teams 已从 experimental 变核心（我们 profile 里那条 `dsh-experimental-agent-team-profile` 进 `RETIRED_BUNDLES`，会被自动移除）；`fs-observation-policy` 默认关（write/edit 不再要求先读，新增 `apply_patch`）；工具执行器拆成插件；Python PTC 移除；Node 24.9 硬门槛；组合包列表 API 搬到 `dsh-official-bundles`；`superagent` 的 cordis peer 钉在 `4.0.5-alpha.1`，而 0.2.2 是 `4.1.0`。

## 未验证

- rc.3 → master 的 433 个提交是否再引入 Superagent 破面（只按主题分类，未逐条核 117 条指南对我们 14 个本地插件的命中）。
- Forge / Timeline / Action Cards / CUA / Office 实际可用性（未安装、未运行）。
- 本地 10 个 `client.js` 插件在 0.2.2 新 slot 契约下的表现（只确认三个槽位名仍存在，未运行时验证）。
- `superagent` 在 cordis `4.1.0` 下能否构建（静态读到 peer 冲突，未真编译）。
