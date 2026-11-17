# 交付清单：全量测试修复到全绿

**本轮未提交**（AGENTS.md §6：用户说提交才提交）。下面是「属于本轮」的改动，工作树里其它脏文件是本轮之前就有的，不要顺手 stage。

## 实现代码（4 个，都在根仓库）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `scripts/surfcore-loader.mjs` | `replaceOnce` 归一化 CRLF 后按原风格写回；新增 `loadableUrl()` 把裸 Windows 路径转 `file://` | 低：只放宽「裸路径」这一种入参；锚点命中数仍然强校验 |
| `scripts/lib/component-setup.mjs` | `pnpm-lock.yaml` 的 `specifier` 锚点 `/`、`\` 都认 | 低：原来只认 `/`，Windows 上 manifest 用 `\` 时直接抛「lockfile does not match」 |
| `scripts/lib/component-migration.mjs` | `migration.json.sources[].path` 与备份 `manifest.json.files[].path` 统一落盘为 `/` | 低：只改 JSON 里记录的路径写法，文件系统操作仍用原生路径 |
| `scripts/lib/surfcore.mjs` | `sourceLink()` 在 Windows 上 rename 失败则 unlink 后重试 | 低：只在 rename 失败的分支生效，失败仍抛原错误 |

## 实现代码（1 个，在 `plugins/voice` 子模块）

| 文件 | 改动 | 风险 |
| --- | --- | --- |
| `plugins/voice/src/voice-pack-import.js` | 新增 `pathPrefixPattern()`；`relocatePackConfig()` 与 `repairMovedVoicePack()` 替换绝对路径前缀时 `/` 与 `\` 都认 | 中低：影响「导入包 / 搬目录后修路径」。语义从「只认同一种写法」放宽到「两种都认」，不匹配时行为与原来一致（不写文件） |

> `plugins/voice` 是独立仓：这次改动会让根仓库的 submodule 指针变脏。提交需要先在子模块提交，再在根仓库提交指针，两笔分开。

## 检查脚本（1 个）

- `scripts/check-asr-mount.mjs`：`process.exit(...)` → `process.exitCode = ...`（修 `0xC0000409`）。

## 测试（20 个）

```
tests/alignment-scan.test.mjs          tests/asr-http.test.mjs
tests/asr-registration.test.mjs        tests/bili-comment-cursor.test.mjs
tests/bili-dm-cursor.test.mjs          tests/component-migration.test.mjs
tests/component-setup.test.mjs         tests/evolution-records.test.mjs
tests/harness-owner-candidates.test.mjs tests/live2d.test.mjs
tests/memory-plugin.test.mjs           tests/ownership-boundaries.test.mjs
tests/source-runtime.test.mjs          tests/surfcore-adapter.test.mjs
tests/surfcore-runtime-transform.test.mjs tests/vivy-tone.test.mjs
tests/voice-core.test.mjs              tests/voice-installer-runner.test.mjs
tests/voice-plugin.test.mjs            tests/voice-registration.test.mjs
```

改动只有三类：路径与行尾归一化、清场顺序（关库/先轮转）、去掉「只认一种写法」的断言；没有删除任何断言、没有把断言改成 `assert.ok(true)` 之类的空转。

## 环境侧（不产出 diff，仅记录）

- `git -C plugins/surfcore checkout -- .`：修复 9 个文件的假性 ` M`（内容与 HEAD 一致，仅索引 stat 未刷新）。
- `git config --global --add safe.directory C:/Users/Administrator/Desktop/diva-dsh`：仓库在桌面目录下，git 需要它才肯操作（机器级配置，非仓库改动）。
- `.artifacts/test-run/driver.mjs`、`.artifacts/test-run/logs/`、`.artifacts/test-run/npm-test-full.txt`：取证脚手架与原始输出，在 `.artifacts/` 下，不入库。

## 回滚

```powershell
git checkout -- scripts tests
git -C plugins/voice checkout -- src/voice-pack-import.js
```

无需重建任何产物（没动 bundle、没动 profile 接线、没动 `cordis.patch.yml`）。

## 建议的提交切分（若用户要提交）

1. `fix(scripts): load surfcore from file URLs and tolerate CRLF checkout`
2. `fix(scripts): match lockfile specifiers and migration paths across separators`
3. `fix(voice): repair relocated pack paths written with either separator`（子模块）
4. `chore(voice): bump pointer for relocated-pack path repair`（根仓库）
5. `test: make the suite pass on Windows checkouts`（20 个测试 + `check-asr-mount`）
