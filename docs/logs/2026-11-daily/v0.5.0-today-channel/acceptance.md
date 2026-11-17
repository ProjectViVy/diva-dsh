# 验收清单 v0.5.0（worker → today 围栏）

## 0. 先重启（这条和左栏不同）

宿主半边新增了路由，**必须重启**才存在：

```
npm run stop
npm start
```

起来后先确认路由活着（端口用 `npm run status` 看到的那个）：

```
curl "http://127.0.0.1:<端口>/dsh-daily/api/today?date=$(Get-Date -Format yyyy-MM-dd)"
```

- 期望：`{"ok":false,"message":"… 还没有人写"}` + HTTP 404（还不该有文件）。
- 若不是 404 而是 401/403：说明 `connection.requestRejection` 拦了这条自建路由——**这是本版最可能的失败点**，记下来，别绕。

## 1. 手动放一页进去，看右栏

把下面任意一段存成 `C:\Users\Administrator\Desktop\diva-dsh\.artifacts\dsh-home\today\<今天>.html`
（文件名必须是 `YYYY-MM-DD.html`，例如 `2026-11-15.html`）：

```html
<div style="font:13px/1.6 system-ui;padding:4px">
  <b>今天最要紧的一件</b>
  <p>把评审反馈收成 3 条。</p>
</div>
```

然后：

- [ ] 硬刷新 3082（Ctrl+Shift+R），点右栏 Today。
- [ ] 上面的示例卡**不见了**，换成一个沙箱框，框里是你写的那段。
- [ ] 标题条写「今天的界面 · worker 写的」。
- [ ] 框的高度贴着内容，下面没有一大片空白。

## 2. 刷新按钮（不必整页重载）

- [ ] 改一下那个 html 文件（换个字），点标题条右边的「刷新」。
- [ ] 框里的字**跟着变了**，页面没重载，左栏聊天记录也没丢。

## 3. 没人写的时候

- [ ] 把那个 html 文件改名/删掉，点「刷新」。
- [ ] 示例卡回来了，标题条写「还没有人写，下面是示例」。
- [ ] 没有报错、没有空白页。

## 4. 边界（和左栏同一套）

- [ ] 页面里写 `<script>parent.document.body.innerHTML=''</script>` → **什么都不该发生**。
- [ ] 页面里写 `<script>fetch('http://127.0.0.1:3082/')</script>` → 控制台报 CSP 拦截，页面不崩。
- [ ] 页面里放一个外链图片 → 不显示（只允许 data:/blob:）。

## 5. 不牵连别处

- [ ] 左栏照常收发；她写 `html` 围栏还是照旧在气泡里显示。
- [ ] 任务 / 悄悄话两页照旧。
- [ ] `npm test` 仍是全绿。

## 结论

- 全绿 → 这条可以收 `done`。下一步是**让 worker 真的会写**（提示词规则），再下一步才是派工与定时。
- 第 0 步就 401/403 → 通道选对了但**认证这一层没过**：先把路由改成和现有静态资源同一条路径（或让客户端带上会话头），别急着改 worker。
- 别的哪条不对 → 记下编号。回滚：`index.js` 回到空 `apply()`，`client.js` 删掉 `TODAY_API`/`fetchToday` 与那段 effect，重启 + 硬刷新。
