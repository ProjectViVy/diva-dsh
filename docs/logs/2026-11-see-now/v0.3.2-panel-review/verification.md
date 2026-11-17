# dsh-see-now · v0.3.2-panel-review · 验证

时间：2026-11-14 00:25–01:10（Asia/Shanghai）。

| # | 命令 / 动作 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `node scripts/check-syntax.mjs`（插件目录） | 语法全过 | `check: 52 file(s) ok` |
| 2 | `node --test test/client-wiring.test.mjs` | 接线不回归，新增用例绿 | **21 tests / 21 pass / 0 fail**（原 20 条 + 新增 `snVerdict` 4 组断言） |
| 3 | `node --test test/lifecycle-store.test.mjs` | 尾部读不多不少 | **3 pass**；新增「300 条里取最近 5 条」用例绿 |
| 4 | `node --test test/lifecycle-api.test.mjs` | `/lifecycle` 契约不变 | **5 pass** |
| 5 | `node --test`（插件全量） | 不回归 | **513 tests / 492 pass / 0 fail / 21 skipped**，48.7s |
| 6 | `patches/see-now-vivy-core.patch` 重新生成 | 覆盖新代码 | **51,832 字节 / 7 文件** |
| 7 | `node scripts/setup-see-now.mjs` | 幂等识别"已应用" | `dsh-see-now: VIVY心核 panel patch already applied` |

## 未验证

- **端内观感**：补丁只落到子模块工作区，运行中的宿主（3082）仍是旧 bundle；调试页新计数与一句结论要 `npm run restart` + 硬刷新后才看得到。本会话由该宿主托管，不能自己重启。
- **`0 张` 的真实归因**：新计数能回答「是没留帧还是没封箱」，但还没有在真实有变化画面上跑过一轮；`snVerdict` 的五条分支目前只有单测覆盖。
- **轮询削峰的实测**：日志尾读与 `document.hidden` 跳过都是按代码路径推导的，没有做请求数/耗时的前后对比。
- 根仓 `npm test` 的既有 Windows 失败（DV-TEST-001）与本改动无关，未跑。
