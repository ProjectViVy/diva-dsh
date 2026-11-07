import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { callComponent } from '../plugins/_shared/ipc.mjs'
import { ARCHIVE_SCHEMA_VERSION, archiveDigest } from '../plugins/_shared/archive-contract.mjs'
import { commitArchive, queryArchive, readArchiveRequest } from '../plugins/dsh-mempalace/src/archive.mjs'
import { registerMempalaceInternal } from '../plugins/dsh-mempalace/src/internal.mjs'

const SUBJECT = 'subject_11111111-1111-4111-8111-111111111111'
const NOW = Date.parse('2026-02-01T00:00:00.000Z')

function tempHome(t, prefix) {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

function itemOf({ archiveId = 'arch_mem_a_r1', content = '一起看过的星星', meta } = {}) {
  const record = { archive_id: archiveId, content, meta: meta ?? {
    project: 'qq', topic: '星星', timestamp: '2026-01-01T00:00:00.000Z', session_id: 'mem_a', importance: 0.6, revision: 1,
    provenance: { source: 'qq', at: '2026-01-01T00:00:00.000Z' },
  } }
  return { ...record, digest: archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, ...record }) }
}

/** Archive state machine over an in-memory ledger, so the wire contract is testable without native modules. */
function fakeArchiveService({ subjectId = SUBJECT, degrade = null } = {}) {
  const rows = new Map()
  const store = {
    writes: 0,
    async findArchiveById(id) { return rows.get(id) ?? null },
    async insertArchive(item) {
      store.writes += 1
      rows.set(item.archive_id, { archive_id: item.archive_id, digest: item.digest, subject_id: item.subject_id, memory_ids: ['arc_x_c0'], chunks: 1, received_at: item.received_at })
      return { memory_ids: ['arc_x_c0'], chunks: 1 }
    },
  }
  const calls = []
  const service = {
    store, calls,
    async archiveCommit(body) {
      calls.push('commit')
      if (degrade) throw degrade
      const request = readArchiveRequest(body, { subjectId })
      return commitArchive(store, { subjectId: request.subjectId, items: request.items, now: NOW })
    },
    async archiveStatus(archiveIds) {
      calls.push('status')
      if (degrade) throw degrade
      return queryArchive(store, { archiveIds })
    },
  }
  return service
}

async function withLoopback(t, service, home) {
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => server.close(done)))
  const dispose = registerMempalaceInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(dispose)
  return { port: server.address().port }
}

const requestOf = items => ({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, items })

test('the archive endpoint is loopback-authenticated like every other component', async t => {
  const home = tempHome(t, 'mempalace-archive-auth-')
  const service = fakeArchiveService()
  await withLoopback(t, service, home)
  const discovery = JSON.parse(readFileSync(join(home, 'mempalace', 'runtime.json'), 'utf8'))
  const post = async (token, extraHeaders = {}) => (await fetch(`${discovery.baseUrl}/dsh-mempalace/internal/archive`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-component-token': token } : {}), ...extraHeaders },
    body: JSON.stringify(requestOf([itemOf()])),
  })).json()
  assert.equal((await post()).code, 'COMPONENT_AUTH')
  assert.equal((await post('deadbeef')).code, 'COMPONENT_AUTH')
  assert.equal((await post(discovery.token, { origin: 'http://127.0.0.1:3082' })).code, 'COMPONENT_ORIGIN')
  assert.equal(service.store.writes, 0)
  assert.equal((await post(discovery.token)).results[0].state, 'archived')
})

test('archive delivery over component IPC is idempotent and reports conflicts', async t => {
  const home = tempHome(t, 'mempalace-archive-ipc-')
  const service = fakeArchiveService()
  await withLoopback(t, service, home)
  const item = itemOf()
  const first = await callComponent({ home, name: 'mempalace', path: '/archive', body: requestOf([item]) })
  assert.equal(first.results[0].state, 'archived')
  assert.equal(first.results[0].receipt.memory_ids[0], 'arc_x_c0')
  const replay = await callComponent({ home, name: 'mempalace', path: '/archive', body: requestOf([item]) })
  assert.equal(replay.results[0].state, 'duplicate')
  assert.equal(service.store.writes, 1)
  const changed = { ...item, content: '改写过的正文', digest: archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: SUBJECT, archive_id: item.archive_id, content: '改写过的正文', meta: item.meta }) }
  const conflict = await callComponent({ home, name: 'mempalace', path: '/archive', body: requestOf([changed]) })
  assert.equal(conflict.results[0].state, 'conflict')
  assert.equal(conflict.results[0].code, 'MEMPALACE_ARCHIVE_DIGEST_CONFLICT')
  assert.equal(service.store.writes, 1)
  await assert.rejects(
    () => callComponent({ home, name: 'mempalace', path: '/archive', body: { ...requestOf([item]), subject_id: 'subject_22222222-2222-4222-8222-222222222222' } }),
    error => error.code === 'MEMPALACE_ARCHIVE_SUBJECT_MISMATCH' && typeof error.hint === 'string',
  )
})

test('archive status answers through IPC so recovery can check before writing', async t => {
  const home = tempHome(t, 'mempalace-archive-status-')
  const service = fakeArchiveService()
  await withLoopback(t, service, home)
  const item = itemOf()
  await callComponent({ home, name: 'mempalace', path: '/archive', body: requestOf([item]) })
  const found = await callComponent({ home, name: 'mempalace', path: '/archive/status', body: { archive_ids: [item.archive_id, 'arch_mem_gone_r1'] } })
  assert.deepEqual(found.states, [
    { archive_id: item.archive_id, state: 'archived', digest: item.digest, memory_ids: ['arc_x_c0'], chunks: 1 },
    { archive_id: 'arch_mem_gone_r1', state: 'absent' },
  ])
  assert.deepEqual(service.calls, ['commit', 'status'])
})

test('a degraded memory palace surfaces its own error code instead of a generic failure', async t => {
  const home = tempHome(t, 'mempalace-archive-degraded-')
  const service = fakeArchiveService({ degrade: Object.assign(new Error('记忆宫殿数据层不可用：native modules missing'), { code: 'MEMPALACE_UNAVAILABLE', hint: '运行 npm run setup:mempalace 后重启' }) })
  await withLoopback(t, service, home)
  await assert.rejects(
    () => callComponent({ home, name: 'mempalace', path: '/archive', body: requestOf([itemOf()]) }),
    error => error.code === 'MEMPALACE_UNAVAILABLE' && error.hint.includes('setup:mempalace'),
  )
  assert.equal(service.store.writes, 0)
})

test('unknown component paths fail closed without touching the archive store', async t => {
  const home = tempHome(t, 'mempalace-archive-unknown-')
  const service = fakeArchiveService()
  await withLoopback(t, service, home)
  await assert.rejects(
    () => callComponent({ home, name: 'mempalace', path: '/archive/unknown', body: {} }),
    error => error.code === 'COMPONENT_REQUEST_FAILED',
  )
  assert.equal(service.store.writes, 0)
  assert.deepEqual(service.calls, [])
})
