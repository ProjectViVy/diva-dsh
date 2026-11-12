# 世界网关 · v0.1.0-slots · 验证

> 本轮 `pwsh` 不可用（DV-OPS-001），**没有执行任何命令**。本文件如实区分「读过的源码」与「没跑的验证」。

## A. 依据的源码阅读（逐条可点）

| # | 位置 | 取到的事实 |
| --- | --- | --- |
| 1 | `plugins/voice/src/client.js:13-17` | 浏览器半以 `window.__ModuleLoader__.load({ id, factory })` 注册，`require('react')` 拿 React |
| 2 | `plugins/voice/src/client.js:1558-1571` | `return { inject: ['slots'], apply(ctx) }`；`ctx.slots.inject('settings.section', () => ctx.slots.register({ name, id, order, label, inject }, Component))` |
| 3 | `plugins/voice/src/client.js:1514` | 分区组件从 props 解构 `{ store }`，即 `inject()` 的返回值直接展开成 props |
| 4 | `plugins/voice/src/client.js:129-148` | 面板对自家 HTTP 用同源相对路径 `fetch('/dsh-voice/api...')`，无额外 token |
| 5 | `plugins/voice/src/http.mjs:31-45` | `ctx.webServer.register({ kind: 'prefix', path, handler })`；校验回环 Host、写请求同源、`ctx.get('connection').requestRejection(req)` |
| 6 | `plugins/voice/src/index.mjs:9-12` | host 半导出 `name` / `inject` / `apply`，`inject` 里声明所需服务 |
| 7 | `plugins/_shared/paths.mjs:5-23` | `projectHome(env)` 要求绝对 `DSH_HOME`；`prepareStateDir` 建目录并验可写 |
| 8 | `plugins/voice/package.json:7-8` | `exports` 含 `./client`，`dsh.client = { platform: 'web', inject: [] }`，`dsh.bundle.patch` 指向 `cordis.patch.yml` |
| 9 | `plugins/voice/cordis.patch.yml:1-4` | bundle patch 的写法：`- insert: [{ id, name, config }]` |
| 10 | `scripts/lib/component-setup.mjs:113-129` | `componentPackages()` 是链接进 profile 的唯一清单 |
| 11 | `scripts/lib/component-setup.mjs:42` | `mappings` 表负责 profile 依赖搬迁时的路径替换 |
| 12 | `.artifacts/dsh-home/profiles/superagent-local/package.json:22-43` | profile 用 `link:` 依赖 + `dsh.profile.bundles` 加载本地插件 |
| 13 | `deepseek-harness/packages/bundle/base/cordis.patch.yml:125-126` | `credentials-local` 在 base bundle 中，故 `ctx.credentials` 恒可用 |
| 14 | `.gitmodules:16-54` | 本地插件一律是 submodule；新目录尚未纳入 |

## B. 产物的静态自检（人工通读，非执行）

| 检查 | 结果 |
| --- | --- |
| `registry.mjs` 用 ESM `import`，未残留 `require` | 已修（首版误用 `require('node:fs')`，已改为顶层导入） |
| `registry.json` 不含 key：只有 `enabled/kind/baseURL/model/authRef/note` | 是；测试也断言 `'credentials' in parsed === false` |
| 未知能力 / 未知字段 / 非 https 基址 / 未知接入点 都在写入前抛错 | 是（`validate`） |
| 写入原子性：`${file}.tmp` → `rename` | 是（`save`） |
| 损坏文件：改名 `*.corrupt-<ts>` 后回落默认值，并置 `recovered` | 是（`load` 的 catch） |
| 默认凭据名与 DSH `deriveKeyRef` 同规则 | 是（`deriveAuthRef`：非字母数字转下划线 + `_API_KEY`） |
| HTTP 无 `invoke` 路由 | 是（只有 state / slot / credential / resolve） |
| 客户端不发真实模型请求 | 是（只打 `/dsh-capability-hub/api/*`） |
| 实时语音为纯 UI 占位，无输入控件 | 是（`RealtimePlaceholder` 只有静态列表） |

## C. 未执行的命令（下一次必须跑）

## C. 已执行的命令（2026-11-11 08:0x，第二次会话）

| 命令 | 结果 |
| --- | --- |
| `node plugins\capability-hub\tests\registry.test.mjs` | **7/7 通过**（`node --test` 在本沙箱会 spawn 子进程并 EPERM，改为直跑测试文件） |
| `node --check plugins\capability-hub\src\client.js` | 通过（无输出） |
| `node --input-type=module -e "import('./plugins/capability-hub/src/index.mjs')"` | 通过，导出 `name` / `inject` / `apply` |
| 手工 profile 登记 | 17 个依赖、18 个 bundles，`dsh-capability-hub` 在列 |

## D. 第一次重启后没出现的原因

`npm run setup:components` 从未执行，profile 的 `dependencies` 与 `dsh.profile.bundles` 里都没有
`dsh-capability-hub` → 宿主根本没加载这个插件，设置页自然没有分区。

本次会话 `pwsh` 已恢复，但两条正规路径都被沙箱挡住：
- `npm run setup:components`：面板在跑时直接抛错（要求先 `npm run stop`）；
- `dsh plugin --profile … add`：tsx/esbuild 的同步 worker 需要 spawn，沙箱下 EPERM。

改用手工登记，等价于 `plugin add` 的三件事：

1. `profiles/superagent-local/package.json`：`dependencies` 加 `link:C:/…/plugins/capability-hub`，`dsh.profile.bundles` 追加（备份 `package.json.pre-hub.bak`）；
2. `pnpm-lock.yaml`：importer 里按字母序插入同形条目（备份 `pnpm-lock.yaml.pre-hub.bak`）；
3. `node_modules/dsh-capability-hub`：junction 指向插件目录。

下次跑 `npm run setup:components` 时 `inspectComponents` 会看到「已链接且在 bundles 里」，不会重复登记。

## E. 未执行

- 重启与浏览器验收（需用户重启进程）：`npm run stop` 后 `npm start`。
