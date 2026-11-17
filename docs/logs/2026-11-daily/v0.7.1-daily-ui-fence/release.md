# 发布与回滚：v0.7.1 左栏 dsh-ui 围栏

## 交付物

| 文件 | 变化 |
| --- | --- |
| `plugins/dsh-daily/client.js` | +352 行（2167 行，CRLF 保持） |
| `plugins/dsh-daily/VENDORED-genui.md` | 新增「左栏」一节 |
| `tests/daily-client.test.mjs` | +7 条用例（46 项） |
| `docs/logs/2026-11-daily/v0.7.1-daily-ui-fence/` | 四件套 |
| `.artifacts/dsh-daily-check/spec-fence-0{1,2,3}-*.png` | 真 Chrome 证据 |

备份（改动前）：`.artifacts/dsh-daily-backup/20261115-before-spec-fence/`
（`client.js` 与 `daily-client.test.mjs` 各一份，覆盖回去即回滚）。

## 生效方式

**纯浏览器半边，硬刷新即可，不需要重启宿主。** 这次只多了客户端代码，没有动
`FREE_HTML_UI` 这类开关，也不涉及宿主启动时读进内存的配置。

若硬刷新后日常左栏仍显示围栏原文（多半是浏览器拿了旧 bundle）→ 在面板里 Ctrl+F5；
还不行才考虑重启（会让主人的面板断一次，非必要不做）：

```
npm run stop
npm start
npm run status      # 记下新端口
```

## 回滚

覆盖回备份的两个文件 → 面板 Ctrl+F5。右栏三页、html 沙箱通道、折叠、新建聊天都不受影响
（`FREE_HTML_UI` 仍是 `false`，html 围栏照旧是文字）。
