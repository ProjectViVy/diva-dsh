# 验收

1. `node --test tests/esbuild-pipe.test.mjs`：Windows 上真实大输入转换成功，普通文件写入正常。
2. `just dev`：七个构建阶段（包括 Web build）全部通过，继续进入监听与服务。
3. 不应再出现 `vite:esbuild-transpile remove ... Access is denied`。
4. `just` 仍只显示教程。

普通文件、项目临时目录位置和非 Windows 行为保持原约定。浏览器交互与真实终端 Ctrl+C 不属于本次 esbuild 修复的验证结论。
