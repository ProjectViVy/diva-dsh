# 验收清单：v0.8.1 worker 今日卡规则 v2

> 本轮没有停/重启 3082。**规则编译进了 `superagent/lib/index.js`，要重启一次才进运行期。**

## 1. 重启

- [ ] `cd C:\Users\Administrator\Desktop\diva-dsh`
- [ ] `npm run stop`
- [ ] `npm start`
- [ ] 面板若开着，硬刷新一次

## 2. 提示词预览

- [ ] 打开 Superagent 面板的提示词预览，切到 **worker**
- [ ] worker 提示词尾部能看到六句新规则，包含：
      `"nodes":[...]`、`badge`、`chart`、`最多 40 个节点`、`嵌套最多 6 层`、
      `线索级` / `待核实` / `仅知悉` / `以官方当天排期为准`、`不要编图片地址`
- [ ] 切到 **master / orchestrator**：搜 `收工写今日卡` 应为 0 命中，也没有
      `nodes` / `genui spec` 这段

## 3. 真实 worker 一单（可选，等下一单收工）

- [ ] 让一个 ticket worker 正常收工
- [ ] 看 `$DSH_HOME/today/<当天>.json`：卡里除了 `title`/`body`，是否出现 `nodes`
- [ ] 右栏 Today 刷新后，该卡出现徽标 / 表格 / 图表等（不是纯文字两行）
- [ ] 卡里没有日期；原文里有限定词和数字时，限定词与数字都在

## 4. 回归

- [ ] `node --test tests/source-runtime.test.mjs tests/windows-deployment.test.mjs` → 32/32
- [ ] `npm test` → 0 失败、10 跳过
- [ ] `git -C superagent status --short` 空

## 5. 回滚

见 release.md。最快：把 `.artifacts/worker-prompt-probe/today-patch-v1.backup`
覆盖回 `patches/superagent-worker-today.patch` → `node scripts/build-bundle.mjs`
→ 重启。
