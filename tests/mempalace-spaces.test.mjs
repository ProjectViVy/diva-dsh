import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from '../plugins/dsh-mempalace/node_modules/better-sqlite3/lib/index.js'
import { load as loadVec } from '../plugins/dsh-mempalace/node_modules/sqlite-vec/index.mjs'
import { EMBEDDING_DIM } from '../plugins/dsh-mempalace/src/store/chunk.mjs'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'
import {
  SPACE_ID_PATTERN,
  parseVecTableDim,
  spaceIdFor,
  vecTableFor,
} from '../plugins/dsh-mempalace/src/store/spaces.mjs'

const pluginDir = fileURLToPath(new URL('../plugins/dsh-mempalace/', import.meta.url))
const nativeReady = existsSync(join(pluginDir, 'node_modules/better-sqlite3'))
  && existsSync(join(pluginDir, 'node_modules/sqlite-vec'))
const skip = !nativeReady && '原生依赖未安装（plugins/dsh-mempalace/node_modules 缺少 better-sqlite3 或 sqlite-vec）'
const silent = { warn() {}, info() {}, error() {} }

const openStores = []
function tempDir(t, prefix = 'spaces-') {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => {
    while (openStores.length > 0) {
      try { openStores.pop().close() } catch { /* already closed */ }
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

/** Deterministic character-bucket vector for an arbitrary width; no model download. */
function featureVector(text, dim) {
  const vector = new Float32Array(dim)
  for (const char of String(text).toLowerCase()) {
    const code = char.codePointAt(0)
    vector[code % dim] += 1
    vector[(code * 31) % dim] += 0.5
  }
  let norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm === 0) { vector[0] = 1; norm = 1 }
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

const CLOUD_SPACE = { source: 'cloud', kind: 'dashscope', model: 'text-embedding-v4', dim: 512 }

async function openStore(t, options = {}) {
  const dir = options.dir ?? tempDir(t)
  const dim = options.space?.dim ?? EMBEDDING_DIM
  const store = new MemoryStore({
    memoryDir: dir,
    embed: options.embed ?? (async text => featureVector(text, dim)),
    logger: silent,
    ...options.space ? { space: options.space } : {},
    ...options.store,
  })
  await store.open()
  openStores.push(store)
  return { dir, store }
}

test('space ids and table names stay stable and collision-free', () => {
  assert.equal(spaceIdFor({ source: 'local', model: 'Xenova/all-MiniLM-L6-v2', dim: 384 }),
    'local-xenova-all-minilm-l6-v2@384')
  assert.equal(spaceIdFor(CLOUD_SPACE), 'cloud-dashscope-text-embedding-v4@512')
  assert.match(spaceIdFor({ source: 'local', model: '', dim: 384 }), SPACE_ID_PATTERN)
  assert.throws(() => spaceIdFor({ source: 'local', model: 'm', dim: 3 }), /between 64 and 4096/)
  assert.throws(() => spaceIdFor({ source: 'quantum', model: 'm', dim: 384 }), /local or cloud/)

  const first = vecTableFor('cloud-dashscope-text-embedding-v4@512')
  const second = vecTableFor('cloud-dashscope-text-embedding-v4@512', new Set([first]))
  assert.notEqual(second, first)
  assert.match(first, /^vec_memories_[a-z0-9_]+$/)
  assert.equal(parseVecTableDim('CREATE VIRTUAL TABLE x USING vec0(embedding float[512])'), 512)
  assert.equal(parseVecTableDim('CREATE TABLE plain (a TEXT)'), null)
})

test('two widths coexist in one database and each search stays inside its space', { skip }, async t => {
  const first = await openStore(t)
  await first.store.store({ content: '她喜欢雨天听钢琴曲', project: 'qq', topic: '音乐' })
  assert.equal(first.store.spaceId, 'local-xenova-all-minilm-l6-v2@384')

  const second = await openStore(t, { dir: first.dir, space: CLOUD_SPACE })
  assert.equal(second.store.spaceId, 'cloud-dashscope-text-embedding-v4@512')
  assert.notEqual(second.store.vecTable, first.store.vecTable)

  const before = second.store.spacesStatus()
  assert.equal(before.spaces.length, 2)
  assert.equal(before.missing_in_active_space, 1, '旧记忆在新空间里还没有向量')
  assert.deepEqual(before.spaces.map(space => space.dim).sort(), [384, 512])

  await second.store.store({ content: '她讨厌被敷衍', project: 'qq', topic: '相处' })
  const cloud = await second.store.search('敷衍')
  assert.equal(cloud.mode, 'semantic')
  assert.deepEqual(cloud.results.map(item => item.text), ['她讨厌被敷衍'])

  const local = await first.store.search('钢琴')
  assert.deepEqual(local.results.map(item => item.text), ['她喜欢雨天听钢琴曲'])

  const after = second.store.spacesStatus()
  const byId = new Map(after.spaces.map(space => [space.space_id, space]))
  assert.equal(byId.get('local-xenova-all-minilm-l6-v2@384').vectors, 1)
  assert.equal(byId.get('cloud-dashscope-text-embedding-v4@512').vectors, 1)
  assert.equal(byId.get('cloud-dashscope-text-embedding-v4@512').active, true)
  assert.equal(byId.get('local-xenova-all-minilm-l6-v2@384').active, false)
})

test('a vector of the wrong width is refused and never written', { skip }, async t => {
  const dir = tempDir(t)
  const store = new MemoryStore({
    memoryDir: dir,
    space: CLOUD_SPACE,
    embed: async text => featureVector(text, EMBEDDING_DIM),
    logger: silent,
  })
  await store.open()
  openStores.push(store)

  const result = await store.store({ content: '宽度不匹配的记忆', project: 'qq' })
  assert.equal(result.status, 'stored', '正文必须仍然写进去')
  assert.equal(store.lastEmbeddingErrorCode, 'MEMPALACE_SPACE_MISMATCH')
  assert.equal(store.spacesStatus().spaces.find(space => space.active).vectors, 0)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS cnt FROM memory_spaces').get().cnt, 0)
  const row = store.db.prepare('SELECT embedded FROM memories WHERE id = ?').get(result.id)
  assert.equal(row.embedded, 0)
  assert.equal((await store.search('宽度')).mode, 'keyword')
})

test('a legacy single-table database is adopted in place with every row kept', { skip }, async t => {
  const dir = tempDir(t, 'spaces-legacy-')
  const legacyContents = ['旧的记忆一', '旧的记忆二', '旧的记忆三']
  const db = new Database(join(dir, 'memories.db'))
  loadVec(db)
  db.exec(`
    CREATE TABLE memories (
      id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      project TEXT NOT NULL DEFAULT 'general',
      topic TEXT NOT NULL DEFAULT 'general',
      source TEXT NOT NULL DEFAULT 'manual',
      timestamp TEXT NOT NULL,
      session_id TEXT NOT NULL DEFAULT '',
      importance REAL DEFAULT 0.5,
      chunk_index INTEGER DEFAULT 0,
      parent_id TEXT DEFAULT NULL,
      embedded INTEGER NOT NULL DEFAULT 1,
      archive_id TEXT DEFAULT NULL,
      archive_digest TEXT DEFAULT NULL,
      subject_id TEXT DEFAULT NULL,
      archive_meta TEXT DEFAULT NULL
    );
    CREATE VIRTUAL TABLE vec_memories USING vec0(embedding float[384]);
  `)
  const insert = db.prepare(`INSERT INTO memories (id, content, content_hash, project, topic, timestamp)
    VALUES (?, ?, ?, 'qq', 'event', '2026-10-01')`)
  const insertVec = db.prepare('INSERT INTO vec_memories (rowid, embedding) VALUES (?, ?)')
  for (const [index, content] of legacyContents.entries()) {
    const info = insert.run(`mem_${index}`, content, `hash_${index}`)
    insertVec.run(BigInt(Number(info.lastInsertRowid)), featureVector(content, EMBEDDING_DIM))
  }
  db.close()

  const { store } = await openStore(t, { dir })
  assert.equal(store.countAll(), legacyContents.length)
  const status = store.status()
  assert.equal(status.space.provenance, 'legacy-adopted')
  assert.equal(status.space.table, 'vec_memories')
  assert.equal(status.space.vectors, legacyContents.length)
  assert.equal(status.missing_in_active_space, 0, '收养时按旧表回填了空间归属')
  assert.equal(store.spacesStatus().spaces.length, 1)
  assert.ok(existsSync(status.migration_backup), '迁移前必须写备份')
  assert.deepEqual(readdirSync(join(dir, 'backups')).length, 1)
  const found = await store.search('旧')
  assert.deepEqual(found.results.map(item => item.text).sort(), [...legacyContents].sort())
})

test('switching the configured width opens a second space and keeps the first intact', { skip }, async t => {
  const first = await openStore(t)
  await first.store.store({ content: '本地空间的记忆', project: 'qq' })
  const localSpaceId = first.store.spaceId

  const cloud = await openStore(t, { dir: first.dir, space: CLOUD_SPACE })
  assert.equal(cloud.store.spacesStatus().missing_in_active_space, 1)
  await cloud.store.reindex()
  assert.equal(cloud.store.spacesStatus().missing_in_active_space, 0)

  const back = await openStore(t, { dir: first.dir })
  assert.equal(back.store.spaceId, localSpaceId)
  assert.equal(back.store.spacesStatus().missing_in_active_space, 0, '切回旧空间时向量仍在')
  assert.equal(back.store.spacesStatus().spaces.length, 2)
  assert.deepEqual((await back.store.search('本地空间')).results.map(item => item.text), ['本地空间的记忆'])
})

test('a registered space whose table vanished fails loud instead of being recreated', { skip }, async t => {
  const { dir, store } = await openStore(t)
  await store.store({ content: '会被保留的正文', project: 'qq' })
  const table = store.vecTable
  store.close()
  const raw = new Database(join(dir, 'memories.db'))
  loadVec(raw)
  raw.exec(`DROP TABLE "${table}"`)
  raw.close()

  const reopened = new MemoryStore({ memoryDir: dir, embed: async text => featureVector(text, EMBEDDING_DIM), logger: silent })
  await assert.rejects(() => reopened.open(), error => {
    assert.equal(error.code, 'MEMPALACE_SPACE_MISSING')
    assert.match(error.hint, /backups/)
    return true
  })
  openStores.push(reopened)
  assert.equal(reopened.opened, false)
})

test('writes flag sensitive content in the persisted column', { skip }, async t => {
  const { store } = await openStore(t, { store: { sensitive: text => String(text).includes('身份证') } })
  const plain = await store.store({ content: '她喜欢清晨的雾', project: 'qq' })
  const risky = await store.store({ content: '身份证 110101199001011234', project: 'qq' })
  assert.equal(store.db.prepare('SELECT sensitive FROM memories WHERE id = ?').get(plain.id).sensitive, 0)
  assert.equal(store.db.prepare('SELECT sensitive FROM memories WHERE id = ?').get(risky.id).sensitive, 1)
})
