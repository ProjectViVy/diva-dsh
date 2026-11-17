# 「我看到了」Python 依赖核实 · v0.3.0-python-dependency · 总结

- 目标：核实「我看到了」（`plugins/dsh-see-now`）是否真的依赖外置 Python 工具包。
- 结论：**核心「看」不依赖 Python**；只有悬浮窗、区域取框、听系统声、Linux portal/指示框用到 Python，且逐项都有「没有也能跑」的降级路径。
- 本机状态：ffmpeg 在 PATH；Python 3.13（AppData，带 tkinter + mss + numpy + Pillow）已满足悬浮窗/取框；唯一缺的是听声用的 `pyaudiowpatch`。
- 交付：`docs/research/see-now-python-dependency.md`（结论、证据表、D1–D3）。
- 本轮未改代码、未装包、未改 profile、未动 submodule。
- 未验证：沙箱拒绝 spawn python，运行期探针与 `see_now` 端到端未跑；见 `verification.md`。
