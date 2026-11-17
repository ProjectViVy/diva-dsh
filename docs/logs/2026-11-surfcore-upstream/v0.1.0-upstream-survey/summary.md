# v0.1.0 SurfCore 上游现状调研（只读）

- 状态：已交付（纯调研，未改代码）
- 范围：`plugins/surfcore`（只读）、`scripts/lib/surfcore-*.mjs`（只读）、GitHub `Mieksido/surfcore`
- 验证：见 `verification.md`（探针脚本 + git diff，未跑 setup/audit）
- 未验证：`renderHostBootSource` / `renderHostWorkdirSource` 两层锚点（未导出，无法单独调用）；`npm run setup:surfcore`；`npm run test:audit`
- 下一步：DV-UP-001，等 D1–D4 拍板
- 回滚：无代码改动，无需回滚；临时制品在 `.artifacts/research/surfcore-v089/`（gitignored）

## 改了什么

没有改代码。产出两份文档：

1. `docs/research/surfcore-upstream-status.md`：结论、上游两条线、实测漂移、候选方案、卡点 F1–F5、决策 D1–D4、拍板后验证计划。
2. `TODOLIST.md` 新增 DV-UP-001（waiting-user）。

## 影响面

- 对运行中的实例：零影响（只读）。
- 对后续升级决策：把「升不升」从印象题变成可量化题——3 处锚点断裂、351 文件 diff、3 个稳定版跨度。
- 唯一新增副作用：工作区内多了 `.artifacts/research/surfcore-v089/`（v0.8.9 的 9 个锚点文件 + tar + 探针脚本），属本机缓存，未入库。

## 未验证

- `lib/index.js` 的完整渲染链（`renderHostBootSource` → `renderHostWorkdirSource` → `renderHostSource`）只测了最后一层。前两层未导出，若前两层锚点也断裂，实际重锚面比 §4 报的 3 条更大。
- 没有跑 `setup:surfcore`（只读纪律）：所以「pins 换数字后能否一次通过」未验证。
- 没有跑 `test:audit`：SurfCore 自身基线（DV-TEST-001 记为「未完成」）未知，升级后无法对比。

## 备注

- 取舍：选「用真实 renderer 跑探针」而不是「读 diff 猜锚点」。多花三步工具调用，换来「3 处断裂 + 首个断裂锚点原文」这种可直接开工的证据。
- 备选（未做）：把 v0.8.9 的 `src/bridge.js` 全文读一遍，人工对 6 个 label 逐个判定位移。成本高一个数量级，且在没拍板前属于过度投入。
- 观察点：上游用「整包替换 dist」的方式发 dev 包（不是逐提交演进），说明 dev 线短期内不会给出稳定的集成契约；`packs/` 目录名暗示将来平台能力以 pack 形式插件化，那时我们的锚点补丁模型可能需要重新设计（adapter-only）。
