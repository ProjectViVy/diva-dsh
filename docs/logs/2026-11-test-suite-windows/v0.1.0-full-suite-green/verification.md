# 验证记录：全量测试修复到全绿

## 1. 基线（修复前）

| 运行方式 | 结果 | 说明 |
| --- | --- | --- |
| `workspace-write` 文件沙箱内 `node .artifacts/test-run/driver.mjs` | 56/85，29 失败 | 失败集中在子进程/管道 EPERM，属沙箱假失败 |
| `danger-full-access` 内同一 driver | 63/85，22 失败 | 真实基线 |

沙箱假失败的原始形态（早期）：

```
[EPERM] spawn ... 或 node --test 子进程无法建立命名管道
ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'c:'
```

结论：本机 `workspace-write` 下不能用 `node --test` 的 runner（它靠管道收子进程结果），必须用 `danger-full-access` 或逐文件跑。

## 2. 最终结果（规范命令）

```powershell
npm test > .artifacts/test-run/npm-test-full.txt 2>&1   # exit=0, 51167ms
```

尾部输出：

```
ℹ tests 1371
ℹ suites 10
ℹ pass 1365
ℹ fail 0
ℹ cancelled 0
ℹ skipped 6
ℹ todo 0
ℹ duration_ms 50525.7124
```

逐文件口径（同一份结果的另一种汇总，`.artifacts/test-run/summary.json`）：**85/85 文件 exit=0**，`pass 1365 / fail 0 / skipped 6`。

6 条跳过逐条确认都是「本机缺东西」，不是逃避失败：

- `asr-sensevoice-e2e`：需要 `DSH_ASR_E2E=1` + 已下载 SenseVoice 模型
- `live2d` ×2：本机没有 DeepSeek 模型资产（cdi3/physics3）
- `voice-plugin` ×2：本机没有 project-local ffmpeg / ffprobe
- `laputa-setup` ×1：Windows 上不能建符号链接（symlink 断言本身在非 Windows 才有意义）

## 3. 关键单点证据

**0xC0000409（`UV_HANDLE_CLOSING` 断言）——修前/修后**

```
# 修前：node scripts/check-asr-mount.mjs
###EXIT=-1073740791 ms=348
[stderr] Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76

# 修后（只设 process.exitCode，不调 process.exit）
###EXIT=0 ms=173          # 输出结尾：结论 + 无 stderr
```

`tests/surfcore-runtime-transform.test.mjs` 里两段内联子程序（第 991、1399 行附近）是同一个病，同样改成 `process.exitCode = 0` 后该文件 78 项全过。

**孙进程是否真的被杀（`voice-installer-runner`）**

```
parent pid = 21368
grandchild candidates: [{"pid":21368,...},{"pid":11880,"parent":21368}]
taskkill exit = 0
marker after taskkill = false
```

即：干净环境下 `taskkill /T /F` 确实把 bootstrap 拉起的孙进程停掉；原测试 350ms 的落盘窗口太短，会把「杀得慢」误判成「没杀」，因此把窗口拉长到 1500ms / 等待 2000ms。

**`component-setup` 的 offline frozen pnpm（真跑，不是跳过）**

```
✔ profile dependency relocation resumes after interruption between its two files (301ms)
✔ relocated profile links pass a real offline frozen pnpm install (...)
ℹ skipped 0
```

`.artifacts/tools/node_modules/pnpm/bin/pnpm.cjs` 存在 → 该用例没有走 `t.skip`，`--offline --frozen-lockfile` 安装真的成功。

**`plugins/surfcore` 索引修复**

```
# 修前
git status --porcelain --untracked-files=no | measure  → 9
# git checkout -- .（内容与 HEAD 一致，hash-object 已核对）
# 修后
git status --porcelain --untracked-files=no  → （空）
```

## 4. 逐文件复核清单（85/85，全部 exit=0）

```
actmem-recap 842ms                 alignment-scan 817ms            archive-internal-ipc 297ms
asr-audio-normalize 525ms          asr-client 179ms                asr-http 422ms
asr-model-store 610ms              asr-mount-check 1499ms          asr-mount 382ms
asr-registration 325ms             asr-sensevoice-e2e 319ms        asr-service 1095ms
asr-store-audio 316ms              asr-worker-host 367ms           bili-comment-cursor 331ms
bili-dm-cursor 7758ms              component-boundaries 205ms      component-ipc 1412ms
component-migration 2184ms         component-patch 1759ms          component-paths 443ms
component-setup 3231ms             contracts 297ms                 daily-client 347ms
dream-evolution 6511ms             dream-preset 282ms              dream-skill-install 382ms
dream-tool 257ms                   esbuild-pipe 864ms              evolution-dream-client 224ms
evolution-records 2898ms           evolution 297ms                 harness-owner-candidates 845ms
laputa-panel 314ms                 laputa-setup 665ms              live2d 623ms
memory-actmem 1380ms               memory-archive-outbox 386ms     memory-card-prompt 215ms
memory-closure 170ms               memory-context-snapshot 198ms   memory-history-catchup 208ms
memory-modules-ipc 294ms           memory-outbox 918ms             memory-owner-bridge 191ms
memory-plugin 7856ms               memory-retired-archive 315ms    memory-session-map 191ms
memory-slang 168ms                 mempalace-archive-store 556ms   mempalace-archive 258ms
mempalace-cloud-embedding 486ms    mempalace-knowledge 436ms       mempalace-recall 285ms
mempalace-retire 372ms             mempalace-spaces 647ms          mempalace 834ms
ownership-boundaries 316ms         proxy-config 501ms              session-memory-bridge 794ms
session-memory 600ms               source-runtime 11190ms          surfcore-adapter 532ms
surfcore-component-adapter 2529ms  surfcore-integration 3975ms     surfcore-runtime-transform 3420ms
third-party-setup 158ms            vivy-sidebar-core 155ms         vivy-skin-css 201ms
vivy-tone-client 268ms             vivy-tone 778ms                 voice-bridge-readiness 174ms
voice-core 127ms                   voice-installer-download 282ms  voice-installer-extract 235ms
voice-installer-manifest 275ms     voice-installer-runner 3583ms   voice-installer-source 1529ms
voice-online-installer 752ms       voice-plugin 3793ms             voice-policy 319ms
voice-registration 196ms           voice-send-pipeline 2890ms      voice-settings-client 245ms
windows-deployment 3484ms
```

## 5. 未验证 / 未覆盖

1. **Linux / macOS 未复跑**：改的方向是「两种分隔符都认 + 两种行尾都认」，理论上不伤 POSIX，但没有实机证据。
2. **POSIX 权限位断言在 Windows 上按平台条件跳过**：`evolution-records` 的 `0700/0600` 两条现在是 `if (process.platform !== 'win32')`。也就是说「state 目录私有」这条在 Windows 上**没有被验证**（Windows 靠 ACL，不是 mode）。
3. **`plugins/voice` 子模块指针变更未提交**：`src/voice-pack-import.js` 的改动属于本轮（真实 bug 修复），但要不要提交、提交信息怎么写由用户决定；`git status` 里 `plugins/voice` 会显示脏。
4. **其它 submodule 的脏指针不是本轮产物**：`plugins/dsh-see-now`、`plugins/dsh-laputa` 等在开工前就已经是脏/未跟踪状态，本轮没动。
5. **`taskkill /T` 的极限时序**：只证到「干净环境下能杀干净」，没证「机器被打满时 2 秒内一定杀干净」。
6. **`libuv` 断言只修到「不复现」**：`process.exit()` 换成 `process.exitCode` 后 `check-asr-mount.mjs` 与 runtime-transform 子程序都不再 0xC0000409，但没有进一步验证 undici 全局 dispatcher 的收尾行为是否在所有路径上都干净。
