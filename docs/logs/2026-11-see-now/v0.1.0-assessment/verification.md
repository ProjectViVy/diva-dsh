# dsh-see-now 评估 · v0.1.0-assessment · 验证

只写命令、预期、实际。所有命令在 `C:\Users\Administrator\Desktop\diva-dsh` 或插件 checkout 下执行。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `git clone --depth 1 https://github.com/SAOS-3624/dsh-see-now.git .workspace/dsh-see-now` | 得到源码 | 失败：`git.exe` 访问 `\\.\pipe\LOCAL\dotnet_…` 被 workspace-write 沙箱拒绝；未重试 |
| 2 | `curl.exe -L -o .workspace/dsh-see-now.zip …` | 下载 zip | 失败：`curl.exe` 同样被命名管道拒绝 |
| 3 | `node -e "https.get('https://codeload.github.com/…/zip/refs/heads/main', …)"` | 用 Node 下载 | 成功：HTTP 200，文件 8,733,128 字节 |
| 4 | `Expand-Archive` 解压 | 得到源码 | 成功：`.workspace/dsh-see-now/dsh-see-now-main/` |
| 5 | 读 `package.json` / `dsh.plugin.json` / `cordis.patch.yml` / `src/define-tool.js` / `src/tool-spec.js` / `src/binaries.js` / `src/index.js` / `client.js` | 核对版本、接缝、路径 | 版本 `0.2.3`；peer `@deepseek-ai/dsh-tools >= 0.1.0-rc.7`；`inject=['tools','attachments','sessionController']`；`saveImage`；`agent.followup/steer`；`image/offload`；`$DSH_HOME` 优先 |
| 6 | `node --test`（插件目录，两次） | 跑仓库测试 | 失败（两次）：`node.exe` 访问 `\\.\pipe\LOCAL\dotnet_…` 被沙箱拒绝；输出文件未生成。**未取得测试结果** |
| 7 | `node -e "console.log(require('./deepseek-harness/package.json').version)"` | 本仓 DSH 版本 | `0.2.1-rc.5` |
| 8 | 读 `deepseek-harness/packages/core/tools/package.json` | `dsh-tools` 版本 | `0.2.1-rc.5`，满足插件 peer 下限 |
| 9 | `read_image` 读插件 README 截图 | 看到演示图 | 04:05 失败：`model "deepseek-v4.1-flash" does not declare image input`；04:12 补 `input` 后由第 19 条覆盖为成功 |
| 10 | 读 `deepseek-harness/packages/llm/llm-pi-ai/src/config.ts` | 默认模态 | `DEFAULT_INPUT = ['text']`；profile 的 model 未写 `input` → 默认 text |
| 11 | 读 profile `cordis.patch.yml` 与 `package.json` | 当前模型与 bundles | `opendesign/deepseek-v4.1-flash`；bundles 含 16 个本地包 + `dsh-context`，**不含 dsh-see-now** |
| 12 | `Get-Command ffmpeg` | 找到 ffmpeg | `C:\Users\Administrator\AppData\Local\Microsoft\WinGet\Links\ffmpeg.exe` |
| 13 | `python -c "import tkinter, mss, PIL, numpy"` | 检查悬浮窗依赖 | 失败：`python.exe` 被同一命名管道拒绝；**依赖是否存在未验证** |
| 14 | `GET registry.npmjs.org/dsh-see-now/latest` | npm 版本 | `0.2.2`，tarball 87 文件，Apache-2.0 |
| 15 | `GET api.github.com/repos/…/tags` | 版本列表 | `v0.0.2`–`v0.2.3`；`v0.2.3` = `7270d85`，`main` 已在其后 |
| 16 | 读 `scripts/lib/third-party.mjs`、`third-party/pins.json` | 我们的第三方准入 | 需 `dsh.compatibility.dshReleases` + `lib/index.js` + `lib/client.js`；see-now 三者都不满足 |
| 17 | 读 `plugins/asr`、`plugins/voice` 的接缝 | 能否直接复用 | ASR 不注册 `ctx.speechToText`（只有自家 HTTP）；voice 是 voxd `/v1/speak/file`，see-now 要 `voice.json` adapter → 需桥 |
| 18 | 读 profile `cordis.patch.yml`（04:12） | 模型声明 image | `opendesign.models[deepseek-v4.1-flash]` 已有 `input: [text, image]`（用户 04:12 前补） |
| 19 | `read_image` 读 `docs/images/debug-window.png`、`scene-mode.png`、`floating-window.png`（04:12） | 能读到图 | **成功**：三张图均返回图像，分别 1190×725、1190×725、1150×760。C1 的「模型层拒收」关闭 |
| 20 | 观察逐场景图（04:12） | 4 帧拼图清晰度 | 4 帧 2×2，每格约 400×225，画面发糊；画布「占用 50%」，下半空但 token 按整张算；预估 216 token |

## 结论对应的证据

- **有意义**：`src/cuts.js` / `src/pipeline.js` / `src/pack.js` / `src/tokens.js` 的选帧-拼图-token 三段是完整的；`image/offload` 与 README 的前缀缓存分析说明作者理解长会话的真实成本；`loop.js` 的 `followup`/`steer` 与 rc.5 接缝一致。
- **只是眼睛**：`tool-spec.js` 的返回是 `text` + `images[]`，没有记忆写入、没有 Live2D/人格钩子；`voice.js` 是可选 adapter。
- **模型层已通**（04:12）：第 18/19 条——`input: [text, image]` + `read_image` 三张图成功；剩余是 `see_now` 交付链路的端到端复验。
- **可读性是真问题**（04:12）：第 20 条——4 帧拼图每格约 400×225，读屏幕小字会糊；需要「阅读模式」。

## 未验证（不得写成「没问题」）

- `see_now` 端到端：`attachments.saveImage` → tool result image → llm 请求（`read_image` 通过不等于这条链通过）。
- Python 悬浮窗依赖、Windows 音频回环、真实抓屏与 ffmpeg 参数。
- 插件在本 profile 的安装、工具注册、`/seenow` 命令、设置页路由。
- 仓库测试（沙箱拒绝子进程命名管道）；macOS/Linux 行为。
- 主观视觉效果：04:12 已能读三张 README 图，但没跑过真实 `see_now` 的在线画面。
