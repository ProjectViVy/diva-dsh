# 验证记录（2026-11-17）

> 沙箱限制：`workspace-write` 下 git 的 `remote-https` 建管道被拒（`cannot create standard input pipe for remote-https: Permission denied`），`Get-CimInstance`/`tasklist`/`netstat` 亦被拒。因此命令一律 `cmd /c "... > .artifacts\xxx.txt 2>&1"` 落文件再读；`git` 需要 `GIT_CONFIG_COUNT/KEY_0/VALUE_0 = safe.directory=*` 规避「dubious ownership」（repo 属主是 BUILTIN/Administrators，当前用户不是）。`git fetch` 用了一次 `danger-full-access` 升级（用户已批准），只新增 `origin/master` 引用。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git -C deepseek-harness fetch origin master --no-tags`（danger-full-access） | 拉到 master | exit 0；`fcc0ad46217..39163dd30f7 master -> origin/master` |
| 2 | `git -C deepseek-harness rev-list --count b830ec9..origin/master` | 数字 | **4803** |
| 3 | `git -C deepseek-harness log --no-merges --format=%s b830ec9..origin/master` | 主题列表 | 3446 行；fix 1208 / test 695 / feat 434 / docs 387 / refactor 312 … |
| 4 | `git -C deepseek-harness diff --stat b830ec9 origin/master` | 体量 | **11665 files changed, 653803 insertions(+), 798230 deletions(-)** |
| 5 | `git -C deepseek-harness show origin/master:package.json` | 版本/引擎 | `version 0.2.2-rc.3`、`engines.node >=24.9.0`、`packageManager pnpm@11.28.5` |
| 6 | `git -C deepseek-harness log -1 --format=%ad origin/master --date=iso-strict` | 最后提交时间 | `2026-11-13T15:37:50+08:00` |
| 7 | `git -C deepseek-harness merge-base --is-ancestor 38a6a5c9 origin/master` | rc.3 tag 是 master 祖先 | exit 0（是） |
| 8 | `git -C deepseek-harness rev-list --count 38a6a5c9..origin/master` | master 领先 tag 多少 | **608** |
| 9 | `git -C deepseek-harness log --no-merges --format=%s 38a6a5c9..origin/master` | rc.3 后未发版工作 | 433 行；fix 129 / feat 68 / test 65 / docs 58 / refactor 47 |
| 10 | `git -C deepseek-harness diff --stat 38a6a5c9 origin/master` | 未发版体量 | `3309 files changed, 104100 insertions(+), 36870 deletions(-)` |
| 11 | `git ls-tree -r --name-only <ref> packages` 两版对比 | 包增减 | pin 343 → master 382；新增 39 个（分组见下）、移除 11 个 |
| 12 | `git ls-tree -r --name-only <ref> packages`（rc.3 vs master） | 未发版包增减 | 新增 9：`client/script-realm`、`client/script-realm-iframe`、`client/ui-session-status`、`experimental/cua-mcp`、`experimental/cua-windows`、`experimental/timeline`、`host/authentication-desktop`、`host/authentication-token`、`util/text-search`；移除 1：`experimental/ptc-runtime-python` |
| 13 | `git diff --name-status b830ec9 origin/master -- docs/upgrade-guide` | 新迁移指南 | **新增 117 条 zh 指南**（+2 条修改）；版本跨度 v0.2.1-alpha.2 → v0.2.2-rc.2 |
| 14 | `git show origin/master:packages/util/official-bundles/src/{bundles,plugin-manager}.ts` | 新 bundle 清单 | `OPTIONAL_BUNDLES` 18 项（新增 `personalized-recommendations`/`cua-bundle`/`cua-mcp`/`timeline`/`liveshare`/`forge-bundle`/`deepseek-chat-import`）；`RETIRED_BUNDLES` 含 `dsh-experimental-agent-team-profile` |
| 15 | `git show origin/master:vendor/cordis/package.json` vs 本地 | cordis 版本 | 本地 `@deepseek-ai/cordis` 4.0.5 → master 4.1.0 |
| 16 | `git -C superagent log --oneline -6`；`rev-list --left-right --count HEAD...origin/main` | Superagent 上游是否更新 | 本地 `6337fc8`、上游 `8c32a9d`，分叉 1/1；上游只有一个 commit（2026-10-31） |
| 17 | `git grep -l -F <slot> origin/master -- packages/client` | 三个槽位是否还在 | `conversation.input.activity` / `settings.section` / `sidebar.panellist` 均命中 |
| 18 | `registry.npmjs.org/-/package/@deepseek-ai/dsh/dist-tags` | 发版口径 | `latest=0.2.2-rc.1`、`next=0.2.2-rc.3`、`alpha=0.2.2-alpha.3` |
| 19 | `node --version` | 本机 Node | `v24.14.1`（满足 >=24.9.0） |
| 20 | `git -C deepseek-harness status --porcelain`；`git ls-tree HEAD deepseek-harness` | 是否弄脏 | 空；指针仍 `b830ec95` |
| 21 | `scripts/*.mjs` 里 grep `OPTIONAL_BUNDLES|PROFILE_TEMPLATES|app-boot|official-bundles|updatable` | 启动器是否依赖被搬走的名字 | 0 命中 |

## 落地证据文件（`.artifacts/`，不入库）

`up-count.txt`、`up-subjects.txt`、`up-stat.txt`、`up-rootpkg.json`、`up-guides.txt`、`up-files-{new,old}.txt`、`up-files-rc3.txt`、`post-subjects.txt`、`post-stat.txt`、`post-dates.txt`、`up-bundles.ts`、`up-pm.ts`、`up-vendor-cordis.json`、`up-slot{1,2,3}.txt`、`guide-*.md`、`readme-*.md`、`sa-*.txt`、`g-sub.txt`。

## 无法验证

- 上述命令没有 `npm test`／构建／启动——本轮是只读调研，按 skill 纪律不动代码。
