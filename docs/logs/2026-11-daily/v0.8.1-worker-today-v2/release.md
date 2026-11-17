# 发布说明：v0.8.1 worker 今日卡规则 v2（需要重启宿主）

## 生效方式

| 半边 | 改动 | 生效方式 |
| --- | --- | --- |
| `patches/superagent-worker-today.patch` | `todayCards` 规则文本 4 句 → 6 句（v2 契约：`nodes`、常用节点、限额、内容底线） | 需重新构建 + 重启 |
| `superagent/lib/index.js` | 已由 `node scripts/build-bundle.mjs` 编译进产物 | **重启宿主一次** |

重启命令（主人执行；本轮没有自己停/重启 3082）：

```powershell
cd C:\Users\Administrator\Desktop\diva-dsh
npm run stop
npm start
```

- 影响：3082 面板短暂断开一次；Superagent / Daily 随宿主重启。
- 重启后新开的 ticket worker 会话尾部带六句新规则；已在跑/已结束的会话不受影响。
- master / 普通 DSH 会话 / DSH 子 agent 仍然拿不到这条规则（机制未变）。

## 本轮验证环境

- 构建：`node scripts/build-bundle.mjs` exit 0；`lib/index.js` 492.31 kB。
- 产物：`superagent/lib/index.js:3259` 起 `const todayCards = [...]`，六句全文可搜到；
  旧 `"body":"一两句内容"}]}` 旧形状 0 命中。
- 角色取证：真实 prompt revision 1（`orchestrator.sqlite` 的 `kv['prompt-version:1']`）
  跑 `promptParts`/`composePrompt`；worker `runtime/worker` part 1734 字含新文案，
  master 无 `runtime/worker` part、搜不到规则。
- 上游干净：构建/取证前后 `git -C superagent status --short` 均为空。
- 测试：`source-runtime + windows-deployment` 32/32；`npm test` 结果见 verification.md。

## 回滚

1. 恢复旧规则文本：
   ```powershell
   Copy-Item `
     'C:\Users\Administrator\Desktop\diva-dsh\.artifacts\worker-prompt-probe\today-patch-v1.backup' `
     'C:\Users\Administrator\Desktop\diva-dsh\patches\superagent-worker-today.patch' -Force
   ```
2. 重建：`node scripts/build-bundle.mjs`
3. 重启宿主：`npm run stop` → `npm start`

回滚只影响 worker 提示词里的这段规则，不动 v2 的 `plugins/dsh-daily` 宿主/客户端；
之后 worker 会重新按旧契约写纯文字卡。

## 提交

本轮**没有 git commit**（按纪律）。改动都在工作树：
`patches/superagent-worker-today.patch`、`superagent/lib/index.js`（构建产物、
上游仓库未跟踪）、`docs/logs/2026-11-daily/v0.8.1-worker-today-v2/`、`TODOLIST.md`。
