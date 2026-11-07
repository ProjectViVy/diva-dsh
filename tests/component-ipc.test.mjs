import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { callComponent, registerComponentInternal } from '../plugins/_shared/ipc.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'
import { registerVoiceInternal } from '../plugins/voice/src/internal.mjs'
import { createVoiceService } from '../plugins/voice/src/service.mjs'
import { createSessionMemoryStore } from '../plugins/memory/src/session-memory.mjs'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { createBiliMemory } from '../plugins/memory/src/bili-memory.mjs'
import { createSurfcoreComponentClient, collectSplitComponentDiagnostics } from '../scripts/lib/surfcore-component-client.mjs'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

test('SurfCore diagnostics reads both component services through authenticated IPC', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'diagnostics-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const routes = []
  const ctx = { webServer: { port: 3082, register: route => { routes.push(route); return () => {} } } }
  const stopMemory = registerMemoryInternal(ctx, home, { qqSyncStatus: async () => ({ ok: true, config: { enabled: false } }), biliBriefPreview: async () => ({ ok: true, enabled: false }) })
  const stopVoice = registerVoiceInternal(ctx, home, { launchStatus: async () => ({ ok: true, packs: [{ id: 'voice-local', installed: true, running: false }] }) })
  t.after(() => { stopMemory(); stopVoice() })
  const client = createSurfcoreComponentClient({ home, fetchImpl: async (url, options) => {
    const pathname = new URL(url).pathname
    const handler = routes.find(route => pathname.startsWith(route.path)).handler
    const req = Readable.from([]); Object.assign(req, { url: pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } }); return new Response(body, { status })
  } })
  const checks = await collectSplitComponentDiagnostics(client)
  assert.deepEqual(checks.map(check => check.ok), [true, true, true])
  assert.match(checks[0].detail, /未开启/)
  assert.match(checks[2].detail, /已安装 1/)
})

test('SurfCore delegates voice pack status, activation and owned shutdown to the voice plugin', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-launch-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const calls = []; let handler
  const service = { launchStatus: async () => ({ ok: true, packs: [{ id: 'voice-local', installed: true, running: false }] }),
    activate: async id => { calls.push(['activate', id]); return { ok: true } },
    stopOwned: async () => { calls.push(['stopOwned']); return { ok: true, stopped: ['voice-local'] } } }
  const dispose = registerVoiceInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service); t.after(dispose)
  const client = createSurfcoreComponentClient({ home, fetchImpl: async (url, options) => {
    const req = Readable.from(options.body ? [options.body] : []); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } }); return new Response(body, { status })
  } })
  assert.equal((await client.voicePacks()).packs[0].id, 'voice-local')
  await client.activateVoicePack('voice-local'); await client.stopOwnedVoicePacks()
  assert.deepEqual(calls, [['activate', 'voice-local'], ['stopOwned']])
})

test('voice availability checks the authenticated live endpoint instead of a stale discovery file', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-live-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler, active = true
  const dispose = registerVoiceInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => { active = false } } } }, home, {})
  const discovery = readFileSync(join(home, 'voice/runtime.json'), 'utf8')
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async (url, options) => {
    if (!active) throw new Error('offline')
    const req = Readable.from([]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } })
  await hooks.assertIndependentVoiceAvailable()
  dispose()
  writeFileSync(join(home, 'voice/runtime.json'), discovery)
  await assert.rejects(hooks.assertIndependentVoiceAvailable(), /voice|语音|unavailable/i)
})

test('voice availability rejects an endpoint replaced during the health check', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-health-replaced-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'voice'); mkdirSync(dir, { recursive: true })
  const file = join(dir, 'runtime.json')
  writeFileSync(file, JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  const hooks = createBridgeHooks({ home, fetchImpl: async () => {
    writeFileSync(file, JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'b'.repeat(64) }))
    return new Response('{"ok":true}', { status: 200 })
  } })
  await assert.rejects(hooks.assertIndependentVoiceAvailable(), /状态已变化/)
})

test('voice IPC can request the fallback engine default without changing saved voice settings', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-fallback-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'voice'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'cloud', character: '主路音色', routeVoiceSelections: { local: { character: '备用音色' } } } } }))
  let sent, handler
  const service = createVoiceService({ stateDir: dir, fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return new Response(Buffer.alloc(100, 1)) } })
  const stop = registerVoiceInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(async () => { stop(); await service.dispose() })
  const hooks = createBridgeHooks({ home, fetchImpl: async (url, options) => {
    const req = Readable.from([options.body]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } }); t.after(() => hooks.stopMemoryOutbox())
  await hooks.synthesizeToFile({ text: '备用线路测试', baseUrl: 'http://127.0.0.1:8765', character: '主路音色', useDefaultVoice: true })
  assert.equal(sent.character, undefined)
  assert.equal(sent.voice, undefined)
  assert.equal((await service.rules()).ttsCharacter, '主路音色')
  await hooks.synthesizeToFile({ text: '保存音色测试', baseUrl: 'http://127.0.0.1:8765', character: '主路音色', useRouteVoice: 'local' })
  assert.equal(sent.character, '备用音色')
  assert.equal((await service.rules()).ttsCharacter, '主路音色')
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'cloud', character: '主路音色' } } }))
  await hooks.synthesizeToFile({ text: '未保存备用音色', baseUrl: 'http://127.0.0.1:8765', character: '主路音色', useRouteVoice: 'local' })
  assert.equal(sent.character, undefined)
  assert.equal(sent.voice, undefined)
  await assert.rejects(hooks.synthesizeToFile({ text: '无效线路', useRouteVoice: 'invalid' }), /无效的语音线路/)
})

test('memory sharing availability rejects stale discovery after the component stops', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-live-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler, active = true
  const dispose = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => { active = false } } } }, home, {})
  const discovery = readFileSync(join(home, 'memory/runtime.json'), 'utf8')
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async (url, options) => {
    if (!active) throw new Error('offline')
    const req = Readable.from([]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } })
  const memory = hooks.createRemoteBiliMemory()
  await memory.assertAvailable()
  assert.equal(await hooks.isIndependentMemoryAvailable(), true)
  dispose(); writeFileSync(join(home, 'memory/runtime.json'), discovery)
  await assert.rejects(memory.assertAvailable(), /memory|记忆|unavailable/i)
  assert.equal(await hooks.isIndependentMemoryAvailable(), false)
})

test('SurfCore extensions use independent memory status, previews and QQ sync through authenticated IPC', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'extension-memory-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const feed = join(home, 'qq-feed.jsonl')
  writeFileSync(feed, [
    { at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '群友讨论天上的星星' },
    { at: new Date().toISOString(), groupId: '99999', senderId: '22222', text: '不允许的群消息' },
  ].map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: join(home, 'memory'), qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  let handler
  const { createServer } = await import('node:http')
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(async () => { dispose(); await new Promise(resolve => server.close(resolve)); await service.dispose() })
  const { execFile } = await import('node:child_process'), { promisify } = await import('node:util'), { pathToFileURL } = await import('node:url')
  const hostUrl = pathToFileURL(resolve('plugins/surfcore/plugins/surfcore/lib/extensions.js')).href
  const apiUrl = pathToFileURL(resolve('scripts/lib/surfcore-component-client.mjs')).href
  const script = `import { ExtensionHost } from ${JSON.stringify(hostUrl)}; import { createExtensionMemoryApi } from ${JSON.stringify(apiUrl)};
    const host = new ExtensionHost({ memory: createExtensionMemoryApi({ home: process.env.DSH_HOME }) });
    const api = host.createApi({ id: 'fixture' }, [], []);
    const sync = await api.memory.syncQqToBili(); const preview = await api.memory.previewQqForBili();
    const status = await api.memory.memoryStatus(); const audit = await api.memory.auditTail();
    process.stdout.write(JSON.stringify({ sync, preview, status, audit }));`
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DSH_HOME: home, NODE_OPTIONS: '' } })
  const result = JSON.parse(stdout)
  assert.equal(result.sync.ok, true)
  assert.match(result.preview.text, /群友讨论天上的星星/)
  assert.doesNotMatch(result.preview.text, /不允许的群消息/)
  assert.equal(result.status.qqToBili.config.enabled, true)
  assert.equal(result.audit.length, 1)
  const { createExtensionMemoryApi } = await import('../scripts/lib/surfcore-component-client.mjs')
  const memory = createExtensionMemoryApi({ home })
  assert.equal((await memory.previewQqForBili({ maxChars: 5 })).text.length, 5)
  await service.updateQqSync({ enabled: false })
  assert.equal((await memory.previewQqForBili()).text, '')
  await assert.rejects(memory.syncQqToBili(), /未启用/)
  dispose()
  await assert.rejects(memory.memoryStatus(), /unavailable/i)
})

test('extension memory reports a blocked QQ summary and unreadable audit', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'extension-privacy-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler
  const dispose = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, {
    qqSyncStatus: async () => ({ ok: true, config: { enabled: true }, text: '', summaryBlocked: true, summaryLabels: ['密码'], audit: [], auditError: '同步审计无法读取' }),
  }); t.after(dispose)
  const { createExtensionMemoryApi } = await import('../scripts/lib/surfcore-component-client.mjs')
  const api = createExtensionMemoryApi({ home, fetchImpl: async (url, options) => {
    const req = Readable.from([]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } })
  const preview = await api.previewQqForBili()
  assert.equal(preview.blocked, true); assert.deepEqual(preview.labels, ['密码']); assert.equal(preview.text, '')
  await assert.rejects(api.auditTail(), /审计无法读取/)
})

test('extension Bilibili refresh and brief call the independent memory service', async t => {
  const { createExtensionMemoryApi } = await import('../scripts/lib/surfcore-component-client.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'extension-bili-memory-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler, refreshed = 0
  const dispose = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, {
    refreshBili: async () => ({ ok: true, refreshed: ++refreshed }),
    biliBriefPreview: async () => ({ ok: true, enabled: true, text: '公开见闻' }),
  }); t.after(dispose)
  const api = createExtensionMemoryApi({ home, fetchImpl: async (url, options) => {
    const req = Readable.from(options.body ? [options.body] : [])
    Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } })
  assert.equal((await api.refreshBiliToQq()).refreshed, 1)
  assert.equal((await api.biliToQqStatus()).text, '公开见闻')
})

test('extension memory status preserves the healthy direction when the other fails', async t => {
  const { createExtensionMemoryApi } = await import('../scripts/lib/surfcore-component-client.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'extension-memory-partial-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler, qqBroken = false, biliBroken = true
  const dispose = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, {
    qqSyncStatus: async () => { if (qqBroken) throw new Error('QQ 状态损坏'); return { ok: true, config: { enabled: true }, text: '公开群摘要' } },
    biliBriefPreview: async () => { if (biliBroken) throw new Error('B站摘要损坏'); return { ok: true, enabled: true, text: '公开动态' } },
  }); t.after(dispose)
  const api = createExtensionMemoryApi({ home, fetchImpl: async (url, options) => {
    const req = Readable.from([]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } })
  const qqOnly = await api.memoryStatus()
  assert.equal(qqOnly.qqToBili.text, '公开群摘要')
  assert.equal(qqOnly.biliToQq.ok, false); assert.match(qqOnly.biliToQq.error, /B站摘要损坏/)
  qqBroken = true; biliBroken = false
  const biliOnly = await api.memoryStatus()
  assert.equal(biliOnly.biliToQq.text, '公开动态')
  assert.equal(biliOnly.qqToBili.ok, false); assert.match(biliOnly.qqToBili.error, /QQ 状态损坏/)
  biliBroken = true
  await assert.rejects(api.memoryStatus(), /QQ 状态损坏|B站摘要损坏/)
})

test('memory availability rejects a discovery record replaced during its health check', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-health-race-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'memory'); mkdirSync(dir, { recursive: true })
  const file = join(dir, 'runtime.json')
  writeFileSync(file, JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  let release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async () => { entered(); await waiting; return new Response('{"ok":true}') } })
  const pending = hooks.isIndependentMemoryAvailable()
  await started
  writeFileSync(file, JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'b'.repeat(64) }))
  release()
  assert.equal(await pending, false)
})

test('internal component endpoints require their private token and remove discovery on disposal', async (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-ipc-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler
  const ctx = { webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }
  const dispose = registerComponentInternal(ctx, { home, name: 'memory', handle: async ({ body }) => ({ ok: true, echo: body.value }) })
  const discovery = JSON.parse(readFileSync(join(home, 'memory/runtime.json')))
  async function request(token) {
    const req = Readable.from(['{"value":7}'])
    Object.assign(req, { url: '/dsh-memory/internal/events', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', 'x-component-token': token } })
    let status, data
    await handler(req, { writeHead: code => { status = code }, end: value => { data = JSON.parse(value) } })
    return { status, data }
  }
  assert.equal((await request('')).status, 401)
  assert.equal((await request('incorrect')).status, 401)
  assert.equal((await request(discovery.token)).data.echo, 7)
  let called
  const result = await callComponent({ home, name: 'memory', path: '/events', body: { value: 7 }, fetchImpl: async (url, options) => {
    called = { url, token: options.headers['x-component-token'] }
    return new Response('{"ok":true}', { status: 200 })
  } })
  assert.equal(result.ok, true)
  assert.equal(called.url, 'http://127.0.0.1:3082/dsh-memory/internal/events')
  assert.equal(called.token, discovery.token)
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ token: discovery.token, baseUrl: 'http://example.com' }))
  await assert.rejects(callComponent({ home, name: 'memory', path: '/events' }), /loopback/i)
  dispose()
  await assert.rejects(callComponent({ home, name: 'memory', path: '/events' }), /unavailable/i)
})

test('voice and memory internal endpoints dispatch to their own service instances', async (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-routing-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const handlers = new Map()
  const ctx = { webServer: { port: 3082, register: route => { handlers.set(route.path, route.handler); return () => {} } } }
  const seen = []
  const memoryStop = registerMemoryInternal(ctx, home, { record: async value => { seen.push(value); return { ok: true } }, context: async platform => `context ${platform}`, snapshot: async () => ({ ok: true, records: [] }) })
  const voiceStop = registerVoiceInternal(ctx, home, { synthesize: async value => ({ path: `/audio/${value.text}` }), rules: async () => ({ ok: true, route: 'local' }) })
  async function invoke(name, path, body) {
    const discovery = JSON.parse(readFileSync(join(home, name, 'runtime.json')))
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(req, { url: `/dsh-${name}/internal${path}`, method: body ? 'POST' : 'GET', headers: { host: '127.0.0.1:3082', 'x-component-token': discovery.token } })
    let data
    await handlers.get(`/dsh-${name}/internal`)(req, { writeHead() {}, end: value => { data = JSON.parse(value) } })
    return data
  }
  assert.equal((await invoke('memory', '/events', { id: 'a' })).ok, true)
  assert.equal(seen[0].id, 'a')
  assert.equal((await invoke('memory', '/context/qq')).text, 'context qq')
  assert.equal((await invoke('voice', '/synthesize', { text: 'hello' })).path, '/audio/hello')
  memoryStop(); voiceStop()
})

test('QQ topic mention IPC updates current memory after a concurrent edit', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-topic-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const sessions = createSessionMemoryStore({ stateDir: join(home, 'memory') })
  const initial = await sessions.write('group:1', { activeTopics: [{ text: '话题', lastMentionAt: 10 }], pendingThoughts: [], memberImpressions: {} }, 0)
  let handler, release
  const gate = new Promise(resolve => { release = resolve })
  const stop = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, { sessions }); t.after(stop)
  const hooks = createBridgeHooks({ home, fetchImpl: async (url, options) => {
    await gate
    const req = Readable.from([options.body]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, data; await handler(req, { writeHead: code => { status = code }, end: value => { data = value } })
    return new Response(data, { status })
  } })
  const touching = hooks.touchSessionTopics('group:1', ['话题'], 30)
  await sessions.write('group:1', { ...initial.value, pendingThoughts: [{ text: '并发编辑' }] }, initial.revision)
  release(); await touching
  const result = await sessions.read('group:1')
  assert.equal(result.value.activeTopics[0].lastMentionAt, 30)
  assert.equal(result.value.pendingThoughts[0].text, '并发编辑')
})

test('bridge waits for a topic update queued during an ongoing memory delivery', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-topic-inflight-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  let release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const delivered = []
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async url => {
    const path = new URL(url).pathname
    if (path.endsWith('/events')) { entered(); await gate }
    delivered.push(path)
    return new Response('{"ok":true}')
  } }); t.after(() => hooks.stopMemoryOutbox())
  hooks.appendMemoryInboxEvent(null, { text: '测试消息', kind: 'group' })
  const first = hooks.drainMemoryOutbox()
  await started
  const touching = hooks.touchSessionTopics('group:1', ['话题'], 30)
  release()
  await Promise.all([first, touching])
  assert.deepEqual(delivered, ['/dsh-memory/internal/events', '/dsh-memory/internal/session/touch-topics'])
  assert.deepEqual(readdirSync(join(home, 'surfcore/memory-outbox')).filter(name => name.endsWith('.json')), [])
})

test('memory prompt cache refreshes immediately when the Bilibili identity configuration changes', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-bili-config-cache-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true }); mkdirSync(join(home, 'surfcore'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  const config = join(home, 'surfcore/bili.config.json'); writeFileSync(config, JSON.stringify({ owner: { name: '旧昵称' } }))
  let calls = 0
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async url => url.endsWith('/health') ? new Response('{"ok":true}') : new Response(JSON.stringify({ ok: true, text: `context-${++calls}` })) }); t.after(() => hooks.stopMemoryOutbox())
  assert.equal(await hooks.awaitMemoryContext('qq'), 'context-1')
  writeFileSync(config, JSON.stringify({ owner: { name: '新的管理员昵称' } }))
  assert.equal(await hooks.awaitMemoryContext('qq'), 'context-2')
})

test('QQ topic mentions survive an offline memory plugin and bridge restart', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-topic-retry-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const sessions = createSessionMemoryStore({ stateDir: join(home, 'memory') })
  const initial = await sessions.write('group:1', { activeTopics: [{ text: '话题', lastMentionAt: 10 }], pendingThoughts: [], memberImpressions: {} }, 0)
  const first = createBridgeHooks({ home, fetchImpl: async () => { throw new Error('offline') }, log() {} })
  await first.touchSessionTopics('group:1', ['话题'], 30)
  first.stopMemoryOutbox()
  const queue = join(home, 'surfcore/memory-outbox'), item = readdirSync(queue).find(name => name.endsWith('.json'))
  assert.ok(item)
  assert.doesNotMatch(readFileSync(join(queue, item), 'utf8'), /话题/)
  await sessions.write('group:1', { ...initial.value, pendingThoughts: [{ text: '离线期间编辑' }] }, initial.revision)
  let handler
  const stop = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, { sessions }); t.after(stop)
  const second = createBridgeHooks({ home, log() {}, fetchImpl: async (url, options) => {
    const req = Readable.from([options.body]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } }); t.after(() => second.stopMemoryOutbox())
  await second.drainMemoryOutbox()
  const result = await sessions.read('group:1')
  assert.equal(result.value.activeTopics[0].lastMentionAt, 30)
  assert.equal(result.value.pendingThoughts[0].text, '离线期间编辑')
})

test('Bilibili share history errors reach the QQ bridge across authenticated IPC', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-share-history-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const data = join(home, 'memory/data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'bili-share-history.json'); writeFileSync(file, '{损坏')
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: home })
  const service = createMemoryService({ stateDir: join(home, 'memory'), biliMemory })
  let handler
  const stop = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service); t.after(stop)
  const hooks = createBridgeHooks({ home, fetchImpl: async (url, options) => {
    const req = Readable.from([options.body]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = value } })
    return new Response(body, { status })
  } })
  await assert.rejects(hooks.createRemoteBiliMemory().recordShare('item', 'slot'), /分享历史.*损坏/)
  assert.equal(readFileSync(file, 'utf8'), '{损坏')
})

test('authenticated voice IPC enforces the configured synthesis text limit', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-voice-limit-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler, calls = 0
  const service = createVoiceService({ stateDir: join(home, 'voice'), fetchImpl: async () => { calls++; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  await service.saveRules({ ttsMaxChars: 3 })
  const stop = registerVoiceInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(stop)
  const token = JSON.parse(readFileSync(join(home, 'voice/runtime.json'), 'utf8')).token
  async function send(text) {
    const req = Readable.from([JSON.stringify({ text })]); Object.assign(req, { url: '/dsh-voice/internal/synthesize', method: 'POST', headers: { host: '127.0.0.1:3082', 'x-component-token': token } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: text => { body = JSON.parse(text) } }); return { status, body }
  }
  assert.equal((await send('四个字符')).status, 400)
  assert.equal(calls, 0)
  assert.equal((await send('三个字')).status, 200)
  assert.equal(calls, 1)
})

test('QQ voice IPC forwards an explicit character without adding the migrated default voice', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-voice-character-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'voice'); mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { voice: '旧音色', character: '默认角色' } } }))
  let handler, synthesis
  const service = createVoiceService({ stateDir: dir, fetchImpl: async (_url, options) => { synthesis = JSON.parse(options.body); return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  const stop = registerVoiceInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service); t.after(stop)
  const hooks = createBridgeHooks({ home, fetchImpl: async (url, options) => {
    const req = Readable.from([options.body]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, data; await handler(req, { writeHead: code => { status = code }, end: value => { data = value } })
    return new Response(data, { status })
  } })
  await hooks.synthesizeToFile({ text: '桥接测试', character: '指定角色' })
  assert.equal(synthesis.character, '指定角色')
  assert.equal(synthesis.voice, undefined)
})

test('the archive transport accepts the MemPalace component and keeps its domain error codes', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-archive-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler
  const dispose = registerComponentInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, {
    home, name: 'mempalace', handle: async ({ path }) => {
      if (path === '/archive') throw Object.assign(new Error('归档内容与此前的 archive_id 不一致'), { code: 'MEMPALACE_ARCHIVE_DIGEST_CONFLICT', hint: '该记录的 revision 已变化，请用新 archive_id 重新投递' })
      if (path === '/foreign-code') throw Object.assign(new Error('越界错误码'), { code: 'ACTMEM_SUBJECT_MISMATCH' })
      return { ok: true, path }
    },
  })
  t.after(dispose)
  const call = (path, body) => callComponent({ home, name: 'mempalace', path, body, fetchImpl: async (url, options) => {
    const req = Readable.from(options.body ? [options.body] : []); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, data; await handler(req, { writeHead: code => { status = code }, end: value => { data = value } })
    return new Response(data, { status })
  } })
  assert.equal((await call('/archive/status', { archive_ids: [] })).path, '/archive/status')
  await assert.rejects(call('/archive', { items: [] }), error => error.code === 'MEMPALACE_ARCHIVE_DIGEST_CONFLICT'
    && /revision/.test(String(error.hint)))
  await assert.rejects(call('/foreign-code', {}), error => error.code === 'COMPONENT_REQUEST_FAILED')
})

test('each component keeps only its own error-code prefixes', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'component-code-prefixes-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const calls = {}
  for (const name of ['memory', 'voice']) {
    let handler
    const dispose = registerComponentInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, {
      home, name, handle: async () => {
        if (handler === undefined) throw new Error('unreachable')
        throw Object.assign(new Error('领域错误'), { code: name === 'memory' ? 'ACTMEM_REVISION_CONFLICT' : 'MEMORY_OPERATION_FAILED', hint: '组件专属提示' })
      },
    })
    t.after(dispose)
    calls[name] = handler
  }
  const invoke = (name, handler) => callComponent({ home, name, path: '/x', body: {}, fetchImpl: async (url, options) => {
    const req = Readable.from([options.body]); Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status, data; await handler(req, { writeHead: code => { status = code }, end: value => { data = value } })
    return new Response(data, { status })
  } })
  await assert.rejects(invoke('memory', calls.memory), error => error.code === 'ACTMEM_REVISION_CONFLICT' && error.hint === '组件专属提示')
  await assert.rejects(invoke('voice', calls.voice), error => error.code === 'COMPONENT_REQUEST_FAILED')
})

test('an unregistered component name is refused on both sides of the shared transport', () => {
  assert.throws(() => registerComponentInternal({ webServer: { port: 3082, register: () => () => {} } }, { home: resolve('.'), name: 'unknown-component', handle: async () => ({ ok: true }) }), /Unknown component/)
  assert.rejects(callComponent({ home: resolve('.'), name: 'unknown-component', path: '/records' }), /Unknown component/)
})
