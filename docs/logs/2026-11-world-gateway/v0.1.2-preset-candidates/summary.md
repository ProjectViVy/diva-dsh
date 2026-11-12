# v0.1.2 · 预制候选 + 端点探索脚本

2026-11-11。在 `v0.1.1`（分区渲染修复 + 宿主候选目录）之上，补上「不靠宿主、离线也有候选」。

## 目标

世界网关的模型输入框在 `asr` / `tts` / `embedding` 上一直只能手抄 id——DSH 只有 chat 模型注册表。
用户决定：**默认预制**，并且**用脚本核对一遍端点**，以后补默认值只改一行。

## 做了什么

1. `src/candidates.mjs`（新）：`PRESET[能力][接入点]` + `DEFAULT_MODEL[能力]` + `LIST_BASE[接入点]` + 展示名。
   只放确认过的 id；不确定的名字不写（候选里出现错名字比空着更糟）。
2. `src/capabilities.mjs`：五个能力的 `defaults.model` 改从 `DEFAULT_MODEL` 取——默认值只有一处定义。
   顺带把 `omni` 的默认从 `qwen-omni`（不是有效 id）改成 `qwen-omni-turbo`。
3. `src/catalog.mjs`：`/api/catalog` 先铺预制候选，再追加宿主 provider 的模型，按 id 去重；
   宿主那半标 `source: 'host'`，预制标 `source: 'preset'`。
4. `scripts/explore-endpoints.mjs`（新）：拉四家的 `/models`，与本表对账，报「命中 / 不在列表 / 未归类」；
   `--json` 机器可读，`--check` 有 key 时缺 id 就非 0 退出。
5. 测试：`tests/candidates.test.mjs`（5 条不变量）、`tests/catalog.test.mjs` 改为断言「预制在前、宿主在后、同名不重复」。

## 为什么不做在线刷新（本轮）

`/models` 只回 id，没有能力标签，自动归类就是猜；而且它要带 key 出网。所以本轮只做静态预制 + 核对脚本，
在线刷新留在 `docs/research/capability-hub-slots.md` §10.4 的 A 方案（约 4 小时）。

## 证据

`npm`：见 `verification.md`——4 个测试文件 21 条全过；探索脚本对本机（无 key）跑通，如实报 3 个 401、1 个无接口。

## 未验证

1. **预制 id 没有拿真 key 核对过**：本机 `.credentials.yaml` 里只有 `OPENDESIGN_API_KEY`，没有百炼 / 硅基流动的 key。
   → 填上 key 后跑 `node scripts/explore-endpoints.mjs --check`。
2. 浏览器端：下拉是否真的列出候选、选中后是否写进插槽，要重启后手点（`acceptance.md`）。
3. 百炼兼容模式列表是否包含原生 ASR/TTS 模型（`qwen-audio-3.1-*`）——同样要 key 才知道。

## 下一步

重启看端内 5 步（`acceptance.md`）；有 key 后跑一次 `--check` 校正候选表。
