# 验收

1. 确认六个自有插件提交均能从各自 `origin/main` 获取。
2. 确认主仓库提交按启动器、审批、界面、插件接线、文档分组，没有混入运行配置与缓存。
3. 确认 `plugins/capability-hub` 为 `vivy-dsh/word-gateway` 子模块；`third-party/dsh-context` 继续锚定 v0.83.1。
4. 确认主仓库 `main` 与远端一致；检查所有自有插件工作树状态。
5. SurfCore 上游工作树的遗留状态单独列明，不自动还原或上传；测试失败记入 DV-TEST-001。

本次验收目标是整理和上传已有成果，不等于所有功能已验收。
