# 验收清单：v0.10.0 今日卡 nodes

> 本轮没有停/重启 3082。**验收前需要主人自己重启一次宿主**，命令见 release.md。
> 重启前面板里最多只看到「标题 + 正文」的 11 张卡（旧的宿主代码会把 nodes 忽略掉）；
> 重启 + 硬刷新后才会出现徽标、表格、图表。

## 1. 重启与刷新

- [ ] `npm run stop && npm start`（在仓库根；会短暂断掉 3082 面板）
- [ ] 浏览器 **硬刷新**（Ctrl+F5）一次，让新的 `client.js` 生效
- [ ] 打开「日常」→ 右栏 `Today`

## 2. Today 页

- [ ] 分区头是「11 月 16 日」，下面是 11 张卡（标题清单见 summary.md）
- [ ] 第一张「两条降价先停在线索级」：3 个徽标（线索级 / 待核实 / 官网原文未现抓）、
      一张 Qwen4-Max 两列表、Xhigh 24 / High 35 的条图、Gemini 键值、警告框
- [ ] 第二张「两个截止：37 分钟与 9 天」：两张 stat（37 分钟 / 9 天）+ 提示框
- [ ] 第六张「两个 Claude Code 构建被标恶意」：待自查/未核实徽标 + 两步自查
- [ ] 第十一张「港口两条线还在铺开阶段」：两条线列表（不再是窄表格）
- [ ] 往下滚到「11 月 15 日」历史分区：4 张旧卡仍是「标题 + 正文」两行，
      没有徽标/表格/图表（旧格式回归）
- [ ] 右栏没有 iframe；控制台 console error 0 / pageerror 0；无横向滚动条

## 3.（可选）坏 nodes 演练——整张卡丢、整页不炸

先备份，再往今天文件里追加一张 `nodes` 不是数组的卡（`$todayDir` 路径自己核对）：

```powershell
$root = 'C:\Users\Administrator\Desktop\diva-dsh'
$todayDir = Join-Path $root '.artifacts\dsh-home\today'
Copy-Item (Join-Path $todayDir '2026-11-16.json') (Join-Path $todayDir '2026-11-16.before-drill.json') -Force
$data = Get-Content (Join-Path $todayDir '2026-11-16.json') -Raw | ConvertFrom-Json
$data.cards += [pscustomobject]@{ title = '故意写坏'; body = '这张应当整张不见'; nodes = '不是数组' }
$data | ConvertTo-Json -Depth 20 | Set-Content (Join-Path $todayDir '2026-11-16.json') -Encoding utf8
```

- [ ] Today 页点「刷新」：12 张里少了「故意写坏」这一张，其余 11 张照常
- [ ] 恢复：把 `.before-drill.json` 覆盖回 `2026-11-16.json`，再点「刷新」

注意：宿主校验是 200 + 少一张卡，不是报错；不要期待页面提示。

## 4. 回归

- [ ] `node --test tests/daily-today.test.mjs` → 21/21
- [ ] `node --test tests/daily-client.test.mjs` → 55 项 / 51 过 / 0 失败 / 4 跳过
- [ ] 若之后有人改了 `plugins/dsh-daily/`，重跑 `npm test` 看 0 失败

## 5. 回滚

见 release.md「回滚」。最快的一条：数据回滚不需要重启，把 backup 的 15 卡文件覆盖回去，
Today 点一次「刷新」即可。
