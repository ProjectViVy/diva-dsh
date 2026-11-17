# 验收清单（重启后执行）

重启命令会断当前面板，所以本轮没有跑：

```powershell
npm run stop
npm start
```

1. Superagent 面板 → 提示词：worker 预览尾部应有这四句（从「收工写今日卡」到「坏 JSON 会被当成今天没有卡」）；master 预览搜「收工写今日卡」应 0 命中。
2. 等一单真实 ticket worker 收工：`$DSH_HOME/today/<当天>.json` 里应多出它这一单的卡；再跑一单同一天，文件应被追加而不是覆盖（旧卡还在）。
3. 右栏 Today 应显示这张卡；历史分区不应被覆盖或丢卡。
4. 若 worker 提示词里没有：先确认该 worker 会话是重启后新开的（旧 worker 会话在重启前已装配），再确认安装的提示词 revision 没有被 `runtime/worker` override 覆盖（本机 revision 1 没有）。
5. 回滚：从 `patches/superagent-patches.json` 移除 `superagent-worker-today.patch` → `node scripts/build-bundle.mjs` → 重启；上游工作树不需要还原（补丁随时可逆）。