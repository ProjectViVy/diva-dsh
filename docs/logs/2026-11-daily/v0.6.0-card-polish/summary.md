# v0.6.0 卡片品味：主题变量 + 设计指南

- 状态：已交付（纯客户端 + 一份 skill，**不用重启**；skill 已当场出现在可用列表里）
- 范围：`plugins/dsh-daily/client.js`、`tests/daily-client.test.mjs`、`skills/card-guide/SKILL.md`（新增）、`scripts/lib/skills.mjs`
- 验证：`tests/daily-client.test.mjs` 35/35；真 Chrome 截图；`npm test` 见 verification.md
- 回滚：删 `UI_TOKENS`/`uiThemeVars` 与 `uiDocument` 的第二参数（回到单参），删 `skills/card-guide/` 与 `PROJECT_SKILLS` 里的名字

## 起因

主人 16:2x：「hanako 也有一个动态生成 ui 卡片的功能，而且效果很好。他是怎么做到的？我们有办法能够做这个吗」

查完发现：**hanako 的卡片不是「生成结构」，是让 agent 直接写 HTML**，宿主只做三件事——包一层排版壳、**注入主题变量**、沙箱渲染。效果好的原因不在 iframe（那半我们早就有了），在两样我们缺的东西：主题变量、设计指南。

## 抄了什么，怎么改的

| hanako | 我们 | 改了什么 |
| --- | --- | --- |
| 从 `document.documentElement` 抠 20 个主题变量注入 `:root` | 从 `.dl` 抠 **11 个 `--dl-*`**（我们的 token 定义在 `.dl` 上，不是 `:root`） | 采集前先找 `.dl`；值里带 `<` `>` `{` `}` 的一律丢掉（要拼进 `<style>`，不能给逃逸机会） |
| 20 KB 设计系统，通过 `hana_card_guide` 工具加载 | `skills/card-guide/SKILL.md`（5.8 KB），DSH 的 `skill` 工具按需加载 | **不照抄禁令**：他禁渐变，我们品牌就是渐变；他字重只许 400/500，我们用 400/600/650；他字号底线 11px 保留 |
| 包壳里带完整排版 reset | 基础排版写进 `UI_FRAME_CSS`（h1–h3 / table / pre / blockquote / hr / code） | 字号按我们的 13px 正文缩一档，颜色全改 `var(--dl-*,兜底)` |
| iframe load 后 ping 补首报竞态 | 同：`load` 后 `postMessage('dlUiPing')`，框内 `message` 监听里重报一次 | 直接抄 |
| 卡片走真 HTTP（避开它渲染进程的 `script-src 'self'`） | **仍走 srcdoc** | 不改：我们的 GUI 没有 CSP，srcdoc 里自设 CSP 等价，且已实测脚本能跑、联网被挡。为此多开一条 HTTP 路由只是增加面 |

## 两个判断

1. **没有把设计指南塞进常驻提示词。** 5.8 KB 常驻等于每轮都付，而她一周可能只画两三次卡。做 skill：用的时候 `skill card-guide` 加载，平时零成本。
2. **没有为了「像 hanako」把卡片改走 HTTP。** 我们的 srcdoc + 自设 CSP 已经验过；改 HTTP 的唯一收益是绕开一个我们并不存在的 CSP 限制。等真需要「卡片可分享/可下载」再说。

## 追加：按钮回路（同日 17:3x，主人拍 T2a）

问「卡片按钮点了之后应该是派单给 worker 吗」。先查了 hanako：**它没有这个回路**——`InteractiveCard` 只认 `hana.card-resize`（`InteractiveCard.tsx:105`），别的一律忽略，而 CSP `connect-src 'none'` 连 `fetch` 都断。所以它卡片里的按钮最多只能在框内自己动。它那个「效果好」说的是长相，不是按钮。

三档摆开（T1 框内自嗨 / T2 回话 / T3 直接派单），主人选 **T2a：点一下只把话填进输入框，不自动发**。

- 契约：框里 `parent.postMessage({dlUiPick:'主人会说的一句话'},'*')` → 父页面填进输入框、光标留在那，**一个字都不发**。输入框已有字就另起一行，不覆盖。
- 接收端两道闸：① 只认 `event.source` 等于我们挂上去的框（`uiFrameOf()`）——别的窗口/扩展发来的不理；② 只接字符串、去两头空白、`CRLF` 归一、截断 500 字，空话丢弃。
- **没有做派单**，理由是权限：右栏 Today 页是 worker 写的，若卡片能直接派活，worker 写的 HTML 就能间接生成工单。要派活，走她正常接单路径（人按发送 → 她判断 → 工单），审批与审计都还在。
- 指南同步改了第 ③ 个模板：`dlUiPick` 的值必须写成「主人会说的话」，并明写「别承诺点了就执行」。

## 未做（别当已完成）

- **派单（T3）没做**，见上：这是权限决定，不是技术缺口。
- **主题切换没验**：变量是每次渲染现采的，理论上换肤后重渲染就跟着变；但我们的皮肤切换会触发页面重渲染吗，没测。
- **她还没被明确告知有这么个技能**：指南存在，`skill` 工具能加载，但 master 的提示词里没有「想画界面时先 load card-guide」。要不要加这一句，等于决定「她会不会主动画」——参见 v0.4.0 日志的「还缺什么」。
