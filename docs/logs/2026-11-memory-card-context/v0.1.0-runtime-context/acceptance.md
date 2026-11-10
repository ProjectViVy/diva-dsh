# 验收步骤 v0.1.0

> 用户视角：点哪里、看什么、什么算通过。

## 前置

- 已重启：`npm run stop && npm start`（插件代码改动只有重启才生效）。
- `.artifacts/dsh-home/memory/config.json` 里 `cardInjection.enabled` 为 `true`（本轮已打开）。
- 至少有一条记忆在卡上（面板里能看到卡内容即可）。

## 步骤

1. 打开任一普通会话，发一条消息。
   - 预期：对话流里出现一条 `Current runtime context. This snapshot supersedes earlier runtime-context snapshots.` 的 user 快照，内容含 `【记忆卡`。
   - 实测：

2. 保持会话 B 开着；在另一个会话 A 里 `add` 一条新记忆（面板或 `/actmem/add …`）；回到 B 再发一条消息。
   - 预期：B 的下一步出现新的 runtime context 快照，含刚加的那条；旧快照仍在历史里但被声明 superseded。
   - 实测：

3. 打开 Superagent 主 Session（router preset），发一条消息。
   - 预期：同样出现含 `【记忆卡` 的快照（master 的提示词是 complete section，之前拿不到卡，这是本次修复点）。
   - 实测：

4. 让主 Session 派一个子 agent（或直接用 subagent 工具起一个），看它的上下文。
   - 预期：subagent 的装配里没有卡（面板/工具输出里不出现 `【记忆卡`）。
   - 实测：

5. 打开系统提示词视图。
   - 预期：不再出现 `actmem:card` 这一段（卡已迁到 runtime context）。
   - 实测：

6. 把 `cardInjection.enabled` 改成 `false`（配置即时生效，不用重启），在会话里再发一条消息。
   - 预期：新快照里没有卡；旧快照保留但已 superseded。
   - 实测：

## 不通过时怎么反馈

- 把会话 id、那一屏快照截图、以及 `.artifacts/dsh-home/logs/` 下对应时间的服务日志发回来；若是「A 加了记忆 B 没更新」，请连 A 的 add 时间一起给。
