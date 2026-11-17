import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { CloudEmbeddingService } from '../plugins/dsh-mempalace/src/store/cloud_embedding.mjs'
import { readEmbeddingSlot } from '../plugins/dsh-mempalace/src/store/capability_slot.mjs'

const SLOT = {
  kind: 'dashscope',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
  model: 'text-embedding-v4',
  authRef: 'DASHSCOPE_API_KEY',
}

const fakeResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
})

const vectorOf = (fill, dim = 512) => Array.from({ length: dim }, () => fill)

function tempDir(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'cloud-embedding-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function serviceWith(fetch, overrides = {}) {
  return new CloudEmbeddingService({
    slot: SLOT,
    dim: 512,
    resolveKey: async () => 'k-test',
    fetch,
    now: () => 0,
    sleep: async () => {},
    logger: { warn() {} },
    ...overrides,
  })
}

test('the request carries the model, dimensions and bearer key, and order follows index', async () => {
  const calls = []
  const service = serviceWith(async (url, init) => {
    calls.push({ url, init })
    return fakeResponse({
      data: [
        { index: 1, embedding: vectorOf(0.5) },
        { index: 0, embedding: vectorOf(0.25) },
      ],
    })
  })
  const vectors = await service.embedMany(['第一段', '第二段'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, SLOT.endpoint)
  assert.equal(calls[0].init.method, 'POST')
  assert.equal(calls[0].init.headers.authorization, 'Bearer k-test')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'text-embedding-v4')
  assert.deepEqual(body.input, ['第一段', '第二段'])
  assert.equal(body.dimensions, 512)
  assert.equal(body.encoding_format, 'float')
  assert.ok(Math.abs(vectors[0][0] - 0.25) < 1e-6, 'index 0 必须排在最前')
  assert.ok(Math.abs(vectors[1][0] - 0.5) < 1e-6)
})

test('a rejected key fails closed and the breaker stops further calls until it expires', async () => {
  let clock = 0
  let calls = 0
  const service = serviceWith(async () => {
    calls += 1
    return fakeResponse('invalid api key', 401)
  }, { now: () => clock })

  await assert.rejects(service.embed('x'), error => {
    assert.equal(error.code, 'MEMPALACE_EMBEDDING_AUTH')
    assert.match(error.hint, /DASHSCOPE_API_KEY/)
    return true
  })
  await assert.rejects(service.embed('y'), error => error.code === 'MEMPALACE_EMBEDDING_AUTH')
  assert.equal(calls, 1, '熔断期间不得再发请求')

  clock = 5 * 60_000 + 1
  await assert.rejects(service.embed('z'), error => error.code === 'MEMPALACE_EMBEDDING_AUTH')
  assert.equal(calls, 2, '熔断过期后重新尝试')
})

test('a width that disagrees with the active space is reported with the measured width', async () => {
  const service = serviceWith(async () => fakeResponse({ data: [{ index: 0, embedding: vectorOf(0.1, 384) }] }))
  await assert.rejects(service.embed('x'), error => {
    assert.equal(error.code, 'MEMPALACE_SPACE_MISMATCH')
    assert.match(error.message, /384/)
    assert.match(error.hint, /cloudEmbeddingDim/)
    return true
  })
})

test('dimensions is dropped once when the endpoint rejects it, then the response is accepted', async () => {
  const bodies = []
  const service = serviceWith(async (_url, init) => {
    bodies.push(JSON.parse(init.body))
    if (bodies.length === 1) {
      return fakeResponse('{"error":{"message":"dimensions is not supported for this model"}}', 400)
    }
    return fakeResponse({ data: [{ index: 0, embedding: vectorOf(0.3) }] })
  })
  const vector = await service.embed('x')
  assert.equal(vector.length, 512)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].dimensions, 512)
  assert.equal('dimensions' in bodies[1], false)
})

test('a hanging endpoint surfaces as a typed timeout instead of a vector', async () => {
  const service = serviceWith(() => new Promise((_resolve, reject) => {
    setTimeout(() => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), 5)
  }), { timeoutMs: 10 })
  await assert.rejects(service.embed('x'), error => {
    assert.equal(error.code, 'MEMPALACE_EMBEDDING_TIMEOUT')
    return true
  })
})

test('a missing key never reaches the network', async () => {
  let calls = 0
  const service = serviceWith(async () => {
    calls += 1
    return fakeResponse({ data: [] })
  }, { resolveKey: async () => null })
  await assert.rejects(service.embed('x'), error => {
    assert.equal(error.code, 'MEMPALACE_EMBEDDING_AUTH')
    return true
  })
  assert.equal(calls, 0)
  assert.equal(service.status().keyConfigured, false)
})

test('probe reports the measured width and leaves the store untouched', async () => {
  const service = serviceWith(async () => fakeResponse({ data: [{ index: 0, embedding: vectorOf(0.2) }] }))
  const probe = await service.probe()
  assert.equal(probe.ok, true)
  assert.equal(probe.expectedDim, 512)
  assert.equal(probe.measuredDim, 512)
  assert.equal(probe.endpoint, SLOT.endpoint)
  assert.equal(typeof probe.latencyMs, 'number')
})

test('the slot reader turns every unusable gateway state into an actionable error', t => {
  const home = tempDir(t)
  const registry = (slot) => {
    mkdirSync(join(home, 'capability-hub'), { recursive: true })
    writeFileSync(join(home, 'capability-hub', 'registry.json'), JSON.stringify({ version: 1, slots: { embedding: slot } }))
  }

  assert.equal(readEmbeddingSlot({ home }).error.code, 'MEMPALACE_SLOT_MISSING')

  registry({ ...SLOT, enabled: false })
  const disabled = readEmbeddingSlot({ home })
  assert.equal(disabled.error.code, 'MEMPALACE_SLOT_DISABLED')
  assert.equal(disabled.partial.model, 'text-embedding-v4', '被拒绝时仍保留模型名，空间命名才稳定')

  registry({ ...SLOT, enabled: true, baseURL: 'https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com' })
  assert.equal(readEmbeddingSlot({ home }).error.code, 'MEMPALACE_SLOT_PLACEHOLDER')

  registry({ ...SLOT, enabled: true, kind: 'minimax' })
  assert.equal(readEmbeddingSlot({ home }).error.code, 'MEMPALACE_SLOT_KIND_UNSUPPORTED')

  registry({ ...SLOT, enabled: true, baseURL: 'http://insecure.example.com' })
  assert.equal(readEmbeddingSlot({ home }).error.code, 'MEMPALACE_SLOT_INVALID')

  registry({ ...SLOT, enabled: true, model: '' })
  assert.equal(readEmbeddingSlot({ home }).error.code, 'MEMPALACE_SLOT_INVALID')

  registry({ ...SLOT, enabled: true })
  const ok = readEmbeddingSlot({ home })
  assert.equal(ok.ok, true)
  assert.equal(ok.slot.endpoint, `${SLOT.baseURL}/embeddings`)
  assert.equal(ok.slot.authRef, 'DASHSCOPE_API_KEY')
})
