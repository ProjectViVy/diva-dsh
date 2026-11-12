# 发布记录 v0.0.1-temp-and-skills

## 发布内容

- `scripts/lib/source.mjs`：临时根改到工作区外，`prepareLocalDirectories` 校验方向反转
- `scripts/lib/skills.mjs`（新）：通用技能安装器
- `scripts/lib/dream-skill.mjs`：改为调用通用安装器（保留导出，避免破坏调用方）
- `scripts/setup-components.mjs`：按 `PROJECT_SKILLS` 安装
- `skills/more-faster-better-economical/SKILL.md`：补 `metadata.author/role` 供归属校验
- `tests/source-runtime.test.mjs`、`tests/dream-skill-install.test.mjs`：断言更新 + 新用例
- `AGENTS.md` §4、`docs/feature-restoration.md`：环境事实同步
- `TODOLIST.md`：DV-OPS-001

## 发布方式

代码入库后需重启：`npm run stop && npm start`。技能已在当前 DSH_HOME 装好，重启不影响。

## 回滚

```
git checkout -- scripts/lib/source.mjs scripts/lib/dream-skill.mjs scripts/setup-components.mjs \
  tests/source-runtime.test.mjs tests/dream-skill-install.test.mjs \
  skills/more-faster-better-economical/SKILL.md AGENTS.md docs/feature-restoration.md TODOLIST.md
rm scripts/lib/skills.mjs
```

已安装到 `$DSH_HOME/skills` 的两个技能可保留（回滚代码不影响其可用性）。

## 风险

- 其他子进程若隐式依赖「临时文件在项目内」，会改到 `%LOCALAPPDATA%`；当前仓库内只有安装类脚本使用 `localEnvironment`，影响是 temp 位置变化。
- `%LOCALAPPDATA%` 被清理工具删除后，下次 `prepareLocalDirectories` 会重建。
- 全量测试仍有既有失败，与本改动无关但会干扰基线判断。
