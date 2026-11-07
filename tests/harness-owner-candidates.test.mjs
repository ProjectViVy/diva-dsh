/**
 * E4-S7 — Harness owner candidates reach Evolution as Evidence + Proposal.
 *
 * The harness plans edits of kinds another component owns (prompt/memory/
 * subagent). It must not write them, and it must not drop them either: this
 * suite drives the real `registerComponentInternal` loopback transport with the
 * real Evolution record store, so the contract between the two components is
 * exercised as it runs (only `fetch` is routed to the registered handler).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'

import { callComponent } from '../plugins/_shared/ipc.mjs'
import { registerEvolutionInternal } from '../plugins/dsh-evolution/src/internal.mjs'
import { CANDIDATE_OWNERS, createLazyEvolutionStore } from '../plugins/dsh-evolution/src/records.mjs'
import {
  forwardAppliedOwnerCandidates,
  ownerCandidateDedupeKey,
  ownerCandidateDigest,
  ownerCandidateOf,
  pendingCandidatesPath,
  retryPendingOwnerCandidates,
} from '../plugins/dsh-continual-harness/src/owner-candidates.ts'

const SUBJECT = 'subject_2f6a5e4b-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const CANDIDATE_BODY = 'HARNESS-CANDIDATE-BODY-must-never-be-stored'

function tempDir(t, prefix) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Mount the real Evolution internal endpoint over a real lazy record store and
 * return a caller that routes `fetch` to the registered loopback handler.
 */
async function mountEvolution(t, home) {
  const store = createLazyEvolutionStore({ home, env: { DSH_HOME: home }, subject: SUBJECT })
  t.after(() => store.close())
  const routes = []
  const dispose = registerEvolutionInternal({
    webServer: { port: 3082, register: route => { routes.push(route); return () => {} } },
  }, home, store)
  t.after(dispose)
  const call = request => callComponent({
    ...request,
    fetchImpl: async (url, options) => {
      const pathname = new URL(url).pathname
      const route = routes.find(item => pathname.startsWith(item.path))
      const req = Readable.from(options.body === undefined ? [] : [options.body])
      Object.assign(req, { url: pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
      let status
      let body
      await route.handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
      return new Response(body, { status })
    },
  })
  return { store, call }
}

/** One committed refinement carrying edits of kinds other components own. */
function refinementOf(edits, overrides = {}) {
  return {
    id: 'refine_1700000000000',
    summary: 'the planner wants a cross-domain improvement',
    committedAt: '2026-11-04T00:00:00.000Z',
    scope: 'local',
    appliedEdits: edits,
    ...overrides,
  }
}

/**
 * The record the owner gate leaves behind: the direct write was refused, and
 * the snapshot fields are exactly what must never leave the harness.
 */
function refusedEdit(kind, id, extra = {}) {
  return {
    action: 'create',
    kind,
    id,
    applied: false,
    blastRadius: 'project',
    error: `kind ${kind} is owned by someone else; use its proposal flow`,
    after: CANDIDATE_BODY,
    ...extra,
  }
}

test('the owner-candidate map is the one Evolution enforces', () => {
  for (const [kind, expected] of [['prompt', 'behaviour_prompt'], ['memory', 'active_memory'], ['subagent', 'subagent']]) {
    const candidate = ownerCandidateOf(kind)
    assert.equal(candidate?.candidateKind, expected)
    assert.equal(CANDIDATE_OWNERS[candidate?.candidateKind], candidate?.ownerKind,
      `${kind} 的候选所有者必须与 Evolution 的 CANDIDATE_OWNERS 一致`)
  }
  assert.equal(ownerCandidateOf('skill'), undefined)
})

test('the internal endpoint opens the store lazily and only behind the component token', async t => {
  const home = tempDir(t, 'harness-owner-lazy-')
  const { store, call } = await mountEvolution(t, home)
  assert.equal(store.isOpen(), false, 'registering the endpoint must not open the database')
  assert.ok(!existsSync(store.paths.file), 'mounting must not create the database file')
  assert.ok(existsSync(join(home, 'evolution', 'runtime.json')), 'the loopback discovery file is published')
  await assert.rejects(call({ home, name: 'evolution', path: '/evidence', body: { source: 'nope', summary: 'x', refs: { a: 1 } } }),
    error => error.code === 'EVOLUTION_SOURCE_NOT_ALLOWED',
    '领域错误码必须透传，不能降级成 COMPONENT_REQUEST_FAILED')
  assert.deepEqual((await store.listEvidence()).items, [], '被拒的写入不留任何行')
})

test('a refused cross-domain edit becomes one Evidence and one Proposal, digest only', async t => {
  const home = tempDir(t, 'harness-owner-forward-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const { store, call } = await mountEvolution(t, home)
  const refinement = refinementOf([refusedEdit('prompt', 'plan-style')])

  const report = await forwardAppliedOwnerCandidates({
    home,
    harnessRoot,
    refinement,
    ticketId: 'T-42',
    refs: { sessionKey: 'sess-1', turn: 7 },
    call,
  })
  assert.deepEqual(report, { forwarded: 1, deferred: 0, failed: 0 })

  const evidence = (await store.listEvidence()).items
  const proposals = (await store.listProposals()).items
  assert.equal(evidence.length, 1, '恰好一条 Evidence')
  assert.equal(proposals.length, 1, '恰好一条 Proposal')
  assert.equal(evidence[0].source, 'dsh_session')
  assert.equal(evidence[0].dedupeKey, ownerCandidateDedupeKey({ refinementId: refinement.id, kind: 'prompt', editId: 'plan-style' }))
  assert.deepEqual(evidence[0].refs, { sessionKey: 'sess-1', turn: 7, refinementId: refinement.id })
  assert.equal(evidence[0].ticketId, 'T-42')
  assert.equal(proposals[0].ticketId, evidence[0].ticketId, '一条进化链上的 ticket 必须一致')
  assert.equal(proposals[0].candidateKind, 'behaviour_prompt')
  assert.equal(proposals[0].ownerKind, 'prompt_owner')
  assert.equal(proposals[0].assetScope, 'local')
  assert.deepEqual(proposals[0].evidenceIds, [evidence[0].id])
  assert.equal(proposals[0].candidateDigest, ownerCandidateDigest(refinement.summary))
  assert.ok(/^[0-9a-f]{64}$/.test(proposals[0].candidateDigest), '候选只以 64 位摘要入库')
  const stored = JSON.stringify({ evidence, proposals })
  assert.ok(!stored.includes(CANDIDATE_BODY), '候选正文绝不入库')
  assert.ok(!stored.includes('after'), '记录的快照字段不随候选外流')
  assert.ok(!existsSync(pendingCandidatesPath(harnessRoot)), '交付成功后不留待办')
})

test('every owned kind in one refinement is handed over separately', async t => {
  const home = tempDir(t, 'harness-owner-kinds-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const { store, call } = await mountEvolution(t, home)
  const refinement = refinementOf([
    refusedEdit('prompt', 'plan-style'),
    refusedEdit('memory', 'deploy-failure'),
    refusedEdit('subagent', 'research'),
    refusedEdit('skill', 'reusable-flow'),
    refusedEdit('memory', 'deleted-legacy', { action: 'delete', reason: 'cleanup' }),
  ])

  const report = await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement, ticketId: 'T-7', call })
  assert.deepEqual(report, { forwarded: 3, deferred: 0, failed: 0 }, 'skill 与删除不是跨域候选')
  const proposals = (await store.listProposals()).items
  assert.deepEqual(proposals.map(item => item.candidateKind).sort(), ['active_memory', 'behaviour_prompt', 'subagent'])
  assert.equal((await store.listEvidence()).items.length, 3)
})

test('a missing ticket writes the ledger, raises nothing, and creates no Proposal', async t => {
  const home = tempDir(t, 'harness-owner-defer-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const { store, call } = await mountEvolution(t, home)
  const refinement = refinementOf([refusedEdit('memory', 'deploy-failure')])

  const report = await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement, call })
  assert.deepEqual(report, { forwarded: 0, deferred: 1, failed: 0 })
  assert.equal((await store.listProposals()).items.length, 0, '缺 ticket 不建 Proposal')
  assert.equal((await store.listEvidence()).items.length, 0, '缺 ticket 也不先落一条孤立 Evidence')

  const file = pendingCandidatesPath(harnessRoot)
  assert.ok(existsSync(file), '待办必须落盘')
  const lines = readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '')
  assert.equal(lines.length, 1)
  const pending = JSON.parse(lines[0])
  assert.deepEqual(
    { refinementId: pending.refinementId, kind: pending.kind, editId: pending.editId, summary: pending.summary, scope: pending.scope },
    { refinementId: refinement.id, kind: 'memory', editId: 'deploy-failure', summary: refinement.summary, scope: 'local' },
  )
  assert.ok(!('after' in pending) && !lines[0].includes(CANDIDATE_BODY), '待办也不得写入候选正文')
})

test('the pending ledger drains on the next forward and the file is deleted', async t => {
  const home = tempDir(t, 'harness-owner-drain-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const { store, call } = await mountEvolution(t, home)
  const deferred = refinementOf([refusedEdit('prompt', 'plan-style')])
  const later = refinementOf([refusedEdit('subagent', 'research')], { id: 'refine_1700000000001', summary: 'later plan' })

  assert.deepEqual(await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement: deferred, call }),
    { forwarded: 0, deferred: 1, failed: 0 })
  const report = await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement: later, ticketId: 'T-9', call })
  assert.deepEqual(report, { forwarded: 2, deferred: 0, failed: 0 }, '先 drain 旧待办，再交付本次候选')

  assert.equal((await store.listProposals()).items.length, 2)
  const evidence = (await store.listEvidence()).items
  assert.deepEqual(evidence.map(item => item.dedupeKey).sort(), [
    ownerCandidateDedupeKey({ refinementId: deferred.id, kind: 'prompt', editId: 'plan-style' }),
    ownerCandidateDedupeKey({ refinementId: later.id, kind: 'subagent', editId: 'research' }),
  ].sort())
  assert.ok(evidence.every(item => item.ticketId === 'T-9'), 'drain 用本次调用给出的 ticket 交付')
  assert.ok(!existsSync(pendingCandidatesPath(harnessRoot)), 'drain 清空后删除意图文件')
})

test('replaying the same candidate adds no second row', async t => {
  const home = tempDir(t, 'harness-owner-replay-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const { store, call } = await mountEvolution(t, home)
  const refinement = refinementOf([refusedEdit('prompt', 'plan-style')])

  const first = await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement, ticketId: 'T-1', call })
  const second = await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement, ticketId: 'T-1', call })
  assert.deepEqual(first, { forwarded: 1, deferred: 0, failed: 0 })
  assert.deepEqual(second, { forwarded: 1, deferred: 0, failed: 0 })
  assert.equal((await store.listEvidence()).items.length, 1, 'dedupeKey 让重放不再落第二行')
  assert.equal((await store.listProposals()).items.length, 1, 'candidateDigest 让重放不再落第二个候选')
})

test('an unavailable Evolution defers the ticket-bearing candidate and load drains it', async t => {
  const home = tempDir(t, 'harness-owner-retry-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const refinement = refinementOf([refusedEdit('prompt', 'plan-style')])

  const first = await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement, ticketId: 'T-3' })
  assert.deepEqual(first, { forwarded: 0, deferred: 1, failed: 0 }, '交付不出去就留待办，绝不静默丢弃')
  assert.ok(existsSync(pendingCandidatesPath(harnessRoot)))

  const { store, call } = await mountEvolution(t, home)
  const drained = await retryPendingOwnerCandidates({ home, harnessRoot, call })
  assert.deepEqual(drained, { forwarded: 1, deferred: 0, failed: 0 })
  assert.equal((await store.listProposals()).items[0]?.ticketId, 'T-3')
  assert.ok(!existsSync(pendingCandidatesPath(harnessRoot)))
})

test('a candidate with no ticket is left for a later call that has one', async t => {
  const home = tempDir(t, 'harness-owner-keep-')
  const harnessRoot = join(home, 'harness')
  mkdirSync(harnessRoot, { recursive: true })
  const refinement = refinementOf([refusedEdit('prompt', 'plan-style')])
  await forwardAppliedOwnerCandidates({ home, harnessRoot, refinement })

  const drained = await retryPendingOwnerCandidates({ home, harnessRoot })
  assert.deepEqual(drained, { forwarded: 0, deferred: 0, failed: 0 })
  assert.ok(existsSync(pendingCandidatesPath(harnessRoot)), '没有 ticket 的重试不动待办')
})

test('the harness never reads or writes the Evolution database', () => {
  const forbidden = /evolution\.db|DSH_EVOLUTION_STATE_DIR|dsh-evolution\/src\/records/
  const offenders = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.ts$/.test(entry.name) && forbidden.test(readFileSync(path, 'utf8'))) offenders.push(path)
    }
  }
  walk(resolve('plugins/dsh-continual-harness/src'))
  assert.deepEqual(offenders, [], 'Harness 只能经组件 IPC 触达进化记录')
})

test('an unregistered component name is still refused', async t => {
  const home = tempDir(t, 'harness-owner-unknown-')
  await assert.rejects(callComponent({ home, name: 'unknown-component', path: '/records' }), /Unknown component/)
})
