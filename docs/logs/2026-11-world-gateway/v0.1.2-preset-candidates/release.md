# 发布 · v0.1.2

本轮**没有提交**（仓库约定：用户说提交才提交）。改动清单：

## 本仓（根仓库）

- `plugins/capability-hub/src/candidates.mjs`（新）
- `plugins/capability-hub/scripts/explore-endpoints.mjs`（新）
- `plugins/capability-hub/src/{capabilities,catalog}.mjs`
- `plugins/capability-hub/tests/{candidates.test.mjs 新, catalog.test.mjs}`
- `plugins/capability-hub/README.md`
- `docs/research/capability-hub-slots.md` §10
- `docs/logs/2026-11-world-gateway/v0.1.2-preset-candidates/`
- `TODOLIST.md`

## 提交建议（英文 Conventional Commits）

```bash
git add plugins/capability-hub docs/research/capability-hub-slots.md \
        docs/logs/2026-11-world-gateway/v0.1.2-preset-candidates TODOLIST.md
git commit -m "feat(capability-hub): ship preset model candidates and endpoint probe script"
```

`plugins/capability-hub` 仍**不是 submodule**（`vivy-dsh/word-gateway` 还没建仓）。等建仓与
`git submodule add` 完成后再按子模块提交流程走；本轮文件留在工作区。
