# v0.1.1-render-fix 发布与回滚

## 交付物

| 文件 | 性质 |
| --- | --- |
| `plugins/capability-hub/src/client.js` | 修 4 处 `ref` 命名；模型取词器；`.wg-note` 样式 |
| `plugins/capability-hub/src/catalog.mjs` | 新增，只读宿主 `llm` 注册表 |
| `plugins/capability-hub/src/http.mjs` | 新增 `GET /api/catalog` |
| `plugins/capability-hub/src/index.mjs` | 把 catalog 接进路由 |
| `plugins/capability-hub/tests/{catalog,client-render,http-catalog}.test.mjs` | 新增，14 项 |

`registry.json` 的文件格式**没变**：没有迁移，旧文件照常读。

## 生效条件

- **host 半必须重启**（`/api/catalog` 是新路由）。
- **客户端半只需硬刷新**：bundle 每次请求从磁盘读，rev 会变。
- 不需要重跑 `setup:components`：插件已在 profile 的 `bundles` 里。

## 风险

1. **`data-slot-error` 仍可能在别的入口出现**：错误边界把任何渲染异常都变成空 div，不区分原因。这次修的是唯一已知原因；以后再有空分区，先搜这个属性。
2. **候选下拉依赖 provider 命名**：`registry.mjs:43` 只接受 `capabilities.KINDS` 的四个接入点，所以只有名字与 `dashscope` / `qwen-token-plan` / `siliconflow` / `minimax` 完全相同的 provider 才会被列进候选。改名不会出错，只是没有候选。
3. **`listModels` 可能慢**：单个 provider 限时 4s，超时记进 `failures` 并继续，不阻断面板。
4. **测试依赖子模块**：`client-render.test.mjs` 需要 `deepseek-harness` 里的 react/react-dom/jsdom；没装依赖的机器会整组 skip（不是 pass、也不是 fail）。

## 回滚

未提交，所以回滚 = 丢弃工作区改动：

```bash
git checkout -- plugins/capability-hub   # 无效：插件目录本身仍是 untracked
```

正确做法：

- 只撤本轮：把 `src/client.js` 的四处 `authRef` 改回 `ref`（不建议，那会复现空白），或删掉 `src/catalog.mjs` 与 `http.mjs` 里的 `/catalog` 分支、`index.mjs` 的第三参数。
- 全撤插件：从 profile 移除后删目录。

```bash
npm run stop
npx --no-install dsh plugin --profile superagent-local remove dsh-capability-hub   # 或按 setup 脚本的 --remove 路径
```

## 后续

- 若真要让语音识别/合成的模型可选，正确路径是让语音插件注册进 `speechToText`，由它提供模型枚举；**不要**在网关里硬编供应商模型名。
- 这次的 jsdom 渲染测试是可复用的护栏：以后任何客户端半改动都该有一条"能渲染出内容且不落进 `data-slot-error`"的断言。
- 按 `AGENTS.md` §6 **未提交**。
