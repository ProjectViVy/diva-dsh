# v0.7.0 源码安装 genui，自由 html 通道停用

- 状态：已交付（装好、真 GUI 渲出第一张 spec 卡、自由 html 开关已落；该开关要 3082 重启后才在面板里生效）
- 范围：third-party/genui（submodule + pin）、scripts/lib/third-party.mjs、scripts/setup-third-party.mjs、third-party/pins.json、tests/third-party-setup.test.mjs、plugins/dsh-daily/client.js、tests/daily-client.test.mjs
- 验证：`setup-third-party --check` 全绿；`tests/third-party-setup` 14/14；`tests/daily-client` 39/35/4/0；`npm test` 1420/1410/0/10；真 Chrome（隔离实例）渲出 742×292 的 spec 卡
- 未验证：3082 面板里的实测（拿不到 token）；`FREE_HTML_UI` 在 3082 的反向验证（要重启）
- 下一步：DV-UI-017 的下一段——Today 写 spec 文件 + 右栏渲染入口，与按天分区一起做
- 回滚：`FREE_HTML_UI` 改回 `true`；卸载 `dsh plugin --profile superagent-local remove @changfenhuang/dsh-genui`；profile 备份在 `.artifacts/backups/20261115-genui-profile/`

## 改了什么

1. **genui 作为「第三方社区插件」装进来**，不塞进 `plugins/`：`third-party/genui` 是 submodule，pin 在 tag `v0.16.0` 的 commit `9220925`；`third-party/pins.json` 新增 `genui` 条目（`upstream: vivy-dsh/dsh-genui`、`tag: v0.16.0`）。
2. **pin 校验接受第二种兼容性声明形态**：`scripts/lib/third-party.mjs` 新增 `satisfiesRange()`（`^` / `>=` / `>` / `<` / `<=` / `=`、`||`、可选 `-prerelease`），`inspectThirdPartyPlugin` 不再只认 `dsh.compatibility.dshReleases`，`engines.dsh` 也认；`describe()` 多打一行 `range:`。理由是 DSH 自己就按 `engines.dsh` 判兼容（`packages/boot/app-boot/src/plugin-compatibility.ts`），而 genui 只声明了 `engines.dsh`。**没有给 genui 打补丁。**
3. **注册流程把目录名与包名分开**：第三方仓的目录可以叫 `genui`，包名却是 `@changfenhuang/dsh-genui`。`scripts/setup-third-party.mjs` 现在从 `third-party/<dir>/package.json` 读包名去注册/核对/卸载，pins 的键仍是目录名。
4. **profile `superagent-local` 注册 genui**：`dependencies` + `dsh.profile.bundles` 各加一条，`node_modules/@changfenhuang/dsh-genui` 建到 `third-party/genui` 的 junction，`pnpm-lock.yaml` 用 `pnpm install --lockfile-only` 对齐（三处一致，`dsh plugin add` 再来一遍是幂等的）。
5. **自由 html 通道停用（可逆开关）**：`plugins/dsh-daily/client.js` 顶部加 `const FREE_HTML_UI = false`。关掉时：`splitUiFences()` 直接返回一段文字（围栏原样留在正文、不丢字、不吞后面的正文）、`TodayView` 不长 iframe、`DailyPage` 的 effect 不发 `/dsh-daily/api/today` 请求、标题条写「今天的界面 · 自由 HTML 通道已停用」。`splitUiFences` / `uiDocument` / `sandboxFrame` / CSP / 高度回报这些代码一行没删；测试里 4 条按开关 `skip`，改回 `true` 自动恢复。

## 影响面

- 用户可见：左栏不再把 `html` 围栏渲成沙箱框（当普通代码显示）；右栏 Today 不再显示 worker 写的整页 HTML，只留安静空态；`$DSH_HOME/today/<date>.html` 文件没删也没搬。
- 新增 `dsh-ui` 围栏这条通道（genui 宿主半边注入提示词 + `render_ui` 工具 + `validate_dsh_ui`；浏览器半边接管围栏渲染）。装它之前 DSH 里没有 `dsh-ui` 围栏这个概念。
- 重启要求：宿主半边已热加载（不用重启）；浏览器半边（roster）在下次页面刷新时生效；`FREE_HTML_UI` 的字节在宿主内存里缓存过，要 `npm run stop && npm start` 才换。
- 依赖：genui 的 peerDeps 钉了 `@deepseek-ai/dsh-*` 0.2.x 与 React 18/19，与当前 DSH `0.2.1-rc.5` 同代；升级 DSH 时要跟着换 tag（pins 的 `tag` 必须等于 `v<package.version>`）。

## 未验证

- **3082 面板里的实测**：3082 的面板登录要启动时打印的 token（随机、只在内存），拿不到；不能无授权登录，所以另起隔离实例（`.artifacts/dsh-verify-home`，profile `genui-verify`，端口 3083，同一份凭据与模型）做真 Chrome 验证。
- **`FREE_HTML_UI` 在 3082 的反向验证**：同上，要重启才能看到新字节；测试里 4 条 `{skip: uiOn}` 是恢复路径的守门人。
- 窄窗（<900px）与深色主题下的卡片观感：本轮只截了 1440×900 浅色。

## 备注

- 两个 URL 的关系（实测）：`vivy-dsh/dsh-genui` 是 `omdsh-dev/dsh-genui` 的 fork（GitHub API `fork: true`、`parent: omdsh-dev/dsh-genui`），fork 的 main HEAD `ae7632c` 是上游历史的后代、没有独有提交；所以「用主人给的 fork 地址 + pin 上游 tag 的 commit」是自洽的，装的仍是上游 v0.16.0 那份代码。
- 备选路线（没选）：`plugins/dsh-genui` + `scripts/setup-genui.mjs`。它符合 AGENTS.md「新插件进 plugins/」那条，但等于把不属于我们的上游代码塞进自有仓，还得多写一份 setup 脚本，成本更高。
- 为什么不用 `dsh plugin add link:` 一步到位：它在活着的 profile 上会跑 `pnpm add`，而当时 3082 正在服务主人（且控制文件写着 manually-stopped、进程却活着）。改为「改 manifest + 建 junction + `--lockfile-only` 对齐 lockfile」，不 relink 其它 20 个链接。
