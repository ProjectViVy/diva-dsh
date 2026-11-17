# 发布说明 — v0.1.0 AutoDream 独立会话类型调研

## 交付物

| 文件 | 性质 |
| --- | --- |
| `docs/research/autodream-session-type.md` | 新增：方向调研（结论、机制、候选方案、卡点、决策清单） |
| `docs/logs/2026-11-autodream-session-type/v0.1.0-research/` | 新增：本四件套 |
| `TODOLIST.md` | 修改：新增 DV-EV-019 决策闸门；DV-EV-018 下一步改指向本报告 |

## 用户可见变化

- 面板、「模式」选择器、Dream 行为：**无变化**（本轮到交付为止没有实施任何一条方案）。
- 新增：一份说明「为什么 AutoDream 应当有自己的会话类型、怎么落地」的文档，以及一个待拍板的决策条目。

## 部署 / 重启

- 不需要。本轮没有改任何运行时代码或配置。
- 若后续采纳 B/A，需要：`npm run build:bundle`（补丁清单变化）+ `npm run setup:<component>` + `npm run stop && npm start`。

## 兼容性

- 无破坏性变更。`TODOLIST.md` 的 DV-EV-018 仍在，不撤销，只是把下一步指向新报告。

## 回滚

- 删除 `docs/research/autodream-session-type.md` 与本日志目录，撤销 `TODOLIST.md` 中 DV-EV-019 与 DV-EV-018 的「下一步」改动即可。
- 没有任何数据迁移或状态残留。

## 已知限制

见 `summary.md` §未验证（6 条）：多是「在 evolution 层是否同样可用」的实现级问题，属实施前必须实测的项，不影响方向判断。

## 下一步

等用户回答 `docs/research/autodream-session-type.md` §5 的 D1（方向）与 D2–D7。D1 未定时不动手。
