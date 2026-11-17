# 验证记录 v0.4.0

> 只写事实：命令、预期、实际。

基线与执行环境：Windows 11、Node v24.14.1、`DSH_HOME=.artifacts/dsh-home`。改动前的基线是 57 例 31 失败（27 例 Windows 文件锁 `EPERM` 拆卸 + 4 例平台断言），WP0 修完后为 0 失败，本轮所有对比以「0 失败」为基线。

## 测试

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node tests/mempalace.test.mjs` | 24 通过 | 24 通过 / 0 失败 |
| 2 | `node tests/mempalace-archive-store.test.mjs` | 7 通过 | 7 通过 / 0 失败 |
| 3 | `node tests/mempalace-knowledge.test.mjs` | 14 通过 | 14 通过 / 0 失败 |
| 4 | `node tests/mempalace-retire.test.mjs` | 7 通过 + 1 跳过 | 7 通过 / 1 跳过（符号链接 `EPERM`）/ 0 失败 |
| 5 | `node tests/mempalace-archive.test.mjs` | 7 通过 | 7 通过 / 0 失败 |
| 6 | `node tests/mempalace-spaces.test.mjs`（新） | 7 通过 | 7 通过 / 0 失败 |
| 7 | `node tests/mempalace-cloud-embedding.test.mjs`（新） | 8 通过 | 8 通过 / 0 失败 |
| 8 | `node tests/mempalace-recall.test.mjs`（新） | 10 通过 | 10 通过 / 0 失败 |

合计 84 通过 / 1 跳过 / 0 失败。

说明：`node --test tests/mempalace*.test.mjs` 在 Windows 沙箱下会因子进程命名管道被拒绝（`\\.\pipe\LOCAL\dotnet_*` → `EPERM`）而无法运行，因此逐个文件执行；这是环境限制，不是测试失败。

## 语法与静态检查

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 9 | 对 `plugins/dsh-mempalace/src/**/*.mjs`、`src/client.js`、两个新脚本执行 `node --check` | 25 个文件均 exit 0 | 首次发现 `client.js` 括号不平衡（多一个 `)`），修正后 25/25 通过 |

## 真实库 dry-run

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 10 | `node scripts/spaces-check.mjs` | 只读快照 + 收养 + 切云空间，不改线上文件 | 记忆行数 7；收养后空间数 1；缺向量 0；旧表 `legacy-adopted` / `vec_memories` / 384 维；样本检索 `semantic` 命中 5；切到云空间后共 2 个空间、缺向量 7、活动 `cloud-dashscope-text-embedding-v4@512`；结论「迁移路径可行」 |

## 线上库实际迁移（运行中实例）

| # | 证据 | 预期 | 实际 |
| --- | --- | --- | --- |
| 11 | `.artifacts/dsh-home/mempalace/memories.db` 只读查询 | 迁移后 7/7 行入 `memory_spaces`，旧向量保留 | `embedding_spaces` 1 行（`provenance=legacy-adopted`、`table_name=vec_memories`、`dim=384`）；`memory_spaces` 7 行；`memories.embedded=1` 7 行 |
| 12 | `backups/` 目录 | 迁移前快照存在 | `memories-2026-11-12T20-07-35-838Z.db`，1,748,992 字节，与迁移前库同尺寸 |

## 云端探测（未完成）

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 13 | `node scripts/embedding-probe.mjs` | 有 key 时返回实测维度 | 未配置 key 且插槽 `enabled:false`，输出「世界网关的「向量化」插槽未启用」并以 exit 1 结束——fail-closed 行为符合设计 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 云端真实往返 | 没有 key，且网关插槽未启用 | 用户提供 key 后（DV-UP-003） |
| `qwen3.7-text-embedding` 真实维度 | 同上 | 同上 |
| 面板交互像素 | 沙箱不能起浏览器/Playwright（spawn `EPERM`） | 重启后由用户在面板点「探测向量接口」 |
| 千行级重建耗时 | 线上只有 7 行 | 库增长后观察 |

## 反向验证

- 故意让 `spaceIdFor` 接受未知 `source`：`tests/mempalace-spaces.test.mjs` 第一例立即红；恢复校验后转绿。
- 故意让 `#keywordCandidateIds` 只用 FTS：中文短查询召回为 0，关键字兜底用例红；加 LIKE 兜底后转绿。
- 回滚路径：把 `local` 写回配置即切回旧空间；整库回退用 `backups/` 快照，旧代码不读取两张新表，缺列不影响。
