# 验证记录 v0.0.2-deep-dive

> 只写事实：调用、预期、实际。禁止只写「通过」。
> 本轮为纯文档交付，验证形式是「克隆后只读核对」。本机 `pwsh` 在文件策略切到 `danger-full-access` 后可用，下述命令均为真实执行。

| # | 调用 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git clone https://github.com/mnemos-dev/mnemos.git .workspace/mnemos` | 拿到源码 | 成功；HEAD `c092d98`，2026-05-01 |
| 2 | `git rev-list --count HEAD` | 提交规模 | `385` |
| 3 | `git shortlog -sne HEAD` | 贡献者 | 仅 1 人（Tugra Demirors），发版账号 `kavunkarpuz-debug` 未出现在提交历史 |
| 4 | `Get-ChildItem -Recurse -Filter *.py \| Group-Object` + 行数统计 | 代码规模 | 90 文件 / 17,100 行；`mnemos/` 28 文件 7,809 行；`tests/` 52 文件 8,217 行 |
| 5 | `Select-String -Pattern '^def test_' tests/*.py` | 测试数量 | 496 个测试函数（作者自述 556 pass，未跑） |
| 6 | `git log --date=short --format=%ad \| Group-Object` | 提交节奏 | 19 个活跃日，2026-04-12 → 05-01；峰值 04-26 单日 57 |
| 7 | `git tag --sort=-creatordate` | 版本线 | v1.2.1 / v1.2.0 / v1.1.0 / v1.0.0a1 / v0.4.0-archived / v0.3.x / v0.2.0 |
| 8 | `Get-ChildItem -Recurse -Filter manifest.json` | 确认是否有 Obsidian 插件 | 0 命中 |
| 9 | `grep -rn index_raw_bulk mnemos/` | 找索引写入点 | 仅 `reindex.py:95`；SessionEnd worker 三步无建索引 → 语义索引只随手动 `reindex` 更新 |
| 10 | 读 `reindex.py:85-95` | 索引粒度 | 每个 `Sessions/*.md` 整个文件 1 条 doc；metadata 仅 `{path, type:"session"}` |
| 11 | 读 `server.py:89-140` | 检索默认集合 | v1.0 只搜 `raw`；`mined`/`both` 触发 DeprecationWarning 后回落 |
| 12 | 读 `search.py:379-389` + `558` | wing/room/hall 过滤 | 过滤代码仍在，但索引里没有这些 metadata → 空过滤 |
| 13 | 读 `search.py:567-580` | 嵌入模型 | 复用 ChromaDB `DefaultEmbeddingFunction`（all-MiniLM-L6-v2，384 维）；sqlite-vec 后端也依赖 chromadb 提供嵌入 |
| 14 | `grep -rn 'VaultWatcher\|watcher' mnemos/*.py` | 确认 watcher 是否仍在运行链路 | 仅剩 config 字段与 ignore 默认值；`server.py` 注释明写 v1.0 已删 `on_vault_change` |
| 15 | 读 `.github/workflows/test.yml` | CI 覆盖 | ubuntu+windows × py3.10/3.12；含「no Anthropic API」grep 硬门 |
| 16 | 读 `pyproject.toml` | 依赖与版本 | `mnemos-dev` 1.2.1，py≥3.10，6 个运行时依赖（chromadb / sqlite-vec / mcp / pyyaml / filelock / watchdog） |
| 17 | 读 `docs/prompts/refine-transcripts.md` | 笔记 schema | 六段骨架 + tag 前缀字典 + **作者本机 wing 映射表**（`C--Projeler-*`） |
| 18 | 读 `skills/mnemos-briefing/prompt.md:50-61` | 简报预算 | 五层合计硬上限 **25K**；HISTORY 里写的是 15K → 文档自相矛盾 |
| 19 | 读 `readiness.py` | 注入闸门 | `per_cwd_readiness` = 该 cwd 已精炼篇数 / 合格 JSONL 数；低于 `readiness_pct: 60` 静默 |
| 20 | 读 `refine_lock.py` | 并发控制 | per-JSONL `filelock`（timeout=0）+ ledger 复检；`normalize_ledger` 修脏账 |
| 21 | 读 `session_end_hook.py:120-243` | 触发与平台耦合 | Windows `DETACHED_PROCESS \| CREATE_NEW_PROCESS_GROUP \| CREATE_BREAKAWAY_FROM_JOB`；hook 超时 5000ms |
| 22 | 读 `server.py:209-300` | graph/timeline 实现 | 每次调用全量扫 `Sessions/*.md`；graph 只产出 `co-mentioned-in` 共现三元组 |
| 23 | `Get-Content docs/ROADMAP.md \| grep v1.3` | 新范式是否跑过基准 | `v1.3.0 ... ⏸`，LongMemEval R@5≥93% 未做 |
| 24 | `GET pypistats.org/api/packages/mnemos-dev/recent` | 采用度 | `last_month: 24, last_week: 18, last_day: 0` |
| 25 | `GET api.github.com/repos/mnemos-dev/mnemos` | 元数据 | 4★ / 2 fork / `open_issues_count: 0` / MIT / 推送 2026-05-01 |
| 26 | `GET api.github.com/search/issues?q=repo:...+obsidian` | 社区是否讨论过 Obsidian 集成 | `total_count: 0` |
| 27 | `GET api.github.com/repos/.../releases` | 发版形态 | v1.2.1 带 wheel + sdist；下载数 0 |

## 未做的验证

- 未安装依赖、未跑 `pytest`（chromadb 体积大且与本次结论无关）。
- 未在 Windows 上安装 hook 实测 SessionEnd/X-close 行为。
- 未用真实 vault 复现「索引陈旧」的体感（只做代码路径推断）。
