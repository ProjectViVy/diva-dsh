# v0.1.0-tone-editor 设置「人格与语气」里可编辑的语气块

- 状态：done（**待重启验收**）
- 范围：`plugins/dsh-vivy-tone/`（`zh.mjs`、`tone.mjs`、`install.mjs`、`server.mjs`、`index.mjs`、`client.js`、`package.json`、`cordis.patch.yml`、`README.md`）、`plugins/dsh-laputa/src/client.js`、`plugins/dsh-laputa/README.md`、`docs/architecture.md`（§6.1 一条边界说明）、`tests/vivy-tone.test.mjs`、`tests/vivy-tone-client.test.mjs`、`tests/laputa-panel.test.mjs`
- 验证：见 `verification.md`（语气/安装 43 项、语气卡片 5 项、人格面板 17 项；语法检查；默认语气组合哈希与已安装覆盖逐字节一致）
- 未验证：端内真实交互（运行中实例仍是旧代码，重启会终止当前回合）；真实 Superagent 提示词写入未做（不在真实状态上试写）
- 回滚：`git checkout -- plugins/dsh-vivy-tone plugins/dsh-laputa/src/client.js plugins/dsh-laputa/README.md tests/vivy-tone.test.mjs tests/laputa-panel.test.mjs && rm tests/vivy-tone-client.test.mjs`（面板重启后回到只有「人格」设置页）

## 改了什么

1. **设置页改名**：dsh-laputa 的 `settings.section` 标题与页内 `h2` 从「人格」改为「人格与语气」，只改设置页；侧边栏的「人格」面板名不变。
2. **新增可编辑的语气块**：dsh-laputa 的设置页声明子插槽 `settings.laputa.item`（single/root），dsh-vivy-tone 的浏览器半册注册语气卡片进去。两个插件不互相 import，语气卡片随 dsh-vivy-tone 消失。
3. **语气文本独立存储**：`$DSH_HOME/vivy-tone/tone.md`。`runtime/orchestrator` 由「包内固定的头 + 语气」拼成，启动安装与保存都走同一份拼接逻辑，所以重启不会把手改的语气换回默认。
4. **保存路径**：`PUT /dsh-vivy-tone/api/tone` 先读 Superagent 提示词、按 revision 拼出完整覆盖、走它自己的 `PUT /orchestrator/api/prompts`，写入成功后才落语气文件与状态哈希；写失败（含 409 冲突）不改动本地语气。
5. **接口**：`GET/PUT /dsh-vivy-tone/api/tone`，只接受本机 Host、同源写、JSON、会话校验（与 laputa 面板同一套守卫）。留空保存 = 去掉语气小节。
6. **切分而不改字**：`zh.mjs` 把原来 `runtime/orchestrator` 拆成 `ORCHESTRATOR_HEAD` + `DEFAULT_TONE`，`TRANSLATIONS` 仍由两者拼回；默认语气组合的 `sha256` 与 `installed.json` 记录一致（`7c93d057…a272`），因此**启动时不会产生新的提示词版本**。
7. **测试**：新增语气模块、保存路径、接口路由与客户端卡片的测试；laputa 面板测试补设置页改名的用例。

## 影响面

- 用户可见：更多 → 设置 →「人格与语气」；页内多一个「语气」卡片，可看、可改、可恢复默认、可留空去掉语气小节。保存后下一轮请求生效，可在 Superagent 的 Prompts 历史回退。
- 代码面：dsh-vivy-tone 新增 `tone.mjs`、`server.mjs`、`client.js`，`package.json` 增加 `dsh.client` 与 `./client` 导出；dsh-laputa 客户端约 +10/−4 行。无新依赖。
- 数据面：`$DSH_HOME/vivy-tone/tone.md`（原子写）；`installed.json` 增加保存后的哈希。
- 重启要求：**是**。新增的浏览器半册在启动时被 `dsh.client` 扫描，路由也在插件挂载时注册；客户端代码本身刷新页面即可。
- 边界：语气是 Superagent 提示词里的表达规则，不是人格正文；人格仍只由 Laputa 注入。
