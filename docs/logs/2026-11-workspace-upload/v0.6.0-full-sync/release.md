# v0.6.0 影响面与回滚

## 影响面

这次上传本身**不改运行期行为**：它只是把已经在本地工作区跑了很久的改动落成提交并推到远端。
真正的运行期变化是那批代码（世界网关 ASR 能力服务）——它在 3082 上要重启一次才生效，
影响面与回滚写在 `docs/logs/2026-11-world-gateway/v0.2.0-capability-service-asr/release.md`。

| 仓 | 远端分支 | 变化 |
| --- | --- | --- |
| `diva-dsh`（根） | `main` | 代码 1 条 + 文档 2 条；3 个 gitlink 指针前移 |
| `dsh-local-asr` | `main` | 新增网关引擎；订阅 `capabilityHub` |
| `dsh-local-voice` | `main` | 面板来源标识 |
| `word-gateway` | `main` | `transcribe` 服务 + `/api/asr` 路由 + 适配器 + 测试 |

另外 22 个 submodule 的指针**一个都没动**。

## 已有子模块的影响

三个被前移的 gitlink 都是独立仓的 `main` 分支线性提交，没有改默认分支历史：

- 拉取方执行 `git submodule update --init --recursive` 会拿到新提交（它们都已推到上游，可直接取）。
- 只想停在旧行为：在根仓 `git checkout 9c272c3 -- plugins/asr plugins/voice plugins/capability-hub`
  再 `git submodule update`，三个子仓回到 `49f6a48` / `6cebdf6` / `1fb9bc3`。

## 回滚

1. **只退根仓的文档与指针**：`git revert <docs commit> <c84b578>`；revert 会把三个 gitlink 一起退回。
2. **连子仓提交一起退**：先在各自子仓 `git revert e9dc44b` / `0e87e6b` / `937e811` 并推送，
   再回到根仓 revert `c84b578`（顺序反过来会让根仓的指针指向不存在的提交，fresh clone 会失败）。
3. **什么都不退，只是不想用**：语音页把识别引擎切回 `SenseVoiceSmall（本地）`，或把
   `registry.json` 的 `asr.enabled` 关掉——代码留着不花钱也不出声。

## 风险

- **没有强推**，远端历史只做了快进（fast-forward）。如果远端在这期间被别人推过，
  这次推送会失败而不是覆盖——看到失败请先 `git pull --rebase` 再推，不要 `--force`。
- **两个插件仓的 `main` 现在包含了本轮提交**；`plugins/dsh-evolution` 与
  `plugins/dsh-continual-harness` 仍然锚在 `codex/native-refinement-20261117` 分支上，这是既有状态，本轮没动。
- **没有重启宿主**：推上去的代码在 3082 上还没生效，别把「已上传」当成「已验证」。
