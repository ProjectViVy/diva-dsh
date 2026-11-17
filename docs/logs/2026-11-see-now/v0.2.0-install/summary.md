# dsh-see-now 安装 · v0.2.0-install · 总结

- 目标：把 `dsh-see-now` v0.2.3 安装进 `superagent-local`，侧栏入口归到 `VIVY心核`，设置页保留。
- 来源（05:35 改线）：canonical 改为 `https://github.com/vivy-dsh/dsh-see-now`（SAOS-3624 的 fork，无 tag），**pin `main@1d98dd5bf1fdcad58fbf27b6906bb8c525ccccb3`**；`package.json` 版本仍是 `0.2.3`，但比 tag `v0.2.3` 多了 pack 的 `maxCrop` 改动（默认一格不裁），对 C7 可读性有利。
- 落点：`plugins/dsh-see-now/` **submodule**（`.gitmodules` 新增条目；不放进 `third-party/`，该插件缺 `dsh.compatibility.dshReleases` 与 `lib/`，过不了本仓 pin 准入）。
- 接线：
  1. profile `package.json` 增 `dsh-see-now: link:C:/Users/Administrator/Desktop/diva-dsh/plugins/dsh-see-now`，`dsh.profile.bundles` 增 `dsh-see-now`（在 `dsh-mempalace` 之后、`dsh-surfcore-adapter` 之前）。
  2. `node_modules/dsh-see-now` 符号链接 → `..\..\..\..\..\plugins\dsh-see-now`；`pnpm install` 更新 `pnpm-lock.yaml`，`dsh plugin … list` 已见 19 个包。
  3. 仅客户端增加两处注册：`main`（key `see-now`）与 `sidebar.panellist`（id `see-now`、order 16、label「看你看的东西」、眼睛图标）；`settings.section`（order 43）保持不变。`dsh-vivy-studio` 的分组按可访问名判定，该 label 不在 `TOOL` 白名单里，因此归 `VIVY心核`。
  4. 这两处不改在 submodule 的提交里，而是根仓 `patches/see-now-vivy-core.patch` + `scripts/setup-see-now.mjs` 幂等应用；`setup:see-now` 脚本已加，`setup-components.mjs` 会在组件注册前调用它。`scripts/lib/component-setup.mjs` 的 `componentPackages` 已加入 `dsh-see-now`，`npm run setup` 会补 profile 的 link/bundle。
- 测试：插件自带 `node --test` → **503 tests / 482 pass / 0 fail / 21 skipped**（首跑因上游测试断言「只注册 settings.section」失败 2 条，已按本地补丁更新断言后通过）；客户端槽位探针单独通过；`node scripts/setup-see-now.mjs` 幂等通过；`inspectComponents` 返回 `missing: []`、`cutoverReady=true`。
- 结论：**安装、接线、源码级 submodule、补丁可复现性都已完成；尚未重启，运行期未验证，不标 done。**
- 未验证：重启后插件能否加载（bundle patch / peer 解析）、侧栏行是否真的落在 `VIVY心核`、设置页与面板的 fetch、`see_now` 端到端抓屏出图、Python 悬浮窗依赖。
- 下一步：`npm run restart` + 硬刷新，按 `acceptance.md` 走 1–6，把结果回填 `verification.md`。
- **05:45 补记（入口语义）**：原版日常 UI 是 `examples/floating-chat/window.py` 的桌面悬浮窗——Python/Tk 独立进程，不是 DSH Web 面板，也不是另一个插件；`client.js` 原本只注册 `settings.section`。我加进侧栏的 `main` / `sidebar.panellist` 指向设置页，所以「看你看的东西」现在是设置表单。入口形态待定：启动器页 / 仅保留设置 / 去掉侧栏入口。
- **06:30 后续**：入口已按用户决定改为 **「我看到了」** 管理面板，并移除 `settings.section`；详见 `docs/logs/2026-11-see-now/v0.3.0-vivy-core/`。本文件保留安装阶段事实，不再代表当前 UI。
