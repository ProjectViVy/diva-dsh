# verification — v0.1.0-tone-editor

日期：2026-11-12。跑在这台 Windows 机器上；沙箱内 `node --test`（子进程捕获 stdio）被拒，改为直接 `node <file>` 在进程内跑 `node:test`。

## 1. 语法

```
node --check plugins/dsh-vivy-tone/src/client.js
node --check plugins/dsh-laputa/src/client.js
node --check plugins/dsh-vivy-tone/src/server.mjs
node --check plugins/dsh-vivy-tone/src/tone.mjs
node --check plugins/dsh-vivy-tone/src/index.mjs
node --check plugins/dsh-vivy-tone/src/install.mjs
```

结果：全部通过。

## 2. 默认语气与已安装覆盖一致（关键：不产生新版本）

```
node --input-type=module -e "... composeOrchestrator(DEFAULT_TONE) ... hashText ..."
```

结果：

- `composed === TRANSLATIONS['runtime/orchestrator']` → `true`
- `hashText(composed)` → `7c93d0575ad737143b3cfae406c5c5f40e19cba547ec47f56fad59afd185a272`
- `$DSH_HOME/vivy-tone/installed.json` 里 `runtime/orchestrator` 的哈希 → 同值

即拆分前后文本逐字节相同，重启后的启动安装会判定「已是本包文本」而不再写新版本。

## 3. 语气 / 安装 / 接口测试

```
node tests/vivy-tone.test.mjs
```

结果：`tests 43 / pass 42 / fail 1`。

- 通过：既有 26 项（安装、planParts、状态文件、配置、CLI）＋ 新增 17 项（语气拆分与拼接、tone.md 读写与回退、留空、长度校验、安装按语气拼接、重启保持语气、saveTone 成功/缺 part/409/文本校验、路由 GET/Host/同源/会话/JSON/404）。
- 唯一失败：`configuration > resolves the state directory the same way for the plugin and the CLI`，断言写死 `/tmp/dsh-home/vivy-tone`，在 Windows 上 `join` 给出 `\tmp\dsh-home\vivy-tone`。**改动前即存在**（`git grep -n "tmp/dsh-home" HEAD -- tests/vivy-tone.test.mjs` 命中的是同一段），与本次改动无关，未一并修改以免混入无关变更。

## 4. 语气卡片测试

```
node tests/vivy-tone-client.test.mjs
```

结果：`tests 5 / pass 5`（注册进 `settings.laputa.item`、渲染语气与按钮、保存发 PUT 并提示 `r4`、恢复默认只改编辑框、保存被拒时显示 hint）。

## 5. 人格设置页测试

```
node tests/laputa-panel.test.mjs
```

结果：`tests 17 / pass 17`（含新增：设置分区标题为「人格与语气」、声明 `settings.laputa.item` 并渲染该插槽）。

## 未验证（如实记录）

- 端内真实交互：运行中实例（http://127.0.0.1:3082）仍是旧代码，`dsh.client` 扫描和语气路由都要重启后才存在；本会话由该实例托管，重启会终止当前回合，故未重启。
- 真实 Superagent 提示词写入：单测用假 `fetch` 覆盖；没有在真实提示词库上试写（避免为了验证制造真实版本）。
- 浏览器像素与交互手感：本沙箱无法跑 Playwright（spawn EPERM），未截图。
