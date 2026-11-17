# 验证记录 · v0.1.5（模思预接线）

环境：Windows，Node v24.14.1，本机 DSH 宿主未重启（3082 仍跑旧代码）。`node --test <dir>` 会 spawn
子进程并 `EPERM`，因此插件测试逐个文件直跑。

## A. capability-hub 测试

| 文件 | 结果 | 与本轮相关的新断言 |
| --- | --- | --- |
| `tests/candidates.test.mjs` | 6 pass / 0 fail | 模思候选按能力归组；`realtime` 只有 `moss-live-1.0`；模思没有向量 / 决策候选 |
| `tests/catalog.test.mjs` | 6 pass / 0 fail | `models.{asr,tts,omni,realtime}.moss` 内容；`embedding@moss` / `decision@moss` 说明 |
| `tests/registry.test.mjs` | 9 pass / 0 fail | 六个默认插槽；`realtime` 默认 `wss://` + `moss-live-1.0` + `MOSS_API_KEY`；切模思带出基址与首个候选；`realtime` 拒绝 https、其它能力拒绝 wss；模思无向量时保存被拒 |
| `tests/client-render.test.mjs` | 5 pass / 0 fail | 六张卡、计数 `0 / 6`、接入点列表含「模思 · MOSS API」；目录失败仍渲染六张 |
| `tests/http-catalog.test.mjs` | 4 pass / 0 fail | 未改 |
| `tests/http-tts.test.mjs` | 7 pass / 0 fail | 未改；其中「非 dashscope 的接入点如实报没有适配器」覆盖模思 tts 的未来路径 |

合计 **37 pass / 0 fail**。

## B. 根仓相关测试

| 命令 | 结果 |
| --- | --- |
| `node tests/capability-hub-setup.test.mjs` | 5 pass / 0 fail |
| `node tests/mempalace-cloud-embedding.test.mjs` | 8 pass / 0 fail（它的 registry 夹具只有 `embedding` 插槽，新增能力不影响读取） |
| `npm test` | **1480 项 / 1469 通过 / 1 失败 / 10 跳过，exit 1** |

唯一失败是 `tests/memory-actmem.test.mjs:175`「records, updates and restores from another subject are rejected」
（`backups()` 返回空 → `join(fresh,'backups',undefined)`）。这是已知的**运行时段**问题：
`TODOLIST.md` DV-UI-009 已记录「`memory-actmem` 时间窗失败……仍未修」，本次运行在 04:00 之前，
单独重跑同样失败。与本轮改动无关（该测试不经过 capability-hub）。

## C. 端点探测（无 key，2026-11-18 03:0x）

`node plugins/capability-hub/scripts/explore-endpoints.mjs`：

```
dashscope  …  unauthorized — HTTP 401
qwen-token-plan  (无列表接口)  · none
siliconflow  …  unauthorized — HTTP 401
minimax  …  unauthorized — HTTP 401
moss  https://api.mosi.cn/v1  · unauthorized — HTTP 403：{"error":{"code":"102111001",…,"message":"missing bearer api key"…}}
```

直接探测（`curl`）：

| 请求 | 结果 | 读法 |
| --- | --- | --- |
| `GET https://api.mosi.cn/v1/models`（无 key） | 403 `missing bearer api key` | 主机与路由存在 |
| 同上（`Bearer invalid-key`） | 403 `iam api key auth failed` | 鉴权层在工作 |
| `POST /v1/audio/speech` 等四个端点（无效 key） | 403 鉴权错 | 路由存在 |
| `GET https://api.mosi.cn/v1/definitely-not-a-route` | 404 | 403 不是「所有路径都 403」 |
| `GET https://api.moss.cn/v1/models` | 404 | `api.moss.cn` 不是 API 主机 |
| `GET https://platform.mosi.cn/en/docs/...` | 302 → `platform.moss.cn` | 文档站两个域名同一站 |

## D. 未执行

- 带 `MOSS_API_KEY` 的 `/v1/models` 对账（本机没有模思 key；`.credentials.yaml` 只有
  `OPENDESIGN_API_KEY` / `DASHSCOPE_API_KEY`）。
- 任何模思推理请求与 WS 握手。
- 3082 真面板验收（宿主未重启，见 `acceptance.md`）。
