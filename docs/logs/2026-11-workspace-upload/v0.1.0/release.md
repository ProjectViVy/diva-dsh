# 提交与回滚

## 自有插件

| 路径 | 提交 |
| --- | --- |
| plugins/dsh-continual-harness | a497b74 |
| plugins/dsh-evolution | 8a5d763 |
| plugins/dsh-laputa | 63627bb |
| plugins/dsh-vivy-studio | e9fe890 |
| plugins/dsh-vivy-tone | b5852db |
| plugins/capability-hub | d105467（首个提交，远端 vivy-dsh/word-gateway，私有） |

六仓已按 `HEAD:main` 推送，无 force push。上游三仓没有新增提交。

## 主仓库

按启动器、Dream 审批、人格/语气/侧栏、插件接线、调研文档拆分提交。主仓库提交记录可用 `git log --oneline 1e0fde8..main` 查看。

- 5fb41a0：世界网关与第三方 context 接线。
- 740f2f6：临时目录与项目技能安装。
- dfcd56b：Dream 审批和 staging 子模块版本。
- e741aa3：语气编辑与侧栏分组。
- a1934e4：研究文档、历史证据与参考目录忽略规则。
- 最后一笔 docs 提交：本轮四件套、工作区状态和 DV-TEST-001 测试债务。

## 回滚

已发布提交用 `git revert` 逐主题回退，并恢复对应子模块指针；不要 reset 共享分支。需要恢复本地旧 `_shared` 副本时，从 `.artifacts/backups/workspace-upload-20261113/harness-local-shared/` 移回原路径；恢复前核对目标不存在，并注意其中旧 `.git` 文件原本就不是可用的独立仓引用。

开发服务器未主动重启。完整 setup 与活体业务验收留待后续。
