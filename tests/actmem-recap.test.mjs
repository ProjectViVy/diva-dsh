import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import test, { after } from 'node:test'

import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'

import { EXCERPT_MARKER, OMITTED_HISTORY, PENDING_LABEL, recapHistory, recentExchanges } from '../plugins/dsh-actmem-recap/src/history.mjs'
import { parseRecap, RecapParseError, renderRecap } from '../plugins/dsh-actmem-recap/src/parse.mjs'
import { buildRecapPrompt, RECAP_INSTRUCTION } from '../plugins/dsh-actmem-recap/src/prompt.mjs'
import { apply, visibleCells } from '../plugins/dsh-actmem-recap/src/index.mjs'

// Card writes go over component IPC, so the file keeps DSH_HOME inside a
// sandbox: a test run must never append to a live memory card.
process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'
const SANDBOX_HOME = mkdtempSync(join(tmpdir(), 'actmem-recap-home-'))
process.env.DSH_HOME = SANDBOX_HOME
after(() => rmSync(SANDBOX_HOME, { recursive: true, force: true }))

/** Stored records, tolerant of a store file that does not exist yet. */
function storedRecords(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').trim().split('\n').filter(line => line.length > 0).map(line => JSON.parse(line))
}

/** Chronological visible cells for a two-exchange conversation. */
const cells = [
  { kind: 'user', text: '第一问' },
  { kind: 'assistant', text: '答一' },
  { kind: 'user', text: '第二问' },
  { kind: 'assistant', text: '答二' },
]

test('history keeps at most maxTurns answered exchanges and one pending request', () => {
  const history = recapHistory([...cells, { kind: 'user', text: '第三问' }], { maxTurns: 1, maxBytes: 10_000 })
  assert.match(history, /第二问/)
  assert.match(history, /答二/)
  assert.ok(history.includes(`${PENDING_LABEL}: 第三问`))
  assert.doesNotMatch(history, /第一问/)
})

test('history merges adjacent user cells into one request', () => {
  const exchanges = recentExchanges([
    { kind: 'user', text: '先看 A' },
    { kind: 'user', text: '再看 B' },
    { kind: 'assistant', text: '好' },
  ], 8)
  assert.equal(exchanges.length, 1)
  assert.equal(exchanges[0].user, '先看 A\n\n再看 B')
})

test('history drops the oldest exchange behind an omission marker, then excerpts', () => {
  const many = []
  for (let index = 0; index < 6; index += 1) {
    many.push({ kind: 'user', text: `问 ${index} ${'x'.repeat(80)}` })
    many.push({ kind: 'assistant', text: `答 ${index} ${'y'.repeat(80)}` })
  }
  const omitted = recapHistory(many, { maxTurns: 8, maxBytes: 400 })
  assert.ok(omitted.startsWith(OMITTED_HISTORY))
  assert.ok(omitted.includes('答 5'))
  const excerpted = recapHistory(many, { maxTurns: 8, maxBytes: 900 })
  assert.ok(excerpted.includes(EXCERPT_MARKER) || excerpted.includes(OMITTED_HISTORY))
})

test('history stays inside its byte budget and cuts on code points', () => {
  const heavy = [{ kind: 'user', text: '好'.repeat(400) }, { kind: 'assistant', text: '👍'.repeat(200) }]
  for (const budget of [80, 200, 1_000, 4_000]) {
    const history = recapHistory(heavy, { maxTurns: 8, maxBytes: budget })
    assert.ok(Buffer.byteLength(history, 'utf8') <= budget, `budget ${budget}: ${Buffer.byteLength(history, 'utf8')}`)
    assert.doesNotMatch(history, /\uFFFD/)
  }
})

test('history is empty without visible exchanges', () => {
  assert.equal(recapHistory([], { maxTurns: 8, maxBytes: 1_000 }), '')
})

test('prompt carries the transcript under its budget and the JSON contract', () => {
  const { prompt, historyBytes } = buildRecapPrompt(cells, { maxTurns: 8, maxBytes: 500 })
  assert.ok(prompt.startsWith(RECAP_INSTRUCTION))
  assert.ok(prompt.includes('第二问'))
  assert.ok(prompt.endsWith('只输出 JSON。'))
  assert.ok(historyBytes <= 500)
  assert.equal(buildRecapPrompt([], { maxTurns: 8, maxBytes: 500 }).prompt, '')
})

test('parser accepts the contract, rejects unknown fields, truncates overlong text', () => {
  assert.deepEqual(parseRecap('{"summary":"做了 A","next_action":null}'), { summary: '做了 A', nextAction: null, truncated: false })
  assert.equal(parseRecap('```json\n{"summary":"做了 B","next_action":"跑测试"}\n```').nextAction, '跑测试')
  assert.equal(parseRecap('{"summary":"A"}').nextAction, null)
  assert.throws(() => parseRecap('{"summary":"A","extra":1}'), RecapParseError)
  assert.throws(() => parseRecap('{"summary":""}'), RecapParseError)
  assert.throws(() => parseRecap('不是 JSON'), RecapParseError)
  const long = parseRecap(JSON.stringify({ summary: 'x'.repeat(900), next_action: 'y'.repeat(300) }))
  assert.equal(long.summary.length, 700)
  assert.equal(long.nextAction.length, 200)
  assert.equal(long.truncated, true)
})

test('renderRecap omits the next-action line when absent', () => {
  assert.equal(renderRecap({ summary: '只有简报', nextAction: null }), '只有简报')
  assert.equal(renderRecap({ summary: '简报', nextAction: '下一步' }), '简报\n\n下一步：下一步')
})

/** One user prompt, one injected runtime-context message, one assistant step with tools. */
const events = [
  { type: 'system/message', data: { message: { content: [{ type: 'text', text: '系统提示' }] } } },
  { type: 'user/message', data: { source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: '帮我看看压缩' }] } },
  { type: 'user/message', data: { source: { kind: 'runtime-context', form: 'snapshot', sections: [] }, content: [{ type: 'text', text: 'Current working directory: ...' }] } },
  { type: 'assistant/message', data: { message: { content: [
    { type: 'reasoning', text: '内心独白' },
    { type: 'text', text: '我看了压缩链路。' },
    { type: 'tool-call', name: 'bash', arguments: '{}' },
  ] } } },
  { type: 'tool/result', data: { content: [{ type: 'text', text: '工具输出' }] } },
  { type: 'user/message', data: { source: { kind: 'time-context', form: 'snapshot', sections: [] }, content: [{ type: 'text', text: 'Time sampled...' }] } },
]

test('visibleCells keeps human prompts and assistant prose only', () => {
  const session = {
    surface: { nodes: events.map((_, index) => index) },
    eventAt: seq => events[seq],
  }
  const visible = visibleCells(session)
  assert.deepEqual(visible, [
    { kind: 'user', text: '帮我看看压缩' },
    { kind: 'assistant', text: '我看了压缩链路。' },
  ])
})

test('visibleCells falls back to the event log when no surface is exposed', () => {
  const visible = visibleCells({ snapshotEvents: () => events })
  assert.equal(visible.length, 2)
})

/** Fake cordis context: captures the registration, the listener, and the requests. */
function fakeCtx(reply) {
  const requests = []
  const listeners = []
  const commands = new Map()
  const stream = async function* (request) {
    requests.push(request)
    yield { type: 'text-delta', index: 0, text: reply.slice(0, 4) }
    yield { type: 'text-delta', index: 0, text: reply.slice(4) }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    llm: { stream },
    commands: { register: definition => { commands.set(definition.name, definition); return () => {} } },
    agents: { get: () => undefined },
    on: (type, handler) => { listeners.push({ type, handler }); return () => {} },
    effect: factory => {
      const iterator = factory()
      for (let step = iterator.next(); step.done !== true; step = iterator.next()) { /* drain registrations */ }
    },
  }
  return { ctx, requests, listeners, commands }
}

test('the /recap command generates, stores, and renders a recap', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { ctx, requests, commands } = fakeCtx('{"summary":"压缩链路看过了","next_action":"等大湿定阈值"}')
  apply(ctx, { stateDir: dir, historyMaxBytes: 4_000 })
  const invocation = {
    agent: { session: {
      id: 'session-test',
      surface: { nodes: events.map((_, index) => index) },
      eventAt: seq => events[seq],
      requestHeader: () => ({ config: { provider: 'teakapi', model: 'deepseek-v4.1-flash' } }),
      snapshotEvents: () => events,
    } },
    rawInput: '',
  }
  const result = await commands.get('recap').handler(invocation)
  assert.equal(result.kind, 'success')
  assert.match(result.text, /简报 · /)
  assert.match(result.text, /压缩链路看过了/)
  assert.match(result.text, /下一步：等大湿定阈值/)
  // Isolation: one user turn, no tools, no session system prompt.
  assert.equal(requests.length, 1)
  assert.equal(requests[0].provider, 'teakapi')
  assert.equal(requests[0].model, 'deepseek-v4.1-flash')
  assert.equal(requests[0].tools, undefined)
  assert.equal(requests[0].messages.length, 1)
  assert.equal(requests[0].messages[0].role, 'user')
  assert.doesNotMatch(requests[0].messages[0].content[0].text, /系统提示/)
  assert.doesNotMatch(requests[0].messages[0].content[0].text, /工具输出|内心独白/)
  const stored = storedRecords(join(dir, 'recaps.jsonl'))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].trigger, 'manual')
  assert.equal(stored[0].nextAction, '等大湿定阈值')
  assert.equal(stored[0].usage.outputTokens, 5)
  const last = await commands.get('recap').handler({ ...invocation, rawInput: 'last' })
  assert.match(last.text, /上次/)
  assert.match(last.text, /压缩链路看过了/)
  assert.equal((await commands.get('recap').handler({ ...invocation, rawInput: 'bogus' })).kind, 'error')
})

test('/recap reports an unusable model answer instead of storing it', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { ctx, commands } = fakeCtx('我觉得还行（没有 JSON）')
  apply(ctx, { stateDir: dir })
  const result = await commands.get('recap').handler({
    agent: { session: {
      id: 'session-bad',
      surface: { nodes: [0] },
      eventAt: () => events[1],
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      snapshotEvents: () => [events[1]],
    } },
    rawInput: '',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /没有按约定格式回答/)
})

test('the automatic schedule waits for turns, spacing, and the delay', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { ctx, listeners } = fakeCtx('{"summary":"自动简报","next_action":null}')
  apply(ctx, { stateDir: dir, auto: true, delayMs: 60_000, minCompletedTurns: 3, minTurnsBetweenRecaps: 2 })
  const session = {
    id: 'session-auto',
    surface: { nodes: events.map((_, index) => index) },
    eventAt: seq => events[seq],
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    snapshotEvents: () => events,
  }
  const emit = turn => listeners.filter(item => item.type === 'session/event').forEach(item => item.handler(session, { type: 'turn/end', data: { turn, reason: 'success' } }))
  emit(4) // seeds the clock baseline
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(storedRecords(join(dir, 'recaps.jsonl')), [])
  emit(5)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(storedRecords(join(dir, 'recaps.jsonl')), [])
  const { ctx: fastCtx, listeners: fastListeners } = fakeCtx('{"summary":"延迟到点","next_action":null}')
  apply(fastCtx, { stateDir: dir, auto: true, delayMs: 0, minCompletedTurns: 3, minTurnsBetweenRecaps: 2 })
  const emitFast = turn => fastListeners.filter(item => item.type === 'session/event').forEach(item => item.handler(session, { type: 'turn/end', data: { turn, reason: 'success' } }))
  emitFast(6)
  emitFast(7)
  emitFast(8)
  const file = join(dir, 'recaps.jsonl')
  for (let attempt = 0; attempt < 100 && storedRecords(file).length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  const records = storedRecords(file)
  assert.equal(records.length, 1)
  assert.equal(records[0].trigger, 'auto')
  assert.equal(records[0].summary, '延迟到点')
})

test('deliver: inject appends the recap to the next step context', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const injected = []
  const { ctx, listeners } = fakeCtx('{"summary":"注入用的简报","next_action":"继续"}')
  ctx.agents = { get: () => ({ inject: message => injected.push(message) }) }
  apply(ctx, { stateDir: dir, auto: true, delayMs: 0, minCompletedTurns: 3, minTurnsBetweenRecaps: 2, deliver: 'inject' })
  const session = {
    id: 'session-inject',
    surface: { nodes: events.map((_, index) => index) },
    eventAt: seq => events[seq],
    requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
    snapshotEvents: () => events,
  }
  const emit = turn => listeners.filter(item => item.type === 'session/event').forEach(item => item.handler(session, { type: 'turn/end', data: { turn, reason: 'success' } }))
  emit(3)
  emit(4)
  emit(5)
  for (let attempt = 0; attempt < 100 && injected.length === 0; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(injected.length, 1)
  assert.equal(injected[0].role, 'user')
  assert.equal(injected[0].source.kind, 'actmem-recap')
  assert.match(injected[0].content[0].text, /注入用的简报/)
  assert.match(injected[0].content[0].text, /下一步：继续/)
})

test('the card placement refuses a scope that would reach the Bilibili context', t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { ctx } = fakeCtx('{}')
  assert.throws(() => apply(ctx, { stateDir: dir, card: { scope: 'shared' } }), /Bilibili context/)
  assert.throws(() => apply(ctx, { stateDir: dir, card: { scope: 'bili' } }), /Bilibili context/)
  assert.throws(() => apply(ctx, { stateDir: dir, card: { maxChars: 5000 } }), /card\.maxChars/)
  assert.throws(() => apply(ctx, { stateDir: dir, card: { enabled: 'yes' } }), /card\.enabled/)
})

test('a recap lands in the decaying card and never in the Bilibili context', async t => {
  const home = mkdtempSync(join(tmpdir(), 'actmem-recap-card-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { process.env.DSH_HOME = previousHome; rmSync(home, { recursive: true, force: true }) })
  const service = createMemoryService({ stateDir: join(home, 'memory'), subject: async () => process.env.DSH_SUBJECT_ID })
  let handler
  const server = createServer((request, response) => { void handler(request, response) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const stop = registerMemoryInternal({
    webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } },
  }, home, service)
  t.after(() => { stop(); server.close() })

  const directory = join(home, 'actmem-recap')
  const { ctx, commands } = fakeCtx('{"summary":"把 recap 接进记忆卡了","next_action":"观察衰减"}')
  apply(ctx, { stateDir: directory, card: { enabled: true } })
  const invocation = {
    agent: { session: {
      id: 'session-card',
      surface: { nodes: events.map((_, index) => index) },
      eventAt: seq => events[seq],
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      snapshotEvents: () => events,
    } },
    rawInput: '',
  }
  const result = await commands.get('recap').handler(invocation)
  assert.equal(result.kind, 'success')
  assert.match(result.text, /已入记忆卡/)

  // The record is a private, owner-facing note: present for the owner context,
  // absent from the Bilibili context the card renders for public replies.
  const previews = await service.previews()
  assert.match(previews.qq, /把 recap 接进记忆卡了/)
  assert.doesNotMatch(previews.bili, /把 recap 接进记忆卡了/)

  const records = (await service.snapshot()).records
  const stored = records.find(record => record.text.includes('把 recap 接进记忆卡了'))
  assert.ok(stored !== undefined)
  assert.equal(stored.source, 'manual')
  assert.equal(stored.scope, 'qq')
  assert.equal(stored.platform, 'qq')
  assert.ok(stored.tags.includes('recap'))
  // No 'owner' tag: otherwise refreshInitialState promotes the earliest
  // owner-tagged record to 「和主人初次相遇」 — pinned, importance 100, no decay.
  assert.ok(!stored.tags.includes('owner'))
  assert.notEqual(stored.pinned, true)
  assert.notEqual(stored.firstMet, true)
  assert.notEqual(stored.isInitial, true)
  assert.equal(stored.importance, 45)
  assert.equal(stored.kind, 'event')
  assert.match(stored.title, /^归队简报 · /)
  assert.match(stored.text, /下一步：观察衰减/)
  const journal = storedRecords(join(directory, 'recaps.jsonl'))
  assert.equal(journal.length, 1)
  assert.equal(journal[0].cardStored, true)
  assert.equal(journal[0].cardReason, undefined)
})

test('a recap never takes the first-meeting slot; only manual designation fills it', async t => {
  const setup = async (tags) => {
    const home = mkdtempSync(join(tmpdir(), 'actmem-recap-slot-'))
    t.after(() => rmSync(home, { recursive: true, force: true }))
    const service = createMemoryService({ stateDir: join(home, 'memory'), subject: async () => process.env.DSH_SUBJECT_ID })
    await service.actmem.add({ scope: 'qq', text: '把归队简报接进衰减记忆卡', title: '归队简报 · 2026-11-05 03:17 · 第 11 轮', importance: 45, tags })
    const record = (await service.actmem.snapshot()).records[0]
    return { service, record }
  }

  // Even an owner-tagged record is not promoted any more: the automatic
  // designation is gone, so the slot stays empty until someone designates it.
  const owned = await setup(['recap', 'owner'])
  assert.equal(owned.record.firstMet, false)
  assert.notEqual(owned.record.pinned, true)
  assert.equal(owned.record.kind, 'event')
  assert.equal(owned.record.importance, 45)
  assert.equal((await owned.service.actmem.snapshot()).firstMet.source, '')
  const ownedPreviews = await owned.service.previews()
  assert.doesNotMatch(ownedPreviews.qq, /初次相遇/)
  assert.doesNotMatch(ownedPreviews.bili, /把归队简报接进衰减记忆卡/)

  // Manual designation still works, and clearing it takes the privilege back.
  await owned.service.action('set-first-meet', { ids: [owned.record.id] })
  const designated = (await owned.service.actmem.snapshot()).records[0]
  assert.equal(designated.firstMet, true)
  assert.equal(designated.pinned, true)
  assert.equal(designated.importance, 100)
  assert.match((await owned.service.previews()).qq, /初次相遇/)
  await owned.service.action('clear-first-meet', {})
  const cleared = (await owned.service.actmem.snapshot()).records[0]
  assert.notEqual(cleared.firstMet, true)
  assert.notEqual(cleared.pinned, true)
  assert.ok(Number(cleared.importance) <= 60)

  // A plain recap record stays a normal decaying memory, and still never
  // reaches the Bilibili context.
  const plain = await setup(['recap'])
  assert.equal(plain.record.firstMet, false)
  assert.equal(plain.record.kind, 'event')
  assert.equal(plain.record.importance, 45)
  assert.notEqual(plain.record.isInitial, true)
  assert.doesNotMatch((await plain.service.previews()).bili, /把归队简报接进衰减记忆卡/)
})

test('an unreachable memory component degrades to the JSONL store', async t => {
  const home = mkdtempSync(join(tmpdir(), 'actmem-recap-nocard-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { process.env.DSH_HOME = previousHome; rmSync(home, { recursive: true, force: true }) })
  const directory = join(home, 'actmem-recap')
  const { ctx, commands } = fakeCtx('{"summary":"没有记忆卡也要能出简报","next_action":null}')
  apply(ctx, { stateDir: directory })
  const result = await commands.get('recap').handler({
    agent: { session: {
      id: 'session-nocard',
      surface: { nodes: [0] },
      eventAt: () => events[1],
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      snapshotEvents: () => [events[1]],
    } },
    rawInput: '',
  })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /记忆卡未写入/)
  const record = storedRecords(join(directory, 'recaps.jsonl')).at(-1)
  assert.equal(record.cardStored, false)
  assert.match(record.cardReason, /unavailable/)
})

test('apply rejects an invalid configuration and stays inert when disabled', t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const { ctx, commands } = fakeCtx('{}')
  assert.throws(() => apply(ctx, { stateDir: dir, deliver: 'somewhere' }), TypeError)
  assert.throws(() => apply(ctx, { stateDir: dir, delayMs: -1 }), TypeError)
  const disabled = fakeCtx('{}')
  apply(disabled.ctx, { stateDir: dir, enabled: false })
  assert.equal(disabled.commands.size, 0)
  assert.equal(commands.size, 0)
})

test('a torn store line does not hide earlier records', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'actmem-recap-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'recaps.jsonl'), `${JSON.stringify({ sessionId: 's1', summary: '旧简报', at: '2026-11-05T00:00:00.000Z' })}\n{"sessionId":"s1","summ`)
  const { ctx, commands } = fakeCtx('{"summary":"新简报","next_action":null}')
  apply(ctx, { stateDir: dir })
  const result = await commands.get('recap').handler({
    agent: { session: {
      id: 's1',
      surface: { nodes: [0] },
      eventAt: () => events[1],
      requestHeader: () => ({ config: { provider: 'p', model: 'm' } }),
      snapshotEvents: () => [events[1]],
    } },
    rawInput: 'last',
  })
  assert.match(result.text, /旧简报/)
})
