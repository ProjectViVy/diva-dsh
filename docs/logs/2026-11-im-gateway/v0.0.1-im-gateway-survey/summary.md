# v0.0.1-im-gateway-survey IM 接入与统一网关：盘点 + 方案

- 状态：已交付（**纯文档，未改任何代码**）
- 范围：`docs/research/im-gateway-unification.md`（新建）；`TODOLIST.md`（登记）；本日志目录
- 验证：见 `verification.md`（10 条只读核对，全部有实际输出）
- 未验证：见下「未验证」段
- 下一步：`DV-DOC-001`，等用户回答 D1–D5
- 回滚：删除 `docs/research/im-gateway-unification.md` 与本日志目录即可；未触碰任何代码或配置

## 改了什么

行为层面：**没有变化**。本轮只产出文档与状态登记，未修改代码、配置、profile、子模块。

文档新增的内容（供下次会话直接复用）：

1. **SnowLuma 是什么**：第三方 QQ 自动化程序，把真实 QQ 号暴露成 OneBot v11 服务器（HTTP 3000 / WS 3001），
   不知道 LLM/agent/DSH 的存在。定位为「协议驱动」，与 dsh-im 内部的 `@tencent-connect/qqbot-connector` 同层。
2. **SnowLuma 接线现状**：4 个独立客户端（bridge / mcp-safe / mcp-host / adapter egress）；
   bridge 是隐式 token 中介；3 条发送路径只有 1 条有账本；11 个裸 `fetch` 散在 16k 行 `main()`。
3. **为什么不能改 SurfCore 源码**：ESM `registerHooks({load})` 在内存打补丁 + `sourceSha256` 漂移闸门；
   改动面收敛为 6 个文件 / 1,815 行。
4. **为什么「IM 直接接编排器」成立**：`worker-<ticketId>` 稳定会话 + Subscription 扇出不走 Eval +
   结束票可被人的消息唤醒；并列出必须先补的 R1/R2/R3。
5. **dsh-im 的真实契约**：出站 9 渠道可用；入站仅飞书/Lark（`consumeInbound`）；无 external id、无法对账。
6. **要不要提 SnowLuma 上游**：只值得提 `get_group_msg_history` 的语义与限流；
   上游活跃对锚点补丁架构是**负资产**；不该为正在退场的组件求接口。
7. **为什么不该 fork dsh-im**：shared 层约 95 个模块（单文件最大 134 KB）、无渠道扩展点、
   方向倒退、维护转移、许可暴露放大。
8. **两条战略路线对比**（编排器为中心 vs dsh-im 为中心）与五条待决策。

## 影响面

- 用户可见行为：无。
- 数据：无写入。
- 性能：无。
- 依赖方：无。
- 重启要求：**无**（纯文档）。

## 未验证

1. **dsh-im 的源码行为未读**：`ctx.dshIm.send` / `consumeInbound` / `sendChecked` / `historyChecked` 的
   错误码、能力矩阵、回环 HTTP 无鉴权范围，全部来自其公开文档（README / CONTEXT.md /
   PROACTIVE_DELIVERY.md / package.json，抓取于 2026-11-10），按外部数据处理。落地前必须读源码复核。
2. **dsh-im 声明兼容 `dsh 0.2.1-rc.2`，本机是 `0.2.1-rc.5`**，且 rc.5 靠 `app.asar` 字节补丁绕过 welcome 握手缺陷。
   未验证 dsh-im 与这两处补丁是否冲突。
3. **真实 QQ 链路无法端到端验证**：SnowLuma 未启动（3000/3001 无监听）、QQ 桥接未运行
   （无 `<DSH_HOME>/surfcore/runtime.json`，3100 无监听）、`config.json` 无 `snowluma` 段且
   `platforms.start = {qq:false, bili:false}`。所有结论均为静态分析。
4. **`plugins/surfcore` 子模块的 `git status` 显示 9 个文件 ` M`，但 `git diff` 为空**，原因未查明
   （疑似陈旧 index 或 stat 缓存）。不影响「运行时用内存补丁」这一结论（该结论来自 loader 源码），
   但下次动 SurfCore 前应先弄清。

## 备注

- 本轮**没有**提交（按 AGENTS.md §4「不自动提交」）。
- 五条待决策（D1–D5）写在文档 §6；其中 D4（一 Thread 一活票）与 D5（接 dsh-im vs 让 IM 只是又一个 SourceKind）
  决定后续所有工作量，未定之前不宜动手。
- 文档已长到 700+ 行，若继续追加建议在 §2.3 / §8 / §9–§10 三块之外新开文件，避免单文件继续膨胀。
