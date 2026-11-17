# DeepSeek API 接入面调研（2026-11-17）

## 一句话

你记的没错，但**大部分能力在我们的 pin（0.2.1-rc.5）里就已经有了、而且这台机器已经在用**（默认模型 `deepseek-account`、Files 上传缓存 26 条）；0.2.2 真正新增的是 **DeepSeek 会话导入**（离线 ZIP，不是在线拉取）、**搜索默认改成直连 Search API**、以及几个边角（Files 超时、账号 Remote 重构、账号赠送通知）。对我们最要紧的是：升级后搜索要 DeepSeek 凭据、base 默认挂的两个「请求扩展」会把会话日志/插件清单随官方 API 请求上报（开关存在，本机是否真在上传未取证）。

## 本轮做了什么

- 盘点上游 `packages/` 里所有 DeepSeek 相关包与升级指南，区分「pin 已有」与「0.2.2 新增」。
- 读设计取舍三份 Agent Note（Messages 适配器、Search/Fetch API、会话导入），确认协议、限流、上限与丢弃规则。
- 读本机 profile patch、凭据**键名**、Files 缓存、78 份会话日志（zstd 解压后扫描）。
- 产出报告 `docs/research/deepseek-api-surface.md`（结论 + 能力表 + 本机现状 + 卡点 K1–K7 + 决策 D1–D6）。

## 结论要点

1. 模型接两条路由：`deepseek-official`（API key）与 `deepseek-account`（浏览器登录，模型来自账号 `GET /models`）；共用 Anthropic Messages 适配器（thinking effort、图片 Files、签名回放）。
2. 请求扩展默认两个：`session-log-deepseek`（`dsh_session_log`，8 MiB/请求上限，有 Web 开关）与 `plugin-package-inventory-deepseek`（`dsh_plugin_packages`）。
3. 搜索/抓取：旧 Messages 搜索（烧模型轮次）vs 直连 Search/Fetch API（`/v1/tools/search|fetch`，5 QPS，凭据 auto/account/api-key）；0.2.2 起默认换成后者，Exa/Perplexity 移除。
4. 会话导入：实验 bundle、默认关、只 owner；上传官网导出 `deepseek_data-*.zip`，最多 1000 个会话写进所选工作区；保留思考/搜索卡/阅读链接/图片，分叉与撤回内容丢弃。
5. 本机：默认模型 `deepseek-account`/`deepseek-flash`；有账号 token 记录、无 `DEEPSEEK_API_KEY`；Files 缓存 26 条（11-16 22:54 → 11-17 02:36）；78 份会话日志里 `session-log-deepseek` 水位事件 0 命中。

## 未验证

- 账号 token 是否仍有效、额度是否够（DV-RUN-001 历史 403）；没做真实 API 调用。
- `deepseek-flash` 是否在账号 `GET /models` 列表里（升级后影响是否显示「请选择模型」）。
- Search API 在账号计费下的单价/额度、实际延迟与结果质量。
- 78 份日志 0 命中是否等于「没在上传」（可能只是没有接受水位）。
- 会话导入的真实观感：没有 ZIP 样本，没跑过导入。
