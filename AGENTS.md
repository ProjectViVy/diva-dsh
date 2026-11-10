# AGENTS.md — diva-dsh 工作区常设指令

> 本文件是**常设指令**，DSH 会在每个会话第一次模型调用前注入它。
> 状态在 `TODOLIST.md`；证据在 `docs/logs/`；两者都不在这里复制。
> 只写「怎么在这个仓库干活」，不写人设、业务规则、具体任务。

## 0. 每次开工（三次工具调用内完成，顺序别改）

1. 读 `TODOLIST.md` 的 `## NOW` 一段（≤40 行）。
2. 读该条目 `日志:` 指向目录里的 `summary.md`，只看前 6 行块。
3. 需要更多历史再看同目录 `verification.md` 的「未验证」段。**不要从会话记忆推断进度，文件比记忆可靠。**

`NOW` 为「无」= 当前没有进行中的任务 → **直接问用户要做什么**。不要从旧文档、旧日志、`TODO` 注释里猜一个任务，也不要自己找活。

压缩、续跑、恢复会话之后，第一件事同样是重读 `NOW`。

## 1. 认领（没有 LOCK 文件，认领写在条目里）

动手前把这一行写进条目：

```text
状态: doing ｜ owner: <session-id> ｜ 开始: <YYYY-MM-DD HH:MM> ｜ Scope: <具体路径>
```

- `Scope` 精确到文件、目录或模块，足够让另一个会话判断是否冲突。
- 同 `Scope` 上已有别人的 owner → 停手，换条目或问用户；不要覆盖，也不要「先做再说」。
- 同一 git 仓同一时刻只跑一个 git 写操作（避免 `index.lock`）。
- 完成、阻塞或放弃时改回状态，并清掉 owner 与 Scope。

## 2. 收工（缺一项都不算完成）

1. 状态改 `done` / `blocked` / `waiting-user`，并写清下一步；`blocked` 必须写阻塞点。
2. 有交付 → 在 `docs/logs/` 新建或补齐四件套（`summary` / `verification` / `release` / `acceptance`）；无交付 → 条目里写「本轮无交付」，不建目录。
3. 本轮发现但没修的问题 → 进 `TODOLIST`（同一轮修完的不用写）。
4. 没验证的东西写进 `summary.md` 的「未验证」段；**禁止用「应该没问题」代替**。
5. 改过 `NOW` 或活跃区之后，更新文件头的「更新时间」。

## 3. 边界

- `deepseek-harness/`、`superagent/` 是上游 submodule，**只读**。需要行为改动走 `patches/`、插件或根 `scripts/`，不直接改上游源码。
- 不碰 `config.json`、`state/`、`~/.dsh` 里的 token 与密钥；输出前脱敏。
- 删除或覆盖前先备份，或 rename 到隔离目录；禁止不可逆删除。
- 涉及发布、对外发送、改用户数据时，先停下来问用户。

## 4. 写作约定

- 与用户沟通用中文；提交信息用英文 Conventional Commit 前缀（`feat:` / `fix:` / `docs:`）。
- 状态与证据分离：`TODOLIST` 只写状态与链接，设计进 `docs/`，经过进 `docs/logs/`。
- 日志只追加不改写；要更正就新开版本目录，或在同目录加 `notes.md`。
- 编号 `DV-<AREA>-<NN>`（AREA：`INF` `SC` `MEM` `AM` `ME` `LA` `EV` `UP` `REL` `DOC`）；严重度 `sev-P0`（阻断）～ `sev-P4`（观感）。
- 不自动提交：提交时机由用户或本轮任务决定。

## 5. Rulebook

**todolist-capture-required**：发现的问题必须进 `TODOLIST`，除非同一轮修完。
　正例：读到一处 `TODO` 但本轮不修 → 加一条带文件路径的条目。
　反例：在回复里说「以后要修」但不落文件。
　执行：收工前把本轮发现过一遍。

**iteration-log-required**：有交付必须有 `docs/logs/` 版本目录与四件套。
　正例：改完某一处行为 → `docs/logs/2026-11-memory-decay/v0.7.24-decay-window/`。
　反例：只改代码、只写聊天总结。
　执行：收工第 2 步。

**validation-required**：交付前跑与改动面匹配的验证，跑不了要说明原因。
　正例：改根 `scripts/` → `npm test`；改插件 → 该插件自己的测试。
　反例：「已改好」但没有任何命令输出。
　执行：把命令与结果写进 `verification.md`。

**upstream-read-only**：上游 submodule 的源码只读。
　正例：DSH 行为不符 → 写进 `patches/` 或改 `plugins/`。
　反例：直接编辑 `deepseek-harness/packages/...`。
　执行：提交前 `git status` 看 submodule 是否变脏。
