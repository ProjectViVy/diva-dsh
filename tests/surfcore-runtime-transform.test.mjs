import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { renderBiliShareSource, renderBiliStatePathsSource, renderBridgeSource, renderCharacterSource, renderHostSource, renderSchedulerSource } from '../scripts/lib/surfcore-runtime-transform.mjs'
import * as transforms from '../scripts/lib/surfcore-runtime-transform.mjs'
import { renderSplitConsole } from '../scripts/lib/surfcore-console.mjs'
import { loadCommentFeed, isCommentUnseen, commentItemKey } from '../scripts/lib/bili-comment-cursor.mjs'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'
import { createVoiceService } from '../plugins/voice/src/service.mjs'

test('QQ bridge and independent voice rules both default voice sending to disabled', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-default-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'voice'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'runtime.json'), '{}'); writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: {} }))
  const hooks = createBridgeHooks({ home }), service = createVoiceService({ stateDir: dir })
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///local/hooks.mjs', 'file:///local/memory.mjs')
  const start = source.indexOf('  function voiceCfg() {'), end = source.indexOf('  /** 语音失败留痕', start)
  const voiceCfg = runInNewContext(`${source.slice(start, end)}\nvoiceCfg`, { readIndependentVoiceSettings: hooks.readIndependentVoiceSettings, path, fs, DSH_HOME: home, ROOT: '/project/surfcore', STATE_DIR: '/project/state', process: { env: {}, platform: 'darwin' } })
  assert.equal((await service.rules()).enabled, false); assert.equal(voiceCfg().enabled, false)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { enabled: true } }))
  assert.equal((await service.rules()).enabled, true); assert.equal(voiceCfg().enabled, true)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { enabled: false } }))
  assert.equal((await service.rules()).enabled, false); assert.equal(voiceCfg().enabled, false)
})

test('AI voice-list access requires the independent voice service while operator listing remains available', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///local/hooks.mjs', 'file:///local/memory.mjs')
  const start = source.indexOf("        if (req.method === 'GET' && (url.pathname === '/api/socialV2/voices'")
  const end = source.indexOf("        if (req.method === 'GET' && url.pathname === '/api/socialV2/sticker-list')", start)
  let response, scanned = 0
  const run = runInNewContext(`(async (req, url) => { ${source.slice(start, end)} })`, {
    voiceCfg: () => ({ enabled: true, dir: '/project/audio' }), agentTokenOk: () => true, v2SessionAllowed: () => true, v2ToolEnabled: () => true,
    assertIndependentVoiceAvailable: async () => { throw new Error('offline') },
    sendJson: (data, status = 200) => { response = { status, data } },
    listAudioFiles: () => { scanned++; return [] }, path,
  })
  const url = new URL('http://localhost/api/socialV2/voices?key=group%3A123&probe=0')
  await run({ method: 'GET', headers: { 'x-agent-token': 'fixture' } }, url)
  assert.equal(response.status, 503); assert.match(response.data.error, /语音插件不可用/); assert.equal(scanned, 0)
  await run({ method: 'GET', headers: {} }, url)
  assert.equal(response.status, 200); assert.equal(scanned, 1)
})

test('AI voice listing rejects access revoked while health or audio inspection is pending', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///local/hooks.mjs', 'file:///local/memory.mjs')
  const start = source.indexOf("        if (req.method === 'GET' && (url.pathname === '/api/socialV2/voices'")
  const end = source.indexOf("        if (req.method === 'GET' && url.pathname === '/api/socialV2/sticker-list')", start)
  for (const pending of ['health', 'inspection']) for (const revoked of ['session', 'token', 'tool', 'voice']) {
    let release, response, allowed = true, scanned = 0
    const wait = new Promise(resolve => { release = resolve })
    const run = runInNewContext(`(async (req, url) => { ${source.slice(start, end)} })`, {
      voiceCfg: () => ({ enabled: allowed || revoked !== 'voice', dir: '/project/audio' }), agentTokenOk: () => allowed || revoked !== 'token',
      v2SessionAllowed: () => allowed || revoked !== 'session', v2ToolEnabled: () => allowed || revoked !== 'tool',
      assertIndependentVoiceAvailable: async () => { if (pending === 'health') await wait },
      sendJson: (data, status = 200) => { response = { status, data } },
      listAudioFiles: () => { scanned++; return ['/project/audio/test.wav'] }, path,
      inspectAudio: async () => { if (pending === 'inspection') await wait; return { ok: true, size: 1 } },
      describeAudio: () => 'audio',
    })
    const request = run({ method: 'GET', headers: { 'x-agent-token': 'fixture' } }, new URL('http://localhost/api/socialV2/voices?key=group%3A123'))
    await Promise.resolve(); allowed = false; release(); await request
    assert.equal(response.status, 403, `${pending}: ${revoked}`)
    assert.equal(response.data.voices, undefined, `${pending}: ${revoked}`)
    if (pending === 'health') assert.equal(scanned, 0)
  }
})

test('QQ prompt rejects an agent whose access is revoked during voice health checking', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///local/hooks.mjs', 'file:///local/memory.mjs')
  const start = source.indexOf("        if (req.method === 'GET' && url.pathname === '/api/socialV2/prompt')")
  const end = source.indexOf("        if (req.method === 'GET' && url.pathname === '/api/socialV2/snapshot')", start)
  for (const revoked of ['token', 'session', 'tool']) {
    let release, reached, response, allowed = true
    const wait = new Promise(resolve => { release = resolve })
    const checking = new Promise(resolve => { reached = resolve })
    const run = runInNewContext(`(async (req, url) => { ${source.slice(start, end)} })`, {
      agentTokenOk: () => allowed || revoked !== 'token', v2SessionAllowed: () => allowed || revoked !== 'session', v2ToolEnabled: () => allowed || revoked !== 'tool',
      getSocialV2State: () => ({ unread: [], recentMessages: [], wakeConfig: {} }), cfg: { socialV2: { sticker: { enabled: false } } },
      awaitMemoryContext: async () => {}, readRoleState: () => ({}), stickerEnabled: () => false,
      voiceCfg: () => ({ enabled: true, maxSeconds: 300 }), assertIndependentVoiceAvailable: () => { reached(); return wait },
      sendJson: (data, status = 200) => { response = { status, data } },
      selfDisplayName: '', selfUserId: '', selfIdentityTextV2: () => '', currentMode: 'reserved2', currentRoleHintV2: () => '', currentRoleHint: () => '', memoryCardPromptBlock: () => '',
      replyTimingV2: () => ({}), computeWakeSafetyV2: () => ({}), formatMemoryV2: () => '', formatParticipationV2: () => '', confirmedSlangListV2: () => [], buildSlangContext: () => '', slangEntries: [],
      stickerEntries: [], buildStickerContext: () => '', buildStickerStrategyHint: () => '', closureConfigV2: () => ({}), assessClosureV2: () => ({}), closureStatus: () => ({}), voiceLibrary: () => [],
    })
    const request = run({ method: 'GET', headers: { 'x-agent-token': 'fixture' } }, new URL('http://localhost/api/socialV2/prompt?key=group%3A123'))
    await checking; allowed = false; release(); await request
    assert.equal(response.status, 403, revoked)
  }
})

test('Bilibili scheduler creates its session in the project root', () => {
  const source = renderHostSource(transforms.renderHostWorkdirSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8')))
  const body = source.slice(source.indexOf('  function startSchedulerNow() {'), source.indexOf('  function stopSchedulerNow() {'))
  const root = resolve('.artifacts/test-project')
  let options
  const start = runInNewContext(`let scheduler = null; let schedulerStatus = {}; ${body}; startSchedulerNow`, {
    path, QQBOT_ROOT: join(root, 'plugins/surfcore'), DSH_HOME: join(root, '.artifacts/dsh-home'), BILI_MJS: 'bili.mjs', BILI_CRED: 'credential',
    fs: { existsSync: () => true }, platformStartEnabled: () => true, readCurrentCharacter: () => null,
    startScheduler: (_ctx, value) => { options = value; return {} }, ctx: {}, tokenBudget: null, pluginLog() {},
    os: { homedir: () => '/outside-project' },
  })
  start()
  assert.equal(options.cwd, root)
  options.onSessionStatus(new Error('session failure'))
  assert.match(start().lastError, /session failure/)
  options.onSessionStatus(null)
  assert.equal(start().lastError, null)
})

test('SurfCore declares the session store used by Bilibili migration', () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const declaration = source.match(/export const inject = (\[[^\]]+\]);/)?.[1]
  assert.ok(declaration)
  assert.ok(runInNewContext(declaration).includes('sessions'))
})

test('retired Bilibili scheduler cannot change the replacement scheduler status', () => {
  const source = renderHostSource(transforms.renderHostWorkdirSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8')))
  const body = source.slice(source.indexOf('  function startSchedulerNow() {'), source.indexOf('  startSchedulerNow();'))
  const instances = []
  const { start, stop } = runInNewContext(`let scheduler = null; let schedulerStatus = {}; ${body}; ({start: startSchedulerNow, stop: stopSchedulerNow})`, {
    path, QQBOT_ROOT: '/project/plugins/surfcore', DSH_HOME: '/project/.artifacts/dsh-home', BILI_MJS: 'bili.mjs', BILI_CRED: 'credential',
    fs: { existsSync: () => true }, platformStartEnabled: () => true, readCurrentCharacter: () => null,
    startScheduler: (_ctx, value) => { instances.push(value); return { stop() {} } }, ctx: {}, tokenBudget: null, pluginLog() {},
  })
  start(); stop(); start()
  instances[0].onSessionStatus(new Error('obsolete error'))
  assert.equal(start().lastError, null)
  instances[1].onSessionStatus(new Error('current error'))
  assert.match(start().lastError, /current error/)
})

test('stopped Bilibili scheduler cannot submit a prompt after a slow budget check', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function promptBili('), source.indexOf('  // ⚠️ 2026-10-18 大坑'))
  let release, called = 0
  const wait = new Promise(resolve => { release = resolve })
  const stop = new AbortController()
  const prompt = runInNewContext(`${body}; promptBili`, {
    schedulerStop: stop, AbortSignal, tokenBudget: { block: async () => { await wait; return { blocked: false } } },
    ctx: { sessionController: { prompt: async () => { called++; return { accepted: true } } } }, logBudgetBlocked() {}, log() {},
  })
  const pending = prompt({}, new AbortController().signal)
  stop.abort(); release()
  await assert.rejects(pending)
  assert.equal(called, 0)
})

test('stopping Bilibili aborts a scheduler-owned command', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  const runBili = (args)'), source.indexOf('  let sessionReady = false'))
  const schedulerStop = new AbortController()
  let received
  const run = runInNewContext(`${body}; runBili`, { schedulerStop, NODE_EXE: 'node', biliMjs: 'bili.mjs', NODE_ENV: {},
    execFile: (_node, _args, options, callback) => { received = options.signal; options.signal.addEventListener('abort', () => callback(new Error('aborted'), '', '')) },
  })
  const running = run(['test']); schedulerStop.abort()
  assert.equal(received.aborted, true)
  assert.equal((await running).ok, false)
})

test('stopping Bilibili during session lookup does not create a new session', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  let release, creates = 0
  const waiting = new Promise(resolve => { release = resolve })
  const schedulerStop = new AbortController()
  const run = runInNewContext(`${body}; ensureSession`, { path, cwd: '/project', sessionId: 'bili-whale', schedulerStop,
    ctx: { sessionController: { resolveAgent: async () => { await waiting; return { error: { code: 'session/not-found' } } }, create: async () => { creates++; return { sessionId: 'bili-whale' } } } },
    ensurePermission: () => ({ ok: true }), setTimeout,
  })
  const pending = run(); schedulerStop.abort(); release()
  await assert.rejects(pending)
  assert.equal(creates, 0)
})

test('stopping Bilibili while reading replies prevents the following mention request', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function listenTick() {'), source.indexOf('  // ── 直播间监听：起一个'))
  let release, calls = 0, wakes = 0
  const wait = new Promise(resolve => { release = resolve })
  const schedulerStop = new AbortController()
  const run = runInNewContext(`let listening = false, lastListenAt = 0; ${body}; listenTick`, {
    path, schedulerStop, Date, CFG_FILE_REF: 'config', CRED_REF: 'cred', PLATFORM_DIR: '/project', readCommentPending: () => null, loadCommentFeed,
    fs: { readFileSync: (file) => JSON.stringify(file === 'config' ? { listen: { comment: true, allDay: true } } : {}) },
    budgetBlockedNow: async () => false, inWindow: () => true, makeHeaders: () => ({}), readL: () => ({ lastSeen: 1 }),
    pullFeed: async () => { calls++; await wait; return { items: [] } }, ensureSession: async () => { wakes++ }, log() {},
  })
  const pending = run(); await new Promise(resolve => setImmediate(resolve)); schedulerStop.abort(); release()
  await pending
  assert.equal(calls, 1)
  assert.equal(wakes, 0)
})

test('Bilibili comment listener reads replies and mentions without configuration shadowing', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function listenTick() {'), source.indexOf('  // ── 直播间监听：起一个'))
  const calls = [], logs = []
  const run = runInNewContext(`let listening = false, lastListenAt = 0; ${body}; listenTick`, {
    path, schedulerStop: new AbortController(), Date, CFG_FILE_REF: 'config', CRED_REF: 'cred', PLATFORM_DIR: '/project', readCommentPending: () => null, loadCommentFeed,
    fs: { readFileSync: (file) => JSON.stringify(file === 'config' ? { listen: { comment: true, allDay: true } } : {}) },
    budgetBlockedNow: async () => false, makeHeaders: () => ({}), readL: () => ({ lastSeen: 1 }),
    pullFeed: async (kind) => { calls.push(kind); return { items: [] } }, log: (...args) => logs.push(args.join(' ')),
  })
  await run()
  assert.deepEqual(calls, ['reply', 'at'])
  assert.equal(logs.length, 0)
})

test('Bilibili comment listener delivers fresh messages with configured reply limits', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function listenTick() {'), source.indexOf('  // ── 直播间监听：起一个'))
  let message, saved
  const run = runInNewContext(`let listening = false, lastListenAt = 0; ${body}; listenTick`, {
    path, schedulerStop: new AbortController(), Date, AbortController, CFG_FILE_REF: 'config', CRED_REF: 'cred', LSTATE: 'cursor', PLATFORM_DIR: '/project', sessionId: 'bili-whale', loadCommentFeed, isCommentUnseen, commentItemKey,
    fs: { readFileSync: (file) => JSON.stringify(file === 'config' ? { owner: { mid: '1234' }, listen: { comment: true, allDay: true, onlyOwner: true } } : {}) },
    budgetBlockedNow: async () => false, makeHeaders: () => ({}), readL: () => ({ lastSeen: 1 }), readCommentPending: () => null,
    createCommentPending: (value) => ({ ...value, requestId: 'test-request' }), saveCommentPending() {}, clearCommentPending() {}, commitCommentCursor: (_file, lastSeen) => { saved = { lastSeen } },
    pullFeed: async (kind) => ({ items: kind === 'reply' ? [{ t: 2, who: 'test', mid: '1234', kind: 'reply' }] : [] }),
    limitsNow: () => ({ replyDaily: 7, mineDaily: 8, minePerPerson: 2 }), ensureSession: async () => {}, awaitMemoryContext: async () => {},
    promptBili: async (value) => { message = value }, identityContextLines: () => [], toolLine: () => '', log() {},
    ctx: { sessions: { get: () => ({ snapshotEvents: () => [{ type: 'user/message', data: { source: { kind: 'user', rpcId: 'test-request' } } }] }), flush: async () => true } },
  })
  await run()
  assert.match(message.content[0].text, /7 条\/天/)
  assert.match(message.content[0].text, /每类 8 条\/天/)
  assert.equal(saved.lastSeen, 2)
})

test('Bilibili comment listener does not advance the cursor when mentions fail', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function listenTick() {'), source.indexOf('  // ── 直播间监听：起一个'))
  let saved = 0, prompted = 0
  const run = runInNewContext(`let listening = false, lastListenAt = 0; ${body}; listenTick`, {
    path, schedulerStop: new AbortController(), Date, AbortController, CFG_FILE_REF: 'config', CRED_REF: 'cred', PLATFORM_DIR: '/project', sessionId: 'bili-whale', readCommentPending: () => null, loadCommentFeed,
    fs: { readFileSync: (file) => JSON.stringify(file === 'config' ? { listen: { comment: true, allDay: true } } : {}) },
    budgetBlockedNow: async () => false, makeHeaders: () => ({}), readL: () => ({ lastSeen: 1 }), writeL: () => { saved++ },
    pullFeed: async (kind) => { if (kind === 'at') throw new Error('network failure'); return { items: [{ t: 2, who: 'test', mid: '1234', kind: 'reply' }] } },
    limitsNow: () => ({}), ensureSession: async () => {}, awaitMemoryContext: async () => {}, promptBili: async () => { prompted++ }, identityContextLines: () => [], toolLine: () => '', log() {},
  })
  await run()
  assert.equal(saved, 0)
  assert.equal(prompted, 0)
})

test('Bilibili scheduler migrates the effective directory without replacing its session history', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  let created = 0, current = '/outside-project', flushes = 0
  const history = [{ type: 'user/message' }]
  const session = { history }
  const directory = { get: () => current, set: async (_agent, target) => { current = target; return target } }
  const agent = { session, ctx: { get: (name) => name === 'workingDirectory' ? directory : undefined } }
  const run = runInNewContext(`${body}; ensureSession`, {
    path, schedulerStop: new AbortController(), cwd: '/project', sessionId: 'bili-whale',
    ctx: { sessionController: { resolveAgent: async () => ({ agent }), create: async () => { created++ } }, sessions: { flush: async (value) => { assert.equal(value, session); flushes++; return true } } },
    ensurePermission: () => ({ ok: true }), setTimeout,
  })
  await run()
  assert.equal(current, '/project')
  current = '/outside-project-again'
  await run()
  assert.equal(current, '/project')
  assert.equal(created, 0)
  assert.equal(flushes, 2)
  assert.equal(session.history, history)
})

test('Bilibili scheduler reuses a project session or creates a new one locally', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  for (const exists of [true, false]) {
    const created = []
    let current = '/project'
    const session = {}
    const agent = { session, ctx: { get: () => ({ get: () => current, set: async (_agent, value) => { current = value; return value } }) } }
    let available = exists
    const run = runInNewContext(`${body}; ensureSession`, {
      path, schedulerStop: new AbortController(), cwd: '/project', sessionId: 'bili-whale',
      ctx: { sessionController: { resolveAgent: async () => available ? { agent } : { error: { code: 'session/not-found' } }, create: async (value) => { created.push(value); available = true; return { sessionId: 'bili-whale' } } }, sessions: { flush: async () => true } },
      ensurePermission: () => ({ ok: true }), setTimeout,
    })
    await run()
    await run()
    assert.equal(created.length, exists ? 0 : 1)
    if (!exists) assert.equal(created[0].cwd, '/project')
  }
})

test('Bilibili scheduler does not create a replacement on access or migration failures', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  for (const kind of ['access', 'directory', 'flush', 'no-flush', 'missing-service']) {
    let created = 0
    const agent = { session: {}, ctx: { get: () => kind === 'missing-service' ? undefined : ({ get: () => '/old', set: async () => { if (kind === 'directory') throw new Error('directory failure'); return '/project' } }) } }
    const run = runInNewContext(`${body}; ensureSession`, {
      path, schedulerStop: new AbortController(), cwd: '/project', sessionId: 'bili-whale',
      ctx: { sessionController: { resolveAgent: async () => kind === 'access' ? { error: new Error('access failure') } : { agent }, create: async () => { created++ } }, sessions: { flush: async () => { if (kind === 'flush') throw new Error('flush failure'); return kind !== 'no-flush' } } },
      ensurePermission: () => ({ ok: true }), setTimeout,
    })
    await assert.rejects(run())
    assert.equal(created, 0)
  }
})

test('Bilibili scheduler retries persistence after an interrupted directory migration', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  let current = '/old', attempts = 0
  const statuses = []
  const agent = { session: {}, ctx: { get: () => ({ get: () => current, set: async (_agent, value) => { current = value } }) } }
  const run = runInNewContext(`${body}; ensureSession`, {
    path, schedulerStop: new AbortController(), cwd: '/project', sessionId: 'bili-whale',
    ctx: { sessionController: { resolveAgent: async () => ({ agent }) }, sessions: { flush: async () => ++attempts > 1 } },
    ensurePermission: () => ({ ok: true }), onSessionStatus: (error) => statuses.push(error), setTimeout,
  })
  await assert.rejects(run(), /持久化/)
  await run()
  assert.equal(current, '/project')
  assert.equal(attempts, 2)
  assert.match(statuses[0].message, /持久化/)
  assert.equal(statuses[1], null)
})

test('concurrent Bilibili tasks share session creation and retry after failure', async () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  let creates = 0, available = false, fail = true
  const agent = { session: {}, ctx: { get: () => ({ get: () => '/project', set: async () => {} }) } }
  const controller = {
    resolveAgent: async () => available ? { agent } : { error: { code: 'session/not-found' } },
    create: async () => { creates++; await new Promise(resolve => setTimeout(resolve, 10)); if (fail) throw new Error('creation failed'); available = true; return { sessionId: 'bili-whale' } },
  }
  const run = runInNewContext(`${body}; ensureSession`, { path, schedulerStop: new AbortController(), cwd: '/project', sessionId: 'bili-whale', ctx: { sessionController: controller, sessions: { flush: async () => true } }, ensurePermission: () => ({ ok: true }), setTimeout })
  const failed = await Promise.allSettled([run(), run(), run()])
  assert.ok(failed.every((result) => result.status === 'rejected'))
  assert.equal(creates, 1)
  fail = false
  await Promise.all([run(), run(), run()])
  assert.equal(creates, 2)
})

test('Bilibili session creation uses the pinned DSH session controller', async (t) => {
  const load = (file) => import(pathToFileURL(resolve('deepseek-harness', file)).href)
  const [{ Context }, { default: LocalFileSystem }, { default: WorkingDirectory }, { mountAgentLoopTestDependencies, mountAgentLoopTestHarness }, { default: SessionQuery }, { default: SessionController }, persistence] = await Promise.all([
    load('vendor/cordis/lib/index.js'), load('packages/fs/fs-local/lib/index.js'), load('packages/session/working-directory/lib/index.js'),
    load('packages/test-support/agent-loop-testkit/lib/index.js'), load('packages/session-query/session-query/lib/index.js'),
    load('packages/api/session-controller/lib/index.js'), load('packages/session/session-persistence-jsonl/lib/index.js'),
  ])
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'real-bili-controller-'))
  const project = join(root, 'project'), relocated = join(root, 'relocated'); mkdirSync(project); mkdirSync(relocated)
  const contexts = []
  t.after(async () => { for (const context of contexts) await context.fiber.dispose(); rmSync(root, { recursive: true, force: true }) })
  async function mount() {
    const ctx = new Context(); contexts.push(ctx)
    await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeRuntimeContext: false } })
    await ctx.plugin(LocalFileSystem, { cwd: root })
    await ctx.plugin(WorkingDirectory, {})
    await ctx.plugin(persistence, { root: join(root, 'sessions'), compression: 'none' })
    ctx.provide('typert', { lookups: { configure: () => () => {} }, contexts: { configureHost: () => () => {} }, resources: { register: () => () => {} } })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'fixture', model: 'fixture' }), saveSelection: async () => {} })
    ctx.provide('fileUploads', { registerAgentResolver: () => () => {}, resolve: () => undefined, bindPrompt: () => ({ commit() {}, [Symbol.dispose]() {} }), retirePrompt() {} })
    ctx.provide('remoteAccess', { allows: () => true })
    ctx.provide('workspaceRegistry', { archivedSessionIds: [] })
    new SessionQuery(ctx)
    const controller = new SessionController(ctx, { nativeOpen: false })
    await mountAgentLoopTestHarness(ctx)
    return { ctx, controller }
  }
  let { ctx, controller } = await mount()
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  async function prepare(ctx, cwd) {
    await ctx.plugin({ name: 'bili-real-controller-test', inject: ['sessions', 'sessionController'], async apply(scoped) {
      const run = runInNewContext(`${body}; ensureSession`, { path, schedulerStop: new AbortController(), cwd, sessionId: 'bili-whale', ctx: scoped, ensurePermission: () => ({ ok: true }), setTimeout })
      await Promise.all([run(), run(), run()])
    } })
  }
  await prepare(ctx, project)
  let result = await controller.resolveAgent('bili-whale')
  assert.ok(result.agent)
  assert.equal(result.agent.session.header.cwd, project)
  assert.equal((await ctx.sessionPersistence.list()).length, 1)
  result.agent.session.append('turn/start', { turn: 1 })
  result.agent.session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  assert.equal(await ctx.sessions.flush(result.agent.session), true)
  await ctx.fiber.dispose()
  ;({ ctx, controller } = await mount())
  await prepare(ctx, relocated)
  result = await controller.resolveAgent('bili-whale')
  assert.ok(result.agent)
  assert.equal(result.agent.session.header.cwd, project)
  assert.equal(ctx.workingDirectory.get(result.agent.session), relocated)
  assert.ok(result.agent.session.snapshotEvents().some((event) => event.type === 'turn/start'))
  assert.equal((await ctx.sessionPersistence.list()).length, 1)
  ctx.provide('attachments', { admitPromptContent: async (content) => content })
  const { dmBatchRequestId } = await import('../scripts/lib/bili-dm-cursor.mjs')
  const request = { requestId: dmBatchRequestId([{ mid: '1001', ts: 100 }]), sessionId: 'bili-whale', mode: 'queue', content: [{ type: 'text', text: 'isolated test message' }] }
  await controller.prompt(request, new AbortController().signal)
  assert.equal(await ctx.sessions.flush(result.agent.session), true)
  await controller.prompt(request, new AbortController().signal)
  const inserted = result.agent.session.snapshotEvents().filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted).filter(message => message.source?.rpcId === request.requestId)
  assert.equal(inserted.length, 1)
  const saved = await ctx.sessionPersistence.open(result.agent.id, 'read')
  try { assert.ok((await saved.read()).events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source?.rpcId === request.requestId))) }
  finally { await saved.close() }
})

test('Bilibili session migration uses the pinned DSH working-directory and persistence services', async (t) => {
  const load = (file) => import(pathToFileURL(resolve('deepseek-harness', file)).href)
  const [{ Context }, { default: LocalFileSystem }, { default: WorkingDirectory }, { mountAgentLoopTestDependencies, mountAgentLoopTestHarness }, { default: SessionStore, SessionId }, persistence] = await Promise.all([
    load('vendor/cordis/lib/index.js'), load('packages/fs/fs-local/lib/index.js'),
    load('packages/session/working-directory/lib/index.js'), load('packages/test-support/agent-loop-testkit/lib/index.js'),
    load('packages/core/session/lib/index.js'), load('packages/session/session-persistence-jsonl/lib/index.js'),
  ])
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'real-bili-session-'))
  const old = join(root, 'old'), project = join(root, 'project'); mkdirSync(old); mkdirSync(project)
  const ctx = new Context()
  let remounted
  t.after(async () => { if (remounted) await remounted.fiber.dispose(); await ctx.fiber.dispose(); rmSync(root, { recursive: true, force: true }) })
  await mountAgentLoopTestDependencies(ctx, { systemPrompt: { includeRuntimeContext: false } })
  await ctx.plugin(LocalFileSystem, { cwd: root })
  await ctx.plugin(WorkingDirectory, {})
  await ctx.plugin(persistence, { root: join(root, 'sessions'), compression: 'none' })
  const harness = await mountAgentLoopTestHarness(ctx)
  const agent = await harness.create(SessionId('bili-whale'), {}, { cwd: old })
  agent.session.append('turn/start', { turn: 1 })
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  let sessionReady = false'), source.indexOf('  let waking = false'))
  ctx.provide('sessionController', { resolveAgent: async () => ({ agent }) })
  await ctx.plugin({ name: 'bili-migration-test', inject: ['sessions', 'sessionController'], async apply(scoped) {
    const run = runInNewContext(`${body}; ensureSession`, {
      path, schedulerStop: new AbortController(), cwd: project, sessionId: 'bili-whale', ctx: scoped,
      ensurePermission: () => ({ ok: true }), setTimeout,
    })
    await run()
  } })
  assert.equal(ctx.workingDirectory.get(agent.session), project)
  assert.equal(agent.session.header.cwd, old)
  const reader = await ctx.sessionPersistence.open(agent.session.id, 'read')
  try {
    const events = (await reader.read()).events
    assert.ok(events.some((event) => event.type === 'turn/start'))
    assert.ok(events.some((event) => event.type === 'working-directory/change' && event.data.cwd === project))
  } finally { await reader.close() }
  await ctx.fiber.dispose()
  remounted = new Context()
  await remounted.plugin(SessionStore)
  await remounted.plugin(persistence, { root: join(root, 'sessions'), compression: 'none' })
  const reopened = await remounted.sessionPersistence.open(SessionId('bili-whale'), 'read')
  try {
    assert.equal(reopened.header.cwd, old)
    const events = (await reopened.read()).events
    assert.ok(events.some((event) => event.type === 'turn/start'))
    assert.ok(events.some((event) => event.type === 'working-directory/change' && event.data.cwd === project))
  } finally { await reopened.close() }
})

test('purpose status explains when the QQ bridge is offline', async () => {
  const client = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = client.match(/  async function handlePurpose\([\s\S]*?\n  }(?=\n\n)/)?.[0]
  assert.ok(body)
  let result
  const handle = runInNewContext(`${body}\nhandlePurpose`, { API_PREFIX: '/dsh-surfcore/api', callBridge: async () => ({ ok: false, status: 0, error: 'fetch failed' }), json: (_res, status, value) => { result = { status, ...value } } })
  await handle({ method: 'GET' }, {}, { pathname: '/dsh-surfcore/api/purpose/status' })
  assert.equal(result.status, 503)
  assert.match(result.error, /QQ 桥接/)
})

test('purpose material collection excludes independent memory when its plugin is offline', () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  function gatherPurposeMaterials('), source.indexOf('  function purposePersonaText()'))
  let packet
  const collect = runInNewContext(`${body}; gatherPurposeMaterials`, {
    Date, cfg: { purpose: {} }, purposeOwnerId: () => '123', readRoleState: () => ({}),
    purposeConversations: (include) => [{ activeTopics: include ? ['topic'] : [] }], readPurposeBiliEntries: () => ['bili'], readPurposeMemoryRecords: () => ['memory'],
    collectMaterials: value => { packet = value; return value },
  })
  collect(10, false)
  assert.equal(packet.biliEntries.length, 0); assert.equal(packet.memoryRecords.length, 0); assert.equal(packet.conversations[0].activeTopics.length, 0)
  collect(10, true)
  assert.equal(packet.biliEntries[0], 'bili'); assert.equal(packet.memoryRecords[0], 'memory'); assert.equal(packet.conversations[0].activeTopics[0], 'topic')
})

test('purpose memory availability is checked before preparing materials and again before delivery', () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  async function runPurposeOnce('), source.indexOf('  async function warmPurposeState()'))
  const check = body.indexOf('await isIndependentMemoryAvailable()')
  const prepare = body.indexOf('preparePurposeContext(now, st, includeMemory)')
  const recheck = body.indexOf('await isIndependentMemoryAvailable()', check + 1)
  const prompt = body.indexOf('const prompt = buildPurposePrompt(')
  assert.ok(check >= 0 && prepare > check && recheck > prepare && prompt > recheck)
})

test('purpose context excludes memory blocks when the independent plugin is offline', () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  function purposeContextBlocks('), source.indexOf('  function purposeLogWait('))
  const build = runInNewContext(`${body}; purposeContextBlocks`, { readRoleState: () => ({}), selfIdentityTextV2: () => 'identity', adminPromptLine: () => '', purposePersonaText: () => '',
    cfg: { biliBridge: { enabled: true, memory: { enabled: true } } }, biliMemory: { briefBlock: () => 'bili-private-memory' }, memoryCardPromptBlock: () => 'memory-record',
  })
  const offline = build(false).join('\n'), online = build(true).join('\n')
  assert.doesNotMatch(offline, /bili-private-memory|memory-record/)
  assert.match(online, /bili-private-memory/); assert.match(online, /memory-record/)
})

test('QQ console does not advertise removed persona or voice management', () => {
  const html = renderSplitConsole(readFileSync(resolve('plugins/surfcore/public/console.html'), 'utf8'))
  assert.doesNotMatch(html, /<button data-view="persona"/)
  assert.match(html, /#section-persona, #section-voice \{ display: none !important; \}/)
  assert.match(html, /if \(page === 'persona'\) return/)
  assert.doesNotMatch(html, /if \(document\.getElementById\('voicePacks'\)\) \{\s*vpLoad\(\)/)
})

test('QQ console retains a separate accessible simulation prompt editor', () => {
  const html = renderSplitConsole(readFileSync(resolve('plugins/surfcore/public/console.html'), 'utf8'))
  assert.match(html, /<button data-view="sim-prompt"[^>]*>[^<]*<span[^>]*>[^<]*<\/span>仿真提示词<\/button>/)
  assert.match(html, /'sim-prompt': \[/)
  const personaEnd = html.indexOf('</section>', html.indexOf('<section id="section-persona"'))
  const editorSection = html.indexOf('<section id="section-sim-prompt"')
  const editor = html.indexOf('id="simPromptText"')
  assert.ok(personaEnd < editorSection && editorSection < editor)
  assert.match(html.slice(editorSection, editor), /data-page="sim-prompt"/)
  assert.match(html.slice(editorSection), /id="simPromptSave"/)
  assert.match(html.slice(editorSection), /id="simPromptRestore"/)
})

test('QQ voice library directions point to the migrated project-local directory', () => {
  const html = renderSplitConsole(readFileSync(resolve('plugins/surfcore/public/console.html'), 'utf8'))
  assert.ok(html.includes('.artifacts/dsh-home/voice/audio/'))
  assert.ok(!html.includes('qq-bridge/audio/'))
  assert.ok(!html.includes('socialV2.voice.dir</code> 可换'))
})

test('QQ voice trigger keeps the complete conversation identifier', () => {
  const bridge = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  assert.ok(bridge.includes("voiceTriggerBlock(key, m[1], m[2])"))
  assert.ok(!bridge.includes("voiceTriggerBlock(key, m[1], Number(m[2]))"))
})

test('AI voice send rechecks current rules and authorization after synthesis', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const start = source.indexOf('          const assertVoiceRules = () => {')
  const end = source.indexOf('          let resolved = null;', start)
  assert.ok(start > 0 && end > start)
  let enabled = true, ttsEnabled = true, tokenValid = true, triggerBlocked = false, rateLimited = false
  const guard = runInNewContext(`${source.slice(start, end)}; assertVoiceStillAllowed`, {
    voiceCfg: () => ({ enabled, tts: { enabled: ttsEnabled } }), sayText: 'hello', key: 'group:123', kind: 'group', keyMatch: ['group:123', 'group', '123'], token: 'test',
    currentMode: 'reserved2', agentTokenOk: () => tokenValid, v2ToolEnabled: () => true, v2SessionAllowed: () => true,
    shouldBlockSilentReply: () => false, voiceTriggerBlock: () => triggerBlocked ? '群已移出名单' : null, voiceBudgetCheck: () => { if (rateLimited) throw new Error('频率超限') }, originalSessionGuard() {}, assertIndependentVoiceAvailable: async () => {},
  })
  await assert.doesNotReject(guard())
  enabled = false; await assert.rejects(guard(), /语音|权限/); enabled = true
  ttsEnabled = false; await assert.rejects(guard(), /语音合成/); ttsEnabled = true
  tokenValid = false; await assert.rejects(guard(), /权限|会话/); tokenValid = true
  triggerBlocked = true; await assert.rejects(guard(), /群已移出名单/); triggerBlocked = false
  rateLimited = true; await assert.rejects(guard(), /频率超限/)
})

test('queued AI voice send rechecks authorization before calling the local gateway', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  async function sendVoiceV2('), source.indexOf('  /** 把「我发了条语音」'))
  let release, allowed = true, gatewayCalls = 0
  const waiting = new Promise(resolve => { release = resolve })
  const send = runInNewContext(`let sendChain = waiting; ${body}; sendVoiceV2`, {
    waiting, path, voiceCfg: () => ({ maxBytes: 1000, maxSeconds: 10, defaultVolume: 1, loudness: 'normal' }),
    assertOutboundAuditOk() {}, inspectAudio: async () => ({ ok: true, size: 10 }), processAudioVolume: async (file) => ({ path: file, converted: false }),
    captureSendGuard: () => () => {}, cleanupTemp() {}, describeAudio: () => '', cfg: { snowluma: { httpUrl: 'http://local.test' } }, AbortSignal,
    fetch: async () => { gatewayCalls++; return new Response(JSON.stringify({ status: 'ok', retcode: 0, data: {} })) },
  })
  const pending = send('group:123', '/tmp/test.wav', { guard: true, guardCheck: () => { if (!allowed) throw new Error('rules changed') } })
  await new Promise(resolve => setImmediate(resolve)); allowed = false; release()
  await assert.rejects(pending, /rules changed/)
  assert.equal(gatewayCalls, 0)
})

test('successful AI voice is recorded before the next queued send checks its limit', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  async function sendVoiceV2('), source.indexOf('  /** 把「我发了条语音」'))
  let recorded = 0, gatewayCalls = 0
  const send = runInNewContext(`let sendChain = Promise.resolve(); ${body}; sendVoiceV2`, {
    path, voiceCfg: () => ({ maxBytes: 1000, maxSeconds: 10, defaultVolume: 1, loudness: 'normal' }),
    assertOutboundAuditOk() {}, inspectAudio: async () => ({ ok: true, size: 10 }), processAudioVolume: async (file) => ({ path: file, converted: false }),
    captureSendGuard: () => () => {}, cleanupTemp() {}, describeAudio: () => '', cfg: { snowluma: { httpUrl: 'http://local.test' } }, AbortSignal,
    fetch: async () => { gatewayCalls++; return new Response(JSON.stringify({ status: 'ok', retcode: 0, data: {} })) },
  })
  const options = { guard: true, guardCheck: async () => { if (recorded) throw new Error('rate limited') }, onSent: () => { recorded++ } }
  const [first, second] = await Promise.allSettled([send('group:123', '/tmp/a.wav', options), send('group:123', '/tmp/b.wav', options)])
  assert.equal(first.status, 'fulfilled')
  assert.equal(second.status, 'rejected')
  assert.equal(gatewayCalls, 1)
  assert.equal(recorded, 1)
})

test('a rejected voice gateway request does not consume the AI voice allowance', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  async function sendVoiceV2('), source.indexOf('  /** 把「我发了条语音」'))
  let recorded = 0
  const send = runInNewContext(`let sendChain = Promise.resolve(); ${body}; sendVoiceV2`, {
    path, voiceCfg: () => ({ maxBytes: 1000, maxSeconds: 10, defaultVolume: 1, loudness: 'normal' }),
    assertOutboundAuditOk() {}, inspectAudio: async () => ({ ok: true, size: 10 }), processAudioVolume: async (file) => ({ path: file, converted: false }),
    captureSendGuard: () => () => {}, cleanupTemp() {}, describeAudio: () => '', cfg: { snowluma: { httpUrl: 'http://local.test' } }, AbortSignal,
    fetch: async () => new Response(JSON.stringify({ status: 'failed', retcode: 1 }), { status: 500 }),
  })
  await assert.rejects(send('group:123', '/tmp/a.wav', { guard: true, onSent: () => { recorded++ } }), /OneBot/)
  assert.equal(recorded, 0)
})

test('AI voice records its trigger before waiting for message verification', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const body = source.slice(source.indexOf('  async function sendVoiceForV2('), source.indexOf('  async function sendStickerV2('))
  let release, entered, count = 0
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const sentAt = new Map()
  const send = runInNewContext(`${body}; sendVoiceForV2`, {
    path, Date, voiceCfg: () => ({ enabled: true, autoReadback: true }), voiceBudgetCheck() {}, voiceBudgetCommit: () => { count++ }, voiceLastSentAt: sentAt,
    sendVoiceV2: async (_key, _file, options) => { options.onSent(); return { messageId: '1', detail: 'ok' } },
    recordVoiceSentV2() {}, log() {}, appendActivity() {}, verifyVoiceMessageSent: async () => { entered(); await waiting; return { confirmed: true } },
  })
  const pending = send('group:123', '', { resolved: { path: '/tmp/a.wav', via: 'test' } })
  await started
  assert.equal(count, 1)
  assert.ok(sentAt.has('group:123'))
  release(); await pending
})

test('operator voice sends enforce the current limit inside the shared queue', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const begin = source.indexOf("        if (req.method === 'POST' && (url.pathname === '/api/voice/send'")
  const end = source.indexOf("        if (req.method === 'POST' && url.pathname === '/api/socialV2/send-voice')", begin)
  assert.ok(begin > 0 && end > begin)
  const route = source.slice(begin, end)
  let count = 0, gatewayCalls = 0, release, gatewayStarted
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { gatewayStarted = resolve })
  let queue = Promise.resolve()
  const results = []
  const run = runInNewContext(`async function handle(req, url) { ${route} }; handle`, {
    path, Date, AbortSignal, cfg: { allow: { groups: [123] } }, currentMode: 'chat',
    readBody: async () => ({ target: 'group:123', file: 'a.wav' }), parseTargetKey: () => ({ kind: 'group', id: '123' }), modeAllowed: () => true,
    voiceCfg: () => ({ maxBytes: 1000, maxSeconds: 10, maxPerMinute: 1, maxPerHour: 10, defaultVolume: 1, loudness: 'normal' }),
    resolveVoicePathForOperator: () => ({ path: '/tmp/a.wav', via: 'test' }), resolveAudioProcessing() {}, inspectAudio: async () => ({ ok: true, size: 10 }), describeAudio: () => 'ok',
    voiceBudgetCheck: () => { if (count) { const error = new Error('频率超限'); error.code = 'voice.rate-limited'; throw error } }, voiceBudgetCommit: () => { count++ },
    sendVoiceV2: async (_key, _file, options) => {
      const job = queue.then(async () => { if (options.guardCheck) await options.guardCheck(); gatewayCalls++; if (gatewayCalls === 1) { gatewayStarted(); await waiting } options.onSent?.(); return { messageId: '1', detail: 'ok', audioMode: 'original' } })
      queue = job.catch(() => {})
      return job
    },
    verifyVoiceMessageSent: async () => ({ confirmed: true }), log() {}, appendActivity() {}, sendJson: (data, status = 200) => { results.push({ data, status }) },
  })
  const first = run({ method: 'POST', headers: {} }, { pathname: '/api/voice/send' })
  await started
  const second = run({ method: 'POST', headers: {} }, { pathname: '/api/voice/send' })
  await new Promise(resolve => setImmediate(resolve))
  release(); await Promise.all([first, second])
  assert.equal(gatewayCalls, 1)
  assert.equal(count, 1)
  assert.ok(results.some(result => result.status === 429 && /频率超限/.test(result.data.error)))
})

test('operator voice send stops if the target leaves the whitelist while queued', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const begin = source.indexOf("        if (req.method === 'POST' && (url.pathname === '/api/voice/send'")
  const end = source.indexOf("        if (req.method === 'POST' && url.pathname === '/api/socialV2/send-voice')", begin)
  let allowed = true, release, entered, gatewayCalls = 0, result
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const run = runInNewContext(`async function handle(req, url) { ${source.slice(begin, end)} }; handle`, {
    path, Date, AbortSignal, cfg: { allow: { groups: [123] } }, currentMode: 'chat',
    readBody: async () => ({ target: 'group:123', file: 'a.wav' }), parseTargetKey: () => ({ kind: 'group', id: '123' }), modeAllowed: () => allowed,
    voiceCfg: () => ({ maxBytes: 1000, maxSeconds: 10, defaultVolume: 1, loudness: 'normal' }),
    resolveVoicePathForOperator: () => ({ path: '/tmp/a.wav', via: 'test' }), resolveAudioProcessing() {}, inspectAudio: async () => ({ ok: true, size: 10 }), describeAudio: () => 'ok',
    voiceBudgetCheck() {}, voiceBudgetCommit() {}, sendVoiceV2: async (_key, _file, options) => { entered(); await waiting; await options.guardCheck(); gatewayCalls++; return {} },
    log() {}, appendActivity() {}, sendJson: (data, status = 200) => { result = { data, status } },
  })
  const pending = run({ method: 'POST', headers: {} }, { pathname: '/api/voice/send' })
  await started; allowed = false; release(); await pending
  assert.equal(gatewayCalls, 0)
  assert.equal(result.status, 403)
})

test('AI voice send rechecks settings after waiting for the voice plugin health response', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  const start = source.indexOf('          const assertVoiceRules = () => {'), end = source.indexOf('          let resolved = null;', start)
  let enabled = true, release
  const waiting = new Promise(resolve => { release = resolve })
  const guard = runInNewContext(`${source.slice(start, end)}; assertVoiceStillAllowed`, {
    voiceCfg: () => ({ enabled, tts: { enabled: true } }), sayText: 'hello', key: 'group:123', kind: 'group', keyMatch: ['group:123', 'group', '123'], token: 'test',
    currentMode: 'reserved2', agentTokenOk: () => true, v2ToolEnabled: () => true, v2SessionAllowed: () => true,
    shouldBlockSilentReply: () => false, voiceTriggerBlock: () => null, voiceBudgetCheck() {}, originalSessionGuard() {}, assertIndependentVoiceAvailable: () => waiting,
  })
  const pending = guard(); enabled = false; release()
  await assert.rejects(pending, /语音.*关闭/)
})

test('every QQ voice inspection uses the configured ffprobe', () => {
  const bridge = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  assert.equal((bridge.match(/ffprobePath: voice\.ffprobePath/g) || []).length, 3)
  assert.equal((bridge.match(/ffprobePath: vc\.ffprobePath/g) || []).length, 1)
})

test('QQ and Bilibili prompt paths wait for independent memory context', () => {
  const bridge = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  assert.match(bridge, /await awaitMemoryContext\('qq'\);\s*if \(wakeBlocked\(\)\) return skipWake\(\);\s*promptText = buildWakePromptV2/)
  assert.match(bridge, /await awaitMemoryContext\('qq'\);\s*if \(req\.headers\['x-agent-token'\].*会话权限已变化/)
  assert.match(bridge, /const promptModeBeforeMemory = currentMode;\s*await awaitMemoryContext\('qq'\);\s*if \(currentMode !== promptModeBeforeMemory/)
  const scheduler = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  assert.equal((scheduler.match(/await ensureSession\(\);?\s*await awaitMemoryContext\('bili'\)/g) || []).length, 8)
})

test('Bilibili tools read migrated memory and no longer select a character directory', (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'bili-paths-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const source = readFileSync(resolve('plugins/surfcore/plugins/surfcore/tools/lib/state-paths.mjs'), 'utf8')
  const file = join(dir, 'state-paths.mjs'); writeFileSync(file, renderBiliStatePathsSource(source))
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `import * as paths from ${JSON.stringify(new URL(`file://${file}`).href)}; console.log(JSON.stringify([paths.currentCharacter(), paths.biliState('bili-memory.json'), paths.biliState('scores.json')]))`], { env: { ...process.env, DSH_HOME: dir }, encoding: 'utf8' })
  assert.deepEqual(JSON.parse(result), [null, join(dir, 'memory/data/bili-memory.json'), join(dir, 'surfcore/bili/scores.json')])
})

test('bridge runtime removes role management and delegates memory and voice to independent components', (t) => {
  const source = readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8')
  const result = renderBridgeSource(source, 'file:///local/hooks.mjs', 'file:///local/card-engine.mjs')
  assert.doesNotMatch(result, /url\.pathname === '\/api\/roles(?:\/|')/)
  assert.doesNotMatch(result, /url\.pathname === '\/api\/voice\/packs/)
  assert.doesNotMatch(result, /plainContent === '\/role'/)
  assert.doesNotMatch(result, /from '\.\/voice-tts\.js'/)
  assert.doesNotMatch(result, /from '\.\/bili-memory\.js'/)
  assert.match(result, /createRemoteBiliMemory as createBiliMemory/)
  assert.match(result, /from "file:\/\/\/local\/hooks\.mjs"/)
  assert.match(result, /readIndependentVoiceSettings\(\)/)
  assert.match(result, /function purposeCarrierNow\(\) \{ return 'qq'; \}/)
  assert.match(result, /function petFocusEnabled\(\) \{ return false; \}/)
  assert.match(result, /function purposePersonaText\(\) \{ return ''; \}/)
  assert.doesNotMatch(result, /void biliMemory\.refresh/)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'bridge-transform-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'bridge.mjs'); writeFileSync(file, result)
  execFileSync(process.execPath, ['--check', file])
  assert.throws(() => renderBridgeSource('unexpected source', 'x', 'y'), /pinned/i)
})

test('Bilibili share scheduler waits for memory plugin to record delivery', () => {
  const source = readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8')
  const result = renderBiliShareSource(source)
  assert.match(result, /await memory\.recordShare\(card\.id, slotKey\)/)
})

test('Bilibili share prompts retain their mode-specific instructions without role cards', () => {
  const source = renderBiliShareSource(readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8'))
    .replace("import fs from 'node:fs';", '').replace("import path from 'node:path';", '').replaceAll('export function ', 'function ')
  const build = runInNewContext(`${source}\nbuildSharePrompt`, {})
  const card = { title: '测试视频', url: 'https://example.test/video', reason: '测试内容' }
  for (const mode of ['chat', 'reserved2']) for (const cardSent of [false, true]) {
    const prompt = build(card, '12:00', { mode, cardSent })
    assert.doesNotMatch(prompt, /角色卡|人格卡|人设卡/)
    assert.match(prompt, /测试视频/)
    assert.match(prompt, cardSent ? /不要再发链接/ : /带 BV 号或链接/)
    assert.match(prompt, mode === 'reserved2' ? /qq_send_message/ : /只输出要发到群里的内容/)
  }
})

test('QQ proactive chat forwards a wake candidate instead of delivering a prompt itself', async () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///engine.mjs')
  const body = source.slice(source.indexOf('  async function checkProactiveAt() {'), source.indexOf('  function startProactiveScheduler() {'))
  const forwarded = []
  const run = runInNewContext(`${body}\ncheckProactiveAt`, {
    cfg: { chat: { proactive: { minIntervalMs: 0, minMessages: 1 } } }, dshReady: true, currentMode: 'chat',
    presence: new Map([['group:123', {}]]), presenceState: () => ({ online: true }),
    recentChat: new Map([['group:123', [{ sender: '群友', text: '今天的天气' }]]]),
    pendingProactiveAt: new Map(), allowed: () => true,
    submitSurfcoreProactive: async candidate => { forwarded.push(candidate); return { ok: true, outcome: 'submitted' } },
    log() {}, Date,
  })
  await run()
  assert.equal(forwarded.length, 1)
  assert.equal(forwarded[0].kind, 'chat-idle')
  assert.equal(forwarded[0].key, 'group:123')
  assert.match(forwarded[0].text, /今天的天气/)
  assert.doesNotMatch(forwarded[0].text, /人格卡|角色卡|人设卡/)
})

test('purpose, social idle and reserved2 proactive all forward candidates to the orchestrator', () => {
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///engine.mjs')
  assert.equal((source.match(/\bsubmitSurfcoreProactive\(/g) ?? []).length, 4,
    'purpose, chat-idle, social-idle and proactive-check each forward one candidate')
  assert.equal((source.match(/^import \{[^}]*\bsubmitSurfcoreProactive\b/gm) ?? []).length, 1)
  // 目的区间起点用转发后才存在的 markPurposeDelivered：原文的 `const runId = ` 已被替换掉。
  const purposeRegion = source.slice(source.indexOf('    markPurposeDelivered(purposeState'), source.indexOf('  // 串行化：一次只允许一个目的回合在跑'))
  assert.match(purposeRegion, /kind: 'purpose'/)
  assert.doesNotMatch(purposeRegion, /deliverPrompt/)
  assert.match(source, /kind: 'social-idle', key, slot/)
  assert.match(source, /kind: 'proactive-check', key, slot: Math\.floor\(Date\.now\(\) \/ 60000\)/)
  assert.match(source, /text: buildWakePromptV2\(key, 'proactiveCheck'\)/)
  assert.match(source, /prunePurposeState/)
  assert.doesNotMatch(source, /void sendWakePromptV2\(key, 'proactiveCheck'\)/)
  // 只校验观望期主动开话题这一段：其他正常回复路径仍会调用 scheduleSocialReply。
  const socialRegion = source.slice(source.indexOf('if (Math.random() < Number(cfg.social?.proactiveProbability'),
    source.indexOf("} else if (st.phase === 'active') {"))
  assert.match(socialRegion, /kind: 'social-idle', key, slot/)
  assert.doesNotMatch(socialRegion, /scheduleSocialReply/)
})

test('QQ and Bilibili alignment briefs retain names and privacy rules without referring to role cards', () => {
  assert.equal(typeof transforms.renderAlignmentSource, 'function')
  const source = transforms.renderAlignmentSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/align.js'), 'utf8'))
  const body = source.slice(source.indexOf('function briefHeader('), source.indexOf('export function writeAlignmentBriefs'))
    .replaceAll('export function ', 'function ')
  const { qq, bili } = runInNewContext(`${body}\n({ qq: buildQqAlignmentBrief, bili: buildBiliAlignmentBrief })`, { readAlignState: () => ({ links: [] }) })
  const links = [{ label: '小明', identities: { qq: { id: '123456', name: '群友' }, bili: { id: '456789', name: '小站' } } }]
  for (const brief of [qq({ links }), bili({ links })]) {
    assert.doesNotMatch(brief, /人格卡|角色卡|人设卡/)
    assert.match(brief, /小明/)
    assert.match(brief, /QQ 号/)
    assert.match(brief, /私聊/)
  }
})

test('the actual SurfCore loader applies the role-free alignment brief transformation', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'alignment-loader-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const moduleUrl = pathToFileURL(resolve('plugins/surfcore/plugins/surfcore/lib/align.js')).href
  const code = `import { buildQqAlignmentBrief } from ${JSON.stringify(moduleUrl)}; const links = [{label:'小明',identities:{qq:{id:'123456',name:'群友'},bili:{id:'456789',name:'小站'}}}]; process.stdout.write(buildQqAlignmentBrief({links}));`
  const text = execFileSync(process.execPath, ['--import', resolve('scripts/surfcore-loader.mjs'), '--input-type=module', '-e', code], { env: { ...process.env, DSH_HOME: home, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1' }, encoding: 'utf8' })
  assert.match(text, /小明/)
  assert.doesNotMatch(text, /人格卡|角色卡|人设卡/)
})

test('Bilibili startup catch-up logs a rejected share without sending', async () => {
  const source = renderBiliShareSource(readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8'))
    .replace("import fs from 'node:fs';", '').replace("import path from 'node:path';", '').replaceAll('export function ', 'function ')
  const timers = [], logs = [], now = new Date(2026, 0, 1, 12, 5, 0)
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now.getTime()])) } static now() { return now.getTime() } }
  const create = runInNewContext(`${source}\ncreateBiliShareScheduler`, {
    fs: { readFileSync: () => { throw new Error('missing') } }, path, Date: FixedDate,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return { unref() {} } }, clearTimeout() {}, process,
  })
  let sent = 0
  const scheduler = create({ stateDir: '/fixture', groups: ['123'], times: ['12:00'], log: message => logs.push(message), deliverPrompt: async () => { sent++ }, memory: { assertAvailable: async () => {}, pickShareCard: () => { throw new Error('分享历史文件损坏') } } })
  scheduler.start()
  const catchup = timers.find(timer => timer.delay === 1500); assert.ok(catchup)
  catchup.callback()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(logs.some(message => /补跑异常.*分享历史文件损坏/.test(message)))
  assert.equal(sent, 0)
  scheduler.stop()
})

test('Bilibili share remembers a delivered slot when recording the memory history fails', async () => {
  const source = renderBiliShareSource(readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8'))
    .replace("import fs from 'node:fs';", '').replace("import path from 'node:path';", '').replaceAll('export function ', 'function ')
  const files = new Map(), fs = {
    readFileSync: name => { if (!files.has(name)) throw new Error('missing'); return files.get(name) },
    mkdirSync() {}, writeFileSync: (name, content) => files.set(name, content),
    renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from) },
  }
  const create = runInNewContext(`${source}\ncreateBiliShareScheduler`, { fs, path, process, Date, setTimeout, clearTimeout })
  let sent = 0
  const scheduler = create({ stateDir: '/fixture', groups: ['123'], times: ['12:00'], gapMs: 0,
    deliverPrompt: async () => { sent++ }, memory: { assertAvailable: async () => {}, pickShareCard: () => ({ id: 'item', title: '素材' }), recordShare: async () => { throw new Error('磁盘写入失败') } } })
  await assert.rejects(scheduler.fire('12:00'), /磁盘写入失败/)
  assert.equal(sent, 1)
  assert.equal((await scheduler.fire('12:00')).skipped, true)
  assert.equal(sent, 1)
})

test('Bilibili share does not select or send when the memory plugin is unavailable', async () => {
  const source = renderBiliShareSource(readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8'))
    .replace("import fs from 'node:fs';", '').replace("import path from 'node:path';", '').replaceAll('export function ', 'function ')
  const files = new Map(), fs = { readFileSync: name => { if (!files.has(name)) throw new Error('missing'); return files.get(name) }, mkdirSync() {}, writeFileSync: (name, value) => files.set(name, value), renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from) } }
  const create = runInNewContext(`${source}\ncreateBiliShareScheduler`, { fs, path, process, Date, setTimeout, clearTimeout })
  let selected = 0, delivered = 0
  const scheduler = create({ stateDir: '/fixture', groups: ['123'], times: ['12:00'], gapMs: 0,
    deliverPrompt: async () => { delivered++ }, memory: { assertAvailable: async () => { throw new Error('memory offline') }, pickShareCard: () => { selected++; return { id: '1', title: 'test' } } } })
  await assert.rejects(scheduler.fire('12:00'), /memory offline/)
  assert.equal(selected, 0); assert.equal(delivered, 0)
})

test('Bilibili share preserves its delivered slot if memory goes offline between groups', async () => {
  const source = renderBiliShareSource(readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8'))
    .replace("import fs from 'node:fs';", '').replace("import path from 'node:path';", '').replaceAll('export function ', 'function ')
  const files = new Map(), fs = { readFileSync: name => { if (!files.has(name)) throw new Error('missing'); return files.get(name) }, mkdirSync() {}, writeFileSync: (name, value) => files.set(name, value), renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from) } }
  const create = runInNewContext(`${source}\ncreateBiliShareScheduler`, { fs, path, process, Date, setTimeout, clearTimeout })
  let checks = 0, delivered = 0
  const scheduler = create({ stateDir: '/fixture', groups: ['123', '456'], times: ['12:00'], gapMs: 0,
    deliverPrompt: async () => { delivered++ }, memory: { assertAvailable: async () => { if (++checks === 3) throw new Error('memory offline') }, pickShareCard: () => ({ id: '1', title: 'test' }), recordShare: async () => ({ ok: true }) } })
  await assert.rejects(scheduler.fire('12:00'), /memory offline/)
  assert.equal(delivered, 1)
  assert.equal((await scheduler.fire('12:00')).skipped, true)
  assert.equal(delivered, 1)
})

test('Bilibili share retains a sent card slot if memory stops before its follow-up prompt', async () => {
  const source = renderBiliShareSource(readFileSync(resolve('plugins/surfcore/src/bili-share-scheduler.js'), 'utf8'))
    .replace("import fs from 'node:fs';", '').replace("import path from 'node:path';", '').replaceAll('export function ', 'function ')
  const files = new Map(), fs = { readFileSync: name => { if (!files.has(name)) throw new Error('missing'); return files.get(name) }, mkdirSync() {}, writeFileSync: (name, value) => files.set(name, value), renameSync: (from, to) => { files.set(to, files.get(from)); files.delete(from) } }
  const create = runInNewContext(`${source}\ncreateBiliShareScheduler`, { fs, path, process, Date, setTimeout, clearTimeout })
  let checks = 0, cards = 0, prompts = 0
  const scheduler = create({ stateDir: '/fixture', groups: ['123'], times: ['12:00'], gapMs: 0,
    sendCard: async () => { cards++; return true }, deliverPrompt: async () => { prompts++ },
    memory: { assertAvailable: async () => { if (++checks === 3) throw new Error('memory offline') }, pickShareCard: () => ({ id: '1', title: 'test' }), recordShare: async () => ({ ok: true }) } })
  await assert.rejects(scheduler.fire('12:00'), /memory offline/)
  assert.equal(cards, 1); assert.equal(prompts, 0)
  assert.equal((await scheduler.fire('12:00')).skipped, true)
})

test('QQ bridge refuses to start while independent memory holds the maintenance guard', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'bridge-maintenance-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const source = renderBridgeSource(readFileSync(resolve('plugins/surfcore/src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///engine.mjs')
  const body = source.slice(source.indexOf('function acquireLock() {'), source.indexOf('function releaseLock() {'))
  const fakeProcess = { pid: process.pid + 100000, kill: process.kill, exit: code => { throw new Error(`exit ${code}`) } }
  const acquire = runInNewContext(`${body}\nacquireLock`, { fs, path, STATE_DIR: dir, LOCK_FILE: join(dir, 'bridge.lock'), process: fakeProcess, console: { error() {} }, consolePortInUse: () => false })
  writeFileSync(join(dir, 'bridge-maintenance.lock'), String(process.pid))
  assert.throws(() => acquire(), /exit 2/)
  assert.equal(fs.existsSync(join(dir, 'bridge.lock')), false)
  rmSync(join(dir, 'bridge-maintenance.lock'))
  writeFileSync(join(dir, 'bridge.lock'), String(process.pid))
  const raced = runInNewContext(`${body}\nacquireLock`, { fs, path, STATE_DIR: dir, LOCK_FILE: join(dir, 'bridge.lock'), process: fakeProcess, console: { error() {} }, consolePortInUse: () => {
    writeFileSync(join(dir, 'bridge-maintenance.lock'), String(process.pid))
    return false
  } })
  assert.throws(() => raced(), /exit 2/)
  assert.equal(readFileSync(join(dir, 'bridge.lock'), 'utf8'), String(process.pid))
})

test('character system resolves no active role in the runtime', (t) => {
  const source = readFileSync(resolve('plugins/surfcore/src/character-persona.js'), 'utf8')
  const result = renderCharacterSource(source)
  assert.match(result, /export function readCurrentCharacter\(\) \{ return null; \}/)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'character-transform-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'character.mjs'); writeFileSync(file, result)
  execFileSync(process.execPath, ['--check', file])
})

test('explicit platform setting changes start or stop services even when startup autostart is disabled', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('    const afterPlatformStart = platformStartState();')
  const end = source.indexOf('    if (body.restartBridge === true)', start)
  assert.ok(start > 0 && end > start)
  for (const [before, after, expected] of [
    [{ qq: false, bili: false }, { qq: true, bili: true }, ['bili-start', 'qq-start']],
    [{ qq: true, bili: true }, { qq: false, bili: false }, ['bili-stop', 'qq-stop']],
    [{ qq: true, bili: false }, { qq: true, bili: false }, []],
  ]) {
    const calls = [], result = { saved: { unified: true }, warnings: [] }
    const run = runInNewContext(`(async () => { ${source.slice(start, end)} })`, {
      result, beforePlatformStart: before, platformStartState: () => after,
      process: { env: { SURFCORE_SKIP_AUTOSTART: '1' } }, body: {},
      scheduler: { retire: async () => calls.push('bili-stop') }, schedulerStatus: {},
      idleSchedulerStatus: () => ({ running: false }),
      startSchedulerNow: () => { calls.push('bili-start'); return { running: true } },
      startBridge: async () => { calls.push('qq-start'); return { ok: true } },
      stopBridge: async () => { calls.push('qq-stop'); return { ok: true } },
      currentDshUrl: () => 'http://127.0.0.1:3082',
    })
    await run()
    assert.deepEqual(calls, expected)
  }
})

test('SurfCore startup restores only globally enabled extension activation without starting platforms', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'extension-startup-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const loader = resolve('scripts/surfcore-loader.mjs'), entry = pathToFileURL(resolve('plugins/surfcore/plugins/surfcore/lib/index.js')).href
  const extension = pathToFileURL(resolve('plugins/surfcore/plugins/surfcore/lib/extensions.js')).href
  for (const enabled of [false, true]) {
    const home = join(dir, String(enabled), 'home'), qq = join(dir, String(enabled), 'qq')
    mkdirSync(join(home, 'surfcore'), { recursive: true }); mkdirSync(join(qq, 'src'), { recursive: true })
    writeFileSync(join(home, 'surfcore/config.json'), JSON.stringify({ extensions: { enabled } }))
    writeFileSync(join(home, 'surfcore/extensions.json'), JSON.stringify({ enabled: { sts2: true } }))
    writeFileSync(join(qq, 'src/bridge.js'), '')
    const program = `
      const activated = [];
      const { ExtensionHost } = await import(${JSON.stringify(extension)});
      ExtensionHost.prototype.activate = async function (id) { activated.push(id); return { ok: true }; };
      const { apply } = await import(${JSON.stringify(entry)});
      const effects = [];
      const ctx = { webServer: { register: () => () => {} }, get: () => null, effect: fn => { effects.push(fn) }, sessionController: {} };
      apply(ctx); await new Promise(resolve => setImmediate(resolve));
      if (JSON.stringify(activated) !== ${JSON.stringify(JSON.stringify(enabled ? ['sts2'] : []))}) throw new Error('unexpected extension activation: ' + activated);
      for (const effect of effects) { const dispose = effect(); if (typeof dispose === 'function') await dispose(); }
      process.exit(0);
    `
    execFileSync(process.execPath, ['--import', loader, '--input-type=module', '-e', program], { env: { ...process.env, DSH_HOME: home, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_ROOT: qq, SURFCORE_QQBOT_ROOT: qq, SURFCORE_SKIP_AUTOSTART: '1', SURFCORE_DISABLE_CHARACTER_MIGRATION: '1', SURFCORE_DISABLE_MEMORY_TIMER: '1', SURFCORE_DISABLE_PLATFORM_RESTART: '1', SURFCORE_COMPONENT_SPLIT: '1' }, stdio: 'pipe', timeout: 10000 })
  }
})

test('SurfCore host removes old component routes, services and autonomous jobs', (t) => {
  const source = readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8')
  const result = renderHostSource(source)
  for (const fragment of ['handleCharacters(req', 'handlePersona(req', 'handlePersonaClassify(req', 'handlePet(req', 'handleVoice(req', 'handleMemory(req', 'handleMemoryCard(req', 'createPetService(', 'createPetApiService(', 'startMemoryCardTimer(', 'runCharacterAutoSave', 'petApi.prefix', "from './memory.js'", "from './memory-card.js'", "from './characters.js'", 'resolvePersonaFile()']) {
    assert.equal(result.includes(fragment), false, fragment)
  }
  assert.match(result, /const LAUNCH_IDS = \['qq', 'bili', 'voice'\]/)
  assert.match(result, /memory: createExtensionMemoryApi\(\{ home: DSH_HOME \}\)/)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'host-transform-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'host.mjs'); writeFileSync(file, result)
  execFileSync(process.execPath, ['--check', file])
  assert.throws(() => renderHostSource('unexpected source'), /pinned/i)
})

test('one-click QQ launch restarts a stale bridge and leaves a current bridge on the normal start path', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = source.slice(source.indexOf("  const LAUNCH_IDS = ['qq', 'bili', 'voice'];"), source.indexOf('  async function handleBridge(req, res) {'))
  let stale = true, startFails = false, snowlumaStarts = 0
  const calls = []
  const run = runInNewContext(`${body}\nrunLaunchAction`, {
    bridgeStatus: async () => ({ running: true, old: stale }), bridgeStaleReason: status => status.old ? '旧 DSH 地址' : '',
    currentDshUrl: () => 'http://127.0.0.1:3082', platformStartEnabled: () => true,
    startBridge: async value => { calls.push(['start', value.dshWebUrl]); return startFails ? { ok: false, error: '启动失败' } : { ok: true } },
    restartBridge: async value => { calls.push(['restart', value.dshWebUrl]); return { ok: true } },
    launchSnowLuma: async () => { snowlumaStarts++; return { ok: false, skipped: true } },
    scheduler: null, schedulerStatus: { running: false }, watchStartupCompletion: async () => {}, cancelStartupWatch: () => {},
  })
  let result = await run('start', { components: ['qq'] })
  assert.deepEqual(calls, [['restart', 'http://127.0.0.1:3082']])
  assert.equal(result.ok, true, 'a deliberately skipped SnowLuma launch is not an error')
  stale = false; calls.length = 0
  result = await run('start', { components: ['qq'] })
  assert.deepEqual(calls, [['start', 'http://127.0.0.1:3082']])
  assert.equal(result.ok, true)
  calls.length = 0; startFails = true
  const before = snowlumaStarts
  result = await run('start', { components: ['qq'] })
  assert.equal(result.ok, false)
  assert.equal(snowlumaStarts, before)
})

test('explicit SnowLuma launch is available when platform autostart is disabled', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  async function launchSnowLuma() {')
  const end = source.indexOf('  // ── 启动完成弹窗', start)
  let allow = false
  const launch = runInNewContext(`${source.slice(start, end)}\nlaunchSnowLuma`, {
    process: { env: { SURFCORE_SKIP_AUTOSTART: '1' } },
    readQqConfig: () => ({ config: { snowluma: { allowLaunch: allow } } }),
    snowLumaWebui: () => ({ port: 3100, url: 'http://127.0.0.1:3100' }),
    portOpen: async port => port === 3000,
  })
  let result = await launch(); assert.equal(result.ok, false); assert.match(result.error, /允许插件打开/)
  allow = true; result = await launch()
  assert.equal(result.ok, true); assert.equal(result.already, true); assert.notEqual(result.skipped, true)
})

test('manual SnowLuma login opening stays limited to Windows loopback URLs', () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  function openLocalUrl(url) {'), end = source.indexOf('  // SnowLuma 连不上', start)
  let calls = 0
  const proc = { platform: 'win32', env: { SURFCORE_SKIP_AUTOSTART: '1' } }
  const open = runInNewContext(`${source.slice(start, end)}\nopenLocalUrl`, { process: proc, spawn: () => { calls++; return { on: () => {}, unref: () => {} } } })
  assert.equal(open('https://example.com'), false); assert.equal(calls, 0)
  assert.equal(open('http://127.0.0.1:3100'), true); assert.equal(calls, 1)
  proc.platform = 'darwin'; assert.equal(open('http://127.0.0.1:3100'), false); assert.equal(calls, 1)
})

test('manual SnowLuma launch reports asynchronous spawn failures', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  async function launchSnowLuma() {'), end = source.indexOf('  // ── 启动完成弹窗', start)
  const launch = runInNewContext(`${source.slice(start, end)}\nlaunchSnowLuma`, {
    process: { env: {} }, readQqConfig: () => ({ config: { snowluma: { allowLaunch: true } } }),
    snowLumaWebui: () => ({ port: 3100, url: 'http://127.0.0.1:3100' }), portOpen: async () => false,
    resolveSnowLumaLauncher: () => '/project/launcher', path,
    spawn: () => { const child = new EventEmitter(); child.unref = () => {}; setImmediate(() => child.emit('error', new Error('启动器不可执行'))); return child },
  })
  const result = await launch(); assert.equal(result.ok, false); assert.match(result.error, /启动器不可执行/)
})

test('manual SnowLuma launch waits for the launcher and offers its login page', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  async function launchSnowLuma() {'), end = source.indexOf('  // ── 启动完成弹窗', start)
  let started = false, opened = false
  const launch = runInNewContext(`${source.slice(start, end)}\nlaunchSnowLuma`, {
    process: { env: { SURFCORE_SKIP_AUTOSTART: '1' } }, readQqConfig: () => ({ config: { snowluma: { allowLaunch: true } } }),
    snowLumaWebui: () => ({ port: 3100, url: 'http://127.0.0.1:3100' }), portOpen: async port => port === 3100 && started,
    resolveSnowLumaLauncher: () => '/project/launcher', path, setTimeout: fn => { fn(); return 1 },
    openLocalUrl: () => { opened = true; return true },
    spawn: () => { const child = new EventEmitter(); child.unref = () => {}; setImmediate(() => { started = true; child.emit('spawn') }); return child },
  })
  const result = await launch(); assert.equal(result.started, true); assert.equal(result.opened, true); assert.equal(opened, true)
})

test('one-click results retain platform diagnostics and stop messages', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = source.slice(source.indexOf("  const LAUNCH_IDS = ['qq', 'bili', 'voice'];"), source.indexOf('  async function handleBridge(req, res) {'))
  let enabled = true
  const run = runInNewContext(`${body}\nrunLaunchAction`, {
    bridgeStatus: async () => ({ running: false }), bridgeStaleReason: () => '', currentDshUrl: () => 'http://127.0.0.1:3082',
    platformStartEnabled: () => enabled, startBridge: async () => ({ ok: true, message: '桥接已启动' }),
    launchSnowLuma: async () => { throw new Error('启动器不存在') },
    startSchedulerNow: () => ({ running: false, lastError: '缺少凭据' }),
    stopSchedulerNow: () => ({ ok: true, wasRunning: false }), stopBridge: async () => ({ ok: true }),
    scheduler: null, schedulerStatus: { running: false }, watchStartupCompletion: async () => {}, cancelStartupWatch: () => {},
  })
  let item = (await run('start', { components: ['bili'] })).items[0]
  assert.equal(item.code, 'BILI_START_FAILED'); assert.match(item.error, /缺少凭据/); assert.ok(item.hint)
  item = (await run('start', { components: ['qq'] })).items[0]
  assert.equal(item.code, 'QQ_START_PARTIAL'); assert.match(item.error, /桥接已启动.*启动器不存在/); assert.ok(item.hint)
  item = (await run('stop', { components: ['bili'] })).items[0]
  assert.match(item.message, /本来就没在跑/)
  enabled = false
  item = (await run('start', { components: ['qq'] })).items[0]
  assert.equal(item.code, 'PLATFORM_DISABLED'); assert.ok(item.hint)
})

test('legacy QQ and all-platform start routes use the one-click result without hiding failures', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  async function handleBridge(req, res) {'), end = source.indexOf('  // ── B站动作', start)
  const body = source.slice(start, end)
  let request, response, calls = [], starts = { qq: true, bili: false }
  const handle = runInNewContext(`${body}\nhandleBridge`, {
    readBody: async () => JSON.stringify(request), json: (_res, status, data) => { response = { status, data } },
    platformStartEnabled: () => true, platformStartState: () => starts, schedulerStatus: { running: false }, idleSchedulerStatus: () => ({ running: false, disabled: true }),
    runLaunchAction: async (action, input) => {
      calls.push([action, [...input.components]])
      return { ok: false, items: [{ id: 'qq', ok: false, error: 'SnowLuma 启动失败', detail: { bridge: { ok: true }, snowluma: { ok: false } } }], status: {} }
    },
  })
  request = { action: 'start-qq' }; await handle({ method: 'POST' }, {})
  assert.equal(response.data.ok, false); assert.match(response.data.error, /SnowLuma/); assert.equal(response.data.bridge.ok, true)
  request = { action: 'start-all' }; await handle({ method: 'POST' }, {})
  assert.equal(response.data.ok, false); assert.equal(response.data.snowluma.ok, false)
  assert.deepEqual(calls, [['start', ['qq']], ['start', ['qq']]])
  starts = { qq: false, bili: false }; await handle({ method: 'POST' }, {})
  assert.equal(response.data.ok, true); assert.equal(response.data.bridge.skipped, true); assert.equal(response.data.scheduler.disabled, true); assert.equal(calls.length, 2)
})

test('one-click launch delegates voice activation and stops voice before QQ', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = source.slice(source.indexOf("  const LAUNCH_IDS = ['qq', 'bili', 'voice'];"), source.indexOf('  async function handleBridge(req, res) {'))
  const calls = []
  const client = { voicePacks: async () => ({ packs: [{ id: 'voice-cloud', installed: true, running: false }] }),
    activateVoicePack: async id => { calls.push(['startVoice', id]); return { ok: true, warning: '预热中' } },
    stopOwnedVoicePacks: async () => { calls.push(['stopVoice']); return { ok: true, stopped: ['voice-cloud'] } } }
  const run = runInNewContext(`${body}\nrunLaunchAction`, { createSurfcoreComponentClient: () => client, DSH_HOME: '/project',
    bridgeStatus: async () => ({ running: false }), stopBridge: async () => { calls.push(['stopQQ']); return { ok: true } },
    scheduler: null, schedulerStatus: { running: false }, platformStartEnabled: () => true,
    cancelStartupWatch: () => {}, watchStartupCompletion: async () => {} })
  let result = await run('start', { components: ['voice'], voicePack: 'voice-cloud' })
  assert.equal(result.ok, true); assert.match(result.items[0].message, /预热中/)
  result = await run('stop', { components: ['qq', 'voice'] })
  assert.equal(result.ok, true); assert.deepEqual(calls, [['startVoice', 'voice-cloud'], ['stopVoice'], ['stopQQ']])
  client.voicePacks = async () => ({ packs: [] })
  result = await run('start', { components: ['voice'], voicePack: 'voice-cloud' })
  assert.equal(result.ok, false); assert.equal(result.items[0].code, 'VOICE_PACK_NOT_INSTALLED')
  client.stopOwnedVoicePacks = async () => { throw new Error('语音服务离线') }
  result = await run('stop', { components: ['qq', 'voice'] })
  assert.equal(result.ok, false); assert.match(result.items[0].error, /语音服务离线/); assert.equal(result.items[1].ok, true)
})

test('explicit one-click launch requests completion notification and stop cancels it', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = source.slice(source.indexOf("  const LAUNCH_IDS = ['qq', 'bili', 'voice'];"), source.indexOf('  async function handleBridge(req, res) {'))
  const watched = []; let cancelled = 0, running = true
  const run = runInNewContext(`${body}\nrunLaunchAction`, {
    bridgeStatus: async () => ({ running: false }), platformStartEnabled: () => true,
    startSchedulerNow: () => ({ running }), stopSchedulerNow: () => ({ ok: true, wasRunning: true }),
    scheduler: null, schedulerStatus: { running: false },
    watchStartupCompletion: options => { watched.push({ ...options }); return Promise.resolve() }, cancelStartupWatch: () => { cancelled++ },
  })
  await run('start', { components: ['bili'] })
  assert.deepEqual(watched, [{ qq: false, bili: true }])
  running = false; await run('start', { components: ['bili'] }); assert.equal(watched.length, 1)
  await run('stop', { components: ['bili'] }); assert.equal(cancelled, 3)
  assert.match(source, /path\.join\(STATE_DIR, `surfcore-startup-/)
  assert.doesNotMatch(source, /process\.platform !== 'win32' \|\| process\.env\.SURFCORE_SKIP_AUTOSTART === '1'/)
})

test('completion watcher respects notification setting and ignores results after cancellation', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = source.slice(source.indexOf('  let startupWatcher = null;'), source.indexOf('  // ── 桥接控制', source.indexOf('  let startupWatcher = null;')))
  let enabled = false, release, checks = 0; const popups = []
  const watcher = runInNewContext(`${body}\n({ watchStartupCompletion, cancelStartupWatch })`, {
    process: { platform: 'win32' }, readUnified: () => ({ config: { bridge: { startupNotify: enabled } } }),
    bridgeStatus: () => { checks++; return new Promise(resolve => { release = resolve }) },
    schedulerStatus: { running: true }, showStartupPopup: (...args) => popups.push(args), pluginLog: () => {},
    Promise, Date, setTimeout,
  })
  await watcher.watchStartupCompletion({ qq: true, bili: false }); assert.equal(checks, 0)
  enabled = true
  const pending = watcher.watchStartupCompletion({ qq: true, bili: false })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(checks, 1)
  watcher.cancelStartupWatch()
  release({ running: true, ok: true, dshReady: true, snowluma: { connected: true, accountOnline: true } })
  await pending; assert.equal(popups.length, 0)
  const retry = watcher.watchStartupCompletion({ qq: true, bili: false })
  await new Promise(resolve => setImmediate(resolve)); assert.equal(checks, 2)
  release({ running: true, ok: true, dshReady: true, snowluma: { connected: true, accountOnline: true } })
  await retry; assert.equal(popups.length, 1)
})

test('QQ stale bridge detection checks the project source and current DSH port', () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const body = source.slice(source.indexOf('  function currentDshUrl() {'), source.indexOf('  // 自动拉起桥接', source.indexOf('  function currentDshUrl() {')))
  const stale = runInNewContext(`${body}\nbridgeStaleReason`, { path, QQBOT_ROOT: '/project/surfcore', ctx: { get: () => ({ protocol: 'http:', port: 3082 }) }, process: { env: {} } })
  assert.match(stale({ running: true, root: '/old/surfcore', dshBaseUrl: 'http://127.0.0.1:3082' }), /旧目录/)
  assert.match(stale({ running: true, root: '/project/surfcore', dshBaseUrl: 'http://127.0.0.1:3000' }), /旧 DSH/)
  assert.equal(stale({ running: true, root: '/project/surfcore', dshBaseUrl: 'http://127.0.0.1:3082/' }), '')
  assert.equal(stale({ running: false }), '')
})

test('component updater refuses the pinned SurfCore source and paths that overlap it', () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  function fixedSourceUpdateReason(')
  const end = source.indexOf('  const updates = createUpdatesService(', start)
  assert.ok(start > 0 && end > start)
  const reason = runInNewContext(`${source.slice(start, end)}\nfixedSourceUpdateReason`, {
    fs: { realpathSync: value => value }, path, QQBOT_ROOT: '/project/plugins/surfcore',
  })
  assert.match(reason({ id: 'surfcore', dir: '/elsewhere' }), /固定版本/)
  assert.match(reason({ id: 'custom', dir: '/project/plugins/surfcore/src' }), /固定版本/)
  assert.match(reason({ id: 'custom', dir: '/project/plugins' }), /固定版本/)
  assert.match(reason({ id: 'custom', dir: '/project/deepseek-harness' }), /固定版本/)
  assert.match(reason({ id: 'custom', dir: '/project/superagent/src' }), /固定版本/)
  assert.equal(reason({ id: 'custom', dir: '/project/plugins/other' }), '')
  assert.match(source, /blockedReason: fixedSourceUpdateReason/)
  const rollback = source.slice(source.indexOf("    if (action === 'rollback') {", source.indexOf('  async function handleUpdates')), source.indexOf("    if (action === 'dismiss')", source.indexOf('  async function handleUpdates')))
  assert.match(rollback, /fixedSourceUpdateReason/)
  assert.ok(rollback.indexOf('fixedSourceUpdateReason') < rollback.indexOf('updates.rollback'))
})

test('rollback checks the resolved component before touching backups', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const helper = source.slice(source.indexOf('  function fixedSourceUpdateReason('), source.indexOf('  const updates = createUpdatesService('))
  const branchStart = source.indexOf("    if (action === 'rollback') {", source.indexOf('  async function handleUpdates'))
  const branch = source.slice(branchStart, source.indexOf("    if (action === 'dismiss')", branchStart))
  let calls = 0, result
  const run = runInNewContext(`${helper}\nasync function run(body) { const action = 'rollback', ids = []; const res = {}; ${branch} }\nrun`, {
    fs: { realpathSync: value => value }, path, QQBOT_ROOT: '/project/plugins/surfcore',
    readUnified: () => ({ config: { updates: { components: [{ id: 'alias' }, { id: 'alias', dir: '/project/plugins/surfcore/src' }, { id: 'other', dir: '/project/other' }] } } }),
    json: (_res, status, data) => { result = { status, data } }, updates: { rollback: async () => { calls++; return { ok: true } } },
  })
  await run({ id: 'alias' }); assert.equal(result.status, 409); assert.equal(calls, 0)
  await run({ id: 'surfcore' }); assert.equal(result.status, 409); assert.equal(calls, 0)
  await run({ id: 'other' }); assert.equal(result.status, 200); assert.equal(calls, 1)
})

test('audit folder opening reports asynchronous explorer failures', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  async function handleOwnerAudit('), end = source.indexOf('  // ── 平台', start)
  let result
  const handle = runInNewContext(`${source.slice(start, end)}\nhandleOwnerAudit`, {
    process: { platform: 'win32' }, path, QQBOT_ROOT: '/project/surfcore',
    readBody: async () => JSON.stringify({ action: 'open' }),
    json: (_res, status, data) => { result = { status, data } },
    spawn: () => { const child = new EventEmitter(); child.unref = () => {}; setImmediate(() => child.emit('error', new Error('无法打开文件管理器'))); return child },
  })
  await handle({ method: 'POST' }, {}, {})
  assert.equal(result.status, 500); assert.match(result.data.error, /无法打开文件管理器/)
})

test('audit read reports bridge unavailability rather than returning a successful empty response', async () => {
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const start = source.indexOf('  async function handleOwnerAudit('), end = source.indexOf('  // ── 平台', start)
  let result, bridge = { ok: false, status: 0, error: '无法连接桥接' }
  const handle = runInNewContext(`${source.slice(start, end)}\nhandleOwnerAudit`, {
    callBridge: async () => bridge, json: (_res, status, data) => { result = { status, data } },
  })
  await handle({ method: 'GET' }, {}, new URL('http://localhost/?limit=50'))
  assert.equal(result.status, 503); assert.match(result.data.error, /无法连接桥接/)
  bridge = { ok: true, status: 200, data: { ok: true, entries: [] } }
  await handle({ method: 'GET' }, {}, new URL('http://localhost/?limit=50'))
  assert.equal(result.status, 200); assert.equal(result.data.entries.length, 0)
})

test('component update protection resolves symbolic links to pinned source', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const project = mkdtempSync(join(base, 'pinned-source-')); t.after(() => rmSync(project, { recursive: true, force: true }))
  const surfcore = join(project, 'plugins/surfcore'); mkdirSync(join(surfcore, 'src'), { recursive: true })
  try { fs.symlinkSync(join(surfcore, 'src'), join(project, 'alias'), 'dir') }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) { t.skip('symbolic links unavailable'); return }; throw error }
  const source = renderHostSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/index.js'), 'utf8'))
  const helper = source.slice(source.indexOf('  function fixedSourceUpdateReason('), source.indexOf('  const updates = createUpdatesService('))
  const reason = runInNewContext(`${helper}\nfixedSourceUpdateReason`, { fs, path, QQBOT_ROOT: surfcore })
  assert.match(reason({ id: 'alias', dir: join(project, 'alias') }), /固定版本/)
})

test('Bilibili scheduler no longer loads role cards or the legacy memory maintainer', (t) => {
  const source = readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8')
  const result = renderSchedulerSource(source, 'file:///local/hooks.mjs')
  assert.doesNotMatch(result, /from '\.\/memory-card\.js'/)
  assert.match(result, /function personaCardBlock\(\) \{ return '' \}/)
  assert.match(result, /memoryContextCached\('bili'\)/)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'scheduler-transform-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'scheduler.mjs'); writeFileSync(file, result)
  execFileSync(process.execPath, ['--check', file])
})

test('Bilibili wake prompt uses project-local tool and diary paths without role cards', () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///local/hooks.mjs')
  const body = source.slice(source.indexOf('function wakePrompt('), source.indexOf('/**\n * 把 B站 自己的 DSH 会话切到指定权限'))
  const dataDir = '/project path/.artifacts/dsh-home/surfcore/bili', tools = 'node "/project path/plugins/surfcore/plugins/surfcore/tools/bili.mjs"'
  const wake = runInNewContext(`${body}\nwakePrompt`, {
    limitsNow: () => ({ daily: 1, globalMin: 1, perUpMin: 1, perVideoMin: 1, taDaily: 1, perThreadMin: 60 }), config: () => ({}),
    kindsNow: () => ({ best: { slot: 12, minLen: 10, maxLen: 100 }, game: { minLen: 10, maxLen: 100 } }),
    identityContextLines: () => [], silenceLines: () => [], diaryPushLines: () => [], taToday: () => 0,
    fs: { existsSync: () => false, readFileSync: () => { throw new Error('missing') } }, path, platformDir: () => dataDir,
  })
  const prompt = wake({ atText: '现在' }, tools)
  assert.doesNotMatch(prompt, /~\/\.dsh|人格卡|角色卡|人设卡/)
  assert.ok(prompt.includes(`${tools} selftest`))
  assert.ok(prompt.includes(`${dataDir}/whale-diary.md`))
  assert.ok(prompt.includes(`${dataDir}/whale-diary-private.md`))
  assert.ok(prompt.includes(`${dataDir}/memes`))
  assert.match(prompt, /feed.*选题/)
  assert.match(prompt, /comment-digest/)
  assert.doesNotMatch(source, /按 AGENTS\.md/)
})

test('transformed SurfCore host starts offline and rejects removed management routes', (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'surfcore-host-smoke-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const qq = join(dir, 'qq'); mkdirSync(join(qq, 'src'), { recursive: true })
  writeFileSync(join(qq, 'src/bridge.js'), '')
  writeFileSync(join(qq, 'config.json'), JSON.stringify({ allow: { groups: ['12345'] } }))
  mkdirSync(join(qq, 'state'), { recursive: true })
  writeFileSync(join(qq, 'state/qq-public-feed.jsonl'), JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '54321', text: '我B站叫星空' }) + '\n')
  const loader = resolve('scripts/surfcore-loader.mjs')
  const entry = resolve('plugins/surfcore/plugins/surfcore/lib/index.js')
  const program = `
    import { EventEmitter } from 'node:events'; import { Readable } from 'node:stream';
    import { createServer } from 'node:http'; import { mkdirSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';
    const routes = []; const effects = [];
    const ctx = { webServer: { register: route => { routes.push(route); return () => {} } },
      get: name => name === 'connection' ? { requestRejection: () => false } : null,
      effect: fn => { effects.push(fn); return () => {} },
      sessionController: { inspect: async () => ({ events: [] }), create: async () => ({}), prompt: async () => ({ accepted: true }) } };
    const { apply } = await import(${JSON.stringify(new URL(`file://${entry}`).href)});
    apply(ctx);
    if (routes.some(route => route.path.includes('pet-api'))) throw new Error('pet route is still registered');
    const api = routes.find(route => route.path === '/dsh-surfcore/api');
    async function get(path) {
      const req = new EventEmitter(); Object.assign(req, { method: 'GET', url: path, headers: { host: '127.0.0.1:3082' } });
      const res = { status: 200, body: '', writeHead(code) { this.status = code }, end(body = '') { this.body += body } };
      await api.handler(req, res); return { status: res.status, data: JSON.parse(res.body || '{}') };
    }
    for (const path of ['characters', 'persona', 'memory', 'memory-card', 'voice/packs', 'pet/status']) {
      const response = await get('/dsh-surfcore/api/' + path);
      if (response.status !== 404) throw new Error(path + ' was not removed: ' + response.status);
    }
    const overview = await get('/dsh-surfcore/api/overview');
    if (overview.status !== 200 || !overview.data.ok) throw new Error('overview failed: ' + JSON.stringify(overview));
    if (process.platform !== 'win32') {
      const auditReq = Readable.from([Buffer.from(JSON.stringify({ action: 'open' }))]);
      Object.assign(auditReq, { method: 'POST', url: '/dsh-surfcore/api/owner-audit', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } });
      const auditRes = { status: 200, body: '', writeHead(code) { this.status = code }, end(body = '') { this.body += body } };
      await api.handler(auditReq, auditRes);
      if (auditRes.status !== 200 || !JSON.parse(auditRes.body).error.includes('Windows')) throw new Error('audit route did not handle open: ' + auditRes.body);
    }
    const req = Readable.from([Buffer.from(JSON.stringify({ action: 'scan' }))]);
    Object.assign(req, { method: 'POST', url: '/dsh-surfcore/api/align', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } });
    const res = { status: 200, body: '', writeHead(code) { this.status = code }, end(body = '') { this.body += body } };
    await api.handler(req, res); const scan = JSON.parse(res.body || '{}');
    if (res.status !== 200 || !scan.ok || scan.qq.added < 1 || scan.bili.ok !== false) throw new Error('alignment scan failed: ' + res.body);
    let calls = 0, briefEnabled = true;
    const memory = createServer((req, res) => {
      if (req.headers['x-component-token'] !== 'a'.repeat(64)) { res.writeHead(403); res.end('{}'); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      if (req.url === '/dsh-memory/internal/bili/refresh') { calls++; res.end('{"ok":true,"refreshed":true}'); return; }
      if (req.url === '/dsh-memory/internal/bili/brief') { res.end(JSON.stringify({ ok: true, enabled: briefEnabled, blocked: false, labels: [], text: '独立记忆的公开简报', status: { briefChars: 10, docChars: 42, generatedAt: '2026-11-01' } })); return; }
      res.end('{}');
    });
    await new Promise(resolve => memory.listen(0, '127.0.0.1', resolve));
    const memoryDir = join(process.env.DSH_HOME, 'memory'); mkdirSync(memoryDir, { recursive: true });
    writeFileSync(join(memoryDir, 'runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:' + memory.address().port, token: 'a'.repeat(64) }));
    const platforms = await get('/dsh-surfcore/api/platforms');
    const biliRuntime = platforms.data.platforms.find(platform => platform.id === 'bili')?.runtime;
    if (!biliRuntime?.enabled || !biliRuntime.available || biliRuntime.docChars !== 42 || biliRuntime.briefPreview !== '独立记忆的公开简报') throw new Error('independent Bilibili platform status missing: ' + JSON.stringify(biliRuntime));
    for (const biliBridge of [{ enabled: false }, { enabled: true, memory: { enabled: false } }]) {
      writeFileSync(join(process.env.SURFCORE_QQBOT_ROOT, 'config.json'), JSON.stringify({ biliBridge }));
      const changed = await get('/dsh-surfcore/api/platforms');
      const status = changed.data.platforms.find(platform => platform.id === 'bili')?.runtime;
      if (status?.enabled !== false) throw new Error('disabled QQ bridge was reported enabled: ' + JSON.stringify(status));
    }
    writeFileSync(join(process.env.SURFCORE_QQBOT_ROOT, 'config.json'), JSON.stringify({ biliBridge: { enabled: true, memory: { enabled: true } } }));
    briefEnabled = false;
    const disabledMemory = await get('/dsh-surfcore/api/platforms');
    if (disabledMemory.data.platforms.find(platform => platform.id === 'bili')?.runtime?.enabled !== false) throw new Error('disabled memory reported enabled');
    briefEnabled = true;
    const refreshReq = Readable.from([Buffer.from(JSON.stringify({ action: 'refresh-bili' }))]);
    Object.assign(refreshReq, { method: 'POST', url: '/dsh-surfcore/api/bridge', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } });
    const refreshRes = { status: 200, body: '', writeHead(code) { this.status = code }, end(body = '') { this.body += body } };
    await api.handler(refreshReq, refreshRes); await new Promise(resolve => memory.close(resolve));
    if (refreshRes.status !== 200 || !JSON.parse(refreshRes.body).refreshed || calls !== 1) throw new Error('independent Bilibili refresh failed: ' + refreshRes.body);
    const disconnected = await get('/dsh-surfcore/api/platforms');
    const failedBili = disconnected.data.platforms.find(platform => platform.id === 'bili')?.runtime;
    if (disconnected.status !== 200 || failedBili?.ok !== false || !failedBili.error) throw new Error('offline memory did not report platform error');
    for (const effect of effects) { const dispose = effect(); if (typeof dispose === 'function') dispose(); }
    process.exit(0);
  `
  execFileSync(process.execPath, ['--import', loader, '--input-type=module', '-e', program], {
    env: { ...process.env, DSH_HOME: join(dir, 'dsh'), SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_ROOT: qq,
      SURFCORE_QQBOT_ROOT: qq, SURFCORE_SKIP_AUTOSTART: '1', SURFCORE_DISABLE_CHARACTER_MIGRATION: '1',
      SURFCORE_DISABLE_MEMORY_TIMER: '1', SURFCORE_DISABLE_PLATFORM_RESTART: '1', SURFCORE_COMPONENT_SPLIT: '1' },
    stdio: 'pipe', timeout: 15000,
  })
})
