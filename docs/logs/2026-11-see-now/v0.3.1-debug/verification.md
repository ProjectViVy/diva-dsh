# dsh-see-now · v0.3.1-debug · 验证

时间：2026-11-13 06:40–06:55（Asia/Shanghai）。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node --check client.js` | 语法通过 | `client syntax OK` |
| 2 | `node --test test/client-wiring.test.mjs` | 接线不回归 | **20 tests / 20 pass / 0 fail**；新增 `SN_TABS` 含 `debug` |
| 3 | `node --test`（插件目录） | 全量不回归 | **511 tests / 490 pass / 0 fail / 21 skipped**，47.2s |
| 4 | 重启 host（PID 32504）+ 浏览器刷新 | 新代码加载 | 3082 `runtime=ready`；面板标签出现「调试」 |
| 5 | 点「开始看」 | 自动切调试页 | 自动切到「调试」；`开始看：完成`；`陪看循环在跑` |
| 6 | 等约 14 秒 | 输出真实状态 | `源 screen`、`帧 / 出图 156 帧 / 0 张`、`已运行 14 秒`、`心跳` 有值 |
| 7 | 点「停止」 | 状态回落 | `没在看`、`停止：完成`、`采集收工` |
| 8 | `patches/see-now-vivy-core.patch` | 覆盖新代码 | **45,047 字节**，7 文件 |
| 9 | 干净 HEAD 临时目录 `git apply --check` | 可正向重放 | `forward check OK` |
| 10 | `npm run setup:see-now` | 幂等 | `VIVY心核 panel patch already applied` |

## 未验证

- 有变化画面下 `出图 > 0`、模型是否描述正确、每张 token/CPU。
- 六标签在窄宽度下的横向滚动；UIA 只稳定读到「会话/记录/调试/配置/隐私」，未逐项点「总览」。
- 轮询超过几十秒后的内存/请求稳定性。
- 根仓 `npm test` 的 114 条 Windows 既有失败（与本改动无关，未修）。
