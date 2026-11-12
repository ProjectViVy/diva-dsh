# v0.0.1-feasibility Obsidian 笔记 ↔ MemPalace 双向可行性

- 状态：已交付（**纯文档，未改任何代码/配置/依赖**）
- 范围：`docs/research/obsidian-mempalace-feasibility.md`（新建）；`TODOLIST.md`（登记）；本日志目录
- 验证：见 `verification.md`（读源码定位约束，逐条带文件行号）
- 未验证：见下「未验证」段
- 下一步：用户在 A（独立 notes 域）/ B（复用 memories）/ C（走 ActMem 归档）中选定，并决定是否先做 M0
- 回滚：删除报告与本日志目录即可；未触碰运行时

## 改了什么

行为层面：**没有变化**。本轮只回答「你的想法能不能落地、卡在哪、代价多少」。

四个结论：

1. **索引可行**：分块（800/100）、嵌入（384 维）、FTS5 都是现成的；缺的是 vault 扫描、增量更新、以及一个**可变更**的存储单元。
2. **特殊 wing 可行但会被白名单吃掉**：`project` 就是 wing，但归档入口 `archive.mjs:24` 写死 `['qq','bili','owner','pet','other']`，`project:'obsidian'` 会被静默改成 `other`。
3. **写与「只读归档」冲突**：`POST /memories` 已删（404），正文只由 ActMem 经内部接口写且不可改写；笔记是可变文件，蹭这套账本会把契约弄脏。
4. **中文索引当前不可用**：默认嵌入是英文 MiniLM、FTS5 `unicode61` 不切中文、`normalizeTopicLabel` 会把中文 topic 洗成 `general`——三处叠加，中文 vault 语义检索基本随机。

推荐 **A 独立 notes 域**（同库不同表、`project='obsidian'` 隔离、中文走自己的 trigram + 多语模型），并把 M0 只读索引作为第一个切片（1.5–2 人日）。

## 影响面

- 用户可见行为：无。
- 数据：无写入、无迁移。
- 性能：无。
- 依赖方：无。
- 重启要求：**无**（纯文档）。

## 未验证

1. 中文多语嵌入在真实 vault 上的检索质量（未实测，建议 M0 用 50 条笔记做小评测）。
2. FTS5 trigram 的磁盘放大与查询延迟（未实测）。
3. Obsidian 外部写入后的编辑器冲突提示（未在真实 Obsidian 验证）。
4. 面板新增页签的实际成本（按 `client.js` 70KB 单文件经验估 0.5–1 人日）。
5. 多 vault 的命名空间方案未展开。

## 备注

- 本轮只读源码，未运行任何测试；引用行号对应工作区当前 HEAD（插件未提交改动与本轮无关）。
- 按 `AGENTS.md` §6「不自动提交」，本轮未提交。
