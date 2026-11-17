# laputa 人格注入收窄 · 发布

- 形态：源码改动 + 单测 + 构建产物（`plugins/dsh-laputa`，独立 git 仓，**未提交**）。
- 变更文件：`src/top-level.ts`、`src/adapter.ts`、`src/tool.ts`、`tests/adapter.spec.ts`。
- 生效条件：**重启宿主**（`npm run stop && npm start`）；当前 GUI 正承载对话，未擅自重启。
- 回滚：`git -C plugins/dsh-laputa checkout -- src/top-level.ts src/adapter.ts src/tool.ts tests/adapter.spec.ts`（会连同本次新增用例一并回退）；`lib/` 需重跑 `npm run build`。
- 影响面：只影响「哪些会话挂人格」。main Session 与普通会话不变；Executor 会话不再带人格与 `laputa_init`。
- 与文档的关系：落实 `docs/architecture.md:77` 的注（main Session 挂同一份 DIVA 是目的、worker 不挂）。
