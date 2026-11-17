# 发布 / 生效说明 v0.7.0-genui-install

## 生效条件

| 改动 | 何时生效 | 怎么让它生效 |
| --- | --- | --- |
| genui 宿主半边（提示词 / `render_ui` / `validate_dsh_ui` / genui skill） | 已生效 | 无（profile 热加载，本会话技能清单里已出现 `genui`） |
| genui 浏览器半边（`dsh-ui` 围栏渲染） | 下次页面加载 | 面板硬刷新（Ctrl+R）。实测：运行中注册 + 刷新即可，**不用重启 3082** |
| `FREE_HTML_UI = false`（自由 html 停用） | 下次宿主启动 | `npm run stop && npm start`（会断面板十几秒）。刷新不够：宿主把 client bundle 读进内存 |
| pin 校验 / setup 脚本 | 立即 | 无 |

## 需要重启的场合

- 想把自由 html 彻底关掉（本轮改的开关）。
- 想升级 genui：改 `third-party/pins.json` 的 `tag`（必须等于 `v<package.version>`）→ `git submodule update --remote` 或 fetch 后 checkout → `npm run stop && npm run setup:third-party && npm start`。

## 不做的事

- 不提交：本轮没有 `git commit`；`git status` 里 `.gitmodules` 与 `third-party/genui`（gitlink）是新增，其余是你工作区里已有的改动。
- 不动 `$DSH_HOME/today/<date>.html`：自由 html 停用只是不显示，文件原样留着。
