# 发布 · v0.1.5（模思预接线）

本轮**没有提交**（仓库约定：用户说提交才提交）。

## 改动清单

### `plugins/capability-hub`（独立仓 `word-gateway`，非 submodule）

- `src/capabilities.mjs`：`KINDS` 加 `moss`；`KIND_BASE`；`CAPABILITIES` 加 `realtime`（`transport: 'websocket'`）；
  新增 `defaultsFor(capability, kind)`
- `src/registry.mjs`：按能力区分 `wss:// / https://` 校验；换 `kind` 时填该接入点预制基址与模型
- `src/candidates.mjs`：`LIST_BASE.moss`、`DEFAULT_MODEL.realtime`、模思展示名与四条候选；`VERIFIED_AT` → 2026-11-18
- `src/catalog.mjs`：`realtime` 说明 + `能力@接入点` 说明（`embedding@moss` / `decision@moss`）
- `src/client.js`：模思接入点、切接入点带出基址与首个候选、实时语音真插槽（只列模思）、
  删除旧占位卡与失效 CSS
- `scripts/explore-endpoints.mjs`：`MOSS_API_KEY`
- `tests/{registry,candidates,catalog,client-render}.test.mjs`：新增/更新断言
- `README.md`：六插槽、五接入点、模思接线表、MOSS-Live 约束、已知限制

### 根仓库

- `docs/research/moss-world-gateway-wiring.md`（新）
- `docs/logs/2026-11-world-gateway/v0.1.5-moss-prefab/`（新）
- `TODOLIST.md`：DV-DOC-010

## 注意：工作区里还有上一轮的未提交改动

`plugins/capability-hub` 里在本次之前就有 DV-VOICE-003 的未提交改动：
`src/http.mjs`、`src/index.mjs`、`src/speak.mjs`、`src/adapters/`、`tests/http-tts.test.mjs`。
提交时不要把它们与本轮混成一件事，也不要漏掉——建议分两条提交：

```bash
# 1. 上一轮的语音合成口子（如果还没提）
git add plugins/capability-hub/src/{http.mjs,index.mjs,speak.mjs} \
        plugins/capability-hub/src/adapters plugins/capability-hub/tests/http-tts.test.mjs
git commit -m "feat(capability-hub): add tts invoke route and dashscope adapter"

# 2. 本轮模思预接线
git add plugins/capability-hub docs/research/moss-world-gateway-wiring.md \
        docs/logs/2026-11-world-gateway/v0.1.5-moss-prefab TODOLIST.md
git commit -m "feat(capability-hub): pre-wire MOSS models and MOSS-Live realtime slot"
```

`plugins/capability-hub` 仍不是 submodule；等 `vivy-dsh/word-gateway` 建仓后再按子模块流程走。

## 生效条件

只改了插件（宿主半边与浏览器半边），**需要重启一次宿主**才进运行期；
浏览器半边硬刷新即可看到，但服务端 `defaultsFor` / `wss` 校验要等进程重启。
