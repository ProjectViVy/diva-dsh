# docs/resources

仓库用到的静态资源。

## diva.png

根 `README.md` 顶部的通栏头图。**2172x724（3:1 横构图）、约 2.2 MB、PNG。**

- 主题：鲸鱼娘 / DIVA —— 深海蓝到青绿的长发、鲸鱼鳍发饰、氟石般的青绿棱镜光，
  身后有半透明鲸鱼剪影游过。
- 生成方式：经 ChatGPT / Codex 的 OAuth 路由调用 `gpt-image-2`（Hermes 的
  `apikey-image-gen` skill 所描述的同一条后端链路）。生成脚本留在本机
  `.artifacts/gen-image.py`，**没有入库** —— 它直接调的是 Codex 的私有端点，
  要不要公开收进 `scripts/` 由你决定。
- 后端**不接受指定尺寸**：请求里写 `size` / `quality` 会被忽略，返回自己的取值，
  所以这张图的尺寸是后端决定的，不是设定出来的。
- 画面内不含任何文字 —— 图像模型渲染文字会糊，标题一律由 HTML 排。

⚠️ 这里的图会随仓库公开分发，只放你有权发布的素材。
Live2D 模型本体、Cubism Core，以及 `stage-app/demo/` 之外的第三方模型一律不入库。
