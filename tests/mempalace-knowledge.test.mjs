import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'
import { EMBEDDING_DIM } from '../plugins/dsh-mempalace/src/store/chunk.mjs'
import { MempalaceService } from '../plugins/dsh-mempalace/src/service.mjs'
import { resolveConfig } from '../plugins/dsh-mempalace/src/config.mjs'
import { createTools } from '../plugins/dsh-mempalace/src/tools.mjs'
import { commitKeyFor, evaluateKnowledgeChecks } from '../plugins/dsh-mempalace/src/knowledge/checks.mjs'

const pluginDir = fileURLToPath(new URL('../plugins/dsh-mempalace/', import.meta.url))
const nativeReady = existsSync(join(pluginDir, 'node_modules/better-sqlite3'))
  && existsSync(join(pluginDir, 'node_modules/sqlite-vec'))
const silent = { warn() {}, info() {}, error() {} }
const CHECKS = { provenance: true, conflict: true, integrity: true, retrieval: true }
const scope = 'knowledge:conflict:vivy'
const upsert = { op: 'upsert_triple', subject: 'Alice', predicate: 'likes', object: 'tea', project: 'persona:vivy:soul' }

function tempDir(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'knowledge-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}
async function openStore(t) {
  const store = new MemoryStore({ memoryDir: tempDir(t), embed: async () => new Float32Array(EMBEDDING_DIM), logger: silent })
  await store.open()
  t.after(() => store.close())
  return store
}
const SUBJECT_ID = 'subject_11111111-1111-1111-1111-111111111111'
async function openService(t) {
  const service = new MempalaceService({
    stateDir: tempDir(t),
    config: resolveConfig({}, {}),
    logger: silent,
    subject: async () => SUBJECT_ID,
  })
  t.after(() => service.dispose())
  await service.ready()
  return service
}
const ledgerRows = store => store.db
  .prepare('SELECT revision, state, ops, inverse FROM knowledge_commits ORDER BY revision').all()
const rowEntry = (rows, revision) => rows.find(row => Number(row.revision) === revision)
const request = (subjectId, commitKey, expectedRevision, ops, checks = CHECKS) =>
  ({ subjectId, assetScope: scope, commitKey, expectedRevision, ops, checks })
const active = (store, object) => store.queryEntity('Alice').facts.find(fact => fact.predicate === 'likes' && fact.object === object && fact.valid_to === null)
const fact = (store, object) => store.queryEntity('Alice').facts.find(item => item.predicate === 'likes' && item.object === object)

test('a knowledge commit stores one live revision with a digest', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  const result = store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  assert.equal(result.revision, 1)
  assert.match(result.digest, /^[0-9a-f]{64}$/)
  assert.equal(store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits[0].state, 'live')
  assert.ok(active(store, 'tea'))
})

test('the same commit key replays the first revision and never writes twice', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  const first = store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  const replay = store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  assert.deepEqual(replay, first)
  assert.equal(store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits.length, 1)
  assert.throws(() => store.commitKnowledge(request('subject_a', 'k1', 0, [{ ...upsert, object: 'coffee' }])),
    error => error.code === 'MEMPALACE_KNOWLEDGE_CONFLICT')
})

test('a commit compares and swaps on the expected revision', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  assert.throws(() => store.commitKnowledge(request('subject_a', 'k2', 0, [upsert])),
    error => error.code === 'MEMPALACE_KNOWLEDGE_REVISION')
  assert.equal(store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits.length, 1)
})

test('every required check must pass before a commit is applied', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  assert.throws(() => store.commitKnowledge(request('subject_a', 'k1', 0, [upsert], { ...CHECKS, retrieval: false })),
    error => error.code === 'MEMPALACE_KNOWLEDGE_CHECKS')
  assert.equal(store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits.length, 0)
  assert.equal(active(store, 'tea'), undefined)
})

test('invalidation and rollback change only validity, never delete history', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  const id = fact(store, 'tea').id
  const second = store.commitKnowledge(request('subject_a', 'k2', 1, [{ op: 'invalidate_triple', tripleId: id }]))
  assert.equal(second.revision, 2)
  assert.equal(active(store, 'tea'), undefined)
  const rolled = store.rollbackKnowledge({ subjectId: 'subject_a', assetScope: scope, commitKey: 'r1', targetRevision: 1 })
  assert.equal(rolled.revision, 3)
  assert.equal(rolled.restoresRevision, 1)
  assert.ok(active(store, 'tea'))
  assert.equal(store.rollbackKnowledge({ subjectId: 'subject_a', assetScope: scope, commitKey: 'r1', targetRevision: 1 }).revision, 3,
    'the same rollback key and target replays instead of writing twice')
  assert.throws(() => store.rollbackKnowledge({ subjectId: 'subject_a', assetScope: scope, commitKey: 'r1', targetRevision: 0 }),
    error => error.code === 'MEMPALACE_KNOWLEDGE_CONFLICT', 'a reused rollback key may not restore another revision')
  assert.throws(() => store.rollbackKnowledge({ subjectId: 'subject_a', assetScope: scope, commitKey: 'r2', targetRevision: 0 }),
    error => error.code === 'MEMPALACE_KNOWLEDGE_TARGET')
})

test('rolling back to zero revokes every commit in the range', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  const id = fact(store, 'tea').id
  store.commitKnowledge(request('subject_a', 'k2', 1, [{ op: 'invalidate_triple', tripleId: id }]))
  const rolled = store.rollbackKnowledge({ subjectId: 'subject_a', assetScope: scope, commitKey: 'r1', targetRevision: 0 })
  assert.equal(rolled.restoresRevision, 0)
  assert.equal(active(store, 'tea'), undefined)
  const status = store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope })
  assert.equal(status.commits.length, 3)
  assert.equal(status.commits.filter(commit => commit.state === 'live').length, 1)
})

test('status can resolve commit keys for unknown-outcome reconciliation', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  const first = store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  const status = store.knowledgeStatus({ subjectId: 'subject_a', commitKeys: ['k1', 'missing'] })
  assert.deepEqual(status.commits.map(commit => commit.commitKey), ['k1'])
  assert.equal(status.commits[0].revision, first.revision)
})

test('an omitted expected revision tracks the head revision', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  const unanchored = commitKey => ({ subjectId: 'subject_a', assetScope: scope, commitKey, ops: [upsert], checks: CHECKS })
  assert.equal(store.knowledgeHeadRevision({ subjectId: 'subject_a', assetScope: scope }), 0)
  const first = store.commitKnowledge(unanchored('k1'))
  assert.equal(first.revision, 1)
  assert.equal(store.knowledgeHeadRevision({ subjectId: 'subject_a', assetScope: scope }), 1)
  const second = store.commitKnowledge(unanchored('k2'))
  assert.equal(second.revision, 2, 'an omitted anchor follows the live head instead of hard-coding zero')
  assert.equal(store.knowledgeHeadRevision({ subjectId: 'subject_a', assetScope: scope }), 2)
  // An explicit anchor is still compared strictly.
  assert.throws(() => store.commitKnowledge({ ...unanchored('k3'), expectedRevision: 0 }),
    error => error.code === 'MEMPALACE_KNOWLEDGE_REVISION')
  assert.throws(() => store.commitKnowledge({ ...unanchored('k4'), expectedRevision: -1 }),
    error => error.code === 'MEMPALACE_KNOWLEDGE_INVALID')
  assert.throws(() => store.knowledgeHeadRevision({ subjectId: '', assetScope: scope }),
    error => error.code === 'MEMPALACE_KNOWLEDGE_INVALID')
  assert.equal(store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits.length, 2)
})

test('a reused commit key with different content writes nothing', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  store.commitKnowledge(request('subject_a', 'k1', 0, [upsert]))
  const before = store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits.length
  assert.throws(() => store.commitKnowledge(request('subject_a', 'k1', 0, [{ ...upsert, object: 'coffee' }])),
    error => error.code === 'MEMPALACE_KNOWLEDGE_CONFLICT')
  assert.equal(store.knowledgeStatus({ subjectId: 'subject_a', assetScope: scope }).commits.length, before)
  assert.equal(active(store, 'coffee'), undefined)
})

test('commit keys are namespaced under kg: and stable per payload', () => {
  const op = { op: 'upsert_triple', subject: 'Alice', predicate: 'likes', object: 'tea' }
  const key = commitKeyFor({ subjectId: 'subject_a', assetScope: scope, op })
  assert.match(key, /^kg:/)
  assert.ok(!key.startsWith('evo:'), 'the kg: namespace stays isolated from evolution keys')
  assert.equal(key, commitKeyFor({ subjectId: 'subject_a', assetScope: scope, op: { ...op } }))
  assert.notEqual(key, commitKeyFor({ subjectId: 'subject_a', assetScope: scope, op: { ...op, object: 'coffee' } }))
})

test('knowledge checks evaluate to four booleans', () => {
  const checks = evaluateKnowledgeChecks({ op: { op: 'upsert_entity', entityId: 'ent_1', name: 'Alice' }, provenance: { source: 'panel' } })
  assert.deepEqual(Object.keys(checks).sort(), ['conflict', 'integrity', 'provenance', 'retrieval'])
  for (const value of Object.values(checks)) assert.equal(typeof value, 'boolean')
  assert.ok(Object.values(checks).every(Boolean), 'a well-formed write passes every check')
  const broken = evaluateKnowledgeChecks({ op: { op: 'upsert_entity' } })
  assert.equal(broken.integrity, false, 'an entity op without a name fails integrity')
  assert.equal(evaluateKnowledgeChecks({ op: { op: 'teleport' } }).conflict, false, 'an unknown op fails conflict')
})

test('service writes entities, triples and invalidations through one ledger', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const service = await openService(t)
  const entity = await service.addEntity({ name: 'Alice', entity_type: 'person', properties: { role: 'dev' } })
  assert.equal(entity.status, 'created')
  assert.equal(entity.revision, 1)
  const triple = await service.addTriple({ subject: 'Alice', predicate: 'likes', object: 'tea', project: 'persona:vivy:soul' })
  assert.equal(triple.revision, 2)
  assert.equal(typeof triple.id, 'number')
  const invalidated = await service.invalidateFact('Alice', 'likes', 'tea')
  assert.equal(invalidated.status, 'invalidated')
  assert.equal(invalidated.revision, 3)

  const rows = ledgerRows(service.store)
  assert.deepEqual(rows.map(row => Number(row.revision)), [1, 2, 3])
  assert.equal(JSON.parse(rowEntry(rows, 1).ops)[0].op, 'upsert_entity')
  assert.equal(JSON.parse(rowEntry(rows, 1).inverse)[0].op, 'restore_entity')
  assert.equal(JSON.parse(rowEntry(rows, 2).ops)[0].op, 'upsert_triple')
  assert.equal(JSON.parse(rowEntry(rows, 3).ops)[0].op, 'invalidate_triple')
  assert.equal(rows.filter(row => row.state === 'live').length, 1)

  const updated = await service.addEntity({ name: 'Alice', entity_type: 'engineer' })
  assert.equal(updated.status, 'updated')
  assert.equal(updated.revision, 4)
  const updateRow = rowEntry(ledgerRows(service.store), 4)
  assert.equal(JSON.parse(updateRow.ops)[0].op, 'set_entity')
  assert.equal(JSON.parse(updateRow.inverse)[0].op, 'restore_entity')

  const ledger = await service.listKnowledgeCommits({})
  assert.equal(ledger.commits.length, 4)
  assert.equal(ledger.commits[0].revision, 4)
})

test('knowledge tools write through the ledger and report the revision', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const service = await openService(t)
  const definitions = createTools(service)
  const add = definitions.find(tool => tool.name === 'knowledge_add')
  const invalidate = definitions.find(tool => tool.name === 'knowledge_invalidate')
  const added = await add.execute({ subject: 'Alice', predicate: 'likes', object: 'tea', project: 'persona:vivy:soul' }, {})
  assert.match(added.text, /r1\b/)
  assert.equal(added.data.revision, 1)
  const ended = await invalidate.execute({ subject: 'Alice', predicate: 'likes', object: 'tea' }, {})
  assert.match(ended.text, /r2\b/)
  assert.equal(ended.data.revision, 2)

  const rows = ledgerRows(service.store)
  assert.equal(JSON.parse(rows[0].ops)[0].op, 'upsert_triple')
  assert.equal(JSON.parse(rows[1].ops)[0].op, 'invalidate_triple')
  assert.equal(rows.length, 2)
})

test('lists knowledge commits newest first with scope and limit filters', { skip: !nativeReady && 'native mempalace dependencies are not installed' }, async t => {
  const store = await openStore(t)
  const other = 'knowledge:conflict:other'
  const commit = (subjectId, commitKey, expectedRevision, object, assetScope = scope) =>
    store.commitKnowledge({
      subjectId,
      assetScope,
      commitKey,
      expectedRevision,
      ops: [{ op: 'upsert_triple', subject: 'Alice', predicate: 'likes', object, project: 'persona:vivy:soul' }],
      checks: CHECKS,
    })
  commit('subject_a', 'k1', 0, 'first')
  commit('subject_a', 'k2', 0, 'second', other)
  commit('subject_a', 'k3', 1, 'third')
  commit('subject_b', 'k4', 0, 'fourth')

  // Fixed timestamps make created_at, not insertion order, decide the sequence.
  const stamp = (commitKey, createdAt) =>
    store.db.prepare('UPDATE knowledge_commits SET created_at = ? WHERE commit_key = ?').run(createdAt, commitKey)
  stamp('k3', '2026-01-03T00:00:00.000Z')
  stamp('k1', '2026-01-02T00:00:00.000Z')
  stamp('k2', '2026-01-01T00:00:00.000Z')

  const all = store.listKnowledgeCommits({ subjectId: 'subject_a' })
  assert.deepEqual(all.commits.map(commit => commit.commitKey), ['k3', 'k1', 'k2'])
  assert.equal(all.commits[0].revision, 2)
  assert.equal(all.commits[0].state, 'live')
  assert.equal(all.commits[1].state, 'superseded')
  const scoped = store.listKnowledgeCommits({ subjectId: 'subject_a', assetScope: scope })
  assert.deepEqual(scoped.commits.map(commit => commit.commitKey), ['k3', 'k1'])
  const limited = store.listKnowledgeCommits({ subjectId: 'subject_a', limit: 1 })
  assert.deepEqual(limited.commits.map(commit => commit.commitKey), ['k3'])
  assert.deepEqual(store.listKnowledgeCommits({ subjectId: 'subject_b' }).commits.map(commit => commit.commitKey), ['k4'])
  assert.deepEqual(store.listKnowledgeCommits({ subjectId: 'subject_a', assetScope: '' }).commits.length, 3)

  // Equal timestamps fall back to rowid, newest insert first.
  stamp('k2', '2026-01-02T00:00:00.000Z')
  assert.deepEqual(store.listKnowledgeCommits({ subjectId: 'subject_a' }).commits.map(commit => commit.commitKey),
    ['k3', 'k2', 'k1'])

  assert.throws(() => store.listKnowledgeCommits({ subjectId: '' }),
    error => error.code === 'MEMPALACE_KNOWLEDGE_INVALID')
})
