# 「我看到了」Python 依赖核实 · v0.3.0-python-dependency · 发布

本轮是**纯文档交付**，无代码、配置、依赖、submodule 变化。

## 交付

- `docs/research/see-now-python-dependency.md`：结论 + 证据表 + 本机核查 + D1–D3。
- `docs/logs/2026-11-see-now/v0.3.0-python-dependency/{summary,verification,acceptance,release}.md`：本四件套。
- `TODOLIST.md`：新增 DV-DOC-015（等 D1–D3）。

## 回滚

删除上述文件与 TODOLIST 条目即可；不涉及运行期状态，无需备份。

## 后续

1. 用户拍 D1–D3 后再动：窗的开关策略、`pyaudiowpatch` 是否装、setup 是否加 Python 检测。
2. 真实运行验收按 `acceptance.md` 四条走；未做之前不要对外说「已验证不需要 Python 运行期」。
