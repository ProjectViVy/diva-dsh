# v0.0.1-dsh-context 验证记录

环境：Windows，Node v24.14.1，git 2.53.0，本机 DSH `0.2.1-rc.5`，profile `superagent-local`（17 bundles），项目自带 pnpm v11.28.5。

## 一、锚定与构建

| # | 命令 | 期望 | 实际 |
| --- | --- | --- | --- |
| 1 | `git add --depth 1 <url> third-party/dsh-context` + `fetch tag v0.83.1` + `checkout --detach` | 落在 tag 上 | ✅ `HEAD is now at a37a72c chore(release): 0.83.1` |
| 2 | `git rev-parse HEAD` | `a37a72c…` | ✅ `a37a72cb22481cfd101fb00e390e291cb03ded8b` |
| 3 | `git describe --tags` | `v0.83.1` | ✅ `v0.83.1` |
| 4 | `pnpm install --frozen-lockfile` | 锁文件不漂移 | ✅ exit 0，`Done in 10.6s`（`prepare: husky && tsdown` 一并跑通） |
| 5 | `pnpm run build` | 产出 host + client 两半 | ✅ exit 0，`lib/index.js` 182.93 kB、`lib/index.d.ts`、`lib/client.js` 942.91 kB |
| 6 | 读 `package.json` 的 `dsh.compatibility.dshReleases` | 覆盖 `0.2.1-rc.5` | ✅ `{0.2.0-rc.2+, 0.2.1-rc.2+, 0.2.2-rc.1+}` 三个都标 `compatible`；`engines.dsh` 同区间 |

## 二、校验脚本

| # | 命令 | 期望 | 实际 |
| --- | --- | --- | --- |
| 7 | `node scripts/setup-third-party.mjs --check` | pin/构建/兼容三项过，只报未注册；退出 1 | ✅ 打印 `pin: v0.83.1`、`checkout: 0.83.1`、`DSH: 0.2.1-rc.5`、`declares: …`，然后 `dsh-context is not registered in superagent-local.`，退出 1 |
| 8 | 面板运行中执行注册 | 主动拒绝 | ✅ 未执行（脚本在 `--check` 之后、写之前就 `await state()` 判活并抛错），符合 `setup-vivy-tone` 同约定 |

`--check` 是只读路径，面板运行中可安全反复跑；这是本轮唯一能在线验的部分。

## 三、测试

| # | 命令 | 结果 |
| --- | --- | --- |
| 9 | `node --test tests/third-party-setup.test.mjs` | ✅ 10/10 pass |
| 10 | `node --test tests/*.test.mjs` | ⚠️ **1122 pass / 289 fail** |

第 10 条说明：

- 失败集中在 `surfcore-loader` 的 `ERR_UNSUPPORTED_ESM_URL_SCHEME`、ASR 挂载探测、component relocation、QQ/B站 alignment、`paths default inside the project home…` 等**既有失败**，与 `docs/logs/2026-11-launcher-env/v0.0.1-temp-and-skills/summary.md` 记录的现象同类。
- 归因依据：`tests/*.test.mjs` 中除新加的 `third-party-setup.test.mjs` 没有任何文件 import `scripts/lib/third-party.mjs` 或 `scripts/setup-third-party.mjs`（grep 确认为 `none`）；`third-party` 目录只被新脚本和新测试引用；没有任何测试枚举 `.gitmodules`。
- **未逐条证明 289 条与基线完全一致**（没有为对照而回退工作树）。只证明：本改动没有进入任何失败用例的调用链。

## 四、客户端依赖存在性

| # | 检查 | 实际 |
| --- | --- | --- |
| 11 | `dsh-client-ui-sidebar-right` 是否在运行时模块图里 | ✅ 存在：`deepseek-harness/packages/client/ui-chat/node_modules/@deepseek-ai/dsh-client-ui-sidebar-right`，且 `deepseek-harness/node_modules/.pnpm` 内有同名包 |
| 12 | profile 顶层是否有 `@deepseek-ai/*` | ❌ 没有（profile 只 link 我们自己的包）；`dsh-session` 等 peer 由宿主解析，与 `dsh-vivy-tone`/`dsh-live2d` 同机制 → 端内是否真加载只能重启验 |

## 五、本轮修掉的问题

第一次跑测试时 `parseVersion` 的断言写成 `pre: ['rc', 5]`（数字），实际返回 `['rc', '5']`（字符串，semver 比较需要保留原文）。**改的是断言，不是实现**——实现里对数字段做了 `/^\d+$/` 判定，转字符串是正确的。
