# v0.2.0 diva-dsh 开发规则（AGENTS.md 重写）

- 状态：已交付（仅文档，无代码改动）
- 范围：`AGENTS.md` 从 73 行协议骨架扩写为 86 行的项目开发规则：仓库结构、改动落点、构建验证、环境事实、红线、提交纪律、Rulebook；文件头固定一行「开工第一件事：读 TODOLIST 的 NOW」
- 验证：见 `verification.md`（行数、路径存在性、命令可执行性、Node 版本）
- 未验证：规则是否被后续会话照做（只能靠实战）；其它会话的并行改动未纳入
- 下一步：无，`NOW` 不动（`TODOLIST` 正被另一会话编辑）
- 回滚：`git checkout -- AGENTS.md` 回到 v0.1.0 版

## 改了什么

从「只写协议」扩成「协议 + 这个仓库的具体规矩」，新增六块：

1. **仓库是什么**：源码级启动器；18 个 submodule（3 上游 + 15 本地仓）；根仓只放 scripts/tests/patches/docs/skills/stage-app 与指针。
2. **改哪里**：一张落点表，把「Superagent 改 patches」「SurfCore 改 `scripts/lib/surfcore-*.mjs` 锚点补丁（不碰子模块）」「新能力进 `plugins/<name>`」写成明确规则。
3. **构建、启动、验证**：`npm run setup` / `start` / `stop` / `status`，`npm test`（`node --test tests/*.test.mjs`），改插件跑插件测试，改代码要重启才生效。
4. **环境事实**：`DSH_HOME=.artifacts/dsh-home`（不是 `~/.dsh`）、profile 是 `superagent-local`、`.artifacts` 不入库、`.workspace` 是参考源；附一条 `pwsh` 沙箱报错的排查线索。
5. **红线**：上游三仓只读、不含专有资产、不含密钥、删除可回滚、升级后先 `setup` 自检。
6. **提交纪律 + Rulebook**：一次一件事、不混 submodule 指针、不自动提交；规则从 4 条扩到 6 条（新增 `submodule-pointer-discipline`、`asset-license-guard`、`no-secret-commit`，合并状态与证据为 `state-and-evidence-required`）。

## 影响面

- 每个会话的常驻指令从 ~73 行增至 84 行（约 +0.3k token）。
- 不改代码、不改配置、不重启服务。
- 与旧版相比没有删除协议条款，交付/太态流程原样保留。

## 未验证

- 规则是否真的被后续会话执行（尤其「改哪里」表，只有在真有人要改 Superagent/SurfCore 时才知道是否被遵守）。
- `npm run setup` / `npm test` 本次未跑（纯文档改动，跑它们没有意义）；因此「命令可用」只是从 `package.json` 与历史记录推断，不是本次实测。
- 另一会话正在改 `TODOLIST.md`，本文件头部的指针未与其同步版本对齐。

## 备注

- Live2D Cubism Core 在本机**不存在**（`Test-Path` 为 False），符合「使用者自备、不入库」的设计；规则里写明了这一前提，避免下个会话以为文件丢了。
- `docs/logs/2026-11-im-gateway/` 与 `docs/research/im-gateway-unification.md` 是并行会话的在途产物，本目录未读写。
