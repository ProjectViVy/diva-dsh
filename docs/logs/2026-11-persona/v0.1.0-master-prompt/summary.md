# 把 DIVA 人格接回主会话

- 根因有两层：master 的 policy 段标了 `complete: true`（`superagent/src/app/sessions.ts:244-249`），装配时 `sections: [completeSection]`，人格段被整段丢弃；同时 laputa 在本机是 disabled，人格正文六件套全是 0 字节。
- 补丁：`patches/superagent-persona.patch`（唯一改动是去掉 master 的 `complete`），登记进 `superagent-patches.json`（12 条），用 `withTemporaryPatch` 重建 `superagent/lib`；产物里 `complete: true` 已 0 命中。
- 人格：启用 laputa（面板开关，持久化到 profile `cordis.patch.yml` 的 `- id: laputa … enabled: true`），经面板 API 发布 revision 1（`/file` ×6 → `/publish`），六份正文共 1355 字。
- 回归：`tests/source-runtime.test.mjs` 29/29（补丁清单断言从十一条改成十二条）。
- 未验证：重启后的运行期效果（人格是否真的进 master 提示词、路由是否退化）。
