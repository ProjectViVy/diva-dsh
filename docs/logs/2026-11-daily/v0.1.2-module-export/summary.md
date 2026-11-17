# dsh-daily 浏览器导出修复

- 根因：ModuleLoader 调用 `factory(require)`，不会提供 CommonJS `module`；插件却访问 `module.exports`，导入时抛 ReferenceError。
- 修复：工厂直接返回 `{ apply, inject, name }`，不增加包装与依赖。
- 回归：移除测试伪造的 module 参数，修改前复现相同错误，修改后 12/12 通过。
- 后续：按用户要求保存 `http://127.0.0.1:7890` 代理并成功重启，status 的 runtime 为 ready、errors 为空、proxy.needs_restart=false。浏览器刷新后的激活与 GUI 仍未验证。
- 根全量测试未通过且未正常收尾；中止前观察到 999 条通过、109 条失败，详见 verification.md。未提交。
