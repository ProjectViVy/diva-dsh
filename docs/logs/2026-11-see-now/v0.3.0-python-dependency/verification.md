# 「我看到了」Python 依赖核实 · v0.3.0-python-dependency · 验证

只写命令/路径、预期、实际；结论引用 `docs/research/see-now-python-dependency.md`。

| # | 检查 | 命令 / 路径 | 预期 | 实际 |
| --- | --- | --- | --- | --- |
| 1 | 抓屏是否用 Python | 读 `plugins/dsh-see-now/src/capture.js` 头注释与 `src/binaries.js` | 只有 ffmpeg | `capture.js` 自述「唯一 spawn ffmpeg 的地方」；`binaries.js:26-42` 找 ffmpeg |
| 2 | Python 出现在哪些文件 | `grep -i "python\|\.py"`（见 verification 记录） | 外围件 | `window.js`（窗）、`region.js`（取框）、`listen.js`（听声）、`portal-capture.js` + `indicator.js`（Linux） |
| 3 | 窗失败是否致命 | 读 `src/runner.js:897-926,1127` | 不致命 | 注释与代码均为「开不起来不算失败，模型照样能 watch」 |
| 4 | 是否有全局关闭开关 | `src/window.js:326,551,598` | 有 | `DSH_SEE_NO_WINDOW=1` 直接不 spawn |
| 5 | 解释器 | `Get-Command python/pythonw/python3` | 真实 3.13 | `python`/`pythonw` → `…\Python313\`；`python3` → WindowsApps 别名 |
| 6 | tkinter | `…\Python313\DLLs\_tkinter.pyd`、`…\tcl\`、`Lib\tkinter\` | 存在 | 三者都在 |
| 7 | 悬浮窗三件套 | `Lib\site-packages` | mss/numpy/PIL | 都在（mss-10.2.0、numpy-2.4.4、pillow-12.2.0） |
| 8 | 听声依赖 | 同上 | pyaudiowpatch | **缺** |
| 9 | Linux 依赖 | 同上 | PySide6 | 缺（本机 Windows，不需要） |
| 10 | cv2/moderngl | 读 `glass_capture.py` / `glass_cpu.py` / `glass_gpu.py` | 可选 | `try: import cv2 except: None`，走 PIL 兜底 |
| 11 | ffmpeg | `Get-Command ffmpeg`；`$DSH_HOME/tools/ffmpeg/bin` | 可找到 | PATH `…\WinGet\Links\ffmpeg.exe`；DSH 自带目录不存在 |
| 12 | 运行痕迹 | `$DSH_HOME\see-*`、`~\.dsh\see-*` | 有日志/配置 | 全无 → 安装后从未真正运行 |
| 13 | 真实 spawn python | `python -c "import tkinter,mss,numpy,PIL"` | 输出各版本 | **失败**：沙箱 `\\.\pipe\LOCAL\dotnet_*` 拒绝（`[sandbox: file access denied under workspace-write mode]`） |

## 未验证（不要当已验证）

- 解释器真实可导入 `tkinter`/`mss`/`numpy`/`PIL`（仅文件级证据）。
- DSH 服务进程 PATH 是否包含 `…\Python313`（决定运行期窗能否拉起）。
- `see_now` 端到端出图 → tool result image。
- 插件测试 21 skip 是否由沙箱挡 spawn 造成（`window.test.mjs:123-125`、`picker.test.mjs`）。
