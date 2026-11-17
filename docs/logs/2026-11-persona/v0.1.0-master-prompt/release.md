# 发布说明

## 变更

- 新增补丁 `patches/superagent-persona.patch`：去掉 master 会话 policy 段的 `complete: true`，让系统提示词装配保留 laputa 人格段与其它系统段。
- `patches/superagent-patches.json` 追加该补丁（共 12 条）。
- `superagent/lib` 已按 12 条补丁重建（运行期加载的就是这份产物）。
- profile `superagent-local/cordis.patch.yml`：`- id: laputa` 的 `config.enabled` 从缺省 `false` 改为 `true`（人格插件此前一直是关的）。
- laputa 人格发布 revision 1：`$DSH_HOME/laputa/default/*.MD` 六份共 1355 字，来源为 README 与 `docs/architecture.md` 的口径，属**起步稿**，后续在面板里改。
- `tests/source-runtime.test.mjs`：补丁清单断言十一条 → 十二条。

## 回滚

- 补丁：从 `patches/superagent-patches.json` 删掉 `superagent-persona.patch` → 重建 `superagent/lib` → 重启。
- 人格：面板「回滚」到空基线，或 `POST /dsh-laputa/api/enabled {enabled:false}`。
- 人格正文：revision 历史里任意回退，不动代码。

## 注意

- 上游三仓未改：`superagent/` 工作树干净，改动只在 `patches/`。
- 人格正文是草稿，措辞由用户在面板定稿；本目录不复制正文内容，避免两处不一致。
