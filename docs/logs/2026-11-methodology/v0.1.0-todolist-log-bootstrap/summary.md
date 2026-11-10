# v0.1.0 TODOLIST + 日志协议落地

- 状态：已交付（仅文档，无代码改动）
- 范围：新增根 `AGENTS.md`、根 `TODOLIST.md`、`docs/logs/README.md`、`docs/logs/_TEMPLATE/*`（4 份）、本目录 4 份，共 11 个文件
- 验证：行数上限 / 死链 / 反向检查 / 空态演练（通过）/ 旁证，见 `verification.md`
- 未验证：有真实任务时的冷启动、多会话同时写 `TODOLIST` 的冲突、子仓 cwd 下的可见性
- 下一步：无。`NOW` 仍为空；下一个真实任务将成为第一条条目
- 回滚：删除本次新增的 11 个文件即可，无数据迁移、无配置改动、无服务重启

## 改了什么

- 新增根 `AGENTS.md`：开工三读、条目认领（无 LOCK）、收工三写、边界、写作约定、四条 Rulebook。
- 新增根 `TODOLIST.md`：空态起步（`NOW` 为「无」），四个 `L0` 分区 + 决策闸门 + 测试债务 + 仓级状态入口 + 空 `Archive Index`；条目模板放在 HTML 注释里，不占正文。
- 新增 `docs/logs/README.md`：目录命名、四件套判据、`summary.md` 前 6 行块、归档规则、不改写历史、双向链接。
- 新增 `docs/logs/_TEMPLATE/{summary,verification,release,acceptance}.md`：占位符 + 拒绝「写感觉」的措辞。
- **没有**迁移任何历史数据：旧 backlog、`plugins/surfcore/docs/HANDOFF.md`、`cases/*`、旧 `docs/logs/` 全部原地未动。

## 影响面

- 从仓库根启动的会话：第一次模型调用前多出约 1.5k token 的常设指令（`AGENTS.md`）。
- 子仓会话（cwd 在 `plugins/*` 或 `stage-app`）：不受影响。
- 不改运行时代码、不改配置、不重启任何服务；旧会话不需要重新加载，新会话自然生效。

## 未验证

- **有任务状态下的冷启动**：交付时 `NOW` 为空，只能验空态；等第一个真实条目出现后再验「3 次工具调用内复述任务」。
- **多会话同时写 `TODOLIST`**：协议落地后观察到另一个会话在并行产出（见备注），但「两个会话同时改同一个 `TODOLIST.md` / `NOW` 段」的冲突处理还没实战；目前只靠「改前重读、改后核对」这一条软规则。
- **子仓 cwd 的可见性**：`plugins/surfcore` 等是独立 git 仓；若会话 cwd 落在子仓，根 `TODOLIST.md` 是否仍被读到未验证（依赖根 `AGENTS.md` 的注入，而注入以 cwd 为准）。

## 备注

- **协议落地后不到 10 分钟，同一工作区出现了另一个会话的交付**：`docs/research/im-gateway-unification.md` + `docs/logs/2026-11-im-gateway/v0.1-design/` 四件套，其 `summary.md` 引用了本次新增的 `AGENTS.md` §4「不自动提交」。这既说明协议能被别的会话读懂并照做，也说明**并行写入是真实风险**——`TODOLIST.md` 目前没有它登记的那一条，两者状态不同步。作者身份未核实，本目录未做任何改动。
- 已知未处理：`docs/architecture.md` §19 指向的 `superpowers/plans/vivy-dsh-ecosystem/index.md` 在本 checkout 不存在。本次按「只迁协议、不搬数据」决定不动它，等有真实任务时作为条目处理。
- 未做 git 提交，文件目前是工作区未跟踪状态。
