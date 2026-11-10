# v0.1.0 追加说明

## 2026-11-10 09:30 观测更正

`verification.md` 第 12 行与 `summary.md` 备注里记录的另一会话交付目录，观测时叫
`docs/logs/2026-11-im-gateway/v0.1-design/`；该会话随后按 `docs/logs/README.md` §1
的命名规则（无版本概念用 `v0.0.1-slug`）把它改成了
`docs/logs/2026-11-im-gateway/v0.0.1-im-gateway-survey/`，四件套齐全。

以新目录名为准；上文两处旧名是当时观测，不改写（按 README §5「不改写历史」）。

## 2026-11-10 09:30 死链坐标补充

`summary.md` 备注提到的失效链接，精确位置是 `docs/architecture.md:659-661`，三个
指向 `docs/superpowers/plans/vivy-dsh-ecosystem/*.md` 的链接在全仓（含 submodule）
都不存在。将来处理时按 `DV-DOC-xx` 立条目。

## 2026-11-10 09:30 环境问题归因

`pwsh` 不可用的根因已定位到
`deepseek-harness/packages/sandbox/sandbox-windows-acl/src/path-boundary.ts:24`：
临时根路径落在工作区内（`diva-dsh/.artifacts/tmp`）时直接拒绝执行。
与本次纯文档交付无关，不在本目录范围内修复。
