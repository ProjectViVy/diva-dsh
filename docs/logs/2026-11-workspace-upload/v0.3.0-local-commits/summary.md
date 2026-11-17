# 项目整理与本地分仓提交（2026-11-17）

- 状态：done；子仓与根仓成果已分组本地提交，未推送。
- 范围：11 个自有子仓（含 3 个新插件）以及根仓现有源码、接线、测试和文档。
- 交付：子仓 12 笔、根仓 8 笔本地提交；三个新插件已成为正式子模块，25 个子模块指针与本机 HEAD 一致。
- 未验证：完整 setup、宿主重启、真实业务 GUI、远端获取；本轮没有推送。
- Harness 的两项 Windows 权限断言仍失败；其余验证与提交清单见同目录记录。

## 整理决策

按既有主题提交是最简方案；备选一次性大提交会混合多个仓库的所有权与回滚边界，因此没有采用。没有增加产品功能或修改宿主配置。

- voice、mempalace、stage-app 切回与原 HEAD 相同的本地 main；Harness/Evolution 的原 main 与当前基线不同，创建 `codex/native-refinement-20261117` 保存成果，没有覆盖旧分支。
- daily/reset/ui-scope 首个提交后登记 gitlink，再将其 Git 元数据迁入根仓 `.git/modules/`，保留本机源码位置。
- 原有根仓 index 在快照后按主题重新整理；see-now/genui 原暂存项均已纳入接线提交。
- README/AGENTS 更新为 25 个子模块；首次安装说明补齐手动的 `setup:third-party` 步骤，明确 genui 来自第三方档位，保持安装脚本行为不变。
- daily README 清除旧演示数据和自由 HTML 已启用的过期说明；包文件清单补上 `VENDORED-genui.md`，避免许可说明在打包时遗漏。
- `.gitattributes` 仅对 `patches/*.patch` 关闭空白检查：统一 diff 的空白上下文行必须保留前导标记。补丁另用安装脚本校验；源文件空白检查仍开启。

Hiyori 18 项仅从新版本取消跟踪，本机文件保留；旧 Git 历史仍含这些资产。上游三仓源码与 pin 保持不变。私人插件、运行状态、缓存与凭据不在提交中。
