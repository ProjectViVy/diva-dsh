// HTTP 面测试：面板 API 的门禁、路由与错误映射，以及内部 API 的处理器契约。
import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createConfigStore } from '../plugins/asr/src/store.mjs'
import { createEngineRegistry } from '../plugins/asr/src/engine-registry.mjs'
import { createAsrService, silentWave } from '../plugins/asr/src/service.mjs'
import { AsrError } from '../plugins/asr/src/errors.mjs'
import { ASR_HTTP_PREFIX, registerAsrHttp } from '../plugins/asr/src/http.mjs'
import { createInternalHandler } from '../plugins/asr/src/internal.mjs'

function tempDir(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'asr-http-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function fakeEngine({ text = '识别结果', fail = null, ready = true } = {}) {
  const state = { calls: 0, requests: [] }
  return {
    info: { id: 'sensevoice', name: 'SenseVoiceSmall（本地）', location: 'host-local', languages: ['auto', 'zh'] },
    state,
    status: () => ({ id: 'sensevoice', ready, preparing: false, precision: 'int8', model: { directory: '/m', bytes: { have: 1, total: 1 }, verifiedAt: null, files: [] }, worker: { running: false, ready: false, pid: null, pending: 0, logs: [] } }),
    prepare: async () => ({ ready: true }),
    transcribe: async request => {
      state.calls += 1
      state.requests.push(request)
      if (fail) throw fail
      return { text, audioSeconds: 1, inferenceSeconds: 0.1 }
    },
    cancelPrepare: () => {},
  }
}

function makeServer(t, { engine = fakeEngine(), connection = { requestRejection: () => undefined } } = {}) {
  const dir = tempDir(t)
  const configStore = createConfigStore(dir)
  const engines = createEngineRegistry()
  engines.register(engine)
  const { service } = createAsrService({ stateDir: dir, configStore, engines, engine })
  let handler = null
  const ctx = {
    webServer: { register: route => { handler = route.handler; return () => {} } },
    get: name => (name === 'connection' ? connection : null),
  }
  registerAsrHttp(ctx, service)
  return { dir, service, engine, connection, call: (options = {}) => call(handler, options) }
}

function makeRes() {
  const res = { status: 0, headers: null, body: '' }
  res.writeHead = (status, headers) => { res.status = status; res.headers = headers }
  res.end = chunk => { res.body += chunk ?? '' }
  res.json = () => JSON.parse(res.body || 'null')
  return res
}

function makeReq({ method = 'GET', url = '/', headers = {}, body = null, raw = null } = {}) {
  const chunks = raw !== null ? [raw] : body === null ? [] : [Buffer.from(JSON.stringify(body))]
  const req = Readable.from(chunks)
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3082', ...headers }
  return req
}

async function call(handler, options = {}) {
  const res = makeRes()
  await handler(makeReq(options), res)
  return { status: res.status, body: res.json(), headers: res.headers }
}

const jsonHeaders = { 'content-type': 'application/json' }

test('GET catalog answers the panel', async t => {
  const { call: request } = makeServer(t)
  const result = await request({ url: `${ASR_HTTP_PREFIX}/asr/catalog` })
  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(result.body.engines[0].id, 'sensevoice')
})

test('non-loopback hosts and cross-site writes are refused', async t => {
  const { call: request } = makeServer(t)
  const foreign = await request({ url: `${ASR_HTTP_PREFIX}/asr/catalog`, headers: { host: 'evil.example' } })
  assert.equal(foreign.status, 403)
  assert.equal(foreign.body.code, 'HOST_REJECTED')
  const crossSite = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/rules`, headers: { ...jsonHeaders, origin: 'https://evil.example' }, body: {} })
  assert.equal(crossSite.status, 403)
  assert.equal(crossSite.body.code, 'ORIGIN_REJECTED')
  const sameSite = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/rules`, headers: { ...jsonHeaders, origin: 'http://127.0.0.1:3082' }, body: { limits: { maxSeconds: 30 } } })
  assert.equal(sameSite.status, 200)
  assert.equal(sameSite.body.limits.maxSeconds, 30)
})

test('a missing or rejecting connection service is fail-closed', async t => {
  const unavailable = makeServer(t, { connection: null })
  const first = await unavailable.call({ url: `${ASR_HTTP_PREFIX}/asr/catalog` })
  assert.equal(first.status, 503)
  assert.equal(first.body.code, 'AUTH_UNAVAILABLE')
  const rejecting = makeServer(t, { connection: { requestRejection: () => 401 } })
  const second = await rejecting.call({ url: `${ASR_HTTP_PREFIX}/asr/catalog` })
  assert.equal(second.status, 401)
  assert.equal(second.body.code, 'AUTH_REJECTED')
})

test('unknown routes and non-JSON writes get explicit errors', async t => {
  const { call: request } = makeServer(t)
  const missing = await request({ url: `${ASR_HTTP_PREFIX}/asr/nope` })
  assert.equal(missing.status, 404)
  assert.equal(missing.body.code, 'NOT_FOUND')
  const wrongType = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/rules`, headers: { 'content-type': 'text/plain' }, body: {} })
  assert.equal(wrongType.status, 415)
  assert.equal(wrongType.body.code, 'JSON_REQUIRED')
})

test('POST transcribe returns text and passes the language through', async t => {
  const { call: request, engine } = makeServer(t)
  const result = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/transcribe`, headers: jsonHeaders, body: { audio: silentWave(0.4).toString('base64'), language: 'zh' } })
  assert.equal(result.status, 200)
  assert.equal(result.body.text, '识别结果')
  assert.equal(result.body.cached, false)
  assert.equal(engine.state.requests[0].language, 'zh')
  const repeat = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/transcribe`, headers: jsonHeaders, body: { audio: silentWave(0.4).toString('base64'), language: 'zh' } })
  assert.equal(repeat.body.cached, true)
  assert.equal(engine.state.calls, 1)
})

test('an oversized body is refused with a readable code', async t => {
  const { call: request } = makeServer(t)
  // 普通接口 512KiB 封顶；transcribe 按配置放宽到音频上限（另有用例覆盖）。
  const result = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/rules`, headers: jsonHeaders, raw: Buffer.alloc(600 * 1024, 0x41) })
  assert.equal(result.status, 400)
  assert.equal(result.body.code, 'ASR_BODY_TOO_LARGE')
})

test('engine failures keep their code, status and hint', async t => {
  const busy = new AsrError('识别队列已满，请稍后重试', { code: 'ASR_BUSY', hint: '等一下再说', status: 429 })
  const { call: request } = makeServer(t, { engine: fakeEngine({ fail: busy }) })
  const result = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/transcribe`, headers: jsonHeaders, body: { audio: silentWave(0.3).toString('base64') } })
  assert.equal(result.status, 429)
  assert.equal(result.body.code, 'ASR_BUSY')
  assert.equal(result.body.hint, '等一下再说')
})

test('prepare, status, audit and self-check routes are wired', async t => {
  const { call: request, service } = makeServer(t)
  const prepared = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/prepare`, headers: jsonHeaders, body: {} })
  assert.equal(prepared.status, 200)
  const progress = await request({ url: `${ASR_HTTP_PREFIX}/asr/prepare` })
  assert.equal(progress.body.ok, true)
  const status = await request({ url: `${ASR_HTTP_PREFIX}/asr/status` })
  assert.equal(status.body.cache.entries, 0)
  await service.transcribe({ audioBytes: silentWave(0.3) })
  const audit = await request({ url: `${ASR_HTTP_PREFIX}/asr/audit?limit=5` })
  assert.equal(audit.body.records.length, 1)
  const badAudit = await request({ url: `${ASR_HTTP_PREFIX}/asr/audit?limit=nope` })
  assert.equal(badAudit.status, 400)
  assert.equal(badAudit.body.code, 'ASR_LIMIT_INVALID')
  const check = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/self-check`, headers: jsonHeaders, body: { inference: false } })
  assert.equal(check.status, 200)
  assert.equal(check.body.stages.some(stage => stage.id === 'inference'), false)
  const cancelled = await request({ method: 'POST', url: `${ASR_HTTP_PREFIX}/asr/prepare-cancel`, headers: jsonHeaders, body: {} })
  assert.equal(cancelled.status, 200)
})

test('the internal handler answers the component surface', async t => {
  const { service, dir, engine } = makeServer(t)
  const handle = createInternalHandler(service)
  const health = await handle({ method: 'GET', path: '/health', query: new URLSearchParams(), body: {} })
  assert.equal(health.ok, true)
  assert.equal(health.ready, true)
  const catalog = await handle({ method: 'GET', path: '/catalog', query: new URLSearchParams(), body: {} })
  assert.equal(catalog.engine, 'sensevoice')
  const rules = await handle({ method: 'POST', path: '/rules', query: new URLSearchParams(), body: { ui: { language: 'zh' } } })
  assert.equal(rules.ui.language, 'zh')
  const progress = await handle({ method: 'GET', path: '/progress', query: new URLSearchParams(), body: {} })
  assert.equal(progress.ok, true)
  const status = await handle({ method: 'GET', path: '/status', query: new URLSearchParams(), body: {} })
  assert.equal(status.engine, 'sensevoice')

  const file = join(dir, 'internal.wav')
  writeFileSync(file, silentWave(0.4))
  const byPath = await handle({ method: 'POST', path: '/transcribe', query: new URLSearchParams(), body: { path: file, source: 'surfcore' } })
  assert.equal(byPath.text, '识别结果')
  // 引擎拿到的是插件临时目录里的副本，不是调用方的原始路径。
  assert.notEqual(engine.state.requests.at(-1).wavPath, file)
  assert.match(engine.state.requests.at(-1).wavPath, /\/tmp\/[0-9a-f-]+\.wav$/)
  const rows = service.recentAudit(5)
  assert.equal(rows[0].source, 'surfcore')

  const byAudio = await handle({ method: 'POST', path: '/transcribe', query: new URLSearchParams(), body: { audio: silentWave(0.2).toString('base64') } })
  assert.equal(byAudio.ok, true)
  assert.equal(service.recentAudit(5)[0].source, 'component')

  await assert.rejects(handle({ method: 'POST', path: '/nope', query: new URLSearchParams(), body: {} }), error => {
    assert.equal(error.code, 'ASR_NOT_FOUND')
    return true
  })
  const prepared = await handle({ method: 'POST', path: '/prepare', query: new URLSearchParams(), body: {} })
  assert.equal(prepared.ok, true)
  const check = await handle({ method: 'POST', path: '/self-check', query: new URLSearchParams(), body: { inference: false } })
  assert.equal(check.stages.length, 3)
})
