# v0.2.0 验证记录

## 1. 本次复跑（2026-11-21，上传轮）

| 套件 | 结果 |
| --- | --- |
| `plugins/capability-hub/tests/asr.test.mjs` | 13 / 13 / 0 失败 |
| `tests/asr-gateway-engine.test.mjs`（根） | 8 / 8 / 0 失败 |
| `tests/voice-settings-client.test.mjs`（根） | 22 / 22 / 0 失败 |
| `tests/capability-hub-setup.test.mjs`（根） | 5 / 5 / 0 失败（本轮按新行为改过断言，见 §3） |
| `tests/asr-mount.test.mjs`（根） | 3 / 3 / 0 失败（本轮补了假 ctx，见 §3） |
| **全量** `npm test`（`node --test tests/*.test.mjs`） | **1495 项 / 1485 通过 / 0 失败 / 10 跳过，exit 0**，耗时 68.5 s |

全量里那 10 项 `skip` 是各套件自己 `skip` 的（例如 `asr-sensevoice-e2e` 没有模型时跳过），不是本轮新增。

## 2. 当时的实测（2026-11-18，按现场日志引用，本轮未复跑）

### 2.1 上游形状（`.artifacts/gw-verify/asr-probe.log`）

```
A 裸串 · 24k [try=500] 48095ms status=500 transcript=""
B data URL · 24k [try=ok] 21260ms status=200 transcript="你好，我是diva。这是一条语音合成冒烟测试。"
C 裸串 · 24k · 3.0 [try=500] 78008ms status=500 transcript=""
```

- 裸 base64 **必须**包成 `data:audio/wav;base64,…`；否则 500，而且失败前会白等 48–78 秒。
- 这条形状钉进了 `tests/asr.test.mjs` 的一条用例，防止以后有人「顺手」改成裸串。
- 模型选择：同一段 2 秒官方样例里 `qwen-audio-3.0-asr-flash` 首词正确、`qwen-audio-3.1-asr-flash` 首词错；
  样本太小，只够选默认，不够定优劣——所以默认 3.0，可用 `DSH_ASR_MODEL` 覆盖。

### 2.2 隔离实例 3099 端到端（按 2026-11-19 的记录）

- `GET /dsh-asr/api/asr/catalog` → 200，`engine: "gateway"`，
  列出 `gateway / 世界网关（千问） / cloud / ready=true / qwen-audio-3.0-asr-flash`。
- 踢引擎后 `POST /dsh-asr/api/asr/transcribe` → 200，
  转写「你好，我是Diva。这是一条语音合成冒烟测试。」与原文一致，耗时约 21.7 s。
- 3082 全程未动（同一个 profile、同一个 `DSH_HOME`，只改端口）。
- **本轮没有复跑这一项**：复跑要重启 3082 或另起隔离实例并消耗真 key 额度；这次只做上传核对。

## 3. 上传核对时发现并修掉的两处测试回归

这两条都是「工作区里那批未提交改动」留下的问题——代码改了，测试没跟上。**不修就会把红着的套件推上去**。

### 3.1 `tests/capability-hub-setup.test.mjs`：断言「脚本不碰 asr 插槽」，而脚本正是去接线 asr

- 旧断言：`assert.equal(registry.slots.asr, undefined)`；脚本现在会写 asr 插槽，必然失败。
- 改法：断言 asr 插槽被接线（`enabled` / `kind: dashscope` / `authRef` / `model` / `baseURL` 与 tts 同源），
  幂等用例补「用户手填的 asr baseURL 与 model 不被改掉」，环境变量用例补 `DSH_ASR_MODEL` 覆盖。
- 结果：5 / 5 通过。

### 3.2 `tests/asr-mount.test.mjs`：假 ctx 没有 `inject`，`apply()` 直接抛错

- 现象：3 条挂载契约全部 ✖，而且**进程不退出**（`apply` 在注册 `t.after` 之前就抛了，测试里的 HTTP
  server 没人关，120 秒后被杀）。
- 原因：`plugins/asr/src/index.mjs` 新增 `ctx.inject(['capabilityHub'], …)`，而假 ctx 只实现了 `get`。
- 改法：给假 ctx 补 `inject(names, callback)`，返回空订阅取消（这个替身没有 `capabilityHub`，
  回调不触发，正好是「网关没挂载」那条路径）。
- 结果：3 / 3 通过，进程正常退出。

## 4. 顺带修掉的换行符污染

- 根仓 `tests/voice-settings-client.test.mjs`：工作树 CRLF、索引 LF，`git diff` 显示整文件 1391 行变更，
  真实改动只有 47 行。已把工作树统一成 LF，diff 回到 47 行。
- `plugins/asr/src/index.mjs`：同样的 CRLF/LF 不一致（整文件重写），提交前统一成 LF，diff 回到 14 行。

## 5. 没验的（如实列）

1. `/dsh-capability-hub/api/asr` 这条 **HTTP 面**的活体往返：只有单元测试；面板真正走的是进程内路径。
2. **多语言提示透传**：`languages:['auto']` 是保守声明，没有用真上游验过 zh/en 提示是否被采纳。
3. **连续多次识别的限流与计费**：只做了单次端到端。
4. **3082 真面板观感**：四条来源标识只在渲染测试里过。
