# 上传顺序与回滚

本轮仅准备，用户尚未要求提交或推送。不要直接在根仓运行 `git add .`：三个新插件尚无 HEAD，已有子仓的工作改动也不会随根仓自动上传。

## 1. 自有仓库先提交、推送

| 仓库 | 本地改动主题 | 建议提交信息 |
| --- | --- | --- |
| plugins/voice | 声音包导入 | `fix: harden voice pack import` |
| plugins/dsh-continual-harness | 精炼协调、技能 owner、面板 | `feat: integrate native dream refinement` |
| plugins/dsh-evolution | 原生精炼会话、工具与面板 | `feat: run refinement in native sessions` |
| plugins/dsh-laputa | 候选审批、适配与工具 | `feat: align refinement candidate ownership` |
| plugins/dsh-mempalace | 多空间、云 embedding、recall | `feat: add memory spaces and recall` |
| plugins/dsh-vivy-studio | 日常入口与侧栏 | `feat: expose daily workspace navigation` |
| plugins/dsh-see-now | 生命周期记录与面板 | `feat: track see-now session lifecycle` |
| stage-app | Hiyori 只留本机、不随源码分发 | `chore: exclude bundled Hiyori model assets` |

这些是按当前文件面给出的分组建议，实际提交前仍需逐仓查看 diff。voice、continual-harness、evolution、mempalace 当前为 detached HEAD，应先创建有名分支再提交，避免成果只挂在游离 HEAD。Harness 的 Windows 权限测试仍有两项失败，不能宣称全部测试通过。

## 2. 三个新插件首个提交后登记子模块

| 本地目录 | 已创建公开空仓 |
| --- | --- |
| plugins/dsh-daily | https://github.com/vivy-dsh/dsh-daily |
| plugins/dsh-superagent-reset | https://github.com/vivy-dsh/dsh-superagent-reset |
| plugins/dsh-ui-scope | https://github.com/vivy-dsh/dsh-ui-scope |

本地均已 `git init -b main` 并配置对应 `origin`。先在各目录显式加入源码、README、许可说明与 `.gitignore`，审阅后首个提交、推送。daily 的 `VENDORED-genui.md` 包含版权与 MIT 许可全文，必须随源码保留。

确认各子仓 HEAD 已在远端可获取后，在根仓逐个运行下列接线命令（尚未执行）：

```powershell
git submodule add https://github.com/vivy-dsh/dsh-daily.git plugins/dsh-daily
git submodule add https://github.com/vivy-dsh/dsh-superagent-reset.git plugins/dsh-superagent-reset
git submodule add https://github.com/vivy-dsh/dsh-ui-scope.git plugins/dsh-ui-scope
```

已有 see-now/genui 的 gitlink 与 `.gitmodules` 在本轮开始时就已暂存；最终提交前再次确认它们对应的版本，以及所有子仓新 HEAD 是否已推送。

## 3. 根仓按主题提交

1. Windows 开发与验证：Justfile、dev 启动器、esbuild 管道、相关 scripts/tests。
2. 原生精炼链：Dream 补丁清单、worker skill、执行入口与对应测试，以及 Harness/Evolution/Laputa 指针；删除旧 dream patch 属于此组。
3. 记忆空间：embedding/spaces 检查脚本、mempalace 测试与子模块指针。
4. 日常界面：daily/reset/ui-scope 插件接线、persona/genui/today 补丁、card-guide、genui pin 与 UI 测试。
5. 源码安装：see-now/third-party/user-plugins 接线、忽略规则、package 与 lockfile；包含私人目录说明书，不包含私人插件源码。
6. 资产排除：stage-app 新提交的指针，须与该仓取消跟踪提交配套。
7. 文档：README、架构/研究文档、既有交付日志、TODOLIST 与本轮四件套。

有文件跨组时按实际 diff 分块，不为凑分组混入无关改动。根仓最后推送，保证其 gitlink 指向的提交先可获取。完整 setup 与重启验收需另行执行。

## 回滚与本机证据

- 根仓原 index 未改变；开始时工作区和暂存补丁快照为 `.artifacts/workspace-upload-20261117/root-{worktree,index}.patch`。既有脏子仓也保存了两份补丁快照，快照不含未跟踪文件，不是完整备份。
- stage-app 取消跟踪前完整 index 已备份为 `stage-index-before`，18 项文件清单在 `stage-hiyori-files.json`。本机文件仍在原位。若尚无后续 index 改动，可用 `git -C stage-app restore --staged -- demo/Hiyori` 撤销取消跟踪，再撤销本轮新增的 Hiyori 忽略行；不需要删除模型。
- 三个新插件源码未移动；本地 Git 元数据与远端空仓均保留。若要放弃，应先隔离本地 `.git` 元数据；远端删除属于另一项操作，本轮未执行。
- 原始测试日志、仓级状态与扫描结果在同一 `.artifacts` 目录，仅本机保留，不加入提交。
