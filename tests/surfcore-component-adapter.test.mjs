import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createSurfcoreComponentClient } from '../scripts/lib/surfcore-component-client.mjs'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'
import { renderBridgeSource } from '../scripts/lib/surfcore-runtime-transform.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { createBiliMemory } from '../plugins/memory/src/bili-memory.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'
import { createVoiceService } from '../plugins/voice/src/service.mjs'
import { registerVoiceInternal } from '../plugins/voice/src/internal.mjs'
import { createServer } from 'node:http'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

test('SurfCore diagnostics reports independent memory directions and voice availability', async () => {
  const { collectSplitComponentDiagnostics } = await import('../scripts/lib/surfcore-component-client.mjs')
  assert.equal(typeof collectSplitComponentDiagnostics, 'function')
  const checks = await collectSplitComponentDiagnostics({
    qqSyncStatus: async () => ({ config: { enabled: true }, text: '摘要' }),
    biliBrief: async () => ({ enabled: true, blocked: false, status: { briefChars: 20 } }),
    voicePacks: async () => ({ packs: [{ id: 'voice-local', installed: true, running: true }] }),
  })
  assert.equal(checks.find(item => item.name === 'QQ→B站记忆').ok, true)
  assert.equal(checks.find(item => item.name === 'B站→QQ简报').ok, true)
  assert.match(checks.find(item => item.name === '语音组件（可选）').detail, /运行/)
  const failed = await collectSplitComponentDiagnostics({
    qqSyncStatus: async () => ({ config: { enabled: true }, summaryError: '摘要损坏' }),
    biliBrief: async () => ({ enabled: true, blocked: true, status: { briefChars: 20 } }),
    voicePacks: async () => { throw new Error('offline') },
  })
  assert.equal(failed.find(item => item.name === 'QQ→B站记忆').ok, false)
  assert.equal(failed.find(item => item.name === 'B站→QQ简报').ok, false)
  assert.equal(failed.find(item => item.name === '语音组件（可选）').ok, false)
})

test('Bilibili refresh IPC allows the full network refresh while normal requests retain their timeout', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'bili-timeout-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'))
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  const timeouts = [], original = AbortSignal.timeout
  t.mock.method(AbortSignal, 'timeout', ms => { timeouts.push(ms); return original(ms) })
  const client = createSurfcoreComponentClient({ home, fetchImpl: async () => new Response('{"ok":true,"text":""}') })
  await client.refreshBili()
  await client.memoryContext('qq')
  assert.ok(timeouts[0] >= 360000, `refresh timeout ${timeouts[0]}ms is shorter than the possible network wait`)
  assert.equal(timeouts[1], 65000)
})

test('Bilibili refresh IPC reports timeout without claiming the background task stopped', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'bili-timeout-error-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'))
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  t.mock.method(AbortSignal, 'timeout', () => AbortSignal.abort())
  const client = createSurfcoreComponentClient({ home, fetchImpl: async (_url, { signal }) => { signal.throwIfAborted() } })
  await assert.rejects(client.refreshBili(), /超时.*后台任务可能仍在运行/)
})

test('voice IPC permits a synthesis request to finish within its configured timeout', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'voice-timeout-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'voice'))
  writeFileSync(join(home, 'voice/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  let timeout
  const original = AbortSignal.timeout
  t.mock.method(AbortSignal, 'timeout', ms => { timeout = ms; return original(ms) })
  const client = createSurfcoreComponentClient({ home, fetchImpl: async () => new Response('{"ok":true,"path":"audio.wav"}', { status: 200 }) })
  await client.synthesize({ text: 'hello', timeoutMs: 120000 })
  assert.ok(timeout >= 120000 && timeout <= 130000, `unexpected IPC timeout ${timeout}`)
})

test('SurfCore synthesis uses the independent voice service, configured voice, and project-local cache', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'voice-ipc-flow-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const inputs = []
  const engine = createServer((req, res) => {
    let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => { inputs.push(JSON.parse(body)); res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(Buffer.alloc(100, 1)) })
  })
  await new Promise(resolve => engine.listen(0, '127.0.0.1', resolve))
  const service = createVoiceService({ stateDir: join(home, 'voice') })
  await service.saveRules({ ttsMaxChars: 10, ttsCharacter: 'fixture-speaker', ttsCacheVersion: 1, endpoints: { local: `http://127.0.0.1:${engine.address().port}` } })
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerVoiceInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  const hooks = createBridgeHooks({ home, log: () => {} })
  try {
    const first = await hooks.synthesizeToFile({ text: '测试语音' })
    assert.equal(dirname(first.path), join(home, 'voice/cache'))
    assert.equal(readFileSync(first.path).length, 100)
    assert.equal(inputs[0].character, 'fixture-speaker')
    assert.equal((await hooks.synthesizeToFile({ text: '测试语音' })).cached, true)
    assert.equal(inputs.length, 1)
    await service.saveRules({ ttsCacheVersion: 2 })
    await hooks.synthesizeToFile({ text: '测试语音' })
    assert.equal(inputs.length, 2)
    await assert.rejects(hooks.synthesizeToFile({ text: '超出长度限制的测试文本内容' }), /最多 10/)
    assert.equal(inputs.length, 2)
  } finally { hooks.stopMemoryOutbox(); dispose(); await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => engine.close(resolve))]) }
})

test('SurfCore sends memory events and synthesis requests to separate authenticated services', async (t) => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'surfcore-component-client-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  for (const name of ['memory', 'voice']) {
    mkdirSync(join(home, name), { recursive: true })
    writeFileSync(join(home, name, 'runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  }
  const calls = []
  const client = createSurfcoreComponentClient({ home, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) })
    return new Response(JSON.stringify(url.includes('/dsh-voice/') ? { ok: true, path: join(home, 'voice/cache/test.wav'), durationMs: 12 } : { ok: true }), { status: 200 })
  } })
  await client.recordMemory({ id: 'm1', text: 'hello', kind: 'private' })
  const audio = await client.synthesize({ text: 'hello', baseUrl: 'http://127.0.0.1:8765' })
  assert.match(calls[0].url, /dsh-memory\/internal\/events$/)
  assert.equal(calls[0].body.platform, 'qq')
  assert.match(calls[1].url, /dsh-voice\/internal\/synthesize$/)
  assert.equal(audio.path, join(home, 'voice/cache/test.wav'))
  rmSync(join(home, 'memory/runtime.json'))
  await assert.rejects(client.recordMemory({ id: 'm2', text: 'hello' }), /unavailable/)
})

test('bridge hooks use separate plugin state and stop serving cached memory after the plugin disappears', async (t) => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'surfcore-hooks-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  for (const name of ['memory', 'voice']) {
    mkdirSync(join(home, name), { recursive: true })
    writeFileSync(join(home, name, 'runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'b'.repeat(64) }))
  }
  writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, tts: { enabled: true } } }))
  const hooks = createBridgeHooks({ home, fetchImpl: async url => new Response(JSON.stringify({ ok: true, text: '来自记忆服务' }), { status: 200 }) })
  assert.equal(hooks.readIndependentVoiceSettings().tts.enabled, true)
  assert.equal(hooks.memoryContextCached('qq'), '')
  await hooks.waitForContext('qq')
  assert.equal(hooks.memoryContextCached('qq'), '来自记忆服务')
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { includeBiliInQq: false } }))
  assert.equal(hooks.memoryContextCached('qq'), '', 'changed privacy settings must immediately invalidate cached context')
  await hooks.waitForContext('qq')
  mkdirSync(join(home, 'surfcore'), { recursive: true })
  writeFileSync(join(home, 'surfcore/alignments.json'), JSON.stringify({ links: [] }))
  assert.equal(hooks.memoryContextCached('qq'), '', 'changed identity links must immediately invalidate cached context')
  await hooks.waitForContext('qq')
  rmSync(join(home, 'memory/runtime.json'))
  assert.equal(hooks.memoryContextCached('qq'), '')
  rmSync(join(home, 'voice/runtime.json'))
  assert.equal(hooks.readIndependentVoiceSettings().enabled, false)
})

test('an old memory request cannot erase a newer context after settings change', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-cache-race-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  const requests = []
  const hooks = createBridgeHooks({ home, fetchImpl: () => new Promise(resolve => requests.push(resolve)) })
  assert.equal(hooks.memoryContextCached('qq'), '')
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { includeBiliInQq: false } }))
  assert.equal(hooks.memoryContextCached('qq'), '')
  assert.equal(requests.length, 2)
  requests[1](new Response('{"ok":true,"text":"新上下文"}', { status: 200 }))
  await hooks.waitForContext('qq')
  requests[0](new Response('{"ok":true,"text":"旧上下文"}', { status: 200 }))
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(hooks.memoryContextCached('qq'), '新上下文')
})

test('bridge immediately invalidates memory context when the card or public summary changes', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-cache-files-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const data = join(home, 'memory/data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  let value = '旧记忆'
  const hooks = createBridgeHooks({ home, fetchImpl: async () => new Response(JSON.stringify({ ok: true, text: value }), { status: 200 }) })
  assert.equal(hooks.memoryContextCached('qq'), '')
  await hooks.waitForContext('qq')
  assert.equal(hooks.memoryContextCached('qq'), '旧记忆')
  value = '新记忆'
  writeFileSync(join(data, 'memory-card.json'), '{"records":[]}')
  assert.equal(hooks.memoryContextCached('qq'), '')
  await hooks.waitForContext('qq')
  assert.equal(hooks.memoryContextCached('qq'), '新记忆')
  assert.equal(hooks.memoryContextCached('bili'), '')
  await hooks.waitForContext('bili')
  value = '新摘要'
  writeFileSync(join(data, 'qq-public-summary.json'), '{"text":"changed"}')
  assert.equal(hooks.memoryContextCached('bili'), '')
  await hooks.waitForContext('bili')
  assert.equal(hooks.memoryContextCached('bili'), '新摘要')
})

test('bridge can await initial context before generating a prompt', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-context-ready-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  const hooks = createBridgeHooks({ home, fetchImpl: async () => new Response('{"ok":true,"text":"首次提示的记忆"}', { status: 200 }) })
  assert.equal(await hooks.awaitMemoryContext('qq'), '首次提示的记忆')
})

test('a stopped memory plugin with stale discovery cannot supply cached or late context', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-stale-context-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  let online = true, release
  const delayed = new Promise(resolve => { release = resolve })
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async url => {
    if (url.endsWith('/health')) { if (!online) throw new Error('offline'); return new Response('{"ok":true}') }
    if (!online) throw new Error('offline')
    if (url.endsWith('/context/bili')) { await delayed; return new Response('{"ok":true,"text":"迟到的旧摘要"}') }
    return new Response('{"ok":true,"text":"缓存的旧记忆"}')
  } }); t.after(() => hooks.stopMemoryOutbox())
  assert.equal(await hooks.awaitMemoryContext('qq'), '缓存的旧记忆')
  assert.equal(hooks.memoryContextCached('bili'), '')
  const previous = hooks.waitForContext('bili')
  online = false
  assert.equal(await hooks.awaitMemoryContext('qq'), '')
  release(); await previous
  assert.equal(hooks.memoryContextCached('bili'), '')
  await hooks.waitForContext('bili')
})

test('cached context is rejected after the authenticated memory endpoint stops', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-stale-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let handler, active = true
  const server = createServer((req, res) => active ? handler(req, res) : (res.writeHead(503), res.end()))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => { active = false } } } }, home, { context: async () => '已缓存的上下文' })
  const file = join(home, 'memory/runtime.json'), discovery = readFileSync(file, 'utf8')
  const hooks = createBridgeHooks({ home, log() {} })
  t.after(async () => { hooks.stopMemoryOutbox(); dispose(); await new Promise(resolve => server.close(resolve)) })
  assert.equal(await hooks.awaitMemoryContext('qq'), '已缓存的上下文')
  dispose(); writeFileSync(file, discovery)
  assert.equal(await hooks.awaitMemoryContext('qq'), '')
  assert.equal(hooks.memoryContextCached('qq'), '')
})

test('a first context response arriving after the memory service stops is not used', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-first-stale-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  let online = true, release, entered
  const gate = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async url => {
    if (url.endsWith('/health')) { if (!online) throw new Error('offline'); return new Response('{"ok":true}') }
    entered(); await gate
    return new Response('{"ok":true,"text":"过期上下文"}')
  } }); t.after(() => hooks.stopMemoryOutbox())
  const context = hooks.awaitMemoryContext('qq')
  await started; online = false; release()
  assert.equal(await context, '')
  assert.equal(hooks.memoryContextCached('qq'), '')
})

test('a timed-out memory health check does not expose the unverified cached context', { timeout: 5000 }, async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-health-timeout-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async url => url.endsWith('/health') ? new Promise(() => {}) : new Response('{"ok":true,"text":"未验证上下文"}') }); t.after(() => hooks.stopMemoryOutbox())
  const started = Date.now()
  assert.equal(await hooks.awaitMemoryContext('qq'), '')
  assert.ok(Date.now() - started < 3000)
  assert.equal(hooks.memoryContextCached('qq'), '')
})

test('initial prompt retries context when the memory card changes during its first read', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-context-retry-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const data = join(home, 'memory/data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  let calls = 0
  const hooks = createBridgeHooks({ home, fetchImpl: async url => {
    if (url.endsWith('/health')) return new Response('{"ok":true}')
    if (++calls === 1) writeFileSync(join(data, 'memory-card.json'), '{"records":[]}')
    return new Response(JSON.stringify({ ok: true, text: calls === 1 ? '旧数据' : '最新数据' }), { status: 200 })
  } })
  assert.equal(await hooks.awaitMemoryContext('qq'), '最新数据')
  assert.equal(calls, 2)
})

test('QQ configuration changes invalidate the cached Bilibili summary', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'memory-qq-config-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'f'.repeat(64) }))
  const qqConfigFile = join(home, 'qq-config.json'); writeFileSync(qqConfigFile, '{"ownerQQ":1234}')
  const hooks = createBridgeHooks({ home, qqConfigFile, fetchImpl: async () => new Response('{"ok":true,"text":"公开摘要"}', { status: 200 }) })
  assert.equal(await hooks.awaitMemoryContext('bili'), '公开摘要')
  writeFileSync(qqConfigFile, '{"ownerQQ":987654}')
  assert.equal(hooks.memoryContextCached('bili'), '')
})

test('Bilibili memory refresh and share records are delegated to the memory plugin', async (t) => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'bili-memory-remote-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory/data'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'c'.repeat(64) }))
  writeFileSync(join(home, 'memory/data/bili-memory-brief.md'), '公开见闻\n边界：B 站私信里的内容不在我的记忆里。')
  writeFileSync(join(home, 'memory/data/bili-role-free.json'), '{"version":1}')
  const calls = []
  const hooks = createBridgeHooks({ home, fetchImpl: async (url, options) => {
    calls.push(url); return new Response('{"ok":true}', { status: 200 })
  } })
  const bili = hooks.createRemoteBiliMemory()
  assert.equal(bili.briefBlock(), '', 'an old conversion marker must not expose an unconverted brief')
  writeFileSync(join(home, 'memory/data/bili-role-free.json'), '{"version":2}')
  assert.match(bili.briefBlock(), /公开见闻/)
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { includeBiliInQq: false } }))
  assert.equal(bili.briefBlock(), '')
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { includeBiliInQq: true } }))
  assert.match(bili.briefBlock(), /公开见闻/)
  writeFileSync(join(home, 'memory/data/bili-memory-brief.md'), 'password=unsafe-secret')
  assert.equal(bili.briefBlock(), '', 'a sensitive brief must never reach QQ')
  await bili.refresh({ force: true })
  await bili.recordShare('id1', 'slot1')
  assert.ok(calls.some(url => url.endsWith('/bili/refresh')))
  assert.ok(calls.some(url => url.endsWith('/bili/record-share')))
  rmSync(join(home, 'memory/runtime.json'))
  assert.equal(bili.briefBlock(), '')
})

test('purpose materials use the independent Bilibili memory view and respect its switch', t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'purpose-memory-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory/data'), { recursive: true }); mkdirSync(join(home, 'surfcore'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'c'.repeat(64) }))
  writeFileSync(join(home, 'surfcore/bili.config.json'), JSON.stringify({ persona: { ownerTitle: '旧角色称呼' } }))
  writeFileSync(join(home, 'memory/data/bili-memory.json'), JSON.stringify({ entries: [{ id: 'dynamic:1', type: 'dynamic', text: '一条旧角色称呼的公开动态' }] }))
  writeFileSync(join(home, 'memory/data/bili-role-free.json'), '{"version":2}')
  const bili = createBridgeHooks({ home }).createRemoteBiliMemory()
  const transformed = renderBridgeSource(readFileSync('plugins/surfcore/src/bridge.js', 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  assert.match(transformed, /function readPurposeBiliEntries\(\) \{ return biliMemory\.purposeEntries\(\); \}/)
  assert.match(bili.purposeEntries()[0].text, /管理员/)
  writeFileSync(join(home, 'memory/data/bili-role-free.json'), '{"version":1}')
  assert.deepEqual(bili.purposeEntries(), [])
  writeFileSync(join(home, 'memory/data/bili-role-free.json'), '{"version":2}')
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { includeBiliInQq: false } }))
  assert.deepEqual(bili.purposeEntries(), [])
  rmSync(join(home, 'memory/runtime.json'))
  assert.deepEqual(bili.purposeEntries(), [])
})

test('Bilibili purpose and share selection skip unsafe legacy records while retaining safe alternatives', t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'bili-share-privacy-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const data = join(home, 'memory/data'); mkdirSync(data, { recursive: true }); mkdirSync(join(home, 'surfcore'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), '{}')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":2}')
  const entries = [
    ...Array.from({ length: 20 }, (_, index) => ({ id: `private-${index}`, type: 'video', title: '旧视频', text: '这条是私下说的内容不要告诉其他人请保密', score: 15, priority: 99, shareable: true })),
    { id: 'safe', type: 'video', title: '公开视频', text: '这是关于自然和星空的公开分享内容很有趣', score: 14, priority: 1, shareable: true },
  ]
  writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries }))
  const view = createBridgeHooks({ home }).createRemoteBiliMemory()
  assert.deepEqual(view.purposeEntries().map(entry => entry.id), ['safe'])
  assert.equal(view.pickShareCard()?.id, 'safe')
})

test('offline Bilibili refresh flows through the memory plugin into QQ context and obeys its direction switch', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'bili-to-qq-flow-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const data = join(home, 'memory/data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'bili-dynamics-cache.json'), JSON.stringify({ at: Date.now(), items: [{ id: '123', text: '今天看见美丽的星空，还有明亮的月亮' }] }))
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: home })
  const service = createMemoryService({ stateDir: join(home, 'memory'), biliMemory })
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  try {
    const hooks = createBridgeHooks({ home, log: () => {} }), remote = hooks.createRemoteBiliMemory()
    await remote.refresh()
    assert.match(remote.briefBlock(), /美丽的星空/)
    assert.match(await hooks.awaitMemoryContext('qq'), /美丽的星空/)
    await service.updateSettings({ includeBiliInQq: false })
    assert.equal(remote.briefBlock(), '')
    assert.doesNotMatch(await hooks.awaitMemoryContext('qq'), /美丽的星空/)
    hooks.stopMemoryOutbox()
  } finally { dispose(); await new Promise(resolve => server.close(resolve)) }
})

test('QQ public feed flows through the memory plugin to Bilibili and is revoked when disabled', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'qq-to-bili-flow-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const feed = join(home, 'qq-feed.jsonl'), at = new Date().toISOString()
  writeFileSync(feed, [
    { at, groupId: '12345', senderId: '11111', text: '今天群里讨论美丽的星空' },
    { at, groupId: '99999', senderId: '22222', text: '白名单以外的内容' },
    { at, kind: 'private', groupId: '12345', senderId: '33333', text: '私聊里的测试内容' },
  ].map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: join(home, 'memory'), qqFeedFile: feed })
  await service.updateSettings({ enabled: false })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  await service.syncQqFeed()
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  try {
    const hooks = createBridgeHooks({ home, log: () => {} })
    const text = await hooks.awaitMemoryContext('bili')
    assert.match(text, /群里讨论美丽的星空/)
    assert.doesNotMatch(text, /白名单以外|私聊里的测试内容|12345|11111/)
    await service.updateQqSync({ enabled: false })
    assert.doesNotMatch(await hooks.awaitMemoryContext('bili'), /群里讨论美丽的星空/)
    hooks.stopMemoryOutbox()
  } finally { dispose(); await new Promise(resolve => server.close(resolve)) }
})

test('purpose memory cards respect plugin availability and platform settings', t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'purpose-cards-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory/data'), { recursive: true }); mkdirSync(join(home, 'surfcore'), { recursive: true })
  writeFileSync(join(home, 'surfcore/bili.config.json'), JSON.stringify({ persona: { ownerTitle: '旧角色称呼' } }))
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'c'.repeat(64) }))
  writeFileSync(join(home, 'memory/data/memory-card.json'), JSON.stringify({ records: [{ id: 'qq', scope: 'qq', text: 'QQ 记忆' }, { id: 'bili', scope: 'bili', text: '旧角色称呼的B站记忆' }] }))
  const hooks = createBridgeHooks({ home })
  const transformed = renderBridgeSource(readFileSync('plugins/surfcore/src/bridge.js', 'utf8'), 'file:///hooks.mjs', 'file:///memory.mjs')
  assert.ok(transformed.includes('function readPurposeMemoryRecords() { return purposeMemoryRecords(); }'))
  assert.deepEqual(hooks.purposeMemoryRecords().map(record => record.id), ['qq', 'bili'])
  assert.match(hooks.purposeMemoryRecords()[1].text, /管理员/)
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { includeBiliInQq: false } }))
  assert.deepEqual(hooks.purposeMemoryRecords().map(record => record.id), ['qq'])
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { enabled: false } }))
  assert.deepEqual(hooks.purposeMemoryRecords(), [])
  rmSync(join(home, 'memory/runtime.json'))
  assert.deepEqual(hooks.purposeMemoryRecords(), [])
})

test('QQ session memory is read from the plugin and modifications require an acknowledged versioned write', async (t) => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'session-hooks-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'd'.repeat(64) }))
  const initial = { revision: 4, value: { activeTopics: [{ text: '话题' }], pendingThoughts: [], memberImpressions: {} } }
  writeFileSync(join(home, 'memory/session-memory.json'), JSON.stringify({ version: 1, conversations: { 'group:123': initial } }))
  let body
  const hooks = createBridgeHooks({ home, fetchImpl: async (_url, options) => { body = JSON.parse(options.body); return new Response('{"ok":true,"revision":5}', { status: 200 }) } })
  const state = hooks.hydrateSession('group:123', { recentMessages: [] })
  assert.equal(state.activeTopics[0].text, '话题')
  const edit = hooks.editSession('group:123', state)
  edit.activeTopics.push({ text: '新话题' })
  assert.equal(state.activeTopics.length, 1)
  await hooks.commitSession('group:123', edit)
  assert.equal(body.revision, 4)
  assert.equal(body.value.activeTopics.length, 2)
  rmSync(join(home, 'memory/runtime.json'))
  assert.equal(hooks.hydrateSession('group:123', {}).activeTopics.length, 0)
  await assert.rejects(hooks.commitSession('group:123', edit), /unavailable/)
})

test('disabled memory does not queue new QQ events', t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const home = mkdtempSync(join(parent, 'disabled-memory-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  mkdirSync(join(home, 'memory'), { recursive: true })
  writeFileSync(join(home, 'memory/config.json'), JSON.stringify({ memoryCard: { enabled: false } }))
  const hooks = createBridgeHooks({ home, log() {} }); t.after(() => hooks.stopMemoryOutbox())
  assert.equal(hooks.appendMemoryInboxEvent(null, { text: '不应记录' }), false)
  writeFileSync(join(home, 'memory/config.json'), '{bad')
  assert.equal(hooks.appendMemoryInboxEvent(null, { text: '仍不应记录' }), false)
})
