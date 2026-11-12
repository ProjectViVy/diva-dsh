# 验证记录 · v0.1.2

环境：Windows，Node v24.14.1，DSH 沙箱 workspace-write。`node --test <dir>` 会 spawn 子进程并 `EPERM`，
因此逐个测试文件直跑（`cmd /c "node … > log 2>&1"`，再用 `Get-Content` 读）。

## A. 测试

| 文件 | 结果 |
| --- | --- |
| `tests/candidates.test.mjs` | 5 pass / 0 fail |
| `tests/catalog.test.mjs` | 5 pass / 0 fail |
| `tests/registry.test.mjs` | 7 pass / 0 fail |
| `tests/http-catalog.test.mjs` | 4 pass / 0 fail |
| `tests/client-render.test.mjs` | 5 pass / 0 fail |

合计 26 条，0 失败。

`candidates.test.mjs` 覆盖的不变量：能力名/接入点名封闭在枚举内、每个能力都有默认模型且默认值就在候选里、
`presetFor` 的返回形状、有列表接口的接入点必须是 https、`presetIds` 无重复。

## B. 探索脚本（本机无 key）

```
预制候选核对 · 表最近核对日期 2026-11-11

dashscope  https://dashscope.aliyuncs.com/compatible-mode/v1  · unauthorized — HTTP 401
qwen-token-plan  (无列表接口)  · none — 该接入点没有列表接口（实测 404），只能手填
siliconflow  https://api.siliconflow.cn/v1  · unauthorized — HTTP 401
minimax  https://api.minimax.chat/v1  · unauthorized — HTTP 401
```

401 说明路由存在、只是没 key——与 §10.3 的探测结论一致。没有 key 时脚本不判失败（`--check` 也不跑对账）。

## C. 未执行

- 带 key 的对账（本机没有任何一家的 key）。
- 浏览器验收（需重启）。
