# 验证记录：左栏 dsh-ui 围栏

## 1. 单元与全量测试

```
node --test tests/daily-client.test.mjs
ℹ tests 46   ℹ pass 42   ℹ fail 0   ℹ skipped 4

npm test
ℹ tests 1427  ℹ pass 1417  ℹ fail 0  ℹ skipped 10   (exit 0)
```

- v0.7.0 基线：daily-client 39/35/0/4，npm test 1420/1410/0/10；两处都是 +7（新增的 7 条），
  没有旧用例转红。
- 4 条跳过是 html 围栏那组（`FREE_HTML_UI === false` 时不跑），与本次无关。

新增的 7 条：

| 用例 | 断言要点 |
| --- | --- |
| `splitDshUiFences` 分段 | 两段围栏切成 5 段、顺序不乱 |
| `parseSpecFence` 单组件根 | `{"type":"card"}` 包成 items，不丢 items |
| 气泡里一张卡 | `.dl-spec` 1 个、标题/正文/围栏正文都不留 ``` |
| 多段围栏 | 两张卡各自只装自己的内容，中间文字照常 |
| 画不出来就降级 | `.dl-spec` 0 个，围栏原文当文字留下 |
| 没闭合的围栏 | `.dl-spec` 0 个，后面那句正文还在 |
| 七个新节点 | table 表头/单元格、bars 三行、steps 当前步、timeline、code+json、link 协议过滤 |

## 2. html 通道回归（翻开关跑一遍再翻回来）

`FREE_HTML_UI` 临时改成 `true`：`daily-client` **46 项 / 44 通过 / 0 失败 / 2 跳过**
（跳过的变成「关掉 html 时才跑」的那两条），跑完已改回 `false`。说明新的 dsh-ui 分段没有
踩坏 html 围栏那条路。

## 3. 真 Chrome（隔离实例，3083）

实例建法：`.artifacts/dsh-daily-verify-home`（新 DSH_HOME，profile `daily-verify`：base +
web-app + dsh-superagent + dsh-daily + genui；`node_modules` 用 junction 复用 3082 那份已装好的包；
stateDir 指到本目录，端口 3083）。宿主日志 `.artifacts/dsh-daily-check/oneoff-20261115/spec-fence/verify-host.log`。

同一条 master 会话（`orchestrator-…`）走两条渲染路径：

| 视图 | 证据 |
| --- | --- |
| 日常左栏 | `.dl-spec` 4 个、`.dl-g-chart-fill` 9 条（3 图 × 3 条）、表格 `项目/数量/写完 3/完成 1`、根标题「今天三件事」、**assistant 正文里 ``` 计数 0**、`.dl-msg--ui` 4 个 |
| 普通会话 | `.genui-dom-fence` 4 个（一个 742×211），同一个标题 + 竖版 bars + 表格；同一批消息 |

截图（1440×900，真 Chrome channel=chrome）：

- `.artifacts/dsh-daily-check/spec-fence-01-daily-left.png` —— 日常页整屏，左栏两张卡（bars + 表格）
- `.artifacts/dsh-daily-check/spec-fence-02-daily-left-crop.png` —— 左栏聊天气泡放大
- `.artifacts/dsh-daily-check/spec-fence-03-normal-session.png` —— 同一会话的普通视图，genui 自己的卡

页面 console 无 error、无 pageerror；genui 客户端日志 `[genui] client active; fence-channel=dom`
在隔离实例里照常出现（说明 genui 在，只是看不到日常那棵树）。

## 4. 没做的验证

- 3082 真面板：不改宿主、不拿面板 token（主人正在用），所以「硬刷新就生效」是按代码性质推断的
  结论，需要在面板里硬刷新后看一眼。若显示围栏原文 → 走 release.md 的重启步骤。
