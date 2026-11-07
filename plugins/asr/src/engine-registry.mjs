// 引擎注册表：把「识别这件事由谁来做」收成一个可枚举的对象。
//
// 现在只有一个本地 SenseVoice，但接口按多引擎设计：
// 面板列出 `list()`，配置里的 `engine` 选 `id`，`resolve()` 负责报「没有这个引擎」。
// 将来接云端 HTTP 识别，只要实现同样的五件事，不用动 service / http / 面板。

/**
 * 引擎的最小契约。
 * @typedef {object} AsrEngine
 * @property {{ id: string, name: string, location: 'host-local' | 'cloud', languages: string[], about?: object }} info
 * @property {() => object} status            就绪度快照（不得触发重活，比如拉起子进程）
 * @property {(options?: object) => Promise<object>} prepare   准备资产（幂等）
 * @property {(request: object) => Promise<object>} transcribe 识别一次
 * @property {() => Promise<void>} [dispose]
 */

/** 请求了不存在的引擎时抛出；调用方据此返回 400。 */
export class UnknownEngineError extends Error {
  constructor(id, known) {
    super(`未知的识别引擎 ${id}${known.length ? `（可用：${known.join('、')}）` : ''}`)
    this.name = 'UnknownEngineError'
    this.code = 'ASR_UNKNOWN_ENGINE'
  }
}

export function createEngineRegistry() {
  const engines = new Map()
  return {
    /** 注册一个引擎；id 重复直接报错，避免半路替换掉正在用的那个。 */
    register(engine) {
      const id = engine?.info?.id
      if (typeof id !== 'string' || id === '') throw new Error('识别引擎必须有 id')
      if (engines.has(id)) throw new Error(`识别引擎 id 重复：${id}`)
      engines.set(id, engine)
      return () => { if (engines.get(id) === engine) engines.delete(id) }
    },
    get: id => engines.get(id) ?? null,
    list: () => [...engines.values()],
    resolve(id) {
      const engine = engines.get(id)
      if (!engine) throw new UnknownEngineError(String(id), [...engines.keys()])
      return engine
    },
    async disposeAll() {
      const results = await Promise.allSettled([...engines.values()].map(engine => engine.dispose?.()))
      engines.clear()
      const failure = results.find(result => result.status === 'rejected')
      if (failure) throw failure.reason
    },
  }
}
