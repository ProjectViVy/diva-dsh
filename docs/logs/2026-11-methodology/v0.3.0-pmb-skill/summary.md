# v0.3.0 安装「多·快·好·省」skill 并设为开发前必读

- 状态：已交付（技能资产 + 文档规则，无代码改动）
- 范围：新增 `skills/more-faster-better-economical/SKILL.md`（6158 B，原样）与 `LICENSE`（MIT，1063 B）；`AGENTS.md` 增「开发前必读（硬性）」段与 `principles-before-dev` 规则，86 → 91 行
- 验证：字节数与上游 blob 一致；frontmatter `name` 与目录同名；与 `skills/diva-dream` 同构；`AGENTS.md` 91 行 ≤160
- 未验证：新会话能否按名加载该 skill（技能目录按会话建立，本会话看不到）；规则是否被执行
- 下一步：无
- 回滚：删除 `skills/more-faster-better-economical/`，并 `git checkout -- AGENTS.md`

## 改了什么

1. **安装技能**：把 `mastwet/more-faster-better-economical`（HEAD `43c00d2`）的 `SKILL.md` 原样放进项目技能目录，附上游 MIT `LICENSE`（版权 2026 大湿），未改一字——包括它自己的英文正文与 frontmatter。
2. **设为硬性前置**：`AGENTS.md` §2 加一段「开发前必读（硬性）」：任何改代码、改配置、加依赖、动架构的活，动手前先加载该 skill；并要求产出体现它（最简方案 + 一个备选 + 依据；审查按影响排序；不加需求外功能、不加无测量支撑的性能机器）。
3. **Rulebook 第 7 条**：`principles-before-dev`，正例/反例/执行各一句，和其他规则同格式。

## 影响面

- 新会话的常驻指令 +5 行；技能目录多一个可加载项。
- 不涉及代码、依赖、配置、运行进程。
- 与既有 `diva-dream` skill 同目录同构，不新增目录约定。

## 未验证

- **技能可见性**：DSH 的技能目录在会话启动时建立，本会话注入的技能清单里还没有它。需要新开会话确认「按名加载」生效；若没有，说明项目级技能目录不是 `skills/`，要改落到 DSH 认的位置。
- 规则是否真被执行：只能看下一个会话动手前有没有先给「最简方案 + 备选 + 依据」。

## 备注

- 上游 `README.md`（中文导读）未随装：技能只需要 `SKILL.md`，多一份 README 反而让下个会话去读两处。原文地址记在此处备查：`https://github.com/mastwet/more-faster-better-economical`
- 上游正文是英文、无中文版；本仓文档为中文，二者不冲突（技能是决策标准，不是文档规范）。
