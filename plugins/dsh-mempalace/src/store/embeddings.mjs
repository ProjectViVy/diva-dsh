import * as fs from 'node:fs'
import { normalizeTopicLabel } from './chunk.mjs'

const RETRY_AFTER_MS = 5 * 60_000
const DEFAULT_LOAD_TIMEOUT_MS = 60_000

export class EmbeddingUnavailableError extends Error {
  constructor(message, hint) {
    super(message)
    this.name = 'EmbeddingUnavailableError'
    this.hint = hint
  }
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function generatedText(output) {
  const first = Array.isArray(output) ? output[0] : undefined
  const value = first && typeof first === 'object' ? first.generated_text : undefined
  return typeof value === 'string' ? value : ''
}

function withTimeout(promise, ms, message) {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new EmbeddingUnavailableError(message, '可稍后重试，或运行 npm run setup:mempalace -- --warm-models')
      error.code = 'MODEL_LOAD_TIMEOUT'
      reject(error)
    }, ms)
    promise.then(value => {
      clearTimeout(timer)
      resolve(value)
    }, error => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/**
 * Lazy local models. Storage and search never wait for a cold download: they
 * start the load in the background and degrade to zero vectors + SQLite FTS.
 * Only explicit warmups await the load, bounded by `loadTimeoutMs`.
 */
export class EmbeddingService {
  constructor({ modelName, topicModel, cacheDir, hfEndpoint = '', loadTimeoutMs = DEFAULT_LOAD_TIMEOUT_MS, createPipeline = null, logger = console } = {}) {
    this.modelName = modelName
    this.topicModel = topicModel
    this.cacheDir = cacheDir
    this.hfEndpoint = hfEndpoint
    this.loadTimeoutMs = loadTimeoutMs
    this.createPipeline = createPipeline
    this.logger = logger
    this.embedder = null
    this.topicGenerator = null
    this.embedLoading = false
    this.topicLoading = false
    this.embedPromise = null
    this.topicPromise = null
    this.embedError = null
    this.topicError = null
    this.embedRetryAt = 0
    this.topicRetryAt = 0
    this.transformers = null
  }

  async #pipeline(task, model, options) {
    if (this.createPipeline) return this.createPipeline(task, model, options)
    const { pipeline } = await this.#loadTransformers()
    return pipeline(task, model, options)
  }

  async #loadTransformers() {
    if (this.transformers) return this.transformers
    const module = await import('@huggingface/transformers')
    const env = module.env
    if (this.cacheDir) {
      fs.mkdirSync(this.cacheDir, { recursive: true })
      env.cacheDir = this.cacheDir
    }
    if (this.hfEndpoint) env.remoteHost = this.hfEndpoint
    this.transformers = module
    return module
  }

  #ensureRetry(errorField, retryField) {
    if (this[errorField] && Date.now() < this[retryField]) {
      throw new EmbeddingUnavailableError(
        this[errorField],
        this.hfEndpoint
          ? '本地模型尚未就绪；可在面板设置中重新预热'
          : '本地模型尚未就绪；如无法访问 huggingface.co，请在设置中填写 HF 镜像地址后重试',
      )
    }
  }

  #recordFailure(errorField, retryField, message) {
    this[errorField] = message
    this[retryField] = Date.now() + RETRY_AFTER_MS
    this.logger.warn?.(`dsh-mempalace: ${message}`)
  }

  #startEmbedLoad() {
    this.embedLoading = true
    const promise = (async () => {
      try {
        const embedder = await this.#pipeline('feature-extraction', this.modelName, { dtype: 'fp32' })
        this.embedder = embedder
        this.embedError = null
        this.embedRetryAt = 0
        return embedder
      } catch (error) {
        this.#recordFailure('embedError', 'embedRetryAt', `嵌入模型加载失败：${errorMessage(error)}`)
        throw new EmbeddingUnavailableError(this.embedError, '设置 HF 镜像或运行 npm run setup:mempalace -- --warm-models')
      } finally {
        this.embedLoading = false
        this.embedPromise = null
      }
    })()
    this.embedPromise = promise
    promise.catch(() => {})
    return promise
  }

  #startTopicLoad() {
    this.topicLoading = true
    const promise = (async () => {
      try {
        const generator = await this.#pipeline('text2text-generation', this.topicModel)
        this.topicGenerator = generator
        this.topicError = null
        this.topicRetryAt = 0
        return generator
      } catch (error) {
        this.#recordFailure('topicError', 'topicRetryAt', `话题模型加载失败：${errorMessage(error)}`)
        throw new EmbeddingUnavailableError(this.topicError, '可关闭 topicInferenceEnabled 或配置 HF 镜像')
      } finally {
        this.topicLoading = false
        this.topicPromise = null
      }
    })()
    this.topicPromise = promise
    promise.catch(() => {})
    return promise
  }

  async #awaitLoad(promise, errorField, retryField, label) {
    try {
      return await withTimeout(promise, this.loadTimeoutMs, `${label}超时（${this.loadTimeoutMs}ms）`)
    } catch (error) {
      if (error?.code === 'MODEL_LOAD_TIMEOUT') this.#recordFailure(errorField, retryField, error.message)
      throw error
    }
  }

  /** Await a model load; explicit warmup path only. */
  async getEmbedder() {
    this.#ensureRetry('embedError', 'embedRetryAt')
    if (this.embedder) return this.embedder
    const promise = this.embedPromise || this.#startEmbedLoad()
    return this.#awaitLoad(promise, 'embedError', 'embedRetryAt', '嵌入模型加载')
  }

  async #runEmbedder(embedder, text) {
    const result = await embedder(text, { pooling: 'mean', normalize: true })
    const vector = new Float32Array(result.data)
    if (vector.length === 0) throw new EmbeddingUnavailableError('嵌入模型返回空向量', '重新预热模型')
    return vector
  }

  /** Await a model load; callers that cannot wait use `embedIfReady`. */
  async embed(text) {
    return this.#runEmbedder(await this.getEmbedder(), text)
  }

  /** Storage path: never blocks on a cold download, starts it in the background. */
  async embedIfReady(text) {
    this.#ensureRetry('embedError', 'embedRetryAt')
    if (this.embedder) return this.#runEmbedder(this.embedder, text)
    if (!this.embedLoading && !this.embedPromise) this.#startEmbedLoad()
    throw new EmbeddingUnavailableError('嵌入模型正在后台加载', '首次使用会下载模型；也可在设置中预热，随后重建索引')
  }

  async getTopicGenerator() {
    if (!this.topicModel) throw new EmbeddingUnavailableError('话题模型未配置', '在设置中配置 topicModel')
    this.#ensureRetry('topicError', 'topicRetryAt')
    if (this.topicGenerator) return this.topicGenerator
    const promise = this.topicPromise || this.#startTopicLoad()
    return this.#awaitLoad(promise, 'topicError', 'topicRetryAt', '话题模型加载')
  }

  async #runTopic(generator, content) {
    const prompt = [
      'What is the main software topic? Answer with a short noun phrase.',
      'Text:',
      String(content ?? '').slice(0, 1200),
      'Topic:',
    ].join('\n')
    const output = await generator(prompt, { max_new_tokens: 8, do_sample: false })
    return normalizeTopicLabel(generatedText(output))
  }

  async inferTopic(content) {
    return this.#runTopic(await this.getTopicGenerator(), content)
  }

  /** Capture/save path: keep the load going, but never block the write. */
  async inferTopicIfReady(content) {
    if (!this.topicModel) throw new EmbeddingUnavailableError('话题模型未配置', '在设置中配置 topicModel')
    this.#ensureRetry('topicError', 'topicRetryAt')
    if (this.topicGenerator) return this.#runTopic(this.topicGenerator, content)
    if (!this.topicLoading && !this.topicPromise) this.#startTopicLoad()
    throw new EmbeddingUnavailableError('话题模型正在后台加载', '稍后保存可自动推断话题，或关闭 topicInferenceEnabled')
  }

  async warmup() {
    this.embedError = null
    this.embedRetryAt = 0
    await this.embed('mempalace warmup')
    return this.status()
  }

  async warmModels() {
    const result = { embedding: 'error', topic: 'error', errors: [] }
    this.embedError = null
    this.embedRetryAt = 0
    try {
      await this.embed('mempalace warmup')
      result.embedding = 'ready'
    } catch (error) {
      result.errors.push(errorMessage(error))
    }
    if (this.topicModel) {
      this.topicError = null
      this.topicRetryAt = 0
      try {
        await this.getTopicGenerator()
        result.topic = 'ready'
      } catch (error) {
        result.errors.push(errorMessage(error))
      }
    } else {
      result.topic = 'disabled'
    }
    return result
  }

  status() {
    const state = (ready, loading, error) => (ready ? 'ready' : error ? 'error' : loading ? 'loading' : 'idle')
    return {
      embedding: state(this.embedder, this.embedLoading, this.embedError),
      topic: this.topicModel
        ? state(this.topicGenerator, this.topicLoading, this.topicError)
        : 'disabled',
      model: this.modelName,
      topicModel: this.topicModel,
      cacheDir: this.cacheDir,
      hfEndpoint: this.hfEndpoint || null,
      loadTimeoutMs: this.loadTimeoutMs,
      error: this.embedError,
      topicError: this.topicError,
    }
  }

  async dispose() {
    this.embedder = null
    this.topicGenerator = null
    this.transformers = null
    this.createPipeline = null
    this.embedLoading = false
    this.topicLoading = false
    this.embedPromise = null
    this.topicPromise = null
  }
}
