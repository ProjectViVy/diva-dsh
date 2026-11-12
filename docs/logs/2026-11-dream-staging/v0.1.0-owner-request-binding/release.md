# 发布 / 生效步骤

## 变更

- `dsh-evolution`：`src/dream.mjs`（纯 ESM，重启即生效，无需构建）。
- `dsh-continual-harness`：`src/skill-owner.ts`、`src/skill-owner-runtime.ts` ——
  **必须重新编译**（包入口是 `lib/types/index.js`，运行时不读 TS）。
- `dsh-laputa`：`internal.mjs`（纯 ESM，重启即生效；`src/index.ts` 未改）。

## 生效

```powershell
# 1) 编译 TS 插件（否则运行实例仍加载旧 lib）
pnpm -C plugins/dsh-continual-harness build

# 2) 重跑测试（含本轮新增断言）
node --test tests/dream-evolution.test.mjs
pnpm -C plugins/dsh-laputa test

# 3) 重启（面板与本会话都会被停掉）
npm run stop
npm start
```

`npm run setup` 也会编译插件，但当前面板在运行，`setup-components` 会主动拒绝，先 `npm run stop`。

## 回滚

四个源文件的改动都是「多带一个已有字段 / 多传一个空 body」，回滚即删除：

- `dream.mjs`：staging 两处去掉 `requestId: auth.requestId`；`baseline` 的第三个参数去掉。
- `skill-owner-runtime.ts`：authorize 载荷去掉 `...(input.requestId ? …)`。
- `internal.mjs`：authorize 载荷去掉同款条件展开。
- 重新 `pnpm -C plugins/dsh-continual-harness build` 并重启。

回滚不影响已落盘的候选/journal：本次没有产生任何候选或发布。
