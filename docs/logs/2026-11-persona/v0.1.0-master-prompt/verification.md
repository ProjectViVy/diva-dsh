# 验证记录

## 静态与构建

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 补丁可应用 | `git -C superagent apply --check ../patches/superagent-persona.patch` | exit 0（注意 `-C superagent` 时路径要相对 superagent 根） |
| 补丁清单合法 | `node -e "…patchManifest…"` / `node --test tests/source-runtime.test.mjs` | 12 条，29/29 通过 |
| 上游工作树干净 | `git -C superagent status --short` | 构建前后均为空 |
| 补丁进产物 | `Select-String superagent/lib/index.js -Pattern "complete: true"` | 构建前 1 处（原 `:10215`），构建后 **0 命中** |
| 重建 | `.artifacts/rebuild-superagent-persona.mjs` | `patching 12 files` → tsdown `✔ Build complete`，exit 0 |

## 人格发布

| 检查 | 结果 |
| --- | --- |
| 启用 | `POST /dsh-laputa/api/enabled {enabled:true}`，profile `cordis.patch.yml` 出现 `- id: laputa … enabled: true` |
| 状态 | `enabled=true`、`initialized=true`、`revision=1`、`chars=1355`、`revisionPending=false` |
| 落盘 | `default/*.MD` = 682/967/756/816/261/267 B，与 `.state/default/revisions/r000001/` 逐字节一致，`current.json` 指向 r000001 |
| 读回 | `GET /dsh-laputa/api/file?name=…` 六份内容与写入一致 |

## 鉴权（踩坑记录）

- `.artifacts/dsh-home/laputa/runtime.json` 里的 token **不是**启动令牌，拿它换 cookie 返回 401。
- 可用的是启动器日志 `dsh web: http://127.0.0.1:3082/?token=…` 里的 token；用它换到 cookie 后，面板 API 的写路由（同源 + 会话）才通。

## 未验证

- 运行期：master 的系统提示词里是否真的出现 `laputa:persona` 段（要让 host 用新的 `superagent/lib` 重启）。
- 既有会话的人格文本在安装时已 pin（`cache.session`），所以即使重启，旧会话也未必立刻换文本；主会话与新建会话才吃到 r1。
- 路由是否退化（去掉 `complete` 后 master 会额外吃到其它系统段，master cwd 是 `state/superagent-local`，不含 AGENTS.md，泄漏面预计很小）。
