# 验证记录（2026-11-17）

> 全部只读。凭据文件只读了键名，没有读出任何 token 值；没有发起真实 DeepSeek API 调用。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git ls-tree -r --name-only origin/master packages` 过滤 deepseek/account/web/import | 找出相关包 | 命中 `llm/{llm-deepseek,llm-deepseek-account,llm-deepseek-api-key,deepseek-llm-api-extensions,plugin-package-inventory-deepseek}`、`web/{web-deepseek-api,web-search-deepseek}`、`experimental/deepseek-chat-import`、`session/session-log-deepseek`、`credentials/deepseek-account`、`client/{ui-settings-web-search,ui-settings-account,ui-account-notifications}`、`host/authentication-{desktop,token}` |
| 2 | `git show origin/master:<pkg>/README.zh.md` | 能力与契约 | 见报告 §2；Messages 适配器=anthropic 端点、thinking effort、Files 图片、签名回放 |
| 3 | 读三份 Agent Note（`.agents/notes/implemented/feature/2026-09-07|2026-10-15|2026-11-11*.zh.md`） | 设计取舍 | 确认 Search API 参数/限流、导入映射与丢弃规则 |
| 4 | `git show origin/master:packages/bundle/base/cordis.patch.yml` vs pin 同名文件 | 默认值差异 | master：`searchProvider: deepseek-search-api`、`fetchProvider: ...`；pin：`searchProvider: deepseek-official`、`fetchProvider: http`（pin 行 470–471；master 行 487） |
| 5 | 同文件 `grep 'id: (session-log-deepseek|plugin-package-inventory-deepseek)'` | 是否默认挂载 | pin 行 43、85 与 master 一致，均默认挂载 |
| 6 | 读 pin 的 `session-log-deepseek/README.zh.md` | 默认与开关 | `enabled` 默认 `true`、`maxBytes` 8 MiB；Web 开关「设置 → 通用 → 在使用官方模型 API 时上传 Session Log」 |
| 7 | `Test-Path deepseek-harness/packages/experimental/deepseek-chat-import` | pin 是否有导入 | **不存在**（其余 10 个相关包都存在） |
| 8 | 读 `.artifacts/dsh-home/profiles/superagent-local/cordis.patch.yml` | 本机模型路由 | `agent-default-model: provider deepseek-account / model deepseek-flash / effort high`；另有 `llm-pi-ai.opendesign` |
| 9 | 读 `.artifacts/dsh-home/.credentials.yaml`（只取键名） | 凭据存在性 | `deepseek-account-platform/default`、`deepseek-account-platform/device`、`refs.OPENDESIGN_API_KEY`；无 `DEEPSEEK_API_KEY` 记录 |
| 10 | 环境检查 | API key | `$env:DEEPSEEK_API_KEY` 未设置；`.artifacts/dsh-home/.env` 不存在 |
| 11 | 读 `.artifacts/dsh-home/llm-deepseek/files-v3.json` | Files API 是否在用 | 26 条 `file-api-*`；createdAt 2026-11-16 22:54 → 2026-11-17 02:36 |
| 12 | `node .artifacts/probe-session-log.mjs .artifacts/dsh-home/sessions 200`（zstd 解压 78 份会话日志，扫 `session-log-deepseek`/`dsh_session_log`） | 是否留下投递水位 | `files: 78, scanned: 78, marked: 0` |

## 证据文件

`.artifacts/ds-bundles.txt`、`ds-bundles2.txt`、`tts-*`（上一轮遗留）、`rd-*.md`、`rd2-*.md`、`note-*.md`、`gd-*.md`、`probe-session-log.mjs`、`probe-out.txt`、`probe-out2.txt`。

## 无法验证

- 账号 token 有效性/额度、Search API 单价与结果质量、`deepseek-flash` 是否在账号模型列表里：都需要真实调用，本轮按纪律不花额度。
- 会话导入真实流程：需要一份 `deepseek_data-*.zip`。
