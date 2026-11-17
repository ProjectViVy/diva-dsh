# 上游贡献 · v0.1.0-superagent-windows · 发布

- 性质：**准备态**，未推送、未开 PR。仓库本身没有新代码（`patches/superagent-windows.patch` 是已有文件的内容更新）。
- 产物：
  - `.artifacts/upstream/superagent-windows`：上游 `main@8c32a9d` 的干净克隆，分支 `fix/windows-support`，提交 `9e56763`。
  - `patches/superagent-windows.patch`：**7,048 字节 / 3 文件**（只含 `src/`，构建期用；测试改动只留在 PR 提交里），对钉住的 `superagent@6337fc8` 与上游 `main` 都 `git apply --check` 通过。
  - [pr.md](pr.md)：可直接粘贴的 PR 标题与正文。
- 对本仓的影响：补丁内容变化（正则接受 UNC、新增测试文件），构建期仍由 `withTemporaryPatch` 临时应用再回滚；钉住 `superagent/` 的提交与工作区都未改动（`git -C superagent status --porcelain` 为空）。
- 回滚：`git checkout -- patches/superagent-windows.patch` 即可；`.artifacts/upstream/` 是缓存目录，可直接删。
- 风险 / 限制：
  - 未在 Linux/macOS 上跑上游测试；`absolute()` 的正则放宽只影响「是否接受」，不影响已有路径的取值。
  - 上游若近期把 Windows 支持另做一版，这条 PR 需要重放（补丁应用点在 `src/deployment.ts` 的三个函数上）。
