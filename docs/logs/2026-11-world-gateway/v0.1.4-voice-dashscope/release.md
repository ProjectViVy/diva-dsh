# v0.1.4 影响面与回滚

## 改了哪些文件

**`plugins/voice`（独立仓，未提交）**

| 文件 | 改动 |
| --- | --- |
| `src/service.mjs` | 线路表 `ROUTE_PACKS`/`ROUTES`/`routeOfPack`/`packOfRoute`/`isLoopbackRoute`；新增 `gatewayEndpoint()`（带路径的回环地址校验）与 `resolveEndpoint()`；`synthesizeCore`/`preview`/`rules`/`selfCheck`/`activate`/`update` 全部走线路表；`rules()` 多返回 `endpoints.dashscope` 与三键的 `ttsCharactersByRoute`；`synthesize` 按线路传 `speakPath` |
| `src/voice-packs.js` | `GATEWAY_PACK` 常量、`gatewayEndpointOf()`、`probeGateway()`；`manifests()` 仅在接线后加入该包；`statusOne`/`start`/`stop`/`test`/`remove`/`activate`/`isOwnedRunning` 的 external 分支；`probePort` 挡住非正整数端口；`voiceProcessPlan` 对它返回 `[]` |
| `src/voice-tts.js` | `repairWavHeader()` 导出；`synthesizeToFile` 新增 `speakPath` 参数；写盘前修头；无 `X-Duration-Ms` 时用 `wavDurationMs` 兜底 |
| `src/voice-diagnostics.js` | `voice.upstream-gateway` 新错误码；鉴权提示去掉火山专属措辞；`pickFallbackRoute` 新增可选 `backup` 参数 |
| `src/client.js` | 线路下拉加「世界网关（千问）」；新增「世界网关地址」输入框；`editTtsRoute`/`route` 收敛支持三线；chip 文案；第三个包也有「生成试听」 |
| `README.md` | 新增「世界网关语音包」一节（含与另外两个包的对照表与上游契约） |

**`plugins/capability-hub`（独立仓，未提交）**

| 文件 | 改动 |
| --- | --- |
| `src/adapters/dashscope-tts.mjs` | 新增：`synthesizeWithDashscope`、`repairWavHeader`、`wavDurationMs` |
| `src/http.mjs` | 新增 `POST /tts`（唯一的 invoke 路由）、`sendAudio`；只做路由，合成本体在 `speak.mjs` |
| `src/speak.mjs` | 新增：`createSpeak` / `HubError`——面板（HTTP）与语音插件（进程内）共用的同一份合成逻辑 |
| `src/index.mjs` | 新增 `ctx.provide('capabilityHub', { speak })`，让同进程的语音插件能直接调用 |
| `tests/http-tts.test.mjs` | 新增：7 项 |
| `tests/speak.test.mjs` | 新增：7 项，测进程内入口的分支与错误码 |

**`plugins/voice` 追加**

| 文件 | 改动 |
| --- | --- |
| `src/service.mjs` | `createVoiceService` 接受可选 `getHub`；`gatewayFetch()` 把一次 fetch 转成进程内调用并包成 `Response`，`synthesizeToFile` 的缓存与 wav 修复不变 |
| `src/index.mjs` | `ctx.inject(['capabilityHub'], ...)` 订阅网关服务（与接 `orchestrator` 同一写法） |
| `tests/voice-gateway-inprocess.test.mjs` | 新增（根仓库）：4 项，盯住「不许悄悄退回 HTTP」 |

**根仓库**

| 文件 | 改动 |
| --- | --- |
| `scripts/setup-capability-hub.mjs` | 新增：接线脚本 |
| `tests/capability-hub-setup.test.mjs` | 新增：5 项 |
| `package.json` | 新增 `setup:capability-hub` |
| `tests/voice-plugin.test.mjs` | 更新 4 处断言（三线路的 map / 包数量） |
| `TODOLIST.md` | 本条 |

## 运行时状态（`.artifacts/`，不入库）

- `.artifacts/dsh-home/voice/packs/voice-dashscope/{config.toml,.installed}`（新建）
- `.artifacts/dsh-home/voice/config.json`（改：`route` → `dashscope`，`enabled` → true）
- `.artifacts/dsh-home/capability-hub/registry.json`（改：`tts` 插槽启用）

## 回滚

三层都能单独退，不必整体撤：

1. **只想不再用它**（推荐，最轻）：语音页切回「本地」或「云端」线路。
   世界网关包的接线产物留着不影响任何东西。
2. **退掉默认值**：把 `.artifacts/voice-backup/voice-config.bak.json` 拷回
   `.artifacts/dsh-home/voice/config.json`；或手工把 `voice.tts.route` 改回 `local`、
   `enabled` 改回原来想设的值。
3. **退掉接线**：删 `.artifacts/dsh-home/voice/packs/voice-dashscope/`（这个包随即从
   列表消失），把 `registry.json` 的 `tts.enabled` 设回 `false`。凭据是你自己填的，删不删都行。
4. **退掉代码**：两个插件仓都**未提交**，`git -C plugins/voice status` 与
   `git -C plugins/capability-hub status` 会列出全部改动，`git checkout -- <file>` 即可。

## 与任务书的一处偏离

任务书要求语音包以**符号链接**形式存在，实际用的是**真实目录**。`voice-packs.js:304`
的 `packDir()` 在入口处 `lstat` 后拒绝符号链接（防包目录被替换，`voiceCharacters()` 与
参考音频读取都依赖它）。要满足任务书的字面要求，得先拆掉这条安全约束。取舍是不拆：
`setup-capability-hub.mjs` 在 `packs/voice-dashscope/` 写一份最小真实 `config.toml`
+ `.installed`，功能等价。

## 风险

- **花钱**：每次合成按字符计费，由阿里云百炼收取。默认线路现在是它，所以任何「让 diva
  说话」的路径都会产生费用。不想花就做回滚第 1 步。
- **单点**：网关挂了、宿主没起、key 失效，三条都会让语音直接失败——但失败是**明确报错**，
  不会静默降级成「没声音但说发了」。
- **未验**：见 `summary.md` 末尾三条。其中「真机合成一次」在验收清单第 3 项。
