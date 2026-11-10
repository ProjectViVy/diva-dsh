import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ARCHIVE_SCHEMA_VERSION, archiveDigest } from '../plugins/_shared/archive-contract.mjs'
import { callComponent } from '../plugins/_shared/ipc.mjs'
import { normalizeArchiveOutConfig, createArchiveOutbox } from '../plugins/memory/src/archive-out.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { startMemoryMaintenance } from '../plugins/memory/src/maintenance.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'

const SUBJECT = 'subject_11111111-1111-4111-8111-111111111111'
const OTHER = 'subject_22222222-2222-4222-8222-222222222222'
const NOW = Date.parse('2026-02-01T00:00:00.000Z')
const base = resolve('.artifacts/test-tmp')

function tempState(t) {
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'memory-archive-outbox-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const stateDir = join(dir, 'memory')
  const dataDir = join(stateDir, 'data')
  mkdirSync(dataDir, { recursive: true })
  return { dir, stateDir, dataDir, fullJsonl: join(dataDir, 'memory-card-full.jsonl'), retiredJsonl: join(dataDir, 'memory-card-retired.jsonl'), outboxDir: join(dataDir, 'archive-outbox') }
}

function recordLine(overrides = {}) {
  return JSON.stringify({
    id: 'mem_alpha',
    revision: 1,
    text: '一起看过的星星',
    platform: 'qq',
    tags: [],
    kind: 'event',
    importance: 60,
    createdAt: '2026-01-01T00:00:00.000Z',
    conversationKey: 'qq:group:1',
    provenance: { source: 'qq', at: '2026-01-01T00:00:00.000Z' },
    archivedAt: '2026-01-02T00:00:00.000Z',
    clarity: 'vivid',
    ...overrides,
  })
}

function append(env, ...lines) {
  appendFileSync(env.fullJsonl, lines.map(line => `${line}\n`).join(''), { mode: 0o600 })
}

/** 投递来源是退役账本：只有退色/被淘汰的记录会走到这里。 */
function appendRetired(env, ...lines) {
  appendFileSync(env.retiredJsonl, lines.map(line => `${line}\n`).join(''), { mode: 0o600 })
}

function makeBox(env, { send, subject = async () => SUBJECT, config = {}, now = () => NOW } = {}) {
  return createArchiveOutbox({ stateDir: env.stateDir, ledgerJsonl: env.fullJsonl, config: () => config, subject, send, log() {}, now })
}

function pendingFiles(env) {
  try { return readdirSync(join(env.outboxDir, 'pending')).filter(name => name.endsWith('.json')).sort() } catch { return [] }
}

function conflictFiles(env) {
  try { return readdirSync(join(env.outboxDir, 'conflict')).filter(name => name.endsWith('.json')).sort() } catch { return [] }
}

function readIntent(env, archiveId = 'arch_mem_alpha_r1') {
  return JSON.parse(readFileSync(join(env.outboxDir, 'pending', `${archiveId}.json`), 'utf8'))
}

function readReceipts(env) {
  try {
    return readFileSync(join(env.outboxDir, 'receipts.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  } catch { return [] }
}

const absent = body => ({ ok: true, states: body.archive_ids.map(archiveId => ({ archive_id: archiveId, state: 'absent' })) })
const accept = body => ({
  ok: true,
  results: body.items.map(item => ({
    archive_id: item.archive_id,
    state: 'archived',
    digest: item.digest,
    receipt: { archive_id: item.archive_id, digest: item.digest, memory_ids: [`arc_${item.archive_id}_c0`], chunks: 1, subject_id: body.subject_id, received_at: new Date(NOW).toISOString() },
  })),
})

function recorder({ status = absent, archive = accept } = {}) {
  const calls = []
  const send = async (path, body) => {
    calls.push({ path, body })
    if (path === '/archive/status') return status(body)
    if (path === '/archive') return archive(body)
    throw new Error(`unexpected archive route ${path}`)
  }
  return { calls, send }
}

test('the first sweep picks up the whole retired ledger instead of skipping it', async t => {
  const env = tempState(t)
  append(env, recordLine({ id: 'mem_old', text: '旧记录' }), recordLine({ id: 'mem_older', text: '更旧的记录' }))
  const box = makeBox(env, { send: () => { throw new Error('sweep must not send') } })
  const first = await box.sweep()
  assert.equal(first.ok, true)
  assert.equal(first.intents, 2)
  assert.equal(box.status().pending, 2)

  append(env, recordLine({ id: 'mem_new', text: '新归档的记忆', revision: 3, platform: 'bili', tags: ['owner'], kind: 'promise', importance: 80, conversationKey: 'bili:42' }))
  const swept = await box.sweep()
  assert.equal(swept.intents, 1)
  assert.deepEqual(pendingFiles(env), ['arch_mem_new_r3.json', 'arch_mem_old_r1.json', 'arch_mem_older_r1.json'])
  const intent = readIntent(env, 'arch_mem_new_r3')
  assert.equal(intent.archive_id, 'arch_mem_new_r3')
  assert.equal(intent.subject_id, SUBJECT)
  assert.equal(intent.content, '新归档的记忆')
  assert.equal(intent.meta.project, 'owner')
  assert.equal(intent.meta.topic, 'promise')
  assert.equal(intent.meta.session_id, 'bili:42')
  assert.equal(intent.meta.importance, 0.8)
  assert.equal(intent.meta.revision, 3)
  assert.equal(intent.digest, archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, archive_id: intent.archive_id, content: intent.content, meta: intent.meta }))
  assert.equal(box.status().scanOffset, readFileSync(env.fullJsonl).length)
})

test('a sweep that finds an unwritten intent reconciles before sending and never double-writes', async t => {
  const env = tempState(t)
  const box = makeBox(env, { send: () => { throw new Error('no transport expected') } })
  await box.sweep()
  append(env, recordLine({ id: 'mem_crash' }))
  await box.sweep()
  assert.deepEqual(pendingFiles(env), ['arch_mem_crash_r1.json'])

  const calls = []
  const recovered = makeBox(env, { send: async (path, body) => {
    calls.push(path)
    if (path === '/archive/status') return { ok: true, states: [{ archive_id: body.archive_ids[0], state: 'archived', digest: readIntent(env, body.archive_ids[0]).digest, memory_ids: ['arc_crash_c0'], chunks: 1 }] }
    throw new Error('an already archived intent must not be sent again')
  } })
  const result = await recovered.drain()
  assert.equal(result.ok, true)
  assert.deepEqual(calls, ['/archive/status'])
  assert.equal(pendingFiles(env).length, 0)
  assert.equal(conflictFiles(env).length, 0)
  assert.equal(readReceipts(env).length, 1)
  assert.equal(readReceipts(env)[0].archive_id, 'arch_mem_crash_r1')
})

test('a transport failure keeps the intent, backs off and leaves the local archive untouched', async t => {
  const env = tempState(t)
  const cardFile = join(env.dataDir, 'memory-card.json')
  writeFileSync(cardFile, '{"records":[]}', { mode: 0o600 })
  const box = makeBox(env, { send: () => { throw new Error('not used') } })
  await box.sweep()
  append(env, recordLine({ id: 'mem_offline' }))
  await box.sweep()
  const beforeFull = readFileSync(env.fullJsonl)
  const beforeCard = readFileSync(cardFile)

  let clock = NOW
  const offline = new Error('mempalace is unavailable')
  offline.code = 'MEMPALACE_UNAVAILABLE'
  offline.hint = '运行 npm run setup:mempalace 后重启'
  const failing = makeBox(env, { send: async () => { throw offline }, now: () => clock })
  const result = await failing.drain()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'MEMPALACE_UNAVAILABLE')
  assert.equal(pendingFiles(env).length, 1)
  assert.deepEqual(readFileSync(env.fullJsonl), beforeFull)
  assert.deepEqual(readFileSync(cardFile), beforeCard)
  const intent = readIntent(env, 'arch_mem_offline_r1')
  assert.equal(intent.attempts, 1)
  assert.ok(intent.next_attempt_at > NOW)
  const status = failing.status()
  assert.equal(status.pending, 1)
  assert.equal(status.lastError.code, 'MEMPALACE_UNAVAILABLE')
  assert.equal(status.lastError.hint, '运行 npm run setup:mempalace 后重启')

  clock = intent.next_attempt_at - 1
  assert.deepEqual(await failing.drain(), { ok: true, skipped: 'backoff' })
})

test('a conflicting digest is quarantined and never retried automatically', async t => {
  const env = tempState(t)
  const box = makeBox(env, { send: () => { throw new Error('not used') } })
  await box.sweep()
  append(env, recordLine({ id: 'mem_conflict' }))
  await box.sweep()

  const sent = []
  let clock = NOW
  const conflicting = makeBox(env, { send: async (path, body) => {
    sent.push(path)
    return { ok: true, states: [{ archive_id: body.archive_ids[0], state: 'archived', digest: 'f'.repeat(64), memory_ids: ['arc_other_c0'], chunks: 1 }] }
  }, now: () => clock })
  const first = await conflicting.drain()
  assert.equal(first.ok, true)
  assert.deepEqual(sent, ['/archive/status'])
  assert.deepEqual(conflictFiles(env), ['arch_mem_conflict_r1.json'])
  assert.equal(pendingFiles(env).length, 0)
  assert.equal(conflicting.status().conflicts, 1)
  assert.equal(conflicting.status().pending, 0)
  const conflict = JSON.parse(readFileSync(join(env.outboxDir, 'conflict', 'arch_mem_conflict_r1.json'), 'utf8'))
  assert.equal(conflict.conflict.code, 'ACTMEM_ARCHIVE_DIGEST_CONFLICT')

  clock += 3_600_000
  await conflicting.drain()
  assert.deepEqual(sent, ['/archive/status'], 'quarantined intents must not be retried')
})

test('a receipt is written before the intent is removed so a crash cannot lose proof', async t => {
  const env = tempState(t)
  const box = makeBox(env, { send: () => { throw new Error('not used') } })
  await box.sweep()
  append(env, recordLine({ id: 'mem_receipt' }))
  await box.sweep()
  const intent = readIntent(env, 'arch_mem_receipt_r1')

  mkdirSync(join(env.outboxDir, 'receipts.jsonl'))
  let clock = NOW
  const send = async (path, body) => {
    if (path === '/archive/status') return { ok: true, states: [{ archive_id: body.archive_ids[0], state: 'archived', digest: intent.digest, memory_ids: ['arc_receipt_c0'], chunks: 1 }] }
    throw new Error('no archive write expected')
  }
  const failing = makeBox(env, { send, now: () => clock })
  const failed = await failing.drain()
  assert.equal(failed.ok, false)
  assert.equal(pendingFiles(env).length, 1)
  assert.equal(failing.status().lastError.code, 'ACTMEM_ARCHIVE_RECEIPT_WRITE_FAILED')

  rmSync(join(env.outboxDir, 'receipts.jsonl'), { recursive: true, force: true })
  clock += 3_600_000
  const recovered = makeBox(env, { send, now: () => clock })
  await recovered.drain()
  assert.equal(pendingFiles(env).length, 0)
  assert.deepEqual(readReceipts(env).map(receipt => receipt.archive_id), ['arch_mem_receipt_r1'])
})

test('maxPending stops at the current line without losing it or skipping ahead', async t => {
  const env = tempState(t)
  const config = {}
  const box = makeBox(env, { send: () => { throw new Error('not used') }, config })
  await box.sweep()
  const first = recordLine({ id: 'mem_limit_a' })
  const second = recordLine({ id: 'mem_limit_b' })
  append(env, first, second)
  config.maxPending = 1
  const result = await box.sweep()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'ACTMEM_ARCHIVE_BACKLOG_FULL')
  assert.deepEqual(pendingFiles(env), ['arch_mem_limit_a_r1.json'])
  assert.equal(box.status().scanOffset, Buffer.byteLength(`${first}\n`, 'utf8'))

  config.maxPending = 10
  await box.sweep()
  assert.deepEqual(pendingFiles(env), ['arch_mem_limit_a_r1.json', 'arch_mem_limit_b_r1.json'])
})

test('batchLimit and batchBytes bound each delivery batch', async t => {
  const env = tempState(t)
  const config = {}
  const box = makeBox(env, { send: () => { throw new Error('not used') }, config })
  await box.sweep()
  append(env, recordLine({ id: 'mem_batch_a' }), recordLine({ id: 'mem_batch_b' }), recordLine({ id: 'mem_batch_c' }))
  await box.sweep()
  assert.equal(pendingFiles(env).length, 3)

  const calls = []
  const sender = recorder({ status: absent, archive: body => { calls.push(body); return accept(body) } })
  config.batchLimit = 1
  let clock = NOW
  const limited = makeBox(env, { send: sender.send, config, now: () => clock })
  await limited.drain()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].items.length, 1)
  assert.equal(pendingFiles(env).length, 2)

  config.batchLimit = 50
  config.batchBytes = 4096
  clock += 1
  const byteLimited = makeBox(env, { send: sender.send, config, now: () => clock })
  await byteLimited.drain()
  const last = calls[calls.length - 1]
  assert.ok(last.items.length >= 1)
  assert.ok(Buffer.byteLength(JSON.stringify(last.items), 'utf8') <= 4096 + 4096, 'a single oversized item is sent alone, never dropped')
})

test('sweep ignores invalid lines, counts them and still delivers later valid ones', async t => {
  const env = tempState(t)
  const box = makeBox(env, { send: () => { throw new Error('not used') } })
  await box.sweep()
  append(env,
    '{not json',
    recordLine({ id: '', text: '没有 id' }),
    recordLine({ id: 'mem_no_provenance', provenance: undefined }),
    recordLine({ id: 'bad id', text: '非法标识' }),
    recordLine({ id: 'mem_valid' }))
  const result = await box.sweep()
  assert.equal(result.ok, true)
  assert.equal(result.invalid, 4)
  assert.equal(box.status().invalid, 4)
  assert.deepEqual(pendingFiles(env), ['arch_mem_valid_r1.json'])
  assert.equal(box.status().scanOffset, readFileSync(env.fullJsonl).length)

  const sender = recorder()
  const delivering = makeBox(env, { send: sender.send })
  await delivering.drain()
  assert.equal(pendingFiles(env).length, 0)
  assert.equal(readReceipts(env).length, 1)
})

test('a trailing partial line is not consumed until it is complete', async t => {
  const env = tempState(t)
  const box = makeBox(env, { send: () => { throw new Error('not used') } })
  await box.sweep()
  const first = recordLine({ id: 'mem_complete' })
  const second = recordLine({ id: 'mem_partial' })
  append(env, first)
  appendFileSync(env.fullJsonl, second.slice(0, 25), { mode: 0o600 })
  await box.sweep()
  assert.deepEqual(pendingFiles(env), ['arch_mem_complete_r1.json'])
  assert.equal(box.status().scanOffset, Buffer.byteLength(`${first}\n`, 'utf8'))

  appendFileSync(env.fullJsonl, `${second.slice(25)}\n`, { mode: 0o600 })
  await box.sweep()
  assert.deepEqual(pendingFiles(env), ['arch_mem_complete_r1.json', 'arch_mem_partial_r1.json'])
  assert.equal(box.status().scanOffset, readFileSync(env.fullJsonl).length)
})

test('subject problems fail closed and cross-subject intents are quarantined', async t => {
  const env = tempState(t)
  const working = makeBox(env, { send: () => { throw new Error('not used') } })
  await working.sweep()
  append(env, recordLine({ id: 'mem_subject' }))
  await working.sweep()

  const unavailable = new Error('subject unavailable')
  unavailable.code = 'SUBJECT_UNAVAILABLE'
  const noSubject = makeBox(env, { send: () => { throw new Error('must not send') }, subject: async () => { throw unavailable } })
  const failed = await noSubject.drain()
  assert.equal(failed.ok, false)
  assert.equal(failed.code, 'SUBJECT_UNAVAILABLE')
  assert.equal(pendingFiles(env).length, 1)

  const pendingPath = join(env.outboxDir, 'pending', 'arch_mem_subject_r1.json')
  const intent = JSON.parse(readFileSync(pendingPath, 'utf8'))
  writeFileSync(pendingPath, JSON.stringify({ ...intent, subject_id: OTHER }), { mode: 0o600 })
  const calls = []
  const mismatched = makeBox(env, { send: async (path, body) => { calls.push(path); return absent(body) } })
  const result = await mismatched.drain()
  assert.equal(result.ok, true)
  assert.deepEqual(calls, [])
  assert.deepEqual(conflictFiles(env), ['arch_mem_subject_r1.json'])
  assert.equal(JSON.parse(readFileSync(join(env.outboxDir, 'conflict', 'arch_mem_subject_r1.json'), 'utf8')).conflict.code, 'ACTMEM_ARCHIVE_SUBJECT_MISMATCH')
})

test('configuration is normalized, visible and free of a second scheduler', async t => {
  const defaults = normalizeArchiveOutConfig({})
  assert.deepEqual(defaults, {
    enabled: true,
    batchLimit: 50,
    batchBytes: 200000,
    statusLimit: 200,
    baseDelayMs: 60000,
    maxDelayMs: 1800000,
    maxAttempts: 0,
    maxPending: 10000,
  })
  const clamped = normalizeArchiveOutConfig({ enabled: false, batchLimit: 0, batchBytes: 1, statusLimit: 9999, baseDelayMs: 1, maxDelayMs: 1, maxAttempts: -5, maxPending: 0 })
  assert.equal(clamped.enabled, false)
  assert.equal(clamped.batchLimit, 1)
  assert.equal(clamped.batchBytes, 4096)
  assert.equal(clamped.statusLimit, 200)
  assert.equal(clamped.baseDelayMs, 1000)
  assert.equal(clamped.maxDelayMs, 1000)
  assert.equal(clamped.maxAttempts, 0)
  assert.equal(clamped.maxPending, 1)

  const env = tempState(t)
  const box = makeBox(env, { send: () => { throw new Error('not used') }, config: { enabled: false } })
  assert.deepEqual(await box.sweep(), { ok: true, skipped: 'disabled' })
  assert.deepEqual(await box.drain(), { ok: true, skipped: 'disabled' })
  assert.equal(box.status().enabled, false)
  assert.equal(box.status().config.statusLimit, 200)

  const source = readFileSync(new URL('../plugins/memory/src/archive-out.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /setInterval|setTimeout/)
})

function serviceBox(env, send, overrides = {}) {
  return createMemoryService({ stateDir: env.stateDir, subject: async () => SUBJECT, archiveSend: send, ...overrides })
}

test('the memory service delivers new archive lines through status and archive', async t => {
  const env = tempState(t)
  const calls = []
  const send = async (path, body) => {
    calls.push(path)
    if (path === '/archive/status') return { ok: true, states: body.archive_ids.map(archiveId => ({ archive_id: archiveId, state: 'absent' })) }
    return {
      ok: true,
      results: body.items.map(item => ({
        archive_id: item.archive_id,
        state: 'archived',
        digest: item.digest,
        receipt: { archive_id: item.archive_id, digest: item.digest, memory_ids: ['arc_service_c0'], chunks: 1, subject_id: body.subject_id, received_at: new Date(NOW).toISOString() },
      })),
    }
  }
  const service = serviceBox(env, send)
  t.after(() => service.dispose())
  await service.drainArchives()
  appendRetired(env, recordLine({ id: 'mem_service' }))
  await service.drainArchives()
  assert.deepEqual(calls, ['/archive/status', '/archive'])
  const status = await service.archiveStatus()
  assert.equal(status.archiveOut.pending, 0)
  assert.equal(status.archiveOut.receipts, 1)
  const snapshot = await service.snapshot()
  assert.equal(snapshot.archiveOut.enabled, true)
  assert.equal(typeof snapshot.archiveOut.pending, 'number')
})

test('archive status projects outbox state and honors archiveOut.enabled=false', async t => {
  const env = tempState(t)
  writeFileSync(join(env.stateDir, 'config.json'), JSON.stringify({ archiveOut: { enabled: false } }), { mode: 0o600 })
  const calls = []
  const service = serviceBox(env, async path => { calls.push(path); return { ok: true } })
  t.after(() => service.dispose())
  const status = await service.archiveStatus()
  for (const key of ['pending', 'conflicts', 'receipts', 'invalid', 'lastError', 'nextAttemptAt', 'scanOffset', 'config']) {
    assert.ok(Object.hasOwn(status.archiveOut, key), `archiveOut should expose ${key}`)
  }
  assert.equal(status.archiveOut.enabled, false)
  appendRetired(env, recordLine({ id: 'mem_disabled' }))
  assert.deepEqual(await service.drainArchives(), { ok: true, skipped: 'disabled' })
  assert.deepEqual(calls, [])
  assert.equal((await service.archiveStatus()).archiveOut.pending, 0)
})

test('maintenance drains archives on both schedules and stops when disposed', async () => {
  const calls = [], callbacks = []
  const timers = { setTimeout: fn => (callbacks.push(fn), callbacks.length), setInterval: fn => (callbacks.push(fn), callbacks.length), clearTimeout() {}, clearInterval() {} }
  const service = {
    maintenance: async () => { calls.push('maintain') },
    notifyOwnerIfNeeded: async () => ({ ok: true }),
    autoSyncQqFeed: async () => { calls.push('qq') },
    autoRefreshBili: async () => { calls.push('bili') },
    drainArchives: async () => { calls.push('drain') },
  }
  const stop = startMemoryMaintenance(service, { timers, log() {} })
  await callbacks[0]()
  assert.deepEqual(calls, ['maintain', 'drain', 'qq', 'bili', 'drain'])
  calls.length = 0
  await callbacks[1]()
  assert.deepEqual(calls, ['maintain', 'drain'])
  calls.length = 0
  stop()
  await callbacks[2]()
  assert.deepEqual(calls, [])
})

test('a hanging archive delivery does not block card writes', async t => {
  const env = tempState(t)
  let release, entered
  const waiting = new Promise(resolve => { release = resolve })
  const started = new Promise(resolve => { entered = resolve })
  const send = async (path, body) => {
    if (path === '/archive/status') {
      entered()
      await waiting
      return { ok: true, states: body.archive_ids.map(archiveId => ({ archive_id: archiveId, state: 'absent' })) }
    }
    return {
      ok: true,
      results: body.items.map(item => ({
        archive_id: item.archive_id,
        state: 'archived',
        digest: item.digest,
        receipt: { archive_id: item.archive_id, digest: item.digest, memory_ids: ['arc_async_c0'], chunks: 1, subject_id: body.subject_id, received_at: new Date(NOW).toISOString() },
      })),
    }
  }
  const service = serviceBox(env, send)
  t.after(async () => { release(); await service.dispose() })
  await service.drainArchives()
  appendRetired(env, recordLine({ id: 'mem_async' }))
  const draining = service.drainArchives()
  await started
  const recorded = await service.record({ id: 'write-during-drain', platform: 'qq', text: '卡片写入不被归档投递阻塞' })
  assert.equal(recorded.ok, true)
  release()
  await draining
})

test('archive outbox operations are reachable through component IPC and keep ACTMEM codes', async t => {
  const env = tempState(t)
  const fake = {
    archiveOutStatus: () => ({ ok: true, pending: 2, conflicts: 0 }),
    drainArchives: async () => {
      const error = new Error('待投递归档过多')
      error.code = 'ACTMEM_ARCHIVE_BACKLOG_FULL'
      error.hint = '先让 MemPalace 恢复再重试'
      throw error
    },
  }
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, env.dir, fake)
  t.after(dispose)
  const status = await callComponent({ home: env.dir, name: 'memory', path: '/archive-out/status' })
  assert.equal(status.pending, 2)
  await assert.rejects(
    () => callComponent({ home: env.dir, name: 'memory', path: '/archive-out/drain', body: {} }),
    error => error.code === 'ACTMEM_ARCHIVE_BACKLOG_FULL' && error.hint === '先让 MemPalace 恢复再重试',
  )
})
