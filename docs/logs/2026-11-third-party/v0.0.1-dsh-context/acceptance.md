# v0.0.1-dsh-context 验收步骤

前置：本机 `0.2.1-rc.5`，profile `superagent-local`，`third-party/dsh-context` 已在 `v0.83.1` 且 `lib/` 已构建（本轮已完成）。以下全部**需要停面板**，因为要改 profile 注册。

## 一、注册（4 条命令）

```bash
npm run stop
npm run setup:third-party
npm run start
npm run setup:third-party -- --check
```

预期：

- 第 2 条打印 `== Register dsh-context`，`dsh plugin --profile superagent-local add link:.../third-party/dsh-context` 退出 0，最后打印 `dsh-context registered in superagent-local.`；因为 `lib/` 已在，不应再触发 `pnpm install`。
- 第 4 条退出码 **0**，输出 `All third-party plugins are pinned, built and registered.`

失败判据：

- 退出 1 且含 `pin:` → 子模块被切到别的版本，`git -C third-party/dsh-context checkout v0.83.1`。
- 退出 1 且含 `compatibility:` → 插件声明的 DSH 区间不再覆盖本机版本，**停下来问**，不要改这个校验去迁就插件。
- 含 `build:` → `npm run setup:third-party -- --build`。

## 二、端内（浏览器）

1. 硬刷新 `http://127.0.0.1:3082`。
2. 「设置」出现 **Context** 分区；未出现则看浏览器控制台是否有 `dsh-context/client` 的加载错误，并记录是哪个 `dsh.client.inject` 模块缺失。
3. 打开任意会话，输入 `/context`，应返回当前上下文组成（系统提示、工具、消息各占多少）而不是「未知命令」。
4. 在该会话触发一次压缩（或等记忆层压缩），Context 面板应出现压缩事件与前后对比。

## 三、回归（这个插件很容易抢上下文，必须验）

5. 新会话首条消息里 `【记忆卡` 仍存在（`dsh-local-memory` 的 runtime context 注入未被挤掉）。
6. `npm run status` 各部件无 error（尤其 `dsh-superagent`、`surfcore`、`dsh-local-memory`）。
7. 面板整体无白屏、无重复的「Context」入口。

## 四、回滚

```bash
npm run stop
npm run setup:third-party -- --remove
npm run start
```

`third-party/` 下的源码保留。若要连源码一起撤：

```bash
git submodule deinit -f third-party/dsh-context
git rm -f third-party/dsh-context
```

再删 `pins.json` 里的 `dsh-context` 条目。

## 五、本轮实际执行到哪

| 步骤 | 状态 |
| --- | --- |
| 源码检出到 `v0.83.1` | ✅ 已完成（`a37a72c`） |
| `lib/` 构建 | ✅ 已完成（`index.js` 182.93 kB、`client.js` 942.91 kB） |
| pin / 版本 / 声明三向校验 | ✅ 已完成（`--check` 通过，仅报「未注册」） |
| 单测 | ✅ 10/10 |
| profile 注册 | ⛔ 未做（需停面板，本会话由该面板托管） |
| 端内 1–7 | ⛔ 未做 |
