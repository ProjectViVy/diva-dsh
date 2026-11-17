# dsh-see-now · v0.3.2-panel-review · 发布

- 性质：`plugins/dsh-see-now` 的本地增量（**未提交**，按 AGENTS.md「用户说提交才提交」）。
- 改动面：`client.js`、`src/lifecycle-store.mjs`、两个测试文件；服务端路由与配置格式**未改**。
- 补丁：`patches/see-now-vivy-core.patch` → **51,832 字节 / 7 文件**；`scripts/setup-see-now.mjs` 幂等（识别为已应用）。
- 重新生成补丁时必须先 `git -C plugins/dsh-see-now add -N .`：`src/lifecycle-store.mjs` 与两个测试文件在该子模块里是未跟踪文件，直接 `git diff` 会漏掉它们，补丁就变成"删掉这三个文件"之外的空洞。
- 生效方式：`npm run stop && npm start` + 浏览器硬刷新。
- 回滚：先备份，再 `git -C plugins/dsh-see-now checkout -- client.js src/lifecycle-store.mjs test/client-wiring.test.mjs test/lifecycle-store.test.mjs`，随后把 `patches/see-now-vivy-core.patch` 回退到上一版并 `npm run setup:see-now` 重放。不删除 `~/.dsh/see-now/` 下的配置与流水。
- 风险 / 限制：
  - `readLifecycle()` 改成尾读后，若单行超过 320 字节（`note` 很长）会少读几条——`limit` 下限 4KB 兜住了常见情况，但极端长行仍可能截断，届时读到的条数会少于 `limit`（不会出现半截记录）。
  - `snVerdict` 的判断依赖 `stats.kept` 与 `cap.frames`；老宿主（无 `stats`）时退化成「没在采集 / 一帧都没抓到」两句，不会抛。
  - 面板仍是中文硬编码文案；本插件其余部分也只有 `locale/*.json` 里的标题级 i18n，保持现状。
