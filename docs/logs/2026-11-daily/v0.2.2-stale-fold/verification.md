# 验证

## 单元测试

```
node --test tests/daily-client.test.mjs
ℹ tests 27
ℹ pass 27
ℹ fail 0
```

新增用例：`分界指向已不存在的消息时作废：历史被清空后不吞新的一段`——本地存 `999`，会话只有 seq 1..2，断言旧气泡照常显示、没有折叠行、`localStorage` 里那条被抹掉。

## 搬移脚本

```
node .artifacts/dsh-home/reset-master-session.mjs --dry
会搬走 .artifacts\dsh-home\sessions\--C-…superagent-local--\orchestrator-4d1802aebad9163249a492fde7acb59a
会搬走 .artifacts\dsh-home\storages\session_projcache\sessions\orchestrator-4d1802aebad9163249a492fde7acb59a.json
会搬走 .artifacts\dsh-home\storages\dsh-context\overview-cache.v1.json
```

试跑只列清单、不动手；host 还在跑（端口 3082 监听中）时真跑会 `exit 2` 并提示先 `npm run stop`。

## 日志结构取证

`master-turns.mjs` 按 turn 归组 master 会话：`events=291 turns=1..13`；第 1–10 轮 `seq 42..236` 全是 relay 输入 + 汇报回复，第 11–13 轮 `seq 259..284` 是「晚上好 / 天气 / 你是谁」。

## 真机（用户已执行）

2026-11-15 12:53:31 用户按本方案跑了 `npm run stop` + `reset-master-session.mjs` + `npm start`：

- `backups/20261115-master-session/` 下三条都在（master 会话目录、投影缓存、洞察缓存）。
- master 会话已重建：`session.v4.jsonl.zstd` 从 210,198 字节 / 291 条事件变成 53,927 字节 / 31 条事件，第 1 轮从「早上好」开始。
- 此后日常页那条会话里已经没有残留。

## 未验证

- 分界作废那一条在浏览器里的实际表现（重建后 `localStorage` 仍存着旧分界 284，新会话最大 seq 只有 29 → 应作废）。已有单元测试，但没人看过那一屏。
- 「上下文洞察」面板首屏重算的表现。
