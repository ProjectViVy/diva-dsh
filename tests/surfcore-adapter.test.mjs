import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { Readable } from 'node:stream'
import { join, resolve } from 'node:path'
import { createLedger } from '../plugins/dsh-surfcore-adapter/src/cursor.mjs'
import { createSurfcoreEgress, parseAddress } from '../plugins/dsh-surfcore-adapter/src/egress.mjs'
import { createSurfcoreIngress, proactiveEnvelope } from '../plugins/dsh-surfcore-adapter/src/ingress.mjs'
import { apply as applyAdapter } from '../plugins/dsh-surfcore-adapter/src/index.mjs'
import { callComponent, registerComponentInternal } from '../plugins/_shared/ipc.mjs'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'
import { loadPins, renderPatchedSource } from '../scripts/lib/surfcore-component-patch.mjs'

const root = resolve('.')
const PINNED_COMMIT = '59ec3066f7d42a0452fae01f170c9a8484d5dbe5'

function workspace(t, name) {
  const base = join(root, '.artifacts', 'test-tmp')
  mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, `${name}-`))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'surfcore'), { recursive: true })
  writeFileSync(join(home, 'surfcore', 'config.json'), JSON.stringify({ snowluma: { httpUrl: 'http://127.0.0.1:3000', accessToken: 'secret-token' } }))
  return home
}

const qqMessage = (id, text = '你好', address = { platform: 'qq', kind: 'group', target: '123456' }) => ({
  id, kind: 'reply', text, channel: { source: 'surfcore', thread: `qq:${address.kind}:${address.target}`, address },
})

/** A fake SnowLuma: the caller sets `mode` and the history answer, and reads back exactly what left the process. */
function fakeGateway() {
  const state = { posts: [], attempts: 0, mode: 'ok', history: 'empty', historySupported: true, loginSupported: true }
  state.fetch = async (url, options) => {
    const action = url.split('/').pop()
    const answer = (body) => ({ ok: true, status: 200, json: async () => body })
    if (action === 'send_group_msg' || action === 'send_private_msg') {
      state.attempts++
      if (state.mode === 'timeout') throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
      if (state.mode === 'refused') throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3000'), { cause: { code: 'ECONNREFUSED' } })
      state.posts.push({ url, body: JSON.parse(options.body), authorization: options.headers.authorization })
      return answer({ status: 'ok', retcode: 0, data: { message_id: 9000 + state.posts.length } })
    }
    if (action === 'get_login_info') {
      if (!state.loginSupported) throw Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } })
      return answer({ status: 'ok', retcode: 0, data: { user_id: 10001 } })
    }
    if (action === 'get_group_msg_history' || action === 'get_friend_msg_history') {
      if (!state.historySupported) return answer({ status: 'failed', retcode: 200, wording: 'action not support' })
      const messages = state.history === 'match'
        ? [{ message_id: 7777, time: Math.floor(Date.now() / 1000), sender: { user_id: 10001 }, message: [{ type: 'text', data: { text: '你好' } }] }]
        : []
      return answer({ status: 'ok', retcode: 0, data: { messages } })
    }
    return answer({ status: 'ok', retcode: 0, data: {} })
  }
  return state
}

test('one dedupe key becomes one Trigger, and a restart does not invent a second one', async t => {
  const home = workspace(t, 'ingress')
  const submissions = []
  const seen = new Map()
  const orchestrator = createServer((req, res) => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      const body = JSON.parse(raw)
      submissions.push({ path: req.url, marker: req.headers['x-orchestrator-request'], body })
      // The kernel keys a Trigger by (sourceId, dedupeKey), so a redelivery of the same key reports duplicate.
      const triggerId = seen.get(`${body.sourceId}:${body.dedupeKey}`) ?? `input-${submissions.length}`
      const duplicate = seen.has(`${body.sourceId}:${body.dedupeKey}`)
      seen.set(`${body.sourceId}:${body.dedupeKey}`, triggerId)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ triggerId, outcome: duplicate ? 'duplicate' : 'stored' }))
    })
  })
  await new Promise(done => orchestrator.listen(0, '127.0.0.1', done))
  t.after(() => new Promise(done => orchestrator.close(done)))
  const port = orchestrator.address().port
  const subject = 'subject_0f0f0f0f-1111-2222-3333-444444444444'
  const raw = { kind: 'group', id: '123456', key: 'group:123456', isOwner: false, quoteTargetIsSelf: false,
    text: '今晚一起看星星吗', plain: '今晚一起看星星吗',
    event: { message_id: 4242, time: 1_760_000_000, self_id: 10001, user_id: 20002, sender: { user_id: 20002, card: '小鱼' } } }
  const options = { port, resolveSubjectImpl: async () => subject, logger: { warn: () => {} } }
  const ingress = createSurfcoreIngress(options)
  const first = await ingress.ingestQq(raw)
  assert.equal(first.outcome, 'submitted')
  assert.equal((await ingress.ingestQq(raw)).outcome, 'remembered')
  assert.equal(submissions.length, 1, 'the in-memory key list keeps a redelivery from costing a POST')
  const afterRestart = await createSurfcoreIngress(options).ingestQq(raw)
  assert.equal(afterRestart.outcome, 'duplicate')
  assert.equal(afterRestart.triggerId, first.triggerId, 'the same key maps to the same Trigger across a restart')
  assert.equal(submissions.length, 2, 'a restart resubmits the same key and the orchestrator answers duplicate')
  const body = submissions[0].body
  assert.equal(submissions[0].path, '/orchestrator/api/inputs')
  assert.equal(submissions[0].marker, '1')
  assert.deepEqual(Object.keys(body).sort(), ['channel', 'dedupeKey', 'externalEventId', 'human', 'layer', 'payload', 'provenance', 'sourceId', 'subjectId'])
  assert.equal(body.subjectId, subject)
  assert.equal(body.sourceId, 'surfcore')
  assert.equal(body.layer, 'platform')
  assert.equal(body.human, true)
  assert.equal(body.dedupeKey, 'group:123456:4242')
  assert.deepEqual(body.channel, { source: 'surfcore', thread: 'qq:group:123456',
    address: { platform: 'qq', kind: 'group', target: '123456', user: '20002' } })
  for (const [name, mutation] of [
    ['an empty message', { text: '', plain: '' }],
    ['a local admin command', { text: '/reset', plain: '/reset' }],
    ['the bot speaking to itself', { event: { ...raw.event, user_id: 10001, sender: { user_id: 10001, card: 'Vivy' } } }],
    ['another bot', { event: { ...raw.event, user_id: 30003, sender: { user_id: 30003, is_bot: true } } }],
  ]) {
    const posts = submissions.length
    assert.equal((await ingress.ingestQq({ ...raw, ...mutation })).outcome, 'ignored', name)
    assert.equal(submissions.length, posts, `${name} never reaches the orchestrator`)
  }
  const bili = await ingress.ingestBili([{ mid: '22222222', name: '阿碧', text: '看到你的动态了', ts: 1_760_000_100 }])
  assert.equal(bili.results[0].outcome, 'submitted')
  assert.deepEqual(submissions.at(-1).body.channel, { source: 'surfcore', thread: 'bili:dm:22222222',
    address: { platform: 'bili', kind: 'dm', target: '22222222' } })
})

test('a proactive candidate becomes a wake-layer input with its QQ address', async () => {
  const raw = { kind: 'purpose', key: 'group:123', slot: 42, text: '想聊聊今天的计划' }
  const envelope = proactiveEnvelope(raw, { maxTextChars: 20_000 })
  assert.equal(envelope.sourceId, 'surfcore')
  assert.equal(envelope.layer, 'wake')
  assert.equal(envelope.human, false)
  assert.equal(envelope.externalEventId, 'proactive:purpose:group:123:42')
  assert.match(envelope.dedupeKey, /^proactive:purpose:group:123:42:[0-9a-f]{16}$/)
  assert.deepEqual(envelope.payload, { text: '想聊聊今天的计划' })
  assert.deepEqual(envelope.channel, {
    source: 'surfcore', thread: 'qq:group:123',
    address: { platform: 'qq', kind: 'group', target: '123' },
  })
  assert.deepEqual(proactiveEnvelope({ ...raw, key: 'nobody' }, { maxTextChars: 20_000 }), undefined)
  assert.deepEqual(proactiveEnvelope({ ...raw, text: '' }, { maxTextChars: 20_000 }), undefined)
})

test('the adapter forwards a proactive candidate through the same submission path', async () => {
  const forwarded = []
  const ingress = createSurfcoreIngress({ port: 3082, logger: { warn: () => {} },
    resolveSubjectImpl: async () => 'subject_a',
    fetchImpl: async (url, init) => {
      forwarded.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ triggerId: 'input:trigger', outcome: 'stored' }), { status: 200 })
    } })
  const result = await ingress.handle({ method: 'POST', path: '/proactive',
    body: { kind: 'social-idle', key: 'group:9', slot: 7, text: '接一句' } })
  assert.equal(result.outcome, 'submitted')
  assert.equal(forwarded[0].layer, 'wake')
  assert.equal(forwarded[0].subjectId, 'subject_a')
  assert.deepEqual(forwarded[0].channel.address, { platform: 'qq', kind: 'group', target: '9' })
})

test('a send whose result never came back is reconciled before anything leaves again', async t => {
  const home = workspace(t, 'egress-unknown')
  const gateway = fakeGateway()
  const egress = createSurfcoreEgress({ home, dir: join(home, 'ledger'), fetchImpl: gateway.fetch,
    logger: { warn: () => {} }, instanceConfig: () => ({}) })
  const send = (message) => egress.kind.channel.send({ commands: {} }, message)
  const first = await send(qqMessage('msg-1'))
  assert.equal(first.outcome, 'sent')
  assert.equal(first.externalId, '9001')
  assert.deepEqual(gateway.posts[0].body, { group_id: 123456, message: [{ type: 'text', data: { text: '你好' } }] })
  assert.equal(gateway.posts[0].authorization, 'Bearer secret-token')
  const settled = egress.ledger.read('msg-1')
  assert.equal(settled.state, 'sent')
  assert.equal(settled.text, undefined, 'the ledger drops the message body once the send is confirmed')
  assert.equal((await send(qqMessage('msg-1', '换了内容'))).externalId, '9001')
  assert.equal(gateway.attempts, 1, 'a settled key never posts a second external message')

  gateway.mode = 'timeout'
  await assert.rejects(send(qqMessage('msg-2')), /did not complete|timeout/i)
  assert.equal(gateway.attempts, 2, 'the attempt itself left once')
  const uncertain = egress.ledger.read('msg-2')
  assert.equal(uncertain.state, 'uncertain')
  assert.equal(uncertain.text, '你好', 'an unknown result keeps the text so it can be reconciled')

  gateway.mode = 'ok'
  gateway.historySupported = false
  await assert.rejects(send(qqMessage('msg-2')))
  assert.equal(gateway.attempts, 2, 'without a history API the retry posts nothing new')
  assert.equal((await egress.kind.channel.query({ commands: {} }, qqMessage('msg-2'), undefined)).outcome, 'unsupported')
  assert.equal(gateway.attempts, 2, 'querying sends nothing either')

  gateway.historySupported = true
  gateway.history = 'match'
  const reconciled = await send(qqMessage('msg-2'))
  assert.equal(reconciled.outcome, 'sent')
  assert.equal(reconciled.externalId, '7777')
  assert.equal(gateway.attempts, 2, 'a message already visible in the conversation is settled without a new POST')

  const absent = createSurfcoreEgress({ home, dir: join(home, 'ledger-absent'), fetchImpl: gateway.fetch,
    logger: { warn: () => {} }, instanceConfig: () => ({}) })
  gateway.mode = 'timeout'
  await assert.rejects(absent.kind.channel.send({ commands: {} }, qqMessage('msg-3')))
  gateway.mode = 'ok'
  gateway.history = 'empty'
  const attemptsBefore = gateway.attempts
  const retried = await absent.kind.channel.send({ commands: {} }, qqMessage('msg-3'))
  assert.equal(retried.outcome, 'sent')
  assert.equal(gateway.attempts, attemptsBefore + 1, 'a history that proves absence releases exactly one retry')
})

test('the egress refuses addresses it cannot write to and never leaks the token', async t => {
  const home = workspace(t, 'egress-rules')
  const gateway = fakeGateway()
  let instanceConfig = {}
  const egress = createSurfcoreEgress({ home, dir: join(home, 'ledger'), fetchImpl: gateway.fetch,
    logger: { warn: () => {} }, instanceConfig: () => instanceConfig })
  assert.equal(parseAddress({ platform: 'qq', kind: 'group', target: 'not-a-number' }), undefined)
  assert.equal(parseAddress({ platform: 'qq', kind: 'unknown', target: '123456' }), undefined)
  assert.equal(egress.kind.channel.allowed({ platform: 'qq', kind: 'group', target: 'not-a-number' }), false)
  assert.equal(egress.kind.channel.allowed({ platform: 'qq', kind: 'private', target: '22222222' }), true)
  assert.equal(egress.kind.channel.allowed({ platform: 'bili', kind: 'dm', target: '22222222' }), false,
    'Bilibili egress stays closed until it is switched on')
  gateway.mode = 'refused'
  let reason = ''
  await assert.rejects(egress.kind.channel.send({ commands: {} }, qqMessage('msg-x')), error => { reason = String(error.message); return true })
  assert.doesNotMatch(reason, /secret-token/, 'the failure text never carries the access token')
  assert.equal(gateway.attempts, 1, 'the refused attempt did leave, and nothing else follows it')
  assert.equal(readdirSync(join(home, 'ledger')).length, 0, 'a definite failure leaves no ledger row behind')
  gateway.mode = 'ok'
  const privateMessage = qqMessage('msg-priv', '收到', { platform: 'qq', kind: 'private', target: '22222222' })
  assert.equal((await egress.kind.channel.send({ commands: {} }, privateMessage)).outcome, 'sent')
  assert.deepEqual(gateway.posts.at(-1).body, { user_id: 22222222, message: [{ type: 'text', data: { text: '收到' } }] })
  assert.match(gateway.posts.at(-1).url, /send_private_msg$/)
  assert.equal((await egress.kind.channel.send({ commands: {} }, qqMessage('msg-cq', '[CQ:face,id=1] 你好'))).outcome, 'sent')
  assert.equal(gateway.posts.at(-1).body.message[0].data.text, '[CQ：face,id=1] 你好', 'a reply that looks like a CQ code stays plain text')
  instanceConfig = { maxTextChars: 200 }
  assert.equal((await egress.kind.channel.send({ commands: {} }, qqMessage('msg-long', 'x'.repeat(500)))).outcome, 'gone')
  assert.equal(gateway.attempts, 3, 'an oversized reply never reaches the gateway')
  assert.equal(gateway.posts.length, 2, 'and it is not counted as delivered')
  instanceConfig = { biliSend: true }
  assert.equal(egress.kind.channel.allowed({ platform: 'bili', kind: 'dm', target: '22222222' }), false,
    'the switch alone does not open Bilibili egress; the cookie file must exist')
  mkdirSync(join(home, 'surfcore', 'bili'), { recursive: true })
  writeFileSync(join(home, 'surfcore', 'bili', 'credentials.json'), JSON.stringify({ mid: 30001, sessdata: 's', bili_jct: 'j', buvid3: 'b' }))
  assert.equal(egress.kind.channel.allowed({ platform: 'bili', kind: 'dm', target: '22222222' }), true)
})

test('the adapter mounts a trusted Source kind and unmounts it cleanly', async t => {
  const home = workspace(t, 'adapter-mount')
  const savedHome = process.env.DSH_HOME
  process.env.DSH_HOME = home
  t.after(() => { if (savedHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = savedHome })
  const registered = [], reported = [], disposers = []
  let instanceConfig = {}
  applyAdapter({
    logger: { warn: () => {}, log: () => {} },
    effect: build => disposers.push(build()),
    webServer: { port: 3082, register: () => () => {} },
    orchestrator: {
      sources: { register: kind => { registered.push(kind); return () => registered.splice(0, 1) } },
      context: () => ({ config: () => instanceConfig, report: (entry, health) => reported.push([entry, health.state]) }),
    },
  }, {})
  const kind = registered[0]
  assert.equal(kind.kind, 'surfcore')
  assert.equal(kind.trusted, true, 'only a trusted source may submit platform inputs')
  assert.deepEqual(kind.health, ['surfcore'])
  assert.ok(kind.schema.safeParse({}).success, 'the default configuration parses, so a fresh instance is enabled')
  assert.equal(typeof kind.channel.send, 'function')
  assert.equal(typeof kind.channel.query, 'function')
  assert.ok(reported.some(([entry, state]) => entry === 'surfcore' && state === 'ready'),
    'the kind is registered before the context is taken, so health reporting works')
  disposers.forEach(dispose => dispose())
  assert.equal(registered.length, 0)
  assert.equal(readdirSync(join(home, 'surfcore-adapter')).includes('ledger'), true)
})

test('the ingest route stays behind the component token', async t => {
  const home = workspace(t, 'adapter-ipc')
  const ingress = createSurfcoreIngress({ port: 3082, resolveSubjectImpl: async () => { throw new Error('not needed') },
    fetchImpl: async () => { throw new Error('not called') }, logger: { warn: () => {} } })
  const routes = []
  const dispose = registerComponentInternal({ webServer: { port: 3082, register: route => { routes.push(route); return () => {} } } },
    { home, name: 'surfcore-adapter', handle: ingress.handle })
  t.after(dispose)
  const raw = { kind: 'private', id: '22222222', key: 'private:22222222', text: '在吗', plain: '在吗',
    event: { message_id: 5, time: 1_760_000_000, self_id: 10001, user_id: 22222222, sender: { user_id: 22222222 } } }
  const call = async token => {
    const req = Readable.from([JSON.stringify(raw)])
    Object.assign(req, { method: 'POST', url: '/dsh-surfcore-adapter/internal/ingest',
      headers: { host: '127.0.0.1:3082', ...(token ? { 'x-component-token': token } : {}) } })
    let status, body
    await routes[0].handler(req, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } })
    return { status, body }
  }
  assert.equal((await call('')).status, 401, 'a missing token is refused')
  const discovery = JSON.parse(readFileSync(join(home, 'surfcore-adapter', 'runtime.json'), 'utf8'))
  const accepted = await call(discovery.token)
  assert.equal(accepted.status, 200)
  assert.equal(accepted.body.outcome, 'unavailable', 'the event is handed over, and an unreachable orchestrator is reported, not thrown')
  await assert.rejects(callComponent({ home, name: 'surfcore-adapter', path: '/ingest', body: raw,
    fetchImpl: async (url, options) => {
      const req = Readable.from([JSON.stringify(raw)])
      Object.assign(req, { method: 'POST', url: new URL(url).pathname, headers: options.headers })
      let body
      await routes[0].handler(req, { writeHead: () => {}, end: value => { body = value } })
      return new Response(body, { status: 200 })
    } }), () => true, 'a caller without the discovery token cannot reach the route')
})

test('a stopped adapter costs one warning and never stops the bridge from starting', async t => {
  const home = workspace(t, 'adapter-disabled')
  const lines = []
  const hooks = createBridgeHooks({ home, log: message => lines.push(message) })
  const qq = await hooks.ingestSurfcoreEvent({ kind: 'group', id: '1', key: 'group:1', text: 'hi', plain: 'hi', event: { message_id: 1, user_id: 2 } })
  const bili = await hooks.ingestSurfcoreBiliEvents([{ mid: '2', text: 'hi', ts: 1 }])
  assert.equal(qq.ok, false)
  assert.equal(bili.ok, false)
  assert.equal(lines.length, 1, 'both hooks share one throttled line instead of throwing')
  assert.match(lines[0], /入站适配器/)
  const running = join(home, 'surfcore-adapter')
  mkdirSync(running, { recursive: true })
  writeFileSync(join(running, 'runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:59999', token: 'a'.repeat(64) }))
  await assert.rejects(() => import('../scripts/lib/surfcore-component-client.mjs').then(({ createSurfcoreComponentClient }) =>
    createSurfcoreComponentClient({ home }).ingestQq({ kind: 'group', id: '1', key: 'group:1', text: 'hi', event: {} })), /unavailable/i)
})

test('the pinned SurfCore sources carry the ingest anchors exactly once and stay untouched', () => {
  const pins = loadPins()
  assert.equal(pins.patchVersion, 4)
  const bridge = renderPatchedSource('src/bridge.js', readFileSync(join(root, 'plugins/surfcore/src/bridge.js'), 'utf8'), { projectRoot: root })
  assert.equal((bridge.match(/\bingestSurfcoreEvent\(/g) ?? []).length, 1)
  assert.equal((bridge.match(/^import \{[^}]*\bingestSurfcoreEvent\b/gm) ?? []).length, 1)
  assert.ok(bridge.indexOf('void ingestSurfcoreEvent({') > bridge.indexOf('静默模式，忽略群友消息'),
    'the forward sits behind the bridge’s own do-not-deliver gates, so silent-mode messages never reach the adapter')
  const scheduler = renderPatchedSource('plugins/surfcore/lib/scheduler.js',
    readFileSync(join(root, 'plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), { projectRoot: root })
  assert.equal((scheduler.match(/\bingestSurfcoreBiliEvents\(/g) ?? []).length, 1)
  assert.match(scheduler, /const toolLine = \(\) => `［工具］读和诊断都用这一条/)
  assert.doesNotMatch(scheduler, /所有命令都用这一条/)
  const status = execFileSync('git', ['-C', join(root, 'plugins', 'surfcore'), 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  assert.equal(status, '', 'the read-only SurfCore submodule has no local edits')
  const head = execFileSync('git', ['-C', join(root, 'plugins', 'surfcore'), 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  assert.equal(head, PINNED_COMMIT)
})

test('the egress ledger keeps one row per key and prunes only settled entries', async t => {
  const base = join(root, '.artifacts', 'test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'ledger-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const warnings = []
  const ledger = createLedger({ dir, maxEntries: 3, logger: { warn: message => warnings.push(message) } })
  const at = offset => new Date(1_760_000_000_000 + offset).toISOString()
  ledger.attempt('a', { text: 'a', address: {}, at: at(-3000) })
  ledger.settle('a', '1')
  for (const [key, offset] of [['b', -2000], ['c', -1000], ['d', 0]]) ledger.attempt(key, { text: key, address: {}, at: at(offset) })
  assert.equal(ledger.read('a'), undefined, 'the oldest settled row was pruned')
  assert.equal(ledger.read('d').state, 'attempting')
  assert.equal(warnings.length, 0, 'a sweep that fits inside the cap needs no warning')
  ledger.attempt('e', { text: 'e', address: {}, at: at(1000) })
  ledger.attempt('f', { text: 'f', address: {}, at: at(2000) })
  assert.ok(warnings.some(line => /still unresolved and were kept/.test(line)), 'an over-capacity ledger of unresolved rows says so')
  assert.ok(ledger.read('c') && ledger.read('f'), 'unresolved rows are never pruned')
  ledger.settle('b', '2')
  ledger.attempt('g', { text: 'g', address: {}, at: at(3000) })
  assert.equal(ledger.read('b'), undefined, 'the next sweep takes the oldest confirmed row')
  ledger.markUncertain('e', '结果不明')
  assert.equal(ledger.read('e').state, 'uncertain')
  assert.equal(ledger.read('e').text, 'e')
  assert.equal(ledger.read('e').reason, '结果不明')
  ledger.clear('e')
  assert.equal(ledger.read('e'), undefined)
  writeFileSync(join(dir, `${createHash('sha1').update('f').digest('hex')}.json`), 'not json')
  assert.throws(() => ledger.read('f'), /cannot be read/i, 'an unreadable row stops a retry rather than risking a second copy')
})
