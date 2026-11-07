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
import { projectFromCwd, resolveProject } from '../plugins/dsh-mempalace/src/project.mjs'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'
import { EmbeddingService } from '../plugins/dsh-mempalace/src/store/embeddings.mjs'
import { createTools } from '../plugins/dsh-mempalace/src/tools.mjs'
import { registerMempalaceHttp } from '../plugins/dsh-mempalace/src/http.mjs'

const pluginDir = fileURLToPath(new URL('../plugins/dsh-mempalace/', import.meta.url))
const nativeReady = existsSync(join(pluginDir, 'node_modules/better-sqlite3'))
  && existsSync(join(pluginDir, 'node_modules/sqlite-vec'))
const silent = { warn() {}, info() {}, error() {} }
const toolsSource = readFileSync(join(pluginDir, 'src/tools.mjs'), 'utf8')
const httpSource = readFileSync(join(pluginDir, 'src/http.mjs'), 'utf8')
const commandsSource = readFileSync(join(pluginDir, 'src/commands.mjs'), 'utf8')
const clientSource = readFileSync(join(pluginDir, 'src/client.js'), 'utf8')
const serviceSource = readFileSync(join(pluginDir, 'src/service.mjs'), 'utf8')
const storeSource = readFileSync(join(pluginDir, 'src/store/memory_store.mjs'), 'utf8')

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

test('config resolves defaults and drops retired capture settings', t => {
  const resolved = resolveConfig({}, {
    wakeUpMaxTokens: 500,
    defaultProject: 'demo',
    autoCapture: true,
    captureMinChars: 5,
    userMinChars: 2,
    captureMaxChars: 120,
    maxPendingCaptures: 3,
  })
  assert.equal(resolved.wakeUpMaxTokens, 500)
  assert.equal(resolved.defaultProject, 'demo')
  for (const key of ['autoCapture', 'wakeUpEnabled', 'captureMinChars', 'userMinChars', 'captureMaxChars', 'maxPendingCaptures']) {
    assert.equal(Object.hasOwn(resolved, key), false)
  }

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

test('project labels derive from default, session and cwd', () => {
  assert.equal(projectFromCwd('/work/MyRepo/'), 'MyRepo')
  assert.equal(projectFromCwd(''), 'general')
  assert.equal(resolveProject({ defaultProject: 'fixed', sessionProject: 'session', cwd: '/work/cwd' }), 'fixed')
  assert.equal(resolveProject({ sessionProject: 'session', cwd: '/work/cwd' }), 'session')
  assert.equal(resolveProject({ cwd: '/work/cwd' }), 'cwd')
})

test('startup retires legacy state before reading config', () => {
  const source = readFileSync(join(pluginDir, 'src/index.mjs'), 'utf8')
  const retire = source.indexOf('retireLegacyState(stateDir')
  assert.ok(retire >= 0)
  assert.ok(retire < source.indexOf('loadPersistedConfig(stateDir)'))
})

test('plugin no longer captures conversations', () => {
  const index = readFileSync(join(pluginDir, 'src/index.mjs'), 'utf8')
  assert.doesNotMatch(index, /user\/message|assistant\/message|extractMessageText|isHumanUserMessage|observeUser|observeAssistant/)
  assert.match(index, /working-directory\/change/)

  const service = readFileSync(join(pluginDir, 'src/service.mjs'), 'utf8')
  assert.doesNotMatch(service, /SessionCapture|observeUser|observeAssistant|captureQueue|pendingCaptures|captureConfigVersion|#createCapture|#enqueueCapture/)

  const config = readFileSync(join(pluginDir, 'src/config.mjs'), 'utf8')
  assert.doesNotMatch(config, /autoCapture|captureMinChars|userMinChars|captureMaxChars|maxPendingCaptures/)

  const commands = readFileSync(join(pluginDir, 'src/commands.mjs'), 'utf8')
  assert.doesNotMatch(commands, /case 'on'|case 'off'|setSessionCaptureEnabled|autoCapture/)

  const client = readFileSync(join(pluginDir, 'src/client.js'), 'utf8')
  assert.doesNotMatch(client, /autoCapture|captureMinChars|userMinChars|captureMaxChars|maxPendingCaptures|自动捕获/)

  assert.equal(existsSync(join(pluginDir, 'src/capture.mjs')), false)

  assert.doesNotMatch(index, /mempalace:wakeup|wakeupFor/)
  assert.match(index, /owned by ActMem/)

  const storeSource = readFileSync(join(pluginDir, 'src/store/memory_store.mjs'), 'utf8')
  assert.doesNotMatch(storeSource, /identityPath|identity_exists|## Identity/)
  assert.doesNotMatch(service, /wakeupFor|identityPath|identity\.txt/)
  assert.doesNotMatch(client, /\/wakeup|wakeUpEnabled|identityPath|唤醒注入|可注入/)
  assert.match(client, /recent-memory/)
  assert.match(client, /近期记忆预览/)
  assert.match(client, /只读归档/)
  assert.doesNotMatch(client, /新增记忆|确认删除|\/memories\/delete/)
})

test('manual memory and diary write surfaces are retired', () => {
  for (const name of ['memory_save', 'memory_delete', 'memory_diary_write']) {
    assert.doesNotMatch(toolsSource, new RegExp(`name: '${name}'`), `${name} is retired`)
  }
  for (const route of ["'/memories' && req.method === 'POST'", "'/memories/delete'", "'/diary' && req.method === 'POST'"]) {
    assert.ok(!httpSource.includes(route), `${route} is retired`)
  }
  assert.doesNotMatch(commandsSource, /case 'save':/)
  assert.doesNotMatch(commandsSource, /\/mempalace save/)
  assert.doesNotMatch(clientSource, /diary\.write|diaryWrite|写一条日记|writeDiary/)
  assert.doesNotMatch(serviceSource, /saveMemory|deleteMemory|diaryWrite/)
  assert.match(httpSource, /'\/diary' && req.method === 'GET'/)
  assert.match(toolsSource, /name: 'memory_diary_read'/)
  assert.match(storeSource, /async store\(/)
  assert.match(storeSource, /async diaryWrite\(/)
  assert.match(storeSource, /\n  delete\(id\) \{/)
})

test('the ledger endpoint is read-only', () => {
  assert.match(httpSource, /'\/knowledge\/commits' && req\.method === 'GET'/)
  assert.doesNotMatch(httpSource, /'\/knowledge\/commits'[\s\S]{0,200}POST/)
  assert.match(clientSource, /knowledge\/commits/)
})

test('tools expose complete schemas and validate missing arguments', async () => {
  const service = {
    getSessionProject: () => 'demo',
    search: async () => ({ query: 'q', mode: 'semantic', results: [] }),
  }
  const definitions = createTools(service)
  assert.deepEqual(definitions.map(definition => definition.name), [
    'memory_search', 'memory_recall', 'memory_status', 'memory_graph', 'memory_tunnel',
    'knowledge_add', 'knowledge_query', 'knowledge_status', 'memory_list_rooms', 'memory_taxonomy',
    'memory_check_duplicate', 'knowledge_invalidate', 'knowledge_timeline', 'memory_diary_read',
  ])
  for (const tool of definitions) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
  // 回归测试：DSH 调用 output.render(exec.arguments, value)——参数在前、值在后。
  // 若 render 只声明一个形参，它绑定的就是调用参数，值被丢掉，工具静默渲染成空串
  // （isError 仍是 false，schema 校验看的是 value，所以全绿也发现不了）。
  for (const tool of definitions) {
    assert.deepEqual(
      tool.output.render({ anyArgument: true }, { text: `rendered:${tool.name}` }),
      [{ type: 'text', text: `rendered:${tool.name}` }],
      `${tool.name} 的 render 没有按 (args, value) 取值`,
    )
  }
  const search = definitions.find(tool => tool.name === 'memory_search')
  await assert.rejects(search.execute({}, {}), /INVALID_ARGS/)
  const found = await search.execute({ query: 'anything' }, {})
  assert.equal(found.text.includes('No memories found'), true)
  assert.deepEqual(found.data, { mode: 'semantic', count: 0 })
})

test('memory store round trip covers search, pagination, duplicates and wake-up', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const { dir, store } = await openStore(t)
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

  writeFileSync(join(dir, 'identity.txt'), '# persona\nsecret\n')
  const wakeA = store.wakeup({ project: 'project-a', max_tokens: 800 })
  const wakeB = store.wakeup({ project: 'project-b', max_tokens: 800 })
  assert.doesNotMatch(wakeA.text, /Identity|persona|secret/)
  assert.equal('identity_exists' in store.status(), false)
  assert.equal(store.identityPath, undefined)
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

  const manual = await store.store({ content: 'manual note about release', project: 'project-c', topic: 'notes' })
  const manualRow = store.listMemories({ project: 'project-c', limit: 20 }).items.find(item => item.id === manual.id)
  assert.equal(manualRow.source, 'manual')
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
    async recentMemoryPreview() { return { text: '', tokens: 0, project: null } },
    async listMemories(options) { this.calls.push(['listMemories', options]); return { items: [], total: 0, limit: options.limit, offset: options.offset } },
    async diaryRead() { return [] },
    async listKnowledgeCommits(input) { this.calls.push(['listKnowledgeCommits', input]); return { commits: [] } },
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

function mountHttp(service) {
  let handler
  registerMempalaceHttp({
    webServer: { register(route) { handler = route.handler; return () => {} } },
    get: () => ({ requestRejection: () => null }),
  }, service)
  return async request => {
    const req = Readable.from([])
    Object.assign(req, {
      url: `/dsh-mempalace/api${request}`,
      method: 'GET',
      headers: { host: '127.0.0.1:3082', cookie: 'session=ok' },
    })
    let status, text
    await handler(req, { writeHead(code) { status = code }, end(value) { text = value } })
    return { status, data: text ? JSON.parse(text) : null }
  }
}

test('serves the read-only knowledge ledger', async () => {
  const service = fakeHttpService()
  const request = mountHttp(service)
  const response = await request('/knowledge/commits?assetScope=knowledge%3Aconflict%3Avivy&limit=7')
  assert.equal(response.status, 200)
  assert.equal(response.data.ok, true)
  assert.deepEqual(service.calls, [['listKnowledgeCommits', { assetScope: 'knowledge:conflict:vivy', limit: 7 }]])
  const alias = await request('/knowledge/commits?asset_scope=knowledge%3Aconflict%3Avivy')
  assert.equal(alias.status, 200)
  assert.deepEqual(service.calls.at(-1), ['listKnowledgeCommits', { assetScope: 'knowledge:conflict:vivy', limit: 50 }])
})

test('knowledge write routes return the ledger revision', async () => {
  const service = fakeHttpService({
    async addEntity() { return { status: 'created', id: 'ent_alice', revision: 1 } },
    async addTriple() { return { status: 'created', id: 7, revision: 2 } },
    async invalidateTriple() { return { status: 'invalidated', id: 7, revision: 3 } },
    async invalidateFact() { return { status: 'invalidated', id: 7, revision: 4 } },
  })
  let handler
  registerMempalaceHttp({
    webServer: { register(route) { handler = route.handler; return () => {} } },
    get: () => ({ requestRejection: () => null }),
  }, service)
  const post = async (url, body) => {
    const req = Readable.from([JSON.stringify(body)])
    Object.assign(req, {
      url: `/dsh-mempalace/api${url}`,
      method: 'POST',
      headers: { host: '127.0.0.1:3082', cookie: 'session=ok', 'content-type': 'application/json' },
    })
    let status, text
    await handler(req, { writeHead(code) { status = code }, end(value) { text = value } })
    return { status, data: text ? JSON.parse(text) : null }
  }
  assert.equal((await post('/knowledge/entity', { name: 'Alice' })).data.revision, 1)
  assert.equal((await post('/knowledge/triple', { subject: 'Alice', predicate: 'likes', object: 'tea' })).data.revision, 2)
  assert.equal((await post('/knowledge/invalidate', { id: 7 })).data.revision, 3)
  assert.equal((await post('/knowledge/invalidate', { subject: 'Alice', predicate: 'likes', object: 'tea' })).data.revision, 4)
})

test('knowledge writes surface the revision in tools and the panel', () => {
  assert.match(toolsSource, /r\$\{added\.revision\}/)
  assert.match(toolsSource, /r\$\{invalidated\.revision\}/)
  assert.match(clientSource, /saved\.revision/)
  assert.match(serviceSource, /async knowledgeWrite\(/)
})

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
  assert.equal((await request('/recent-memory')).status, 200)
  assert.equal((await request('/wakeup')).status, 404)

  const paged = await request('/memories?limit=7&offset=3&sort=oldest')
  assert.equal(paged.status, 200)
  assert.deepEqual(service.calls.at(-1)[1], { project: undefined, topic: undefined, source: undefined, q: undefined, limit: 7, offset: 3, sort: 'oldest' })

  const searched = await request('/search', { method: 'POST', body: { query: 'x' } })
  assert.equal(searched.status, 200)
  assert.equal(searched.data.ok, true)
  assert.equal((await request('/search', { method: 'POST', body: { query: 'x' }, origin: 'https://example.com' })).status, 403)
  assert.equal((await request('/search', { method: 'POST', body: { query: 'x' }, contentType: 'text/plain' })).status, 415)
  assert.equal((await request('/search', { method: 'POST', raw: '{broken' })).status, 400)
  assert.equal((await request('/search', { method: 'POST', raw: 'x'.repeat(600 * 1024) })).status, 413)

  assert.equal((await request('/memories', { method: 'POST', body: { content: 'x' } })).status, 404)
  assert.equal((await request('/memories/delete', { method: 'POST', body: { id: 'mem_1' } })).status, 404)
  assert.equal((await request('/diary', { method: 'POST', body: { agent_name: 'agent', entry: 'x' } })).status, 404)
  const diary = await request('/diary?agent_name=agent&last_n=3')
  assert.equal(diary.status, 200)
  assert.deepEqual(diary.data.entries, [])
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
