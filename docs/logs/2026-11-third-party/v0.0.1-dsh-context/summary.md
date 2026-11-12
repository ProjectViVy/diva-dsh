# v0.0.1-dsh-context 第三方插件源码目录与首个插件

- 状态：done（**已注册，待重启验收**）
- 范围：`third-party/dsh-context`（新 submodule）、`third-party/pins.json`（新）、`scripts/lib/third-party.mjs`（新）、`scripts/setup-third-party.mjs`（新）、`tests/third-party-setup.test.mjs`（新）、`package.json`（+1 script）、`.gitmodules`（自动）
- 验证：见 `verification.md`（针对性 10 项 + pin 校验 + 全量测试基线对照）
- 已注册：2026-11-11 08:02，**在面板运行中直接注册**（用户选择，偏离 `setup:*` 的「先停面板」约定，见「备注」）
- 未验证：重启后的端内面板与 `/context` 命令
- 回滚：`npm run setup:third-party -- --remove`（面板停机）+ 删三个脚本与测试；submodule 用 `git submodule deinit -f` + `git rm`；`pins.json` 删条目

## 改了什么

1. **`third-party/` 作为第三方社区插件的源码级家**，与 `plugins/`（我们自己的仓）、上游三仓分开。每个插件一个 submodule，检出到上游 tag 而不是 `main`：本轮 `dsh-context` → `v0.83.1`（commit `a37a72cb22481cfd101fb00e390e291cb03ded8b`），`--depth 1`。
2. **锚定不是写进注释，而是被校验**。`third-party/pins.json` 记 tag；`scripts/lib/third-party.mjs` 做三向核对：
   - pin 的 tag 与磁盘上检出的 `package.json` 版本必须一致（漂到 `main` 就报 `pin:` 失败）；
   - 插件自述的 `dsh.compatibility.dshReleases`（如 `0.2.1-rc.2+`）必须覆盖本机实际 DSH 版本（读 `deepseek-harness/package.json`，本轮 `0.2.1-rc.5`）；约束形式不认识就抛错，不猜；
   - `lib/index.js` 与 `lib/client.js` 必须存在。上游 `.gitignore` 排除了 `lib/`，所以源码级检出必须构建一次。
3. **`scripts/setup-third-party.mjs`** 复用既有约定：`--check` 只读（面板运行中也能跑）、`--build` 强制重建、`--remove` 注销、默认「缺产物就构建 → `dsh plugin --profile superagent-local add link:<dir>` → 用 `inspectComponents` 复核依赖与 bundles」。
4. **新增插件只需两处编辑**：加 submodule + 在 `pins.json` 加一条；脚本按 pin 文件遍历，不为每个插件写一个 setup。

## 影响面

- 用户可见行为：重启后「设置」出现 Context 面板，`/context` 命令可用（未验收）。
- 构建产物：`third-party/dsh-context/lib/`（`index.js` 182.93 kB、`client.js` 942.91 kB），被上游 `.gitignore` 覆盖，不入库；新克隆需跑一次 `npm run setup:third-party` 自动构建。
- 依赖方：无。没有任何既有脚本 import 新模块；`npm test` 自动纳入新测试文件。
- 重启要求：**是**（profile 注册与客户端 bundle 都只在进程启动时读取）。

## 未验证

1. **注册本身**：脚本在面板运行时会主动拒绝（与 `setup-vivy-tone` 同约定），而本会话正是该面板托管的，停面板即终止本回合。
2. **客户端半能否被 web shell 加载**：插件声明 `dsh.client.inject` 六个 `@deepseek-ai/dsh-client-*`；已确认 `dsh-client-ui-sidebar-right` 存在于 `deepseek-harness/packages/client/ui-chat` 的依赖图，但 profile 的 `node_modules` 没有 `@deepseek-ai/*` 顶层目录（peer 由宿主解析），端内是否真加载只能重启看。
3. `/context` 的输出与我们 `dsh-local-memory` 的压缩阈值设置是否一致，未比对。
4. 构建期 `prepare: husky && tsdown` 在无 git hooks 权限的机器上是否会失败，未测。

## 备注

- 构建用项目自带 `pnpm`（`.artifacts/tools/node_modules/pnpm`，v11.28.5），`install --frozen-lockfile` 10.6s + `build` 2.6s。
- 本轮 `pwsh` 需要绕过旧进程遗留的 `TMP`（仍在 `.artifacts/tmp`）；权限模式转为 `danger-full-access` 后恢复可用。这与 `DV-OPS-001` 的临时根修复不冲突——那条修复只在新进程生效。
- **注册时偏离了自家约定**：用户判断「再跑三条命令」不划算，选择在面板运行中直接注册。用 `.artifacts/register-third-party.mjs`（一次性，`gitignored`）直接调 `dsh plugin --profile superagent-local add link:.../third-party/dsh-context`，绕开 `setup-third-party.mjs` 的 `state()` 停面板检查。注册结果与脚本路径一致（`dependencies` + `bundles` + `node_modules` 三处齐全），`--check` 退出 0。
- **副作用**：那次 pnpm 把 `dsh-capability-hub` 移到 `node_modules/.ignored/dsh-capability-hub`，理由是「不在依赖树、pnpm 无安装记录」。它本来就在 profile 清单和 bundles 里（`DV-DOC-008` 的产物），最终仍是可用链接；`.ignored/` 下留了一份副本未删（可回滚，不参与加载）。
- 按 `AGENTS.md` §6 未提交。
