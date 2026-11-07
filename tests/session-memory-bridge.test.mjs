import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createSessionMemoryStore } from '../plugins/memory/src/session-memory.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'
import { renderSplitConsole } from '../scripts/lib/surfcore-console.mjs'
import { createVoiceLibraryProbe, createVoiceLibrarySender } from '../plugins/voice/src/bridge-readiness.mjs'
import { createVoiceService } from '../plugins/voice/src/service.mjs'
import { registerVoiceHttp } from '../plugins/voice/src/http.mjs'
import { Readable } from 'node:stream'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

test('QQ bridge does not treat unresolved session aliases as a completed migration', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'session-alias-bridge-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const memory = join(home, 'memory'); mkdirSync(memory)
  writeFileSync(join(memory, 'runtime.json'), '{}')
  const value = { activeTopics: [], pendingThoughts: [], memberImpressions: {} }
  const file = join(memory, 'session-memory.json')
  const hooks = createBridgeHooks({ home, log: () => {} })
  writeFileSync(file, JSON.stringify({ version: 1, conversations: { 'group:0001': { revision: 0, value } } }))
  assert.equal(hooks.sessionMemoryInitialized(), false)
  writeFileSync(file, JSON.stringify({ version: 1, conversations: { 'group:0001': { revision: 0, value }, 'group:1': { revision: 0, value: { ...value, activeTopics: [{ text: '不同记忆' }] } } } }))
  assert.equal(hooks.sessionMemoryInitialized(), false)
  assert.throws(() => hooks.editSession('group:1', {}), /不可用|损坏/)
  writeFileSync(file, JSON.stringify({ version: 1, conversations: { 'group:1': { revision: 0, value } } }))
  assert.equal(hooks.sessionMemoryInitialized(), true)
})

test('recovering a legacy whole-database backup immediately makes canonical session memory available to the bridge', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'session-recover-bridge-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const memory = join(home, 'memory'), backups = join(memory, 'backups/sessions'); mkdirSync(backups, { recursive: true })
  writeFileSync(join(memory, 'runtime.json'), '{}')
  const value = { activeTopics: [{ text: '备份中的话题' }], pendingThoughts: [], memberImpressions: {} }
  const name = 'session-db-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'
  const original = JSON.stringify({ version: 1, conversations: { 'group:0001': { revision: 2, value }, 'group:1': { revision: 5, value } } })
  writeFileSync(join(backups, name), original)
  writeFileSync(join(memory, 'session-memory.json'), '{broken')
  const store = createSessionMemoryStore({ stateDir: memory })
  const hooks = createBridgeHooks({ home, log() {} }); t.after(() => hooks.stopMemoryOutbox())
  const result = await store.recoverDatabase(name)
  assert.equal(hooks.sessionMemoryInitialized(), true)
  const state = hooks.editSession('group:1', {})
  assert.equal(state.activeTopics[0].text, '备份中的话题')
  assert.equal(state.memoryRevision, 5)
  assert.equal(result.sessions, 1)
  assert.equal(readFileSync(join(backups, name), 'utf8'), original)
  assert.equal(readFileSync(join(backups, result.damaged), 'utf8'), '{broken')
})

test('conflicting aliases in a whole-database backup leave both files untouched', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'session-recover-conflict-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const memory = join(home, 'memory'), backups = join(memory, 'backups/sessions'); mkdirSync(backups, { recursive: true })
  const value = { activeTopics: [], pendingThoughts: [], memberImpressions: {} }
  const name = 'session-db-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'
  const original = JSON.stringify({ version: 1, conversations: { 'group:0001': { revision: 2, value }, 'group:1': { revision: 5, value: { ...value, activeTopics: [{ text: '不一致' }] } } } })
  writeFileSync(join(backups, name), original); writeFileSync(join(memory, 'session-memory.json'), '{broken')
  await assert.rejects(createSessionMemoryStore({ stateDir: memory }).recoverDatabase(name), /corrupt|冲突/i)
  assert.equal(readFileSync(join(memory, 'session-memory.json'), 'utf8'), '{broken')
  assert.equal(readFileSync(join(backups, name), 'utf8'), original)
})

test('QQ bridge reuses unchanged session data without sharing mutable state and reloads replacements', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'session-cache-bridge-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const memory = join(home, 'memory'); mkdirSync(memory); writeFileSync(join(memory, 'runtime.json'), '{}')
  const file = join(memory, 'session-memory.json')
  const database = text => JSON.stringify({ version: 1, conversations: { 'group:1': { revision: 1, value: { activeTopics: [{ text }], pendingThoughts: [], memberImpressions: {} } } } })
  writeFileSync(file, database('原始'))
  const original = fs.readFileSync; let reads = 0
  const mock = t.mock.method(fs, 'readFileSync', function (path, ...args) { if (path === file) reads++; return original.call(this, path, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  const hooks = createBridgeHooks({ home, log: () => {} })
  const a = hooks.hydrateSession('group:1', {})
  a.activeTopics[0].text = '未保存修改'
  assert.equal(hooks.hydrateSession('group:1', {}).activeTopics[0].text, '原始')
  assert.equal(hooks.sessionMemoryInitialized(), true)
  assert.equal(reads, 1)
  const replacement = join(memory, 'next.json'); writeFileSync(replacement, database('更新')); renameSync(replacement, file)
  assert.equal(hooks.hydrateSession('group:1', {}).activeTopics[0].text, '更新')
  assert.equal(reads, 2)
  writeFileSync(file, '{broken')
  assert.equal(hooks.sessionMemoryInitialized(), false)
  assert.throws(() => hooks.editSession('group:1', {}), /不可用|损坏/)
})

test('QQ bridge reads and edits session memory through the independent service', async t => {
  const root = resolve('.'), base = join(root, '.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'session-bridge-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const sourceRoot = join(root, 'plugins/surfcore')
  let harness = readFileSync(join(sourceRoot, 'scripts/audit-bridge-harness.mjs'), 'utf8')
  harness = harness.replaceAll("from '../src/", `from '${pathToFileURL(join(sourceRoot, 'src')).href}/`)
  harness = harness.replace("const root = fileURLToPath(new URL('..', import.meta.url));", `const root = ${JSON.stringify(sourceRoot)};`)
  harness = `import { renderBridgeSource } from ${JSON.stringify(pathToFileURL(join(root, 'scripts/lib/surfcore-runtime-transform.mjs')).href)};\n${harness}`
  harness = harness.replace("let source = fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8');", "let source = renderBridgeSource(fs.readFileSync(path.join(root, 'src/bridge.js'), 'utf8'), 'file:///hooks.mjs', 'file:///engine.mjs');")
  harness = harness.replace('    voiceCfg, voiceLibrary,', '    voiceTriggerBlock, voiceOwnerAt, voiceLastSpeaker, voiceLastSentAt, voiceCfg, voiceLibrary,')
  harness = harness.replace("env: { DSH_HOME: path.join(temp, 'dsh') }", "env: { DSH_HOME: path.join(temp, 'dsh'), FFMPEG_PATH: '/environment/ffmpeg' }")
  harness = harness.replace("fs.mkdtempSync(path.join(os.tmpdir(), 'qq-audit-bridge-'))", `fs.mkdtempSync(path.join(${JSON.stringify(dir)}, 'qq-audit-bridge-'))`)
  const harnessPath = join(dir, 'harness.mjs'); writeFileSync(harnessPath, harness)
  const { bridgeHarness } = await import(pathToFileURL(harnessPath).href)
  const home = join(dir, 'home'), stateDir = join(home, 'memory'); mkdirSync(stateDir, { recursive: true })
  const legacy = { conversations: { 'group:456': { activeTopics: [{ text: '旧话题', lastMentionAt: Date.now() }], pendingThoughts: [], memberImpressions: {} } } }
  const legacyFile = join(dir, 'legacy.json'); writeFileSync(legacyFile, JSON.stringify(legacy))
  const store = createSessionMemoryStore({ stateDir, legacyFile }); store.initialize()
  writeFileSync(join(stateDir, 'runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'a'.repeat(64) }))
  mkdirSync(join(stateDir, 'data'), { recursive: true })
  writeFileSync(join(stateDir, 'data/bili-role-free.json'), '{"version":2}')
  writeFileSync(join(stateDir, 'data/bili-memory-brief.md'), '公开的 B站见闻')
  mkdirSync(join(home, 'voice'), { recursive: true })
  writeFileSync(join(home, 'voice/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'b'.repeat(64) }))
  writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, trigger: { who: 'list', members: ['456'] } } }))
  let resolveTouch, voiceRequest, memoryOnline = true, voiceOnline = true, failVoicePrimary = false
  const voiceRequests = []
  const synthesisFile = join(dir, 'synthesis.silk'); writeFileSync(synthesisFile, 'fixture audio')
  const topicTouched = new Promise(resolve => { resolveTouch = resolve })
  const hooks = createBridgeHooks({ home, fetchImpl: async (url, options) => {
    if (url.includes('/context/')) return new Response('{"ok":true,"text":""}', { status: 200 })
    if (url.endsWith('/dsh-memory/internal/health')) return memoryOnline ? new Response('{"ok":true}', { status: 200 }) : new Response('{"ok":false,"error":"offline"}', { status: 503 })
    if (url.endsWith('/dsh-voice/internal/health')) return voiceOnline ? new Response('{"ok":true}', { status: 200 }) : new Response('{"ok":false,"error":"offline"}', { status: 503 })
    const body = JSON.parse(options.body)
    if (url.endsWith('/dsh-voice/internal/synthesize')) {
      voiceRequest = body; voiceRequests.push(body)
      if (failVoicePrimary && body.baseUrl.endsWith(':9002')) return new Response('{"ok":false,"error":"TTS 服务返回 503"}', { status: 503 })
      return new Response(JSON.stringify({ ok: true, path: synthesisFile, cached: false, durationMs: 100 }), { status: 200 })
    }
    try {
      const result = url.endsWith('/session/write') ? await store.write(body.key, body.value, body.revision) : url.endsWith('/session/touch-topics') ? await store.touchTopics(body.key, body.topics, body.at, { hashed: body.hashed === true }) : await store.read(body.key)
      if (url.endsWith('/session/touch-topics')) resolveTouch()
      return new Response(JSON.stringify({ ok: true, ...result }), { status: 200 })
    } catch (error) { return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 400 }) }
  } })
  const preset = readFileSync(join(sourceRoot, 'dsh/agent-presets/qq-chat-v2/agent.cordis.yml'), 'utf8')
  const bridge = await bridgeHarness({ config: { biliBridge: { enabled: true, memory: { enabled: true } }, socialV2: { tools: { sendVoice: false } } }, files: { 'state/social-v2.json': legacy, 'public/console.html': readFileSync(join(sourceRoot, 'public/console.html'), 'utf8'), 'dsh/agent-presets/qq-chat-v2/agent.cordis.yml': preset, 'dsh/.agent-presets/qq-chat-v2/agent.cordis.yml': preset }, globals: { ...hooks, createBiliMemory: hooks.createRemoteBiliMemory, renderSplitConsole } })
  try {
    bridge.setMode('reserved2')
    const memoryService = createMemoryService({ stateDir })
    await memoryService.action('add', { text: '想起一起看星空的约定', importance: 90, scope: 'qq' })
    const beforePurpose = JSON.stringify(bridge.purposeState)
    const purpose = await bridge.runPurpose({ preview: true })
    assert.equal(purpose.ok, true)
    assert.ok(purpose.materials.some(item => item.text.includes('一起看星空的约定')))
    assert.equal(JSON.stringify(bridge.purposeState), beforePurpose)
    assert.equal(bridge.calls.prompts.length, 0)
    assert.equal(bridge.calls.sent.length, 0)
    memoryOnline = false
    const offlinePurpose = await bridge.runPurpose({ preview: true })
    assert.doesNotMatch(JSON.stringify(offlinePurpose), /一起看星空的约定/)
    assert.equal(bridge.calls.prompts.length, 0)
    memoryOnline = true
    const voiceConfigFile = join(home, 'voice/config.json')
    writeFileSync(voiceConfigFile, JSON.stringify({ voice: {} }))
    assert.equal((await createVoiceService({ stateDir: join(home, 'voice') }).rules()).enabled, false)
    assert.equal(bridge.voiceCfg().enabled, false, 'the QQ bridge must respect the independent plugin default')
    const voiceService = createVoiceService({ stateDir: join(home, 'voice') })
    await voiceService.saveRules({ enabled: true, aiEnabled: true, triggerWho: 'list', members: ['456'], groups: ['789'], maxPerMinute: 0, maxPerHour: 12, maxSeconds: 55, maxBytes: 123456, defaultVolume: 1.5, loudness: 'quiet', autoReadback: false, ttsTimeoutMs: 45000, ttsMaxChars: 77, ttsCharacter: 'fixture', ttsCacheVersion: 4, route: 'cloud', endpoints: { local: 'http://127.0.0.1:9001', cloud: 'http://127.0.0.1:9002' } })
    const effective = bridge.voiceCfg()
    assert.equal(effective.enabled, true); assert.equal(effective.maxPerMinute, 0); assert.equal(effective.maxPerHour, 12)
    assert.equal(effective.maxSeconds, 55); assert.equal(effective.maxBytes, 123456); assert.equal(effective.defaultVolume, 1.5)
    assert.equal(effective.loudness, 'quiet'); assert.equal(effective.autoReadback, false)
    assert.equal(effective.trigger.who, 'list'); assert.deepEqual([...effective.trigger.members], ['456']); assert.deepEqual([...effective.trigger.groups], ['789'])
    assert.equal(effective.tts.enabled, true); assert.equal(effective.tts.route, 'cloud'); assert.equal(effective.tts.timeoutMs, 45000); assert.equal(effective.tts.maxChars, 77)
    assert.equal(effective.tts.character, 'fixture'); assert.equal(effective.tts.cacheVersion, 4); assert.equal(effective.tts.endpoints.cloud, 'http://127.0.0.1:9002')
    writeFileSync(voiceConfigFile, JSON.stringify({ voice: { enabled: true, trigger: { who: 'list', members: ['456'] } } }))
    assert.equal(bridge.voiceCfg().enabled, true)
    assert.match(bridge.currentRoleHint('group:456'), /公开的 B站见闻/)
    bridge.voiceOwnerAt.set('group:456', Date.now())
    bridge.voiceLastSpeaker.set('group:456', { userId: '456', isOwner: false, at: Date.now() })
    assert.equal(bridge.voiceTriggerBlock('group:456', 'group', '456'), null)
    assert.equal(bridge.voiceCfg().ffmpegPath, '/environment/ffmpeg')
    await assert.rejects(bridge.synthesizeVoiceText('测试'), error => /语音/.test(error.hint) && !/设置 → SurfCore/.test(error.hint))
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, tts: { enabled: true, route: 'local', baseUrl: 'http://127.0.0.1:9001' } } }))
    await bridge.synthesizeVoiceText('线路测试')
    assert.equal(voiceRequest.baseUrl, 'http://127.0.0.1:9001')
    await bridge.synthesizeVoiceText('线路测试', { route: 'cloud' })
    assert.equal(voiceRequest.baseUrl, 'http://127.0.0.1:8767')
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, tts: { enabled: true, route: 'local', baseUrl: 'http://127.0.0.1:9001', endpoints: { local: 'http://127.0.0.1:9002', cloud: 'http://127.0.0.1:9003' } } } }))
    await bridge.synthesizeVoiceText('线路测试')
    assert.equal(voiceRequest.baseUrl, 'http://127.0.0.1:9002')
    await bridge.synthesizeVoiceText('线路测试', { route: 'cloud' })
    assert.equal(voiceRequest.baseUrl, 'http://127.0.0.1:9003')
    failVoicePrimary = true
    const recovered = await bridge.synthesizeVoiceText('线路故障测试', { character: '主路专用音色' })
    assert.equal(recovered.degraded, true)
    assert.equal(voiceRequests.at(-2).character, '主路专用音色')
    assert.equal(voiceRequests.at(-1).baseUrl, 'http://127.0.0.1:9003')
    assert.equal(voiceRequests.at(-1).useRouteVoice, 'cloud')
    failVoicePrimary = false
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, ffprobePath: '/project/ffprobe', trigger: { who: 'anyone' } } }))
    assert.equal(bridge.voiceCfg().ffprobePath, '/project/ffprobe')
    const ffmpeg = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
    const ffprobe = join(dir, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
    writeFileSync(ffmpeg, 'test'); writeFileSync(ffprobe, 'test')
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, ffmpegPath: ffmpeg, trigger: { who: 'anyone' } } }))
    assert.equal(bridge.voiceCfg().ffmpegPath, ffmpeg)
    assert.equal(bridge.voiceCfg().ffprobePath, ffprobe)
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, trigger: { who: 'anyone', groups: ['456'] } } }))
    assert.equal(bridge.voiceTriggerBlock('group:456', 'group', '456'), null)
    assert.match(bridge.voiceTriggerBlock('group:789', 'group', '789'), /群/)
    assert.equal(bridge.voiceTriggerBlock('private:789', 'private', '789'), null)
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, trigger: { who: 'anyone', groups: ['123456789012345678'] } } }))
    assert.equal(bridge.voiceTriggerBlock('group:123456789012345678', 'group', '123456789012345678'), null)
    assert.match(bridge.voiceTriggerBlock('group:123456789012345679', 'group', '123456789012345679'), /群/)
    writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, trigger: { who: 'list', members: ['123'], groups: ['789'] } } }))
    bridge.voiceLastSpeaker.set('group:789', { userId: '123', isOwner: false, at: Date.now() })
    assert.equal(bridge.voiceTriggerBlock('group:789', 'group', '789'), null)
    bridge.voiceLastSentAt.set('group:789', Date.now())
    assert.match(bridge.voiceTriggerBlock('group:789', 'group', '789'), /已经发过/)
    bridge.voiceLastSentAt.delete('group:789')
    bridge.voiceLastSpeaker.set('group:789', { userId: '123', isOwner: false, at: Date.now() - 11 * 60 * 1000 })
    assert.match(bridge.voiceTriggerBlock('group:789', 'group', '789'), /没有允许的成员/)
    bridge.voiceLastSpeaker.set('group:789', { userId: '999', isOwner: false, at: Date.now() })
    assert.match(bridge.voiceTriggerBlock('group:789', 'group', '789'), /名单/)
    const server = bridge.startConsoleServer()
    if (!server.listening) await new Promise(r => server.once('listening', r))
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}`
      const call = async (path, body) => {
        const response = await fetch(`${baseUrl}${path}`, { ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}), headers: { 'content-type': 'application/json', 'x-console-token': 'fixture-console-token' } })
        return { status: response.status, data: await response.json() }
      }
      const consoleResponse = await fetch(baseUrl, { headers: { 'x-console-token': 'fixture-console-token' } })
      assert.doesNotMatch(await consoleResponse.text(), /<button data-view="persona"/)
      assert.equal((await call('/api/role-mode', { mode: 'silent' })).data.roleMode, 'silent')
      assert.equal((await call('/api/status')).data.roleMode, 'silent')
      assert.equal((await call('/api/role-mode', { mode: 'active' })).data.roleMode, 'active')
      assert.equal((await call('/api/status')).data.roleMode, 'active')
      const beforePrompt = await call('/api/preset/sim-prompt?preset=qq-chat-v2')
      assert.equal(beforePrompt.status, 200)
      const updatedPrompt = `${beforePrompt.data.content}\n隔离测试追加内容`
      const savedPrompt = await call('/api/preset/sim-prompt', { preset: 'qq-chat-v2', content: updatedPrompt })
      assert.equal(savedPrompt.data.ok, true)
      assert.equal(savedPrompt.data.synced, true)
      assert.equal((await call('/api/preset/sim-prompt?preset=qq-chat-v2')).data.content, updatedPrompt)
      assert.equal((await call('/api/preset/sim-prompt/restore', { preset: 'qq-chat-v2' })).data.ok, true)
      assert.equal((await call('/api/preset/sim-prompt?preset=qq-chat-v2')).data.content, beforePrompt.data.content)
      assert.equal((await fetch(`${baseUrl}/api/voice/readiness`)).status, 401)
      bridge.setSnowlumaHealth({ connected: true })
      const readiness = await call('/api/voice/readiness')
      assert.equal(readiness.status, 200)
      assert.equal(readiness.data.toolEnabled, false)
      assert.equal(readiness.data.connected, true)
      writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: false } }))
      const disabledVoice = await call('/api/socialV2/send-voice', { key: 'group:456' })
      assert.equal(disabledVoice.status, 403)
      assert.match(disabledVoice.data.hint, /语音/)
      assert.doesNotMatch(disabledVoice.data.hint, /设置 → SurfCore/)
      const audioDir = join(bridge.temp, 'dsh/voice/audio'); mkdirSync(audioDir, { recursive: true })
      writeFileSync(join(audioDir, '示例.wav'), 'fixture audio')
      writeFileSync(join(audioDir, '示例.silk'), 'fixture audio')
      const probeConfig = join(dir, 'probe-config.json'), probeToken = join(dir, 'probe-token')
      writeFileSync(probeConfig, JSON.stringify({ consolePort: server.address().port })); writeFileSync(probeToken, 'fixture-console-token')
      const probeResult = await createVoiceLibraryProbe({ qqConfigFile: probeConfig, tokenFile: probeToken })()
      assert.ok(probeResult.voices.some(item => item.name === '示例.silk' && item.ok === true))
      const pageNames = Array.from({ length: 105 }, (_, i) => `voice-${String(i).padStart(3, '0')}.silk`)
      for (const name of pageNames) writeFileSync(join(audioDir, name), 'audio')
      const laterPage = await createVoiceLibraryProbe({ qqConfigFile: probeConfig, tokenFile: probeToken })({ offset: 100 })
      assert.ok(laterPage.voices.some(item => item.name === 'voice-104.silk' && item.ok === true))
      for (const name of pageNames) rmSync(join(audioDir, name))
      const voiceService = createVoiceService({ stateDir: join(bridge.temp, 'dsh/voice'), sendLibraryVoice: createVoiceLibrarySender({ qqConfigFile: probeConfig, tokenFile: probeToken }) })
      const dryRun = await voiceService.sendLibraryVoice({ target: 'group:456', file: '示例.silk', dryRun: true })
      assert.equal(dryRun.ok, true); assert.equal(dryRun.dryRun, true)
      writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, tts: { enabled: true } } }))
      const priorSends = bridge.calls.http.filter(item => item.url.endsWith('/send_group_msg')).length
      const pathDryRun = await voiceService.sendLibraryVoice({ target: 'group:456', filePath: synthesisFile, dryRun: true })
      assert.equal(pathDryRun.ok, true); assert.equal(pathDryRun.dryRun, true)
      const textDryRun = await voiceService.sendLibraryVoice({ target: 'group:456', text: '试发合成测试', dryRun: true })
      assert.equal(textDryRun.ok, true); assert.equal(textDryRun.dryRun, true)
      assert.equal(voiceRequest.text, '试发合成测试')
      assert.equal(bridge.calls.http.filter(item => item.url.endsWith('/send_group_msg')).length, priorSends)
      await assert.rejects(voiceService.sendLibraryVoice({ target: 'group:999', file: '示例.silk', dryRun: true }), /白名单/)
      let voiceHandler
      registerVoiceHttp({ webServer: { register: route => { voiceHandler = route.handler; return () => {} } }, get: () => ({ requestRejection: () => null }) }, voiceService)
      // A console send is traced like any other: it reaches the bridge only
      // through the Effect host, which the plugin attaches from the
      // orchestrator. The stub host delivers through the service's bridge.
      voiceService.useEffectHost({
        async commit(payload, options) {
          const delivered = options.deliver ? await options.deliver() : undefined
          return { ok: true, ...(delivered ?? {}) }
        },
        status() { return undefined },
        cancel() { return { cancelled: true, state: 'pending', inFlight: false } },
      })
      t.after(() => voiceService.useEffectHost(null))
      const req = Readable.from([JSON.stringify({ target: 'group:456', file: '示例.silk', dryRun: false })])
      Object.assign(req, { method: 'POST', url: '/dsh-voice/api/voice/library/send', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } })
      let status, sent
      await voiceHandler(req, { writeHead: code => { status = code }, end: value => { sent = JSON.parse(value) } })
      assert.equal(status, 200)
      assert.equal(sent.ok, true); assert.equal(sent.verified, true); assert.equal(sent.messageId, 9001)
      const delivered = bridge.calls.http.find(call => call.url.endsWith('/send_group_msg'))
      assert.equal(delivered.body.group_id, 456)
      assert.ok(delivered.body.message.some(part => part.type === 'record'))
      assert.ok(bridge.calls.http.some(call => call.url.endsWith('/get_msg')))
      writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true, maxSeconds: 45 } }))
      let prompt = await call('/api/socialV2/prompt?key=group%3A456')
      assert.equal(prompt.status, 200)
      assert.equal(prompt.data.voices.enabled, true)
      assert.ok(prompt.data.voices.names.includes('示例.wav'))
      assert.equal(prompt.data.voices.maxSeconds, 45)
      voiceOnline = false
      prompt = await call('/api/socialV2/prompt?key=group%3A456')
      assert.equal(prompt.data.voices.enabled, false, 'stale discovery must not expose unavailable voice')
      voiceOnline = true
      bridge.cfg.socialV2.voice.enabled = true
      writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: false } }))
      prompt = await call('/api/socialV2/prompt?key=group%3A456')
      assert.equal(prompt.data.voices.enabled, false)
      writeFileSync(join(home, 'voice/config.json'), JSON.stringify({ voice: { enabled: true } }))
      rmSync(join(home, 'voice/runtime.json'))
      prompt = await call('/api/socialV2/prompt?key=group%3A456')
      assert.equal(prompt.data.voices.enabled, false)
      writeFileSync(join(home, 'voice/runtime.json'), JSON.stringify({ baseUrl: 'http://127.0.0.1:3082', token: 'b'.repeat(64) }))
      assert.match((await call('/api/socialV2/memory?key=group%3A456')).data.formatted, /旧话题/)
      assert.equal((await call('/api/socialV2/memory-append', { key: 'group:456', category: 'activeTopic', content: '新话题' })).status, 200)
      assert.ok(bridge.socialV2.conversations.get('group:456').activeTopics.some(item => item.text === '新话题'))
      assert.match((await call('/api/socialV2/memory?key=group%3A456')).data.formatted, /新话题/)
      assert.equal((await store.read('group:456')).value.activeTopics.length, 2)
      assert.equal((await call('/api/socialV2/memory-update', { key: 'group:456', category: 'activeTopic', oldContent: '新话题', newContent: '已修改话题' })).status, 200)
      assert.match((await call('/api/socialV2/memory?key=group%3A456')).data.formatted, /已修改话题/)
      assert.equal((await call('/api/socialV2/memory-remove', { key: 'group:456', category: 'activeTopic', content: '已修改话题' })).status, 200)
      assert.equal((await store.read('group:456')).value.activeTopics.length, 1)
      const beforeMention = await store.read('group:456')
      await store.write('group:456', { ...beforeMention.value, activeTopics: [{ ...beforeMention.value.activeTopics[0], lastMentionAt: 1 }] }, beforeMention.revision)
      bridge.appendSocialV2Message('group:456', '群友', '旧话题', '旧话题', false, false, 'message-1')
      let timer
      try { await Promise.race([topicTouched, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('topic mention not delivered')), 1000) })]) } finally { clearTimeout(timer) }
      assert.ok((await store.read('group:456')).value.activeTopics[0].lastMentionAt > 1)
      const oldState = JSON.parse(readFileSync(join(bridge.temp, 'state/social-v2.json'), 'utf8'))
      assert.equal(oldState.conversations['group:456'].activeTopics, undefined)
      rmSync(join(stateDir, 'runtime.json'))
      assert.notEqual((await call('/api/socialV2/memory-append', { key: 'group:456', category: 'activeTopic', content: '不可写' })).status, 200)
      assert.equal((await store.read('group:456')).value.activeTopics.length, 1)
    } finally { await new Promise(r => server.close(r)) }
  } finally { await bridge.close() }
})
