# 变更与依据

`scripts/lib/esbuild-pipe.cjs` 是只对 Windows 生效的预加载兼容层：仅拒绝当前临时目录下 `esbuild-<64 hex>` 的 Node fs 写入，让 esbuild 使用已有的管道回退。其他文件写入照常。

`scripts/dev.mjs` 仅向开发子进程的 NODE_OPTIONS 追加兼容层，不改用户 shell。用 NODE_OPTIONS 而不是命令行 --require，以覆盖 esbuild 的同步 worker（上游显式清空 execArgv）。保留项目原有工作区外临时目录。

最简方案：使用 esbuild 自带回退路径，避免跨进程删除问题。备选：升级构建依赖或修改原生 esbuild，但会扩大上游改动面，且没有本机有效性证据。本次不改权限、不禁用杀毒软件、不改上游与 node_modules。

`tests/esbuild-pipe.test.mjs` 调用真实 Vite 所用 esbuild，验证同步/异步大输入内容及普通同步/异步写入。
