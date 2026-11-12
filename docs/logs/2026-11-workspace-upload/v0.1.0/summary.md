# v0.1.0 工作区整理与上传

- 状态：done；六个自有插件与主仓库已有成果均已分组提交推送。
- 范围：已有插件功能、启动器、第三方接线、研究文档、日志与任务状态。
- 验证：界面/接线 60 pass；Laputa 274 pass；Evolution 20 pass；网关 26 pass；两个 TypeScript 插件构建与类型检查通过。
- 未验证：根全量 151 fail，Harness 2 fail；SurfCore audit 未完成；未重跑浏览器交互、真实外部服务或完整 setup。
- 详情：见 verification.md；后续测试债务登记为 DV-TEST-001。

## 整理方式

已有成果按主题提交，自有插件先推送，再提交主仓库子模块指针。世界网关使用既定私有仓 `vivy-dsh/word-gateway`，原目录保留为 `plugins/capability-hub`，登记为独立子模块。备选整包归档不便复现插件版本，因此未采用。

没有删除用户文件、重写远端历史或上传运行配置、凭据、缓存与许可排除资产。

## 保留与隔离

- SurfCore 仍报告 9 个工作树 modified 项，但 `git diff` / `diff --cached` 均为空；抽查 `src/bridge.js` 工作树 blob 与 index 相同。未提交上游内容，未改变其 pin；不声称整个工作区完全 clean。
- Harness 内嵌 `_shared/` 是未跟踪的旧副本，其 `.git` 指向错误的相对元数据路径；源码/构建产物无此目录引用。已可回滚移动到 `.artifacts/backups/workspace-upload-20261113/harness-local-shared/`，未上传。
- `.workspace/` 参考项目继续由 `.gitignore` 排除。

历史日志保留当时验证结论；本轮结果以本目录为准。
