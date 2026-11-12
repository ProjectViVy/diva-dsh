# 验证记录 v0.0.1-survey

> 只写事实：调用、预期、实际。禁止只写「通过」。
> 本轮为纯文档交付，验证形式是「只读核对」；本机 `pwsh` 因沙箱 temp-root 不可用，全部走只读工具与 HTTP 抓取。

| # | 调用 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `GET api.github.com/orgs/MemPalace/repos` | 看官方是否有 Obsidian 项目 | 仅 `mempalace`、`mempalace-triage` 两个 |
| 2 | `GET api.github.com/search/repositories?q=topic:mempalace` | 量生态规模 | `total_count: 77` |
| 3 | `q=topic:mempalace obsidian in:description` | 找同时提 Obsidian 的 | `total_count: 6`（jarvis-os / reliquery / mnemos / HR-909 / sqs / mempalace-explore） |
| 4 | `q=mempalace obsidian`（全字段） | 交叉验证 | `total_count: 13` |
| 5 | `q=obsidian in:name mempalace` | 找同名仓库 | 仅 `minhlucvan/mempalace-obsidian`，`size: 0` |
| 6 | `GET api.github.com/repos/minhlucvan/mempalace-obsidian/commits` | 判断是否空仓 | `409 {"message":"Git Repository is empty."}` |
| 7 | `GET ungh.cc/repos/mnemos-dev/mnemos` | 元数据 | 4★ / 2 fork / 创建 2026-04-12 / 推送 2026-05-01 |
| 8 | `GET ungh.cc/repos/the-essential/reliquery` | 元数据 | 5★ / 0 fork / 创建 2026-05-06 / 推送 2026-05-21 |
| 9 | `GET ungh.cc/repos/raman325/mempalace-explore` | 元数据 | 0★ / 创建与推送同为 2026-09-01 |
| 10 | `GET ungh.cc/repos/porokka/jarvis-os` | 元数据 | 26★ / 推送 2026-11-05 |
| 11 | `GET ungh.cc/repos/AyanbekDos/memoriki` | 元数据 | 124★ / 推送 2026-04-14 |
| 12 | `GET ungh.cc/repos/letsloose501/sqs-agent-memory` | 元数据 | 2★ / 推送 2026-11-03 |
| 13 | `GET raw.../mnemos/README.md` + `docs/ROADMAP.md` | 确认插件是否开工 | README v1.3「Obsidian plugin」、ROADMAP §6.2「Obsidian plugin ~1–2 days」，均为未勾选计划 |
| 14 | `GET ungh.cc/repos/the-essential/reliquery/files/main` | 确认是技能不是代码 | 6 个 `SKILL.md`（cartograph/chronicle/forget/memorize/reliquery-help/study）+ 2 个 references + `examples/vault/*` + `reliquery.plugin`（36 KB），无 TS/JS 源码 |
| 15 | `GET ungh.cc/repos/raman325/mempalace-explore/files/main` | 确认技术栈 | `src/mempalace_explore/{app,assembler,source,snapshot}.py` + `static/app.js` + Dockerfile + tests |
| 16 | `GET raw.../mempalace-explore/README.md` | 确认数据来源 | 明确「MCP client over streamable HTTP」、`mempalace serve (v3.8+)`、`MEMPALACE_TOKEN`、只读 |
| 17 | `GET raw.../reliquery/CHANGELOG.md` | 版本与日期 | `1.0.0 - 2026-05-05`，内容是五个技能的首次发布 |
| 18 | 读 `plugins/dsh-mempalace/src/http.mjs:1-95` | 确认 API 鉴权与 CORS | `conn.requestRejection(req)` 校验会话；响应头无 `Access-Control-Allow-Origin`；非 GET 校验 Origin 同源 |
| 19 | `grep` http.mjs 路由 | 确认可复用读接口 | `/search` `/memories` `/rooms` `/taxonomy` `/graph/palace` `/graph/tunnel` `/knowledge/*` 均存在 |
| 20 | `GET ungh.cc/repos/letsloose501/sqs-agent-memory/files/main` | 确认是否 Obsidian 插件 | 无 `manifest.json`；有 `.claude-plugin/`、`hooks/`、`templates/vault/`、`scripts/vault_index.py`、`skills/notes/scripts/mempalace_doctor.py` |
| 21 | `GET ungh.cc/repos/AyanbekDos/memoriki/files/main` | 确认形态 | 只有 `wiki/`、`raw/`、`mempalace.yaml`、README、LICENSE，无代码、无插件 |
| 22 | `GET ungh.cc/repos/HR-909/Compiled-Memory-Architecture/files/main` | 确认是否 Obsidian 插件 | 无 `manifest.json`；`.claude/commands/*` + `wiki/` + `mempalace.yaml` |
| 23 | 读 `TODOLIST.md` | 确认登记位置与格式 | `## NOW` 为 DV-DOC-001/002；`### L0 文档与架构` 为空 |
| 24 | 读 `docs/logs/2026-11-im-gateway/v0.0.1-im-gateway-survey/*` | 对齐日志四件套格式 | summary/verification/acceptance/release 四件 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| DSH 面板 API 被第三方客户端调用的真实行为 | 没有 Obsidian 环境；且沙箱 `pwsh` 不可用，无法起本地探针 | 决定走 A 路线、写 M0 时 |
| `requestUrl` 在 Obsidian 里的 CORS 表现 | 同上 | 同上 |
| 上游 `mempalace serve` 的 MCP 行为 | 本机未安装 Python 版 MemPalace | 若决定做「接上游」而不是「接 dsh-mempalace」 |
| Obsidian 社区插件目录全量检索 | jsDelivr 抓取被截断 | 若需要「官方目录是否收录」这一结论时 |

## 反向验证

- 未做代码回滚：本轮零代码改动。
- 文档回滚 = 删除 `docs/research/mempalace-obsidian-integration.md` 与 `docs/logs/2026-11-mempalace-obsidian/`，并从 `TODOLIST.md` 移除 DV-DOC-003。
