# dsh-vivy-tone

Superagent 的提示词中文版，一个开关。

## 它做什么

Superagent 会给自己 compose 一段约 43 KB 的英文提示词。主 Session 那段是 `complete`，
所以任何第三方插件贡献的 section 都会被丢掉——唯一的入口是 Superagent **自己的**提示词接口
（`PUT /orchestrator/api/prompts`，也就是它面板用的那个）。本包把**本包负责的那几个 part**
换成中文，让你能在 **Settings → Prompts → Full prompt** 里读和改。

**只是可读性**：同一份契约，换成中文。不增删、不弱化任何一条规则，也不含人格内容——
Laputa 仍是唯一人格事实源（`docs/architecture.md` §17 invariant 4）。

## 开关

| 动作 | 命令 |
| --- | --- |
| 开（装好默认开） | 启动时自动写入，或 `node plugins/dsh-vivy-tone/src/cli.mjs --install` |
| 关 | `node plugins/dsh-vivy-tone/src/cli.mjs --remove`（回到内置英文） |
| 看状态 | `node plugins/dsh-vivy-tone/src/cli.mjs --status` |
| 只看计划 | `node plugins/dsh-vivy-tone/src/cli.mjs --install --dry-run` |

每次保存都是 Superagent 提示词历史里的一个版本，**Settings → Prompts → History** 一键回退；
单个 part 也可以在面板里直接 reset。

## 它不覆盖你手改的内容

`PUT` 是整体替换，所以本包：

- 保存时把你没碰过的 team section、skills 和别人的 override **原样带过去**（丢掉就等于删掉它们）；
- 一个**不是本包写的** override，本包绝不覆盖（除非 `--force`）。判断靠状态文件里记的哈希：
  `$DSH_HOME/vivy-tone/installed.json`。

## 翻译的硬约束

- 模板占位符逐字保留：`{variables}` `{version}` `{mode}` `{rules}`——少一个 Superagent 直接拒。
- 工具名与字段名保留英文：`orchestrator_reply`、`ticket_id`、`human_action`、`attention.question`、
  `model_retry`、`accept`/`attach`/`stop`/`ignore`、`blocked`/`failed`。
- 领域词保留英文：`ticket`、`thread`、`candidate`、`follow_up`、`worker`、`## Policy`。
- 对外披露文案原样保留（例如 GitHub 上的机器人声明）。

## 分批

| 批 | part | 状态 |
| --- | --- | --- |
| 1 | `runtime/orchestrator`、`runtime/handoff/orchestrator`、`runtime/environment`、`runtime/policy`、`runtime/policy/none` | 已翻、已装 |
| 2 | `runtime/dispatch`、`runtime/admission` | 待翻 |
| 3 | 团队段 `communication` / `scope` / `delivery` | 待翻 |
| 4 | `runtime/shared`、`runtime/subscriptions`、`runtime/replies` | 待翻 |
| 5 | `runtime/worker`、`runtime/work`、`runtime/handoff/worker` | 待翻 |
| 6 | `skill/feishu`、`skill/github` | 待翻 |

新的一批就是往 `src/zh.mjs` 的 `TRANSLATIONS` 里加条目。`--install` 只写还没覆盖的 part，
已经装的会跳过，所以分批之间不需要顺序。

## 注册与测试

```bash
npm run stop && npm run setup:vivy-tone && npm run start
node --test tests/vivy-tone.test.mjs
```
