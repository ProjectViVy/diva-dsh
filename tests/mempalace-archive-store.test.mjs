import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBEDDING_DIM } from '../plugins/dsh-mempalace/src/store/chunk.mjs'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'

const pluginDir = fileURLToPath(new URL('../plugins/dsh-mempalace/', import.meta.url))
const nativeReady = existsSync(join(pluginDir, 'node_modules/better-sqlite3'))
  && existsSync(join(pluginDir, 'node_modules/sqlite-vec'))
const skip = !nativeReady && '原生依赖未安装（plugins/dsh-mempalace/node_modules 缺少 better-sqlite3 或 sqlite-vec），归档存储用例已 skip'
const silent = { warn() {}, info() {}, error() {} }
const SUBJECT = 'subject_11111111-1111-4111-8111-111111111111'

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
  if (!Number.isFinite(norm) || norm === 0) { vector[0] = 1; norm = 1 }
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

const fakeEmbedder = () => async text => featureVector(text)

function archiveItem({ archiveId = 'arch_mem_a_r1', content = '一起看过的星星', meta = {} } = {}) {
  return {
    archive_id: archiveId,
    digest: createHash('sha256').update(archiveId, 'utf8').digest('hex'),
    content,
    subject_id: SUBJECT,
    source: 'actmem-archive',
    schema_version: 1,
    received_at: '2026-02-01T00:00:00.000Z',
    now: Date.parse('2026-02-01T00:00:00.000Z'),
    meta: { project: 'qq', topic: '星星', timestamp: '2026-01-01T00:00:00.000Z', session_id: 'mem_a', importance: 0.6, revision: 1, provenance: { source: 'qq', at: '2026-01-01T00:00:00.000Z' }, ...meta },
  }
}

async function openStore(t, options = {}) {
  const dir = tempDir(t, 'mempalace-archive-')
  const store = new MemoryStore({ memoryDir: dir, embed: options.embed ?? fakeEmbedder(), logger: silent, ...options.store })
  await store.open()
  t.after(() => store.close())
  return { dir, store }
}

const columnsOf = store => store.db.prepare('PRAGMA table_info(memories)').all().map(column => column.name)

test('reopening the store keeps the archive columns and stays idempotent', { skip }, async t => {
  const { dir, store } = await openStore(t)
  assert.deepEqual(['archive_id', 'archive_digest', 'subject_id', 'archive_meta'].filter(name => !columnsOf(store).includes(name)), [])
  const again = new MemoryStore({ memoryDir: dir, embed: fakeEmbedder(), logger: silent })
  await again.open()
  await again.open()
  assert.deepEqual(['archive_id', 'archive_digest', 'subject_id', 'archive_meta'].filter(name => !columnsOf(again).includes(name)), [])
  again.close()
})

test('the same archive_id cannot be written twice, even across chunked bodies', { skip }, async t => {
  const { store } = await openStore(t)
  const first = await store.insertArchive(archiveItem({ content: '第一段\n\n第二段'.repeat(120) }))
  assert.ok(first.memory_ids.length > 1)
  assert.equal(first.chunks, first.memory_ids.length)
  assert.equal(store.countAll(), first.chunks)
  await assert.rejects(() => store.insertArchive(archiveItem({ content: '第一段\n\n第二段'.repeat(120) })), /UNIQUE/i)
  assert.equal(store.countAll(), first.chunks)
})

test('archive rows are derived from archive_id and chain their chunks', { skip }, async t => {
  const { store } = await openStore(t)
  const content = Array.from({ length: 14 }, (_, index) => `第 ${index} 段：${'她喜欢的旋律。'.repeat(12)}`).join('\n\n')
  const item = archiveItem({ archiveId: 'arch_long_r2', content })
  const inserted = await store.insertArchive(item)
  const base = `arc_${createHash('sha256').update('arch_long_r2', 'utf8').digest('hex').slice(0, 16)}`
  assert.deepEqual(inserted.memory_ids, inserted.memory_ids.map((_, index) => `${base}_c${index}`))
  const rows = store.db.prepare('SELECT id, chunk_index, parent_id, source, content_hash, archive_id, archive_digest, subject_id, archive_meta FROM memories ORDER BY chunk_index').all()
  assert.equal(rows.length, inserted.chunks)
  assert.equal(rows[0].parent_id, null)
  assert.equal(rows[1].parent_id, `${base}_c0`)
  for (const row of rows) {
    assert.equal(row.source, 'actmem-archive')
    assert.equal(row.archive_id, 'arch_long_r2')
    assert.equal(row.archive_digest, item.digest)
    assert.equal(row.subject_id, SUBJECT)
    assert.equal(row.content_hash, createHash('sha256').update(`arch_long_r2\n${store.db.prepare('SELECT content FROM memories WHERE id = ?').get(row.id).content}`, 'utf8').digest('hex').slice(0, 16))
    assert.equal(JSON.parse(row.archive_meta).revision, 1)
  }
})

test('an archived body coexists with an auto-captured copy of the same text', { skip }, async t => {
  const { store } = await openStore(t)
  const content = '她反复提到汉斯·季默'
  await store.store({ content, project: 'qq', topic: 'music' })
  const inserted = await store.insertArchive(archiveItem({ content }))
  assert.equal(store.countAll(), 1 + inserted.chunks)
  const found = store.findArchiveById(archiveItem().archive_id)
  assert.equal(found.digest, inserted.digest)
  assert.deepEqual(found.memory_ids, inserted.memory_ids)
})

test('reindex keeps archived content byte-identical', { skip }, async t => {
  const { store } = await openStore(t)
  const item = archiveItem({ content: '一起看过「星际穿越」的那个晚上，备注：她喜欢汉斯·季默' })
  await store.insertArchive(item)
  const before = store.db.prepare('SELECT id, content FROM memories WHERE archive_id IS NOT NULL ORDER BY id').all()
  store.db.prepare('UPDATE memories SET embedded = 0 WHERE archive_id IS NOT NULL').run()
  const result = await store.reindex()
  assert.equal(result.failed, 0)
  const after = store.db.prepare('SELECT id, content FROM memories WHERE archive_id IS NOT NULL ORDER BY id').all()
  assert.deepEqual(after, before)
  assert.equal(store.db.prepare('SELECT COUNT(*) AS cnt FROM memories WHERE archive_id IS NOT NULL AND embedded = 0').get().cnt, 0)
})

test('archive lookup answers by archive_id and a deleted ledger row reads back as absent', { skip }, async t => {
  const { store } = await openStore(t)
  assert.equal(store.findArchiveById('arch_missing_r1'), null)
  const inserted = await store.insertArchive(archiveItem())
  const found = store.findArchiveById('arch_mem_a_r1')
  assert.equal(found.archive_id, 'arch_mem_a_r1')
  assert.equal(found.subject_id, SUBJECT)
  assert.equal(found.chunks, inserted.chunks)
  assert.deepEqual(found.memory_ids, inserted.memory_ids)
  for (const id of inserted.memory_ids) store.delete(id)
  assert.equal(store.findArchiveById('arch_mem_a_r1'), null)
})

test('rows that disagree on digest are reported as a conflict, never a receipt', { skip }, async t => {
  const { store } = await openStore(t)
  const item = archiveItem({ content: '第一段\n\n第二段'.repeat(120) })
  const inserted = await store.insertArchive(item)
  assert.ok(inserted.memory_ids.length > 1)
  const corruptDigest = 'f'.repeat(64)
  store.db.prepare('UPDATE memories SET archive_digest = ? WHERE id = ?').run(corruptDigest, inserted.memory_ids[1])
  const found = store.findArchiveById(item.archive_id)
  assert.equal(found.conflict, true)
  assert.deepEqual(new Set(found.digests), new Set([item.digest, corruptDigest]))
})
