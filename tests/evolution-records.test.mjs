import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

import {
  APPEND_TRIGGERS,
  CANONICAL_LIMIT_BYTES,
  CANDIDATE_KINDS,
  CANDIDATE_OWNERS,
  DERIVED_ONLY_SOURCES,
  DOMAIN_TRIGGERS,
  EVOLUTION_APPLICATION_ID,
  EVOLUTION_CODES,
  EVOLUTION_SCHEMA_VERSION,
  EVIDENCE_SOURCES,
  EvolutionRecordError,
  MAX_PAGE_LIMIT,
  MIN_SUPPORTED_SCHEMA,
  OWNERS,
  PROPOSAL_TRANSITIONS,
  PUBLICATION_TRANSITIONS,
  TICKET_SQL,
  assertAllowedTransition,
  assertCandidateOwnerPair,
  assertChecksCovered,
  assertEvidenceSource,
  backupDatabase,
  canonicalJson,
  createLazyEvolutionStore,
  deriveRecordId,
  digestOf,
  fromSqlite,
  loadSqliteModule,
  openEvolutionStore,
  ownerAllowsPublish,
  resolveEvolutionPaths,
} from '../plugins/dsh-evolution/src/records.mjs'
import { registerEvolutionHttp } from '../plugins/dsh-evolution/src/http.mjs'

const SUBJECT = 'subject_2f6a5e4b-1c2d-4e5f-8a9b-0c1d2e3f4a5b'

/** Run `fn` and assert it fails with this exact code plus an operator hint. */
function rejectsCode(code, fn, what) {
  let thrown
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, `${what ?? code}: expected a failure`)
  assert.ok(thrown instanceof EvolutionRecordError, `expected an EvolutionRecordError, got ${thrown.name}: ${thrown.message}`)
  assert.equal(thrown.code, code, `expected ${code}, got ${thrown.code}: ${thrown.message}`)
  assert.ok(typeof thrown.hint === 'string' && thrown.hint.length > 0, `${code} must carry an operator hint`)
}

test('canonical JSON sorts object keys and keeps array order', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } }),
    '{"a":{"c":[3,{"e":2,"f":1}],"d":2},"b":1}')
  assert.equal(canonicalJson({ a: 1, b: 2 }), canonicalJson({ b: 2, a: 1 }))
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]))
  assert.equal(canonicalJson(null), 'null')
  assert.equal(canonicalJson('x'), '"x"')
})

test('digests are content addressed and only non-JSON values are rejected', () => {
  assert.match(digestOf({ a: 1 }), /^[0-9a-f]{64}$/)
  assert.equal(digestOf({ a: 1, b: 'z' }), digestOf({ b: 'z', a: 1 }))
  assert.notEqual(digestOf({ a: 1 }), digestOf({ a: '1' }))
  assert.equal(digestOf({ a: undefined, b: 1 }), digestOf({ b: 1 }), 'undefined members drop like JSON.stringify')
  for (const bad of [new Set([1]), 10n, () => 1, Symbol('s')]) {
    rejectsCode('EVOLUTION_INVALID_RECORD', () => digestOf({ v: bad }), `rejects ${String(bad)}`)
  }
  rejectsCode('EVOLUTION_INVALID_RECORD', () => digestOf(Number.NaN), 'rejects NaN')
})

test('canonical JSON honors a configurable byte limit and never a hidden smaller one', () => {
  assert.equal(CANONICAL_LIMIT_BYTES, 256 * 1024)
  const body = { blob: 'x'.repeat(5000) }
  assert.equal(canonicalJson(body), JSON.stringify(body))
  rejectsCode('EVOLUTION_LIMIT_EXCEEDED', () => canonicalJson(body, { maxBytes: 1024 }), 'over the given limit')
  rejectsCode('EVOLUTION_LIMIT_EXCEEDED', () => canonicalJson({ blob: 'x'.repeat(CANONICAL_LIMIT_BYTES) }), 'over the default limit')
})

test('record ids are derived from identity only and carry no timestamp', () => {
  const identity = { subjectId: SUBJECT, ticketId: 'T-1', candidateDigest: digestOf({ a: 1 }) }
  const first = deriveRecordId('prop', identity)
  const second = deriveRecordId('prop', { candidateDigest: identity.candidateDigest, ticketId: identity.ticketId, subjectId: identity.subjectId })
  assert.match(first, /^prop_[0-9a-f]{32}$/)
  assert.equal(first, second, 'key order must not change the id')
  assert.notEqual(first, deriveRecordId('prop', { ...identity, ticketId: 'T-2' }))
  assert.notEqual(deriveRecordId('prop', { a: 1 }), deriveRecordId('val', { a: 1 }), 'the prefix is part of the id')
  assert.match(deriveRecordId('ev', identity), /^ev_[0-9a-f]{32}$/)
})

test('evidence sources are whitelisted and derived material must cite its origin', () => {
  for (const source of ['dsh_session', 'superagent_ticket', 'superagent_receipt', 'user_feedback',
    'actmem_change', 'mempalace_conflict', 'skill_invocation']) {
    assert.deepEqual(assertEvidenceSource(source, { derivedFrom: [] }), { source, derived: false })
  }
  assert.deepEqual(DERIVED_ONLY_SOURCES, ['recap', 'dream', 'model_self_review'])
  for (const source of DERIVED_ONLY_SOURCES) {
    assert.deepEqual(assertEvidenceSource(source, { derivedFrom: ['ev_a'] }), { source, derived: true })
    assert.ok(EVIDENCE_SOURCES.includes(source), `${source} must stay in the whitelist`)
    for (const derivedFrom of [undefined, [], null, 'ev_a']) {
      rejectsCode('EVOLUTION_DERIVED_INSUFFICIENT', () => assertEvidenceSource(source, { derivedFrom }), `${source} without derivedFrom`)
    }
  }
  rejectsCode('EVOLUTION_SOURCE_NOT_ALLOWED', () => assertEvidenceSource('model_hunch', { derivedFrom: ['ev_a'] }), 'unknown source')
  rejectsCode('EVOLUTION_SOURCE_NOT_ALLOWED', () => assertEvidenceSource('', { derivedFrom: ['ev_a'] }), 'blank source')
})

test('each candidate kind pairs with exactly one owner', () => {
  const pairs = [['persona', 'laputa'], ['active_memory', 'actmem'], ['long_term_knowledge', 'mempalace'],
    ['skill', 'skill_owner'], ['behaviour_prompt', 'prompt_owner'], ['subagent', 'agent_registry']]
  assert.deepEqual(CANDIDATE_KINDS, pairs.map(([kind]) => kind))
  for (const [kind, owner] of pairs) assert.equal(assertCandidateOwnerPair({ candidateKind: kind, ownerKind: owner }), owner)
  for (const [kind] of pairs) {
    const expected = CANDIDATE_OWNERS[kind]
    const wrong = Object.keys(OWNERS).find(owner => owner !== expected)
    rejectsCode('EVOLUTION_INVALID_RECORD',
      () => assertCandidateOwnerPair({ candidateKind: kind, ownerKind: wrong }), `${kind} with the wrong owner`)
  }
  rejectsCode('EVOLUTION_INVALID_RECORD', () => assertCandidateOwnerPair({ candidateKind: 'persona' }), 'missing owner')
  rejectsCode('EVOLUTION_INVALID_RECORD', () => assertCandidateOwnerPair({ ownerKind: 'laputa' }), 'missing candidate kind')
  rejectsCode('EVOLUTION_INVALID_RECORD', () => assertCandidateOwnerPair({ candidateKind: 'ghost', ownerKind: 'laputa' }), 'unknown kind')
})

test('only owners with versioned writes may publish and each declares its checks', () => {
  assert.deepEqual(Object.keys(OWNERS), ['laputa', 'actmem', 'mempalace', 'skill_owner', 'prompt_owner', 'agent_registry'])
  assert.deepEqual(Object.entries(OWNERS).filter(([, owner]) => owner.versionedWrite).map(([kind]) => kind), ['laputa', 'actmem', 'mempalace'])
  assert.equal(ownerAllowsPublish('laputa'), true)
  assert.equal(ownerAllowsPublish('mempalace'), true)
  assert.equal(ownerAllowsPublish('ghost'), false)
  for (const [owner, spec] of Object.entries(OWNERS)) {
    assert.ok(spec.minChecks.length > 0, `${owner} must declare its minimum checks`)
    assert.ok(spec.ownerRefFields.length > 0, `${owner} must declare its owner reference fields`)
    assert.deepEqual(assertChecksCovered(owner, spec.minChecks), [...spec.minChecks].sort())
    assert.deepEqual(assertChecksCovered(owner, spec.minChecks.map(kind => ({ kind, verdict: 'passed' }))),
      [...spec.minChecks].sort())
    assert.deepEqual(assertChecksCovered(owner, [...spec.minChecks, 'extra']), [...spec.minChecks, 'extra'].sort())
    rejectsCode('EVOLUTION_VALIDATION_INSUFFICIENT', () => assertChecksCovered(owner, []), `${owner} with no checks`)
    rejectsCode('EVOLUTION_VALIDATION_INSUFFICIENT', () => assertChecksCovered(owner, spec.minChecks.slice(1)), `${owner} missing one check`)
    rejectsCode('EVOLUTION_INVALID_RECORD', () => assertChecksCovered('ghost', ['baseline']), 'unknown owner')
  }
  assert.deepEqual(assertChecksCovered('laputa',
    [...OWNERS.laputa.minChecks, OWNERS.laputa.minChecks[0]]), [...OWNERS.laputa.minChecks].sort(), 'checks dedupe')
})

test('the state machines allow the declared transitions and reject the rest', () => {
  assert.deepEqual(PROPOSAL_TRANSITIONS.proposed, ['validating', 'validated', 'rejected'])
  assert.deepEqual(PROPOSAL_TRANSITIONS.validated, ['published', 'rejected', 'superseded'])
  assert.deepEqual(PROPOSAL_TRANSITIONS.published, ['superseded', 'rolled_back'])
  assert.deepEqual(PROPOSAL_TRANSITIONS.rolled_back, ['published'])
  assert.deepEqual(PROPOSAL_TRANSITIONS.superseded, [], 'superseded is terminal')
  assert.deepEqual(PUBLICATION_TRANSITIONS.live, ['superseded', 'rolled_back'])
  assert.deepEqual(PUBLICATION_TRANSITIONS.rolled_back, ['live'])
  assert.deepEqual(PUBLICATION_TRANSITIONS.superseded, [])
  assert.equal(assertAllowedTransition('proposal', 'proposed', 'validated'), 'validated')
  assert.equal(assertAllowedTransition('publication', 'live', 'rolled_back'), 'rolled_back')
  rejectsCode('EVOLUTION_CONFLICT', () => assertAllowedTransition('proposal', 'superseded', 'validated'), 'terminal state')
  rejectsCode('EVOLUTION_CONFLICT', () => assertAllowedTransition('proposal', 'proposed', 'published'), 'skipping validation')
  rejectsCode('EVOLUTION_CONFLICT', () => assertAllowedTransition('publication', 'superseded', 'live'), 'reviving a superseded record')
  rejectsCode('EVOLUTION_INVALID_RECORD', () => assertAllowedTransition('publication', 'ghost', 'live'), 'unknown state')
  rejectsCode('EVOLUTION_INVALID_RECORD', () => assertAllowedTransition('record', 'proposed', 'validated'), 'unknown kind')
})

test('error codes are unique and every evolution code carries the domain prefix', () => {
  for (const code of EVOLUTION_CODES) assert.match(code, /^(?:EVOLUTION|SUBJECT)_[A-Z_]+$/, `${code} must use a domain prefix`)
  assert.equal(new Set(EVOLUTION_CODES).size, EVOLUTION_CODES.length, 'codes must not repeat')
  assert.ok(EVOLUTION_CODES.includes('SUBJECT_UNAVAILABLE'), 'the shared subject code must be reused, not renamed')
  assert.ok(EVOLUTION_CODES.filter(code => code !== 'SUBJECT_UNAVAILABLE').every(code => code.startsWith('EVOLUTION_')))
  for (const code of ['EVOLUTION_SQLITE_UNAVAILABLE', 'EVOLUTION_STORE_FOREIGN', 'EVOLUTION_SCHEMA_UNSUPPORTED',
    'EVOLUTION_APPEND_ONLY', 'EVOLUTION_CONFLICT', 'EVOLUTION_VALIDATION_CONSUMED', 'EVOLUTION_EVIDENCE_CONFLICT',
    'EVOLUTION_SUBJECT_MISMATCH', 'EVOLUTION_INVALID_RECORD', 'EVOLUTION_TICKET_REQUIRED', 'EVOLUTION_NOT_FOUND',
    'EVOLUTION_STALE_VALIDATION', 'EVOLUTION_VALIDATION_REQUIRED', 'EVOLUTION_VALIDATION_INSUFFICIENT',
    'EVOLUTION_OWNER_UNSUPPORTED', 'EVOLUTION_OWNER_REF_REQUIRED', 'EVOLUTION_ROLLBACK_TARGET_INVALID',
    'EVOLUTION_SOURCE_NOT_ALLOWED', 'EVOLUTION_DERIVED_INSUFFICIENT', 'EVOLUTION_LIMIT_EXCEEDED',
    'EVOLUTION_STATE_CORRUPT', 'EVOLUTION_ALREADY_LIVE', 'EVOLUTION_UNKNOWN_EVIDENCE', 'EVOLUTION_UNKNOWN_PROPOSAL',
    'EVOLUTION_TICKET_MISMATCH', 'EVOLUTION_STORE_UNAVAILABLE']) {
    assert.ok(EVOLUTION_CODES.includes(code), `${code} must be declared`)
  }
})

await test('loadSqliteModule resolves here and closes the loop otherwise', async () => {
  const sqlite = await loadSqliteModule()
  assert.equal(typeof sqlite.DatabaseSync, 'function')
  const codes = []
  for (const importModule of [
    async () => { throw new Error('No such built-in module: node:sqlite') },
    async () => ({}),
  ]) {
    try {
      await loadSqliteModule({ importModule })
    } catch (error) {
      assert.ok(error instanceof EvolutionRecordError, String(error))
      codes.push(error.code)
      assert.match(error.hint, /22\.19/, `${error.hint} must name the Node upgrade path`)
      assert.match(error.hint, /--experimental-sqlite/, `${error.hint} must name the flag fallback`)
    }
  }
  assert.deepEqual(codes, ['EVOLUTION_SQLITE_UNAVAILABLE', 'EVOLUTION_SQLITE_UNAVAILABLE'])
})

/* ---------------------------------- Task 2: opening the store ---------------------------------- */

function tempHome(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'evolution-records-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

async function makeStore(t, options = {}) {
  const home = options.home ?? tempHome(t)
  const store = await openEvolutionStore({ home, env: { DSH_HOME: home }, subject: SUBJECT, ...options })
  t.after(async () => { await store.close() })
  return store
}

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex')
const dirOf = store => store.paths.dir

const EVIDENCE_COLUMNS = 'id, version, subject_id, ticket_id, source, summary, refs, derived_from, external_id, dedupe_key, digest, schema_version, provenance, created_at'

/** A row written straight through SQLite, so a guard test never leans on the JS layer. */
function insertEvidenceRaw(db, id, { digest = 'a'.repeat(64), ticketId = 'T-1' } = {}) {
  db.prepare(`INSERT INTO evidence (${EVIDENCE_COLUMNS})
    VALUES (?1, 1, ?2, ?3, 'dsh_session', 'raw row', '{"sessionId":"s1"}', '[]', NULL, ?4, ?5, 1,
      '{"source":"test"}', '2026-11-04T00:00:00.000Z')`).run(id, SUBJECT, ticketId, `dk-${id}`, digest)
}

test('paths default inside the project home and only accept absolute overrides', () => {
  const paths = resolveEvolutionPaths({ DSH_HOME: '/tmp/dsh' }, '/tmp/dsh')
  assert.deepEqual(paths, { dir: '/tmp/dsh/evolution', file: '/tmp/dsh/evolution/evolution.db' })
  assert.equal(resolveEvolutionPaths({ DSH_EVOLUTION_STATE_DIR: '/srv/evo' }, '/tmp/dsh').dir, '/srv/evo')
  rejectsCode('EVOLUTION_INVALID_RECORD', () => resolveEvolutionPaths({ DSH_EVOLUTION_STATE_DIR: 'evolution' }, '/tmp/dsh'), 'relative override')
  rejectsCode('EVOLUTION_INVALID_RECORD', () => resolveEvolutionPaths({}, ''), 'missing home')
})

test('the lazy store touches nothing until the first request and never throws out of status', async t => {
  const home = tempHome(t)
  const store = createLazyEvolutionStore({ home, env: { DSH_HOME: home }, subject: SUBJECT })
  assert.equal(store.isOpen(), false)
  assert.ok(!existsSync(join(home, 'evolution')), 'construction must not create the state directory')
  assert.equal(store.paths.file, join(home, 'evolution', 'evolution.db'))
  const first = await store.status()
  assert.equal(first.available, true, JSON.stringify(first))
  assert.equal(store.isOpen(), true)
  assert.ok(existsSync(store.paths.file))
  await store.close()
  const second = await store.status()
  assert.equal(second.available, true, 'a closed lazy store reopens on the next request')
  await store.close()
})

test('a lazy store whose runtime lacks sqlite reports instead of breaking the host', async t => {
  const home = tempHome(t)
  const store = createLazyEvolutionStore({
    home,
    env: { DSH_HOME: home },
    subject: SUBJECT,
    importModule: async () => { throw new Error('No such built-in module: node:sqlite') },
  })
  const status = await store.status()
  assert.equal(status.available, false)
  assert.equal(status.code, 'EVOLUTION_SQLITE_UNAVAILABLE')
  assert.ok(status.hint, 'status must carry the operator hint')
  assert.equal((await store.summarySafe()).available, false, 'the overview block must degrade, not throw')
  await assert.rejects(store.recordEvidence({ source: 'dsh_session', summary: 'x', refs: { sessionId: 's' } }),
    error => error.code === 'EVOLUTION_SQLITE_UNAVAILABLE')
  assert.ok(!existsSync(join(home, 'evolution')), 'a failed open must leave no directory behind')
  await store.close()
})

test('a failed open is not cached, so fixing the environment is enough to retry', async t => {
  const home = tempHome(t)
  mkdirSync(join(home, 'evolution'), { recursive: true })
  writeFileSync(join(home, 'evolution', 'evolution.db'), 'placeholder')
  const store = createLazyEvolutionStore({ home, env: { DSH_HOME: home }, subject: SUBJECT })
  const failed = await store.status()
  assert.equal(failed.available, false, JSON.stringify(failed))
  rmSync(join(home, 'evolution', 'evolution.db'), { force: true })
  const retried = await store.status()
  assert.equal(retried.available, true, JSON.stringify(retried))
  await store.close()
})

test('the state directory is 0700, the database 0600, and durability pragmas are set', async t => {
  const store = await makeStore(t)
  assert.equal(statSync(dirOf(store)).mode & 0o777, 0o700)
  assert.equal(statSync(store.paths.file).mode & 0o777, 0o600)
  const status = await store.status()
  assert.equal(status.journalMode, 'wal')
  assert.equal(status.synchronous, 2, 'synchronous must be FULL')
  assert.equal(status.foreignKeys, 1)
  assert.equal(status.applicationId, EVOLUTION_APPLICATION_ID)
  assert.equal(status.schemaVersion, EVOLUTION_SCHEMA_VERSION)
  const raw = store.rawHandle()
  assert.equal(Number(raw.prepare('PRAGMA user_version').get().user_version), EVOLUTION_SCHEMA_VERSION)
  assert.deepEqual({ ...raw.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version') },
    { value: String(EVOLUTION_SCHEMA_VERSION) })
  assert.equal(raw.prepare('PRAGMA integrity_check').get().integrity_check, 'ok', 'the schema must be valid')
})

test('the declared append-only and domain guards all exist in the schema', async t => {
  const store = await makeStore(t)
  const names = store.rawHandle().prepare('SELECT name FROM sqlite_master WHERE type = ? ORDER BY name').all('trigger').map(row => row.name)
  for (const trigger of [...APPEND_TRIGGERS, ...DOMAIN_TRIGGERS]) {
    assert.ok(names.includes(trigger), `${trigger} must exist, found ${names.join(', ')}`)
  }
  const indexes = store.rawHandle().prepare('SELECT name FROM sqlite_master WHERE type = ?').all('index').map(row => row.name)
  assert.ok(indexes.includes('publication_validation_once'), 'one validation may back only one publication')
  const schema = store.rawHandle().prepare('SELECT sql FROM sqlite_master WHERE name IN (?, ?, ?, ?)')
    .all('evidence', 'proposal', 'validation', 'publication').map(row => row.sql).join('\n')
  assert.match(schema, /subject_id GLOB 'subject_\*'/)
  assert.match(schema, /digest TEXT NOT NULL CHECK \(digest GLOB '\[0-9a-f\]\*'/)
  assert.match(schema, /COALESCE\(json_type\(provenance\), ''\) = 'object'/, 'a missing field must not slip through a NULL CHECK')
})

test('updating or deleting a stored evidence row is refused by the database itself', async t => {
  const store = await makeStore(t)
  const db = store.rawHandle()
  insertEvidenceRaw(db, 'ev_guard')
  const before = db.prepare('SELECT count(*) AS n, sum(length(digest)) AS d FROM evidence').get()
  for (const statement of [
    'UPDATE evidence SET summary = ? WHERE id = ?',
    'UPDATE evidence SET version = 2 WHERE id = ?',
    'DELETE FROM evidence WHERE id = ?',
  ]) {
    let thrown
    try {
      if (statement.includes('summary')) db.prepare(statement).run('rewritten', 'ev_guard')
      else db.prepare(statement).run('ev_guard')
    } catch (error) { thrown = error }
    assert.ok(thrown, `${statement} must be refused`)
    assert.match(thrown.message, /evolution_history_append_only/)
    assert.equal(fromSqlite(thrown).code, 'EVOLUTION_APPEND_ONLY')
  }
  const after = db.prepare('SELECT count(*) AS n, sum(length(digest)) AS d FROM evidence').get()
  assert.deepEqual(after, before, 'the history must be byte-for-byte untouched')
  assert.equal(db.prepare('SELECT summary FROM evidence WHERE id = ?').get('ev_guard').summary, 'raw row')
})

test('a store from another version or another owner is refused without touching its bytes', async t => {
  const { DatabaseSync } = await import('node:sqlite')
  const home = tempHome(t)

  const newerDir = join(home, 'newer')
  mkdirSync(newerDir, { recursive: true })
  const newer = await openEvolutionStore({ home, env: {}, subject: SUBJECT, stateDir: newerDir })
  await newer.close()
  const bump = new DatabaseSync(join(newerDir, 'evolution.db'))
  bump.prepare('UPDATE meta SET value = ? WHERE key = ?').run('99', 'schema_version')
  bump.exec('PRAGMA user_version = 99')
  bump.close()
  const newerBytes = sha256(join(newerDir, 'evolution.db'))
  await assert.rejects(openEvolutionStore({ home, env: {}, subject: SUBJECT, stateDir: newerDir }),
    error => error.code === 'EVOLUTION_SCHEMA_UNSUPPORTED')
  assert.equal(sha256(join(newerDir, 'evolution.db')), newerBytes, 'refusing must not rewrite the file')

  const foreignDir = join(home, 'foreign')
  mkdirSync(foreignDir, { recursive: true })
  const foreign = new DatabaseSync(join(foreignDir, 'evolution.db'))
  foreign.exec('CREATE TABLE orchestrator_state (id TEXT PRIMARY KEY)')
  foreign.exec('PRAGMA application_id = 987654321')
  foreign.close()
  const foreignBytes = sha256(join(foreignDir, 'evolution.db'))
  await assert.rejects(openEvolutionStore({ home, env: {}, subject: SUBJECT, stateDir: foreignDir }),
    error => error.code === 'EVOLUTION_STORE_FOREIGN')
  assert.equal(sha256(join(foreignDir, 'evolution.db')), foreignBytes)

  const strangerDir = join(home, 'stranger')
  mkdirSync(strangerDir, { recursive: true })
  const stranger = new DatabaseSync(join(strangerDir, 'evolution.db'))
  stranger.exec('CREATE TABLE memories (id TEXT PRIMARY KEY)')
  stranger.close()
  await assert.rejects(openEvolutionStore({ home, env: {}, subject: SUBJECT, stateDir: strangerDir }),
    error => error.code === 'EVOLUTION_STORE_FOREIGN', 'an ownerless file with foreign tables is not ours either')

  const junkDir = join(home, 'junk')
  mkdirSync(junkDir, { recursive: true })
  writeFileSync(join(junkDir, 'evolution.db'), 'this is not a database')
  const junkBytes = sha256(join(junkDir, 'evolution.db'))
  await assert.rejects(openEvolutionStore({ home, env: {}, subject: SUBJECT, stateDir: junkDir }),
    error => /EVOLUTION_STATE_CORRUPT|file is not a database/.test([error.code, error.message].join(' ')))
  assert.equal(sha256(join(junkDir, 'evolution.db')), junkBytes)
})

test('a snapshot backup is readable, private, and refused while writes are still pending', async t => {
  const home = tempHome(t)
  const store = await makeStore(t, { home })
  insertEvidenceRaw(store.rawHandle(), 'ev_backup')
  await assert.rejects(backupDatabase({ dir: dirOf(store), file: store.paths.file }),
    error => error.code === 'EVOLUTION_STATE_CORRUPT', 'checkpointing first is part of the contract')
  await store.close()
  const copy = await backupDatabase({ dir: dirOf(store), file: store.paths.file, fromVersion: MIN_SUPPORTED_SCHEMA })
  assert.match(copy, /evolution\.pre-migration-v1-.*\.db$/)
  assert.equal(statSync(copy).mode & 0o777, 0o600)
  const { DatabaseSync } = await import('node:sqlite')
  const reopened = new DatabaseSync(copy, { readOnly: true })
  assert.equal(reopened.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
  assert.equal(reopened.prepare('PRAGMA application_id').get().application_id, EVOLUTION_APPLICATION_ID)
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM evidence').get().n, 1)
  reopened.close()
})

test('reopening an existing store keeps its rows and its recorded digests', async t => {
  const home = tempHome(t)
  const first = await makeStore(t, { home })
  insertEvidenceRaw(first.rawHandle(), 'ev_persist')
  const file = first.paths.file
  await first.close()
  const second = await openEvolutionStore({ home, env: { DSH_HOME: home }, subject: SUBJECT })
  assert.equal(second.paths.file, file)
  assert.equal(second.rawHandle().prepare('SELECT count(*) AS n FROM evidence').get().n, 1)
  assert.equal(second.rawHandle().prepare('SELECT digest FROM evidence WHERE id = ?').get('ev_persist').digest, 'a'.repeat(64))
  await second.close()
})

test('sqlite constraint failures translate to evolution codes', () => {
  const cases = [
    ['evolution_history_append_only', 'EVOLUTION_APPEND_ONLY'],
    ['evolution_publish_requires_validation', 'EVOLUTION_VALIDATION_REQUIRED'],
    ['evolution_owner_ref_required', 'EVOLUTION_OWNER_REF_REQUIRED'],
    ['evolution_already_live', 'EVOLUTION_ALREADY_LIVE'],
    ['evolution_unknown_proposal', 'EVOLUTION_UNKNOWN_PROPOSAL'],
    ['evolution_unknown_evidence', 'EVOLUTION_UNKNOWN_EVIDENCE'],
    ['evolution_ticket_mismatch', 'EVOLUTION_TICKET_MISMATCH'],
    ['evolution_derived_insufficient', 'EVOLUTION_DERIVED_INSUFFICIENT'],
    ['evolution_rollback_target_invalid', 'EVOLUTION_ROLLBACK_TARGET_INVALID'],
    ['UNIQUE constraint failed: evidence.subject_id, evidence.source, evidence.dedupe_key', 'EVOLUTION_EVIDENCE_CONFLICT'],
    ['UNIQUE constraint failed: publication.validation_id', 'EVOLUTION_VALIDATION_CONSUMED'],
    ['CHECK constraint failed: proposal', 'EVOLUTION_INVALID_RECORD'],
    ['SQLITE_IOERR on a cold disk', 'EVOLUTION_STATE_CORRUPT'],
  ]
  for (const [message, code] of cases) {
    const translated = fromSqlite(new Error(message))
    assert.equal(translated.code, code, message)
    assert.ok(translated.hint, `${code} must carry a hint`)
    assert.ok(translated instanceof EvolutionRecordError, code)
  }
  assert.equal(fromSqlite({ code: 'EVOLUTION_CONFLICT', message: 'already typed' }).code, 'EVOLUTION_CONFLICT')
})

/* --------------------------- Task 3: evidence, derived material, idempotency --------------------------- */

/** The same logical evidence, written twice by two callers. */
const sessionEvidence = overrides => ({
  source: 'dsh_session',
  summary: 'the model asked for a fact that was not stored',
  refs: { sessionKey: 'vivy-main', turn: 12 },
  ...overrides,
})

test('recordEvidence stores one row and returns its content address', async t => {
  const store = await makeStore(t)
  const written = await store.recordEvidence(sessionEvidence({
    dedupeKey: 'session:vivy-main:12',
    ticketId: 'T-7',
    provenance: { source: 'dsh_session', at: '2026-11-04T01:02:03Z', actor: 'operator:vivy', externalId: 'turn-12' },
  }))
  assert.equal(written.created, true)
  assert.match(written.id, /^ev_[0-9a-f]{32}$/)
  assert.equal(written.version, 1)
  assert.match(written.digest, /^[0-9a-f]{64}$/)
  assert.equal(written.record.source, 'dsh_session')
  assert.equal(written.record.ticketId, 'T-7')
  assert.equal(written.record.provenance.at, '2026-11-04T01:02:03.000Z', 'provenance must run through the shared normalizer')
  assert.equal(written.record.provenance.actor, 'operator:vivy')
  assert.equal(written.record.subjectId, SUBJECT)

  const rows = store.rawHandle().prepare('SELECT * FROM evidence').all()
  assert.equal(rows.length, 1)
  assert.deepEqual(JSON.parse(rows[0].refs), { sessionKey: 'vivy-main', turn: 12 })
  assert.equal(rows[0].schema_version, 1)
  assert.match(rows[0].created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
})

test('replaying the same evidence is idempotent even with a different clock', async t => {
  const store = await makeStore(t)
  const first = await store.recordEvidence(sessionEvidence({ dedupeKey: 'session:vivy-main:12' }))
  const again = await store.recordEvidence(sessionEvidence({ dedupeKey: 'session:vivy-main:12' }))
  const third = await store.recordEvidence(sessionEvidence({
    dedupeKey: 'session:vivy-main:12',
    provenance: { at: '2020-01-01T00:00:00Z' },
  }))
  assert.equal(again.created, false)
  assert.equal(third.created, false)
  assert.equal(again.id, first.id)
  assert.equal(third.digest, first.digest, 'a timestamp must not change the content address')
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM evidence').get().n, 1)
  assert.deepEqual(third.record.provenance, again.record.provenance, 'the stored row is returned untouched')
})

test('a dedupe key reused with different content conflicts instead of overwriting', async t => {
  const store = await makeStore(t)
  const first = await store.recordEvidence(sessionEvidence({ dedupeKey: 'key-1' }))
  await assert.rejects(store.recordEvidence(sessionEvidence({
    dedupeKey: 'key-1',
    summary: 'a different conclusion written by accident',
  })), error => {
    assert.equal(error.code, 'EVOLUTION_EVIDENCE_CONFLICT')
    assert.match(error.hint, /dedupeKey/)
    return true
  })
  const rows = store.rawHandle().prepare('SELECT digest, summary FROM evidence').all()
  assert.equal(rows.length, 1)
  assert.equal(rows[0].digest, first.digest)
  assert.equal(rows[0].summary, first.record.summary)
})

test('a dedupe key is derived when absent and a ticket stays optional', async t => {
  const store = await makeStore(t)
  const noTicket = await store.recordEvidence(sessionEvidence({ externalId: 'turn-13' }))
  assert.equal(noTicket.record.ticketId, null, 'evidence may exist before any ticket exists')
  assert.equal(store.rawHandle().prepare('SELECT ticket_id FROM evidence WHERE id = ?').get(noTicket.id).ticket_id, null)
  const replay = await store.recordEvidence(sessionEvidence({ externalId: 'turn-13' }))
  assert.equal(replay.id, noTicket.id, 'the derived key must be stable')
  assert.notEqual((await store.recordEvidence(sessionEvidence({ externalId: 'turn-14' }))).id, noTicket.id)
  for (const ticketId of ['', '  ', 'T-'.padEnd(130, 'x')]) {
    await assert.rejects(store.recordEvidence(sessionEvidence({ ticketId, dedupeKey: `key-${ticketId.length}` })),
      error => error.code === 'EVOLUTION_INVALID_RECORD', `ticket ${JSON.stringify(ticketId)} must be refused`)
  }
})

test('evidence must carry a locator and a summary', async t => {
  const store = await makeStore(t)
  for (const refs of [undefined, {}, null, 'session:1', { note: undefined }, []]) {
    await assert.rejects(store.recordEvidence(sessionEvidence({ refs, dedupeKey: `refs-${JSON.stringify(refs) ?? 'none'}` })),
      error => error.code === 'EVOLUTION_INVALID_RECORD', `refs ${JSON.stringify(refs)} must be refused`)
  }
  for (const summary of [undefined, '', '   ', 'x'.repeat(4001)]) {
    await assert.rejects(store.recordEvidence(sessionEvidence({ summary, refs: { sessionKey: 'k' }, dedupeKey: 'sum-1' })),
      error => error.code === 'EVOLUTION_INVALID_RECORD', `summary ${JSON.stringify(summary?.slice(0, 12))} must be refused`)
  }
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM evidence').get().n, 0)
})

test('derived material must cite evidence that is already stored', async t => {
  const store = await makeStore(t)
  const recap = { source: 'recap', summary: 'recap claims this', refs: { recapId: 'r-1' } }
  await assert.rejects(store.recordEvidence({ ...recap, derivedFrom: [], dedupeKey: 'recap-1' }),
    error => error.code === 'EVOLUTION_DERIVED_INSUFFICIENT')
  await assert.rejects(store.recordEvidence({ ...recap, derivedFrom: ['ev_ghost'], dedupeKey: 'recap-1' }),
    error => error.code === 'EVOLUTION_UNKNOWN_EVIDENCE')
  const origin = await store.recordEvidence(sessionEvidence({ dedupeKey: 'session:vivy-main:20' }))
  const derived = await store.recordEvidence({ ...recap, derivedFrom: [origin.id], dedupeKey: 'recap-1' })
  assert.equal(derived.created, true)
  assert.deepEqual(derived.record.derivedFrom, [origin.id])
  assert.equal(store.rawHandle().prepare('SELECT derived_from FROM evidence WHERE id = ?').get(derived.id).derived_from,
    JSON.stringify([origin.id]))
})

test('a record over the configured ceiling is refused before it reaches the file', async t => {
  const store = await makeStore(t, { limits: { canonicalBytes: 512 } })
  await assert.rejects(store.recordEvidence(sessionEvidence({
    refs: { sessionKey: 'k', blob: 'x'.repeat(400) },
    dedupeKey: 'big-1',
  })), error => {
    assert.equal(error.code, 'EVOLUTION_LIMIT_EXCEEDED')
    assert.match(error.hint, /canonicalBytes|上限/)
    return true
  })
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM evidence').get().n, 0)
})

test('an unusable subject or a foreign subject closes the loop with zero rows', async t => {
  const home = tempHome(t)
  const blind = createLazyEvolutionStore({ home, env: {} })
  await assert.rejects(blind.recordEvidence(sessionEvidence({ dedupeKey: 'x-1' })),
    error => error.code === 'SUBJECT_UNAVAILABLE')
  assert.ok(!existsSync(home + '/evolution'), 'no subject means no state directory')

  const store = await makeStore(t)
  await assert.rejects(store.recordEvidence(sessionEvidence({
    subjectId: 'subject_00000000-0000-4000-8000-000000000000',
    dedupeKey: 'x-2',
  })), error => error.code === 'EVOLUTION_SUBJECT_MISMATCH')
  await assert.rejects(store.recordEvidence(sessionEvidence({ subjectId: 'someone-else', dedupeKey: 'x-3' })),
    error => error.code === 'SUBJECT_INVALID')
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM evidence').get().n, 0)
})

/* ------------------------------- Task 4: proposals and validations ------------------------------- */

const CANDIDATE = { personaId: 'vivy', text: 'prefers short answers' }

async function seedEvidence(store, { ticketId = 'T-9', dedupeKey = 'seed-1', source = 'dsh_session', derivedFrom } = {}) {
  const written = await store.recordEvidence(sessionEvidence({
    source,
    derivedFrom,
    ticketId,
    dedupeKey,
    refs: { sessionKey: 'vivy-main', turn: 3 },
  }))
  return written.id
}

function proposalInput(evidenceIds, overrides = {}) {
  return {
    ticketId: 'T-9',
    candidateKind: 'persona',
    ownerKind: 'laputa',
    assetScope: 'persona:vivy:soul',
    candidate: CANDIDATE,
    summary: '把回答压得更短',
    evidenceIds,
    ...overrides,
  }
}

test('a proposal needs a ticket and a candidate that belongs to one owner', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store)
  for (const ticketId of [undefined, '', '   ']) {
    await assert.rejects(store.upsertProposal(proposalInput([evidenceId], { ticketId })),
      error => {
        assert.equal(error.code, 'EVOLUTION_TICKET_REQUIRED')
        assert.match(error.hint, /Superagent/)
        return true
      }, `ticket ${JSON.stringify(ticketId)}`)
  }
  await assert.rejects(store.upsertProposal(proposalInput([evidenceId], { candidateKind: 'long_term_knowledge' })),
    error => error.code === 'EVOLUTION_INVALID_RECORD')
  await assert.rejects(store.upsertProposal(proposalInput([])),
    error => error.code === 'EVOLUTION_INVALID_RECORD', 'a candidate without any evidence is not an evolution proposal')
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM proposal').get().n, 0)
})

test('the candidate body stays outside the store and only its digest is recorded', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store)
  const written = await store.upsertProposal(proposalInput([evidenceId]))
  assert.equal(written.created, true)
  assert.match(written.id, /^prop_[0-9a-f]{32}$/)
  assert.equal(written.record.candidateDigest, digestOf(CANDIDATE))
  assert.equal(written.record.state, 'proposed')
  assert.equal(written.record.version, 1)
  assert.equal(written.record.candidate, undefined, 'the body must not come back out of the store')
  const row = store.rawHandle().prepare('SELECT * FROM proposal').get()
  assert.equal(JSON.stringify({ ...row }).includes('prefers short answers'), false)
  assert.equal(readFileSync(store.paths.file, 'utf8').includes('prefers short answers'), false)
})

test('replaying a proposal is idempotent and rewriting its head version conflicts', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store)
  const first = await store.upsertProposal(proposalInput([evidenceId]))
  const replay = await store.upsertProposal(proposalInput([evidenceId]))
  assert.equal(replay.created, false)
  assert.equal(replay.id, first.id)
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM proposal').get().n, 1)
  await assert.rejects(store.upsertProposal(proposalInput([evidenceId], { summary: '同一候选，换了个说法' })),
    error => {
      assert.equal(error.code, 'EVOLUTION_CONFLICT')
      assert.match(error.hint, /expectedProposalDigest|推进/)
      return true
    })
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM proposal').get().n, 1)
  const changed = await store.upsertProposal(proposalInput([evidenceId], { candidate: { ...CANDIDATE, text: 'even shorter' } }))
  assert.equal(changed.created, true, 'a different candidate is a different proposal')
  assert.notEqual(changed.id, first.id)
})

test('a proposal must stand on stored evidence, and derived material alone is not enough', async t => {
  const store = await makeStore(t)
  const origin = await seedEvidence(store, { dedupeKey: 'origin-1' })
  const recap = await seedEvidence(store, { dedupeKey: 'recap-1', source: 'recap', derivedFrom: [origin] })
  await assert.rejects(store.upsertProposal(proposalInput([recap])),
    error => error.code === 'EVOLUTION_DERIVED_INSUFFICIENT')
  await assert.rejects(store.upsertProposal(proposalInput(['ev_00000000000000000000000000000000'])),
    error => error.code === 'EVOLUTION_UNKNOWN_EVIDENCE')
  const mixed = await store.upsertProposal(proposalInput([origin, recap], { dedupeKey: undefined }))
  assert.equal(mixed.created, true, 'one direct source is enough as long as the recap is attached')
  assert.deepEqual(mixed.record.evidenceIds, [origin, recap])
})

test('the ticket of a proposal may not disagree with the evidence it cites', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store, { ticketId: 'T-9' })
  await assert.rejects(store.upsertProposal(proposalInput([evidenceId], { ticketId: 'T-10' })),
    error => error.code === 'EVOLUTION_TICKET_MISMATCH')
  const untracked = await seedEvidence(store, { dedupeKey: 'no-ticket-1', ticketId: null })
  const written = await store.upsertProposal(proposalInput([untracked], { ticketId: 'T-10' }))
  assert.equal(written.created, true, 'evidence without a ticket may join any chain')
  await assert.rejects(store.upsertProposal(proposalInput([evidenceId, untracked], { ticketId: 'T-10' })),
    error => error.code === 'EVOLUTION_TICKET_MISMATCH', 'one cited ticket is enough to make the chain disagree')
})

test('advancing a proposal needs the current digest and appends a version row', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store)
  const first = await store.upsertProposal(proposalInput([evidenceId]))
  await assert.rejects(store.advanceProposal({ proposalId: first.id, toState: 'validated', expectedProposalDigest: 'b'.repeat(64) }),
    error => {
      assert.equal(error.code, 'EVOLUTION_CONFLICT')
      assert.match(error.hint, /digest/)
      return true
    })
  await assert.rejects(store.advanceProposal({ proposalId: first.id, toState: 'published', expectedProposalDigest: first.digest }),
    error => error.code === 'EVOLUTION_CONFLICT', 'a proposal cannot skip validation')
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM proposal').get().n, 1, 'a refused advance writes nothing')

  const validating = await store.advanceProposal({ proposalId: first.id, toState: 'validating', expectedProposalDigest: first.digest })
  assert.equal(validating.version, 2)
  assert.equal(validating.record.state, 'validating')
  const validated = await store.advanceProposal({
    proposalId: first.id,
    toState: 'validated',
    expectedProposalDigest: validating.digest,
    reason: '五项检查通过',
  })
  assert.equal(validated.version, 3)
  assert.equal(validated.record.reason, '五项检查通过')
  const rows = store.rawHandle().prepare('SELECT version, state, digest FROM proposal WHERE id = ? ORDER BY version').all(first.id)
  assert.deepEqual(rows.map(row => `${row.version}:${row.state}`).slice(), ['1:proposed', '2:validating', '3:validated'])
  assert.equal(new Set(rows.map(row => row.digest)).size, 3, 'every version keeps its own content address')
  const same = store.rawHandle().prepare('SELECT id, candidate_digest, asset_scope, ticket_id, evidence_ids FROM proposal WHERE version = 1').get()
  const again = store.rawHandle().prepare('SELECT id, candidate_digest, asset_scope, ticket_id, evidence_ids FROM proposal WHERE version = 3').get()
  assert.deepEqual({ ...again }, { ...same }, 'the identity columns carry forward untouched')
})

test('an unknown or terminal proposal cannot be advanced', async t => {
  const store = await makeStore(t)
  await assert.rejects(store.advanceProposal({
    proposalId: 'prop_00000000000000000000000000000000',
    toState: 'validated',
    expectedProposalDigest: 'b'.repeat(64),
  }), error => error.code === 'EVOLUTION_NOT_FOUND')
  const evidenceId = await seedEvidence(store)
  const first = await store.upsertProposal(proposalInput([evidenceId]))
  const rejected = await store.advanceProposal({ proposalId: first.id, toState: 'rejected', expectedProposalDigest: first.digest, reason: '重复候选' })
  const reopened = await store.advanceProposal({ proposalId: first.id, toState: 'proposed', expectedProposalDigest: rejected.digest })
  assert.equal(reopened.record.state, 'proposed')
  const superseded = await store.advanceProposal({ proposalId: reopened.id, toState: 'validated', expectedProposalDigest: reopened.digest })
  const retired = await store.advanceProposal({ proposalId: superseded.id, toState: 'superseded', expectedProposalDigest: superseded.digest })
  await assert.rejects(store.advanceProposal({ proposalId: first.id, toState: 'validated', expectedProposalDigest: retired.digest }),
    error => error.code === 'EVOLUTION_CONFLICT', 'superseded is terminal')
})

test('a validation binds to the proposal head it actually checked', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store)
  const proposal = await store.upsertProposal(proposalInput([evidenceId]))
  const validationInput = (overrides = {}) => ({
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest: proposal.record.candidateDigest,
    checks: OWNERS.laputa.minChecks,
    verdict: 'passed',
    ...overrides,
  })
  const checks = OWNERS.laputa.minChecks
  await assert.rejects(store.recordValidation(validationInput({
    proposalId: 'prop_00000000000000000000000000000000',
  })), error => error.code === 'EVOLUTION_UNKNOWN_PROPOSAL')
  await assert.rejects(store.recordValidation(validationInput({ proposalDigest: 'c'.repeat(64) })),
    error => {
      assert.equal(error.code, 'EVOLUTION_STALE_VALIDATION')
      assert.match(error.hint, /当前/)
      return true
    })
  await assert.rejects(store.recordValidation(validationInput({ candidateDigest: 'd'.repeat(64) })),
    error => error.code === 'EVOLUTION_STALE_VALIDATION', 'a validation of another candidate is stale')
  await assert.rejects(store.recordValidation(validationInput({ checks: ['baseline'] })),
    error => error.code === 'EVOLUTION_VALIDATION_INSUFFICIENT')
  await assert.rejects(store.recordValidation(validationInput({ ticketId: 'T-11' })),
    error => error.code === 'EVOLUTION_TICKET_MISMATCH')
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM validation').get().n, 0)

  const first = await store.recordValidation(validationInput({
    checks: checks.map(kind => ({ kind, verdict: 'passed' })),
    runner: 'dsh-eval:vivy',
    approvalRef: 'approval:owner-1',
  }))
  assert.equal(first.created, true)
  assert.match(first.id, /^val_[0-9a-f]{32}$/)
  assert.equal(first.record.verdict, 'passed')
  assert.equal(first.record.ticketId, 'T-9', 'the ticket is inherited from the proposal')
  assert.equal(first.record.approvalRef, 'approval:owner-1')
  const replay = await store.recordValidation(validationInput({ checks: [...checks].reverse() }))
  assert.equal(replay.created, false, 'the same checks replay onto the same row')
  assert.equal(replay.id, first.id)
  assert.equal(store.rawHandle().prepare('SELECT count(*) AS n FROM validation').get().n, 1)
})

test('the verdict must be stated, and a failed one is still kept', async t => {
  const store = await makeStore(t)
  const evidenceId = await seedEvidence(store)
  const proposal = await store.upsertProposal(proposalInput([evidenceId]))
  const base = {
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest: proposal.record.candidateDigest,
    checks: OWNERS.laputa.minChecks,
  }
  await assert.rejects(store.recordValidation(base),
    error => error.code === 'EVOLUTION_INVALID_RECORD', 'a validation without a verdict must not default to passed')
  const failed = await store.recordValidation({ ...base, verdict: 'failed', notes: 'rollback 检查未通过' })
  assert.equal(failed.record.verdict, 'failed')
  const again = await store.recordValidation({ ...base, verdict: 'failed', notes: 'rollback 检查未通过' })
  assert.equal(again.id, failed.id)
  await assert.rejects(store.recordValidation({ ...base, verdict: 'approved' }),
    error => error.code === 'EVOLUTION_INVALID_RECORD')
  const counts = (await store.summary()).counts
  assert.deepEqual(counts, { evidence: 1, proposal: 1, validation: 1, publication: 0 })
})

/* --------------------------------- Task 5: publishing and rollback --------------------------------- */

const LAPUTA_REF = { personaId: 'vivy', revision: 'r000042', contentDigest: digestOf(CANDIDATE) }

const countRows = (store, table) => Number(store.rawHandle().prepare(`SELECT count(*) AS n FROM ${table}`).get().n)

/** Drive one proposal all the way to `validated` plus a passed Validation, ready to publish. */
async function readyProposal(store, {
  verdict = 'passed',
  ownerKind = 'laputa',
  dedupeKey = 'seed-1',
  ticketId = 'T-9',
  assetScope = 'persona:vivy:soul',
  candidate = CANDIDATE,
} = {}) {
  const candidateKind = Object.keys(CANDIDATE_OWNERS).find(kind => CANDIDATE_OWNERS[kind] === ownerKind)
  const evidenceId = await seedEvidence(store, { dedupeKey, ticketId })
  const proposal = await store.upsertProposal(proposalInput([evidenceId], {
    candidateKind, ownerKind, assetScope, ticketId, candidate,
  }))
  const validating = await store.advanceProposal({
    proposalId: proposal.id, toState: 'validating', expectedProposalDigest: proposal.digest,
  })
  const validated = await store.advanceProposal({
    proposalId: validating.id, toState: 'validated', expectedProposalDigest: validating.digest,
  })
  const validation = await store.recordValidation({
    proposalId: validated.id,
    proposalDigest: validated.digest,
    candidateDigest: validated.record.candidateDigest,
    checks: OWNERS[ownerKind].minChecks,
    verdict,
  })
  return {
    evidenceId,
    proposal: validated,
    validation,
    candidateDigest: validated.record.candidateDigest,
    assetScope,
  }
}

/** A publication row written straight through SQLite, to prove the library guards without the JS layer. */
function insertPublicationRaw(db, values = {}) {
  const row = {
    id: 'pub_forged',
    version: 1,
    subjectId: SUBJECT,
    ticketId: 'T-9',
    proposalId: 'prop_missing',
    proposalDigest: 'a'.repeat(64),
    candidateDigest: 'b'.repeat(64),
    validationId: null,
    purpose: 'publish',
    ownerKind: 'laputa',
    assetScope: 'persona:vivy:soul',
    ownerRef: JSON.stringify(LAPUTA_REF),
    supersedesPublicationId: null,
    restoredFromPublicationId: null,
    state: 'live',
    error: null,
    approvalRefs: '[]',
    actorRef: null,
    publishedAt: null,
    digest: 'c'.repeat(64),
    ...values,
  }
  try {
    db.prepare(`INSERT INTO publication (id, version, subject_id, ticket_id, proposal_id, proposal_digest, candidate_digest,
      validation_id, purpose, owner_kind, asset_scope, owner_ref, supersedes_publication_id, restored_from_publication_id,
      state, error, approval_refs, actor_ref, published_at, digest, schema_version, provenance, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, 1,
        '{"source":"raw"}', '2026-11-04T00:00:00.000Z')`)
      .run(row.id, row.version, row.subjectId, row.ticketId, row.proposalId, row.proposalDigest, row.candidateDigest,
        row.validationId, row.purpose, row.ownerKind, row.assetScope, row.ownerRef, row.supersedesPublicationId,
        row.restoredFromPublicationId, row.state, row.error, row.approvalRefs, row.actorRef, row.publishedAt, row.digest)
  } catch (error) {
    // The same translator the HTTP layer uses, so a trigger refusal is asserted as the code an operator sees.
    throw fromSqlite(error)
  }
  return row.id
}


test('a publish needs a passed validation bound to the proposal head', async t => {
  const store = await makeStore(t)
  const { proposal, validation, candidateDigest } = await readyProposal(store)
  const base = {
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  }
  await assert.rejects(store.publish({ ...base, validationId: undefined }),
    error => {
      assert.equal(error.code, 'EVOLUTION_VALIDATION_REQUIRED')
      assert.match(error.hint, /Validation/)
      return true
    })
  await assert.rejects(store.publish({ ...base, validationId: 'val_00000000000000000000000000000000' }),
    error => error.code === 'EVOLUTION_VALIDATION_REQUIRED', 'an unknown validation cannot buy a publish')
  await assert.rejects(store.publish({ ...base, proposalId: 'prop_00000000000000000000000000000000' }),
    error => error.code === 'EVOLUTION_NOT_FOUND')
  await assert.rejects(store.publish({ ...base, expectedProposalDigest: 'e'.repeat(64) }),
    error => {
      assert.equal(error.code, 'EVOLUTION_CONFLICT')
      assert.match(error.hint, /digest/)
      return true
    }, 'the proposal head must still be the one that was validated')
  const unchecked = await store.upsertProposal(proposalInput([await seedEvidence(store, { dedupeKey: 'unchecked-1' })], {
    assetScope: 'persona:vivy:unchecked',
  }))
  await assert.rejects(store.publish({ ...base, proposalId: unchecked.id, expectedProposalDigest: unchecked.digest }),
    error => error.code === 'EVOLUTION_VALIDATION_REQUIRED', 'a proposal nobody validated cannot publish')
  const failed = await readyProposal(store, { verdict: 'failed', dedupeKey: 'failed-1', assetScope: 'persona:vivy:failed' })
  await assert.rejects(store.publish({
    proposalId: failed.proposal.id,
    expectedProposalDigest: failed.proposal.digest,
    validationId: failed.validation.id,
    ownerRef: LAPUTA_REF,
  }), error => error.code === 'EVOLUTION_VALIDATION_REQUIRED', 'a failed verdict never publishes')
  const blocked = await store.recordValidation({
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest,
    checks: OWNERS.laputa.minChecks,
    verdict: 'blocked',
    notes: '等待人工审批',
  })
  await assert.rejects(store.publish({ ...base, validationId: blocked.id }),
    error => error.code === 'EVOLUTION_VALIDATION_REQUIRED', 'a blocked verdict never publishes')
  assert.deepEqual([countRows(store, 'publication'), countRows(store, 'proposal')], [0, 7],
    'every refusal above writes nothing')
})

test('the library itself refuses a live publish without a matching passed validation', async t => {
  const store = await makeStore(t)
  const { proposal, candidateDigest, assetScope } = await readyProposal(store)
  const db = store.rawHandle()
  const forged = values => insertPublicationRaw(db, {
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest,
    assetScope,
    ...values,
  })
  rejectsCode('EVOLUTION_VALIDATION_REQUIRED', () => forged({ id: 'pub_forged_no_validation', validationId: null }),
    'a live publish row with no validation at all')
  const wrongDigest = 'f'.repeat(64)
  rejectsCode('EVOLUTION_VALIDATION_REQUIRED',
    () => forged({ id: 'pub_forged_wrong_digest', validationId: null, proposalDigest: wrongDigest }),
    'a live publish row pointing at a stale proposal digest')
  assert.equal(countRows(store, 'publication'), 0, 'the trigger leaves no trace of the refusal')
})

test('an owner without versioned writes keeps the candidate a proposal', async t => {
  const store = await makeStore(t)
  const ready = await readyProposal(store, {
    ownerKind: 'skill_owner',
    dedupeKey: 'skill-1',
    assetScope: 'skill:lint-fix',
    candidate: { name: 'lint-fix' },
  })
  await assert.rejects(store.publish({
    proposalId: ready.proposal.id,
    expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id,
    ownerRef: { skillId: 's1', publicationId: 'p1' },
  }), error => {
    assert.equal(error.code, 'EVOLUTION_OWNER_UNSUPPORTED')
    assert.match(error.hint, /skill_owner/)
    assert.match(error.hint, /Proposal/)
    return true
  })
  assert.equal(countRows(store, 'publication'), 0)
  assert.equal(store.rawHandle().prepare('SELECT max(version) AS v FROM proposal WHERE id = ?').get(ready.proposal.id).v, 3,
    'the proposal stays at validated')
  assert.equal(ownerAllowsPublish('skill_owner'), false)
  assert.equal(ownerAllowsPublish('mempalace'), true)
  assert.equal(ownerAllowsPublish('laputa'), true)
  assert.equal(ownerAllowsPublish('actmem'), true)
})

test('a live publication must carry the owner reference and only its declared fields', async t => {
  const store = await makeStore(t)
  const { proposal, validation, candidateDigest, assetScope } = await readyProposal(store)
  const base = {
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
  }
  for (const ownerRef of [undefined, null, 'r000042', { personaId: 'vivy', revision: 'r1' }]) {
    await assert.rejects(store.publish({ ...base, ownerRef }),
      error => error.code === 'EVOLUTION_OWNER_REF_REQUIRED', `owner_ref ${JSON.stringify(ownerRef)}`)
  }
  await assert.rejects(store.publish({ ...base, ownerRef: { ...LAPUTA_REF, bytes: 'the whole persona' } }),
    error => {
      assert.equal(error.code, 'EVOLUTION_INVALID_RECORD')
      assert.match(error.hint, /contentDigest|字段/)
      return true
    }, 'owner_ref stores references, never the asset bytes')
  assert.equal(countRows(store, 'publication'), 0)
  rejectsCode('EVOLUTION_OWNER_REF_REQUIRED', () => insertPublicationRaw(store.rawHandle(), {
    id: 'pub_forged_no_ref',
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest,
    validationId: validation.id,
    assetScope,
    ownerRef: null,
  }), 'a live row without owner_ref cannot be forged past the library either')
  assert.equal(countRows(store, 'publication'), 0)
})

test('publishing marks the proposal published and appends one live row', async t => {
  const store = await makeStore(t)
  const { proposal, validation, candidateDigest, assetScope } = await readyProposal(store)
  const input = {
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
    approvalRefs: ['approval:owner-1'],
    actorRef: 'operator:dsh',
  }
  const published = await store.publish(input)
  assert.equal(published.created, true)
  assert.match(published.id, /^pub_[0-9a-f]{32}$/)
  assert.equal(published.version, 1)
  assert.equal(published.record.state, 'live')
  assert.equal(published.record.purpose, 'publish')
  assert.deepEqual(published.record.ownerRef, LAPUTA_REF)
  assert.equal(published.record.proposalDigest, proposal.digest)
  assert.equal(published.record.candidateDigest, candidateDigest)
  assert.equal(published.record.validationId, validation.id)
  assert.equal(published.record.assetScope, assetScope)
  assert.deepEqual(published.record.approvalRefs, ['approval:owner-1'])
  assert.equal(published.record.actorRef, 'operator:dsh')
  assert.equal(published.record.error, null)
  assert.ok(published.record.publishedAt)
  const head = store.rawHandle().prepare('SELECT version, state FROM proposal WHERE id = ? ORDER BY version DESC LIMIT 1')
    .get(proposal.id)
  assert.deepEqual([head.version, head.state], [4, 'published'], 'publishing advances the proposal in the same breath')
  const again = await store.publish(input)
  assert.equal(again.created, false)
  assert.equal(again.id, published.id)
  assert.equal(countRows(store, 'publication'), 1, 'the same publish replays instead of writing twice')
  const summary = await store.summary()
  assert.deepEqual(summary.publicationsByState, { live: 1 })
  assert.deepEqual(summary.livePublications.map(item => item.assetScope), [assetScope])
  assert.deepEqual(summary.proposalsByState, { published: 1 })
  assert.equal((await store.verifyHistory()).ok, true)
})

test('one validation supports exactly one publication', async t => {
  const store = await makeStore(t)
  const { proposal, validation, candidateDigest, assetScope } = await readyProposal(store)
  const published = await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  await assert.rejects(store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000043' },
  }), error => {
    assert.equal(error.code, 'EVOLUTION_VALIDATION_CONSUMED')
    assert.match(error.hint, /重新验证|验证/)
    return true
  })
  assert.equal(countRows(store, 'publication'), 1, 'a consumed validation buys nothing more')
  rejectsCode('EVOLUTION_VALIDATION_CONSUMED', () => insertPublicationRaw(store.rawHandle(), {
    id: 'pub_forged_second_use',
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest,
    validationId: validation.id,
    assetScope,
    state: 'superseded',
  }), 'the unique index also blocks a second row over the same validation')
  assert.equal(countRows(store, 'publication'), 1)
  assert.equal(published.record.state, 'live')
})

test('a stale expectedLivePublicationId conflicts and writes nothing', async t => {
  const store = await makeStore(t)
  const first = await readyProposal(store)
  const publishedFirst = await store.publish({
    proposalId: first.proposal.id,
    expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id,
    ownerRef: LAPUTA_REF,
  })
  const second = await readyProposal(store, {
    dedupeKey: 'seed-2',
    candidate: { ...CANDIDATE, text: 'prefers bullet points' },
  })
  const rowsBefore = countRows(store, 'publication')
  await assert.rejects(store.publish({
    proposalId: second.proposal.id,
    expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000099' },
    expectedLivePublicationId: 'pub_00000000000000000000000000000000',
  }), error => {
    assert.equal(error.code, 'EVOLUTION_CONFLICT')
    assert.match(error.hint, /live/)
    return true
  })
  assert.equal(countRows(store, 'publication'), rowsBefore, 'a failed compare-and-set writes no publication')
  assert.equal(countRows(store, 'proposal'), 7, 'and no proposal version either')
  const replaced = await store.publish({
    proposalId: second.proposal.id,
    expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000099' },
    expectedLivePublicationId: publishedFirst.id,
  })
  assert.equal(replaced.created, true)
  assert.equal(replaced.record.supersedesPublicationId, publishedFirst.id)
  const old = store.rawHandle().prepare('SELECT version, state FROM publication WHERE id = ? ORDER BY version')
    .all(publishedFirst.id)
  assert.deepEqual(old.map(row => `${row.version}:${row.state}`), ['1:live', '2:superseded'],
    'retiring a publication appends a version; the live row stays readable')
  const summary = await store.summary()
  assert.deepEqual(summary.livePublications.map(item => item.assetScope), ['persona:vivy:soul'], 'only one live per asset')
  assert.equal(summary.counts.publication, 3, 'history only grows')
  assert.equal((await store.verifyHistory()).ok, true)
})

test('a second live row for one asset is refused by the library', async t => {
  const store = await makeStore(t)
  const { proposal, validation, candidateDigest, assetScope } = await readyProposal(store)
  const live = await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  assert.equal(live.record.state, 'live')
  rejectsCode('EVOLUTION_ALREADY_LIVE', () => insertPublicationRaw(store.rawHandle(), {
    id: 'pub_forged_second_live',
    proposalId: proposal.id,
    proposalDigest: proposal.digest,
    candidateDigest,
    validationId: validation.id,
    assetScope,
    state: 'live',
  }), 'a forged second live row for the same asset_scope')
  assert.equal(countRows(store, 'publication'), 1)
})

test('rollback appends a new live row and keeps every historical row', async t => {
  const store = await makeStore(t)
  const first = await readyProposal(store)
  const publishedFirst = await store.publish({
    proposalId: first.proposal.id,
    expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id,
    ownerRef: LAPUTA_REF,
  })
  const second = await readyProposal(store, {
    dedupeKey: 'seed-2',
    candidate: { ...CANDIDATE, text: 'prefers bullet points' },
  })
  const publishedSecond = await store.publish({
    proposalId: second.proposal.id,
    expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000050' },
    expectedLivePublicationId: publishedFirst.id,
  })
  await assert.rejects(store.rollback({
    restoredFromPublicationId: 'pub_00000000000000000000000000000000',
    ownerRef: LAPUTA_REF,
  }), error => error.code === 'EVOLUTION_ROLLBACK_TARGET_INVALID')
  await assert.rejects(store.rollback({
    restoredFromPublicationId: publishedSecond.id,
    expectedLivePublicationId: publishedSecond.id,
    ownerRef: LAPUTA_REF,
  }), error => error.code === 'EVOLUTION_ROLLBACK_TARGET_INVALID', 'restoring what is already live is not a rollback')
  const rowsBefore = countRows(store, 'publication')
  const reverted = await store.rollback({
    restoredFromPublicationId: publishedFirst.id,
    expectedLivePublicationId: publishedSecond.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000051' },
    reason: '新版更啰嗦，回到 r000042',
  })
  assert.equal(reverted.created, true)
  assert.match(reverted.id, /^pub_[0-9a-f]{32}$/)
  assert.equal(reverted.record.purpose, 'rollback')
  assert.equal(reverted.record.state, 'live')
  assert.equal(reverted.record.restoredFromPublicationId, publishedFirst.id)
  assert.equal(reverted.record.supersedesPublicationId, publishedSecond.id)
  assert.equal(reverted.record.assetScope, publishedFirst.record.assetScope)
  assert.equal(reverted.record.validationId, null, 'a rollback carries no new validation')
  assert.equal(countRows(store, 'publication'), rowsBefore + 2,
    'a rollback appends two rows: the retired live version and the new live rollback')
  const retired = store.rawHandle().prepare('SELECT version, state FROM publication WHERE id = ? ORDER BY version')
    .all(publishedSecond.id)
  assert.deepEqual(retired.map(row => `${row.version}:${row.state}`), ['1:live', '2:rolled_back'])
  const restored = store.rawHandle().prepare('SELECT version, state, purpose FROM publication WHERE id = ? ORDER BY version')
    .all(publishedFirst.id)
  assert.deepEqual(restored.map(row => `${row.version}:${row.state}:${row.purpose}`), ['1:live:publish', '2:superseded:publish'],
    'the historical rows of the restored publication stay exactly as they were')
  const states = (await store.summary()).publicationsByState
  assert.deepEqual(states, { live: 1, rolled_back: 1, superseded: 1 })
  assert.equal((await store.verifyHistory()).ok, true)
  await assert.rejects(store.rollback({
    restoredFromPublicationId: publishedFirst.id,
    expectedLivePublicationId: reverted.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000052' },
  }), error => error.code === 'EVOLUTION_CONFLICT', 'the same target cannot be restored twice')
  assert.equal((await store.verifyHistory()).ok, true, 'the refusal left the chain intact')
})

/* ------------------------------ Task 5b: MemPalace knowledge through the owner API ------------------------------ */

function fakeOwner() {
  const commits = new Map()
  const rollbacks = new Map()
  const calls = { commit: [], rollback: [] }
  let next = 1
  const owner = {
    calls,
    async commit(input) {
      calls.commit.push(input)
      const existing = commits.get(input.commitKey)
      if (existing) return existing
      const result = { knowledgeId: 'kn_test', revision: next++, commitKey: input.commitKey, state: 'live',
        digest: digestOf({ assetScope: input.assetScope, ops: input.ops, checks: input.checks }) }
      commits.set(input.commitKey, result)
      return result
    },
    async status({ commitKeys }) {
      return { commits: commitKeys.map(key => commits.get(key)).filter(Boolean) }
    },
    // Like the real ledger, a rollback is idempotent by commitKey: a replay returns the first result.
    async rollback(input) {
      calls.rollback.push(input)
      const existing = rollbacks.get(input.commitKey)
      if (existing) return existing
      const result = { knowledgeId: 'kn_test', revision: next++, commitKey: input.commitKey, state: 'live',
        restoresRevision: input.targetRevision, digest: 'f'.repeat(64) }
      rollbacks.set(input.commitKey, result)
      return result
    },
  }
  return owner
}
const knowledgeCandidate = (object = 'tea') => ({
  assetScope: 'knowledge:conflict:vivy',
  baseRevision: 0,
  checks: { provenance: true, conflict: true, integrity: true, retrieval: true },
  ops: [{ op: 'upsert_triple', subject: 'Alice', predicate: 'likes', object }],
})
async function readyKnowledge(store, { dedupeKey, candidate = knowledgeCandidate() } = {}) {
  return readyProposal(store, { ownerKind: 'mempalace', dedupeKey, candidate, assetScope: candidate.assetScope })
}

test('publish-knowledge commits through the owner and records its reference', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const ready = await readyKnowledge(store, { dedupeKey: 'knowledge-publish' })
  const result = await store.publishKnowledge({
    proposalId: ready.proposal.id,
    expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id,
    candidate: knowledgeCandidate(),
  }, owner)
  assert.equal(owner.calls.commit.length, 1)
  assert.match(owner.calls.commit[0].commitKey, /^evo:/)
  assert.equal(result.ownerRef.knowledgeId, 'kn_test')
  assert.equal(result.record.ownerRef.revision, 1)
  assert.equal(countRows(store, 'publication'), 1)
  assert.equal(countRows(store, 'proposal'), 4, 'the proposal advanced to published')
})

test('generic publish and rollback refuse MemPalace without the owner API', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const first = await readyKnowledge(store, { dedupeKey: 'knowledge-first' })
  const published = await store.publishKnowledge({
    proposalId: first.proposal.id, expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id, candidate: knowledgeCandidate(),
  }, owner)
  await assert.rejects(store.publish({
    proposalId: first.proposal.id, expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id, ownerRef: { knowledgeId: 'kn_x', revision: 1, digest: 'a'.repeat(64) },
  }), error => error.code === 'EVOLUTION_OWNER_API_REQUIRED')
  const second = await readyKnowledge(store, { dedupeKey: 'knowledge-second', candidate: knowledgeCandidate('coffee') })
  const live = await store.publishKnowledge({
    proposalId: second.proposal.id, expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id, candidate: knowledgeCandidate('coffee'),
  }, owner)
  await assert.rejects(store.rollback({
    restoredFromPublicationId: published.record.id,
    ownerRef: { knowledgeId: 'kn_x', revision: 2, digest: 'b'.repeat(64) },
  }), error => error.code === 'EVOLUTION_OWNER_API_REQUIRED')
  assert.equal(live.record.id !== published.record.id, true)
})

test('rollback-knowledge rolls the owner back and records the new revision', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const first = await readyKnowledge(store, { dedupeKey: 'knowledge-first' })
  const published = await store.publishKnowledge({
    proposalId: first.proposal.id, expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id, candidate: knowledgeCandidate(),
  }, owner)
  const second = await readyKnowledge(store, { dedupeKey: 'knowledge-second', candidate: knowledgeCandidate('coffee') })
  const live = await store.publishKnowledge({
    proposalId: second.proposal.id, expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id, candidate: knowledgeCandidate('coffee'),
  }, owner)
  const rolled = await store.rollbackKnowledge({
    restoredFromPublicationId: published.record.id,
    expectedLiveDigest: live.record.digest,
  }, owner)
  assert.equal(owner.calls.rollback.length, 1)
  assert.equal(owner.calls.rollback[0].targetRevision, published.record.ownerRef.revision)
  assert.equal(rolled.record.purpose, 'rollback')
  assert.equal(rolled.record.ownerRef.revision, 3)
})

test('a rolled-back owner revision is never recorded as a live publication', async t => {
  const store = await makeStore(t)
  const base = fakeOwner()
  const dead = { ...base, async commit(input) { return { ...(await base.commit(input)), state: 'rolled_back' } } }
  const ready = await readyKnowledge(store, { dedupeKey: 'knowledge-dead-revision' })
  await assert.rejects(store.publishKnowledge({
    proposalId: ready.proposal.id, expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id, candidate: knowledgeCandidate(),
  }, dead), error => error.code === 'EVOLUTION_OWNER_FAILED')
  assert.equal(countRows(store, 'publication'), 0)
  assert.equal(countRows(store, 'proposal'), 3, 'the proposal stays validated')
})

test('an expectedLiveDigest that disagrees with the live publication conflicts before the owner commits', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const first = await readyKnowledge(store, { dedupeKey: 'knowledge-digest-first' })
  await store.publishKnowledge({
    proposalId: first.proposal.id, expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id, candidate: knowledgeCandidate(),
  }, owner)
  const second = await readyKnowledge(store, { dedupeKey: 'knowledge-digest-second', candidate: knowledgeCandidate('coffee') })
  const commitsBefore = owner.calls.commit.length
  await assert.rejects(store.publishKnowledge({
    proposalId: second.proposal.id, expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id, candidate: knowledgeCandidate('coffee'),
    expectedLiveDigest: '0'.repeat(64),
  }, owner), error => error.code === 'EVOLUTION_CONFLICT')
  assert.equal(owner.calls.commit.length, commitsBefore, 'the digest CAS runs before the owner write')
})

test('publish-knowledge forwards the caller anchor so the store re-checks it after the owner commit', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const first = await readyKnowledge(store, { dedupeKey: 'knowledge-anchor-first' })
  const published = await store.publishKnowledge({
    proposalId: first.proposal.id, expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id, candidate: knowledgeCandidate(),
  }, owner)
  const second = await readyKnowledge(store, { dedupeKey: 'knowledge-anchor-second', candidate: knowledgeCandidate('coffee') })
  const seen = []
  const original = store.publish
  store.publish = async function (input, options) {
    seen.push(input)
    return original.call(store, input, options)
  }
  try {
    await store.publishKnowledge({
      proposalId: second.proposal.id, expectedProposalDigest: second.proposal.digest,
      validationId: second.validation.id, candidate: knowledgeCandidate('coffee'),
      expectedLivePublicationId: published.record.id,
    }, owner)
  } finally {
    delete store.publish
  }
  assert.equal(seen.length, 1)
  assert.equal(seen[0].expectedLivePublicationId, published.record.id)
  assert.equal(Object.hasOwn(seen[0], 'expectedLiveDigest'), false, 'an omitted digest anchor must not be forwarded')
})

test('a failed rollback record is reconciled by retrying with the same commitKey', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const first = await readyKnowledge(store, { dedupeKey: 'knowledge-retry-first' })
  const published = await store.publishKnowledge({
    proposalId: first.proposal.id, expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id, candidate: knowledgeCandidate(),
  }, owner)
  const second = await readyKnowledge(store, { dedupeKey: 'knowledge-retry-second', candidate: knowledgeCandidate('coffee') })
  const live = await store.publishKnowledge({
    proposalId: second.proposal.id, expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id, candidate: knowledgeCandidate('coffee'),
  }, owner)
  store.rollback = async () => { throw new Error('publication write failed') }
  try {
    await assert.rejects(store.rollbackKnowledge({ restoredFromPublicationId: published.record.id }, owner),
      error => error.code === 'EVOLUTION_OWNER_FAILED')
  } finally {
    delete store.rollback
  }
  assert.equal(owner.calls.rollback.length, 1, 'the owner rollback itself succeeded; only the record failed')
  const retried = await store.rollbackKnowledge({ restoredFromPublicationId: published.record.id }, owner)
  assert.equal(retried.created, true)
  assert.equal(retried.record.purpose, 'rollback')
  assert.equal(retried.record.restoredFromPublicationId, published.record.id)
  assert.equal(owner.calls.rollback.length, 2)
  assert.equal(owner.calls.rollback[1].commitKey, owner.calls.rollback[0].commitKey,
    'the retry replays the owner rollback under the same key instead of appending another revision')
  assert.equal(owner.calls.rollback[1].targetRevision, owner.calls.rollback[0].targetRevision)
  assert.equal(retried.record.supersedesPublicationId, live.record.id)
  assert.equal(retried.record.ownerRef.revision, 3,
    'the retry records the revision the first owner rollback already produced')
  const rollbackRows = store.rawHandle().prepare("SELECT count(*) AS n FROM publication WHERE purpose = 'rollback'").get()
  assert.equal(Number(rollbackRows.n), 1, 'exactly one rollback publication exists after the retry')
  const states = (await store.summary()).publicationsByState
  assert.deepEqual(states, { live: 1, rolled_back: 1, superseded: 1 })
})

test('a failed owner reference compensates the commit and records nothing', async t => {
  const store = await makeStore(t)
  const base = fakeOwner()
  const broken = { ...base, async commit(input) { await base.commit(input); return { revision: 1, digest: 'a'.repeat(64) } } }
  const ready = await readyKnowledge(store, { dedupeKey: 'knowledge-broken' })
  await assert.rejects(store.publishKnowledge({
    proposalId: ready.proposal.id, expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id, candidate: knowledgeCandidate(),
  }, broken), error => error.code === 'EVOLUTION_OWNER_FAILED')
  assert.equal(base.calls.rollback.length, 1)
  assert.equal(base.calls.rollback[0].assetScope, 'knowledge:conflict:vivy',
    'the compensation uses the validated proposal scope, not an optional owner echo')
  assert.equal(base.calls.rollback[0].targetRevision, 0)
  assert.equal(countRows(store, 'publication'), 0)
  assert.equal(countRows(store, 'proposal'), 3, 'the proposal stays validated')
})

test('an owner RPC error is reconciled through status, never retried', async t => {
  const store = await makeStore(t)
  const base = fakeOwner()
  let attempts = 0
  const flaky = {
    ...base,
    async commit(input) { attempts += 1; const result = await base.commit(input); throw Object.assign(new Error('socket hang up'), { result }) },
    async status(args) { return base.status(args) },
  }
  const ready = await readyKnowledge(store, { dedupeKey: 'knowledge-flaky' })
  const result = await store.publishKnowledge({
    proposalId: ready.proposal.id, expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id, candidate: knowledgeCandidate(),
  }, flaky)
  assert.equal(attempts, 1)
  assert.equal(result.ownerRef.revision, 1)
  assert.equal(countRows(store, 'publication'), 1)
})

test('verifyHistory recomputes digests, links and guards', async t => {
  const store = await makeStore(t)
  const { proposal, validation, assetScope } = await readyProposal(store)
  await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  const clean = await store.verifyHistory()
  assert.equal(clean.ok, true)
  assert.equal(clean.integrityCheck, 'ok')
  assert.equal(clean.rows, 7, 'one evidence, four proposal versions, one validation, one publication')
  assert.deepEqual(clean.missingTriggers, [])
  assert.deepEqual(clean.digestMismatches, [])
  assert.deepEqual(clean.linkIssues, [])
  assert.equal((await store.verifyHistory({ limit: 1 })).rows, 1, 'the sweep is bounded for the panel')
  const second = await readyProposal(store, {
    dedupeKey: 'seed-2',
    assetScope: 'persona:vivy:other',
    candidate: { ...CANDIDATE, text: 'prefers bullet points' },
  })
  await store.advanceProposal({
    proposalId: second.proposal.id, toState: 'superseded', expectedProposalDigest: second.proposal.digest,
  })
  assert.equal((await store.verifyHistory()).ok, true, 'a superseded proposal is still a healthy record')
  assert.equal(assetScope, 'persona:vivy:soul')
})

test('verifyHistory reports a record whose stored digest no longer matches', async t => {
  const home = tempHome(t)
  const store = await makeStore(t, { home })
  const { proposal, validation } = await readyProposal(store)
  await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  await store.close()
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(home, 'evolution', 'evolution.db'))
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('DROP TRIGGER proposal_no_update')
  db.prepare('UPDATE proposal SET summary = ? WHERE id = ? AND version = 1').run('被改写过', proposal.id)
  db.close()
  const reopened = await openEvolutionStore({ home, env: { DSH_HOME: home }, subject: SUBJECT })
  t.after(async () => { await reopened.close() })
  const report = await reopened.verifyHistory()
  assert.equal(report.ok, false)
  assert.ok(report.digestMismatches.some(item => item.table === 'proposal' && item.id === proposal.id),
    JSON.stringify(report.digestMismatches))
  assert.equal(reopened.rawHandle().prepare('SELECT summary FROM proposal WHERE id = ? AND version = 1').get(proposal.id).summary,
    '被改写过', 'the store reports the tampering instead of hiding it')
})

/* ------------------------------------ Task 6: queries and HTTP ------------------------------------ */

test('getRecord reads the head version and can replay the whole history', async t => {
  const store = await makeStore(t)
  const { evidenceId, proposal, validation } = await readyProposal(store)
  const published = await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  const head = await store.getRecord(proposal.id)
  assert.equal(head.kind, 'proposal')
  assert.equal(head.record.version, 4, 'the newest version row is the current state')
  assert.equal(head.record.state, 'published')
  const history = await store.getRecord(proposal.id, { history: true })
  assert.deepEqual(history.history.map(row => `${row.version}:${row.state}`),
    ['1:proposed', '2:validating', '3:validated', '4:published'], 'every step stays readable in order')
  assert.equal((await store.getRecord(evidenceId)).kind, 'evidence')
  assert.equal((await store.getRecord(validation.id)).kind, 'validation')
  assert.equal((await store.getRecord(published.id)).kind, 'publication')
  assert.deepEqual(await store.getRecord('prop_0000000000000000000000000000'), null, 'a missing id is null, not a throw')
})

test('listByTicket groups every kind that shares one ticket', async t => {
  const store = await makeStore(t)
  const { evidenceId, proposal, validation } = await readyProposal(store)
  const published = await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  const group = await store.listByTicket('T-9')
  assert.equal(group.ticketId, 'T-9')
  assert.deepEqual(group.evidence.map(item => item.id), [evidenceId])
  assert.deepEqual(group.proposals.map(item => item.id), [proposal.id])
  assert.deepEqual(group.validations.map(item => item.id), [validation.id])
  assert.deepEqual(group.publications.map(item => item.id), [published.id])
  const empty = await store.listByTicket('T-404')
  assert.deepEqual([empty.evidence, empty.proposals, empty.validations, empty.publications], [[], [], [], []])
  const only = await store.listByTicket('T-9', { kinds: ['proposal'] })
  assert.deepEqual(Object.keys(only).filter(key => Array.isArray(only[key])), ['proposals'])
  assert.equal(only.proposals.length, 1)
})

test('a ticket query walks the index instead of scanning the history', async t => {  const store = await makeStore(t)
  await readyProposal(store)
  const db = store.rawHandle()
  for (const [kind, sql] of Object.entries(TICKET_SQL)) {
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('T-9', SUBJECT).map(row => String(row.detail))
    const scanned = plan.filter(detail => /SCAN /.test(detail))
    assert.deepEqual(scanned, [], `${kind} must not scan: ${plan.join(' | ')}`)
    assert.ok(plan.some(detail => /USING (?:PARTIAL )?INDEX/.test(detail)), `${kind} plan: ${plan.join(' | ')}`)
  }
})

test('records of another subject never surface in a query', async t => {
  const store = await makeStore(t)
  const { evidenceId, proposal } = await readyProposal(store)
  const foreign = 'subject_00000000-0000-4000-8000-000000000000'
  store.rawHandle().prepare(`INSERT INTO evidence (id, version, subject_id, ticket_id, source, summary, refs, derived_from,
    external_id, dedupe_key, digest, schema_version, provenance, created_at)
    VALUES ('ev_foreign', 1, ?, 'T-9', 'dsh_session', '别人的证据', '{"sessionId":"other"}', '[]', NULL, 'dk-foreign', ?, 1,
      '{"source":"test"}', '2026-11-04T00:00:00.000Z')`).run(foreign, 'a'.repeat(64))
  const group = await store.listByTicket('T-9')
  assert.deepEqual(group.evidence.map(item => item.id), [evidenceId], 'only this subject rows come back')
  assert.ok(!JSON.stringify(group).includes('ev_foreign'), 'a foreign subject row never shows up')
  assert.equal((await store.listEvidence()).total, 1)
  assert.equal((await store.listProposals()).items[0].id, proposal.id)
})

test('listing proposals filters by state and clamps the page size', async t => {
  const store = await makeStore(t)
  const seeds = []
  for (const dedupeKey of ['a', 'b', 'c']) {
    seeds.push(await readyProposal(store, { dedupeKey, assetScope: `persona:vivy:${dedupeKey}` }))
  }
  await store.publish({
    proposalId: seeds[0].proposal.id,
    expectedProposalDigest: seeds[0].proposal.digest,
    validationId: seeds[0].validation.id,
    ownerRef: LAPUTA_REF,
  })
  const published = await store.listProposals({ state: 'published' })
  assert.deepEqual(published.items.map(item => item.id), [seeds[0].proposal.id])
  assert.equal(published.total, 1)
  const validated = await store.listProposals({ state: 'validated' })
  assert.deepEqual(validated.items.map(item => item.id).sort(), [seeds[1].proposal.id, seeds[2].proposal.id].sort())
  const clamped = await store.listProposals({ limit: 9999 })
  assert.equal(clamped.limit, MAX_PAGE_LIMIT, 'the page size is capped, not silently ignored')
  assert.equal(clamped.items.length, 3, 'only the newest head per id is listed')
  const page = await store.listProposals({ limit: 1, offset: 1 })
  assert.equal(page.items.length, 1)
  assert.equal(page.total, 3, 'total counts the heads that match, not every version row')
  const byOwner = await store.listProposals({ ownerKind: 'laputa' })
  assert.equal(byOwner.total, 3)
  assert.equal((await store.listProposals({ ownerKind: 'actmem' })).total, 0)
})

test('listing publications and validations keeps one row per record', async t => {
  const store = await makeStore(t)
  const first = await readyProposal(store)
  const publishedFirst = await store.publish({
    proposalId: first.proposal.id,
    expectedProposalDigest: first.proposal.digest,
    validationId: first.validation.id,
    ownerRef: LAPUTA_REF,
  })
  const second = await readyProposal(store, {
    dedupeKey: 'seed-2',
    candidate: { ...CANDIDATE, text: 'prefers bullet points' },
  })
  const publishedSecond = await store.publish({
    proposalId: second.proposal.id,
    expectedProposalDigest: second.proposal.digest,
    validationId: second.validation.id,
    ownerRef: { ...LAPUTA_REF, revision: 'r000050' },
    expectedLivePublicationId: publishedFirst.id,
  })
  assert.equal(countRows(store, 'publication'), 3, 'one retired version row exists besides the heads')
  const all = await store.listPublications()
  assert.equal(all.total, 2)
  assert.deepEqual(all.items.map(item => item.id).sort(), [publishedFirst.id, publishedSecond.id].sort())
  const live = await store.listPublications({ state: 'live' })
  assert.deepEqual(live.items.map(item => item.id), [publishedSecond.id])
  assert.equal((await store.listPublications({ purpose: 'rollback' })).total, 0)
  const forProposal = await store.listValidations({ proposalId: first.proposal.id })
  assert.deepEqual(forProposal.items.map(item => item.id), [first.validation.id])
  assert.equal(forProposal.items[0].verdict, 'passed')
  assert.equal(forProposal.items[0].proposalDigest, first.proposal.digest)
  assert.ok(Array.isArray(forProposal.items[0].checks))
  assert.equal((await store.listValidations({ proposalId: 'prop_missing' })).total, 0)
  const evidence = await store.listEvidence({ source: 'dsh_session' })
  assert.equal(evidence.total, 2)
  assert.equal(evidence.items[0].refs.sessionKey, 'vivy-main')
  assert.equal((await store.listEvidence({ source: 'dream' })).total, 0)
})

function httpFixture(store, options = {}) {
  const dshHome = options.dshHome ?? resolve('.artifacts/test-tmp')
  let handler
  const warnings = []
  const ctx = {
    get: name => (name === 'connection' ? { requestRejection: options.requestRejection ?? (() => undefined) } : undefined),
    logger: { warn: message => warnings.push(message) },
    configEditor: { entries: () => [], documentPath: join(dshHome, 'cordis.patch.yml') },
    webServer: { register(route) { handler = route.handler; return () => {} } },
  }
  const dispose = registerEvolutionHttp(ctx, { dshHome, store, publishOwner: options.publishOwner })
  async function request(path, { method = 'GET', body, raw, host = '127.0.0.1:3082', origin, contentType, headers = {} } = {}) {
    const req = Readable.from(raw !== undefined ? [raw] : body !== undefined ? [JSON.stringify(body)] : [])
    Object.assign(req, {
      url: `/dsh-evolution/api${path}`,
      method,
      headers: {
        host,
        ...headers,
        ...(origin ? { origin } : {}),
        ...(contentType ? { 'content-type': contentType } : body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
      },
    })
    let status
    let text
    await handler(req, { writeHead: code => { status = code }, end: value => { text = value } })
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { data = text }
    return { status, data }
  }
  return { request, dispose, warnings, ctx }
}

test('GET /store describes the database without ever failing the panel', async t => {
  const store = await makeStore(t)
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  const response = await request('/store')
  assert.equal(response.status, 200)
  assert.equal(response.data.available, true)
  assert.equal(response.data.subjectId, SUBJECT)
  assert.equal(response.data.schemaVersion, EVOLUTION_SCHEMA_VERSION)
  assert.equal(response.data.journalMode, 'wal')
  assert.equal(response.data.minSupportedSchema, MIN_SUPPORTED_SCHEMA)
  assert.equal(response.data.triggers.length, APPEND_TRIGGERS.length + DOMAIN_TRIGGERS.length)
  assert.ok(response.data.dir.endsWith('evolution'))
})

test('an unreadable store still answers /store and /overview with a hint', async t => {
  const home = tempHome(t)
  const store = createLazyEvolutionStore({
    home,
    env: { DSH_HOME: home },
    subject: SUBJECT,
    importModule: async () => { throw new Error('No such built-in module: node:sqlite') },
  })
  const { request, dispose } = httpFixture(store, { dshHome: home })
  t.after(dispose)
  const status = await request('/store')
  assert.equal(status.status, 200, 'a broken store degrades instead of throwing the panel out')
  assert.equal(status.data.available, false)
  assert.equal(status.data.code, 'EVOLUTION_SQLITE_UNAVAILABLE')
  assert.ok(status.data.hint.includes('Node'))
  const overview = await request('/overview')
  assert.equal(overview.status, 200)
  assert.equal(overview.data.snapshot.evolution.available, false)
  const list = await request('/evidence')
  assert.equal(list.status, 503, 'a read that needs rows reports the store as unavailable')
  assert.equal(list.data.code, 'EVOLUTION_SQLITE_UNAVAILABLE')
  assert.ok(list.data.hint)
})

test('the record routes keep the loopback, origin and session guards', async t => {
  const store = await makeStore(t)
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  assert.equal((await request('/proposals')).status, 200)
  assert.equal((await request('/proposals', { host: 'example.com' })).data.code, 'HOST_REJECTED')
  assert.equal((await request('/proposals', { host: 'example.com' })).status, 403)
  const crossed = await request('/evidence', { method: 'POST', body: {}, origin: 'http://evil.example' })
  assert.equal(crossed.status, 403)
  assert.equal(crossed.data.code, 'ORIGIN_REJECTED')
  assert.equal((await request('/proposals', { origin: 'http://evil.example' })).status, 200, 'GET stays readable cross-site')
  const rejected = httpFixture(store, { requestRejection: () => 401 })
  t.after(rejected.dispose)
  const blocked = await rejected.request('/proposals')
  assert.equal(blocked.status, 401, 'a numeric rejection from the connection service is passed through')
  assert.equal(blocked.data.code, 'AUTH_REJECTED')
  assert.ok(blocked.data.hint)
})

test('POST /evidence and GET /evidence round-trip one record', async t => {
  const store = await makeStore(t)
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  const written = await request('/evidence', { method: 'POST', body: {
    source: 'dsh_session',
    ticketId: 'T-31',
    summary: 'Vivy 连续三次把答案写得太长',
    refs: { sessionKey: 'vivy-main', turn: 7 },
    provenance: { actor: 'operator:dsh' },
  } })
  assert.equal(written.status, 200, JSON.stringify(written.data))
  assert.equal(written.data.ok, true)
  assert.equal(written.data.created, true)
  assert.match(written.data.record.id, /^ev_[0-9a-f]{32}$/)
  const replay = await request('/evidence', { method: 'POST', body: {
    source: 'dsh_session',
    ticket_id: 'T-31',
    summary: 'Vivy 连续三次把答案写得太长',
    refs: { sessionKey: 'vivy-main', turn: 7 },
    provenance: { actor: 'operator:dsh' },
  } })
  assert.equal(replay.data.created, false, 'the snake_case body maps onto the same dedupe key')
  assert.equal(replay.data.record.id, written.data.record.id)
  const read = await request('/evidence?ticket_id=T-31')
  assert.equal(read.data.total, 1)
  assert.equal(read.data.items[0].refs.turn, 7)
  assert.equal(read.data.items[0].provenance.actor, 'operator:dsh')
})

test('the write routes reject junk bodies and stale expectations', async t => {
  const store = await makeStore(t)
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  const noJson = await request('/proposal', { method: 'POST', raw: '{}', contentType: 'text/plain' })
  assert.equal(noJson.status, 415)
  assert.equal(noJson.data.code, 'JSON_REQUIRED')
  const missing = await request('/proposal', { method: 'POST', body: { summary: '没有证据的候选' } })
  assert.equal(missing.status, 422)
  assert.ok(['EVOLUTION_INVALID_RECORD', 'EVOLUTION_TICKET_REQUIRED'].includes(missing.data.code), JSON.stringify(missing.data))
  assert.ok(missing.data.hint)
  assert.equal(countRows(store, 'proposal'), 0)
  const evidence = await request('/evidence', { method: 'POST', body: {
    source: 'dsh_session', ticketId: 'T-32', summary: '一段真实的观察', refs: { sessionKey: 'vivy-main' },
  } })
  const created = await request('/proposal', { method: 'POST', body: {
    ticketId: 'T-32',
    candidateKind: 'persona',
    ownerKind: 'laputa',
    assetScope: 'persona:vivy:soul',
    candidate: CANDIDATE,
    summary: '把回答压得更短',
    evidenceIds: [evidence.data.record.id],
  } })
  assert.equal(created.status, 200, JSON.stringify(created.data))
  assert.equal(created.data.record.state, 'proposed')
  const stale = await request('/proposal', { method: 'POST', body: {
    proposalId: created.data.record.id,
    toState: 'validated',
    expectedProposalDigest: 'f'.repeat(64),
  } })
  assert.equal(stale.status, 409, 'a stale digest is a conflict, not a server error')
  assert.ok(stale.data.hint.includes('digest'))
  assert.equal(created.data.record.version, 1)
  const advanced = await request('/proposal', { method: 'POST', body: {
    proposalId: created.data.record.id,
    toState: 'validating',
    expectedProposalDigest: created.data.digest,
  } })
  assert.equal(advanced.status, 200)
  assert.equal(advanced.data.record.version, 2)
  const badState = await request('/proposal', { method: 'POST', body: {
    proposalId: created.data.record.id, toState: 'published', expectedProposalDigest: advanced.data.digest,
  } })
  assert.equal(badState.status, 409, 'a skipped state is a conflict the caller must re-read for')
  assert.equal(badState.data.code, 'EVOLUTION_CONFLICT')
  assert.ok(badState.data.hint.includes('validated'))
  const publish = await request('/publish', { method: 'POST', body: {
    proposalId: created.data.record.id,
    expectedProposalDigest: advanced.data.digest,
    validationId: 'val_0000000000000000000000000000',
    ownerRef: LAPUTA_REF,
  } })
  assert.equal(publish.status, 422)
  assert.equal(publish.data.code, 'EVOLUTION_VALIDATION_REQUIRED')
  assert.ok(publish.data.hint)
})

test('the panel can follow one ticket end to end through the API', async t => {
  const store = await makeStore(t)
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  const chain = async (dedupeKey, text) => {
    const evidence = await request('/evidence', { method: 'POST', body: {
      source: 'dsh_session', ticketId: 'T-40', summary: text, refs: { sessionKey: 'vivy-main' }, dedupeKey,
    } })
    const proposal = await request('/proposal', { method: 'POST', body: {
      ticketId: 'T-40',
      candidateKind: 'persona',
      ownerKind: 'laputa',
      assetScope: 'persona:vivy:soul',
      candidate: { ...CANDIDATE, text },
      summary: text,
      evidenceIds: [evidence.data.record.id],
    } })
    const validating = await request('/proposal', { method: 'POST', body: {
      proposalId: proposal.data.record.id, toState: 'validating', expectedProposalDigest: proposal.data.digest,
    } })
    const validated = await request('/proposal', { method: 'POST', body: {
      proposalId: validating.data.record.id, toState: 'validated', expectedProposalDigest: validating.data.digest,
    } })
    const validation = await request('/validation', { method: 'POST', body: {
      proposalId: validated.data.record.id,
      proposalDigest: validated.data.digest,
      candidateDigest: validated.data.record.candidateDigest,
      checks: OWNERS.laputa.minChecks.map(kind => ({ kind, verdict: 'passed' })),
      verdict: 'passed',
      runner: 'laputa-baseline',
    } })
    assert.equal(validation.status, 200, JSON.stringify(validation.data))
    const published = await request('/publish', { method: 'POST', body: {
      proposalId: validated.data.record.id,
      expectedProposalDigest: validated.data.digest,
      validationId: validation.data.record.id,
      ownerRef: { personaId: 'vivy', revision: `r0000${dedupeKey}`, contentDigest: validated.data.record.candidateDigest },
    } })
    assert.equal(published.status, 200, JSON.stringify(published.data))
    return { proposal: proposal.data.record, published: published.data.record }
  }
  const first = await chain('a', '第一次进化')
  const second = await chain('b', '第二次进化')
  const grouped = await request('/records?ticket_id=T-40')
  assert.equal(grouped.status, 200)
  assert.equal(grouped.data.evidence.length, 2)
  assert.equal(grouped.data.proposals.length, 2)
  assert.equal(grouped.data.publications.length, 2)
  assert.deepEqual(grouped.data.proposals.map(item => item.state), ['published', 'published'])
  const oneKind = await request('/records?ticket_id=T-40&kind=publication&state=live')
  assert.equal(oneKind.data.publications.length, 1, 'only the newest live publication per asset survives the state filter')
  assert.equal(oneKind.data.evidence, undefined)
  const missingTicket = await request('/records')
  assert.equal(missingTicket.status, 400)
  assert.equal(missingTicket.data.code, 'INVALID_FIELD')
  const detail = await request(`/proposal?id=${second.proposal.id}&history=1`)
  assert.equal(detail.status, 200)
  assert.equal(detail.data.record.kind, 'proposal')
  assert.equal(detail.data.record.history.length, 4)
  const missing = await request('/proposal?id=prop_0000000000000000000000000000')
  assert.equal(missing.status, 404)
  assert.equal(missing.data.code, 'EVOLUTION_NOT_FOUND')
  const reverted = await request('/rollback', { method: 'POST', body: {
    restoredFromPublicationId: first.published.id,
    expectedLivePublicationId: second.published.id,
    ownerRef: { personaId: 'vivy', revision: 'r0000a', contentDigest: first.published.candidateDigest },
    reason: '第二版更啰嗦',
  } })
  assert.equal(reverted.status, 200, JSON.stringify(reverted.data))
  assert.equal(reverted.data.record.purpose, 'rollback')
  const summary = await request('/summary')
  assert.equal(summary.data.publicationsByState.live, 1, 'one live publication per asset, the rollback')
  assert.equal(summary.data.counts.publication, 5, 'history only grows: two publishes, one retirement each, one rollback')
  assert.equal((await request('/nope')).status, 404)
})

test('GET /verify sweeps the store and clamps its budget', async t => {
  const store = await makeStore(t)
  const { proposal, validation } = await readyProposal(store)
  await store.publish({
    proposalId: proposal.id,
    expectedProposalDigest: proposal.digest,
    validationId: validation.id,
    ownerRef: LAPUTA_REF,
  })
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  const full = await request('/verify')
  assert.equal(full.status, 200)
  assert.equal(full.data.verify.ok, true)
  assert.equal(full.data.verify.rows, 7)
  assert.deepEqual(full.data.verify.linkIssues, [])
  const bounded = await request('/verify?limit=1')
  assert.equal(bounded.data.verify.rows, 1)
  assert.equal(bounded.data.verify.truncated, true)
  assert.equal((await request('/verify?limit=-5')).data.verify.rows, 7, 'a junk limit falls back to the full sweep')
})

test('a body over the ceiling is refused with 413 and nothing is written', async t => {
  const store = await makeStore(t)
  const { request, dispose } = httpFixture(store)
  t.after(dispose)
  const huge = await request('/evidence', { method: 'POST', raw: `{"summary":"${'x'.repeat(300 * 1024)}"}` })
  assert.equal(huge.status, 413)
  assert.equal(countRows(store, 'evidence'), 0)
})

test('POST /publish-knowledge and /rollback-knowledge use the configured owner', async t => {
  const store = await makeStore(t)
  const owner = fakeOwner()
  const ready = await readyKnowledge(store, { dedupeKey: 'knowledge-http' })
  const { request, dispose } = httpFixture(store, { publishOwner: owner })
  t.after(dispose)
  const published = await request('/publish-knowledge', { method: 'POST', body: {
    proposalId: ready.proposal.id, expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id, candidate: knowledgeCandidate(),
  } })
  assert.equal(published.status, 200)
  assert.equal(published.data.ownerRef.knowledgeId, 'kn_test')
  const refused = await request('/publish', { method: 'POST', body: {
    proposalId: ready.proposal.id, expectedProposalDigest: ready.proposal.digest,
    validationId: ready.validation.id, ownerRef: { knowledgeId: 'kn_x', revision: 1, digest: 'a'.repeat(64) },
  } })
  assert.equal(refused.status, 409)
  assert.equal(refused.data.code, 'EVOLUTION_OWNER_API_REQUIRED')
})
