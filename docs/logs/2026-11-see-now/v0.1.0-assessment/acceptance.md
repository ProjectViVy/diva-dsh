# dsh-see-now 评估 · v0.1.0-assessment · 验收

本目录交付的是**评估**，不是插件安装；验收分两层。

## A. 评估本身（现在就能验）

1. 读 `docs/research/dsh-see-now-assessment.md` §0，确认结论是「感知层可用，理解/记忆/身体仍缺，模型模态是硬前提」，没有把插件说成完整方案。
2. 读 §4 的 D1–D5，确认每条都有选项、推荐和影响面；你能直接拍。
3. 读 §5 的 A 阶段四步，确认没有偷偷改本仓代码/配置；本轮的写操作只有 `docs/`、`docs/logs/` 与 `TODOLIST.md` 登记。
4. 若你不同意「先 A 后 C」或「暂不进 third-party」，在 D1/D5 里改结论，报告与 TODOLIST 一起更新。

## B. 插件是否真的有用（拍板 A 后验）

1. 模型层：加 `input: [text, image]` 后，`read_image` 能读一张本地 PNG；若端点拒绝，记录错误并转 D3-B。
2. 安装层：`dsh plugin --profile superagent-local add link:<v0.2.3>` 后重启，新会话出现 `see_now` 工具；设置页出现「看你看的东西」。
3. 感知层：2 分钟静止文档 ≤ 1 张兜底图；切窗口/视频按变化出图；模型能说出只有画面里才有的变化。
4. 成本层：记录每张 token、每小时张数、CPU/内存；与 README 的 222 token/张（或所选模型的档位）对照。
5. 交互层：`say` 能被听到；悬浮窗可停；`stop` 后不再抓屏；日志里没有屏幕原文/敏感内容。

**失败判据**：模型仍报 `does not declare image input`（C1 未解）；插件装后工具不出现（C2/安装问题）；出图但模型描述与画面无关（模态或分辨率问题）；一小时成本不可接受（C5）；抓屏内容进入日志/记忆（C4）。

## 结果回填

把 B1–B5 的实测写进本目录 `verification.md`，并把 D1–D5 的结论写进 `TODOLIST.md` DV-DOC-013 的「下一步/未验证」。
