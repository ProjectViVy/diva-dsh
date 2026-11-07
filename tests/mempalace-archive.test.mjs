import test from 'node:test'
import assert from 'node:assert/strict'
import { archiveDigest, canonicalJson, ARCHIVE_ID_PATTERN, ARCHIVE_SCHEMA_VERSION, ARCHIVE_SOURCE } from '../plugins/_shared/archive-contract.mjs'
import { commitArchive, queryArchive, readArchiveRequest } from '../plugins/dsh-mempalace/src/archive.mjs'

const SUBJECT = 'subject_11111111-1111-4111-8111-111111111111'
const OTHER = 'subject_22222222-2222-4222-8222-222222222222'

function makeItem({ archiveId = 'arch_mem_a_r1', content = '一起看过的星星', revision = 1, subjectId = SUBJECT } = {}) {
  const meta = {
    project: 'qq', topic: '星星', timestamp: '2026-01-01T00:00:00.000Z', session_id: archiveId.split('_').slice(1, 3).join('_'),
    importance: 0.6, revision,
    provenance: { source: 'qq', at: '2026-01-01T00:00:00.000Z', externalId: 'm1' },
  }
  return { archive_id: archiveId, content, meta, digest: archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: subjectId, archive_id: archiveId, content, meta }) }
}

function makeRequest(items, { subjectId = SUBJECT, schemaVersion = ARCHIVE_SCHEMA_VERSION } = {}) {
  return { schema_version: schemaVersion, subject_id: subjectId, items }
}

function makeStore(existing = new Map()) {
  const store = { inserts: [], findErrors: [],
    async findArchiveById(id) { return existing.get(id) ?? null },
    async insertArchive(item) { store.inserts.push(item); existing.set(item.archive_id, { archive_id: item.archive_id, digest: item.digest, subject_id: item.subject_id, memory_ids: [`arc_x_c0`], chunks: 1, received_at: item.received_at }) ; return { memory_ids: ['arc_x_c0'], chunks: 1 } } }
  return store
}

test('the canonical digest ignores key order, drops undefined and is byte-stable for Chinese text', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 'x', c: [2, undefined, 3] } }), '{"a":{"c":[2,null,3],"d":"x"},"b":1}')
  const item = makeItem({ content: '一起在 B站 看过「星际穿越」，备注：她喜欢汉斯·季默' })
  const again = makeItem({ content: '一起在 B站 看过「星际穿越」，备注：她喜欢汉斯·季默' })
  assert.equal(item.digest, again.digest)
  assert.match(item.digest, /^[0-9a-f]{64}$/)
  // 重新排列 meta 的键不会影响 digest：digest 只描述内容本身。
  const reordered = { ...item, meta: { provenance: item.meta.provenance, revision: item.meta.revision, timestamp: item.meta.timestamp, topic: item.meta.topic, project: item.meta.project, session_id: item.meta.session_id, importance: item.meta.importance } }
  assert.equal(archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, archive_id: reordered.archive_id, content: reordered.content, meta: reordered.meta }), item.digest)
  assert.notEqual(makeItem({ content: '换了正文' }).digest, item.digest)
})

test('the request envelope is validated before anything is written', () => {
  assert.throws(() => readArchiveRequest(makeRequest([makeItem()], { subjectId: 'not-a-subject' }), { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_ENVELOPE_INVALID')
  assert.throws(() => readArchiveRequest(makeRequest([makeItem()]), { subjectId: OTHER }), error => error.code === 'MEMPALACE_ARCHIVE_SUBJECT_MISMATCH')
  assert.throws(() => readArchiveRequest(makeRequest([makeItem()], { schemaVersion: ARCHIVE_SCHEMA_VERSION + 1 }), { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_SCHEMA_UNSUPPORTED')
  assert.throws(() => readArchiveRequest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, items: [] }, { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_ENVELOPE_INVALID')
  const noSource = makeItem(); delete noSource.meta.provenance
  assert.throws(() => readArchiveRequest(makeRequest([noSource]), { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_ENVELOPE_INVALID')
  assert.throws(() => readArchiveRequest(makeRequest([{ ...makeItem(), archive_id: 'arch_bad id_r1' }]), { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_ENVELOPE_INVALID')
  assert.throws(() => readArchiveRequest(makeRequest([{ ...makeItem(), digest: 'Z'.repeat(64) }]), { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_ENVELOPE_INVALID')
  assert.throws(() => readArchiveRequest(makeRequest([{ ...makeItem(), content: '   ' }]), { subjectId: SUBJECT }), error => error.code === 'MEMPALACE_ARCHIVE_ENVELOPE_INVALID')
  assert.throws(() => readArchiveRequest(makeRequest(Array.from({ length: 3 }, (_, index) => makeItem({ archiveId: `arch_mem_${index}_r1` }))), { subjectId: SUBJECT, limits: { maxItems: 2 } }), error => error.code === 'MEMPALACE_ARCHIVE_BATCH_TOO_LARGE')
  assert.throws(() => readArchiveRequest(makeRequest([makeItem({ content: '字'.repeat(50_000) })]), { subjectId: SUBJECT, limits: { maxContentChars: 40_000 } }), error => error.code === 'MEMPALACE_ARCHIVE_BATCH_TOO_LARGE')
  assert.match(ARCHIVE_ID_PATTERN.source, /_r\\d/)
  assert.equal(ARCHIVE_ID_PATTERN.test('arch_mem_a_r12'), true)
  assert.equal(ARCHIVE_ID_PATTERN.test('arch_mem_a_12'), false)
  assert.equal(ARCHIVE_SOURCE, 'actmem-archive')
})

test('commit is idempotent by archive_id + digest and never trusts a self-declared digest', async () => {
  const item = makeItem()
  const store = makeStore()
  const first = await commitArchive(store, { subjectId: SUBJECT, items: [item], now: Date.parse('2026-02-01T00:00:00.000Z') })
  assert.equal(first.results[0].state, 'archived')
  assert.deepEqual(first.results[0].receipt, { archive_id: item.archive_id, digest: item.digest, memory_ids: ['arc_x_c0'], chunks: 1, subject_id: SUBJECT, received_at: '2026-02-01T00:00:00.000Z' })
  assert.equal(store.inserts.length, 1)

  const replay = await commitArchive(store, { subjectId: SUBJECT, items: [item] })
  assert.equal(replay.results[0].state, 'duplicate')
  assert.equal(replay.results[0].receipt.digest, item.digest)
  assert.equal(store.inserts.length, 1)

  const changed = { ...item, content: '改写过的正文', digest: archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, archive_id: item.archive_id, content: '改写过的正文', meta: item.meta }) }
  const conflict = await commitArchive(store, { subjectId: SUBJECT, items: [changed] })
  assert.equal(conflict.results[0].state, 'conflict')
  assert.equal(conflict.results[0].code, 'MEMPALACE_ARCHIVE_DIGEST_CONFLICT')
  assert.equal(store.inserts.length, 1)

  const forged = { ...item, digest: '0'.repeat(64) }
  const rejected = await commitArchive(store, { subjectId: SUBJECT, items: [forged] })
  assert.equal(rejected.results[0].state, 'rejected')
  assert.equal(rejected.results[0].code, 'MEMPALACE_ARCHIVE_DIGEST_MISMATCH')
  assert.equal(store.inserts.length, 1)
})

test('a batch keeps per-item outcomes and rows that disagree are reported, not hidden', async () => {
  const good = makeItem()
  const bad = { ...makeItem({ archiveId: 'arch_mem_b_r1' }), digest: '0'.repeat(64) }
  const store = makeStore()
  const results = (await commitArchive(store, { subjectId: SUBJECT, items: [good, bad] })).results
  assert.deepEqual(results.map(result => result.state), ['archived', 'rejected'])
  assert.equal(store.inserts.length, 1)

  const corrupt = new Map([['arch_mem_c_r1', { archive_id: 'arch_mem_c_r1', conflict: true, digests: ['a', 'b'] }]])
  const outcome = (await commitArchive(makeStore(corrupt), { subjectId: SUBJECT, items: [{ ...makeItem({ archiveId: 'arch_mem_c_r1' }) }] })).results[0]
  assert.equal(outcome.state, 'conflict')
  assert.equal(outcome.code, 'MEMPALACE_ARCHIVE_ROWS_INCONSISTENT')
})

test('status lookup answers by archive_id so recovery can check before writing', async () => {
  const item = makeItem()
  const store = makeStore(new Map([['arch_mem_a_r1', { archive_id: 'arch_mem_a_r1', digest: item.digest, subject_id: SUBJECT, memory_ids: ['arc_x_c0'], chunks: 1 }]]))
  const states = (await queryArchive(store, { archiveIds: [item.archive_id, 'arch_mem_missing_r1', item.archive_id] })).states
  assert.deepEqual(states, [
    { archive_id: item.archive_id, state: 'archived', digest: item.digest, memory_ids: ['arc_x_c0'], chunks: 1 },
    { archive_id: 'arch_mem_missing_r1', state: 'absent' },
  ])
  const inconsistent = await queryArchive(makeStore(new Map([['arch_mem_d_r1', { archive_id: 'arch_mem_d_r1', conflict: true }]])), { archiveIds: ['arch_mem_d_r1'] })
  assert.equal(inconsistent.states[0].state, 'conflict')
  assert.throws(() => queryArchive(store, { archiveIds: Array.from({ length: 3 }, (_, index) => `arch_mem_${index}_r1`) }, { limits: { maxIds: 2 } }), error => error.code === 'MEMPALACE_ARCHIVE_BATCH_TOO_LARGE')
})

test('store failures stay unknown instead of becoming per-item rejections', async () => {
  const store = {
    async findArchiveById() { return null },
    async insertArchive() { throw new Error('db locked') },
  }
  await assert.rejects(
    () => commitArchive(store, { subjectId: SUBJECT, items: [makeItem()] }),
    /db locked/,
  )
})

test('the request envelope keeps only the signed fields', () => {
  const item = { ...makeItem(), subject_id: SUBJECT, source: 'auto-capture', extra: 'ignored' }
  const request = readArchiveRequest({ ...makeRequest([item]), token: 'ignored', extra: 'ignored' }, { subjectId: SUBJECT })
  assert.deepEqual(Object.keys(request).sort(), ['items', 'schemaVersion', 'subjectId'])
  assert.deepEqual(Object.keys(request.items[0]).sort(), ['archive_id', 'content', 'digest', 'meta'])
  assert.equal(request.items[0].extra, undefined)
  assert.equal(request.items[0].source, undefined)
})
