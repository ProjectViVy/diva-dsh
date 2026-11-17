# v0.8.1 worker 写今日卡规则升级到 v2 契约（支持 genui nodes）

## 一句话

`patches/superagent-worker-today.patch` 里注入的 `todayCards` 规则文本从旧契约
（`{"cards":[{"title","body"}]}`）升级到 v2：卡片可带一棵 genui spec `nodes`，
并写清常用节点、四项硬限制与内容底线。机制一个字没动——仍然只把 `todayCards`
拼进 `workerPrompt`（`superagent/src/app/context.ts`，编译进 `lib`），只有 worker
段拿得到，master / 普通 DSH 会话 / DSH 子 agent 都收不到。

主人指令（2026-11-17 00:1x）：「改一下。待会我重启。」

## 方案与依据（多·快·好·省）

**最简方案**：只替换 `context.ts` 里 `todayCards` 这个字符串数组的内容，补丁结构、
`workerPrompt` 拼接方式、`patches/superagent-patches.json`、构建脚本全部不动。
改完重新 `node scripts/build-bundle.mjs`，产物的 `lib/index.js` 里自然带新文案。

**备选**：给 worker 另加一个 `prompts/today.md` 或新增一条 patch。前者不会持久
——`prompts/*.md` 是运行时读盘，而 `withTemporaryPatch` 构建后会把补丁反向还原
（v0.8.0 已查清）；后者要多一条 manifest、一份新文件，收益只是「看起来更模块化」，
与本次「改一段规则正文」不成比例。

**依据**：① 既有补丁已经把机制跑通（worker part 追加、master 无该 part）；
② 这次是纯文案契约升级，最小的改动面就是四句 → 六句；
③ 旧规则里「标题与正文都必须有」已经被 v2 宿主放宽为「正文可选、nodes 可选」，
提示词必须同步，否则 worker 会继续写纯文字卡。

## 新规则正文（六句）

1. 收工（`orchestrator_report` 之前）把这一单让主人看得见的变化写进
   `$DSH_HOME/today/<YYYY-MM-DD>.json`；文件形如
   `{"cards":[{"title":"事件标题","body":"一两句内容","nodes":[...]}]}`；
   `title` 必填 ≤200 字、`body` 可选 ≤2000 字、`nodes` 可选。
2. `nodes` 是 genui spec 节点数组，右栏直接画；常用节点：
   `badge`（状态标签）、`text`（强调句或说明）、`chart`（数字对比，bars/line/donut，
   数据点最多 8 个）、`table`（多条并列）、`list`、`callout`（提示或风险）、
   `keyvalue`、`steps`、`timeline`。
3. 硬限制：每张卡 `nodes` 最多 40 个节点、嵌套最多 6 层、任意字符串最多 2000 字；
   一天最多 50 张卡；标题缺失、`nodes` 超限或不是数组的卡整张丢，坏 JSON 当今天没卡，
   既没 body 也没 nodes 的卡同样画不出来。
4. 一天一张文件：读后追加不覆盖；同一件事一天一条，有进展并进同一条，不重复开卡。
5. 只写真实发生的事：计划、猜测、没做成的都不写；卡里不写日期。
6. 内容底线：保留原文限定词（线索级 / 待核实 / 仅知悉 / 以官方当天排期为准这类），
   数字照抄，不把线索写成结论；没有联网，不外链图片、不编图片地址，需要图就用
   chart/table/list 这些节点画。

## 改了什么

- `patches/superagent-worker-today.patch`：只改 `src/app/context.ts` 的 `todayCards`
  文本（4 句 → 6 句）；补丁 hunk 从 `@@ -6,7 +6,18 @@` 变为 `@@ -6,7 +6,20 @@`。
- **没改**机制：`workerPrompt = ${promptFile('worker')}\n\n${todayCards}` 一行未动；
  `patches/superagent-patches.json` 未动（仍是 14 条）；`superagent/src` 未留下改动。
- **没改**测试断言：本轮没有新增测试文件；`tests/source-runtime.test.mjs` 的
  「14 条补丁按序」断言照旧通过。
- 数据文件与 `plugins/dsh-daily` 未动（v2 宿主/客户端已经在上一单交付）。

## 需重启

`npm run stop` → `npm start`（当前 3082 进程里加载的是旧 `lib`；本轮没有停/重启宿主）。
重启后新开的 ticket worker 会话提示词尾部会带这六句；master 与 DSH 子 agent 仍然没有。

## 未验证

- 重启后的运行期：worker 会话提示词是否真带六句、master 是否真没有（本轮用源码
  `promptParts`/`composePrompt` 取证，不是运行中的 3082）。
- 真实 worker 收工是否照新规则写出带 `nodes` 的卡（触发链与模型遵循度要等真实一单）。
- DSH 子 agent（spawn_teammate）仍然收不到这条规则——覆盖边界与 v0.8.0 相同，不试图
  在代码里解决。
