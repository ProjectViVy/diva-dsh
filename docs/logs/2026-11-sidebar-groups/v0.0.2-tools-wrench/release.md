# 发布：v0.0.2-tools-wrench-glyph

## 生效方式

分组标记由 `dsh-vivy-studio` 的 `webServer.tapIndex` 在**进程启动时**读进内存后再注入首页，
改文件不会热更，必须重启面板进程：

```
npm run stop
npm start
```

（本仓库也可用 `node scripts/vivy-dsh.mjs restart`；`npm` 包一层，行为一致。重启后浏览器硬刷新一次。）

## 影响范围

- 只改 `plugins/dsh-vivy-studio/sidebar-core.js` 与同目录 `README.md`。
- 不涉及 DSH 本体、Superagent、SurfCore、`patches/`、`cordis.patch.yml`，不需要重跑 `npm run setup`。
- 无新依赖、无配置项、无数据迁移。

## 回滚

```
git checkout -- plugins/dsh-vivy-studio/sidebar-core.js plugins/dsh-vivy-studio/README.md
```

然后同样重启面板进程，分组头恢复成三条滑轨。

## 提交

未提交；待用户确认视觉后再提交（一次提交一件事，建议 `feat(ui): draw the VIVY tools group with a wrench`）。
