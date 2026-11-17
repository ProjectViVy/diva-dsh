# v0.2.0 上游特性与修复排序（只读）

- 状态：已交付（纯调研，未改代码）
- 范围：`CHANGELOG.md` v0.8.7–v0.8.9 全文归类 + `src/` 模块比对 + 与本仓补丁面/能力归属对照
- 验证：见 `verification.md`
- 未验证：每条修复到文件的归属是按 changelog 描述 + 文件存在性推断，未逐条读 diff 确认；`bridge.js` 内部调用点是否还有隐藏依赖未核
- 下一步：DV-UP-001 的 D1–D4
- 回滚：无代码改动

## 改了什么

没有改代码。在 `docs/research/surfcore-upstream-status.md` 追加 §10.5「按特性与修复排序」，含 P0（6 条）/ P1（11 条）/ P2（7 组）/ P3（dev 线）四档，每条标注**落点文件**与**成本类型**（断裂面 / 模块级 / 上游壳）。

## 影响面

- 决策层：把「升不升」从版本号问题换成「P0 六条值不值一次 bridge.js 重锚」的问题。
- 本轮无运行时影响；`.artifacts/research/surfcore-v089/` 仍是上一轮的本机缓存。

## 未验证

- 修复→文件的归属：`web-search.js` 的凭据改动、`command-spam.js` 的过滤逻辑等，是按 changelog 文字 + 文件新增判断的；有 3 处标注为「混合」（`bridge.js` + 独立模块），调用点未逐行确认。
- `0.8.7` changelog 里「B站 @ 一级评论补 root=source_id」究竟落在 `bili-memory.js` 还是 `bili-api.js` 未核实。
- P2 的冲突判断基于本仓补丁意图（`awaitMemoryContext`、`memoryCardPromptBlock` 替换）与 architecture.md §9 原则，未做实测验证。

## 备注

- 取舍：用「成本只有两种（断裂面 / 模块级）」当第二维度，而不是按版本号排。版本号排出来的顺序对决策无用——0.8.7 里既有 rc.5 生死线，也有纯 UI 美化。
- 关键发现：钉点之后新增 8 个模块，**一个都不在锚点面**；但 P0 六条里 4 条的调用点在 `bridge.js`。所以「便宜的修复」拿不到手上，除非连主轴的调用点一起换——这是排序最大的诚实结论。
