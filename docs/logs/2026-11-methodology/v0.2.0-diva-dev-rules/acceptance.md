# 验收步骤 v0.2.0

> 用户视角：新开一个会话，问三个问题，看它答得对不对。

## 前置

新开一个 DSH 会话，cwd 在 `diva-dsh/` 根目录（不要复用编辑会话）。

## 步骤

1. 问「SurfCore 的行为要改，改哪？」
   - 预期：指向 `scripts/lib/surfcore-*.mjs` 的锚点补丁，并说明**不能**直接改 `plugins/surfcore/`（子模块只读、`setup` 会重渲染覆盖）。
   - 实测：<待填>

2. 问「Superagent 想加个行为，怎么改？」
   - 预期：指向 `patches/superagent-*.patch` + `patches/superagent-patches.json`，说明不直接改 `superagent/`。
   - 实测：<待填>

3. 问「验证怎么跑？改了插件之后要做什么？」
   - 预期：`npm test`（`node --test tests/*.test.mjs`）；插件再跑插件自己的测试；改完要 `npm run stop && npm start` 才生效。
   - 实测：<待填>

## 不通过时怎么反馈

把该会话的回答贴回来，指出它漏了哪一格（落点 / 重启 / 测试 / 只读约束），我据此改 `AGENTS.md` 的措辞而不是改它的记忆。
