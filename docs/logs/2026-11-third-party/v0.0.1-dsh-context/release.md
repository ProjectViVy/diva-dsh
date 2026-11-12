# v0.0.1-dsh-context 交付与回滚

## 交付物

| 文件 | 性质 |
| --- | --- |
| `third-party/dsh-context` | 新 submodule，pin 在 `v0.83.1`（`a37a72c`），`--depth 1` |
| `third-party/pins.json` | 新增，第三方插件的唯一版本事实源 |
| `scripts/lib/third-party.mjs` | 新增，pin/兼容/产物的只读校验 |
| `scripts/setup-third-party.mjs` | 新增，`--check` / `--build` / `--remove` / 默认注册 |
| `tests/third-party-setup.test.mjs` | 新增，10 项 |
| `package.json` | +1 行 `setup:third-party` |
| `.gitmodules` | 自动新增 `third-party/dsh-context` 条目 |

## 为什么这样切

- **为什么不放 `plugins/`**：`plugins/*` 是我们自己的仓（`vivy-dsh/*`），语义是「我们写的插件」。第三方社区插件放 `third-party/`，一眼能分清谁维护、能不能改、升级以谁为准。
- **为什么用 submodule 而不是 `pnpm add`**：只有源码级才能读实现、按需打补丁、锁到具体 commit。代价是必须自己构建（上游 `.gitignore` 排除了 `lib/`），所以 setup 脚本把「构建」和「注册」放在一条命令里。
- **为什么 pin 要校验而不是只记录**：DSH 处在 developer preview，`0.1.0-rc` / `0.2.0-rc` / `0.2.1-rc` 之间插件契约会断。只写注释的话，`git submodule update --remote` 一次就漂走，而症状是面板白屏，很难查。现在漂移会直接报 `pin:`。
- **为什么不做一个通用插件市场/安装器**：现在只有一个插件。一个 pin 文件 + 一个遍历脚本，加插件的边际成本是「加 submodule + 加一条 JSON」。等真到 5 个以上再考虑抽配置层。

## 风险

1. **profile 注册会改 `.artifacts/dsh-home/profiles/superagent-local/{package.json,pnpm-lock.yaml}`**：这是 `.artifacts/` 下的生成物，`npm run setup` 会重写。**若重跑 `npm run setup` 后插件消失，重跑一次 `npm run setup:third-party` 即可**——这不是缺陷，是当前 setup 不读 `pins.json` 的已知缺口，已在 TODO 里留了口子。
2. **`lib/` 是 gitignore 的构建产物**：别人 clone 后不跑 setup 就没有，`--check` 会报 `build:`。不要为了「让检查通过」把 `lib/` 提交进子模块。
3. **客户端半未验证**：`dsh.client.inject` 六个依赖里只要有一个不在运行时模块图，控制台会报加载失败而宿主不报——验收第一步就看浏览器控制台。
4. **`/context` 与记忆层的关系未验**：它读的是投影后的上下文；若它把 `【记忆卡` 之类的注入内容也统计进去，数字会和我们对「上下文构成」的既有认知不一致。以面板实际数字为准，不要反过来改记忆层的阈值去凑。

## 回滚

```bash
npm run stop
npm run setup:third-party -- --remove
npm run start
```

源码级完全撤除：

```bash
git submodule deinit -f third-party/dsh-context
git rm -f third-party/dsh-context
```

再删 `pins.json` 中的 `dsh-context` 条目，以及三个脚本/测试。构建产物 `third-party/dsh-context/lib/` 随子模块一起消失，无残留。

## 后续

- 验收通过后，第二条待接的是 `dsh-ops`（Windows shell 层）或 `dsh-cost-meter`，两者都还没 pin——**接入前先确认其 `dsh.compatibility.dshReleases` 是否覆盖 `0.2.1-rc.5`**；站点的 "verified" 不代表我们的版本。
- 若后续插件变多，再考虑把「注册」并入 `npm run setup`（读 `pins.json` 批量注册），避免「重跑 setup 掉插件」。
- 按 `AGENTS.md` §6 **未提交**。
