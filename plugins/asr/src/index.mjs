// 插件入口：装配状态目录 → 引擎 → 服务 → 两个 HTTP 面。
//
// 这里只做「接线」，不含策略：所有判断都在 service 与引擎里，
// 这样测试可以绕过 HTTP 直接跑服务，面板与内部调用也天然行为一致。
import { join } from 'node:path'
import { prepareStateDir, projectHome, resolveComponentPath } from '../../_shared/paths.mjs'
import { registerComponentInternal } from '../../_shared/ipc.mjs'
import { createConfigStore } from './store.mjs'
import { createModelStore } from './model-store.mjs'
import { createEngineRegistry } from './engine-registry.mjs'
import { createSensevoiceEngine } from './engine-sensevoice.mjs'
import { createAsrService } from './service.mjs'
import { registerAsrHttp } from './http.mjs'
import { createInternalHandler } from './internal.mjs'

export const name = 'dsh-local-asr'
export const inject = ['webServer', 'connection']

export function apply(ctx) {
  const env = process.env
  const home = projectHome(env)
  const stateDir = prepareStateDir(resolveComponentPath(env, 'DSH_ASR_STATE_DIR', join(home, 'asr'), { label: '语音识别状态目录' }), '语音识别状态目录')
  const logger = ctx.logger ?? null

  const configStore = createConfigStore(stateDir)
  const modelStore = createModelStore(stateDir, { getOrigins: () => configStore.get().sensevoice.modelSources, logger })
  const engines = createEngineRegistry()
  const engine = createSensevoiceEngine({ stateDir, modelStore, getConfig: () => configStore.get(), logger })
  const unregister = engines.register(engine)
  const { service } = createAsrService({ stateDir, configStore, engines, engine, logger })

  const disposeHttp = registerAsrHttp(ctx, service, { logger })
  let disposeInternal
  try {
    disposeInternal = registerComponentInternal(ctx, { home, name: 'asr', handle: createInternalHandler(service, { logger }) })
  } catch (error) {
    disposeHttp()
    throw error
  }
  logger?.info?.(`语音识别已挂载（引擎 ${configStore.get().engine}，状态目录 ${stateDir}）`)

  ctx.effect(() => async () => {
    disposeInternal(); disposeHttp(); unregister()
    await service.dispose()
  })
}

export default { name, inject, apply }
