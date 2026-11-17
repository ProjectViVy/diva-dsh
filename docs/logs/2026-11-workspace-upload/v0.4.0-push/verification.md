# 推送验证

1. 推送前所有目标仓库执行 `git fetch origin --prune`；对既有目标分支用 `merge-base --is-ancestor` 确认能够快进，新分支另行建立。未使用 force。
2. 11 个子仓执行 `git push -u origin HEAD:refs/heads/<当前分支>`，全部 exit 0。
3. 每个已推子仓用 `git ls-remote origin refs/heads/<分支>` 读回，SHA 与本机 HEAD 完全相同。
4. 对全部 25 个子模块逐一执行 `git fetch --no-tags --no-write-fetch-head origin <固定SHA>`，全部 exit 0；同时检查根仓 gitlink 与本机 HEAD 一致。
5. 根仓源码 `git push origin main:refs/heads/main` 成功，从 `a431930` 快进到 `aa0112e`；随后 `ls-remote` 读回 `aa0112e912fe0c4dad64d8d112e719f7f5a12add`。
6. 本目录与任务状态作为独立文档回执提交，随后再次推送根仓 main 并读回 tip；最终完成输出留在 `.artifacts/workspace-push-20261117/completion.json`。

本轮只进行了 Git 操作与文档记录，不重跑产品测试。已提交源码的最近全量结果为 1475 项、1465 通过、10 跳过、0 失败（仅测试进程关闭 autocrlf），Harness 两项 Windows 权限断言失败；详见 v0.3.0-local-commits/verification.md。

本机推送计划、快进预检、全部子模块 fetch 与远端分支读回结果在 `.artifacts/workspace-push-20261117/`，不上传缓存或凭据。
