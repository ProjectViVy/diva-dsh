# dsh-see-now 安装 · v0.2.0-install · 发布

- 性质：**源码级 submodule 安装 + 本地补丁接线**；未提交（按 AGENTS.md，用户说提交才提交）。
- 来源：`https://github.com/vivy-dsh/dsh-see-now`（SAOS-3624 的 fork），pin `main@1d98dd5bf1fdcad58fbf27b6906bb8c525ccccb3`；无 tag，`package.json` 版本仍是 `0.2.3`。比 tag `v0.2.3` 多 pack 的 `maxCrop` 改动。
- 新增 / 改动：
  - `plugins/dsh-see-now/`：submodule（`.gitmodules` 新条目）；不放进 `third-party/`，因为该插件缺 `dsh.compatibility.dshReleases` 与 `lib/`，过不了本仓 pin 准入。
  - `patches/see-now-vivy-core.patch`：本地补丁，2 文件 3,949 字节。
  - `scripts/setup-see-now.mjs`：幂等应用补丁；已加 `setup:see-now` 脚本，`setup-components.mjs` 在组件注册前调用。
  - `scripts/lib/component-setup.mjs`：`componentPackages` 收 `dsh-see-now`；迁移映射也补了 `plugins/dsh-see-now`。
  - profile（本机 `.artifacts`，不入库）：`dsh-see-now` 依赖 + bundles、`node_modules` 符号链接、`pnpm-lock.yaml`。
  - `docs/logs/2026-11-see-now/v0.2.0-install/`：本四件套。
- 本地补丁内容（只两处）：
  1. `client.js`：新增 `EyeIcon`，在 `apply` 里注册 `main`（key `see-now`）与 `sidebar.panellist`（id `see-now`、order 16、label「看你看的东西」）；原 `settings.section` 不动。
  2. `test/client-wiring.test.mjs`：断言从「只注册 settings.section」改为三个槽位，并按 name 取 settings 渲染首帧。
- 可复现路径：
  1. `git submodule update --init plugins/dsh-see-now`
  2. `npm run setup:see-now`（或 `npm run setup`，会自动调用）
  3. `npm run setup:components` 会把 profile 的 link/bundle 补齐（`inspectComponents` 已返回 `missing: []`）。
- submodule 状态：HEAD `1d98dd5`，工作区有上述两个文件的本地修改；这是补丁，不是新提交。`git submodule update --checkout` 会清掉，重跑 `npm run setup:see-now` 即可恢复。
- 未提交的原因：根 `git status` 里还有别的会话的改动（AutoDream / mempalace / 文档 / 其他 submodule 指针），不能混提交；本次只落文件与接线。
- 回滚：见 `acceptance.md` 第 7 条；删除前先 rename/`git submodule deinit` 隔离，不 irreversible delete。
- 后续（未做）：
  1. 若愿意把这两处补丁推回 `vivy-dsh/dsh-see-now` 的 `main`，就能把 submodule 恢复干净、只保留 pin；现在靠根仓 patch 重放。
  2. 上游发新版时，先 rebase 这个 patch；不要直接覆盖 `client.js`。
  3. 阅读模式（C7）与三座桥（声音/听觉/身体+记忆）另立条目，不在本次安装里做。
- 风险：
  - 这是第三方 fork 被放进了本地 `plugins/` 家族；按用户 05:35 的明确指定，暂按本地插件管理，但 `.gitmodules` 的 URL 仍是 `vivy-dsh/dsh-see-now`，与 16 个本地仓的归属不同，日后若要按 `third-party/pins.json` 管，需要先补 `dsh.compatibility.dshReleases` 与 `lib/` 布局。
  - 本地补丁未进 fork，submodule 指针本身不包含侧栏入口；换机/重 clone 必须跑 setup。
  - `snapshotEvents()` 是宿主 deprecated 口子；插件缺少 `dsh.compatibility`。
  - 根仓 `npm test` 的 Windows 既有失败：1350 tests / 1230 pass / 114 fail（voice 路径、surfcore ESM、mempalace 权限/DB、component lockfile 等），仍需另行处理，不在本次改动里。
- **06:30 后续**：本文件描述的「`settings.section` 不变」已被 `v0.3.0-vivy-core` 取代；当前入口为「我看到了」，设置分区已移除。
