# 验证记录

环境：Windows，Node v24.14.1，DSH_HOME=`C:\Users\Administrator\Desktop\diva-dsh\.artifacts\dsh-home`。

## 跑过并通过

```text
node --test tests/dream-evolution.test.mjs tests/evolution-dream-client.test.mjs tests/dream-skill-install.test.mjs
ℹ tests 20 ｜ pass 20 ｜ fail 0
```

```text
cd plugins/dsh-continual-harness
npx tsc -p tsconfig.json --noEmit     → exit 0
npx tsc -p tsconfig.build.json        → exit 0（lib/types/{skill-owner,panel,skill-owner-runtime}.js 已重新生成）
```

```text
cd plugins/dsh-continual-harness; $env:DSH_HOME=''; npx vitest run
Tests  678 passed ｜ 3 failed ｜ 1 skipped (682)
```

其中 `tests/panel.spec.ts`（新增 5 条）覆盖审批边界：缺 `origin` → 403、缺 `connection` → 503、宿主会话拒绝 → 401、跨站 origin → 403、非回环 host → 403、缺 `confirm` → 400、摘要不符 → 422、非 JSON → 415；批准只产生一个版本，改判被拒。

```text
node --test tests/evolution.test.mjs tests/evolution-dream-client.test.mjs tests/dream-evolution.test.mjs tests/dream-skill-install.test.mjs
ℹ tests 37 ｜ pass 37 ｜ fail 0
```

其中 `tests/evolution.test.mjs` 新增一条顺序断言：`TABS` 前三项必须是 `overview, approval, dream`。

## 失败项（均与本次改动无关）

| 用例 | 证据 | 判定 |
| --- | --- | --- |
| `logfile.spec.ts > creates fresh files with mode 0o600` | `expected 438 to be 384`（Windows 上 chmod 语义） | 平台既有 |
| `plugin.spec.ts > wires the default file log ... mode 0600` | 同上 | 平台既有 |
| `project.spec.ts > falls back to the directory name outside any repository` | 期望 `loose-notes`，得到 `diva-dsh`（cwd 在仓内） | 环境既有 |
| `plugin.spec.ts > manual Dream control plane`（4 条） | 仅当继承真实 `DSH_HOME` 时失败：测试目录为空，但组件发现读到了运行中的 evolution；清空 `DSH_HOME` 后 4 条全过 | 测试环境泄漏，既有 |
| `harness-owner-candidates.test.mjs` 多条 | teardown `EPERM` 删除 `.artifacts/test-tmp/*`（Windows 句柄未释放） | 清理失败，既有 |

根测试全量：

```text
node --test tests/*.test.mjs
ℹ tests 1267 ｜ pass 1116 ｜ fail 145 ｜ skipped 6
```

失败数与改动前基线（`INSTALLATION-NOTES.md`：1238 / 1083 / 149）同量级；按名字筛 `dream|evolution|skill` 只剩环境类用例，无 AutoDream 断言失败。

## 一次过程性回归（已修）

`src/client.js` 被编辑器整文件转成 CRLF，导致 `tests/evolution.test.mjs` 的 CSS 扫描找不到 `\`\n\n    const ROW_CSS` 标记而失败。已把这 6 个被转码的文件恢复为 LF（`numstat` 从整文件重写回落到逐行差异），重跑通过。

## 未验证

- 未重启实例，未在浏览器点击「批准并发布」。
- 未验证重启后 `connection` 服务与面板挂载顺序。
