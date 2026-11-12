# 验收单 v0.0.1-temp-and-skills

## 本机验证（已完成）

- [x] `source.localEnvironment(root).TMPDIR` 不在项目内（`outsideProject=true`）
- [x] `TMP`、`TEMP` 与 `TMPDIR` 一致
- [x] `prepareLocalDirectories` 成功创建目录，且拒绝项目内的临时根
- [x] `diva-dream` 与 `more-faster-better-economical` 都写入 `$DSH_HOME/skills`
- [x] 重复安装幂等；用户自有文件抛 `user-owned` 且不被覆盖
- [x] 技能目录热刷新后 `more-faster-better-economical` 可被 `skill` 工具加载
- [x] `node --check` 四个改动文件通过
- [x] 改动面 9 文件 +116/−35，无整文件行尾重写

## 重启后验收（待做）

- [ ] `npm run status` 正常，面板可打开
- [ ] 任意 `pwsh` 命令（如 `npm run status`）不再报 `Windows ACL temp root must be outside the workspace`
- [ ] `os.tmpdir()` 指向 `%LOCALAPPDATA%\diva-dsh-tmp\<hash>`，且 `.artifacts/tmp` 不再新增文件
- [ ] 会话里 `skill` 工具能加载两个技能

## setup 验收（需先停面板）

- [ ] `npm run stop`
- [ ] `npm run setup`（或 `npm run setup:components`）退出码 0
- [ ] 重复执行一次仍退出码 0，且两个 `SKILL.md` 内容不变
- [ ] 手工把 `$DSH_HOME/skills/diva-dream/SKILL.md` 改一行后再跑 setup，应报 `user-owned` 并保留改动（安全行为）
