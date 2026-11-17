# 验收步骤：全量测试全绿

复核只需要一条命令，其余是可选的逐项确认。

## A. 必做：规范命令全绿

```powershell
cd C:\Users\Administrator\Desktop\diva-dsh
npm test
```

判定标准：

- 退出码 `0`
- 尾部 `ℹ pass 1365` / `ℹ fail 0` / `ℹ skipped 6`（跳过条数会随本机 ffmpeg、Live2D 模型、`DSH_ASR_E2E` 而变，**只要是「缺资产」原因就算通过**）
- 总耗时约 50s

注意：如果 DSH 的文件沙箱是 `workspace-write`，`npm test` 会因 runner 需要管道而 EPERM 假失败；这不是代码问题，换 `danger-full-access` 或逐文件跑（见 B）。

## B. 可选：逐文件跑（沙箱受限时）

```powershell
node .artifacts/test-run/driver.mjs              # 全部 85 个文件
node .artifacts/test-run/driver.mjs voice-plugin # 只看某个文件
```

该 driver 是本地取证脚手架（在 `.artifacts/` 下，不入库）：对每个 `tests/*.test.mjs` 起一次 `node --test`，用 `--test-reporter=spec --test-reporter-destination=<log>` 落盘，`stdio: 'ignore'` 绕开管道限制；`summary.json` 汇总 exit code。

## C. 逐项人工确认点（改动覆盖到的地方）

1. **SurfCore 装载**：`node -e "import('./scripts/surfcore-loader.mjs')"` 不报 `ERR_UNSUPPORTED_ESM_URL_SCHEME`；`npm run setup:components` 在 CRLF checkout 上不报「pinned SurfCore source no longer matches」。
2. **`npm run check:asr`**（即 `scripts/check-asr-mount.mjs`）：输出「结论」段后进程以 `0`/`1` 退出，**不出现** `Assertion failed: ... UV_HANDLE_CLOSING`。
3. **组件迁移产物**：跑一次迁移后 `.artifacts/dsh-home/memory/migration.json` 的 `sources[].path` 与备份 `manifest.json.files[].path` 都是 `/` 分隔。
4. **语音包搬家**：把 `packs/voice-cloud` 目录整体改个名，`repairMovedVoicePack` 之后 `config.toml` 里 `[ffmpeg] path` 与 `.venv/pyvenv.cfg` 的 `home`/`executable` 都指向新目录（两种斜杠写法都能被修）。
5. **子模块干净**：`git -C plugins/surfcore status --porcelain` 为空（本轮已恢复）。

## D. 不通过时先看哪里

| 症状 | 先看 |
| --- | --- |
| 一堆 EPERM / 管道错误 | 沙箱模式（`workspace-write`），不是代码 |
| `ERR_UNSUPPORTED_ESM_URL_SCHEME` / `base 'c:\...'` | 调用侧是否给的是裸 Windows 路径（必须 `pathToFileURL`） |
| `0xC0000409` / `UV_HANDLE_CLOSING` | 是否有新代码在句柄还没关完时 `process.exit()` |
| `EPERM rename` / 删目录失败 | 是否有 sqlite/文件句柄没关就先 `rmSync` |
| `delete 失败` / 路径断言 | 断言是否用 `/` 硬拼了平台路径 |
