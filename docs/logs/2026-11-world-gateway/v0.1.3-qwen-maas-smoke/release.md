# 发布说明

## 改了什么

| 路径 | 类型 | 说明 |
| --- | --- | --- |
| `scripts/probe-world-gateway.mjs` | 新增 | 世界网关能力冒烟脚本。读环境变量里的 key，按能力逐条打真实请求，输出结构化证据 + 音频样本。 |
| `docs/research/world-gateway-qwen-maas-smoke.md` | 新增 | 实测结论与研究记录（§0 结论表、逐能力形状、要动什么）。 |
| `docs/logs/2026-11-world-gateway/v0.1.3-qwen-maas-smoke/` | 新增 | 四件套 + `probe-final.json` + 4 个 wav 样本。 |
| `TODOLIST.md` | 改 | 新增一条 `DV-DOC-009`，状态 `waiting-user`（等 D1/D2/D3）。 |

**没改**：`plugins/capability-hub/` 的任何源码、`$DSH_HOME/capability-hub/registry.json`、profile、宿主进程。

## 回滚

删掉上面三个新增路径 + 从 `TODOLIST.md` 撤回 `DV-DOC-009` 那一段即可，不涉及任何运行时状态。

## 给下一个动手的人

1. 别在 `capability-hub` 里按「OpenAI 兼容」写 adapter：`baseURL` 填兼容根对 TTS/ASR **没用**，要用 `{host}/api/v1/...`，所以插槽的 `baseURL` 语义在 dashscope 下其实是「主机根」而不是「OpenAI 根」。这个歧义要在写 adapter 前定掉。
2. TTS 拿到的 wav 必须先修头再算时长（`repairWav`）。
3. ASR 的 request 形状是文档写的 `type:'input_audio'` + `parameters.format/sample_rate`；`input_audio:{data}`（不带 `type`）在真音频上**没验证过**能不能用。
4. 本机代理会掐断大请求体；要测 base64 先把 `HTTPS_PROXY` 去掉。
