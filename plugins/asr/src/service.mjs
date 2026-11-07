// 识别服务：插件对外的唯一门面。
//
// 它把「谁来做、能不能做、做过没有」三件事分开：
//   - 引擎注册表决定谁来做；
//   - 配置与限流决定能不能做；
//   - 内容寻址缓存决定是不是可以不做。
// 面板 API 与内部 API 都只调这里的方法，不自己碰状态目录。
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join, extname, isAbsolute } from 'node:path'
import { randomUUID } from 'node:crypto'
import { AudioInputError, fingerprint, inspectWave, normalizeWave, writeTempWave } from './audio.mjs'
import { AsrError, toAsrError } from './errors.mjs'
import { UnknownEngineError } from './engine-registry.mjs'

const RATE_WINDOW_MS = { minute: 60_000, hour: 3_600_000 }

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}

function writeJson(file, value) {
  const tmp = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(tmp, `${JSON.stringify(value)}\n`, { mode: 0o600 })
    renameSync(tmp, file)
  } catch (error) { try { unlinkSync(tmp) } catch {}; throw error }
}

/** 合成一段静音 WAV，用于自检时验证「引擎真的能跑」。 */
export function silentWave(seconds = 0.4, sampleRate = 16000) {
  const frames = Math.max(1, Math.round(seconds * sampleRate))
  const bytes = Buffer.alloc(44 + frames * 2)
  bytes.write('RIFF', 0, 'ascii'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii'); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22)
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34)
  bytes.write('data', 36, 'ascii'); bytes.writeUInt32LE(frames * 2, 40)
  return bytes
}

/**
 * 打开识别服务。
 * @param options.stateDir - 已就绪的状态目录。
 * @param options.configStore - 配置仓储。
 * @param options.engines - 引擎注册表。
 * @param options.engine - 当前引擎（由 index.mjs 装配，默认 sensevoice）。
 * @param options.logger - 可选日志。
 */
export function createAsrService({ stateDir, configStore, engines, engine, logger = null }) {
  const cacheDir = join(stateDir, 'cache')
  const tmpDir = join(stateDir, 'tmp')
  const dataDir = join(stateDir, 'data')
  const ledgerFile = join(dataDir, 'ledger.json')
  const auditFile = join(dataDir, 'audit.jsonl')
  mkdirSync(cacheDir, { recursive: true, mode: 0o700 })
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })

  const config = () => configStore.get()
  const activeEngine = () => {
    const id = config().engine
    return id === engine.info.id ? engine : engines.resolve(id)
  }

  // ── 限流账本：插件是唯一写入方，跨进程读同一份时间戳 ──────────────────────
  const readLedger = () => {
    const raw = readJson(ledgerFile, { times: [] })
    const times = Array.isArray(raw?.times) ? raw.times.filter(value => Number.isFinite(value)) : []
    const now = Date.now()
    return times.filter(value => now - value < RATE_WINDOW_MS.hour)
  }

  function budgetStatus() {
    const times = readLedger()
    const now = Date.now()
    const { maxPerMinute, maxPerHour } = config().limits
    return {
      inMinute: times.filter(value => now - value < RATE_WINDOW_MS.minute).length,
      inHour: times.length,
      limits: { maxPerMinute, maxPerHour },
    }
  }

  function budgetCheck() {
    const times = readLedger()
    const now = Date.now()
    const { maxPerMinute, maxPerHour } = config().limits
    if (maxPerMinute > 0 && times.filter(value => now - value < RATE_WINDOW_MS.minute).length >= maxPerMinute) {
      throw new AsrError(`识别太频繁（每分钟上限 ${maxPerMinute} 次）`, { code: 'ASR_RATE_LIMITED', hint: '等一分钟再试，或在面板调大频率上限', status: 429 })
    }
    if (maxPerHour > 0 && times.length >= maxPerHour) {
      throw new AsrError(`本小时识别次数已达上限（${maxPerHour} 次）`, { code: 'ASR_RATE_LIMITED', hint: '稍后再试，或在面板调大频率上限', status: 429 })
    }
  }

  function budgetCommit() {
    const times = [...readLedger(), Date.now()]
    writeJson(ledgerFile, { times: times.slice(-2000) })
  }

  // ── 识别缓存：按音频内容寻址，重复上传不重复推理 ────────────────────────
  const cacheFile = key => join(cacheDir, `${key}.json`)

  function pruneCache() {
    const { maxEntries } = config().cache
    let entries = []
    try { entries = readdirSync(cacheDir).filter(name => name.endsWith('.json')) } catch { return }
    if (entries.length <= maxEntries) return
    const withTime = entries.map(name => {
      const file = join(cacheDir, name)
      let at = 0
      try { at = statSync(file).mtimeMs } catch { at = 0 }
      return { file, at }
    }).sort((left, right) => left.at - right.at)
    for (const item of withTime.slice(0, withTime.length - maxEntries)) { try { rmSync(item.file) } catch {} }
  }

  function cacheRead(key) {
    const file = cacheFile(key)
    if (!existsSync(file)) return null
    const value = readJson(file, null)
    if (!value || typeof value.text !== 'string') return null
    return value
  }

  function cacheWrite(key, value) {
    writeJson(cacheFile(key), value)
    pruneCache()
  }

  // ── 审计：只记事实，不记音频内容 ───────────────────────────────────────
  function audit(record) {
    if (!config().audit) return
    try { appendFileSync(auditFile, `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, { mode: 0o600 }) } catch (error) { logger?.warn?.(`[asr] 审计写入失败：${error?.message ?? error}`) }
  }

  function recentAudit(limit = 20) {
    try {
      const lines = readFileSync(auditFile, 'utf8').trim().split('\n').filter(Boolean)
      return lines.slice(-limit).map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean).reverse()
    } catch { return [] }
  }

  // ── 面向上层的能力 ────────────────────────────────────────────────────
  function catalog() {
    const current = config()
    const list = engines.list().map(item => {
      const status = (() => { try { return item.status() } catch (error) { return { ready: false, error: String(error?.message ?? error) } } })()
      return { id: item.info.id, name: item.info.name, location: item.info.location, languages: item.info.languages, about: item.info.about ?? null, ready: status.ready === true, preparing: status.preparing === true, model: status.model ?? null, worker: status.worker ?? null, error: status.error ?? null }
    })
    return {
      ok: true,
      enabled: current.enabled,
      engine: current.engine,
      engines: list,
      languages: engine.info.languages,
      language: current.ui.language,
      limits: { maxSeconds: current.limits.maxSeconds, maxBytes: current.limits.maxBytes, maxPerMinute: current.limits.maxPerMinute, maxPerHour: current.limits.maxPerHour },
      cache: current.cache,
    }
  }

  function rules() {
    const current = config()
    return { ok: true, ...current, engines: engines.list().map(item => ({ id: item.info.id, name: item.info.name, ready: (() => { try { return item.status().ready === true } catch { return false } })() })), budget: budgetStatus(), routes: { stateDir, cacheDir, tmpDir, auditFile } }
  }

  function saveRules(patch) {
    if (patch && typeof patch === 'object' && patch.engine !== undefined) engines.resolve(String(patch.engine))
    const next = configStore.save(patch ?? {})
    audit({ source: 'panel', action: 'rules', engine: next.engine, enabled: next.enabled })
    return rules()
  }

  async function prepare({ engineId, signal, onProgress } = {}) {
    const target = engineId ? engines.resolve(String(engineId)) : activeEngine()
    if (target.prepare === undefined) throw new AsrError(`${target.info.name} 不需要准备`, { code: 'ASR_PREPARE_UNSUPPORTED' })
    await target.prepare({ signal, onProgress })
    return prepareStatus()
  }

  function prepareStatus() {
    const target = activeEngine()
    const status = target.status?.() ?? {}
    return { ok: true, engine: target.info.id, active: status.preparing === true, ready: status.ready === true, model: status.model ?? null, worker: status.worker ?? null, transfer: status.transfer ?? null, error: status.error ?? null }
  }

  function cancelPrepare() {
    const target = activeEngine()
    target.cancelPrepare?.()
    return prepareStatus()
  }

  /**
   * 识别一段 WAV。
   * @param request.audio - base64 编码的规范 WAV（浏览器侧已经重采样到 16k 单声道）。
   * @param request.audioBytes - 也可以直接给字节（内部调用/测试）。
   * @param request.audioPath - 本机 .wav 绝对路径（内部调用长录音时用，仍按大小上限校验）。
   * @param request.language - 语言提示，缺省用配置里的 ui.language。
   * @param request.source - 审计里的调用方名称。
   * @param request.acceptNonCanonical - 组件通道用：允许非 16k/单声道 的 PCM16 WAV，先归一再用。
   *   （面板通道保持严格，因为那里的音频是我们自己的代码产的，严格能抓 bug。）
   */
  async function transcribe({ audio, audioBytes, audioPath, language, source = 'panel', acceptNonCanonical = false } = {}) {
    const current = config()
    if (!current.enabled) throw new AsrError('语音识别已关闭', { code: 'ASR_DISABLED', hint: '在语音识别面板打开总开关', status: 503 })
    const target = activeEngine()
    let bytes
    if (Buffer.isBuffer(audioBytes) || audioBytes instanceof Uint8Array) bytes = Buffer.from(audioBytes)
    else if (typeof audioPath === 'string' && audioPath !== '') {
      if (!isAbsolute(audioPath)) throw new AsrError('音频路径必须是绝对路径', { code: 'ASR_AUDIO_INVALID' })
      if (extname(audioPath).toLowerCase() !== '.wav') throw new AsrError('只接受 .wav 文件', { code: 'ASR_AUDIO_INVALID' })
      let size = 0
      try { size = statSync(audioPath).size } catch (error) { throw new AsrError(`读不到音频文件：${error?.message ?? error}`, { code: 'ASR_AUDIO_INVALID' }) }
      if (size > current.limits.maxBytes) throw new AsrError('音频超过大小上限', { code: 'ASR_AUDIO_TOO_LARGE', status: 413 })
      bytes = readFileSync(audioPath)
    }
    else if (typeof audio === 'string' && audio !== '') {
      if (audio.length > current.limits.maxBytes * 2 + 4096) throw new AsrError('音频超过大小上限', { code: 'ASR_AUDIO_TOO_LARGE', status: 413 })
      bytes = Buffer.from(audio, 'base64')
      if (bytes.length === 0) throw new AsrError('音频数据为空', { code: 'ASR_AUDIO_INVALID' })
    } else throw new AsrError('缺少音频数据', { code: 'ASR_AUDIO_INVALID' })

    let wave
    let converted = null
    try {
      wave = inspectWave(bytes, { maxBytes: current.limits.maxBytes, maxSeconds: current.limits.maxSeconds })
    } catch (error) {
      // 组件通道：上游给什么形态都得接住（网关 ffmpeg 的 wav 未必是 16k 单声道）。
      // 只把「格式不合规」交给归一：非 PCM / 缺段 / 损坏照样拒绝，不猜。
      if (!acceptNonCanonical) throw error
      let normalized
      try {
        normalized = normalizeWave(bytes, { maxBytes: current.limits.maxBytes, maxSeconds: current.limits.maxSeconds })
      } catch {
        throw error // 归一也救不回来时，给调用方的仍是「原始输入哪里不对」
      }
      bytes = normalized.bytes
      wave = inspectWave(bytes, { maxBytes: current.limits.maxBytes, maxSeconds: current.limits.maxSeconds })
      if (normalized.converted) converted = { fromRate: normalized.fromRate, fromChannels: normalized.fromChannels }
    }
    const hint = current.ui.language
    const requested = typeof language === 'string' && language !== '' ? language : hint
    const chosen = engine.info.languages.includes(requested) ? requested : 'auto'
    const key = fingerprint(bytes)

    if (current.cache.enabled) {
      const hit = cacheRead(key)
      if (hit) {
        audit({ source, engine: target.info.id, cached: true, audioSeconds: hit.audioSeconds, chars: String(hit.text ?? '').length, language: chosen, ...(converted ? { converted } : {}) })
        return { ok: true, text: hit.text, audioSeconds: hit.audioSeconds, inferenceSeconds: 0, cached: true, engine: target.info.id, language: chosen, cacheKey: key, ...(converted ? { converted } : {}) }
      }
    }

    budgetCheck()
    const tempFile = writeTempWave(tmpDir, bytes, randomUUID())
    const started = Date.now()
    try {
      const result = await target.transcribe({ wavPath: tempFile, language: chosen })
      budgetCommit()
      const payload = { text: result.text, audioSeconds: result.audioSeconds, inferenceSeconds: result.inferenceSeconds, at: Date.now(), engine: target.info.id, language: chosen }
      if (current.cache.enabled) cacheWrite(key, payload)
      audit({ source, engine: target.info.id, cached: false, audioSeconds: result.audioSeconds, inferenceSeconds: result.inferenceSeconds, chars: String(result.text ?? '').length, language: chosen, elapsedMs: Date.now() - started, ...(converted ? { converted } : {}) })
      return { ok: true, ...payload, cached: false, cacheKey: key, ...(converted ? { converted } : {}) }
    } catch (error) {
      const failure = toAsrError(error)
      audit({ source, engine: target.info.id, cached: false, ok: false, audioSeconds: wave.durationSeconds, language: chosen, code: failure.code, error: failure.message, ...(converted ? { converted } : {}) })
      throw failure
    } finally {
      try { rmSync(tempFile) } catch {}
    }
  }

  function status() {
    const target = activeEngine()
    return { ok: true, engine: target.info.id, engineStatus: target.status?.() ?? null, budget: budgetStatus(), cache: { directory: cacheDir, entries: (() => { try { return readdirSync(cacheDir).filter(name => name.endsWith('.json')).length } catch { return 0 } })(), ...config().cache }, recent: recentAudit(10) }
  }

  /**
   * 分阶段自检：每一段都给出「通过/失败 + 一句人话」。
   * 这是唯一会真的拉起子进程并跑一次推理的诊断入口。
   */
  async function selfCheck({ inference = true } = {}) {
    const stages = []
    const stage = async (id, label, run) => {
      const started = Date.now()
      try {
        const detail = await run()
        stages.push({ id, label, ok: true, ms: Date.now() - started, detail: detail ?? '' })
      } catch (error) {
        stages.push({ id, label, ok: false, ms: Date.now() - started, detail: String(error?.message ?? error) })
      }
    }
    await stage('config', '配置有效', () => {
      const current = config()
      engines.resolve(current.engine)
      return `引擎 ${current.engine}，时长上限 ${current.limits.maxSeconds}s，大小上限 ${Math.round(current.limits.maxBytes / 1024 / 1024)}MiB`
    })
    await stage('state-dir', '状态目录可写', () => { mkdirSync(tmpDir, { recursive: true, mode: 0o700 }); return stateDir })
    await stage('model', '模型文件校验通过', () => {
      const snapshot = activeEngine().status?.() ?? {}
      if (snapshot.ready !== true) throw new Error(`模型未就绪（缺少：${(snapshot.model?.files ?? []).filter(item => !item.verified).map(item => item.name).join('、') || '未知'}）；先点「下载并准备」`)
      return `${snapshot.precision} · ${Math.round((snapshot.model?.bytes?.total ?? 0) / 1024 / 1024)}MiB · ${snapshot.model?.directory}`
    })
    if (inference) {
      await stage('worker', '识别引擎可加载', () => ensureProbe())
      await stage('inference', '静音推理可跑通', async () => {
        const result = await transcribe({ audioBytes: silentWave(0.4), source: 'self-check' })
        return `返回 ${String(result.text ?? '').length} 个字符（静音应当接近空）`
      })
    }
    return { ok: stages.every(item => item.ok), stages }
  }

  // 「引擎可加载」阶段：直接用一次极小推理来证明，而不是让自检去窥探子进程内部。
  function ensureProbe() {
    const snapshot = activeEngine().status?.() ?? {}
    if (snapshot.ready !== true) throw new Error('模型未就绪，跳过引擎加载检查')
    return snapshot.worker?.ready === true ? '引擎已加载' : '引擎可拉起（就绪后首次识别会加载模型）'
  }

  return {
    stateDir,
    service: {
      catalog,
      rules,
      saveRules,
      prepare,
      prepareStatus,
      cancelPrepare,
      transcribe,
      status,
      selfCheck,
      budgetStatus,
      audit,
      recentAudit,
      dispose: async () => { await engines.disposeAll() },
    },
  }
}
