# v0.0.1-temp-and-skills 启动器临时根与技能安装

- 状态：done（**临时根需重启生效**）
- 范围：`scripts/lib/source.mjs`、`scripts/lib/skills.mjs`（新）、`scripts/lib/dream-skill.mjs`、`scripts/setup-components.mjs`、两个测试文件、技能 frontmatter、`AGENTS.md`、`docs/feature-restoration.md`
- 验证：见 `verification.md`（针对性 31 项 + 全量失败归类）
- 未验证：重启后 `pwsh` 实测；停面板后的完整 `npm run setup`
- 回滚：`git checkout` 上述文件即可；`skills.mjs` 为新增文件，删除即可

## 改了什么

两件事，都为「让本机环境可用」：

1. **临时根移出工作区**。`localEnvironment()` 原来把 `TMP/TEMP/TMPDIR` 指到 `<项目>/.artifacts/tmp`，Windows ACL 沙箱启动时直接拒绝，导致本会话所有 `pwsh` 失败。现在按优先级选 `%LOCALAPPDATA%` → `os.tmpdir()` → `~/AppData/Local`，取第一个**不在项目内**的路径，再拼 `diva-dsh-tmp/<项目路径哈希>`；`prepareLocalDirectories()` 改为校验它在项目外，而不是项目内。
2. **技能安装纳入 setup**。新增 `scripts/lib/skills.mjs`，把原 `installDreamSkill` 的归属校验逻辑泛化为 `installProjectSkill(root, home, name)`（只覆盖带 `author: diva-dsh` 的旧文件，其他一律抛 `user-owned`），`setup-components.mjs` 按 `PROJECT_SKILLS` 安装 `diva-dream` 与 `more-faster-better-economical`。给后者补了 `metadata.author/role`，否则归属校验无法识别。

## 影响面

- 用户可见行为：DSH 子进程的临时目录从项目内改到 `%LOCALAPPDATA%`；不再产生 `.artifacts/tmp` 新文件。
- 数据：无迁移；旧 `.artifacts/tmp` 保留未删（删除要可回滚）。
- 依赖方：`mempalace-setup`、`sourceRuntimeInvocation` 等所有走 `localEnvironment` 的子进程，只换 temp 路径。
- 重启要求：**是**。本会话进程仍带旧 `TMP`，重启后才生效。

## 未验证

1. 重启后 `pwsh` 是否真的可用——只能在重启后实测。
2. 完整 `npm run setup`——面板运行中 `setup-components.mjs` 会主动拒绝；本次用脚本直接调用安装器验证。
3. 全量 `npm test` 仍有大量既有失败（Windows 分隔符、EPERM 文件锁、SurfCore loader 的 `file://` 问题），未逐条证明与基线一致，只确认本改动相关用例通过。

## 备注

- 中途 `edit` 把 4 个 LF 文件写成了 CRLF，已还原为 LF，diff 回到最小（`git diff --stat` 复核）。
- 按 `AGENTS.md` §6 未提交。
