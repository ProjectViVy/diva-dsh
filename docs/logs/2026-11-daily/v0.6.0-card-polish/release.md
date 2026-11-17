# 发布记录 v0.6.0

- 是否发布：**是**——纯客户端 + 一份 skill
- 生效方式：浏览器硬刷新 3082（`client.js`）；skill **已经装好**，可用技能列表里当场能看到 `card-guide`
- 需要重启的进程：**无**

## 发布后必做

1. 硬刷新后随便让她画一张卡，**先看颜色**：卡片文字是不是这页的墨色（`#241c16`），柱子是不是橙→珊瑚渐变。这是本轮唯一没在真 DOM 上验过的环节（`uiThemeVars()` 只在假 document 上测过）。
2. 问她一句「你知道该用什么变量吗」，确认 `skill card-guide` 能加载出来。

## 需要回头核对

- 换肤后卡片跟不跟着变（变量每次渲染现采，但换肤是否触发重渲染未验）。
- 她画卡时有没有遵守禁令（emoji / fixed / 外链图 / 写死颜色 / `<html>`）。**如果她频繁犯同一条，说明指南那条写得不够醒目**，把那条提到最前面，别加新规则。
- 卡片里的按钮：契约是「填进输入框、不发送」。她如果写成 `postMessage({dlUiPick:'A'})` 这种代号，你按下去会得到一句「A」——这时给她纠正：`dlUiPick` 要写主人会说的话。如果她反复写成代号，把指南里那条挪到最前面，别加新规则。

## 回滚

`plugins/dsh-daily/` 与 `skills/` 都在我们自己的范围里：

1. `client.js` 删 `UI_TOKENS`、`uiThemeVars`，`uiDocument` 回到单参数，`sandboxFrame` 里的 `load` 监听可留（无害）也可删。
2. 删仓库 `skills/card-guide/` 与 `$DSH_HOME/skills/card-guide/`，并把它从 `scripts/lib/skills.mjs` 的 `PROJECT_SKILLS` 移除。
3. 硬刷新即可。
