# v0.1.0-full-suite-green 全量测试修复到全绿（Windows）

- 状态：done（`npm test` 1371 项 / 1365 通过 / 0 失败 / 6 跳过，exit 0，51s）
- 范围：`scripts/`（5 个）、`tests/`（20 个）、`plugins/voice/src/voice-pack-import.js`（1 个）
- 验证：见 [verification.md](verification.md)（两次全量跑的原始输出都在 `.artifacts/test-run/`）
- 未验证：Linux / macOS 未复跑；`plugins/voice` 子模块指针变更未提交；`libuv` 断言修复只证到「不再 0xC0000409」，没证 undici 收尾细节；2 条 POSIX 权限断言在 Windows 上按平台条件跳过（不是放过失败）
- 回滚：`git checkout -- scripts tests` + `git -C plugins/voice checkout -- src/voice-pack-import.js`，无需重建产物

## 问题

起点是「听说还有挺多测试没通过」。两次基线测量把失败分成两类：

1. **假失败（沙箱/环境）**：在 `workspace-write` 文件沙箱里跑，`node --test` 的 runner 要起子进程并用管道收结果，被拒（EPERM），一次就掉到 56/85、29 条失败。这类失败与代码无关。
2. **真失败（代码/测试可移植性）**：换到 `danger-full-access` 后 63/85，22 条真实失败。逐条查下来不是「功能坏了」，而是**只在 POSIX 上成立的断言 / 只在 LF 上成立的切片 / 只在进程能干净退出时成立的退出方式**：路径用 `/` 硬拼、`0700/0600` 权限位、`process.exit()` 在句柄关闭中调用、按 `\n` 切源码、`link:` 说明符只认一种斜杠。

所以这轮的主线不是改功能，而是**把这些断言和几处实现改成跨平台成立**，同时保留原来的语义强度（该断言的仍然断言，不靠放宽掩盖问题）。

## 改了什么

**A. 模块加载与路径（Windows 盘符）**

1. `scripts/surfcore-loader.mjs`：`replaceOnce` 先归一化 CRLF（`plugins/surfcore` 在本机是 CRLF checkout，锚点按 LF 写的），断言命中次数后按原换行风格写回；新增 `loadableUrl()` 把裸 `C:\…` 转成 `file://` URL 再交给 `nextLoad`，否则 `ERR_UNSUPPORTED_ESM_URL_SCHEME`。
2. 相关测试（`asr-registration`、`voice-registration`、`live2d`、`bili-comment-cursor`、`bili-dm-cursor`、`component-migration`、`surfcore-runtime-transform`）统一用 `pathToFileURL(...).href` 传 `--import` 与动态 `import()`。注意：loader 自己修不了「引导时给了裸路径」这一层（base 就是裸路径），只能在调用侧给 URL。

**B. 目录/链接操作**

3. `scripts/lib/surfcore.mjs` `sourceLink()`：Windows 不允许把 junction rename 到已存在的目录上，改成 `rename` 失败则 `unlink` 后重试，失败时清理临时链接。
4. `evolution-records` / `harness-owner-candidates`：Windows 禁止删除仍被 sqlite 打开的文件，删临时目录前先关掉本文件开过的 store（`openStores` + `trackStore`），`rmSync` 带 `maxRetries`。注意 `t.after` 是**注册顺序**执行，所以关库必须由删目录那个钩子自己来做。

**C. 进程退出（0xC0000409）**

5. `scripts/check-asr-mount.mjs`：末尾 `process.exit(mounted ? 0 : 1)` 改成 `process.exitCode = …`。实测复现：`fetch` 句柄还没关完就 `process.exit()` → `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`，退出码 `-1073740791`；改成只设退出码后 173ms 正常退出、退出码 0。
6. `tests/surfcore-runtime-transform.test.mjs` 内联的两段子程序同样改成 `process.exitCode = 0`。

**D. 斜杠与行尾（断言侧）**

7. 断言不再用 `/` 硬拼：`live2d`、`asr-http`、`vivy-tone`、`voice-core`、`source-runtime`、`ownership-boundaries`、`evolution-records`、`component-migration`、`voice-plugin`、`voice-installer-runner`、`surfcore-runtime-transform` 改用 `join`/`resolve`，或在比较前把两边都 `replaceAll('\\','/')`。
8. `voice-plugin` 里按行切 `voice-packs.js` 的地方先 `replaceAll('\r\n','\n')`：本机 `core.autocrlf=true`（系统级），checkout 全是 CRLF，LF 锚点必然找不到。
9. `component-setup` 的子进程用 `args[1].endsWith('package.json')`（原来只认 `/package.json`）。

**E. 真正的实现缺陷（4 处，都属同类：只认一种写法）**

10. `scripts/lib/component-setup.mjs`：`pnpm-lock.yaml` 的 `specifier` 匹配只按 `/` 拼锚点，而 manifest 在 Windows 上可能是 `\`；改成锚点里 `/` 与 `\` 都认（`escapeSpecifier`）。
11. `scripts/lib/component-migration.mjs`：`migration.json.sources[].path` 与备份 `manifest.json.files[].path` 原来写 `relative()` 的平台原生分隔符，改成落盘的 JSON 里统一 `/`（JSON 是给别的机器读的，不是给 `join` 读的——实际写入路径仍然用原生形式）。
12. `plugins/voice/src/voice-pack-import.js`：新增 `pathPrefixPattern()`，`relocatePackConfig()` 与 `repairMovedVoicePack()` 替换绝对路径前缀时 `/` 与 `\` 都认。原来只认 `root + '/'`，而配置里可能是 `root + '\'` 或混写，移动目录后路径修不干净（这是真 bug，不只是测试问题）。
13. `tests/ownership-boundaries.test.mjs`：MemPalace 边界扫描原来把注释也算作耦合（`* 投递到 MemPalace` 就被判违规），改成只扫非注释行——边界说的是代码调用，不是文档措辞。

**F. 测试自身竞态**

14. `tests/alignment-scan.test.mjs`、`tests/memory-plugin.test.mjs`：mock 的 `fs.promises.open` 里把轮转动作挪到 `original.call(...)` **之前**，否则 Windows 上目标文件还开着，`renameSync` EPERM。
15. `tests/asr-http.test.mjs`：临时副本改成断言 `basename(copied)` 形如 `<uuid>.wav`（原来比完整 POSIX 路径）。
16. `tests/voice-installer-runner.test.mjs`：孙进程落盘窗口从 350ms 放到 1500ms、取消后等到 2000ms 再验。`taskkill /T /F` 走的是「快照 + 树杀」，350ms 窗口在负载高时会把「杀得慢」误判成「没杀」——实测干净环境下孙进程确实被杀（`taskkill exit = 0`，marker 不出现）。

**G. 一次索引修复（不属代码）**

17. `plugins/surfcore` 有 9 个文件长期显示 ` M`，但 `git diff` / `git diff HEAD` 都是空、`hash-object` 与 index blob 一致、`git status` 却判脏（`update-index --refresh` 只回「needs update」）。用 `git checkout -- .` 让 git 用 index 重写工作树后恢复干净（内容未变，因为本来就与 HEAD 一致）。这一步让 `surfcore-adapter` 的「上游子模块没有本地改动」断言恢复可跑。

## 影响面

- 功能代码动了 4 个文件（`component-setup.mjs` 的 lock 匹配、`component-migration.mjs` 的 JSON 路径、`voice-pack-import.js` 的路径前缀替换、`surfcore-loader.mjs` 的 URL 归一化），都是「更宽容地认同一种东西」的方向，没有放宽任何校验分支。
- 其余全是测试与一个检查脚本。没有新增依赖、没有新增抽象、没有动上游三仓源码（`plugins/surfcore` 只做了索引刷新，无内容改动）。
- 组件接线类改动（`component-setup` / `component-migration`）已由 `component-setup`、`component-migration`、`surfcore-integration` 三套测试覆盖，`link:` 与 `pnpm-lock.yaml` 的一致性另有 `component-setup` 的 offline frozen pnpm 安装真跑（本机有 project-local pnpm，`skipped 0`）。

## 迭代记录

1. 第一轮在 `workspace-write` 沙箱里跑，`node --test` 直接 EPERM，误以为「大量失败」是代码问题 → 换 `danger-full-access` 重测，得到 63/85 的真实基线，才把环境假失败和真失败分开。
2. 第二轮把 loader / URL / 链接 / sqlite 句柄这类 Windows 平台差异批量修掉（67 → 79）。
3. 第三轮逐文件啃剩下的：`component-setup` 与 `component-migration` 各挖出一个「只认一种斜杠」的实现缺陷，`voice-plugin` 挖出「路径前缀只认 `/`」的实现缺陷，`ownership-boundaries` 挖出「注释被当成耦合」的断言缺陷。
4. 最后一轮把 `process.exit()` 的两个 0xC0000409 修掉、把孙进程竞态窗口拉长，全量 85/85。
5. 收尾发现 `npm test` 本身现在可以直接跑（早前 EPERM 是沙箱模式造成的，不是 runnner 不能用），于是用规范命令复跑一次：`exit=0`，`pass 1365 / fail 0 / skipped 6`。
