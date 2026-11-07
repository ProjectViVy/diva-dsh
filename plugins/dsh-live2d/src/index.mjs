// 插件入口：现在只是一个遥控器。
//
// 角色舞台（渲染、编译、引擎、模型资产、指令箱）已经搬进独立进程 stage-app/，
// 有它自己的端口、自己的令牌、自己的生命周期。理由见研究包里 Mirror 的边界：
// 呈现与具身应当独立演进，不该成为宿主无法移除的编译耦合。
//
// 所以这里只剩一件事：把对话里的 l2d_* 工具转给那个进程。
// 不再 inject webServer（不再托管页面与素材），不再 inject connection（不再自建鉴权），
// 不再有队列、模型扫描、HTTP 路由。
//
// 代价说清楚：DSH 启动时如果舞台没在跑，工具会明确报「舞台没有运行」，
// 而不是偷偷降级成一套内嵌实现——那样两套东西迟早各说各话。
import { projectHome } from '../../_shared/paths.mjs'
import { registerLive2dTools } from './l2d-tools-remote.mjs'

export const name = 'dsh-live2d'
export const inject = ['tools']

export function apply(ctx) {
  const home = projectHome(process.env)
  const logger = ctx.logger ?? null

  let disposeTools = null
  try {
    disposeTools = registerLive2dTools(ctx, { home, logger })
  } catch (error) {
    // 工具注册失败不该让宿主起不来：舞台那边还能单独用。
    logger?.warn?.(`[live2d] 工具注册失败：${error?.message ?? error}`)
  }

  return () => {
    try { disposeTools?.() } catch { /* 已经释放过 */ }
  }
}
