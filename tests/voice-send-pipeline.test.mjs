import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { createVoiceService, useEffectHost } from '../plugins/voice/src/service.mjs'
import { registerVoiceInternal } from '../plugins/voice/src/internal.mjs'

function make(t, options = {}) {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-send-pipeline-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'audio'), { recursive: true })
  writeFileSync(join(dir, 'audio', 'hello.wav'), 'fixture')
  return { dir, service: createVoiceService({ stateDir: dir, ...options }) }
}

/** An Effect host that records calls and, unless overridden, delivers through the caller's deliverer. */
function useFakeHost(t, overrides = {}) {
  const calls = { commit: [], cancel: [], status: [] }
  const host = {
    async commit(payload, options) {
      calls.commit.push({ payload, options })
      if (overrides.commit) return overrides.commit(payload, options)
      const delivered = options.deliver ? await options.deliver() : undefined
      return { ok: true, ...(delivered ?? {}) }
    },
    cancel(key) { calls.cancel.push(key); return overrides.cancel ? overrides.cancel(key) : { cancelled: true, state: 'pending', inFlight: false } },
    status(key) { calls.status.push(key); return overrides.status ? overrides.status(key) : undefined },
  }
  useEffectHost(host)
  t.after(() => useEffectHost(null))
  return { calls, host }
}

/** Detaches any host so the test exercises the fail-closed path: with no host a send is refused, never delivered directly. */
function withoutHost(t) {
  useEffectHost(null)
  t.after(() => useEffectHost(null))
}

test('a prepared voice send consumes budget only after commit', async t => {
  useFakeHost(t)
  const { dir, service } = make(t)
  t.after(() => service.dispose())
  const prepared = await service.prepareSend({ target: 'group:456', file: 'hello.wav' })
  assert.equal(prepared.ok, true)
  assert.equal(prepared.target, 'group:456')
  assert.equal(prepared.path, join(dir, 'audio/hello.wav'))
  assert.equal(service.budgetStatus('group:456').inHour, 0)
  assert.deepEqual((await service.commitSend(prepared.token, { messageId: 9 })).target, 'group:456')
  assert.equal(service.budgetStatus('group:456').inHour, 1)
  assert.match(readFileSync(join(dir, 'data/audit.jsonl'), 'utf8'), /"messageId":9/)
  // A repeated commit reuses the first receipt instead of sending or charging again.
  assert.deepEqual(await service.commitSend(prepared.token, { messageId: 9 }), { ok: true, target: 'group:456', action: 'voice', messageId: 9 })
  assert.equal(service.budgetStatus('group:456').inHour, 1)
})

test('a text send without an effect host is refused with a clear code and drops its token', async t => {
  withoutHost(t)
  const { service } = make(t)
  t.after(() => service.dispose())
  const prepared = await service.prepareSend({ target: 'group:456', file: 'hello.wav' })
  await assert.rejects(service.commitSend(prepared.token, { messageId: 7 }), error => {
    assert.equal(error.code, 'VOICE_EFFECT_HOST_REQUIRED')
    assert.match(error.message, /Effect host/)
    return true
  })
  assert.equal(service.budgetStatus('group:456').inHour, 0)
  // The refused send is dropped, so it cannot be committed later behind the Effect record's back.
  await assert.rejects(service.commitSend(prepared.token, { messageId: 7 }), /凭据/)
})

test('a library send without an effect host is refused before the bridge is called', async t => {
  withoutHost(t)
  const sent = []
  const { service } = make(t, { sendLibraryVoice: async body => { sent.push(body); return { ok: true, messageId: 'b-1' } } })
  t.after(() => service.dispose())
  await assert.rejects(service.sendLibraryVoice({ target: 'group:789', file: 'hello.wav', dryRun: false }), error => {
    assert.equal(error.code, 'VOICE_EFFECT_HOST_REQUIRED')
    return true
  })
  assert.deepEqual(sent, [])
  assert.equal(service.budgetStatus('group:789').inHour, 0)
})

test('a dry-run library send needs no effect host and records no effect', async t => {
  withoutHost(t)
  const calls = [], { dir, service } = make(t, { sendLibraryVoice: async body => { calls.push(body); return { ok: true, dryRun: body.dryRun } } })
  t.after(() => service.dispose())
  assert.equal((await service.sendLibraryVoice({ target: 'group:789', file: 'hello.wav', dryRun: true })).dryRun, true)
  assert.deepEqual(calls, [{ target: 'group:789', file: join(dir, 'audio/hello.wav'), dryRun: true }])
  assert.equal(service.budgetStatus('group:789').inHour, 0)
})

test('aborting a send without an effect host releases its token without throwing', async t => {
  withoutHost(t)
  const { service } = make(t)
  t.after(() => service.dispose())
  const prepared = await service.prepareSend({ target: 'private:111', file: 'hello.wav' })
  assert.deepEqual(service.abortSend(prepared.token), { ok: true, aborted: true })
  assert.deepEqual(service.abortSend(prepared.token), { ok: true, aborted: false })
})

test('an aborted voice send releases its token without consuming budget', async t => {
  const { service } = make(t)
  t.after(() => service.dispose())
  const prepared = await service.prepareSend({ target: 'private:111', file: 'hello.wav' })
  assert.deepEqual(service.abortSend(prepared.token), { ok: true, aborted: true })
  assert.equal(service.budgetStatus('private:111').inHour, 0)
  assert.equal(service.abortSend(prepared.token).aborted, false)
  await assert.rejects(service.commitSend(prepared.token), /凭据/)
})

test('a bridge failure during a library send does not consume budget', async t => {
  useFakeHost(t)
  const { service } = make(t, { sendLibraryVoice: async () => { throw new Error('bridge offline') } })
  t.after(() => service.dispose())
  await assert.rejects(service.sendLibraryVoice({ target: 'group:789', file: 'hello.wav', dryRun: false }), /bridge offline/)
  assert.equal(service.budgetStatus('group:789').inHour, 0)
})

test('a dry-run library send passes validation to the bridge without consuming budget', async t => {
  const calls = [], { dir, service } = make(t, { sendLibraryVoice: async body => { calls.push(body); return { ok: true, dryRun: body.dryRun } } })
  t.after(() => service.dispose())
  assert.equal((await service.sendLibraryVoice({ target: 'group:789', file: 'hello.wav', dryRun: true })).dryRun, true)
  assert.deepEqual(calls, [{ target: 'group:789', file: join(dir, 'audio/hello.wav'), dryRun: true }])
  assert.equal(service.budgetStatus('group:789').inHour, 0)
})

test('voice policy blocks a group send outside the owner window and after one reply', async t => {
  const { service } = make(t)
  t.after(() => service.dispose())
  await service.saveRules({ triggerWho: 'owner' })
  const now = Date.now()
  const allowed = await service.prepareSend({ target: 'group:456', file: 'hello.wav', ownerId: '111', triggerContext: { ownerAt: now - 1000, lastSentAt: 0 }, now })
  assert.equal(allowed.ok, true)
  service.abortSend(allowed.token)
  await assert.rejects(service.prepareSend({ target: 'group:456', file: 'hello.wav', ownerId: '111', triggerContext: { ownerAt: now - 1000, lastSentAt: now - 500 }, now }), /已经发过语音/)
  await assert.rejects(service.prepareSend({ target: 'group:456', file: 'hello.wav', ownerId: '111', triggerContext: { ownerAt: now - 11 * 60 * 1000, lastSentAt: 0 }, now }), /主人/)
  const policy = service.policy({ target: 'private:222', ownerId: '111' })
  assert.equal(policy.allowed, false)
  assert.match(policy.block, /主人/)
})

test('voice prepare rejects a sensitive file name and an over-limit scope', async t => {
  useFakeHost(t)
  const { dir, service } = make(t)
  t.after(() => service.dispose())
  writeFileSync(join(dir, 'audio', 'token=secret123.wav'), 'fixture')
  await assert.rejects(service.prepareSend({ target: 'group:1', file: 'token=secret123.wav', dryRun: true }), /敏感/)
  await service.saveRules({ maxPerMinute: 1, maxPerHour: 1 })
  const prepared = await service.prepareSend({ target: 'group:1', file: 'hello.wav' })
  await service.commitSend(prepared.token)
  await assert.rejects(service.prepareSend({ target: 'group:1', file: 'hello.wav', dryRun: true }), error => {
    assert.equal(error.code, 'voice.rate-limited')
    return true
  })
})

test('a committed send records the bridge receipt through the effect host without a deliverer', async t => {
  const { calls } = useFakeHost(t)
  const { service } = make(t)
  t.after(() => service.dispose())
  const prepared = await service.prepareSend({ target: 'group:456', file: 'hello.wav' })
  const committed = await service.commitSend(prepared.token, { messageId: 42, verified: true })
  assert.equal(calls.commit.length, 1)
  assert.equal(calls.commit[0].payload.external.messageId, '42')
  assert.equal(calls.commit[0].payload.external.verified, true)
  assert.equal(calls.commit[0].options.deliver, undefined)
  assert.equal(calls.commit[0].options.key, prepared.token)
  assert.deepEqual(committed, { ok: true, target: 'group:456', action: 'voice', messageId: 42, verified: true })
})

test('a library send delegates to the bridge once and returns its receipt', async t => {
  const sent = [], { calls } = useFakeHost(t)
  const { dir, service } = make(t, { sendLibraryVoice: async body => { sent.push(body); return { ok: true, messageId: 'b-1', verified: true } } })
  t.after(() => service.dispose())
  const result = await service.sendLibraryVoice({ target: 'group:789', file: 'hello.wav', dryRun: false })
  assert.deepEqual(sent, [{ target: 'group:789', file: join(dir, 'audio/hello.wav'), dryRun: false }])
  assert.equal(calls.commit.length, 1)
  assert.equal(result.messageId, 'b-1')
  assert.equal(result.verified, true)
  assert.equal(service.budgetStatus('group:789').inHour, 1)
})

test('a dry-run library send never reaches the effect host', async t => {
  const { calls } = useFakeHost(t)
  const { service } = make(t, { sendLibraryVoice: async body => ({ ok: true, dryRun: body.dryRun }) })
  t.after(() => service.dispose())
  assert.equal((await service.sendLibraryVoice({ target: 'group:789', file: 'hello.wav', dryRun: true })).dryRun, true)
  assert.deepEqual(calls, { commit: [], cancel: [], status: [] })
  assert.equal(service.budgetStatus('group:789').inHour, 0)
})

test('abort refuses a send the effect host reports in flight', async t => {
  const { calls } = useFakeHost(t, { status: () => ({ state: 'pending', inFlight: true }) })
  const { service } = make(t)
  t.after(() => service.dispose())
  const prepared = await service.prepareSend({ target: 'group:456', file: 'hello.wav' })
  assert.deepEqual(service.abortSend(prepared.token), { ok: false, aborted: false, state: 'pending', inFlight: true })
  assert.deepEqual(calls.cancel, [])
  assert.equal(service.budgetStatus('group:456').inHour, 0)
})

test('voice internal IPC exposes prepare, commit, abort, library, policy and audit', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-send-ipc-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(join(dir, 'audio'), { recursive: true }); writeFileSync(join(dir, 'audio', 'hello.wav'), 'fixture')
  const home = join(dir, 'home')
  let handler
  const service = createVoiceService({ stateDir: dir })
  // The commit-send route is Effect-backed now, so the IPC test attaches a host that delivers for the caller.
  useFakeHost(t)
  const stop = registerVoiceInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(async () => { stop(); await service.dispose() })
  const token = JSON.parse(readFileSync(join(home, 'voice/runtime.json'), 'utf8')).token
  async function invoke(path, body) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)])
    Object.assign(req, { url: `/dsh-voice/internal${path}`, method: body === undefined ? 'GET' : 'POST', headers: { host: '127.0.0.1:3082', 'x-component-token': token } })
    let status, data
    await handler(req, { writeHead: code => { status = code }, end: value => { data = JSON.parse(value) } })
    return { status, data }
  }
  assert.equal((await invoke('/library/list?offset=0')).status, 200)
  assert.equal((await invoke('/library/list', { offset: 0 })).data.voices[0].name, 'hello.wav')
  assert.equal((await invoke('/library/resolve', { file: 'hello.wav' })).data.path, join(dir, 'audio/hello.wav'))
  assert.equal((await invoke('/audit/check', { subject: '[语音:hello.wav]' })).data.ok, true)
  assert.equal((await invoke('/audit/check', { subject: 'token=secret123.wav' })).status, 400)
  assert.equal((await invoke('/library/probe', { offset: 0 })).data.voices[0].ok, true)
  assert.equal((await invoke('/policy/trigger', { target: 'group:1', ownerId: '111', trigger: { who: 'owner' }, ownerLastAt: Date.now() })).data.allowed, true)
  const prepared = await invoke('/prepare-send', { target: 'group:1', file: 'hello.wav' })
  assert.equal(prepared.data.ok, true)
  assert.equal((await invoke('/commit-send', { token: prepared.data.token, messageId: 11 })).data.ok, true)
  assert.equal((await invoke('/budget/status', { scopeKey: 'group:1' })).data.inHour, 1)
  const second = await invoke('/prepare-send', { target: 'group:1', file: 'hello.wav' })
  assert.equal((await invoke('/abort-send', { token: second.data.token })).data.aborted, true)
})
