# v0.0.1-vivy-tools 交付与回滚

## 交付物

| 文件 | 性质 |
| --- | --- |
| `plugins/dsh-vivy-studio/sidebar-core.js` | 单组 → 组表；新增 `VIVY工具`；每组独立键与属性；空组自动撤头 |
| `plugins/dsh-vivy-studio/theme.css` | `.diva-tools-glyph` 尺寸规则 + 拆成两条的收起点规则 + 注释同步 |
| `plugins/dsh-vivy-studio/README.md` | 侧边栏分组一节、Differences 与 Files 表、活体检查说明（93 → 101 项） |
| `plugins/dsh-vivy-studio/verify-skin.mjs` | 分组检查块改为两组：成员集合、独立折叠、空组、rail、刷新后状态 |
| `tests/vivy-sidebar-core.test.mjs` | 组表相关断言；新增「每组各自状态」用例 |
| `tests/vivy-skin-css.test.mjs` | 两条收起点规则的选择器；新增「每组只收自己」用例 |

## 为什么这样切

**最简方案**：在既有的一段 DOM 增强里把「一个组」参数化成「一张组表」（`GROUPS`），组名/状态键/字形都是数据，成员判定仍是读 `aria-label`。新增的只有一条 CSS 收起点规则、一个 16px 字形和一次 `localStorage` 键。总代价约 +90 行手写代码、0 依赖、0 配置项，复用既有观察者与「先比较再写」的收敛机制。

**备选一**：改 `dsh-context`，让它把自己的面板注册到另一个 slot 或改 order。否决——它是第三方 submodule（`third-party/`，pin 在 `v0.83.1`），`AGENTS.md` 红线是只读；为一个界面位置去漂移 pin 不划算，且 DSH 的 `sidebar.panellist` 本来就没有分组字段。

**备选二**：在 shell 层加一个真正的 slot 分组字段（改 DSH 或打补丁）。否决——DSH 上游只读，且这是一处皮肤级编排，`patches/` 的成本远高于收益。

**取舍依据**：分组的唯一事实源是面板的可访问名，这让「以后再加一个工具面板」变成往正则里加一个词，而不必改样式或接线；代价是组的位置跟随 shell 的 `order` 排序（工具组落在 `心核` 之后），一旦有插件注册比 `上下文洞察`（order 20）更大的 order，`工具` 组会跟着下移——这是可接受的，因为「工具在核心之后」正是要表达的次序。

## 风险

1. **两组的顺序依赖 shell 的 order**：`VIVY工具` 头插在 `上下文洞察` 前，`上下文洞察` order = 20，`心核` 成员 10–15，因此工具组自然落在核心组之后。若将来某个核心类插件注册 order > 20，两个组的成员会交错，界面会变成「核心头/工具头/核心行」的夹心。出现时的最小修法是给 `TOOL` 白名单加词或调整注册 order，不要改成本脚本去搬动成员行（「成员只标记、不移动」是这条增强的收敛前提）。
2. **`更多` 必须是最后一行**：常驻行拉回逻辑对 `更多` 豁免；若 shell 改掉这个顺序，`更多` 会留在组后面，与现在一致，不会更差。
3. **`data-diva-group` 写到了 shell 的行上**：React 不管理这个属性，重渲染换元素时会丢，下一次 `sync()` 会补回；这也是「每次 pass 重新读标签」的原因。
4. **`verify-skin.mjs` 的 101 项未跑**：它的期望值是按新逻辑改的，但没在真实页面上执行过；第一次跑很可能是细节（截图名、计数）而不是行为问题——按失败项逐条修，不要为了让脚本过而放宽断言。

## 回滚

```bash
git checkout -- plugins/dsh-vivy-studio/sidebar-core.js plugins/dsh-vivy-studio/theme.css \
  plugins/dsh-vivy-studio/README.md plugins/dsh-vivy-studio/verify-skin.mjs \
  tests/vivy-sidebar-core.test.mjs tests/vivy-skin-css.test.mjs
```

重启面板后侧边栏回到单组。删除 `docs/logs/2026-11-sidebar-groups/` 即撤销交付记录。

## 后续

- 重启按 `acceptance.md` 走一遍；若工具组里还想放别的面板（如 `记忆卡片`），只改 `TOOL` 一个正则。
- 若真的需要「组内排序」「组间换位」这类能力，再考虑要不要在 shell/slot 层解决，而不是在这段脚本里继续加规则。
- 按 `AGENTS.md` §6 **未提交**。
