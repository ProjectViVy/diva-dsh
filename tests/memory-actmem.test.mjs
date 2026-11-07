import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { resolveSubject, subjectFromEnv } from '../plugins/_shared/subject.mjs'
import { createEmptyCard, addMemoryRecord, ingestBiliEntries, mergeMemories, normalizeCard } from '../plugins/memory/src/card-engine.mjs'
import { ACTMEM_SCHEMA_VERSION, anchorCard, bumpRevision, inspectActMem, readRelations } from '../plugins/memory/src/actmem.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'
import { callComponent } from '../plugins/_shared/ipc.mjs'

export const SUBJECT = 'subject_11111111-1111-4111-8111-111111111111'
export const OTHER = 'subject_22222222-2222-4222-8222-222222222222'

function fixture(t, prefix = 'memory-actmem-') {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the subject comes from DSH_SUBJECT_ID and a malformed value fails closed', () => {
  assert.equal(subjectFromEnv({ DSH_SUBJECT_ID: SUBJECT }), SUBJECT)
  assert.equal(subjectFromEnv({}), undefined)
  assert.throws(() => subjectFromEnv({ DSH_SUBJECT_ID: 'subject_not-a-uuid' }), error => error.code === 'SUBJECT_UNAVAILABLE')
  assert.throws(() => subjectFromEnv({ DSH_SUBJECT_ID: OTHER.replace('subject_', '') }), error => error.code === 'SUBJECT_UNAVAILABLE')
})

test('without env or a management port the resolver refuses to invent a subject', async () => {
  await assert.rejects(resolveSubject({ env: {}, webServer: null }), error => error.code === 'SUBJECT_UNAVAILABLE')
})

test('the resolver reads the Superagent subject API with the loopback management header', async t => {
  const headers = []
  const server = createServer((req, res) => {
    headers.push({ path: req.url, host: req.headers.host, marker: req.headers['x-orchestrator-request'] })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ subjectId: SUBJECT, displayName: 'Vivy', createdAt: '2026-11-03T00:00:00.000Z', schemaVersion: 1 }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  assert.equal(await resolveSubject({ env: {}, webServer: { port: server.address().port }, attempts: 1 }), SUBJECT)
  assert.deepEqual(headers, [{ path: '/orchestrator/api/subject', host: `127.0.0.1:${server.address().port}`, marker: '1' }])
})

test('the resolver retries a startup race and then fails closed', async () => {
  let calls = 0
  const fetched = []
  const flaky = async url => {
    fetched.push(url)
    calls += 1
    if (calls < 3) throw new Error('starting')
    return { ok: true, json: async () => ({ subjectId: SUBJECT }) }
  }
  assert.equal(await resolveSubject({ env: {}, webServer: { port: 3082 }, fetchImpl: flaky, attempts: 3, delayMs: 0 }), SUBJECT)
  assert.equal(fetched.length, 3)
  await assert.rejects(resolveSubject({ env: {}, webServer: { port: 3082 }, fetchImpl: async () => { throw new Error('offline') }, attempts: 2, delayMs: 0 }), error => error.code === 'SUBJECT_UNAVAILABLE')
  await assert.rejects(resolveSubject({ env: {}, webServer: { port: 3082 }, fetchImpl: async () => ({ ok: true, json: async () => ({ subjectId: 'nope' }) }), attempts: 1 }), error => error.code === 'SUBJECT_UNAVAILABLE')
})

test('relations accept only known types and existing targets stay the caller’s job', () => {
  assert.deepEqual(readRelations([{ type: 'related', targetId: 'mem_a' }, { type: 'bogus', targetId: 'x' }, { type: 'related', targetId: 'mem_a' }]),
    [{ type: 'related', targetId: 'mem_a' }])
  assert.throws(() => readRelations([{ type: 'bogus', targetId: 'x' }], { strict: true }), error => error.code === 'ACTMEM_RELATION_INVALID')
})

test('a card anchors its subject once and stamps legacy records without inventing provenance', () => {
  const card = createEmptyCard()
  card.records.push({ id: 'mem_legacy', text: '旧记录', title: '旧记录', source: 'qq', createdAt: '2026-01-01T00:00:00.000Z' })
  const inspection = inspectActMem(card, SUBJECT)
  assert.deepEqual(inspection, { anchored: false, legacyRecords: 1 })
  anchorCard(card, { subjectId: SUBJECT, now: 1_000 })
  assert.equal(card.meta.actmem.subjectId, SUBJECT)
  assert.equal(card.meta.actmem.schemaVersion, ACTMEM_SCHEMA_VERSION)
  assert.equal(card.meta.actmem.migratedAt, new Date(1_000).toISOString())
  assert.equal(card.records[0].subjectId, SUBJECT)
  assert.equal(card.records[0].revision, 1)
  assert.equal(card.records[0].provenance, null)
  assert.deepEqual(card.records[0].relations, [])
})

test('foreign subjects and newer ActMem schemas are rejected before any write', () => {
  const card = createEmptyCard()
  anchorCard(card, { subjectId: SUBJECT })
  assert.throws(() => inspectActMem(card, OTHER), error => error.code === 'ACTMEM_SUBJECT_MISMATCH')
  card.meta.actmem.schemaVersion = ACTMEM_SCHEMA_VERSION + 1
  assert.throws(() => inspectActMem(card, SUBJECT), error => error.code === 'ACTMEM_SCHEMA_UNSUPPORTED')
  card.meta.actmem.schemaVersion = ACTMEM_SCHEMA_VERSION
  card.records.push({ id: 'mem_foreign', subjectId: OTHER, text: '别人的记忆', revision: 1 })
  assert.throws(() => inspectActMem(card, SUBJECT), error => error.code === 'ACTMEM_SUBJECT_MISMATCH')
})

test('the single record entry stamps subject, revision, provenance and survives a duplicate write', () => {
  const card = createEmptyCard()
  anchorCard(card, { subjectId: SUBJECT })
  const first = addMemoryRecord(card, { source: 'qq', sourceId: 'm1', text: '一起看星星', isOwner: true })
  assert.equal(first.added, true)
  assert.equal(first.record.subjectId, SUBJECT)
  assert.equal(first.record.revision, 1)
  assert.equal(first.record.provenance.source, 'qq')
  assert.equal(first.record.provenance.externalId, 'm1')
  const again = addMemoryRecord(card, { source: 'qq', sourceId: 'm1', text: '一起看星星', isOwner: true })
  assert.equal(again.added, false)
  assert.equal(again.record.revision, 1)
  assert.equal(card.records.length, 1)
  assert.equal(bumpRevision(again.record), 2)
})

test('Bilibili video entries carry explicit ActMem provenance', () => {
  const card = createEmptyCard()
  anchorCard(card, { subjectId: SUBJECT })
  ingestBiliEntries(card, [{ id: 'bv1', type: 'video', title: '公开视频' }], {}, 1_000)
  const record = card.records.find(item => item.provenance?.externalId === 'bv1')
  assert.ok(record)
  assert.equal(record.provenance.source, 'bili-video')
  assert.equal(record.provenance.externalId, 'bv1')
})

test('a merge records merged-from relations and creates the event at revision 1', () => {
  const card = createEmptyCard()
  anchorCard(card, { subjectId: SUBJECT })
  const a = addMemoryRecord(card, { source: 'qq', sourceId: 'a', text: '第一段记忆', isOwner: true }).record
  const b = addMemoryRecord(card, { source: 'qq', sourceId: 'b', text: '第二段记忆', isOwner: true }).record
  const merged = mergeMemories(card, [a.id, b.id], { now: Date.now() })
  assert.equal(merged.ok, true)
  assert.equal(merged.event.revision, 1)
  assert.deepEqual(merged.event.relations, [{ type: 'merged-from', targetId: a.id }, { type: 'merged-from', targetId: b.id }])
  assert.equal(normalizeCard(card).records.find(record => record.id === merged.event.id).relations.length, 2)
})

function makeService(t, options = {}) {
  const dir = fixture(t, 'memory-actmem-service-')
  const service = createMemoryService({ stateDir: dir, subject: options.subject ?? (async () => SUBJECT) })
  return { dir, service }
}

test('recording the same external event twice is idempotent and keeps revision 1', async t => {
  const { service } = makeService(t)
  const event = { id: 'qq-1', platform: 'qq', kind: 'private', isOwner: true, text: '一起看星星' }
  assert.equal((await service.record(event)).duplicate, false)
  assert.equal((await service.record(event)).duplicate, true)
  const records = (await service.snapshot()).records
  assert.equal(records.length, 1)
  assert.equal(records[0].subjectId, SUBJECT)
  assert.equal(records[0].revision, 1)
  assert.equal(records[0].provenance.externalId, 'qq-1')
})

test('an effective edit bumps revision, an ineffective edit does not, and a stale expectedRevision conflicts', async t => {
  const { service } = makeService(t)
  await service.action('add', { text: '需要修改的记忆' })
  const record = (await service.snapshot()).records[0]
  assert.equal(record.revision, 1)
  assert.equal((await service.action('pin', { id: record.id, pinned: true })).revision, 2)
  assert.equal((await service.action('pin', { id: record.id, pinned: true })).revision, 2)
  const updated = await service.action('update', { id: record.id, text: '修改后的记忆', expectedRevision: 2 })
  assert.equal(updated.revision, 3)
  assert.equal((await service.action('update', { id: record.id, text: '修改后的记忆', expectedRevision: 3 })).revision, 3)
  await assert.rejects(service.action('update', { id: record.id, text: '基于旧版本', expectedRevision: 2 }), error => error.code === 'ACTMEM_REVISION_CONFLICT')
})

test('decay and recall do not bump revision', async t => {
  const { service } = makeService(t)
  await service.action('add', { text: '一起看过的星星' })
  const before = (await service.snapshot()).records[0].revision
  await service.maintenance(new Date('2030-01-02T12:00:00').getTime())
  assert.equal((await service.snapshot()).records[0].revision, before)
  await service.record({ id: 'recall-1', platform: 'qq', kind: 'private', text: '今天又想起一起看过的星星' })
  assert.equal((await service.snapshot()).records.find(record => record.text.includes('一起看过的星星')).revision, before)
})

test('records, updates and restores from another subject are rejected', async t => {
  const { dir, service } = makeService(t)
  await service.action('add', { text: '属于主体一的记忆' })
  const other = createMemoryService({ stateDir: dir, subject: async () => OTHER })
  await assert.rejects(other.action('add', { text: '主体二写入' }), error => error.code === 'ACTMEM_SUBJECT_MISMATCH')
  await assert.rejects(other.record({ id: 'foreign', platform: 'qq', text: '主体二事件' }), error => error.code === 'ACTMEM_SUBJECT_MISMATCH')
  await assert.rejects(service.record({ id: 'foreign-2', platform: 'qq', text: '冒名事件', subjectId: OTHER }), error => error.code === 'ACTMEM_SUBJECT_MISMATCH')
  await service.maintenance()
  const backup = (await service.backups())[0]
  const fresh = fixture(t, 'memory-actmem-restore-')
  mkdirSync(join(fresh, 'backups'), { recursive: true })
  writeFileSync(join(fresh, 'backups', backup), readFileSync(join(dir, 'backups', backup)))
  const restored = createMemoryService({ stateDir: fresh, subject: async () => OTHER })
  await assert.rejects(restored.restore(backup), error => error.code === 'ACTMEM_SUBJECT_MISMATCH')
})

test('a legacy card migrates once on the first write and keeps a pre-migration backup', async t => {
  const dir = fixture(t, 'memory-actmem-legacy-')
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(join(dir, 'data', 'memory-card.json'), JSON.stringify({
    version: 1, records: [
      { id: 'mem_a', source: 'qq', text: '旧记忆一', title: '旧记忆一', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'mem_b', source: 'bili', text: '旧记忆二', title: '旧记忆二', createdAt: '2026-01-02T00:00:00.000Z' },
    ],
  }))
  const service = createMemoryService({ stateDir: dir, subject: async () => SUBJECT })
  await service.action('add', { text: '迁移后的新记忆' })
  const card = JSON.parse(readFileSync(join(dir, 'data', 'memory-card.json'), 'utf8'))
  assert.equal(card.meta.actmem.subjectId, SUBJECT)
  assert.ok(card.meta.actmem.migratedAt)
  assert.ok(card.records.every(record => record.subjectId === SUBJECT && record.revision >= 1))
  const backups = await service.backups()
  assert.equal(backups.length, 2)
  const preMigration = backups.map(name => JSON.parse(readFileSync(join(dir, 'backups', name), 'utf8'))).find(value => !value.meta?.actmem)
  assert.ok(preMigration)
  assert.equal(preMigration.records.length, 2)
  await service.action('add', { text: '第二次写入' })
  assert.equal((await service.backups()).length, 3)
  assert.equal(JSON.parse(readFileSync(join(dir, 'data', 'memory-card.json'), 'utf8')).meta.actmem.migratedAt, card.meta.actmem.migratedAt)
})

test('ActMem status and update are reachable through authenticated IPC with error hints', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-actmem-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: join(home, 'memory'), subject: async () => SUBJECT })
  let handler
  const stop = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(stop)
  const fetchImpl = async (url, options) => {
    const req = Readable.from(options.body ? [options.body] : [])
    Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let statusCode = 200, data
    await handler(req, { writeHead: code => { statusCode = code }, end: value => { data = value } })
    return new Response(data, { status: statusCode })
  }
  const call = (path, body) => callComponent({ home, name: 'memory', path, body, fetchImpl })
  const status = await call('/actmem/status')
  assert.equal(status.ok, true)
  assert.equal(status.cardSubjectId, null)
  await service.action('add', { text: '通过 IPC 更新的记忆' })
  const record = (await service.snapshot()).records[0]
  assert.equal((await call('/actmem/status')).cardSubjectId, SUBJECT)
  assert.equal((await call('/actmem/update', { id: record.id, text: 'IPC 更新后的记忆', expectedRevision: 1 })).revision, 2)
  await assert.rejects(call('/actmem/update', { id: record.id, text: '冲突', expectedRevision: 1 }),
    error => error.code === 'ACTMEM_REVISION_CONFLICT' && Boolean(error.hint))
})

test('the public action route exposes update and the facade delegates to the same entry', async t => {
  const { service } = makeService(t)
  await service.action('add', { text: '面板可修改的记忆' })
  const record = (await service.snapshot()).records[0]
  assert.equal((await service.actmem.update({ id: record.id, text: '面板修改后的记忆', expectedRevision: 1 })).revision, 2)
  assert.equal((await service.actmem.status()).cardSubjectId, SUBJECT)
  assert.equal((await service.actmem.snapshot()).records[0].text, '面板修改后的记忆')
})
