# v0.1.0 记忆卡投递改到 runtime context

- 状态：已交付（待重启验收）
- 范围：`plugins/memory/src/card-prompt.mjs`（投递面）、`plugins/memory/src/service.mjs`（注释）、`plugins/memory/README.md`、`tests/memory-card-prompt.test.mjs`
- 验证：`node --test tests/memory-card-prompt.test.mjs` → 9/9 通过；用真实 `SystemPrompt` 服务做装配探针，router 拿到卡、subagent 为空、`refreshContext` 换文案生效
- 未验证：运行中的 DSH 仍是旧代码，活体四步验收（普通会话 / router / subagent / 关开关）要重启后做
- 下一步：DV-MEM-001（重启验收）
- 回滚：`config.json` 里 `cardInjection.enabled: false`；或还原 `card-prompt.mjs` 后重启

## 改了什么

- 记忆卡的投递面从 `systemPrompt.section`（`actmem:card`，order 3）改为 `systemPrompt.context`（同名，order 130，`interpolate: false`）。
- 删除失效配置 `cardInjection.excludePresets` 与 section 常量（`CARD_SECTION_NAME` / `CARD_SECTION_OFFSET` / `DEFAULT_EXCLUDED_PRESETS`）。
- 投递范围：普通会话、worker、router 主 Session 都收；工具型子 agent（`origin: 'subagent'` 或 `delegationDepth > 0`）仍排除。
- README 改写为 runtime context 语义，并修正「改配置需重启」的说法（配置每次装配读取，即时生效）。
- 代码默认仍关闭；本机 `.artifacts/dsh-home/memory/config.json` 打开了 `cardInjection.enabled`。

## 影响面

- 用户可见：卡不再出现在系统提示词里，而是出现在对话流的 `Current runtime context` 快照中（user 角色、尾部追加、内容变化才发新快照）。
- Token / 缓存：每次卡内容变化追加一条快照（含该快照内其余 context 段）；旧前缀不动，对 leading-only 路由的前缀缓存更友好。
- 依赖方：SurfCore 的 QQ 桥仍直接读卡文件，不受影响；Superagent 无改动。
- 重启要求：插件代码改动需重启；配置改动即时生效。

## 未验证

- 活体四步：普通会话快照出现卡、router 出现卡、subagent 不出现、关开关后消失。原因：本会话由运行中的 DSH 实例托管，重启会终止当前回合，按先前惯例交给用户重启后按 `acceptance.md` 验收。
- 长时间快照增长：需要真实使用几天后看会话文件大小与快照条数，再决定要不要加合并窗口。

## 备注

- 备选「A+B 按 agent 身份分叉」（router 走 context、其余走 section）与「D 工具」都没有做：前者留下两份语义与特例，后者需要改 Superagent allowlist。
- 配了 `includeRuntimeContext: false` 的 persona 会看不到卡；当前部署没有这种 persona。
