import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import {
  CHUNK_SIZE,
  EMBEDDING_DIM,
  chunkText,
  contentHash,
  distanceToSimilarity,
  estimateTokens,
  ftsQuery,
  normalizeProjectLabel,
  normalizeTopicLabel,
} from '../plugins/dsh-mempalace/src/store/chunk.mjs'
import {
  DEFAULTS,
  loadPersistedConfig,
  resolveConfig,
  savePersistedConfig,
  validateConfig,
} from '../plugins/dsh-mempalace/src/config.mjs'
import {
  SessionCapture,
  buildExchange,
  extractMessageText,
  isHumanUserMessage,
  projectFromCwd,
  resolveProject,
} from '../plugins/dsh-mempalace/src/capture.mjs'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'
import { EmbeddingService } from '../plugins/dsh-mempalace/src/store/embeddings.mjs'
import { createTools } from '../plugins/dsh-mempalace/src/tools.mjs'
import { registerMempalaceHttp } from '../plugins/dsh-mempalace/src/http.mjs'

const pluginDir = fileURLToPath(new URL('../plugins/dsh-mempalace/', import.meta.url))
const nativeReady = existsSync(join(pluginDir, 'node_modules/better-sqlite3'))
  && existsSync(join(pluginDir, 'node_modules/sqlite-vec'))
const silent = { warn() {}, info() {}, error() {} }

function tempDir(t, prefix) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** Deterministic character-bucket embedding; no model download in tests. */
function featureVector(text) {
  const vector = new Float32Array(EMBEDDING_DIM)
  for (const char of String(text).toLowerCase()) {
    const code = char.codePointAt(0)
    vector[code % EMBEDDING_DIM] += 1
    vector[(code * 31) % EMBEDDING_DIM] += 0.5
  }
  let norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm === 0) {
    vector[0] = 1
    norm = 1
  }
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

function fakeEmbedder() {
  let failure = null
  const embed = async text => {
    if (failure) throw failure
    return featureVector(text)
  }
  embed.fail = error => { failure = error ?? new Error('model offline') }
  embed.recover = () => { failure = null }
  return embed
}

async function openStore(t, options = {}) {
  const dir = tempDir(t, 'mempalace-')
  const embed = options.embed ?? fakeEmbedder()
  const store = new MemoryStore({ memoryDir: dir, embed, logger: silent, ...options.store })
  await store.open()
  t.after(() => store.close())
  return { dir, store, embed }
}

test('chunk helpers keep boundaries, hashes and similarity stable', () => {
  assert.equal(chunkText('short text', { chunkSize: 100 }).length, 1)
  const content = Array.from({ length: 12 }, (_, index) => `Paragraph ${index}: ${'word '.repeat(12)}`).join('\n\n')
  const chunks = chunkText(content, { chunkSize: 120, chunkOverlap: 20, minChunkSize: 10 })
  assert.ok(chunks.length > 1)
  assert.ok(chunks.every(chunk => chunk.length <= 120))
  for (const chunk of chunks) assert.ok(content.includes(chunk))
  assert.equal(chunkText('x'.repeat(1000), { chunkSize: 0 }).length > 0, true)

  assert.match(contentHash('same'), /^[a-f0-9]{16}$/)
  assert.equal(contentHash('same'), contentHash('same'))
  assert.notEqual(contentHash('same'), contentHash('different'))
  assert.equal(distanceToSimilarity(0), 1)
  assert.equal(distanceToSimilarity(2), -1)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(normalizeProjectLabel('   '), 'general')
  assert.equal(normalizeProjectLabel('/'), 'general')
  assert.equal(normalizeTopicLabel('Topic: Deployment_Pipeline!'), 'deployment-pipeline')
  assert.equal(normalizeTopicLabel('unknown'), 'general')
  assert.equal(ftsQuery('hello "world" -- ok'), '"hello" OR "world" OR "ok"')
  assert.equal(CHUNK_SIZE, 800)
  assert.equal(EMBEDDING_DIM, 384)
})

test('config resolves defaults, persisted values and strict validation', t => {
  const resolved = resolveConfig({}, { wakeUpMaxTokens: 500, defaultProject: 'demo' })
  assert.equal(resolved.wakeUpMaxTokens, 500)
  assert.equal(resolved.defaultProject, 'demo')
  assert.equal(resolved.autoCapture, DEFAULTS.autoCapture)

  assert.throws(() => validateConfig({ ...DEFAULTS, wakeUpMaxTokens: 'many' }), /^Error: dsh-mempalace: wakeUpMaxTokens/)
  assert.throws(() => validateConfig({ ...DEFAULTS, chunkOverlap: DEFAULTS.chunkSize }), /chunkOverlap/)
  assert.throws(() => validateConfig({ ...DEFAULTS, hfEndpoint: 'ftp://mirror' }), /http\(s\) URL/)
  assert.throws(() => validateConfig({ ...DEFAULTS, searchDefaultResults: 20, searchMaxResults: 5 }), /searchMaxResults/)

  const dir = tempDir(t, 'mempalace-config-')
  savePersistedConfig(dir, { ...DEFAULTS, defaultProject: 'persisted' })
  assert.equal(loadPersistedConfig(dir).defaultProject, 'persisted')
  writeFileSync(join(dir, 'config.json'), '{invalid')
  assert.deepEqual(loadPersistedConfig(dir), {})
})

test('bundle patch does not pin settings that config.json should persist', () => {
  const patch = readFileSync(join(pluginDir, 'cordis.patch.yml'), 'utf-8')
  assert.match(patch, /id: dsh-mempalace/)
  assert.doesNotMatch(patch, /wakeUpMaxTokens|autoCapture|config:/)
})

test('capture accepts only direct human prompts and merges completed exchanges', () => {
  assert.equal(extractMessageText('plain'), 'plain')
  assert.equal(extractMessageText([{ type: 'text', text: 'a' }, { type: 'tool_use' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(extractMessageText({ text: 'not-an-array' }), '')

  assert.equal(isHumanUserMessage({ role: 'user', source: { kind: 'user' } }), true)
  assert.equal(isHumanUserMessage({ role: 'user', source: { kind: 'working-directory' } }), false)
  assert.equal(isHumanUserMessage({ role: 'assistant', source: { kind: 'user' } }), false)
  assert.equal(isHumanUserMessage({ role: 'user' }), false)

  assert.equal(projectFromCwd('/work/MyRepo/'), 'MyRepo')
  assert.equal(projectFromCwd(''), 'general')
  assert.equal(resolveProject({ defaultProject: 'fixed', sessionProject: 'session', cwd: '/work/cwd' }), 'fixed')
  assert.equal(resolveProject({ sessionProject: 'session', cwd: '/work/cwd' }), 'session')
  assert.equal(resolveProject({ cwd: '/work/cwd' }), 'cwd')

  const exchange = buildExchange('question', 'answer', 100)
  assert.equal(exchange, '> question\n\nanswer')
  const truncated = buildExchange('q'.repeat(100), 'a'.repeat(100), 40)
  assert.equal(truncated.length, 40)
  assert.match(truncated, /\[truncated\]$/)

  const capture = new SessionCapture({ userMinChars: 5, captureMinChars: 5, captureMaxChars: 200 })
  assert.equal(capture.pushUser('hi'), false)
  assert.equal(capture.takeAssistant('nothing pending'), null)
  assert.equal(capture.pushUser('first question'), true)
  assert.equal(capture.pushUser('second question'), true)
  assert.equal(capture.takeAssistant('tiny'), null)
  assert.equal(capture.pending.length, 0)
  assert.equal(capture.pushUser('third question'), true)
  assert.equal(capture.takeAssistant('answer', { interrupted: true }), null)
  assert.equal(capture.pending.length, 0)
  assert.equal(capture.pushUser('fourth question'), true)
  const merged = capture.takeAssistant('a complete answer')
  assert.equal(merged.content, '> fourth question\n\na complete answer')
  capture.pushUser('leftover')
  capture.clear()
  assert.equal(capture.takeAssistant('answer'), null)
})

test('tools expose complete schemas and validate missing arguments', async () => {
  const service = {
    getSessionProject: () => 'demo',
    search: async () => ({ query: 'q', mode: 'semantic', results: [] }),
    saveMemory: async () => ({ status: 'stored', id: 'mem_x' }),
  }
  const definitions = createTools(service)
  const names = definitions.map(tool => tool.name)
  assert.equal(definitions.length, 17)
  assert.equal(new Set(names).size, 17)
  for (const tool of definitions) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
  const search = definitions.find(tool => tool.name === 'memory_search')
  await assert.rejects(search.execute({}, {}), /INVALID_ARGS/)
  const found = await search.execute({ query: 'anything' }, {})
  assert.equal(found.text.includes('No memories found'), true)
  assert.deepEqual(found.data, { mode: 'semantic', count: 0 })
})

test('memory store round trip covers search, pagination, duplicates and wake-up', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { store } = await openStore(t)
  const first = await store.store({
    content: 'deployment pipeline uses node twenty and sqlite',
    project: 'project-a',
    topic: 'deploy',
    source: 'auto-capture',
    timestamp: '2026-01-01T00:00:00.000Z',
    session_id: 'session-1',
  })
  assert.equal(first.status, 'stored')
  const duplicate = await store.store({ content: 'deployment pipeline uses node twenty and sqlite', project: 'project-a' })
  assert.equal(duplicate.status, 'duplicate')

  await store.store({
    content: 'unrelated cooking notes about soup',
    project: 'project-b',
    topic: 'cooking',
    timestamp: '2026-01-02T00:00:00.000Z',
  })

  const listed = store.listMemories({ project: 'project-a', limit: 20, offset: 0 })
  assert.equal(listed.total, 1)
  assert.equal(listed.items[0].project, 'project-a')
  const paged = store.listMemories({ limit: 1, offset: 1, sort: 'oldest' })
  assert.equal(paged.items.length, 1)
  assert.equal(paged.items[0].project, 'project-b')

  const searched = await store.search('deployment pipeline', { n_results: 5 })
  assert.equal(searched.mode, 'semantic')
  assert.equal(searched.results[0].project, 'project-a')
  assert.ok(searched.results[0].similarity >= 0)

  const duplicateCheck = await store.checkDuplicate('deployment pipeline uses node twenty and sqlite')
  assert.equal(duplicateCheck.isDuplicate, true)
  assert.equal(duplicateCheck.hashMatch, true)

  const wakeA = store.wakeup({ project: 'project-a', max_tokens: 800 })
  const wakeB = store.wakeup({ project: 'project-b', max_tokens: 800 })
  assert.match(wakeA.text, /deployment pipeline/)
  assert.doesNotMatch(wakeA.text, /cooking notes/)
  assert.match(wakeB.text, /cooking notes/)
  const limited = store.wakeup({ project: 'project-a', max_tokens: 64 })
  assert.ok(limited.text.length <= 256)

  const stats = store.computeStats()
  assert.equal(stats.total, 2)
  assert.equal(stats.projects['project-a'], 1)
  assert.equal(stats.sessions, 1)

  assert.deepEqual(store.delete(first.id), { status: 'deleted', id: first.id })
  assert.throws(() => store.delete(first.id), /Memory not found/)
  assert.equal(store.size, 1)
})

test('long content is chunked with parent links and remains searchable', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { store } = await openStore(t, { store: { chunkSize: 100, chunkOverlap: 20, minChunkSize: 10 } })
  const content = Array.from({ length: 10 }, (_, index) => `section ${index} ${'detail '.repeat(8)}`).join('\n\n')
  const stored = await store.store({ content, project: 'long', topic: 'docs' })
  assert.equal(stored.status, 'stored')
  const listed = store.listMemories({ project: 'long', limit: 100, sort: 'oldest' })
  assert.ok(listed.total > 1)
  const firstChunk = listed.items[0]
  assert.equal(firstChunk.chunk_index, 0)
  assert.equal(firstChunk.parent_id, null)
  assert.ok(listed.items.slice(1).every(item => item.parent_id === stored.id))
  assert.ok(listed.items.every(item => item.content.length <= 100))
  const searched = await store.search('section detail', { project: 'long', n_results: 20 })
  assert.ok(searched.results.length > 0)
})

test('palace graph, tunnels, rooms and taxonomy group multi-project topics', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { store } = await openStore(t)
  for (const [project, content] of [
    ['alpha', 'shared architecture decision one'],
    ['alpha', 'shared architecture decision two'],
    ['beta', 'shared architecture decision three'],
    ['beta', 'beta only deployment note'],
  ]) {
    await store.store({ content, project, topic: content.includes('deployment') ? 'deploy' : 'architecture' })
  }

  const tunnels = store.discoverTunnels()
  assert.equal(tunnels.length, 1)
  assert.deepEqual(tunnels[0].projects, ['alpha', 'beta'])
  assert.equal(tunnels[0].topic, 'architecture')

  const graph = store.getPalaceGraph()
  assert.equal(graph.nodes.length, 2)
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].projectA, 'alpha')
  assert.equal(graph.edges[0].projectB, 'beta')
  assert.equal(graph.edges[0].strength, 3)
  assert.deepEqual(graph.nodes.find(node => node.name === 'alpha').topics, ['architecture'])

  const traversed = store.traverseTunnel('architecture', 'alpha', 'beta', 10)
  assert.equal(traversed.length, 3)
  assert.deepEqual(new Set(traversed.map(item => item.project)), new Set(['alpha', 'beta']))

  const rooms = store.listRooms('alpha')
  assert.deepEqual(rooms.map(room => room.topic).sort(), ['architecture'])
  assert.deepEqual(rooms[0].projects.sort(), ['alpha', 'beta'])
  const taxonomy = store.getTaxonomy()
  assert.equal(taxonomy.find(entry => entry.project === 'alpha').total, 2)
  assert.equal(taxonomy.find(entry => entry.project === 'beta').total, 2)
  assert.deepEqual(store.listProjects().projects, { alpha: 2, beta: 2 })
})

test('temporal knowledge graph supports entities, facts, invalidation and timelines', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { store } = await openStore(t)
  assert.deepEqual(store.addEntity({ name: 'Alice', entity_type: 'person', properties: { role: 'dev' } }).status, 'created')
  assert.deepEqual(store.addEntity({ name: 'Alice', entity_type: 'engineer' }).status, 'updated')

  const triple = store.addTriple({
    subject: 'Alice',
    predicate: 'maintains',
    object: 'mempalace',
    project: 'demo',
    valid_from: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(triple.status, 'created')

  const query = store.queryEntity('Alice')
  assert.equal(query.entity.type, 'engineer')
  assert.deepEqual(query.entity.properties, { role: 'dev' })
  assert.equal(query.facts.length, 1)
  assert.equal(query.facts[0].object, 'mempalace')
  assert.equal(store.queryByPredicate('maintains').length, 1)
  assert.equal(store.findTriple('Alice', 'maintains', 'mempalace'), triple.id)
  assert.equal(store.findTriple('Alice', 'maintains', 'other'), null)

  assert.deepEqual(store.invalidateTriple(triple.id, '2026-02-01T00:00:00.000Z'), { status: 'invalidated', id: triple.id })
  assert.equal(store.queryByPredicate('maintains')[0].valid_to, '2026-02-01T00:00:00.000Z')
  assert.equal(store.knowledgeStats().activeTriples, 0)
  assert.equal(store.knowledgeStats().entityCount, 2)
  assert.equal(store.kgTimeline('Alice').length, 1)
  assert.equal(store.listEntities({ q: 'Ali' })[0].facts, 1)
})

test('diary reads the latest entries in chronological order', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { store } = await openStore(t)
  for (const [timestamp, entry] of [
    ['2026-01-01T00:00:00.000Z', 'first diary entry'],
    ['2026-01-02T00:00:00.000Z', 'second diary entry'],
    ['2026-01-03T00:00:00.000Z', 'third diary entry'],
  ]) {
    await store.store({ content: entry, project: 'diary-agent', topic: 'diary', source: 'diary', timestamp })
  }
  const latest = store.diaryRead({ agent_name: 'agent', last_n: 2 })
  assert.deepEqual(latest.map(item => item.text), ['second diary entry', 'third diary entry'])
  const written = await store.diaryWrite({ agent_name: 'agent', entry: 'fourth diary entry' })
  assert.equal(written.status, 'stored')
  assert.equal(store.diaryRead({ agent_name: 'agent' }).at(-1).text, 'fourth diary entry')
})

test('export and import round-trip memories, entities and triples', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const source = await openStore(t)
  await source.store.store({ content: 'portable memory content', project: 'portable', topic: 'transfer', timestamp: '2026-03-01T00:00:00.000Z' })
  source.store.addTriple({ subject: 'Portable', predicate: 'belongs-to', object: 'Demo', project: 'portable', valid_from: '2026-03-01T00:00:00.000Z' })
  const payload = source.store.exportAll()
  assert.equal(payload.memories.length, 1)
  assert.equal(payload.triples.length, 1)

  const target = await openStore(t)
  const summary = await target.store.importAll(payload)
  assert.equal(summary.memories.stored, 1)
  assert.equal(summary.triples.created, 1)
  assert.equal(target.store.size, 1)
  assert.equal(target.store.knowledgeStats().tripleCount, 1)
  assert.equal(target.store.queryEntity('Portable').facts.length, 1)

  const again = await target.store.importAll(payload)
  assert.equal(again.memories.duplicate, 1)
  assert.equal(again.triples.duplicate, 1)
})

test('missing embeddings degrade to keyword search and reindex restores vectors', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const embed = fakeEmbedder()
  const { store } = await openStore(t, { embed })
  embed.fail()
  const stored = await store.store({ content: 'offline keyword zebra note', project: 'offline', topic: 'docs' })
  assert.equal(stored.status, 'stored')
  assert.equal(store.listMemories({ project: 'offline' }).items[0].embedded, 0)

  const keyword = await store.search('zebra', { project: 'offline' })
  assert.equal(keyword.mode, 'keyword')
  assert.equal(keyword.results.length, 1)
  assert.equal(store.status().embedding_error, 'model offline')

  embed.recover()
  const reindexed = await store.reindex()
  assert.equal(reindexed.updated, 1)
  assert.equal(store.listMemories({ project: 'offline' }).items[0].embedded, 1)
  const semantic = await store.search('zebra', { project: 'offline' })
  assert.ok(['semantic', 'mixed'].includes(semantic.mode))
  assert.equal(semantic.results.some(item => item.id === stored.id), true)
})

test('closing and reopening the store keeps persisted memories', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { dir, store } = await openStore(t)
  await store.store({ content: 'persisted across restart', project: 'restart', timestamp: '2026-04-01T00:00:00.000Z' })
  store.checkpoint()
  store.close()

  const reopened = new MemoryStore({ memoryDir: dir, embed: fakeEmbedder(), logger: silent })
  await reopened.open()
  t.after(() => reopened.close())
  assert.equal(reopened.size, 1)
  assert.equal(reopened.listMemories({ project: 'restart' }).items[0].content, 'persisted across restart')
  reopened.vacuum()
  assert.equal(reopened.size, 1)
})

function fakeHttpService(overrides = {}) {
  return {
    calls: [],
    async statusSnapshot() { return { state: 'ready', config: {}, models: {}, paths: {}, store: {}, stats: {} } },
    async wakeupPreview() { return { text: '', tokens: 0, project: null } },
    async listMemories(options) { this.calls.push(['listMemories', options]); return { items: [], total: 0, limit: options.limit, offset: options.offset } },
    async saveMemory(input) { this.calls.push(['saveMemory', input]); return { status: 'stored', id: 'mem_1' } },
    async deleteMemory(id) { return { status: 'deleted', id } },
    async search(query) { return { query, mode: 'semantic', results: [] } },
    async exportAll() { return { version: 1, memories: [] } },
    async updateConfig(patch) { return patch },
    async importAll() { return { memories: { stored: 0 } } },
    async vacuum() { return { status: 'vacuumed' } },
    async reindex() { return { updated: 0 } },
    async warmModels() { return { embedding: 'ready' } },
    modelsStatus() { return { embedding: 'ready' } },
    ...overrides,
  }
}

test('HTTP API enforces loopback, session, origin, JSON and body limits', async t => {
  let handler
  const service = fakeHttpService()
  registerMempalaceHttp({
    webServer: { register(route) { handler = route.handler; return () => {} } },
    get: () => ({ requestRejection: req => (req.headers.cookie ? null : 401) }),
  }, service)

  async function request(url, { method = 'GET', body, raw, auth = true, host = '127.0.0.1:3082', contentType = 'application/json', origin } = {}) {
    const req = Readable.from(raw !== undefined ? [raw] : body !== undefined ? [JSON.stringify(body)] : [])
    Object.assign(req, {
      url: `/dsh-mempalace/api${url}`,
      method,
      headers: {
        host,
        ...(auth ? { cookie: 'session=ok' } : {}),
        ...(body !== undefined || raw !== undefined ? { 'content-type': contentType } : {}),
        ...(origin ? { origin } : {}),
      },
    })
    let status, headers, text
    await handler(req, {
      writeHead(code, values) { status = code; headers = values },
      end(value) { text = value },
    })
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status, headers, data }
  }

  assert.equal((await request('/status')).status, 200)
  assert.equal((await request('/status', { host: 'example.com' })).data.code, 'HOST_REJECTED')
  assert.equal((await request('/status', { auth: false })).status, 401)
  assert.equal((await request('/status', { host: 'example.com' })).status, 403)
  assert.equal((await request('/status', { host: 'localhost:3082' })).status, 200)

  const paged = await request('/memories?limit=7&offset=3&sort=oldest')
  assert.equal(paged.status, 200)
  assert.deepEqual(service.calls.at(-1)[1], { project: undefined, topic: undefined, source: undefined, q: undefined, limit: 7, offset: 3, sort: 'oldest' })

  assert.equal((await request('/memories', { method: 'POST', body: { content: 'x' } })).status, 200)
  assert.equal((await request('/memories', { method: 'POST', body: { content: 'x' }, origin: 'https://example.com' })).status, 403)
  assert.equal((await request('/memories', { method: 'POST', body: { content: 'x' }, contentType: 'text/plain' })).status, 415)
  assert.equal((await request('/memories', { method: 'POST', raw: '{broken' })).status, 400)
  assert.equal((await request('/memories', { method: 'POST', raw: 'x'.repeat(600 * 1024) })).status, 413)
  assert.equal((await request('/unknown')).status, 404)

  const exported = await request('/export')
  assert.equal(exported.status, 200)
  assert.match(exported.headers['content-disposition'], /^attachment; filename="mempalace-/)

  const failing = fakeHttpService({
    async search() {
      throw Object.assign(new Error('native dependencies missing'), { code: 'MEMPALACE_UNAVAILABLE', hint: 'run setup' })
    },
  })
  let failingHandler
  registerMempalaceHttp({
    webServer: { register(route) { failingHandler = route.handler; return () => {} } },
    get: () => ({ requestRejection: () => null }),
  }, failing)
  const req = Readable.from([JSON.stringify({ query: 'x' })])
  Object.assign(req, { url: '/dsh-mempalace/api/search', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } })
  let status, text
  await failingHandler(req, { writeHead(code) { status = code }, end(value) { text = value } })
  assert.equal(status, 503)
  assert.deepEqual(JSON.parse(text), {
    ok: false,
    code: 'MEMPALACE_UNAVAILABLE',
    error: 'native dependencies missing',
    hint: 'run setup',
  })
})

function settle() {
  return new Promise(resolve => setImmediate(resolve))
}

test('embedding service never blocks storage on a cold model load', async () => {
  let release
  const pending = new Promise(resolve => {
    release = () => resolve(async text => ({ data: featureVector(text) }))
  })
  const service = new EmbeddingService({
    modelName: 'fake/embedding',
    topicModel: '',
    loadTimeoutMs: 5_000,
    createPipeline: () => pending,
    logger: silent,
  })
  try {
    await assert.rejects(service.embedIfReady('hello'), /后台加载/)
    assert.equal(service.status().embedding, 'loading')
    release()
    await settle()
    assert.equal(service.status().embedding, 'ready')
    const vector = await service.embedIfReady('hello')
    assert.equal(vector.length, EMBEDDING_DIM)
  } finally {
    await service.dispose()
  }
})

test('topic inference degrades while loading and recovers once ready', async () => {
  const service = new EmbeddingService({
    modelName: 'fake/embedding',
    topicModel: 'fake/topic',
    loadTimeoutMs: 5_000,
    createPipeline: async () => async () => [{ generated_text: ' Database Design ' }],
    logger: silent,
  })
  try {
    await assert.rejects(service.inferTopicIfReady('create a schema'), /后台加载/)
    for (let attempt = 0; attempt < 20 && service.status().topic !== 'ready'; attempt += 1) await settle()
    assert.equal(service.status().topic, 'ready')
    assert.equal(await service.inferTopicIfReady('create a schema'), 'database-design')
  } finally {
    await service.dispose()
  }
})

test('explicit warmup is bounded by the configured load timeout', async () => {
  const service = new EmbeddingService({
    modelName: 'fake/embedding',
    topicModel: '',
    loadTimeoutMs: 25,
    createPipeline: () => new Promise(() => {}),
    logger: silent,
  })
  const started = Date.now()
  try {
    await assert.rejects(service.warmup(), /超时/)
    assert.ok(Date.now() - started < 2_000)
    assert.equal(service.status().embedding, 'error')
  } finally {
    await service.dispose()
  }
})
