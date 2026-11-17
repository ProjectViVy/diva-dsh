# dsh-see-now 安装 · v0.2.0-install · 验收

安装已完成，运行期未验。重启后按顺序走；任何一步失败，先看第 6 条。

1. **启动**：`npm run restart`，等 `npm run status` 的 `runtime` 为 `ready`，硬刷新 Web GUI（`http://127.0.0.1:3082`）。若刚跑过 `git submodule update`，先执行 `npm run setup:see-now` 重打侧栏补丁（`npm run setup` 也会自动调用）。
2. **侧栏归属**：左侧出现 `VIVY心核` 分组，组内有「看你看的东西」，位置在「进化」之后；点它打开页面，不是空白/报错。若不是，先看第 6 条。
3. **设置页仍在**：设置 ›「看你看的东西」能打开，读出当前配置，保存一次再重载不报错。
4. **工具面**：新会话里 `see_now` 工具存在（`/seenow` 或工具列表能看到）；`see_now({action:"status"})` 没有 error。
5. **端到端**：
   - 2 分钟静止文档：出图 ≤ 1 张兜底图，模型能说出画面里只有图上才有的信息。
   - 2 分钟视频/幻灯片：按变化出图；模型描述与画面一致；记录每张 token、CPU、端到端时延。
   - `stop` 后不再抓屏；日志里没有屏幕原文/敏感内容。
6. **失败排查**：
   - 插件没加载：看 `%DSH_HOME%/profiles/superagent-local/cordis.yml` 是否含 `dsh-see-now`；看 `~/.dsh/see-now/plugin-error.log`；确认 profile 的 `node_modules/dsh-see-now` 链接仍存在。
   - 侧栏行在 `VIVY工具` 或不在任何组：`dsh-vivy-studio` 的 `TOOL` 白名单误命中 label；临时把 label 改成「看见世界」再试，或把该 label 从 `TOOL` 排除。
   - 面板空白：多为 `main` 槽位注册失败；看浏览器控制台是否有 `loaded without registering "dsh-see-now"`。
7. **回滚**：删 profile `package.json` 的 `dsh-see-now` 依赖与 bundles 条目，删 `node_modules/dsh-see-now` 链接；`git submodule deinit -f plugins/dsh-see-now` 后再决定是否移除 `.gitmodules` 条目、`patches/see-now-vivy-core.patch`、`scripts/setup-see-now.mjs` 与 `componentPackages` 条目；`pnpm install` 后再重启。删除前先 rename 隔离。

**通过判据**：2、3、4 全过；5 至少跑通「静止 + 视频」两段，且模型描述能对上画面。
