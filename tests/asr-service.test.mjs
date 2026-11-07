// 服务层测试：缓存、限流、审计、自检与错误语义都用假引擎验证，不碰真实模型。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createConfigStore } from '../plugins/asr/src/store.mjs'
import { createEngineRegistry, UnknownEngineError } from '../plugins/asr/src/engine-registry.mjs'
import { createAsrService, silentWave } from '../plugins/asr/src/service.mjs'
import { AsrError, toAsrError } from '../plugins/asr/src/errors.mjs'
import { AudioInputError } from '../plugins/asr/src/audio.mjs'

function tempDir(t, prefix = 'asr-service-') {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 假引擎：只关心「被调了几次、拿到什么参数、返回什么文本」。 */
function fakeEngine({ ready = true, text = '你好世界', fail = null, onCall = null } = {}) {
  const state = { ready, calls: 0, prepares: 0, cancelled: 0, lastRequest: null }
  const engine = {
    info: { id: 'sensevoice', name: 'SenseVoiceSmall（本地）', location: 'host-local', languages: ['auto', 'zh', 'en'] },
    state,
    status: () => ({
      id: 'sensevoice', ready: state.ready, preparing: false, precision: 'int8',
      model: { directory: '/models/sensevoice/int8', bytes: { have: 1, total: 1 }, verifiedAt: null, files: [{ name: 'model', file: '/models/sensevoice/int8/model.onnx', bytes: 1, verified: state.ready }] },
      worker: { running: false, ready: false, pid: null, pending: 0, logs: [] },
    }),
    prepare: async () => { state.prepares += 1; state.ready = true; return { ready: true } },
    transcribe: async request => {
      state.calls += 1
      state.lastRequest = request
      onCall?.(request)
      if (fail) throw fail
      if (!state.ready) throw new AsrError('识别模型还没准备好', { code: 'ASR_MODEL_MISSING' })
      return { text, audioSeconds: 1.2, inferenceSeconds: 0.25 }
    },
    cancelPrepare: () => { state.cancelled += 1 },
  }
  return engine
}

function make(t, { engine = fakeEngine(), config = {} } = {}) {
  const dir = tempDir(t)
  const configStore = createConfigStore(dir)
  if (Object.keys(config).length > 0) configStore.save(config)
  const engines = createEngineRegistry()
  engines.register(engine)
  const { service } = createAsrService({ stateDir: dir, configStore, engines, engine })
  return { dir, engine, configStore, service, engines }
}

test('catalog and rules describe what the panel needs', t => {
  const { service } = make(t)
  const catalog = service.catalog()
  assert.equal(catalog.ok, true)
  assert.equal(catalog.engine, 'sensevoice')
  assert.equal(catalog.engines[0].id, 'sensevoice')
  assert.equal(catalog.engines[0].ready, true)
  assert.equal(catalog.limits.maxSeconds, 120)
  assert.equal(catalog.language, 'auto')
  const rules = service.rules()
  assert.equal(rules.enabled, true)
  assert.equal(rules.engine, 'sensevoice')
  assert.equal(typeof rules.routes.stateDir, 'string')
})

test('saveRules persists and rejects an engine that does not exist', t => {
  const { service, configStore } = make(t)
  const saved = service.saveRules({ limits: { maxSeconds: 45 }, ui: { language: 'zh' } })
  assert.equal(saved.limits.maxSeconds, 45)
  assert.equal(configStore.get().ui.language, 'zh')
  assert.throws(() => service.saveRules({ engine: 'whisper' }), UnknownEngineError)
  assert.equal(configStore.get().engine, 'sensevoice')
})

test('transcribe returns text, records an audit row and reuses the cache', async t => {
  const { service, engine, dir } = make(t)
  const audio = silentWave(0.5).toString('base64')
  const first = await service.transcribe({ audio })
  assert.equal(first.ok, true)
  assert.equal(first.text, '你好世界')
  assert.equal(first.cached, false)
  assert.equal(engine.state.calls, 1)
  const second = await service.transcribe({ audio })
  assert.equal(second.cached, true)
  assert.equal(second.text, '你好世界')
  assert.equal(engine.state.calls, 1, '缓存命中不应再次推理')
  const rows = readFileSync(join(dir, 'data', 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(rows.length, 2)
  assert.equal(rows[0].cached, false)
  assert.equal(rows[1].cached, true)
  assert.equal(rows[0].source, 'panel')
})

test('disabling the cache makes every request hit the engine', async t => {
  const { service, engine } = make(t, { config: { cache: { enabled: false } } })
  const audio = silentWave(0.5).toString('base64')
  await service.transcribe({ audio })
  await service.transcribe({ audio })
  assert.equal(engine.state.calls, 2)
})

test('the per-minute limit refuses the extra request instead of queueing it', async t => {
  const { service, engine } = make(t, { config: { cache: { enabled: false }, limits: { maxPerMinute: 1 } } })
  await service.transcribe({ audio: silentWave(0.3).toString('base64') })
  await assert.rejects(service.transcribe({ audio: silentWave(0.4).toString('base64') }), error => {
    assert.equal(error.code, 'ASR_RATE_LIMITED')
    assert.equal(error.status, 429)
    return true
  })
  assert.equal(engine.state.calls, 1)
  assert.match(service.status().budget.limits.maxPerMinute.toString(), /^1$/)
})

test('a disabled plugin refuses to transcribe with a 503', async t => {
  const { service } = make(t, { config: { enabled: false } })
  await assert.rejects(service.transcribe({ audio: silentWave(0.3).toString('base64') }), error => {
    assert.equal(error.code, 'ASR_DISABLED')
    assert.equal(error.status, 503)
    return true
  })
})

test('audio that is not canonical WAV is rejected before inference', async t => {
  const { service, engine } = make(t)
  await assert.rejects(service.transcribe({ audio: Buffer.from('not a wave').toString('base64') }), AudioInputError)
  await assert.rejects(service.transcribe({}), /缺少音频数据/)
  assert.equal(engine.state.calls, 0)
  assert.equal(toAsrError(new AudioInputError('只接受单声道音频')).code, 'ASR_AUDIO_INVALID')
})

test('length and size limits are enforced per configuration', async t => {
  const { service, engine } = make(t, { config: { limits: { maxSeconds: 0.2 } } })
  await assert.rejects(service.transcribe({ audio: silentWave(1).toString('base64') }), /时长上限/)
  assert.equal(engine.state.calls, 0)
  const big = silentWave(2)
  const { service: limited } = make(t, { config: { limits: { maxBytes: 1024 } } })
  await assert.rejects(limited.transcribe({ audioBytes: big }), /大小上限/)
})

test('an internal caller may hand over a local wav path instead of base64', async t => {
  const { dir, service, engine } = make(t)
  const file = join(dir, 'clip.wav')
  writeFileSync(file, silentWave(0.4))
  const result = await service.transcribe({ audioPath: file, source: 'component' })
  assert.equal(result.text, '你好世界')
  assert.equal(engine.state.lastRequest.wavPath.startsWith(resolve('.artifacts/test-tmp')), true)
  await assert.rejects(service.transcribe({ audioPath: 'clip.wav' }), /绝对路径/)
  await assert.rejects(service.transcribe({ audioPath: join(dir, 'clip.txt') }), /只接受 \.wav/)
})

test('a language outside the engine list falls back to auto', async t => {
  const { service, engine } = make(t)
  await service.transcribe({ audio: silentWave(0.3).toString('base64'), language: 'fr' })
  assert.equal(engine.state.lastRequest.language, 'auto')
  await service.transcribe({ audio: silentWave(0.4).toString('base64'), language: 'zh' })
  assert.equal(engine.state.lastRequest.language, 'zh')
})

test('a failed inference is audited and rethrown with its code', async t => {
  const failure = new AsrError('识别进程崩了', { code: 'ASR_WORKER_EXITED' })
  const { service, dir } = make(t, { engine: fakeEngine({ fail: failure }) })
  await assert.rejects(service.transcribe({ audio: silentWave(0.3).toString('base64') }), error => {
    assert.equal(error.code, 'ASR_WORKER_EXITED')
    return true
  })
  const rows = readFileSync(join(dir, 'data', 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(rows.length, 1)
  assert.equal(rows[0].ok, false)
  assert.equal(rows[0].code, 'ASR_WORKER_EXITED')
  assert.equal(service.recentAudit(5)[0].code, 'ASR_WORKER_EXITED')
})

test('prepare is idempotent from the caller view and reports progress state', async t => {
  const { service, engine } = make(t, { engine: fakeEngine({ ready: false }) })
  assert.equal(service.prepareStatus().ready, false)
  const result = await service.prepare()
  assert.equal(result.ready, true)
  assert.equal(engine.state.prepares, 1)
  service.cancelPrepare()
  assert.equal(engine.state.cancelled, 1)
  await assert.rejects(service.prepare({ engineId: 'nope' }), UnknownEngineError)
})

test('self-check reports each stage and refuses to claim success without a model', async t => {
  const ready = make(t)
  const ok = await ready.service.selfCheck()
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.stages.map(stage => stage.id), ['config', 'state-dir', 'model', 'worker', 'inference'])

  const missing = make(t, { engine: fakeEngine({ ready: false }) })
  const bad = await missing.service.selfCheck()
  assert.equal(bad.ok, false)
  const model = bad.stages.find(stage => stage.id === 'model')
  assert.equal(model.ok, false)
  assert.match(model.detail, /模型未就绪/)
  assert.equal(bad.stages.find(stage => stage.id === 'inference').ok, false)
})

test('status exposes budget, cache size and the newest audit rows', async t => {
  const { service } = make(t)
  await service.transcribe({ audio: silentWave(0.3).toString('base64') })
  const status = service.status()
  assert.equal(status.engine, 'sensevoice')
  assert.equal(status.cache.entries, 1)
  assert.equal(status.budget.inHour, 1)
  assert.equal(status.recent.length, 1)
})

test('the engine registry refuses duplicates and reports unknown ids with the known list', () => {
  const engines = createEngineRegistry()
  const engine = fakeEngine()
  engines.register(engine)
  assert.throws(() => engines.register(engine), /id 重复/)
  assert.equal(engines.resolve('sensevoice'), engine)
  assert.throws(() => engines.resolve('whisper'), error => {
    assert.ok(error instanceof UnknownEngineError)
    assert.match(error.message, /sensevoice/)
    return true
  })
  assert.deepEqual(engines.list(), [engine])
})

test('known failure codes carry an actionable hint, and an explicit hint wins', () => {
  const loadFailed = toAsrError(Object.assign(new Error('Please check your config!'), { code: 'ASR_WORKER_LOAD_FAILED' }))
  assert.equal(loadFailed.code, 'ASR_WORKER_LOAD_FAILED')
  assert.match(loadFailed.hint, /下载并准备/)
  const explicit = toAsrError(new AsrError('模型没准备好', { code: 'ASR_MODEL_MISSING', hint: '先点面板上的按钮' }))
  assert.equal(explicit.hint, '先点面板上的按钮')
  assert.match(toAsrError(new AsrError('模型没准备好', { code: 'ASR_MODEL_MISSING' })).hint, /下载并准备/)
  assert.equal(toAsrError(new AsrError('随便什么错', { code: 'ASR_UNKNOWN_THING' })).hint, undefined)
})
