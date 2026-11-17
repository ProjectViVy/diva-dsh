---
name: card-guide
description: Use when you want to show the owner a visual - a small panel, chart, table, timeline, checklist or diagram - instead of describing it in prose. Covers the ```html fence that renders as a sandboxed card in the 日常 left column, the paper-and-ink CSS variables available inside it, and the hard rules that keep a card looking like part of the app.
metadata:
  author: diva-dsh
  role: expression
---

# 画一张卡给她看

**什么时候用**：三句以上才说得清的结构性内容——今天的三件事、一周的专注分布、一个流程、一份对照表、一个待确认的选择。
**什么时候不用**：一句话能说完的、寒暄、结论已经清楚的。**默认不画**，画一次要几百行代码，别让每次回复都拖着一个界面。

**写到哪**：回复里写一个 ` ```html ` 围栏。左栏会把围栏内的片段渲染成一个沙箱卡片，围栏外的文字照常显示。片段**只写内容**——不要 `<!doctype>`、`<html>`、`<head>`、`<body>`，宿主已经包好了。

## 你手里的东西

宿主的纸与墨通过 CSS 变量注入到卡片的 `:root`，**用变量，不要写死颜色**——写死的颜色换肤就崩，也会和这页打架。

| 变量 | 现在的值 | 用途 |
| --- | --- | --- |
| `--dl-paper` | `#fffdfa` | 卡面底色 |
| `--dl-paper-2` | `#f7f1e6` | 二级底（代码块、浅槽） |
| `--dl-paper-3` | `#fbf3e8` | 三级底 |
| `--dl-ink` | `#241c16` | 正文墨色 |
| `--dl-ink-2` | `#6f6055` | 次要文字 |
| `--dl-ink-3` | `#8d7c70` | 标注、脚注 |
| `--dl-rule` | `rgb(120 86 62/.35)` | 主分隔线 |
| `--dl-rule-soft` | `rgb(120 86 62/.16)` | 细线、卡片描边 |
| `--dl-lede` | `rgb(90 62 44/.16)` | 投影（要克制） |
| `--dl-brand` | `#ea5560` | 唯一强调色 |
| `--dl-grad` | 橙→珊瑚→粉的渐变 | 只能小面积用（进度条、图标底） |

字号、行高、表格、`pre`、`blockquote` 宿主已经定好，**你不用再写**。只需要写结构。

## 硬规矩

1. **不许写死颜色**：一律 `var(--dl-…)`。渐变只能来自 `--dl-grad`，且只用于小面积。
2. **字重只用 400 / 600 / 650**。别用 700，中文会糊。
3. **字号 ≥ 11px**，别用极小字凑信息密度。
4. **不做阴影堆叠、不做发光、不做毛玻璃**。投影最多一层，且很淡（`--dl-lede`）。
5. **不用 emoji**，需要符号就画简单 SVG。
6. **不许 `position:fixed`**：卡片高度跟着内容走，fixed 会把布局压扁。要「浮层」就用普通流 + `min-height` + flex 居中。
7. **不许 `localStorage` / `sessionStorage` / `eval` / `window.open` / 表单提交**——沙箱不给这些权限，写了就是坏的。
8. **不许外链图片、外链字体、`fetch`**：框里断网，只认 `data:` 与 `blob:`。图自己画 SVG。
9. **不做固定高度容器**：内容多就让卡片长高（80–620 之间自适应，超了框内滚动）。别自己设 `height:200px` 再在里面滚。
10. **单边边框别配圆角**：`border-left` + `border-radius` 会露出破口，做竖条时把圆角设为 0。

## 复杂度预算

| 维度 | 上限 |
| --- | --- |
| 卡片标题 | ≤ 12 个字，细节放在围栏外的正文 |
| 强调色 | ≤ 2（`--dl-brand` + 最多一个语义色） |
| 满宽区块 | ≤ 4 个，再多就分栏或砍掉 |
| 内联 `<style>` | ≤ 20 行，优先行内样式 |
| 总行数 | ≤ 120 行，超了说明这件事不该用卡片 |

## 三个常用形状

**① 三件事**（最常用）

```html
<div style="font-size:12px;color:var(--dl-ink-3);letter-spacing:.04em">今天三件事</div>
<ol style="margin:6px 0 0 18px">
  <li>把评审反馈收成 3 条</li>
  <li>16:00 站会，带更新</li>
  <li>睡前写明天的清单</li>
</ol>
```

**② 指标 + 分布**（两栏）

```html
<div style="display:flex;gap:10px">
  <div style="flex:1;border:1px solid var(--dl-rule-soft);border-radius:10px;padding:10px">
    <div style="font-size:11px;color:var(--dl-ink-3)">本周专注</div>
    <div style="font-size:20px;font-weight:650">6.5 小时</div>
  </div>
  <div style="flex:1;border:1px solid var(--dl-rule-soft);border-radius:10px;padding:10px">
    <div style="display:flex;align-items:flex-end;gap:4px;height:44px">
      <span style="flex:1;height:18px;border-radius:3px;background:var(--dl-grad)"></span>
      <span style="flex:1;height:30px;border-radius:3px;background:var(--dl-grad)"></span>
      <span style="flex:1;height:44px;border-radius:3px;background:var(--dl-grad)"></span>
    </div>
  </div>
</div>
```

**③ 让她选**（按钮真的会动）

```html
<div style="display:flex;gap:8px">
  <button onclick="parent.postMessage({dlUiPick:'先做评审，晚上再说邮件'},'*')"
    style="padding:6px 14px;border-radius:9px;border:1px solid var(--dl-rule);background:var(--dl-paper-2);font:inherit;cursor:pointer">
    A · 先做评审
  </button>
  <button onclick="parent.postMessage({dlUiPick:'先回邮件，评审推到明天'},'*')"
    style="padding:6px 14px;border-radius:9px;border:1px solid var(--dl-rule-soft);background:transparent;font:inherit;cursor:pointer">
    B · 先回邮件
  </button>
</div>
```

**按钮的契约只有一条**：`postMessage({dlUiPick:'一句话'})` 会把那句话**填进她的输入框**，光标留在那，**不自动发送**——发不发由主人按。

所以：

- `dlUiPick` 的值写成**主人会说的话**（第一人称、可以直接发出去的一句），不要写成 `'clicked_a'` 这种代号。
- **不要承诺点了就会执行**。她按下去只是省了打字，后面怎么做仍是你（她）来回答。
- 不要用按钮去触发派活、建工单、改文件——卡片没有那个权限，也不该有。

## 交出去之前自检

- [ ] 没有写死颜色、没有外链资源、没有 fixed/localStorage/eval。
- [ ] 标题 ≤ 12 字，强调色 ≤ 2，满宽区块 ≤ 4。
- [ ] 没有 `<!doctype>`/`<html>`/`<body>`。
- [ ] 短内容试想一下：框高会不会缩到 80 也放得下？长内容会不会超过 620 而后悔没分块？
- [ ] 围栏外的正文仍然说清了「这是什么」——不能让人只看图猜。
