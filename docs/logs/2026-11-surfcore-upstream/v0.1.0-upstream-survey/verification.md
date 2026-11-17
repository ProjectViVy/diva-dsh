# 验证记录 v0.1.0

> 只写事实：命令、预期、实际。禁止只写「通过」。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git -c safe.directory=<sub> -C plugins/surfcore log --oneline -8` | 看到 HEAD 与上游版本 | HEAD `59ec306 release: v0.8.6`，其下 0.8.5 / 0.8.4 / 0.8.3 / 0.8.2 / 0.8.1 / 0.8.0 / 0.7.23 |
| 2 | `git -C plugins/surfcore for-each-ref refs/remotes --format='%(refname) %(objectname:short)'` | 本地 clone 是否已取到新版 | `origin/HEAD 0ce8580`、`origin/main 0ce8580`（= v0.8.9，已 fetch，未 checkout） |
| 3 | `git -C plugins/surfcore status --short --branch` | 确认工作区状态 | `## HEAD (no branch)` + 9 个 `M`（setup 渲染产物：`lib/client.js`、`lib/index.js`、`lib/scheduler.js`、`tools/commands/dm-await.mjs`、`tools/lib/msgfeed.mjs`、`tools/lib/state-paths.mjs`、`src/bili-share-scheduler.js`、`src/bridge.js`、`src/character-persona.js`） |
| 4 | `git -C plugins/surfcore diff --stat 59ec306 0ce8580 -- <9 个锚点文件>` | 哪些锚点文件真被改过 | 5 个有改动：`lib/index.js` +1007、`lib/scheduler.js` +261、`tools/lib/msgfeed.mjs` +46、`src/bridge.js` +1881、`src/character-persona.js` +26；其余 4 个未出现 = 无变化 |
| 5 | `git -C plugins/surfcore diff --shortstat 59ec306 0ce8580` | 全量跨度 | `351 files changed, 33240 insertions(+), 1160 deletions(-)` |
| 6 | `git archive --format=tar -o <tmp>/v089.tar 0ce8580 -- <9 files>` + `tar -xf` | 取 v0.8.9 源码到本机缓存 | exit 0 / exit 0，6 个 `.js` + 3 个 `.mjs` 落盘 |
| 7 | `node .artifacts/research/surfcore-v089/probe.mjs` | 9 条渲染链在 v0.8.9 上是否还能锚住 | 3 DRIFT / 6 OK，见下 |
| 8 | `git -C <root> ls-tree HEAD plugins/surfcore` | 根仓库钉的指针 | `160000 commit 59ec3066f7d42a0452fae01f170c9a8484d5dbe5 plugins/surfcore` |
| 9 | `Select-String scripts/lib/surfcore-component-pins.json` | pins 版本与哈希数 | `patchVersion: 4`、`commit: 59ec3066…`、`tag: v0.8.6`、9 条 `sourceSha256` |
| 10 | `Select-String plugins/surfcore/package.json -Pattern '"version"'` | 现场版本号 | `"version": "0.8.6"` |

## 探针输出（第 7 步原文）

```
DRIFT    src/bridge.js :: The pinned SurfCore source no longer matches the component migration:   function purposePersonaText() { →   function purposeContextBlocks() {
OK       src/bili-share-scheduler.js
OK       src/character-persona.js
DRIFT    plugins/surfcore/lib/index.js :: The pinned SurfCore source no longer matches the component migration:       const lower = launcher.toLowerCase();
      if (lower.endsWith('.bat')
DRIFT    plugins/surfcore/lib/scheduler.js :: The pinned SurfCore source no longer matches the component migration:       const L = limitsNow()
OK       plugins/surfcore/lib/align.js
OK       plugins/surfcore/tools/commands/dm-await.mjs
OK       plugins/surfcore/tools/lib/msgfeed.mjs
OK       plugins/surfcore/tools/lib/state-paths.mjs
```

探针脚本：`.artifacts/research/surfcore-v089/probe.mjs`，直接 import 本仓 `scripts/lib/surfcore-runtime-transform.mjs` 的真实 renderer，喂 v0.8.9 源码。

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| `npm run setup:surfcore` | 只读纪律：会重写子模块工作区与 `patched-manifest.json` | D1 选 B 并开工后 |
| `npm run test:audit`（SurfCore） | 同上，且会起服务 | 拍板后，且需先有 DV-TEST-001 的可信基线 |
| `renderHostBootSource` / `renderHostWorkdirSource` 两层 | 未从 `surfcore-component-patch.mjs` 导出，探针无法单独调用 | 重锚时在 renderer 内部加临时断言 |
| `npm test`（根） | 与本轮改动面无关（无代码改动），且沙箱下 `node --test` 子进程受限 | 升级那一轮必须跑 |

## 反向验证

确认了漂移检测**没有静默降级**：`renderTarget()` 在 sha256 不一致时直接抛 `PatchDriftError`（`code: SURFCORE_PATCH_DRIFT`），探针正是第一步就撞上 sha256 之外的第二道闸（锚点找不到恰好一次），说明两道校验都在生效。
