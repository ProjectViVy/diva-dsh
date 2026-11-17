# 验证记录 v0.7.0-genui-install

> 只写事实：命令、预期、实际。

| # | 命令 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node scripts/setup-third-party.mjs --check` | exit 0，三个条目（dsh-context / genui）都 ready | 「All third-party plugins are pinned, built and registered.」；genui 显示 `pin v0.16.0`、`checkout 0.16.0`、`DSH 0.2.1-rc.5`、`declares engines.dsh`、`range ^0.2.0-rc.1 \|\| ^0.2.1-rc.1 \|\| ^0.2.2-alpha.2` |
| 2 | `node --test tests/third-party-setup.test.mjs` | 14 项全过 | 14 tests / 14 pass / 0 fail |
| 3 | `node --test tests/daily-client.test.mjs` | 无失败；停用期间 4 条 html 通路用例 skip | 39 tests / 35 pass / 4 skip / 0 fail |
| 4 | `node --test tests/*.test.mjs`（`npm test`） | 0 失败 | 1420 tests / 1410 pass / 0 fail / 10 skip，exit 0（10 skip = 本轮 4 + 既存 6） |
| 5 | 真 Chrome 打开隔离实例 3083、发一句要卡片的 prompt | 出现 `.genui-dom-fence`，正文里没有围栏代码 | 3 秒完成；`.genui-dom-fence` **742×292**；标题「今天三件事」+ 三条要点 + bars 图（写作 6 / 调试 3 / 复盘 2）；`pre` 里的围栏被替换掉；console 一行 `[genui] client active; fence-channel=dom`；`pageerror` 0 |
| 6 | 不重启宿主注册 genui，然后只刷新页面 | roster 里出现 genui，客户端半边日志出现 | 刷新前 `window.__DSH_BOOT__` 的 id 集合里没有 genui、console 无 genui 日志；运行中 `dsh plugin add link:…/third-party/genui` + 刷新后：id 集合含 `@changfenhuang/dsh-genui`，console 两次 `[genui] client active; fence-channel=dom` |
| 7 | `git -C <profile> diff` 备份 vs 现在 | 只多 genui 两行 | 只在 `dependencies` 末尾多一条 `@changfenhuang/dsh-genui`、`bundles` 末尾多一条同名项；`pnpm-lock.yaml` +3 行 |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| 3082 面板里的实测 | 面板 token 每次启动随机、只在内存里，非授权客户端拿不到；本会话不能无授权登录主人的面板 | 主人硬刷新面板后看一眼左栏卡片；或下次重启后由面板自己验证 |
| `FREE_HTML_UI` 在 3082 生效 | 宿主把 client bundle 读进内存，改文件不换字节 | 主人同意重启时（`npm run stop && npm start`，面板会断十几秒） |
| 深色主题 / 窄窗卡片观感 | 本轮只取 1440×900 浅色一张 | 观察项 |

## 反向验证

- 停用的证据：`tests/daily-client.test.mjs` 里「停用期间 html 围栏当成原文：不长 iframe，字一个不丢」「停用期间右栏不再向宿主要今天那一页」两条只在 `FREE_HTML_UI === false` 时跑；改成 `true` 会立刻红，说明开关真的两侧都管。
- 回滚证据：开关是常量而不是删代码；4 条 `{skip: uiOn}` 用例即恢复后的验收条件。
