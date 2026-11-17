# 验收清单（重启后执行）

运行期必须重启 host 才会生效（当前 host 加载的是构建前的 `superagent/lib`）。重启三条命令同时完成另一件事：把 AutoDream 残渣搬进备份区。

```powershell
npm run stop
node .artifacts/dsh-home/cleanup-autodream.mjs
npm start
```

1. 「日常」左栏问「你是谁」→ 回答体现 DIVA 的立场与说法（先弄清再决定说不说、不讨好、不确定就说不确定），而不是「我是编排器，负责评估与路由」。
2. 同一个回答里不再出现 `dream_…`、候选、工单之类的历史汇报（前提是 master 会话已被清理脚本换成空会话）。
3. 路由冒烟：在「日常」里发一条明确的执行请求，观察是否仍能进工单/派活；发一条闲话，观察是否平静回复而不是派活。
4. 若路由明显退化 → 回滚：从 `patches/superagent-patches.json` 移除 `superagent-persona.patch`，重建 `superagent/lib`，重启。
5. 若人格措辞不对 → 不改代码，在「设置 → 人格」里改六份正文并发布新 revision。
