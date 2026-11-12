# v0.1.1-render-fix 验收

前置：`npm run restart`（host 半改了，必须重启；客户端 bundle 每次请求从磁盘取，硬刷新即可）。

## 1. 分区有内容（核心）

打开 设置 → 世界网关。

**预期**：标题「世界网关」+ 一行说明 + 右上「已启用 0 / 5」+ 5 张能力卡（语音识别 / 语音合成 / 决策模型 / 向量化 / 全模态理解）+ 虚线占位卡「实时语音（未接入）」+ 底部灰字。

**不符时第一步**：F12 → Elements 里搜 `data-slot-error`。若出现 `<div data-slot-error="settings.section">`，说明组件仍在校验期抛错 → 把控制台第一条红字发我。

## 2. 模型字段可用

看每张卡的「模型」。

**预期**：输入框里已有默认值（如语音识别的 `qwen-audio-3.1-asr-flash`）。
- 决策模型 / 全模态理解：若你配了同名 provider，会出现「从 N 个候选填入…」下拉；选一项会把模型名填进输入框。
- 语音识别 / 语音合成 / 向量化：没有取词器，只有一行说明为什么只能手填（宿主不枚举这类模型）。

## 3. 保存与持久化

勾「启用」→ 改一个模型名 → 「保存」。

**预期**：出现「语音识别已保存」、状态点变绿、计数 +1；硬刷新后仍在；`npm run restart` 后仍在。
检查 `<DSH_HOME>/capability-hub/registry.json`：`slots.asr.enabled === true`，且全文没有 `sk-`。

## 4. 凭据与主设置共用

填一个假 key（如 `sk-test-not-real`）→「保存凭据」→ 状态变「凭据已配置（本地凭据文件）」→「清除」回到未配置。

## 5. resolve 面

浏览器打开 `/dsh-capability-hub/api/resolve?capability=asr`：启用时返回 `ok:true` + 一条 binding，关闭时 `ok:false, error:not_enabled`。

## 6. 占位卡不可交互

点「实时语音（未接入）」任意位置：没有输入框、没有按钮、Network 面板没有新请求。

## 7. 新路由（重启后）

浏览器打开 `/dsh-capability-hub/api/catalog`：应返回 `{"ok":true,"models":{...},"notes":{...},"failures":[]}`。
`models` 里 `decision`/`omni` 有内容说明 profiles 里有同名 provider；三个能力为空是**预期**，不是故障。
