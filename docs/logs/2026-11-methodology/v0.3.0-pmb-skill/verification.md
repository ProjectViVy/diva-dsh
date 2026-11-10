# 验证记录 v0.3.0

> 只写事实：命令、预期、实际。

| # | 检查 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `skills/more-faster-better-economical/SKILL.md` 字节数 | 6158（等于上游 blob） | **6158** |
| 2 | `LICENSE` 字节数 | 1063（等于上游 blob） | **1063** |
| 3 | frontmatter `name` | 与目录名一致 | `name: more-faster-better-economical`，目录同名 |
| 4 | 与既有技能同构 | 同目录、同 frontmatter 形状 | 与 `skills/diva-dream/SKILL.md` 一致（`---` 开头、`name` + `description`） |
| 5 | `(Get-Content AGENTS.md).Count` | ≤160 行 | **91 行** |
| 6 | 注入验证 | 改写后被 DSH 重新注入 | 编辑后本会话立刻收到 “Updated instructions from: AGENTS.md”，含新增两段 |
| 7 | 无改动上游内容 | 逐字复制 | 正文与 frontmatter 未改；仅在文件夹内附加上游 MIT LICENSE |

## 跑不了的验证

| 项 | 原因 | 何时补 |
| --- | --- | --- |
| `skill` 工具按名加载 `more-faster-better-economical` | 本会话的技能清单在启动时固定，新增文件不在其中；`skill` 工具只认已注册的名字 | 新开会话时 |
| 规则被遵守 | 只能观察行为 | 下一次改代码 |

## 反向验证

未做（纯新增资产与文档）。若出现加载失败，回滚路径见 `summary.md`。
