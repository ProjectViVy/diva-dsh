# v0.4.0 MemPalace 多向量空间 / 云端向量 / 自动召回

- 状态：已交付（离线部分全部验证；云端真实往返待 key）
- 范围：`plugins/dsh-mempalace/**`、`tests/mempalace-*.test.mjs`、`scripts/spaces-check.mjs`、`scripts/embedding-probe.mjs`、`docs/**`
- 验证：8 个测试文件逐个跑，84 通过 / 1 跳过（Windows 符号链接 EPERM）/ 0 失败；`node --check` 25 个文件全绿；真实库副本 dry-run 通过；线上库迁移已完成并留备份
- 未验证：云端真实往返与 `qwen3.7-text-embedding` 实际维度（等 key）；面板端内像素（沙箱无浏览器）；`recallBlock` 在生产被调用次数（本轮未加调用点）
- 下一步：DV-UP-003（用户给 key 后 probe）
- 回滚：面板切回 `local`；整库回退用 `<stateDir>/backups/memories-2026-11-12T20-07-35-838Z.db`

## 改了什么

1. **多向量空间**：一个库可并存任意多个 `vec0` 表，`embedding_spaces` 登记空间、`memory_spaces` 记录归属。`space_id = "<source>-[<kind>-]<model>@<dim>"`，表名由 space_id 派生并在碰撞时加摘要后缀。
2. **旧库原地收养**：首次打开时把既有 `vec_memories` 注册为 `legacy-adopted`，按 rowid 回填归属，不复制、不改名；迁移前用 SQLite backup 写 `backups/memories-<ISO>.db`。线上库已按此路径迁移 7/7 行并留备份。
3. **宽度校验**：写入前比对活动空间维度；不符则不写向量、`embedded` 留 0、返回 `MEMPALACE_SPACE_MISMATCH`，正文照常落库。不再写零向量占位。
4. **云端向量来源**：`embeddingSource: local | cloud` 显式选择。云端只读 `$DSH_HOME/capability-hub/registry.json` 的 `embedding` 插槽，key 走 `ctx.credentials.resolve(authRef)`。请求按批、带 `dimensions`、一次重试、失败后 5 分钟熔断；`dimensions` 被 400 拒绝时去参重试一次；返回宽度不符直接拒绝。
5. **自动召回**：`system-prompt/assemble` 瀑布按用户消息注入一次 `mempalace:recall` 上下文（后续步骤从历史读到同一块，不重复花费 token）。四信号打分 `0.65·cosine + 0.15·lexical + 0.10·importance + 0.10·recency`，无向量时后三项按 0.35 归一化；只对真人消息触发，子代理与系统快照不触发；超时退关键字，再失败不注入。
6. **敏感闸门**：密钥、证件/银行卡/手机号、私密话题在写入时打 `sensitive` 标记，自动召回默认排除；`recallExcludeSensitive` 可关。
7. **可见性**：`GET /spaces`、`POST /spaces/reindex`、`GET /embedding/status`、`POST /embedding/probe`；面板新增「向量空间」卡片、向量来源选择、云端维度/超时/批量、探测按钮与探测结果。
8. **运维脚本**：`scripts/spaces-check.mjs`（真实库一致性快照上干跑迁移）、`scripts/embedding-probe.mjs`（真实往返一次，不写库、不打印 key）。

## 影响面

- 用户可见：设置页多出召回与向量来源两块；概览/诊断显示来源与召回计数；旧记忆在切到云空间后需点一次「重建缺失向量」才会被云端语义检索到。
- 数据：新增两张表；`memories` 新增 `sensitive` 列（存量行默认 0，未回填历史判断）。旧向量与正文不动。
- 依赖方：`archive` 内部接口、知识账本、工具面与 `memory_search` 返回形状均未变。
- 重启要求：需要 `npm run stop && npm start` 才加载新代码；本会话由运行中实例托管，未自行重启。

## 未验证

- 云端真实往返：没有 key。已用假 `fetch` 覆盖请求/重试/熔断/维度校验，但真实端点、延迟、`dimensions` 是否被接受、`qwen3.7-text-embedding` 真实维度都未实测 → DV-UP-003。
- 面板像素：沙箱不能起浏览器，只做了 `node --check` 与结构审查。
- `sensitive` 存量回填：7 行历史记忆默认 0，未按新规则重新判定（避免在迁移里做内容推断）。
- 大库重建耗时：只在 7 行库上跑过，未测千行级批量。

## 备注

- 取舍：分表而非单表加列——`vec0` 的维度写在表定义里，单表无法容纳两种宽度；收养而非复制——复制需要一次可信的向量字节往返，收益为零、风险非零。
- 备选（未采纳）：切来源时把旧向量重算进新空间。会让「旧空间」失去意义且可能丢原始精度，改为按需 `reindex`。
- 观察点：召回在生产中被调用的次数与注入块字符数（面板「诊断」有计数）；若发现注入过频，先调 `recallMinScore` 再考虑裁剪 `recallTopK`。
