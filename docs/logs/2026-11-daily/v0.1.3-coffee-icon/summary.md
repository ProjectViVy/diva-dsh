# dsh-daily 左栏图标改成咖啡杯

- 用户要求：「diva 顶部的日常按钮，改成一个咖啡标志」。左栏那一行是 `sidebar.panellist` 的入口（id `daily`、order -5），图标组件是 `plugins/dsh-daily/client.js` 的 `DailyIcon`。
- 改法：只换 `<svg>` 里的路径与画布。原先是 16 格上的日出（地平线 + 半日 + 光点），换成 24 格的咖啡杯：杯身与把手一条路径、三缕热气三条路径，描边 2 单位，与同列 `VIVY心核/工具` 表头的扳手同一画法（16px 落在 1.33px）。
- 不动的东西：注册元数据、`label: () => '日常'`（`dsh-vivy-studio/sidebar-core.js` 的 `KEEP` 白名单读的是 aria-label，改字就会被折进分组）、`aria-hidden`、`currentColor`。
- 代价：无新增依赖、无新增样式；`client.js` 净增 3 行注释。刷新页面即生效（浏览器半身），不需要重启宿主。
- 旧的日出（回退用）：`viewBox: '0 0 16 16'`、`strokeWidth: 1.4`，三条 `d` 依次为 `M1.9 11.4h12.2`、`M8 2.6a3.1 3.1 0 0 1 3.1 3.1H4.9A3.1 3.1 0 0 1 8 2.6Z`、`M8 1v.7M8 6.9v.9M2.9 3.7l.6.5M12.5 3.7l-.6.5`。
