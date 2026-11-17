# 「我看到了」到底需不需要外置 Python 工具包

- 对象：`plugins/dsh-see-now`（submodule，`vivy-dsh/dsh-see-now` @ `1d98dd5`，`package.json` 0.2.3）
- 问题：另一条线在做「我看到了」，怀疑它依赖一个外置 Python 工具包。核实这个需求是否真实。
- 方式：只读本仓源码 + 本机文件核查（未改代码、未装包、未起进程）。访问日期 2026-11-13。
- 结论口径：只回答「哪些能力真的要 Python、哪些不要」，不评价上游设计好坏。

## 0. 结论

**核心「看」不需要 Python。** `dsh-see-now` 是一个 Node 插件，抓屏 → 判帧 → 拼图 → 出图整条链只 spawn `ffmpeg`；Python 只出现在五个外围件里，而且每个都有「没有也能跑」的降级路径：

| # | 能力 | 真进程 | 依赖 | 缺了会怎样 | 必须？ |
| --- | --- | --- | --- | --- | --- |
| 1 | 抓屏 / 摄像头 / 视频 / portal 帧 | `ffmpeg`（`src/capture.js`，唯一 spawn 点） | ffmpeg 二进制 | 整个「看」不可用 | 是（但**不是 Python**） |
| 2 | 判帧、拼图、PNG、token 估算 | 纯 JS（`pipeline.js` / `pack.js` / `png.js` / `tokens.js`） | 无 | — | — |
| 3 | 悬浮窗（`say`、打字、关窗=不看） | `examples/floating-chat/window.py`（Python + Tk） | Python ≥3.8 + `tkinter` + `mss` + `Pillow` + `numpy` | 窗打不开，`watch` 照常出图；`say` 石沉大海 | 否（`DSH_SEE_NO_WINDOW=1` 可完全关掉） |
| 4 | 区域取框（`region`） | `pick_region.py`（Python + Tk） | Python + `tkinter` | 只有取框不可用 | 否 |
| 5 | 听系统声（`台词`） | `listen.py`（Python） | Windows：`pyaudiowpatch` + `numpy`；Linux：`numpy` + `ffmpeg` | `status` 显示「没在听」，画面照旧 | 否（`DSH_SEE_AUDIO=0`） |
| 6 | Linux Wayland 采集 | `portal_stream.py`（Python） | `python3-gi`（PyGObject）+ `gstreamer` + `gst-plugin-pipewire` | portal 源起不来 | 仅 Linux |
| 7 | Linux 指示框（光晕/状态条） | `indicator.py`（Python） | `PySide6` | 「采集照旧，只是没有光晕」 | 否（`SEE_NOW_INDICATOR=0` 等价） |

补充两条容易误判的：

- **OpenCV / moderngl 不是依赖。** `glass_capture.py` / `glass_cpu.py` 里是 `try: import cv2 except: _cv2 = None`，缺了走 PIL；`glass_gpu.py` 只在 `DSH_GLASS_GPU=1` 时用。
- **`DSH_SEE_NO_WINDOW=1` 时连 Python 都不 spawn**（`src/window.js:326/551/598`，`src/runner.js` 的 `ensureWindow` 直接返回 `{ok:false, reason:'disabled'}`）。

**本机核查结果**（`C:\Users\Administrator\AppData\Local\Programs\Python\Python313`）：

- `ffmpeg` 在 PATH：`…\WinGet\Links\ffmpeg.exe` → 第 1 项已满足，且 `$DSH_HOME/tools/ffmpeg` 不存在时按 PATH 兜底。
- Python 3.13 带 `_tkinter.pyd` + `tcl/` + `Lib\tkinter`，且已装 `mss`、`numpy`、`Pillow` → 第 3、4 项条件已满足（文件级）。
- 未装 `pyaudiowpatch`、`PySide6`、`opencv`、`moderngl` → 第 5 项缺一个 pip 包；第 7 项与本机无关（Linux）；OpenCV/moderngl 可省。
- `python3` 在 PATH 上指向 `WindowsApps\python3.exe`（App Execution Alias，`window.js` 明确绕开它，只在非 Windows 用 `python3`）；本机 `python`/`pythonw` 指向真实 3.13 → 候选顺序不会踩到 Store 别名。

## 1. 证据（代码位置）

- 唯一 spawn ffmpeg：`plugins/dsh-see-now/src/capture.js`（文件头注释写明「唯一 spawn ffmpeg 的地方」）；找 ffmpeg：`src/binaries.js:26-42`。
- 悬浮窗：`src/window.js:595 openWindow()`；`pythonProbe` 真跑一次 `import tkinter`（`window.js:455`）；缺包探测只查 `PIL/mss/numpy`（`window.js:724-732`）。
- 窗打不开不算失败：`src/runner.js:897-926`「开不起来不算失败：模型照样能 watch，只是用户只能等下一轮」；`watch` 里 `ensureWindow()` 失败后继续（`runner.js:1127`）。
- 取框：`src/region.js:105-113` 逐候选试 `hasTkinter`，全失败返回 `no-python`，只影响 `action:"region"`。
- 听声：`src/listen.js:540-560 canListen()`、`1071-1082` 缺 Python/pyaudiowpatch 时降级为「没在听」；`index.js:342` 注释「是没转写服务、没 Python 包…答案全在这一行」。
- Linux：`src/portal-capture.js:40-67`（PyGObject/gstreamer 装包提示、worker 固定系统 `python3`）；`src/runner.js:712-738` 指示框失败只记一条日志。
- 可选加速：`examples/floating-chat/glass_capture.py`、`glass_cpu.py`、`glass_gpu.py` 的 `try/except` 导入。

## 2. 本机文件级核查（观测）

| 检查 | 命令 / 路径 | 结果 |
| --- | --- | --- |
| Python 解释器 | `Get-Command python/pythonw/python3` | `python` → `…\Python313\python.exe`；`pythonw` → 同目录；`python3` → WindowsApps 别名 |
| tkinter | `…\Python313\DLLs\_tkinter.pyd`、`…\tcl\`、`Lib\tkinter\__init__.py` | 三者都在 |
| 悬浮窗三件套 | `Lib\site-packages` | `mss`、`numpy`、`PIL` 都在（`mss-10.2.0`、`numpy-2.4.4`、`pillow-12.2.0`） |
| 听声 | 同上 | **无 `pyaudiowpatch`** |
| Linux 专属 | 同上 | 无 `PySide6`（本机 Windows，不需要） |
| ffmpeg | `Get-Command ffmpeg` | `…\WinGet\Links\ffmpeg.exe` |
| DSH 自带 ffmpeg | `$DSH_HOME/tools/ffmpeg/bin` | 不存在 → 走 PATH |
| 运行痕迹 | `$DSH_HOME` 下 `see-*`、`~\.dsh` 下 `see-*` | 全无 → 插件装好后**从未真正跑过一次** |

## 3. 限制（未验证）

- 沙箱（workspace-write）下任何 `spawn python` 都被命名管道拒绝，**没有真跑过** `python -c "import tkinter,mss,numpy,PIL"`；上面是文件级证据，不是运行证据。
- 同理，`npm run restart` 后的真实 `see_now` 端到端（出图 → tool result image）未验；插件测试里的 21 个 skip 很可能正是沙箱挡 spawn 造成的（`window.test.mjs:123-125`、`picker.test.mjs`）。
- DSH 服务进程自身 PATH 是否包含 `…\Python313`（而不是只有当前 shell 有）未验；这决定悬浮窗在真实运行期能否被拉起。
- 上游 `window.py` 已由 `scripts/sync-window.mjs` 生成进包内（`examples/floating-chat/window.py`，2305 行），**不需要另外安装 `dsh-watch-together`**；但不排除那条线指的是别的东西（见 §5 问句）。

## 4. 对「我看到了」这条线的含义

1. **如果目标只是「她能看见屏幕并说出来」**：现有条件已经够，不需要装任何 Python 包；重启后先验 `see_now` + `/seenow`。缺的只有运行期验收。
2. **如果要原版体验（悬浮窗、能打字、`say`、关窗即不看）**：需要 Python + Tk + `mss`/`Pillow`/`numpy` —— 本机已在，只差一次真实启动验证（本会话被沙箱挡住）。
3. **如果要听系统声**：只差 `pip install pyaudiowpatch`（`numpy` 已有）。这是**唯一**一个本机确实缺的 Python 包。
4. **如果那条线打算用 Python 做 OCR / 图像理解 / 自动化**：那不是 see-now 的需求，属于另一类「理解层」，不要记到它头上。

## 5. 决策清单（不拍板不实施）

| 编号 | 要拍的 | 选项 | 推荐 | 影响面 |
| --- | --- | --- | --- | --- |
| D1 | 悬浮窗要不要 | A 要（用现成 `window.py`）；B 不要（`DSH_SEE_NO_WINDOW=1`，只留 Web 面板）；C 重写成 Web 窗 | **A**（本机条件已齐，先验一次） | 决定 Python 是否留在链路上 |
| D2 | 听声要不要 | A 装 `pyaudiowpatch` 并接 `speechToText`；B 不做 | 先接宿主 `speechToText`，**A 作为可选** | 一个 pip 包 + ASR 服务 |
| D3 | 是否把 Python 检查写进 setup | A 只加一条 `npm run check:python` 提示；B 自动装；C 不管 | **A**（只检测、不自动装，符合本仓「不偷偷装依赖」） | 启动器改动很小 |

> 不拍板不实施：本文件不改任何代码、不装包、不动 profile。

## 6. 参考

- `plugins/dsh-see-now/README.md:185-250`（各平台依赖表）、`:353-406`（听声与关闭方式）
- `plugins/dsh-see-now/src/{capture,binaries,window,region,listen,runner,index,portal-capture}.js`
- `plugins/dsh-see-now/examples/floating-chat/window.py:75-135`（依赖预检与 glass 可选件）
- `docs/research/dsh-see-now-assessment.md` §C3（本仓此前的同一结论：核功能不依赖悬浮窗）
- `docs/logs/2026-11-see-now/v0.2.0-install/verification.md`（安装期核查：ffmpeg 在 PATH、Python 3.13 存在、沙箱挡 spawn）
