# v0.1.1-render-fix 验证记录

环境：Windows，Node v24.14.1，运行中的 DSH `0.2.1-rc.5`（profile `superagent-local`，19 bundles），端口 3082。

## 一、先证伪"没挂上"

| # | 命令/检查 | 期望 | 实际 |
| --- | --- | --- | --- |
| 1 | `GET /dsh-capability-hub/api/state`（无会话） | 401 说明路由存在 | ✅ 401；对照 `GET /definitely-not-a-real-path-xyz` → **404**，两者不同 → 路由真实存在 |
| 2 | 状态目录 | host 半 `apply` 会创建 | ✅ `<DSH_HOME>/capability-hub/` 创建于 08:05:50（用户这次重启） |
| 3 | Client Slots 树 `settings.section` | `world-gateway` 注册且 active | ✅ `id: world-gateway`、`order: 9`、`active: true` |
| 4 | 服务端下发的 bundle vs 磁盘源码 | 一致 | ✅ 逐字节一致，仅多一行 sourcemap 注释（修复前 rev `60299b8f970c`） |

结论：host 半、客户端 bundle、slot 注册三者都正常。问题只在组件渲染。

## 二、复现与修复

| # | 做法 | 结果 |
| --- | --- | --- |
| 5 | `react-dom/server` + 真实 React 渲染分区 | ⚠️ 只报 `Missing getServerSnapshot`（SSR 特有），**没有**暴露真 bug —— 假阴性 |
| 6 | `jsdom` + `react-dom/client` 渲染（真实客户端路径） | ❌ 捕获 `Function components cannot have string refs` |
| 7 | 在内存里把 `ref` 改成 `authRef` 后同一环境再跑 | ✅ 无异常，5 张卡片，11833 字节 |
| 8 | 修复后重新取页面里的 bundle（rev `2d677ee825cb`） | ✅ 含 `authRef, cred`、含取词器文案、含 `/catalog`，不含旧写法 |

## 三、测试

`node --test "plugins/capability-hub/tests/*.test.mjs"` → **21 pass / 0 fail**（2.8s）

| 文件 | 数量 | 覆盖 |
| --- | --- | --- |
| `tests/registry.test.mjs` | 7 | 原有用例未改动 |
| `tests/catalog.test.mjs`（新） | 5 | 同名 provider 才进候选、omni 只留音频/视频、缺 `llm` 时全空且有原因、单家抛错隔离、`listProviders` 抛错不冒泡 |
| `tests/client-render.test.mjs`（新） | 5 | 组件参数不再含 `ref`、就绪态 5 张卡且无 `data-slot-error`、加载/错误态有文案、有候选出取词器/无候选出说明、目录失败不影响渲染 |
| `tests/http-catalog.test.mjs`（新） | 4 | `/catalog` 正常返回、目录抛错转 400、无读取器时返回空形状、非本机 Host 403 |

> `client-render` 依赖 `deepseek-harness` 子模块里的 react/react-dom/jsdom；缺装时整组 `skip`，不让别的机器变红。本机实际执行、未跳过。

## 四、活体 HTTP 端到端（对运行中的实例，带 token 会话）

| # | 操作 | 结果 |
| --- | --- | --- |
| 9 | `POST /slot` 启用 asr | ✅ `enabled: true` |
| 10 | `GET /resolve?capability=asr` | ✅ `{"ok":true,"bindings":[{capability:asr,kind:dashscope,...,authRef:DASHSCOPE_API_KEY}]}` |
| 11 | 读 `<DSH_HOME>/capability-hub/registry.json` | ✅ 落盘且 `enabled: true` |
| 12 | `POST /credential` 写 `DASHSCOPE_API_KEY` | ✅ `{"configured":true,"source":"file","writable":true}` |
| 13 | registry.json 是否含明文密钥 | ✅ 不含 `sk-` |
| 14 | `POST /credential` 清除 | ✅ `{"configured":false,"writable":true}` |
| 15 | `POST /slot` 关闭 asr → resolve | ✅ `{"ok":false,"error":"not_enabled","bindings":[]}` |
| 16 | `POST /slot` 传非法 `kind: nope` | ✅ HTTP 400 `{"code":"REJECTED","error":"未知接入点类型：nope"}` |
| 17 | `GET /api/invoke` | ✅ 404（本轮仍未提供调用面） |
| 18 | 恢复基线 | ✅ `asr.enabled=false`（与开始时一致）、凭据回到未配置 |

## 五、没验证的

- **`/api/catalog` 的活体响应**：新路由要重启进程才注册，当前实例仍返回 404。路由接线由 `http-catalog.test.mjs` 覆盖，目录内容由 `catalog.test.mjs` 覆盖。
- **浏览器点击流**：我无法驱动你的浏览器。端内是否真的出 5 张卡，要你重启后看一眼。
- **候选下拉是否有内容**：取决于 profile 里是否配了名称与接入点同名的 provider（`dashscope` 等）。没有则按设计显示"为什么只能手填"。
