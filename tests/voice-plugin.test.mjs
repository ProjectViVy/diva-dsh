import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import { createServer } from 'node:net'
import { createServer as createHttpServer } from 'node:http'
import { spawnSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createVoiceService, useEffectHost } from '../plugins/voice/src/service.mjs'
import { cleanupTimedOutVoiceStart, assertNoManagedVoiceWorkers, stopVoiceWorkers } from '../plugins/voice/src/voice-packs.js'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'
import { probeAudio, processAudioVolume } from '../plugins/voice/src/voice-core.mjs'
import * as voicePacksModule from '../plugins/voice/src/voice-packs.js'
import { openSampleLocation, registerVoiceHttp } from '../plugins/voice/src/http.mjs'
import { prepareConfig, rewriteVenvConfig } from '../plugins/voice/src/voice-pack-import.js'
import { chooseImportDirectory } from '../plugins/voice/src/import-picker.mjs'

function make(t, options = {}) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-plugin-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return { dir, service: createVoiceService({ stateDir: dir, ...options }) }
}

test('a failed startup cleanup retains managed workers for a later retry', async () => {
  const children = [{ pid: 1 }], owned = new Map([['voice-local', children]])
  const first = await cleanupTimedOutVoiceStart(owned, 'voice-local', async value => {
    assert.equal(value, children); throw new Error('进程未能停止')
  })
  assert.match(first, /进程未能停止/)
  assert.equal(owned.get('voice-local'), children)
  const retry = await cleanupTimedOutVoiceStart(owned, 'voice-local', async value => assert.equal(value, children))
  assert.equal(retry, '')
  assert.equal(owned.has('voice-local'), false)
})

test('a late startup cleanup never removes a newer set of managed workers', async () => {
  const original = [{ pid: 1 }], newer = [{ pid: 2 }], owned = new Map([['voice-local', original]])
  const result = await cleanupTimedOutVoiceStart(owned, 'voice-local', async () => { owned.set('voice-local', newer) })
  assert.equal(result, '')
  assert.equal(owned.get('voice-local'), newer)
})

test('a startup timeout reports cleanup failure and keeps the workers tracked', async () => {
  const source = readFileSync(resolve('plugins/voice/src/voice-packs.js'), 'utf8')
  const start = source.lastIndexOf('    const cleanupError = await cleanupTimedOutVoiceStart(')
  const end = source.indexOf('\n  }\n\n  /** 取消正在进行的安装', start)
  assert.ok(start > 0 && end > start)
  const children = [{ pid: 1 }], ownedProcesses = new Map([['voice-local', children]])
  const run = runInNewContext(`(async () => { ${source.slice(start, end)} })`, {
    ownedProcesses, id: 'voice-local', m: { port: 8765 }, startLog: '',
    cleanupTimedOutVoiceStart: (owned, id) => cleanupTimedOutVoiceStart(owned, id, async () => { throw new Error('停止失败') }),
  })
  const result = await run()
  assert.equal(result.ok, false); assert.match(result.error, /自动停止失败.*停止失败/)
  assert.equal(ownedProcesses.get('voice-local'), children)
})

test('a voice pack cannot start over managed workers that have not exited', () => {
  const owned = new Map([['voice-local', [{ pid: 123, exitCode: null, signalCode: null }]]])
  assert.throws(() => assertNoManagedVoiceWorkers(owned, 'voice-local'), /进程.*停止/)
  owned.get('voice-local')[0].exitCode = 0
  assert.doesNotThrow(() => assertNoManagedVoiceWorkers(owned, 'voice-local'))
  assert.doesNotThrow(() => assertNoManagedVoiceWorkers(owned, 'voice-cloud'))
})

test('stopping managed workers attempts every process and reports failures', async () => {
  const seen = []
  const children = [{ pid: 11, exitCode: null, signalCode: null }, { pid: 12, exitCode: null, signalCode: null }]
  await assert.rejects(stopVoiceWorkers(children, { stopWorker: async child => {
    seen.push(child.pid)
    if (child.pid === 11) throw new Error('无法停止')
  } }), /11.*无法停止/)
  assert.deepEqual(seen, [11, 12])
})

test('voice disposal reports managed process shutdown failures', async t => {
  const { service } = make(t, { createPacks: () => ({ stopOwned: async () => [{ status: 'fulfilled', value: { ok: false, error: '语音进程仍在运行' } }] }) })
  await assert.rejects(service.dispose(), /语音进程仍在运行/)
})

test('voice disposal still stops managed workers when installer cleanup fails', async t => {
  let stopped = false
  const { service } = make(t, {
    createInstaller: () => ({ stopAll: async () => { throw new Error('安装器关闭失败') } }),
    createPacks: () => ({ stopOwned: async () => { stopped = true; return [] } }),
  })
  await assert.rejects(service.dispose(), /安装器关闭失败/)
  assert.equal(stopped, true)
})

test('one-click owned shutdown stops managed workers even before their ports are ready and reports failures', async t => {
  let calls = 0
  const { service } = make(t, { createPacks: () => ({ stopOwned: async () => {
    calls++; return calls === 1 ? [] : [{ status: 'fulfilled', value: { ok: false, error: '端口仍被占用' } }]
  } }) })
  assert.deepEqual(await service.stopOwned(), { ok: true, failures: [] })
  const failed = await service.stopOwned()
  assert.equal(failed.ok, false); assert.match(failed.error, /端口仍被占用/); assert.equal(calls, 2)
})

test('launch status remains available while a voice activation is waiting for the engine', async t => {
  let enter, release
  const entered = new Promise(resolve => { enter = resolve }), gate = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local', installed: true }] }),
    launchStatus: async () => ({ ok: true, packs: [{ id: 'voice-local', installed: true, running: false }] }),
    isOwnedRunning: async () => false,
    start: async () => { enter(); await gate; return { ok: false, error: '测试结束' } },
  }) })
  const activation = service.activate('voice-local')
  await entered
  const status = await Promise.race([service.launchStatus(), new Promise((_, reject) => setTimeout(() => reject(new Error('状态查询被启动队列阻塞')), 500))])
  assert.equal(status.packs[0].id, 'voice-local')
  release(); assert.equal((await activation).ok, false)
})

test('stopping a voice pack cancels a pending activation before switching routes', { timeout: 3000 }, async t => {
  let entered, release, stopped = 0
  const started = new Promise(resolve => { entered = resolve })
  const waiting = new Promise(resolve => { release = resolve }); t.after(() => release())
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-cloud', installed: true }] }),
    isOwnedRunning: async () => false,
    start: async (_id, { signal } = {}) => { entered(); signal?.addEventListener('abort', release, { once: true }); await waiting; return { ok: false, error: '启动已取消' } },
    stop: async () => { stopped++; return { ok: true } },
  }) })
  await service.saveRules({ route: 'local' })
  const activating = service.activate('voice-cloud')
  await started
  const stop = service.stop('voice-cloud')
  assert.equal((await Promise.race([activating, new Promise((_, reject) => setTimeout(() => reject(new Error('取消启动未及时完成')), 300))])).ok, false)
  assert.equal((await stop).ok, true)
  assert.equal(stopped, 1)
  assert.equal((await service.rules()).route, 'local')
})

test('voice port readiness wait aborts without waiting for its next polling interval', { timeout: 3000 }, async () => {
  const controller = new AbortController()
  const pending = voicePacksModule.waitForVoicePort({ port: 1, signal: controller.signal, probe: async () => false, intervalMs: 10000 })
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('voice readiness rejects a listening port when the owned main process has exited', async () => {
  const workers = [{ voiceRole: 'engine', pid: 10, exitCode: null, signalCode: null }, { voiceRole: 'voice', pid: 11, exitCode: 1, signalCode: null }]
  assert.equal(voicePacksModule.hasVoiceServiceWorker(workers), false)
  await assert.rejects(voicePacksModule.waitForVoicePort({ port: 1, probe: async () => true, intervalMs: 1, isAlive: () => voicePacksModule.hasVoiceServiceWorker(workers) }), /语音.*退出/)
})

test('voice disposal cancels an in-progress start before stopping owned workers', { timeout: 3000 }, async t => {
  let entered, stopped = false, release
  const started = new Promise(resolve => { entered = resolve }), waiting = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local', installed: true }] }),
    start: async (_id, { signal } = {}) => { entered(); signal?.addEventListener('abort', release, { once: true }); await waiting; return { ok: false, error: '启动已取消' } },
    stopOwned: async () => { stopped = true; return [] },
  }) })
  const starting = service.start('voice-local')
  await started
  await Promise.race([service.dispose(), new Promise((_, reject) => setTimeout(() => reject(new Error('关闭时启动未取消')), 300))])
  assert.equal((await starting).ok, false)
  assert.equal(stopped, true)
})

test('the real voice pack status returns the compact read-only summary used by SurfCore', async t => {
  const { dir, service } = make(t)
  mkdirSync(join(dir, 'packs/voice-local'), { recursive: true })
  writeFileSync(join(dir, 'packs/voice-local/config.toml'), '[voice]\n')
  const status = await service.launchStatus()
  const local = status.packs.find(pack => pack.id === 'voice-local')
  assert.equal(local.installed, true)
  assert.equal(typeof local.running, 'boolean')
  assert.deepEqual(Object.keys(local).sort(), ['id', 'installed', 'name', 'running'])
})

test('disposing voice prevents a pending library send from reaching the bridge', async t => {
  let calls = 0
  const { dir, service } = make(t, { sendLibraryVoice: async () => { calls++; return { ok: true } } })
  mkdirSync(join(dir, 'audio')); writeFileSync(join(dir, 'audio/test.wav'), 'fixture')
  const sending = service.sendLibraryVoice({ target: 'group:1234', file: 'test.wav', dryRun: false }).catch(error => error)
  await service.dispose()
  assert.ok(await sending instanceof Error)
  assert.equal(calls, 0)
})

test('disposing voice waits for a library send already dispatched to the bridge', { timeout: 5000 }, async t => {
  let entered, release, finished = false
  const started = new Promise(resolve => { entered = resolve }), waiting = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const { dir, service } = make(t, { sendLibraryVoice: async () => { entered(); await waiting; return { ok: true } } })
  // A library send only reaches the bridge through the Effect host, so attach one that delivers for the caller.
  useEffectHost({ commit: async (payload, options) => ({ ok: true, ...(options.deliver ? await options.deliver() : {}) }), cancel: () => ({ cancelled: false }), status: () => undefined })
  t.after(() => useEffectHost(null))
  mkdirSync(join(dir, 'audio')); writeFileSync(join(dir, 'audio/test.wav'), 'fixture')
  const sending = service.sendLibraryVoice({ target: 'group:1234', file: 'test.wav', dryRun: false }); await started
  const disposal = service.dispose().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve)); const endedTooEarly = finished
  release(); assert.equal((await sending).ok, true); await disposal
  assert.equal(endedTooEarly, false)
  await assert.rejects(service.sendLibraryVoice({ target: 'group:1234', file: 'test.wav', dryRun: false }), /关闭/)
})

test('disposing voice aborts a pack test through its real local HTTP client', { timeout: 5000 }, async t => {
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const server = createHttpServer((req, res) => { if (req.url === '/v1/speak/file') entered(); else { res.writeHead(404); res.end() } })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)) })
  const { dir } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port: server.address().port }] } }))
  const service = createVoiceService({ stateDir: dir })
  const testing = service.testPack('voice-cloud', { text: '测试' }).catch(error => error)
  await started
  await service.dispose()
  assert.ok(await testing instanceof Error)
})

test('disposing voice waits for a running pack test before stopping owned processes', { timeout: 5000 }, async t => {
  let release, entered, stopped = false, finished = false
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  const { service } = make(t, {
    createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-local' }] }), test: async () => { entered(); await waiting; return { ok: true } }, stopOwned: async () => { stopped = true; return [] } }),
    createInstaller: () => ({ status: () => null, stopAll: async () => {} }),
  })
  const testing = service.testPack('voice-local').catch(error => error); await started
  const disposal = service.dispose().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  const endedTooEarly = finished, stoppedTooEarly = stopped
  release(); await disposal
  assert.equal(endedTooEarly, false)
  assert.equal(stoppedTooEarly, false)
  assert.ok(await testing instanceof Error)
  assert.equal(stopped, true)
})

test('disposing voice aborts an in-flight synthesis request', { timeout: 5000 }, async t => {
  let entered
  const started = new Promise(resolve => { entered = resolve })
  const { service } = make(t, { fetchImpl: async (_url, { signal }) => {
    entered()
    return new Promise((_, reject) => {
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  } })
  const synthesis = service.synthesize({ text: '测试停用取消' }).catch(error => error)
  await started; await service.dispose()
  assert.match((await synthesis).message, /已关闭/)
})

test('disposing voice waits for an in-flight synthesis and does not write its late response', async t => {
  let release, entered, finished = false
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  const { dir, service } = make(t, { fetchImpl: async () => { entered(); await waiting; return new Response(Buffer.alloc(100, 1)) } })
  const synthesis = service.synthesize({ text: '测试关机时的合成' }).catch(error => error)
  await started
  const disposal = service.dispose().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  const endedTooEarly = finished
  release(); await disposal
  const result = await synthesis
  assert.equal(endedTooEarly, false)
  assert.ok(result instanceof Error)
  assert.deepEqual(fs.readdirSync(join(dir, 'cache')).filter(name => name.endsWith('.wav')), [])
  await assert.rejects(async () => service.synthesize({ text: '停用后不合成' }), /关闭|disposed|stopped/i)
})

test('disposing voice cancels a queued start before stopping owned processes', async t => {
  let release, entered, finished = false
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve }), events = []
  t.after(() => release())
  const { service } = make(t, {
    createPacks: () => ({ list: async () => { entered(); await waiting; return { packs: [{ id: 'voice-local' }] } }, start: async () => { events.push('start'); return { ok: true } }, stopOwned: async () => { events.push('stop'); return [] } }),
    createInstaller: () => ({ status: () => null, stopAll: async () => { events.push('stop-install') } }),
  })
  const start = service.start('voice-local').catch(error => error); await started
  const dispose = service.dispose().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  const endedTooEarly = finished
  release(); assert.match((await start).message, /取消/); await dispose
  assert.equal(endedTooEarly, false)
  assert.equal(events.includes('start'), false)
  assert.ok(events.includes('stop'))
  await assert.rejects(service.list(), /关闭|disposed|stopped/i)
})

test('voice rules validate engine mapping names against installed pack configurations', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ ttsCharacter: 'external-engine' })
  const local = join(dir, 'packs/voice-local'), cloud = join(dir, 'packs/voice-cloud')
  mkdirSync(local, { recursive: true }); mkdirSync(cloud, { recursive: true })
  writeFileSync(join(local, 'config.toml'), '[voice.characters]\nxiaoyu = "loli12-gsv"\n[server]\nport = 8765\n')
  writeFileSync(join(cloud, 'config.toml'), '[voice.characters]\ncloud-speaker = "age12-cloud"\n')
  assert.deepEqual((await service.rules()).ttsCharacters, ['xiaoyu', 'cloud-speaker'])
  await service.saveRules({ ttsCharacter: 'xiaoyu' })
  const before = readFileSync(join(dir, 'config.json'), 'utf8')
  await assert.rejects(service.saveRules({ ttsCharacter: 'loli12-gsv' }), /音色.*ID|音色.*id/i)
  await assert.rejects(service.saveRules({ ttsCharacter: 'unknown' }), /xiaoyu/)
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before)
  await service.saveRules({ ttsCharacter: '' })
  assert.equal((await service.rules()).ttsCharacter, '')
})

test('voice mapping reads valid TOML names without mistaking multiline text for sections', async t => {
  const { dir, service } = make(t), local = join(dir, 'packs/voice-local'); mkdirSync(local, { recursive: true })
  const content = '[other]\nnote = """\n[voice.characters]\nphantom = \'not-a-mapping\'\n"""\n[voice.characters] # mappings\nxiaoyu = "voice-one"\n"中文 名称" = "voice-two"\n\'single quoted\' = "voice-three"\n'
  writeFileSync(join(local, 'config.toml'), content)
  assert.deepEqual((await service.rules()).ttsCharactersByRoute.local, ['xiaoyu', '中文 名称', 'single quoted'])
  await service.saveRules({ ttsCharacter: '中文 名称' })
  await assert.rejects(service.saveRules({ ttsCharacter: 'phantom' }), /映射名/)
  assert.equal(readFileSync(join(local, 'config.toml'), 'utf8'), content)
})

test('invalid TOML reports a safe error and preserves the original voice configuration', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-local'); mkdirSync(pack, { recursive: true })
  const file = join(pack, 'config.toml'), original = '[engine]\ncloud_access_key = "fixture-secret"\n[voice.characters]\nxiaoyu = [\n'
  writeFileSync(file, original)
  const settings = await service.rules()
  assert.match(settings.ttsCharacterErrorsByRoute.local, /格式无效/)
  assert.doesNotMatch(JSON.stringify(settings), /fixture-secret/)
  await assert.rejects(service.saveRules({ ttsCharacter: 'xiaoyu' }), /格式无效/)
  assert.equal(readFileSync(file, 'utf8'), original)
})

test('damaged mapping configuration does not hide voice rules or block the other route', async t => {
  const { dir, service } = make(t), local = join(dir, 'packs/voice-local'), broken = join(dir, 'packs/voice-cloud/config.toml')
  mkdirSync(local, { recursive: true }); mkdirSync(broken, { recursive: true })
  writeFileSync(join(local, 'config.toml'), '[voice.characters]\nxiaoyu = "voice-id"\n')
  const settings = await service.rules()
  assert.equal(settings.ok, true)
  assert.equal((await service.list()).ok, true)
  assert.deepEqual(settings.ttsCharactersByRoute.local, ['xiaoyu'])
  assert.match(settings.ttsCharacterErrorsByRoute.cloud, /配置无效/)
  await service.saveRules({ ttsCharacter: 'xiaoyu', maxPerMinute: 3 })
  assert.equal((await service.rules()).maxPerMinute, 3)
  const before = readFileSync(join(dir, 'config.json'), 'utf8')
  await assert.rejects(service.saveRules({ route: 'cloud', ttsCharacter: 'cloud-name' }), /配置无效/)
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before)
  assert.equal(fs.statSync(broken).isDirectory(), true)
})

test('voice mapping validation follows the selected pack and supports explicit custom-engine override', async t => {
  const { dir, service } = make(t)
  for (const [id, name] of [['voice-local', 'local-name'], ['voice-cloud', 'cloud-name']]) {
    const pack = join(dir, 'packs', id); mkdirSync(pack, { recursive: true })
    writeFileSync(join(pack, 'config.toml'), `[voice.characters]\n${name} = "voice-id"\n`)
  }
  assert.deepEqual((await service.rules()).ttsCharactersByRoute, { local: ['local-name'], cloud: ['cloud-name'] })
  await assert.rejects(service.saveRules({ route: 'local', ttsCharacter: 'cloud-name' }), /local-name/)
  await assert.rejects(service.saveRules({ route: 'cloud', ttsCharacter: 'local-name' }), /cloud-name/)
  await assert.rejects(service.saveRules({ route: 'local', ttsCharacter: 'external', allowUnverifiedCharacter: 'true' }), /allowUnverifiedCharacter/)
  await service.saveRules({ route: 'local', ttsCharacter: 'external', allowUnverifiedCharacter: true })
  const disk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
  assert.equal(disk.voice.tts.character, 'external')
  assert.equal(disk.voice.tts.allowUnverifiedCharacter, undefined)
})

test('voice mapping validation preserves existing settings and accepts a custom engine endpoint', async t => {
  const { dir, service } = make(t), local = join(dir, 'packs/voice-local')
  await service.saveRules({ ttsCharacter: 'legacy-name' })
  mkdirSync(local, { recursive: true })
  writeFileSync(join(local, 'config.toml'), '[voice.characters]\nxiaoyu = "loli12-gsv"\n')
  await service.saveRules({ ttsCharacter: 'legacy-name', maxPerMinute: 3 })
  assert.equal((await service.rules()).maxPerMinute, 3)
  await service.saveRules({ route: 'local', endpoints: { local: 'http://127.0.0.1:9999' }, ttsCharacter: 'external-speaker' })
  assert.equal((await service.rules()).ttsCharacter, 'external-speaker')
  const before = readFileSync(join(dir, 'config.json'), 'utf8')
  await assert.rejects(service.saveRules({ endpoints: { local: 'http://127.0.0.1:8765' }, ttsCharacter: 'external-speaker' }), /映射名/)
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before)
})

test('voice rules expose saved mapping names separately for each route', async t => {
  const { dir, service } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'local', character: '当前本地', routeVoiceSelections: { local: { character: '过期本地' }, cloud: { character: '保存的云端' } } } } }))
  assert.deepEqual((await service.rules()).ttsCharacterByRoute, { local: '当前本地', cloud: '保存的云端' })
})


test('voice operator can validate an explicitly selected local file through the bridge', async t => {
  const calls = [], { dir, service } = make(t, { sendLibraryVoice: async body => { calls.push(body); return { ok: true, dryRun: body.dryRun } } })
  const file = join(dir, 'operator audio.wav'); writeFileSync(file, 'fixture')
  const result = await service.sendLibraryVoice({ target: 'group:1234', filePath: file, dryRun: true })
  assert.equal(result.dryRun, true)
  assert.deepEqual(calls, [{ target: 'group:1234', file, dryRun: true }])
  await assert.rejects(service.sendLibraryVoice({ target: 'group:1234', filePath: '../outside.wav', dryRun: true }), /绝对路径/)
  await assert.rejects(service.sendLibraryVoice({ target: 'group:1234', filePath: 'https://example.com/audio.wav', dryRun: true }), /本地|绝对路径/)
  await assert.rejects(service.sendLibraryVoice({ target: 'group:1234', filePath: file, text: '你好', dryRun: true }), /只能|同时/)
  assert.equal(calls.length, 1)
})

test('voice operator can validate text synthesis through the local bridge without sending', async t => {
  const calls = [], { service } = make(t, { sendLibraryVoice: async body => { calls.push(body); return { ok: true, dryRun: body.dryRun } } })
  await service.saveRules({ ttsMaxChars: 6 })
  const result = await service.sendLibraryVoice({ target: 'group:1234', text: '你好，世界', dryRun: true })
  assert.equal(result.dryRun, true)
  assert.deepEqual(calls, [{ target: 'group:1234', text: '你好，世界', dryRun: true }])
  await assert.rejects(service.sendLibraryVoice({ target: 'group:1234', text: '这句话超过长度限制', dryRun: true }), /最多 6/)
  await assert.rejects(service.sendLibraryVoice({ target: 'group:1234', text: '你好', file: 'other.wav', dryRun: true }), /只能|同时/)
  assert.equal(calls.length, 1)
})

test('voice service lists packs and saves settings independently of SurfCore', async (t) => {
  const { dir, service } = make(t)
  const list = await service.list()
  assert.deepEqual(list.packs.map(pack => pack.id), ['voice-local', 'voice-cloud'])
  assert.equal(list.packsDir, join(dir, 'packs'))
  await service.saveRules({ triggerWho: 'owner', maxPerMinute: 3, aiEnabled: true, route: 'cloud' })
  const rules = await service.rules()
  assert.equal(rules.maxPerMinute, 3)
  assert.equal(rules.route, 'cloud')
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'))).voice.tts.enabled, true)
})

test('independent voice library lists project audio without following symlinks', async t => {
  const { dir, service } = make(t), audio = join(dir, 'audio')
  mkdirSync(join(audio, '子目录'), { recursive: true })
  writeFileSync(join(audio, '一.wav'), 'audio')
  writeFileSync(join(audio, '子目录', 'two.MP3'), 'audio')
  writeFileSync(join(audio, 'ignored.txt'), 'not audio')
  symlinkSync(join(dir, 'outside.wav'), join(audio, 'link.wav'))
  const result = await service.library()
  assert.deepEqual(result.voices.map(x => x.name).sort(), ['一.wav', '子目录/two.MP3'].sort())
  assert.equal(result.dir, audio)
})

test('voice library pages expose audio beyond the first 100 files', async t => {
  const { dir, service } = make(t), audio = join(dir, 'audio'); mkdirSync(audio)
  for (let i = 0; i < 125; i++) writeFileSync(join(audio, `voice-${String(i).padStart(3, '0')}.wav`), 'audio')
  const first = await service.library(), second = await service.library({ offset: 100 })
  assert.equal(first.count, 125); assert.equal(first.voices.length, 100)
  assert.equal(second.offset, 100); assert.equal(second.voices.length, 25)
  assert.equal(second.voices.at(-1).name, 'voice-124.wav')
  await assert.rejects(service.library({ offset: -1 }), /offset|页/)
})

test('voice library HTTP endpoint requires authentication', async t => {
  const { dir, service } = make(t), audio = join(dir, 'audio')
  mkdirSync(audio); writeFileSync(join(audio, 'hello.wav'), 'audio')
  let handler
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(auth, query = '') {
    const req = Readable.from([]); Object.assign(req, { url: `/dsh-voice/api/voice/library${query}`, method: 'GET', headers: { host: '127.0.0.1:3082', ...(auth ? { cookie: 'x' } : {}) } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } }); return { status, body }
  }
  assert.equal((await request(false)).status, 401)
  const result = await request(true); assert.equal(result.status, 200); assert.equal(result.body.voices[0].name, 'hello.wav')
  assert.equal((await request(true, '?offset=100')).body.offset, 100)
  assert.equal((await request(true, '?offset=-1')).status, 400)
})

test('voice library inspection uses the bridge only after an authenticated explicit request', async t => {
  let calls = 0, handler
  const { service } = make(t, { probeLibrary: async () => { calls++; return { ok: true, voices: [{ name: 'hello.wav', ok: false, error: '文件过大' }] } } })
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(auth) {
    const req = Readable.from(['{}']); Object.assign(req, { url: '/dsh-voice/api/voice/library/probe', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', ...(auth ? { cookie: 'x' } : {}) } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } }); return { status, body }
  }
  assert.equal((await request(false)).status, 401); assert.equal(calls, 0)
  const result = await request(true); assert.equal(result.status, 200); assert.equal(result.body.voices[0].error, '文件过大'); assert.equal(calls, 1)
})

test('voice trial send forwards only a selected library file and an explicit dry-run mode', async t => {
  const calls = [], { dir, service } = make(t, { sendLibraryVoice: async body => { calls.push(body); return { ok: true, dryRun: body.dryRun } } })
  mkdirSync(join(dir, 'audio')); writeFileSync(join(dir, 'audio/hello.wav'), 'audio')
  await assert.rejects(service.sendLibraryVoice({ target: 'group:123', file: '../config.json', dryRun: true }), /语音库|文件/)
  await assert.rejects(service.sendLibraryVoice({ target: 'group:123', file: 'hello.wav' }), /校验|发送/)
  await service.sendLibraryVoice({ target: 'group:123', file: 'hello.wav', dryRun: true })
  assert.deepEqual(calls, [{ target: 'group:123', file: join(dir, 'audio/hello.wav'), dryRun: true }])
})

test('voice trial send HTTP requires a same-origin authenticated JSON request', async t => {
  let calls = 0, handler
  const { dir, service } = make(t, { sendLibraryVoice: async () => { calls++; return { ok: true, dryRun: true } } })
  mkdirSync(join(dir, 'audio')); writeFileSync(join(dir, 'audio/hello.wav'), 'audio')
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(headers) {
    const req = Readable.from([JSON.stringify({ target: 'group:123', file: 'hello.wav', dryRun: true })]); Object.assign(req, { url: '/dsh-voice/api/voice/library/send', method: 'POST', headers: { host: '127.0.0.1:3082', ...headers } })
    let status; await handler(req, { writeHead: code => { status = code }, end() {} }); return status
  }
  assert.equal(await request({ 'content-type': 'application/json' }), 401)
  assert.equal(await request({ cookie: 'x', origin: 'https://example.com', 'content-type': 'application/json' }), 403)
  assert.equal(await request({ cookie: 'x', 'content-type': 'application/json' }), 200)
  assert.equal(calls, 1)
})

test('voice trigger lists reject invalid or oversized input without broadening access', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ triggerWho: 'list', members: ['1234'], groups: ['5678'] })
  const before = readFileSync(join(dir, 'config.json'), 'utf8')
  await assert.rejects(service.saveRules({ groups: ['错误群号'], enabled: true }), /群.*无效/)
  await assert.rejects(service.saveRules({ members: ['1234', 'not-a-qq'] }), /QQ.*无效/)
  await assert.rejects(service.saveRules({ groups: Array.from({ length: 501 }, (_, i) => String(10000 + i)) }), /最多.*500/)
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before)
  assert.deepEqual((await service.rules()).groups, ['5678'])
  await service.saveRules({ groups: [] })
  assert.deepEqual((await service.rules()).groups, [])
})

test('voice rules retain migrated audio duration and size limits', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ maxSeconds: 120, maxBytes: 8388608 })
  const rules = await service.rules()
  assert.equal(rules.maxSeconds, 120)
  assert.equal(rules.maxBytes, 8388608)
  const reloaded = createVoiceService({ stateDir: dir })
  assert.equal((await reloaded.rules()).maxSeconds, 120)
  assert.equal((await reloaded.rules()).maxBytes, 8388608)
})

test('voice rules preserve audio processing and readback settings independently', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ defaultVolume: 1.8, loudness: 'loud', autoReadback: false })
  const reloaded = createVoiceService({ stateDir: dir })
  const { defaultVolume, loudness, autoReadback } = await reloaded.rules()
  assert.deepEqual({ defaultVolume, loudness, autoReadback }, { defaultVolume: 1.8, loudness: 'loud', autoReadback: false })
  await assert.rejects(service.saveRules({ defaultVolume: 5 }), /defaultVolume/)
  await assert.rejects(service.saveRules({ loudness: 'unknown' }), /loudness/)
})

test('voice rules preserve the configured ffmpeg path without changing other settings', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ ffmpegPath: 'tools/ffmpeg' })
  assert.equal((await service.rules()).ffmpegPath, 'tools/ffmpeg')
  assert.equal((await createVoiceService({ stateDir: dir }).rules()).ffmpegPath, 'tools/ffmpeg')
  await service.saveRules({ maxPerMinute: 3 })
  assert.equal((await service.rules()).ffmpegPath, 'tools/ffmpeg')
  await service.saveRules({ ffmpegPath: '' })
  assert.equal((await service.rules()).ffmpegPath, '')
})

test('voice rules preserve a project-local ffprobe path', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ ffprobePath: 'tools/ffprobe' })
  assert.equal((await service.rules()).ffprobePath, 'tools/ffprobe')
  assert.equal((await createVoiceService({ stateDir: dir }).rules()).ffprobePath, 'tools/ffprobe')
})

test('the QQ bridge reads the independent ffmpeg setting', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-ffmpeg-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const service = createVoiceService({ stateDir: join(home, 'voice') })
  await service.saveRules({ ffmpegPath: 'tools/ffmpeg' })
  writeFileSync(join(home, 'voice/runtime.json'), '{}')
  assert.equal(createBridgeHooks({ home }).readIndependentVoiceSettings().ffmpegPath, 'tools/ffmpeg')
})

test('configured audio processing passes volume to the project-local executable', { skip: process.platform === 'win32' }, async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-processing-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const ffmpeg = join(home, 'ffmpeg'), input = join(home, 'input.wav')
  writeFileSync(ffmpeg, '#!/bin/sh\nprintf "%s\\n" "$@" > "$(dirname "$0")/args.txt"\nfor arg do output="$arg"; done\nprintf test > "$output"\n')
  chmodSync(ffmpeg, 0o700); writeFileSync(input, 'test')
  const service = createVoiceService({ stateDir: join(home, 'voice') })
  await service.saveRules({ ffmpegPath: ffmpeg, defaultVolume: 1.5 })
  writeFileSync(join(home, 'voice/runtime.json'), '{}')
  const settings = createBridgeHooks({ home }).readIndependentVoiceSettings()
  const result = await processAudioVolume(input, { volume: settings.defaultVolume, ffmpegPath: settings.ffmpegPath, tmpDir: join(home, 'tmp') })
  assert.equal(result.converted, true)
  assert.equal(result.volume, 1.5)
  assert.match(readFileSync(join(home, 'args.txt'), 'utf8'), /volume=1\.5/)
  assert.equal(readFileSync(result.path, 'utf8'), 'test')
  await service.saveRules({ loudness: 'loud' })
  const next = createBridgeHooks({ home }).readIndependentVoiceSettings()
  const normalized = await processAudioVolume(input, { normalize: true, loudness: next.loudness, ffmpegPath: next.ffmpegPath, tmpDir: join(home, 'tmp') })
  assert.equal(normalized.loudness, -13)
  assert.match(readFileSync(join(home, 'args.txt'), 'utf8'), /loudnorm=I=-13/)
})

test('project-local ffprobe returns duration without writing outside its test directory', { skip: process.platform === 'win32' }, async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'voice-probe-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const ffprobe = join(home, 'ffprobe'), input = join(home, 'input.wav')
  writeFileSync(ffprobe, '#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; output="$1"; fi; shift; done\nprintf \'{"format":{"duration":"125"},"streams":[{"codec_type":"audio","codec_name":"pcm"}]}\' > "$output"\n')
  chmodSync(ffprobe, 0o700); writeFileSync(input, 'test')
  const result = await probeAudio(input, { ffprobePath: ffprobe, tmpDir: join(home, 'tmp') })
  assert.equal(result.ok, true)
  assert.equal(result.duration, 125)
  assert.equal(result.codec, 'pcm')
})

test('voice rules preserve synthesis limits, voice identifier, and cache version', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ ttsTimeoutMs: 90000, ttsMaxChars: 240, ttsCharacter: 'speaker-a', ttsCacheVersion: 3 })
  const reloaded = createVoiceService({ stateDir: dir })
  const { ttsTimeoutMs, ttsMaxChars, ttsCharacter, ttsCacheVersion } = await reloaded.rules()
  assert.deepEqual({ ttsTimeoutMs, ttsMaxChars, ttsCharacter, ttsCacheVersion }, { ttsTimeoutMs: 90000, ttsMaxChars: 240, ttsCharacter: 'speaker-a', ttsCacheVersion: 3 })
  const config = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).voice.tts
  assert.equal(config.timeoutMs, 90000)
  assert.equal(config.maxChars, 240)
  assert.equal(config.character, 'speaker-a')
  assert.equal(config.cacheVersion, 3)
  await assert.rejects(service.saveRules({ ttsTimeoutMs: 120001 }), /ttsTimeoutMs/)
})

test('direct voice synthesis uses configured voice and cache version', async t => {
  let calls = 0, body
  const { service } = make(t, { fetchImpl: async (_url, options) => { calls++; body = JSON.parse(options.body); return new Response(new Uint8Array(64), { status: 200 }) } })
  await service.saveRules({ ttsCharacter: 'speaker-a', ttsCacheVersion: 1 })
  await service.synthesize({ text: '测试音频' })
  assert.equal(body.character, 'speaker-a')
  await service.synthesize({ text: '测试音频' })
  assert.equal(calls, 1)
  await service.saveRules({ ttsCacheVersion: 2 })
  await service.synthesize({ text: '测试音频' })
  assert.equal(calls, 2)
})

test('empty cache version does not restore an older synthesis cache', async t => {
  let calls = 0
  const { dir, service } = make(t, { fetchImpl: async () => { calls++; return new Response(new Uint8Array(64), { status: 200 }) } })
  await service.saveRules({ ttsCacheVersion: 0 })
  await service.synthesize({ text: '测试音频' })
  await service.saveRules({ ttsCacheVersion: 2 })
  await service.synthesize({ text: '测试音频' })
  const before = readFileSync(join(dir, 'config.json'), 'utf8')
  for (const value of ['', null, ' ', false]) {
    await assert.rejects(service.saveRules({ ttsCacheVersion: value }), /ttsCacheVersion/)
    assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before)
  }
  await service.synthesize({ text: '测试音频' })
  assert.equal(calls, 2)
  await service.saveRules({ ttsCacheVersion: 0 })
  assert.equal((await service.rules()).ttsCacheVersion, 0)
})

test('changing the installed cloud speaker invalidates old synthesis cache', async t => {
  let calls = 0
  const { dir, service } = make(t, { fetchImpl: async () => { calls++; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  const voiceDir = join(dir, 'packs/voice-cloud/voices/age12-cloud'); mkdirSync(voiceDir, { recursive: true })
  writeFileSync(join(voiceDir, 'voice.json'), JSON.stringify({ speaker: 'voice-old' }))
  writeFileSync(join(dir, 'packs/voice-cloud/config.toml'), '[engine]\ncloud_app_id = "app"\ncloud_access_key = "key"\n')
  await service.saveRules({ route: 'cloud' })
  await service.synthesize({ text: '相同的一句话' }); await service.synthesize({ text: '相同的一句话' })
  assert.equal(calls, 1)
  await service.packs.cloudConfig('voice-cloud', { speaker: 'voice-new' })
  await service.synthesize({ text: '相同的一句话' })
  assert.equal(calls, 2)
})

test('cloud synthesis does not use an unresolved configuration transaction', async t => {
  let calls = 0
  const { dir, service } = make(t, { fetchImpl: async () => { calls++; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  const pack = join(dir, 'packs/voice-cloud'); mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  writeFileSync(join(pack, 'voices/age12-cloud/voice.json'), '{"speaker":"intermediate"}')
  writeFileSync(join(pack, '.cloud-config-transaction.json'), '{corrupt')
  await service.saveRules({ route: 'cloud' })
  await assert.rejects(async () => service.synthesize({ text: '测试' }), /恢复记录.*损坏/)
  assert.equal(calls, 0)
  assert.equal(readFileSync(join(pack, 'voices/age12-cloud/voice.json'), 'utf8'), '{"speaker":"intermediate"}')
})

test('external cloud endpoint still works with an incomplete local voice pack', async t => {
  let calls = 0
  const { dir, service } = make(t, { fetchImpl: async () => { calls++; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  mkdirSync(join(dir, 'packs/voice-cloud/voices/age12-cloud'), { recursive: true })
  await service.saveRules({ route: 'cloud' })
  await service.synthesize({ text: '外部引擎测试' })
  assert.equal(calls, 1)
})

test('legacy local endpoint is not used as the default cloud synthesis endpoint', async t => {
  const requests = []
  const { dir, service } = make(t, { fetchImpl: async url => { requests.push(url); return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'cloud', baseUrl: 'http://127.0.0.1:9001' } } }))
  await service.synthesize({ text: '云线路' })
  assert.equal(requests[0], 'http://127.0.0.1:8767/v1/speak/file')
  await service.saveRules({ route: 'local' })
  await service.synthesize({ text: '本地线路' })
  assert.equal(requests[1], 'http://127.0.0.1:9001/v1/speak/file')
  await service.saveRules({ route: 'cloud', endpoints: { local: 'http://127.0.0.1:9002', cloud: 'http://127.0.0.1:9003' } })
  await service.synthesize({ text: '指定云线路' })
  assert.equal(requests[2], 'http://127.0.0.1:9003/v1/speak/file')
  await service.saveRules({ route: 'local' })
  await service.synthesize({ text: '指定本地线路' })
  assert.equal(requests[3], 'http://127.0.0.1:9002/v1/speak/file')
})

test('independent synthesis and preview enforce the configured text limit', async t => {
  let calls = 0
  const { service } = make(t, { fetchImpl: async () => { calls++; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  await service.saveRules({ ttsMaxChars: 3 })
  await assert.rejects(async () => service.synthesize({ text: '四个字符' }), /最多 3/)
  await assert.rejects(service.preview('voice-cloud', '四个字符'), /最多 3/)
  assert.equal(calls, 0)
  await service.synthesize({ text: '三个字' })
  assert.equal(calls, 1)
})

test('voice pack synthesis test respects the configured text limit and import state', async t => {
  let calls = [], importing = false
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-cloud', import: importing ? { phase: '复制中' } : null }] }),
    test: async (id, options) => { calls.push({ id, text: options.text }); return { ok: true } },
  }) })
  await service.saveRules({ ttsMaxChars: 3 })
  await assert.rejects(service.testPack('voice-cloud', { text: '四个字符' }), /最多 3/)
  assert.equal(calls.length, 0)
  await service.testPack('voice-cloud')
  assert.equal(calls[0].text.length, 3)
  let handler
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: () => null }) }, service)
  const req = Readable.from([JSON.stringify({ id: 'voice-cloud', text: '四个字符' })])
  Object.assign(req, { method: 'POST', url: '/dsh-voice/api/voice/packs/test', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } })
  let status
  await handler(req, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 400)
  assert.equal(calls.length, 1)
  importing = true
  await assert.rejects(service.testPack('voice-cloud', { text: '测试' }), /正在导入/)
  assert.equal(calls.length, 1)
})

test('slow pack synthesis test leaves list and stop responsive while rejecting import', { timeout: 5000 }, async t => {
  let release, entered, stopped = 0
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-cloud' }] }),
    test: async () => { entered(); await waiting; return { ok: true } },
    stop: async () => { stopped++; return { ok: true } },
  }) })
  const testing = service.testPack('voice-cloud')
  await started
  let timer
  const ready = await Promise.race([Promise.all([service.list(), service.stop('voice-cloud')]).then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 100) })])
  clearTimeout(timer)
  assert.equal(ready, true)
  assert.equal(stopped, 1)
  await assert.rejects(service.importStart('voice-cloud', { sourceDir: '/unused' }), /正在测试/)
  release(); await testing
})

test('switching routes does not stop another pack during its synthesis test', { timeout: 5000 }, async t => {
  let release, entered; const stopped = []
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }),
    test: async () => { entered(); await waiting; return { ok: true } },
    isOwnedRunning: async () => true,
    stop: async id => { stopped.push(id); return { ok: true } },
  }) })
  const testing = service.testPack('voice-local'); await started
  const result = await service.activate('voice-cloud')
  assert.match(result.warning, /正在测试/)
  assert.deepEqual(stopped, [])
  release(); await testing
})

test('voice preview rejects oversized input instead of silently truncating it', async t => {
  let calls = 0
  const { service } = make(t, { fetchImpl: async () => { calls++; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  await service.saveRules({ ttsMaxChars: 1000 })
  await assert.rejects(service.preview('voice-cloud', '测'.repeat(501)), /试听.*500/)
  assert.equal(calls, 0)
})

test('voice self-check adapts its sample to a short configured text limit', async t => {
  let text = ''
  const { service } = make(t, { fetchImpl: async (url, options) => {
    if (url.endsWith('/v1/health')) return new Response('{}', { status: 200 })
    text = JSON.parse(options.body).text
    return new Response(Buffer.alloc(100, 1), { status: 200 })
  } })
  await service.saveRules({ aiEnabled: true, ttsMaxChars: 1 })
  const result = await service.selfCheck()
  assert.equal(result.stages.find(stage => stage.id === 'synthesis').ok, true)
  assert.equal(text.length, 1)
})

test('voice defaults off and partial settings changes preserve unrelated choices', async t => {
  const { service } = make(t)
  assert.equal((await service.rules()).enabled, false)
  await service.saveRules({ enabled: true, aiEnabled: true, triggerWho: 'list', members: ['123'], maxPerMinute: 0 })
  await service.saveRules({ maxPerHour: 20 })
  const rules = await service.rules()
  assert.equal(rules.aiEnabled, true)
  assert.equal(rules.triggerWho, 'list')
  assert.deepEqual(rules.members, ['123'])
  assert.equal(rules.maxPerMinute, 0)
  await service.saveRules({ endpoints: { local: 'http://127.0.0.1:9000' } })
  assert.equal((await service.rules()).endpoints.local, 'http://127.0.0.1:9000')
  await assert.rejects(service.saveRules({ endpoints: { local: 'https://example.com' } }), /loopback/i)
  assert.equal((await service.rules()).endpoints.local, 'http://127.0.0.1:9000')
})

test('empty or invalid voice rate limits never silently become unlimited', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ maxPerMinute: 2, maxPerHour: 10 })
  const file = join(dir, 'config.json'), before = readFileSync(file, 'utf8')
  for (const changes of [{ maxPerMinute: '' }, { maxPerHour: null }, { maxPerMinute: -1 }, { maxPerHour: 2.5 }, { maxPerMinute: 61 }, { maxPerHour: 601 }]) {
    await assert.rejects(service.saveRules(changes), /maxPerMinute|maxPerHour/)
    assert.equal(readFileSync(file, 'utf8'), before)
  }
  await service.saveRules({ maxPerMinute: 0, maxPerHour: 0 })
  const rules = await service.rules()
  assert.equal(rules.maxPerMinute, 0); assert.equal(rules.maxPerHour, 0)
})

test('invalid cloud pricing and quota leave voice settings unchanged', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ pricePerKChar: 2.5, monthlyQuota: 1000 })
  const file = join(dir, 'config.json'), before = readFileSync(file, 'utf8')
  for (const changes of [{ pricePerKChar: '' }, { monthlyQuota: null }, { pricePerKChar: -1 }, { monthlyQuota: -1 }, { pricePerKChar: 'invalid' }, { monthlyQuota: 1.5 }]) {
    await assert.rejects(service.saveRules(changes))
    assert.equal(readFileSync(file, 'utf8'), before)
  }
  await service.saveRules({ pricePerKChar: 0, monthlyQuota: 0 })
  assert.equal((await service.rules()).pricePerKChar, 0)
  assert.equal((await service.rules()).monthlyQuota, 0)
})

test('failed voice rule save leaves live settings and disk configuration unchanged', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ enabled: true, route: 'cloud', maxPerMinute: 4 })
  const file = join(dir, 'config.json'), before = readFileSync(file, 'utf8'), original = fs.renameSync
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) { if (destination === file) throw new Error('simulated save failure'); return original.call(this, source, destination, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.saveRules({ enabled: false, route: 'local' }), /simulated save failure/)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal((await service.rules()).enabled, true)
  assert.equal((await service.rules()).route, 'cloud')
})

test('voice settings reload external changes and preserve unrelated configuration when saved', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ enabled: true, maxPerMinute: 3 })
  const file = join(dir, 'config.json'), changed = JSON.parse(readFileSync(file, 'utf8'))
  changed.voice.maxPerHour = 47; changed.voice.cloud = { pricePerKChar: 6 }; changed.voicePacks.manifests = [{ id: 'extra-local' }]; changed.other = { note: 'preserve' }
  writeFileSync(file, JSON.stringify(changed))
  assert.equal((await service.rules()).maxPerHour, 47)
  await service.saveRules({ maxPerMinute: 5 })
  const after = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(after.voice.maxPerHour, 47)
  assert.equal(after.voice.cloud.pricePerKChar, 6)
  assert.deepEqual(after.voicePacks.manifests, [{ id: 'extra-local' }])
  assert.equal(after.other.note, 'preserve')
})

test('voice plugin rejects a damaged configuration without replacing it', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ enabled: true })
  const file = join(dir, 'config.json'), damaged = '{damaged'
  writeFileSync(file, damaged)
  await assert.rejects(service.rules())
  await assert.rejects(service.saveRules({ maxPerMinute: 2 }))
  assert.equal(readFileSync(file, 'utf8'), damaged)
})

test('cloud usage reads current independent voice pricing from disk', async t => {
  const { dir, service } = make(t)
  await service.saveRules({ pricePerKChar: 1, monthlyQuota: 5000 })
  const logs = join(dir, 'packs/voice-cloud/logs'); mkdirSync(logs, { recursive: true })
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  writeFileSync(join(logs, 'requests.jsonl'), JSON.stringify({ t: `${day}T12:00:00`, chars: 1000 }) + '\n')
  const file = join(dir, 'config.json'), changed = JSON.parse(readFileSync(file, 'utf8'))
  changed.voice.cloud = { pricePerKChar: 6, monthlyQuota: 2000 }; writeFileSync(file, JSON.stringify(changed))
  const stats = await service.packs.cloudStats('voice-cloud')
  assert.equal(stats.monthCost, 6)
  assert.equal(stats.remainChars, 1000)
})

test('cloud usage reads the resource from the engine section', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud')
  mkdirSync(pack, { recursive: true })
  writeFileSync(join(pack, 'config.toml'), '[server]\ncloud_resource = "wrong"\n[engine]\ncloud_resource = "seed-icl-2.0"\n')
  const stats = await service.packs.cloudStats('voice-cloud')
  assert.equal(stats.resource, 'seed-icl-2.0')
  assert.equal(stats.model, '豆包声音复刻 2.0（字符版）')
})

test('cloud usage reports an unresolved cloud configuration recovery', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud')
  mkdirSync(pack, { recursive: true })
  writeFileSync(join(pack, '.cloud-config-transaction.json'), '{invalid')
  await assert.rejects(service.packs.cloudStats('voice-cloud'), /恢复|损坏/)
})

test('cloud usage reports an unreadable log instead of a zero balance', async t => {
  const { dir, service } = make(t), log = join(dir, 'packs/voice-cloud/logs/requests.jsonl')
  mkdirSync(log, { recursive: true })
  await assert.rejects(service.packs.cloudStats('voice-cloud'))
})

test('cloud usage counts a multi-chunk log and rejects an oversized record', async t => {
  const { dir, service } = make(t), logs = join(dir, 'packs/voice-cloud/logs'), file = join(logs, 'requests.jsonl')
  mkdirSync(logs, { recursive: true })
  const now = new Date(), day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  writeFileSync(file, (JSON.stringify({ t: `${day}T12:00:00`, chars: 3, note: '中文'.repeat(100) }) + '\n').repeat(1000))
  const stats = await service.packs.cloudStats('voice-cloud')
  assert.equal(stats.todayCalls, 1000); assert.equal(stats.todayChars, 3000)
  writeFileSync(file, 'x'.repeat(1048577))
  await assert.rejects(service.packs.cloudStats('voice-cloud'), /过长/)
  assert.equal(readFileSync(file).length, 1048577)
})

test('voice synthesis uses the latest saved endpoint and voice after an external change', async t => {
  let request
  const { dir, service } = make(t, { fetchImpl: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  await service.saveRules({ ttsCharacter: 'old', endpoints: { local: 'http://127.0.0.1:8765' } })
  const file = join(dir, 'config.json'), changed = JSON.parse(readFileSync(file, 'utf8'))
  changed.voice.tts.character = 'new'; changed.voice.tts.endpoints.local = 'http://127.0.0.1:9876'
  writeFileSync(file, JSON.stringify(changed))
  await service.synthesize({ text: '测试新设置' })
  assert.equal(request.url, 'http://127.0.0.1:9876/v1/speak/file')
  assert.equal(request.body.character, 'new')
})

test('Windows voice startup owns the actual Python processes and uses the local pack paths', () => {
  assert.equal(typeof voicePacksModule.voiceProcessPlan, 'function')
  const { voiceProcessPlan } = voicePacksModule
  const dir = resolve('.artifacts/test-tmp/voice-pack-plan')
  const cloud = voiceProcessPlan('voice-cloud', dir)
  assert.equal(cloud.length, 1)
  assert.equal(cloud[0].command, join(dir, '.venv', 'Scripts', 'pythonw.exe'))
  assert.deepEqual(cloud[0].args, ['-m', 'voxd', '--config', join(dir, 'config.toml')])
  const local = voiceProcessPlan('voice-local', dir)
  assert.equal(local.length, 2)
  assert.equal(local[0].command, join(dir, '.venv-gsv', 'Scripts', 'pythonw.exe'))
  assert.equal(local[0].cwd, join(dir, 'vendor', 'GPT-SoVITS', 'code'))
  assert.ok(local[0].args.includes('api_v2.py'))
  assert.match(local[0].env.PYTHONPATH, /GPT_SoVITS/)
  assert.equal(local[1].command, join(dir, '.venv', 'Scripts', 'pythonw.exe'))
})

test('voice worker shutdown stops only the processes launched by the plugin', async t => {
  assert.equal(typeof voicePacksModule.launchVoiceWorkers, 'function')
  assert.equal(typeof voicePacksModule.stopVoiceWorkers, 'function')
  const { dir } = make(t)
  let ready
  const started = new Promise(resolve => { ready = resolve })
  const workers = voicePacksModule.launchVoiceWorkers({ root: dir, plans: [{ role: 'voice', command: process.execPath, cwd: dir, args: ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], env: {} }], onOutput: text => { if (text.includes('ready')) ready() } })
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => listener.close(resolve)))
  await started
  const owned = new Map([['voice-local', workers]])
  assert.equal(voicePacksModule.hasOwnedVoiceWorkers(owned, 'voice-local'), true)
  assert.equal(voicePacksModule.hasVoiceServiceWorker(workers), true)
  await voicePacksModule.stopVoiceWorkers(workers)
  assert.equal(voicePacksModule.hasOwnedVoiceWorkers(owned, 'voice-local'), false)
  assert.equal(voicePacksModule.hasVoiceServiceWorker(workers), false)
  assert.equal(workers.length, 0)
  assert.equal(listener.listening, true)
})

test('voice self-check reports service, synthesis and send prerequisites without sending a message', async t => {
  const requests = []
  const server = createHttpServer((req, res) => {
    requests.push(req.url)
    if (req.url === '/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"engine":"fixture"}') }
    else if (req.url === '/v1/speak/file') { res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(Buffer.alloc(100, 1)) }
    else { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const { service } = make(t, { checkSendReadiness: async () => ({ ok: true, toolEnabled: true, connected: true }) })
  await service.saveRules({ enabled: true, aiEnabled: true, endpoints: { local: `http://127.0.0.1:${server.address().port}` } })
  const result = await service.selfCheck()
  assert.equal(result.ok, true)
  assert.equal(result.healthy, true)
  assert.deepEqual(result.stages.map(stage => stage.id), ['service', 'synthesis', 'send-prerequisites'])
  assert.ok(result.stages.every(stage => stage.ok))
  assert.deepEqual(requests, ['/v1/health', '/v1/speak/file'])
  await service.saveRules({ enabled: false })
  assert.equal((await service.selfCheck()).stages.find(stage => stage.id === 'send-prerequisites').ok, false)
})

test('voice self-check stops reading an oversized health response', async t => {
  let pulled = 0, cancelled = false
  const { service } = make(t, { fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) { if (++pulled <= 100) controller.enqueue(new Uint8Array(32 * 1024)); else controller.close() },
    cancel() { cancelled = true },
  }), { status: 200 }) })
  const result = await service.selfCheck()
  assert.equal(result.stages.find(stage => stage.id === 'service').ok, false)
  assert.equal(cancelled, true)
  assert.ok(pulled < 10)
})

test('voice self-check tries the configured alternate route when synthesis fails', async t => {
  const requests = []
  const fallback = createHttpServer((req, res) => { requests.push(`local:${req.url}`); res.writeHead(200, { 'content-type': 'audio/wav' }); res.end(Buffer.alloc(100, 1)) })
  const primary = createHttpServer((req, res) => {
    requests.push(`cloud:${req.url}`)
    if (req.url === '/v1/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}') }
    else { res.writeHead(503, { 'content-type': 'application/json' }); res.end('{"detail":"engine unavailable"}') }
  })
  await Promise.all([new Promise(resolve => fallback.listen(0, '127.0.0.1', resolve)), new Promise(resolve => primary.listen(0, '127.0.0.1', resolve))])
  t.after(() => Promise.all([new Promise(resolve => fallback.close(resolve)), new Promise(resolve => primary.close(resolve))]))
  const { service } = make(t, { checkSendReadiness: async () => ({ ok: true, toolEnabled: true, connected: true }) })
  await service.saveRules({ enabled: true, aiEnabled: true, route: 'cloud', endpoints: { cloud: `http://127.0.0.1:${primary.address().port}`, local: `http://127.0.0.1:${fallback.address().port}` } })
  const result = await service.selfCheck()
  assert.equal(result.healthy, true)
  assert.match(result.stages.find(stage => stage.id === 'synthesis').detail, /cloud.*local/)
  assert.deepEqual(requests, ['cloud:/v1/health', 'cloud:/v1/speak/file', 'local:/v1/speak/file'])
})

test('voice self-check uses the alternate engine default after a route failure', async t => {
  const requests = []
  const { dir, service } = make(t, { fetchImpl: async (url, options) => {
    if (url.endsWith('/v1/health')) return new Response('{}')
    const body = JSON.parse(options.body); requests.push({ url, body })
    if (url.includes(':8767')) return new Response('{"detail":"engine unavailable"}', { status: 503 })
    if (body.character || body.voice) return new Response('{"detail":"unknown voice"}', { status: 400 })
    return new Response(Buffer.alloc(100, 1))
  }, checkSendReadiness: async () => ({ ok: true, toolEnabled: true, connected: true }) })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { enabled: true, tts: { enabled: true, route: 'cloud', character: '云端音色' } } }))
  const result = await service.selfCheck()
  assert.equal(result.stages.find(stage => stage.id === 'synthesis').ok, true)
  assert.match(result.stages.find(stage => stage.id === 'synthesis').detail, /默认音色/)
  assert.equal(requests[0].body.character, '云端音色')
  assert.equal(requests[1].body.character, undefined)
  assert.equal(requests[1].body.voice, undefined)
})

test('voice self-check uses the saved alternate route voice after a route failure', async t => {
  const requests = []
  const { dir, service } = make(t, { fetchImpl: async (url, options) => {
    if (url.endsWith('/v1/health')) return new Response('{}')
    const body = JSON.parse(options.body); requests.push({ url, body })
    if (url.includes(':8767')) return new Response('{"detail":"engine unavailable"}', { status: 503 })
    if (body.character !== '已存本地音色') return new Response('{"detail":"wrong voice"}', { status: 400 })
    return new Response(Buffer.alloc(100, 1))
  }, checkSendReadiness: async () => ({ ok: true, toolEnabled: true, connected: true }) })
  const original = JSON.stringify({ voice: { enabled: true, tts: { enabled: true, route: 'cloud', character: '主路音色', routeVoiceSelections: { local: { character: '已存本地音色' } } } } })
  writeFileSync(join(dir, 'config.json'), original)
  const result = await service.selfCheck()
  assert.equal(result.stages.find(stage => stage.id === 'synthesis').ok, true)
  assert.match(result.stages.find(stage => stage.id === 'synthesis').detail, /备用线路已保存音色/)
  assert.equal(requests[0].body.character, '主路音色')
  assert.equal(requests[1].body.character, '已存本地音色')
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), original)
})

test('voice self-check does not claim sending is ready when the QQ bridge is unavailable', async t => {
  const { service } = make(t, { fetchImpl: async url => url.endsWith('/v1/health') ? new Response('{}') : new Response(Buffer.alloc(100, 1)), checkSendReadiness: async () => ({ ok: false, error: 'QQ 桥接未运行' }) })
  await service.saveRules({ enabled: true, aiEnabled: true })
  const result = await service.selfCheck()
  const stage = result.stages.find(item => item.id === 'send-prerequisites')
  assert.equal(stage.ok, false)
  assert.match(stage.detail, /桥接未运行/)
  assert.equal(result.healthy, false)
})

test('voice self-check reports a disabled QQ voice tool even if the bridge is connected', async t => {
  const { service } = make(t, { fetchImpl: async url => url.endsWith('/v1/health') ? new Response('{}') : new Response(Buffer.alloc(100, 1)), checkSendReadiness: async () => ({ ok: true, toolEnabled: false, connected: true }) })
  await service.saveRules({ enabled: true, aiEnabled: true })
  const stage = (await service.selfCheck()).stages.find(item => item.id === 'send-prerequisites')
  assert.equal(stage.ok, false)
  assert.match(stage.detail, /工具未开启/)
})

test('voice self-check classifies failures and reports actionable hints', async t => {
  const fetchImpl = async url => url.endsWith('/v1/health')
    ? new Response('{}', { status: 200 })
    : new Response(JSON.stringify({ detail: '音色映射没有配置' }), { status: 400, headers: { 'content-type': 'application/json' } })
  const { service } = make(t, { fetchImpl })
  await service.saveRules({ enabled: true, aiEnabled: true })
  const stage = (await service.selfCheck()).stages.find(item => item.id === 'synthesis')
  assert.equal(stage.ok, false)
  assert.equal(stage.code, 'voice.config-mapping')
  assert.match(stage.hint, /音色/)
  const client = readFileSync(resolve('plugins/voice/src/client.js'), 'utf8')
  assert.match(client, /stage\.hint/)
})

test('an explicitly requested voice is not combined with the default character', async t => {
  let body
  const fetchImpl = async (_url, options) => { body = JSON.parse(options.body); return new Response(Buffer.alloc(100, 1), { status: 200 }) }
  const { dir } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { character: 'default-character' } } }))
  const service = createVoiceService({ stateDir: dir, fetchImpl })
  await service.synthesize({ text: '测试', voice: 'explicit-voice' })
  assert.equal(body.voice, 'explicit-voice')
  assert.equal(body.character, undefined)
})

test('explicit or configured character takes precedence over a migrated default voice', async t => {
  const bodies = []
  const { dir, service } = make(t, { fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  const file = join(dir, 'config.json')
  writeFileSync(file, JSON.stringify({ voice: { tts: { voice: '旧音色', character: '默认角色' } } }))
  await service.synthesize({ text: '明确角色', character: '指定角色' })
  assert.equal(bodies[0].character, '指定角色')
  assert.equal(bodies[0].voice, undefined)
  await service.synthesize({ text: '默认角色' })
  assert.equal(bodies[1].character, '默认角色')
  assert.equal(bodies[1].voice, undefined)
  await service.synthesize({ text: '明确音色', character: '指定角色', voice: '指定音色' })
  assert.equal(bodies[2].voice, '指定音色')
  assert.equal(bodies[2].character, undefined)
  writeFileSync(file, JSON.stringify({ voice: { tts: { voice: '旧音色' } } }))
  await service.synthesize({ text: '旧默认音色' })
  assert.equal(bodies[3].voice, '旧音色')
  assert.equal(bodies[3].character, undefined)
})

test('voice service exposes online installation progress and prevents concurrent offline import', async t => {
  let state = null
  const createInstaller = () => ({
    start: async (id, options) => { state = { id, phase: '下载', mirror: options.mirror }; return { ok: true } },
    status: () => state,
    cancel: () => { state.phase = '已取消'; return { ok: true } },
    cleanup: () => ({ ok: true, backup: 'voice-cloud-backup', moved: 1 }),
    stopAll: async () => {},
  })
  const createPacks = () => ({ list: async () => ({ packs: [{ id: 'voice-cloud', installed: false, running: false }] }) })
  const { service } = make(t, { createPacks, createInstaller })
  await service.install('voice-cloud', { mirror: 'ghfast' })
  assert.equal((await service.list()).packs[0].install.phase, '下载')
  await assert.rejects(service.importStart('voice-cloud', { sourceDir: '/tmp/fixture' }), /正在安装/)
  assert.equal(service.cancelInstall('voice-cloud').ok, true)
  assert.equal((await service.list()).packs[0].install.phase, '已取消')
  assert.equal((await service.cleanupInstall('voice-cloud')).backup, 'voice-cloud-backup')
})

test('voice pack management refuses a symbolic-link pack directory', async t => {
  const { dir, service } = make(t)
  const elsewhere = join(dir, 'elsewhere'); mkdirSync(elsewhere)
  mkdirSync(join(dir, 'packs'))
  symlinkSync(elsewhere, join(dir, 'packs', 'voice-cloud'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { accessKey: 'do-not-write' }), /符号链接/)
})

test('cloud configuration masks short keys without disclosing the entire secret', async t => {
  const { dir, service } = make(t)
  const pack = join(dir, 'packs/voice-cloud'); mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  writeFileSync(join(pack, 'config.toml'), 'cloud_app_id = "app"\ncloud_access_key = "abc"\n')
  writeFileSync(join(pack, 'voices/age12-cloud/voice.json'), '{"speaker":"speaker"}')
  const result = await service.packs.readCloudConfig('voice-cloud')
  assert.equal(result.configured, true)
  assert.equal(result.hasAccessKey, true)
  assert.doesNotMatch(result.accessKeyMasked, /abc/)
  assert.equal(result.accessKey, undefined)
})

test('cloud configuration read failures are reported instead of appearing unconfigured', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml')
  mkdirSync(pack, { recursive: true })
  const originalConfig = '[engine]\ncloud_app_id = "old-app"\n'; writeFileSync(file, originalConfig)
  const originalRead = fs.promises.readFile.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'readFile', async (path, ...args) => {
    if (String(path) === file) { const error = new Error('simulated permission failure'); error.code = 'EACCES'; throw error }
    return originalRead(path, ...args)
  })
  t.after(() => mock.mock.restore())
  await assert.rejects(service.packs.readCloudConfig('voice-cloud'), /permission failure/)
  const status = (await service.list()).packs.find(item => item.id === 'voice-cloud')
  assert.match(status.cloudConfigError, /permission failure/)
  assert.equal(readFileSync(file, 'utf8'), originalConfig)
})

test('voice import does not treat an inaccessible installed configuration as absent', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml')
  mkdirSync(pack, { recursive: true }); writeFileSync(file, 'existing configuration')
  const access = fs.promises.access.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'access', async (path, ...args) => {
    if (String(path) === file) { const error = new Error('simulated inaccessible config'); error.code = 'EACCES'; throw error }
    return access(path, ...args)
  })
  t.after(() => mock.mock.restore())
  await assert.rejects(service.importStart('voice-cloud', { sourceDir: join(dir, 'missing-source'), allowUnverified: true }), /inaccessible config/)
  assert.equal(readFileSync(file, 'utf8'), 'existing configuration')
})

test('cloud configuration refuses a missing or damaged voice definition without changing credentials', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml')
  mkdirSync(pack, { recursive: true })
  const original = 'cloud_app_id = "old"\ncloud_access_key = "old-key"\n'
  writeFileSync(file, original)
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { appId: 'new', speaker: 'speaker-new' }), /音色.*不存在|音色.*缺失/)
  assert.equal(readFileSync(file, 'utf8'), original)
  const voice = join(pack, 'voices/age12-cloud/voice.json'); mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true }); writeFileSync(voice, '{损坏')
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { appId: 'new', speaker: 'speaker-new' }), /音色.*损坏/)
  assert.equal(readFileSync(file, 'utf8'), original); assert.equal(readFileSync(voice, 'utf8'), '{损坏')
})

test('cloud configuration round trips escaped values and rejects multiline credentials', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), voice = join(pack, 'voices/age12-cloud/voice.json')
  mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  writeFileSync(join(pack, 'config.toml'), 'cloud_app_id = "old"\ncloud_access_key = "old-key"\n')
  writeFileSync(voice, '{"speaker":"old"}')
  await service.packs.cloudConfig('voice-cloud', { appId: 'app"slash\\test', accessKey: 'key\\with"quote', speaker: 'speaker-new' })
  const result = await service.packs.readCloudConfig('voice-cloud')
  assert.equal(result.appId, 'app"slash\\test'); assert.equal(result.configured, true); assert.equal(result.speaker, 'speaker-new')
  const before = readFileSync(join(pack, 'config.toml'), 'utf8')
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { accessKey: 'a\nother = 1' }), /密钥|无效/)
  assert.equal(readFileSync(join(pack, 'config.toml'), 'utf8'), before)
})

test('cloud credentials are written into the engine section even when it is not last', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml')
  mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  writeFileSync(file, '[engine]\nprimary = "cloud"\n[server]\nport = 8767\ncloud_app_id = "unrelated"\n')
  writeFileSync(join(pack, 'voices/age12-cloud/voice.json'), '{"speaker":"old"}')
  await service.packs.cloudConfig('voice-cloud', { appId: 'engine-app', accessKey: 'engine-key', speaker: 'speaker' })
  const text = readFileSync(file, 'utf8'), [engine, server] = text.split('[server]')
  assert.match(engine, /cloud_app_id = "engine-app"/); assert.match(engine, /cloud_access_key = "engine-key"/)
  assert.match(server, /cloud_app_id = "unrelated"/)
  const config = await service.packs.readCloudConfig('voice-cloud')
  assert.equal(config.appId, 'engine-app'); assert.equal(config.configured, true)
})

test('cloud configuration without an engine section is preserved and rejected', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml')
  mkdirSync(pack, { recursive: true })
  const source = '[server]\nport = 8767\n'; writeFileSync(file, source)
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { appId: 'app' }), /engine/)
  assert.equal(readFileSync(file, 'utf8'), source)
})

test('cloud configuration preserves Windows line endings and rejects duplicate engine fields', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml')
  mkdirSync(pack, { recursive: true })
  writeFileSync(file, '[engine]\r\nprimary = "cloud"\r\n[server]\r\nport = 8767\r\n')
  await service.packs.cloudConfig('voice-cloud', { appId: 'app', accessKey: 'key' })
  const updated = readFileSync(file, 'utf8')
  assert.doesNotMatch(updated, /(?<!\r)\n/)
  const duplicate = '[engine]\ncloud_app_id = "first"\ncloud_app_id = "second"\n'; writeFileSync(file, duplicate)
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { appId: 'new' }), /重复字段/)
  assert.equal(readFileSync(file, 'utf8'), duplicate)
})

test('cloud configuration restores the previous voice when credential publication fails', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml'), voice = join(pack, 'voices/age12-cloud/voice.json')
  mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  const oldConfig = 'cloud_app_id = "old"\ncloud_access_key = "old-key"\n', oldVoice = '{"speaker":"old","other":"preserve"}'
  writeFileSync(file, oldConfig); writeFileSync(voice, oldVoice)
  const original = fs.promises.rename.bind(fs.promises); let failed = false
  t.mock.method(fs.promises, 'rename', async (source, destination) => {
    if (destination === file && !failed) { failed = true; throw new Error('模拟配置发布失败') }
    return original(source, destination)
  })
  await assert.rejects(service.packs.cloudConfig('voice-cloud', { appId: 'new', speaker: 'new' }), /模拟配置发布失败/)
  assert.equal(readFileSync(file, 'utf8'), oldConfig); assert.equal(readFileSync(voice, 'utf8'), oldVoice)
})

test('cloud configuration recovers after the process exits between voice and credential writes', async t => {
  const { dir } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml'), voice = join(pack, 'voices/age12-cloud/voice.json')
  mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  const oldConfig = 'cloud_app_id = "old"\ncloud_access_key = "old-key"\n', oldVoice = '{"speaker":"old","other":"preserve"}'
  writeFileSync(file, oldConfig); writeFileSync(voice, oldVoice)
  const moduleUrl = new URL('../plugins/voice/src/service.mjs', import.meta.url).href
  const script = `import fs from 'node:fs'; import { createVoiceService } from ${JSON.stringify(moduleUrl)}; const file = process.argv[2]; const original = fs.promises.rename.bind(fs.promises); fs.promises.rename = async (from, to) => { await original(from, to); if (to === file) process.exit(71); }; await createVoiceService({ stateDir: process.argv[1] }).packs.cloudConfig('voice-cloud', { appId: 'new', speaker: 'new' });`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir, voice], { encoding: 'utf8' })
  assert.equal(child.status, 71, child.stderr)
  let observedSpeaker
  const service = createVoiceService({ stateDir: dir, fetchImpl: async () => { observedSpeaker = JSON.parse(readFileSync(voice, 'utf8')).speaker; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  await service.saveRules({ route: 'cloud' })
  await service.synthesize({ text: '恢复后合成' })
  assert.equal(observedSpeaker, 'old')
  const restored = await service.packs.readCloudConfig('voice-cloud')
  assert.equal(restored.appId, 'old'); assert.equal(restored.speaker, 'old')
  assert.equal(readFileSync(file, 'utf8'), oldConfig); assert.equal(readFileSync(voice, 'utf8'), oldVoice)
})

test('cloud configuration retains the completed update after a process exit before cleanup', async t => {
  const { dir } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml'), voice = join(pack, 'voices/age12-cloud/voice.json')
  mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  writeFileSync(file, 'cloud_app_id = "old"\ncloud_access_key = "old-key"\n'); writeFileSync(voice, '{"speaker":"old"}')
  const moduleUrl = new URL('../plugins/voice/src/service.mjs', import.meta.url).href
  const script = `import fs from 'node:fs'; import { createVoiceService } from ${JSON.stringify(moduleUrl)}; const file = process.argv[2]; const original = fs.promises.rename.bind(fs.promises); fs.promises.rename = async (from, to) => { await original(from, to); if (to === file) process.exit(72); }; await createVoiceService({ stateDir: process.argv[1] }).packs.cloudConfig('voice-cloud', { appId: 'new', speaker: 'new' });`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir, file], { encoding: 'utf8' })
  assert.equal(child.status, 72, child.stderr)
  const restored = await createVoiceService({ stateDir: dir }).packs.readCloudConfig('voice-cloud')
  assert.equal(restored.appId, 'new'); assert.equal(restored.speaker, 'new')
  assert.equal(fs.existsSync(join(pack, '.cloud-config-transaction.json')), false)
})

test('cloud configuration recovery refuses to overwrite an external edit', async t => {
  const { dir } = make(t), pack = join(dir, 'packs/voice-cloud'), file = join(pack, 'config.toml'), voice = join(pack, 'voices/age12-cloud/voice.json')
  mkdirSync(join(pack, 'voices/age12-cloud'), { recursive: true })
  writeFileSync(file, 'cloud_app_id = "old"\ncloud_access_key = "old-key"\n'); writeFileSync(voice, '{"speaker":"old"}')
  const moduleUrl = new URL('../plugins/voice/src/service.mjs', import.meta.url).href
  const script = `import fs from 'node:fs'; import { createVoiceService } from ${JSON.stringify(moduleUrl)}; const file = process.argv[2]; const original = fs.promises.rename.bind(fs.promises); fs.promises.rename = async (from, to) => { await original(from, to); if (to === file) process.exit(71); }; await createVoiceService({ stateDir: process.argv[1] }).packs.cloudConfig('voice-cloud', { appId: 'new', speaker: 'new' });`
  assert.equal(spawnSync(process.execPath, ['--input-type=module', '-e', script, dir, voice]).status, 71)
  writeFileSync(file, 'cloud_app_id = "external-edit"\n')
  await assert.rejects(createVoiceService({ stateDir: dir }).packs.readCloudConfig('voice-cloud'), /发生变化/)
  assert.match(readFileSync(file, 'utf8'), /external-edit/)
  assert.equal(fs.existsSync(join(pack, '.cloud-config-transaction.json')), true)
})

test('cloud pack status and startup report a damaged recovery record instead of missing credentials', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud')
  mkdirSync(pack, { recursive: true }); writeFileSync(join(pack, 'config.toml'), 'cloud_app_id = "example"\n')
  writeFileSync(join(pack, '.cloud-config-transaction.json'), '{损坏')
  const cloud = (await service.list()).packs.find(item => item.id === 'voice-cloud')
  assert.match(cloud.cloudConfigError, /恢复记录损坏/)
  assert.notEqual(cloud.needsCloudConfig, true)
  const moduleUrl = new URL('../plugins/voice/src/service.mjs', import.meta.url).href
  const script = `Object.defineProperty(process, 'platform', { value: 'win32' }); const { createVoiceService } = await import(${JSON.stringify(moduleUrl)}); try { await createVoiceService({ stateDir: process.argv[1] }).packs.start('voice-cloud'); process.exit(1) } catch (e) { console.log(e.message) }`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, dir], { encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr); assert.match(child.stdout, /恢复记录损坏/)
})

test('offline import refuses to replace a cloud pack with an unresolved configuration transaction', async t => {
  const { dir, service } = make(t), pack = join(dir, 'packs/voice-cloud')
  mkdirSync(pack, { recursive: true })
  const config = '[engine]\ncloud_app_id = "old-app"\n', broken = '{damaged'
  writeFileSync(join(pack, 'config.toml'), config)
  writeFileSync(join(pack, '.cloud-config-transaction.json'), broken)
  await assert.rejects(service.importStart('voice-cloud', { sourceDir: join(dir, 'unused-source'), allowUnverified: true }), /恢复记录损坏/)
  assert.equal(readFileSync(join(pack, 'config.toml'), 'utf8'), config)
  assert.equal(readFileSync(join(pack, '.cloud-config-transaction.json'), 'utf8'), broken)
})


test('reference audio refuses a symbolic link to a file outside the voice pack', async t => {
  const { dir, service } = make(t)
  const pack = join(dir, 'packs/voice-cloud'); mkdirSync(join(pack, 'voicepack'), { recursive: true })
  writeFileSync(join(pack, 'config.toml'), '[server]\n')
  const outside = join(dir, 'outside.wav'); writeFileSync(outside, 'private data')
  symlinkSync(outside, join(pack, 'voicepack', 'sample.wav'))
  await assert.rejects(service.packs.sampleFile('voice-cloud'), /符号链接/)
})

test('plugin disposal does not stop an unrelated process listening on a voice port', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => listener.close(resolve)))
  const port = listener.address().port
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const service = createVoiceService({ stateDir: dir })
  assert.deepEqual(await service.packs.stopOwned(), [])
  assert.equal(listener.listening, true)
  await assert.rejects(service.stop('voice-cloud'), /不是当前插件启动/)
  assert.equal(listener.listening, true)
})

test('voice pack removal keeps a restorable backup inside the project', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const target = join(dir, 'packs/voice-cloud'); mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'config.toml'), 'original configuration')
  const service = createVoiceService({ stateDir: dir })
  const removed = await service.archive('voice-cloud')
  assert.equal((await service.list()).packs.find(item => item.id === 'voice-cloud').installed, false)
  assert.equal(readFileSync(join(dir, 'archives', removed.name, 'pack/config.toml'), 'utf8'), 'original configuration')
  assert.equal((await service.list()).packs.find(item => item.id === 'voice-cloud').archives[0], removed.name)
  mkdirSync(target); writeFileSync(join(target, 'config.toml'), 'new pack')
  await assert.rejects(service.restore('voice-cloud', removed.name), /已有语音包/)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'new pack')
  rmSync(target, { recursive: true })
  await service.restore('voice-cloud', removed.name)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'original configuration')
  await assert.rejects(service.restore('voice-cloud', '../outside'), /备份/)
})

test('corrupt voice pack state is preserved and blocks removal before the pack is moved', async t => {
  const { dir } = make(t)
  const target = join(dir, 'packs/voice-cloud'); mkdirSync(target, { recursive: true })
  const state = join(dir, 'packs/installed.json'), broken = '{"packs":'
  writeFileSync(state, broken)
  writeFileSync(join(target, 'config.toml'), 'keep original voice package')
  const service = createVoiceService({ stateDir: dir })
  await assert.rejects(service.archive('voice-cloud'), /状态|state|JSON/i)
  assert.equal(readFileSync(state, 'utf8'), broken)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'keep original voice package')
  assert.equal(existsSync(join(dir, 'archives')), false)
})

test('a failed voice pack state write preserves the previous installed metadata', async t => {
  const { dir, service } = make(t)
  const packs = join(dir, 'packs'); mkdirSync(packs, { recursive: true })
  const file = join(packs, 'installed.json'), before = '{"packs":{"voice-cloud":{"enabled":true,"importSource":"source"}}}'
  writeFileSync(file, before)
  const original = fs.promises.writeFile.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'writeFile', async (target, data, options) => {
    if (String(target).startsWith(file)) { await original(target, '{', options); throw new Error('simulated interrupted state write') }
    return original(target, data, options)
  })
  t.after(() => mock.mock.restore())
  await assert.rejects(service.packs.setEnabled('voice-cloud', false), /simulated interrupted/)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.deepEqual(fs.readdirSync(packs), ['installed.json'])
  mock.mock.restore()
  await service.packs.setEnabled('voice-cloud', false)
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).packs['voice-cloud'], { enabled: false, importSource: 'source' })
})

test('concurrent voice pack updates preserve both packages installed metadata', async t => {
  const { dir, service } = make(t), packs = join(dir, 'packs'); mkdirSync(packs, { recursive: true })
  const file = join(packs, 'installed.json')
  writeFileSync(file, JSON.stringify({ packs: { 'voice-local': { enabled: true }, 'voice-cloud': { enabled: true } } }))
  let first, release
  const secondPublished = new Promise(resolve => { release = resolve })
  const write = fs.promises.writeFile.bind(fs.promises), rename = fs.promises.rename.bind(fs.promises)
  const writeMock = t.mock.method(fs.promises, 'writeFile', async (target, data, options) => {
    if (String(target).startsWith(`${file}.`) && !first) {
      first = String(target)
      await Promise.race([secondPublished, new Promise(resolve => setTimeout(resolve, 200))])
    }
    return write(target, data, options)
  })
  const renameMock = t.mock.method(fs.promises, 'rename', async (from, to) => {
    const result = await rename(from, to)
    if (String(to) === file && String(from) !== first) release()
    return result
  })
  t.after(() => { writeMock.mock.restore(); renameMock.mock.restore() })
  await Promise.all([service.packs.setEnabled('voice-local', false), service.packs.setEnabled('voice-cloud', false)])
  const state = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(state.packs['voice-local'].enabled, false)
  assert.equal(state.packs['voice-cloud'].enabled, false)
})

test('voice pack removal refuses to kill a listener owned by another process', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => listener.close(resolve)))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port: listener.address().port }] } }))
  const target = join(dir, 'packs/voice-cloud'); mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'config.toml'), 'keep me')
  const service = createVoiceService({ stateDir: dir })
  await assert.rejects(service.archive('voice-cloud'), /不是当前插件启动/)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'keep me')
  assert.equal(listener.listening, true)
})

test('voice archive and import preserve a warming pack when its owned worker cannot stop', async t => {
  let imports = 0, stops = 0
  const { dir, service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-cloud', installed: true, running: false, engineUp: false }] }),
    hasOwnedWorkers: () => true,
    stop: async () => { stops++; throw new Error('无法停止预热进程') },
    setEnabled: async () => {},
    startImport: async () => { imports++; return { ok: true } },
  }) })
  const target = join(dir, 'packs/voice-cloud'); mkdirSync(target, { recursive: true })
  writeFileSync(join(target, 'config.toml'), 'original configuration')
  await assert.rejects(service.archive('voice-cloud'), /无法停止预热进程/)
  await assert.rejects(service.importStart('voice-cloud', { sourceDir: join(dir, 'source') }), /进程|运行/)
  assert.equal(stops, 1); assert.equal(imports, 0)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'original configuration')
})


test('offline voice import retains its only config while removing bundled credentials', async t => {
  const { dir } = make(t)
  const file = join(dir, 'config.toml')
  writeFileSync(file, '[server]\nport = 8765\n[engine]\nprimary = "cloud"\ncloud_access_key = "example-secret"\n')
  const result = await prepareConfig(dir, '')
  assert.equal(result.preserved, false)
  assert.doesNotMatch(readFileSync(file, 'utf8'), /example-secret/)
  assert.match(readFileSync(file, 'utf8'), /\[server\]/)
})

test('offline voice pack import preserves its source and repairs paths in the final project directory', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const source = join(dir, 'source', 'voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts', 'runtime/python313']) mkdirSync(join(source, name), { recursive: true })
  for (const name of ['.venv/Scripts/python.exe', 'runtime/python313/python.exe']) writeFileSync(join(source, name), 'fixture')
  writeFileSync(join(source, '.venv/pyvenv.cfg'), 'home = C:/old/python\n')
  writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
  const config = '[server]\nport = 8767\n[engine]\nprimary = "cloud"\ncloud_access_key = "bundled-secret"\n'
  writeFileSync(join(source, 'config.toml'), config)
  const service = createVoiceService({ stateDir: dir })
  assert.equal((await service.packs.inspectImport('voice-cloud', source)).verified, false)
  await assert.rejects(service.packs.startImport('voice-cloud', { sourceDir: source }), /完整性清单/)
  await service.packs.startImport('voice-cloud', { sourceDir: source, allowUnverified: true })
  let item
  for (let i = 0; i < 100; i++) {
    item = (await service.list()).packs.find(pack => pack.id === 'voice-cloud')
    if (['完成', '失败'].includes(item.import?.phase)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(item.import?.phase, '完成', item.import?.error)
  assert.equal(readFileSync(join(source, 'config.toml'), 'utf8'), config)
  const target = join(dir, 'packs/voice-cloud')
  assert.doesNotMatch(readFileSync(join(target, 'config.toml'), 'utf8'), /bundled-secret/)
  assert.match(readFileSync(join(target, '.venv/pyvenv.cfg'), 'utf8'), new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('disposing voice cancels copying imports and waits for directory switches', { timeout: 10000 }, async t => {
  for (const phase of ['copy', 'switch']) {
    const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
    const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
    const source = join(dir, 'source/voice-cloud'), target = join(dir, 'packs/voice-cloud')
    for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts', 'runtime/python313']) mkdirSync(join(source, name), { recursive: true })
    for (const name of ['.venv/Scripts/python.exe', 'runtime/python313/python.exe']) writeFileSync(join(source, name), 'fixture')
    writeFileSync(join(source, '.venv/pyvenv.cfg'), 'home = C:/old/python\n')
    writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
    const config = '[server]\nport = 8767\n[engine]\nprimary = "cloud"\n'
    writeFileSync(join(source, 'config.toml'), config)
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'config.toml'), config); writeFileSync(join(target, 'old-data'), 'keep')
    let release, entered, finished = false
    const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
    const original = fs.promises[phase === 'copy' ? 'copyFile' : 'rename'].bind(fs.promises)
    const mock = t.mock.method(fs.promises, phase === 'copy' ? 'copyFile' : 'rename', async (from, to, ...args) => {
      if (phase === 'copy' ? String(to).includes('.import-') : String(to) === target && String(from).includes('.import-')) { entered(); await waiting }
      return original(from, to, ...args)
    })
    t.after(() => { release(); mock.mock.restore() })
    const service = createVoiceService({ stateDir: dir })
    await service.importStart('voice-cloud', { sourceDir: source, allowUnverified: true }); await started
    const dispose = service.dispose().then(() => { finished = true })
    await new Promise(resolve => setImmediate(resolve))
    const endedTooEarly = finished
    release(); await dispose; mock.mock.restore()
    assert.equal(endedTooEarly, false, phase)
    assert.equal(readFileSync(join(source, 'config.toml'), 'utf8'), config)
    if (phase === 'copy') assert.equal(readFileSync(join(target, 'old-data'), 'utf8'), 'keep')
    else assert.ok(existsSync(join(target, '.venv/Scripts/python.exe')))
    assert.deepEqual(fs.readdirSync(join(dir, 'packs')).filter(name => name.startsWith('.import-')), [])
  }
})

test('offline voice import cancellation during copy preserves source and old installation', { timeout: 5000 }, async t => {
  const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const source = join(dir, 'source/voice-cloud'), target = join(dir, 'packs/voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts', 'runtime/python313']) mkdirSync(join(source, name), { recursive: true })
  for (const name of ['.venv/Scripts/python.exe', 'runtime/python313/python.exe']) writeFileSync(join(source, name), 'fixture')
  writeFileSync(join(source, '.venv/pyvenv.cfg'), 'home = C:/old/python\n')
  writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
  const config = '[server]\nport = 8767\n[engine]\nprimary = "cloud"\n'
  writeFileSync(join(source, 'config.toml'), config)
  mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'config.toml'), config)
  writeFileSync(join(target, 'old-data'), 'keep')
  let release, reached
  const paused = new Promise(resolve => { release = resolve }), copying = new Promise(resolve => { reached = resolve })
  const copyFile = fs.promises.copyFile.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'copyFile', async (from, to, ...args) => {
    if (String(to).includes('.import-')) { reached(); await paused }
    return copyFile(from, to, ...args)
  })
  t.after(() => { release(); mock.mock.restore() })
  const service = createVoiceService({ stateDir: dir })
  await service.importStart('voice-cloud', { sourceDir: source, allowUnverified: true })
  await copying
  const result = service.packs.cancelImport('voice-cloud')
  release()
  assert.equal(result.ok, true)
  let item
  for (let i = 0; i < 100; i++) {
    item = (await service.list()).packs.find(pack => pack.id === 'voice-cloud')
    if (['完成', '失败'].includes(item.import?.phase)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(item.import?.phase, '失败')
  assert.equal(item.import?.code, 'IMPORT_CANCELLED')
  assert.equal(readFileSync(join(source, 'config.toml'), 'utf8'), config)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), config)
  assert.equal(readFileSync(join(target, 'old-data'), 'utf8'), 'keep')
  assert.deepEqual(fs.readdirSync(join(dir, 'packs')).filter(name => name.startsWith('.import-') || name.startsWith('voice-cloud.backup-')), [])
})

test('offline import refuses cancellation after switching the installation directory has started', async t => {
  const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const source = join(dir, 'source/voice-cloud'), target = join(dir, 'packs/voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts', 'runtime/python313']) mkdirSync(join(source, name), { recursive: true })
  for (const name of ['.venv/Scripts/python.exe', 'runtime/python313/python.exe']) writeFileSync(join(source, name), 'fixture')
  writeFileSync(join(source, '.venv/pyvenv.cfg'), 'home = C:/old/python\n')
  writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
  writeFileSync(join(source, 'config.toml'), '[server]\nport = 8767\n[engine]\nprimary = "cloud"\n')
  let release, reached
  const paused = new Promise(resolve => { release = resolve }), switched = new Promise(resolve => { reached = resolve })
  const rename = fs.promises.rename.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (String(to) === target && String(from).includes('.import-')) { reached(); await paused }
    return rename(from, to)
  })
  t.after(() => { release(); mock.mock.restore() })
  const service = createVoiceService({ stateDir: dir })
  await service.importStart('voice-cloud', { sourceDir: source, allowUnverified: true })
  await switched
  const result = service.packs.cancelImport('voice-cloud')
  release()
  assert.equal(result.ok, false)
  assert.match(result.error, /不能取消|无法取消/)
  let item
  for (let i = 0; i < 100; i++) {
    item = (await service.list()).packs.find(pack => pack.id === 'voice-cloud')
    if (['完成', '失败'].includes(item.import?.phase)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(item.import?.phase, '完成', item.import?.error)
})

test('voice pack listing does not try to recover cloud configuration during an offline import', async t => {
  const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const source = join(dir, 'source/voice-cloud'), target = join(dir, 'packs/voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts', 'runtime/python313']) mkdirSync(join(source, name), { recursive: true })
  for (const name of ['.venv/Scripts/python.exe', 'runtime/python313/python.exe']) writeFileSync(join(source, name), 'fixture')
  writeFileSync(join(source, '.venv/pyvenv.cfg'), 'home = C:/old/python\n')
  writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
  const config = '[server]\nport = 8767\n[engine]\nprimary = "cloud"\n'
  writeFileSync(join(source, 'config.toml'), config)
  mkdirSync(target, { recursive: true }); writeFileSync(join(target, 'config.toml'), config)
  writeFileSync(join(target, '.cloud-config-transaction.json'), '{broken')
  let release, reached
  const paused = new Promise(resolve => { release = resolve }), switching = new Promise(resolve => { reached = resolve })
  const rename = fs.promises.rename.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (String(from) === target && String(to).startsWith(`${target}.backup-`)) { reached(); await paused }
    return rename(from, to)
  })
  t.after(() => { release(); mock.mock.restore() })
  const service = createVoiceService({ stateDir: dir })
  await service.packs.startImport('voice-cloud', { sourceDir: source, allowUnverified: true })
  await switching
  const pack = (await service.list()).packs.find(item => item.id === 'voice-cloud')
  assert.equal(pack.import.phase, '切换安装目录')
  assert.equal(pack.cloudConfigError, undefined)
  assert.equal(readFileSync(join(target, '.cloud-config-transaction.json'), 'utf8'), '{broken')
  release()
  for (let i = 0; i < 100; i++) {
    if (['完成', '失败'].includes((await service.list()).packs.find(item => item.id === 'voice-cloud').import?.phase)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
})

test('voice import cleanup deletes only the recorded source and old backup on explicit request', async t => {
  const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const target = join(dir, 'packs/voice-cloud'), backup = `${target}.backup-123456789`, source = join(dir, 'source/voice-cloud'), unrelated = join(dir, 'unrelated')
  for (const path of [target, backup, source, unrelated]) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'config.toml'), 'keep') }
  writeFileSync(join(dir, 'packs/installed.json'), JSON.stringify({ packs: { 'voice-cloud': { enabled: true, importSource: source, backupDir: backup } } }))
  const service = createVoiceService({ stateDir: dir })
  await assert.rejects(service.deleteImportSource('voice-cloud', unrelated), /源目录|源文件夹/)
  await assert.rejects(service.deleteImportBackup('voice-cloud', unrelated), /备份/)
  assert.equal(readFileSync(join(source, 'config.toml'), 'utf8'), 'keep')
  assert.equal((await service.deleteImportSource('voice-cloud', source)).ok, true)
  assert.equal((await service.deleteImportBackup('voice-cloud', backup)).ok, true)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'keep')
  assert.equal(readFileSync(join(unrelated, 'config.toml'), 'utf8'), 'keep')
  const state = JSON.parse(readFileSync(join(dir, 'packs/installed.json'), 'utf8'))
  assert.equal(state.packs['voice-cloud'].importSource, undefined)
  assert.equal(state.packs['voice-cloud'].backupDir, undefined)
})

test('voice import cleanup refuses recorded paths that overlap the project or point outside the backup location', async t => {
  const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const target = join(dir, 'packs/voice-cloud'), unrelated = join(dir, 'unrelated')
  mkdirSync(target, { recursive: true }); mkdirSync(unrelated)
  writeFileSync(join(target, 'config.toml'), 'current'); writeFileSync(join(unrelated, 'config.toml'), 'other')
  writeFileSync(join(dir, 'packs/installed.json'), JSON.stringify({ packs: { 'voice-cloud': { importSource: dir, backupDir: unrelated } } }))
  const service = createVoiceService({ stateDir: dir })
  await assert.rejects(service.deleteImportSource('voice-cloud', dir), /重叠/)
  await assert.rejects(service.deleteImportBackup('voice-cloud', unrelated), /备份目录无效/)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), 'current')
  assert.equal(readFileSync(join(unrelated, 'config.toml'), 'utf8'), 'other')
})

test('voice import cleanup refuses active imports and installs', async t => {
  const { dir } = make(t); let deletes = 0, importing = true
  const service = createVoiceService({ stateDir: dir,
    createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-cloud', import: importing ? { phase: '复制中' } : null }] }), deleteImportSource: async () => { deletes++; return { ok: true } } }),
    createInstaller: () => ({ status: () => importing ? null : { phase: '下载中' } }),
  })
  await assert.rejects(service.deleteImportSource('voice-cloud', '/source'), /正在导入/)
  importing = false
  await assert.rejects(service.deleteImportSource('voice-cloud', '/source'), /正在安装/)
  assert.equal(deletes, 0)
})

test('voice HTTP cloud configuration cannot change a pack while it is being imported', async t => {
  let writes = 0, reads = 0, importing = true, handler
  const { service } = make(t, {
    createPacks: () => ({
      list: async () => ({ packs: [{ id: 'voice-cloud', import: importing ? { phase: '切换安装目录' } : null }] }),
      cloudConfig: async () => { writes++; return { ok: true } },
      readCloudConfig: async () => { reads++; return { ok: true } },
    }),
    createInstaller: () => ({ status: () => null }),
  })
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: () => null }) }, service)
  async function request(method = 'POST') {
    const req = Readable.from(method === 'POST' ? [JSON.stringify({ id: 'voice-cloud', appId: 'fixture' })] : [])
    Object.assign(req, { url: '/dsh-voice/api/voice/packs/cloud-config', method, headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } })
    let status, body
    await handler(req, { writeHead: code => { status = code }, end: data => { body = JSON.parse(data) } })
    return { status, body }
  }
  const rejected = await request()
  assert.equal(rejected.status, 400)
  assert.match(rejected.body.error, /正在导入/)
  assert.equal(writes, 0)
  assert.equal((await request('GET')).status, 400)
  assert.equal(reads, 0)
  importing = false
  assert.equal((await request()).status, 200)
  assert.equal((await request('GET')).status, 200)
  assert.equal(reads, 1)
  assert.equal(writes, 1)
})

test('voice import cleanup refuses symbolic-link sources', async t => {
  const { dir } = make(t), listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const target = join(dir, 'packs/voice-cloud'), realSource = join(dir, 'real-source'), link = join(dir, 'source-link')
  mkdirSync(target, { recursive: true }); mkdirSync(realSource)
  writeFileSync(join(target, 'config.toml'), 'current'); writeFileSync(join(realSource, 'config.toml'), 'original'); symlinkSync(realSource, link, 'dir')
  writeFileSync(join(dir, 'packs/installed.json'), JSON.stringify({ packs: { 'voice-cloud': { importSource: link } } }))
  await assert.rejects(createVoiceService({ stateDir: dir }).deleteImportSource('voice-cloud', link), /普通目录/)
  assert.equal(readFileSync(join(realSource, 'config.toml'), 'utf8'), 'original')
})

test('offline import accepts the project-local Python layout produced by online installation', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const source = join(dir, 'source', 'voice-cloud'), target = join(dir, 'packs', 'voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts', 'runtime/python']) mkdirSync(join(source, name), { recursive: true })
  for (const name of ['.venv/Scripts/python.exe', 'runtime/python/python.exe']) writeFileSync(join(source, name), 'fixture')
  writeFileSync(join(source, '.venv/pyvenv.cfg'), `home = ${source}/runtime/python\nexecutable = ${source}/runtime/python/python.exe\n`)
  writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
  writeFileSync(join(source, 'config.toml'), `[server]\nport = 8767\n[engine]\nprimary = "cloud"\n[ffmpeg]\npath = "${source}/.venv/ffmpeg.exe"\n`)
  const service = createVoiceService({ stateDir: dir })
  await service.packs.startImport('voice-cloud', { sourceDir: source, allowUnverified: true })
  let item
  for (let i = 0; i < 100; i++) {
    item = (await service.list()).packs.find(pack => pack.id === 'voice-cloud')
    if (['完成', '失败'].includes(item.import?.phase)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(item.import?.phase, '完成', item.import?.error)
  assert.ok(readFileSync(join(target, '.venv/pyvenv.cfg'), 'utf8').includes(`${target}/runtime/python`))
  assert.ok(readFileSync(join(target, 'config.toml'), 'utf8').includes(`${target}/.venv/ffmpeg.exe`))
  assert.ok(readFileSync(join(source, '.venv/pyvenv.cfg'), 'utf8').includes(`${source}/runtime/python`))
})

test('portable local voice packs relocate both environments to their shared Python runtime', async t => {
  const { dir } = make(t)
  mkdirSync(join(dir, 'runtime/python'), { recursive: true })
  writeFileSync(join(dir, 'runtime/python/python.exe'), 'runtime')
  for (const venv of ['.venv', '.venv-gsv']) {
    mkdirSync(join(dir, venv))
    writeFileSync(join(dir, venv, 'pyvenv.cfg'), 'home = C:/old/python\n')
  }
  await rewriteVenvConfig(dir, { versions: ['313', '312'] })
  for (const venv of ['.venv', '.venv-gsv']) assert.ok(readFileSync(join(dir, venv, 'pyvenv.cfg'), 'utf8').includes(join(dir, 'runtime/python').replaceAll('\\', '/')))
})

test('a bundled voice pack repairs its paths after moving the project directory', async t => {
  const { repairMovedVoicePack } = await import('../plugins/voice/src/voice-pack-import.js')
  const { dir } = make(t), pack = join(dir, 'moved-project', 'voice-cloud'), old = join(dir, 'previous-project', 'voice-cloud')
  mkdirSync(join(pack, '.venv'), { recursive: true }); mkdirSync(join(pack, 'runtime/python'), { recursive: true })
  writeFileSync(join(pack, 'runtime/python/python.exe'), 'runtime')
  writeFileSync(join(pack, '.venv/pyvenv.cfg'), `home = ${old}/runtime/python\nexecutable = ${old}/runtime/python/python.exe\n`)
  writeFileSync(join(pack, 'config.toml'), `[ffmpeg]\npath = "${old}/.venv/ffmpeg.exe"\n`)
  await repairMovedVoicePack(pack, 'voice-cloud')
  assert.match(readFileSync(join(pack, '.venv/pyvenv.cfg'), 'utf8'), new RegExp(pack))
  assert.ok(readFileSync(join(pack, 'config.toml'), 'utf8').includes(`${pack}/.venv/ffmpeg.exe`))
  assert.equal(await repairMovedVoicePack(pack, 'voice-cloud'), false)
})

test('moving a voice pack never rewrites a virtual environment backed by an external Python', async t => {
  const { repairMovedVoicePack } = await import('../plugins/voice/src/voice-pack-import.js')
  const { dir } = make(t), pack = join(dir, 'pack')
  mkdirSync(join(pack, '.venv'), { recursive: true })
  const original = 'home = /outside/python\n'
  writeFileSync(join(pack, '.venv/pyvenv.cfg'), original)
  writeFileSync(join(pack, 'config.toml'), '[ffmpeg]\npath = "/outside/ffmpeg"\n')
  assert.equal(await repairMovedVoicePack(pack, 'voice-cloud'), false)
  assert.equal(readFileSync(join(pack, '.venv/pyvenv.cfg'), 'utf8'), original)
})

test('a failed offline voice import restores the previous installed pack', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const target = join(dir, 'packs/voice-cloud'); mkdirSync(target, { recursive: true })
  const original = '[server]\nport = 8767\n[engine]\nprimary = "cloud"\ncloud_access_key = "old-secret"\n'
  writeFileSync(join(target, 'config.toml'), original)
  writeFileSync(join(target, 'old-data'), 'keep me')
  const source = join(dir, 'source/voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts']) mkdirSync(join(source, name), { recursive: true })
  writeFileSync(join(source, '.venv/Scripts/python.exe'), 'fixture')
  writeFileSync(join(source, 'voices/age12-cloud/voice.json'), '{}')
  writeFileSync(join(source, 'config.toml'), '[server]\nport = 8767\n[engine]\nprimary = "cloud"\n')
  let release, reached
  const paused = new Promise(resolve => { release = resolve }), rollingBack = new Promise(resolve => { reached = resolve })
  const rename = fs.promises.rename.bind(fs.promises)
  const mock = t.mock.method(fs.promises, 'rename', async (from, to) => {
    if (String(from).startsWith(`${target}.backup-`) && String(to) === target) { reached(); await paused }
    return rename(from, to)
  })
  t.after(() => { release(); mock.mock.restore() })
  const service = createVoiceService({ stateDir: dir })
  await service.packs.startImport('voice-cloud', { sourceDir: source, allowUnverified: true })
  await rollingBack
  assert.equal((await service.list()).packs.find(pack => pack.id === 'voice-cloud').import.phase, '回滚中')
  await assert.rejects(service.archive('voice-cloud'), /正在导入/)
  release()
  let item
  for (let i = 0; i < 100; i++) {
    item = (await service.list()).packs.find(pack => pack.id === 'voice-cloud')
    if (['完成', '失败'].includes(item.import?.phase)) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(item.import?.phase, '失败')
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), original)
  assert.equal(readFileSync(join(target, 'old-data'), 'utf8'), 'keep me')
})

test('offline import refuses a source inside the installed pack instead of changing it in place', async t => {
  const { dir } = make(t)
  const listener = createServer(); await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve))
  const port = listener.address().port; await new Promise(resolve => listener.close(resolve))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port }] } }))
  const target = join(dir, 'packs/voice-cloud')
  for (const name of ['voxd', 'models', 'voices/age12-cloud', '.venv/Scripts']) mkdirSync(join(target, name), { recursive: true })
  writeFileSync(join(target, '.venv/Scripts/python.exe'), 'fixture')
  writeFileSync(join(target, 'voices/age12-cloud/voice.json'), '{}')
  const config = '[server]\nport = 8767\n[engine]\nprimary = "cloud"\n'
  writeFileSync(join(target, 'config.toml'), config)
  const service = createVoiceService({ stateDir: dir })
  await assert.rejects(service.packs.startImport('voice-cloud', { sourceDir: target, allowUnverified: true }), /源目录.*安装目录/)
  mkdirSync(join(dir, 'alias'))
  symlinkSync(target, join(dir, 'alias/voice-cloud'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(service.packs.startImport('voice-cloud', { sourceDir: join(dir, 'alias/voice-cloud'), allowUnverified: true }), /源目录.*安装目录/)
  assert.equal(readFileSync(join(target, 'config.toml'), 'utf8'), config)
})

test('synthesis talks to the selected loopback engine and stores audio inside its own state directory', async (t) => {
  let target
  const { dir, service } = make(t, { fetchImpl: async (url) => {
    target = url
    return new Response(Buffer.alloc(100, 1), { status: 200, headers: { 'x-duration-ms': '10' } })
  } })
  const result = await service.synthesize({ text: '你好', baseUrl: 'http://127.0.0.1:8765' })
  assert.equal(target, 'http://127.0.0.1:8765/v1/speak/file')
  assert.ok(result.path.startsWith(join(dir, 'cache') + '/'))
  const updated = await service.synthesize({ text: '你好', baseUrl: 'http://127.0.0.1:8765', cacheVersion: 2 })
  assert.notEqual(updated.path, result.path)
  assert.throws(() => service.synthesize({ text: '你好', baseUrl: 'https://example.com' }), /loopback/i)
})

test('voice synthesis cancels an oversized streamed response before reading the rest', async t => {
  let pulled = 0, cancelled = false
  const { dir, service } = make(t, { fetchImpl: async () => new Response(new ReadableStream({
    pull(controller) { pulled++; if (pulled <= 80) controller.enqueue(new Uint8Array(1024 * 1024)); else controller.close() },
    cancel() { cancelled = true },
  }), { status: 200 }) })
  await assert.rejects(service.synthesize({ text: '测试流式音频' }), /音频过大/)
  assert.equal(cancelled, true)
  assert.ok(pulled < 30, `unexpected number of chunks consumed: ${pulled}`)
  assert.deepEqual(fs.readdirSync(join(dir, 'cache')), [])
})

test('voice synthesis refuses HTTP redirects without forwarding text to the new endpoint', async t => {
  let forwarded = 0
  const destination = createHttpServer((req, res) => { forwarded++; res.writeHead(200); res.end(Buffer.alloc(100, 1)) })
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve))
  const source = createHttpServer((req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${destination.address().port}/captured` }); res.end() })
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve))
  t.after(() => Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => destination.close(resolve))]))
  const { service } = make(t)
  await assert.rejects(service.synthesize({ text: '不应转发的文本', baseUrl: `http://127.0.0.1:${source.address().port}` }))
  assert.equal(forwarded, 0)
})

test('voice pack test refuses redirects without forwarding text', async t => {
  let forwarded = 0
  const destination = createHttpServer((req, res) => { forwarded++; res.writeHead(200); res.end(Buffer.alloc(100, 1)) })
  await new Promise(resolve => destination.listen(0, '127.0.0.1', resolve))
  const source = createHttpServer((req, res) => { res.writeHead(307, { location: `http://127.0.0.1:${destination.address().port}/captured` }); res.end() })
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve))
  t.after(() => Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => destination.close(resolve))]))
  const { dir } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port: source.address().port }] } }))
  await assert.rejects(createVoiceService({ stateDir: dir }).packs.test('voice-cloud', { text: '不应转发的文本' }))
  assert.equal(forwarded, 0)
})

test('voice pack synthesis test times out using the configured synthesis timeout', { timeout: 5000 }, async t => {
  const engine = createHttpServer(() => {})
  await new Promise(resolve => engine.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => { engine.closeAllConnections(); engine.close(resolve) }))
  const { dir } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voicePacks: { manifests: [{ id: 'voice-cloud', port: engine.address().port }] } }))
  const service = createVoiceService({ stateDir: dir })
  await service.saveRules({ ttsTimeoutMs: 50 })
  let timer
  const outcome = await Promise.race([service.testPack('voice-cloud').then(() => 'success', () => 'rejected'), new Promise(resolve => { timer = setTimeout(() => resolve('still waiting'), 1000) })])
  clearTimeout(timer)
  assert.equal(outcome, 'rejected')
})

test('voice synthesis rejects oversized cache files before reading them', async t => {
  const { ttsKey } = await import('../plugins/voice/src/voice-tts.js')
  const { dir, service } = make(t, { fetchImpl: async () => { throw new Error('must not fetch') } })
  const cache = join(dir, 'cache'); mkdirSync(cache)
  const key = ttsKey({ baseUrl: 'http://127.0.0.1:8765', text: '检查缓存', character: '', voice: '', style: null, cacheVersion: null })
  const file = join(cache, `${key}.wav`); writeFileSync(file, ''); fs.truncateSync(file, 21 * 1024 * 1024)
  await assert.rejects(service.synthesize({ text: '检查缓存' }), /缓存音频过大/)
  assert.equal(fs.statSync(file).size, 21 * 1024 * 1024)
})

test('voice preview uses the selected local route and writes only into the voice cache', async t => {
  let target
  const { dir, service } = make(t, { fetchImpl: async url => { target = url; return new Response(Buffer.alloc(100, 1), { status: 200 }) } })
  await service.saveRules({ endpoints: { cloud: 'http://127.0.0.1:9876' } })
  const result = await service.preview('voice-cloud', '试听内容')
  assert.equal(target, 'http://127.0.0.1:9876/v1/speak/file')
  assert.ok(result.path.startsWith(join(dir, 'cache') + '/'))
  await assert.rejects(service.preview('../unknown', '试听内容'), /未知语音包/)
})

test('previewing another route uses that engine default instead of the active route voice', async t => {
  const requests = []
  const { dir, service } = make(t, { fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body })
    if (url.includes(':8767') && (body.character || body.voice)) return new Response('{"detail":"unknown voice"}', { status: 400 })
    return new Response(Buffer.alloc(100, 1), { status: 200 })
  } })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'local', character: '本地专用音色', voice: '旧音色' } } }))
  await service.preview('voice-cloud', '云端试听')
  await service.preview('voice-local', '本地试听')
  assert.equal(requests[0].url, 'http://127.0.0.1:8767/v1/speak/file')
  assert.equal(requests[0].body.character, undefined)
  assert.equal(requests[0].body.voice, undefined)
  assert.equal(requests[1].body.character, '本地专用音色')
  assert.equal(requests[1].body.voice, undefined)
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).voice.tts.route, 'local')
})

test('local preview omits a cloud route legacy voice without changing ordinary synthesis', async t => {
  const requests = []
  const { dir, service } = make(t, { fetchImpl: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return new Response(Buffer.alloc(100, 1), { status: 200 })
  } })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'cloud', voice: '云端专用音色' } } }))
  await service.preview('voice-local', '本地试听')
  await service.synthesize({ text: '云端合成' })
  assert.equal(requests[0].url, 'http://127.0.0.1:8765/v1/speak/file')
  assert.equal(requests[0].body.character, undefined)
  assert.equal(requests[0].body.voice, undefined)
  assert.equal(requests[1].url, 'http://127.0.0.1:8767/v1/speak/file')
  assert.equal(requests[1].body.voice, '云端专用音色')
})

test('preview of an inactive route uses its saved mapping or legacy voice without changing configuration', async t => {
  const calls = []
  const { dir, service } = make(t, { fetchImpl: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return new Response(Buffer.alloc(100, 1)) } })
  const file = join(dir, 'config.json')
  const localActive = JSON.stringify({ voice: { tts: { route: 'local', character: '当前本地', routeVoiceSelections: { cloud: { character: '已存云端', voice: '旧云端' } } } } })
  writeFileSync(file, localActive)
  await service.preview('voice-cloud', '试听云端保存的映射')
  assert.equal(calls.at(-1).body.character, '已存云端')
  assert.equal(calls.at(-1).body.voice, undefined)
  assert.equal(readFileSync(file, 'utf8'), localActive)
  const cloudActive = JSON.stringify({ voice: { tts: { route: 'cloud', character: '当前云端', routeVoiceSelections: { local: { character: '', voice: '已存本地旧音色' } } } } })
  writeFileSync(file, cloudActive)
  await service.preview('voice-local', '试听本地保存的音色')
  assert.equal(calls.at(-1).body.character, undefined)
  assert.equal(calls.at(-1).body.voice, '已存本地旧音色')
  assert.equal(readFileSync(file, 'utf8'), cloudActive)
})

test('voice synthesis refuses a cache directory that is a symbolic link', async t => {
  const { dir, service } = make(t, { fetchImpl: async () => { throw new Error('must not fetch') } })
  mkdirSync(join(dir, 'elsewhere'))
  symlinkSync(join(dir, 'elsewhere'), join(dir, 'cache'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(service.synthesize({ text: '你好' }), /符号链接/)
})

test('activating an owned running voice pack updates the independent route without starting it again', async (t) => {
  let starts = 0
  const { service } = make(t, { createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-cloud' }] }), isOwnedRunning: async () => true, start: async () => { starts++; return { ok: true } } }) })
  assert.equal((await service.activate('voice-cloud')).route, 'cloud')
  assert.equal(starts, 0)
  assert.equal((await service.rules()).aiEnabled, true)
  assert.equal((await service.rules()).route, 'cloud')
  await assert.rejects(service.activate('unknown'), /未知语音包/)
})

test('activating a voice pack preserves the engine warmup warning', async t => {
  const { service } = make(t, { createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-local' }] }), isOwnedRunning: async () => false, start: async () => ({ ok: true, warning: '语音引擎仍在预热' }) }) })
  const result = await service.activate('voice-local')
  assert.equal(result.route, 'local')
  assert.equal(result.warning, '语音引擎仍在预热')
})

test('switching voice routes stops only the previous owned pack after saving the new route', async t => {
  const events = [], owned = new Set(['voice-local'])
  let service
  ;({ service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }, { id: 'external-pack' }] }),
    isOwnedRunning: async id => owned.has(id),
    start: async id => { events.push(`start:${id}`); owned.add(id); return { ok: true } },
    stop: async id => { events.push(`stop:${id}:${(await service.rules()).route}`); owned.delete(id); return { ok: true } },
  }) }))
  await service.saveRules({ route: 'local' })
  assert.equal((await service.activate('voice-cloud')).route, 'cloud')
  assert.deepEqual(events, ['start:voice-cloud', 'stop:voice-local:cloud'])
})

test('switching voice routes stops an owned previous pack still warming up', async t => {
  const events = []
  const { service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }),
    isOwnedRunning: async () => false,
    hasOwnedWorkers: id => id === 'voice-local',
    start: async id => { events.push(`start:${id}`); return { ok: true } },
    stop: async id => { events.push(`stop:${id}`); return { ok: true } },
  }) })
  await service.saveRules({ route: 'local' })
  const result = await service.activate('voice-cloud')
  assert.equal(result.route, 'cloud')
  assert.deepEqual(events, ['start:voice-cloud', 'stop:voice-local'])
})

test('switching voice packs keeps separate route voices and restores them on return', async t => {
  const requests = [], owned = new Set()
  const { dir, service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }),
    isOwnedRunning: async id => owned.has(id),
    start: async id => { owned.add(id); return { ok: true } },
    stop: async id => { owned.delete(id); return { ok: true } },
  }), fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body); requests.push({ url, body })
    if (url.includes(':8767') && body.character === '本地音色') return new Response('{"detail":"unknown voice"}', { status: 400 })
    return new Response(Buffer.alloc(100, 1))
  } })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'local', character: '本地音色', voice: '旧版本地音色' } } }))
  const switched = await service.activate('voice-cloud')
  assert.match(switched.warning, /默认音色.*原线路音色已保存/)
  await service.synthesize({ text: '云端默认音色' })
  assert.equal(requests.at(-1).body.character, undefined)
  assert.equal(requests.at(-1).body.voice, undefined)
  await service.saveRules({ ttsCharacter: '云端音色' })
  await service.activate('voice-local')
  await service.synthesize({ text: '恢复本地音色' })
  assert.equal(requests.at(-1).body.character, '本地音色')
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).voice.tts.voice, '旧版本地音色')
  await service.activate('voice-cloud')
  await service.synthesize({ text: '恢复云端音色' })
  assert.equal(requests.at(-1).body.character, '云端音色')
})

test('invalid saved route selections do not replace the current route or leave a new engine running', async t => {
  const stops = []
  const { dir, service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }),
    isOwnedRunning: async id => id === 'voice-local', start: async () => ({ ok: true }),
    stop: async id => { stops.push(id); return { ok: true } },
  }) })
  const file = join(dir, 'config.json'), original = JSON.stringify({ voice: { tts: { route: 'local', character: '保留音色', routeVoiceSelections: { cloud: '损坏' } } } })
  writeFileSync(file, original)
  await assert.rejects(service.activate('voice-cloud'), /音色记录无效/)
  assert.equal(readFileSync(file, 'utf8'), original)
  assert.deepEqual(stops, ['voice-cloud'])
})

test('changing routes through voice rules retains the previous route selection', async t => {
  const { dir, service } = make(t, { createPacks: () => ({
    list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }),
    isOwnedRunning: async () => true, stop: async () => ({ ok: true }),
  }) })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ voice: { tts: { route: 'local', character: '本地音色' } } }))
  await service.saveRules({ route: 'cloud', ttsCharacter: '云端音色' })
  await service.activate('voice-local')
  assert.equal((await service.rules()).ttsCharacter, '本地音色')
  await service.activate('voice-cloud')
  assert.equal((await service.rules()).ttsCharacter, '云端音色')
})

test('failed voice startup leaves the previous owned route running', async t => {
  let stops = 0
  const { service } = make(t, { createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }), isOwnedRunning: async id => id === 'voice-local', start: async () => ({ ok: false, error: '启动失败' }), stop: async () => { stops++; return { ok: true } } }) })
  await service.saveRules({ route: 'local' })
  assert.equal((await service.activate('voice-cloud')).ok, false)
  assert.equal(stops, 0)
  assert.equal((await service.rules()).route, 'local')
})

test('switching voice routes reports a previous pack that failed to stop', async t => {
  const { service } = make(t, { createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-local' }, { id: 'voice-cloud' }] }), isOwnedRunning: async id => id === 'voice-local', start: async () => ({ ok: true, warning: '预热中' }), stop: async () => ({ ok: false, error: '停止失败' }) }) })
  const result = await service.activate('voice-cloud')
  assert.equal(result.route, 'cloud')
  assert.match(result.warning, /预热中/)
  assert.match(result.warning, /voice-local.*停止失败/)
})

test('failed route save stops a newly started engine and preserves the previous route', async t => {
  let starts = 0, stops = 0
  const { dir, service } = make(t, { createPacks: () => ({ list: async () => ({ packs: [{ id: 'voice-cloud' }] }), isOwnedRunning: async () => false, start: async () => { starts++; return { ok: true } }, stop: async () => { stops++; return { ok: true } } }) })
  await service.saveRules({ route: 'local', aiEnabled: false })
  const file = join(dir, 'config.json'), before = readFileSync(file, 'utf8'), original = fs.renameSync
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) { if (destination === file) throw new Error('simulated route save failure'); return original.call(this, source, destination, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.activate('voice-cloud'), /simulated route save failure/)
  assert.equal(starts, 1); assert.equal(stops, 1)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal((await service.rules()).route, 'local')
  assert.equal((await service.rules()).aiEnabled, false)
})

test('voice management requires an authenticated local session', async (t) => {
  const { service } = make(t)
  let handler
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(url, authenticated) {
    const req = Readable.from([])
    Object.assign(req, { url, method: 'GET', headers: { host: '127.0.0.1:3082', ...(authenticated ? { cookie: 'x' } : {}) } })
    let status, data
    await handler(req, { writeHead: code => { status = code }, end: value => { data = JSON.parse(value) } })
    return { status, data }
  }
  assert.equal((await request('/dsh-voice/api/voice/packs', false)).status, 401)
  assert.equal((await request('/dsh-voice/api/voice/packs', true)).data.packs.length, 2)
  assert.equal((await request('/dsh-voice/api/voice/packs/cloud-config?id=..%2F..%2Foutside', true)).status, 400)
})

test('preview audio requires authentication and returns audio bytes', async () => {
  let handler, calls = 0
  const service = { previewAudio: async () => { calls++; return Buffer.from('sample-audio') } }
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function invoke(auth) {
    const req = Readable.from([JSON.stringify({ id: 'voice-local', text: '你好' })])
    Object.assign(req, { url: '/dsh-voice/api/voice/preview', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', ...(auth ? { cookie: 'x' } : {}) } })
    let status, headers, body
    await handler(req, { writeHead: (code, values) => { status = code; headers = values }, end: value => { body = value } })
    return { status, headers, body }
  }
  assert.equal((await invoke(false)).status, 401)
  assert.equal(calls, 0)
  const result = await invoke(true)
  assert.equal(result.headers['content-type'], 'audio/wav')
  assert.equal(result.body.toString(), 'sample-audio')
})

test('reference audio download requires authentication and returns the local sample', async () => {
  let handler, calls = 0
  const service = { packs: { sampleFile: async () => { calls++; return { buffer: Buffer.from('reference-audio'), name: 'reference.wav' } } } }
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function invoke(auth) {
    const req = Readable.from([])
    Object.assign(req, { url: '/dsh-voice/api/voice/packs/sample?id=voice-cloud', method: 'GET', headers: { host: '127.0.0.1:3082', ...(auth ? { cookie: 'x' } : {}) } })
    let status, headers, body
    await handler(req, { writeHead: (code, values) => { status = code; headers = values }, end: value => { body = value } })
    return { status, headers, body }
  }
  assert.equal((await invoke(false)).status, 401)
  assert.equal(calls, 0)
  const result = await invoke(true)
  assert.equal(result.status, 200)
  assert.equal(result.body.toString(), 'reference-audio')
  assert.match(result.headers['content-disposition'], /attachment/)
})

test('opening reference audio requires authentication and selects only the installed sample', async () => {
  let handler, opened = ''
  const service = { packs: { sampleFile: async id => { assert.equal(id, 'voice-cloud'); return { file: '/project/voicepack/reference.wav' } } } }
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service, { openSample: async file => { opened = file } })
  async function invoke(auth) {
    const req = Readable.from(['{}'])
    Object.assign(req, { url: '/dsh-voice/api/voice/packs/sample-open', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', ...(auth ? { cookie: 'x' } : {}) } })
    let status, body
    await handler(req, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } })
    return { status, body }
  }
  assert.equal((await invoke(false)).status, 401); assert.equal(opened, '')
  const result = await invoke(true)
  assert.equal(result.status, 200); assert.equal(opened, '/project/voicepack/reference.wav')
})

test('choosing an import folder uses the authenticated voice plugin endpoint', async () => {
  let handler, calls = 0
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, {}, { chooseDirectory: async () => { calls++; return { ok: true, path: 'C:\\语音包' } } })
  async function invoke(auth) {
    const req = Readable.from(['{}'])
    Object.assign(req, { url: '/dsh-voice/api/voice/packs/choose-import', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', ...(auth ? { cookie: 'x' } : {}) } })
    let status, body; await handler(req, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } })
    return { status, body }
  }
  assert.equal((await invoke(false)).status, 401); assert.equal(calls, 0)
  const result = await invoke(true)
  assert.equal(result.status, 200); assert.equal(result.body.path, 'C:\\语音包'); assert.equal(calls, 1)
})

test('Windows import picker uses project-local temporary files and cleans them on success, cancellation and failure', async t => {
  const { dir } = make(t)
  const select = async mode => chooseImportDirectory({ stateDir: dir, platform: 'win32', execFileImpl: (cmd, args, options, callback) => {
    assert.equal(cmd, 'powershell.exe'); assert.equal(options.timeout, 180000)
    const target = args.at(-1).match(/WriteAllText\('((?:[^']|'')+)'/)?.[1]?.replaceAll("''", "'")
    assert.ok(target?.startsWith(join(dir, 'tmp')))
    if (mode === 'selected') writeFileSync(target, 'C:\\语音包\\voice-cloud', 'utf8')
    queueMicrotask(() => callback(mode === 'failed' ? new Error('picker failed') : null))
  } })
  assert.equal((await select('selected')).path, 'C:\\语音包\\voice-cloud')
  assert.equal((await select('cancelled')).cancelled, true)
  await assert.rejects(select('failed'), /picker failed/)
  assert.deepEqual(fs.readdirSync(join(dir, 'tmp')), [])
  await assert.rejects(chooseImportDirectory({ stateDir: dir, platform: 'darwin' }), /手动填写/)
})

test('voice plugin shutdown cancels the open import picker and waits for cleanup', async t => {
  const { createImportPicker } = await import('../plugins/voice/src/import-picker.mjs')
  assert.equal(typeof createImportPicker, 'function')
  const { dir } = make(t)
  let started, finish, stopped = false
  const pending = new Promise(resolve => { started = resolve })
  const picker = createImportPicker({ stateDir: dir, platform: 'win32', execFileImpl: (_cmd, _args, options, callback) => {
    options.signal.addEventListener('abort', () => { finish = () => callback(new Error('cancelled')) }, { once: true }); started()
  } })
  const selection = picker.choose().catch(error => error)
  await pending
  const closing = picker.dispose().then(() => { stopped = true })
  await Promise.resolve(); assert.equal(stopped, false)
  finish(); await closing; await selection
  assert.deepEqual(fs.readdirSync(join(dir, 'tmp')), [])
  await assert.rejects(picker.choose(), /关闭/)
})

test('voice picker shutdown waits for the real child close after abort callback', async t => {
  const { createImportPicker } = await import('../plugins/voice/src/import-picker.mjs')
  const { execFile } = await import('node:child_process')
  const { dir } = make(t)
  let child, ready
  const started = new Promise(resolve => { ready = resolve })
  const picker = createImportPicker({ stateDir: dir, platform: 'win32', execFileImpl: (_cmd, _args, options, callback) => {
    child = execFile(process.execPath, ['-e', "process.on('SIGTERM',()=>setTimeout(()=>process.exit(0),150)); console.log('ready'); setInterval(()=>{},1000)"], options, callback)
    child.stdout.once('data', ready)
    return child
  } })
  const selection = picker.choose().catch(error => error)
  await started
  let closed = false
  child.once('close', () => { closed = true })
  await picker.dispose()
  assert.equal(closed, true, 'shutdown resolved before picker process closed')
  await selection
  assert.deepEqual(fs.readdirSync(join(dir, 'tmp')), [])
})

test('voice picker shutdown reports failed temporary directory cleanup', async t => {
  const { createImportPicker } = await import('../plugins/voice/src/import-picker.mjs')
  const { dir } = make(t)
  let ready
  const started = new Promise(resolve => { ready = resolve })
  const picker = createImportPicker({ stateDir: dir, platform: 'win32', execFileImpl: (_cmd, _args, options, callback) => {
    options.signal.addEventListener('abort', () => { const error = new Error('cancelled'); error.name = 'AbortError'; callback(error) }, { once: true })
    ready()
  } })
  const selection = picker.choose().catch(error => error)
  await started
  const original = fs.promises.rm
  const mock = t.mock.method(fs.promises, 'rm', async function (path, ...args) {
    if (String(path).includes('voice-picker-')) throw new Error('simulated cleanup failure')
    return original.call(this, path, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(picker.dispose(), /cleanup failure/)
  assert.match((await selection).message, /cleanup failure/)
})


test('reference audio location uses native file managers and reports launch errors', async () => {
  for (const [platform, command, args] of [['win32', 'explorer.exe', ['/select,', '/project/reference.wav']], ['darwin', 'open', ['-R', '/project/reference.wav']], ['linux', 'xdg-open', ['/project']]]) {
    let detached = false
    await openSampleLocation('/project/reference.wav', { platform, spawnImpl: (actual, actualArgs) => {
      assert.equal(actual, command); assert.deepEqual(actualArgs, args)
      const child = new EventEmitter(); child.unref = () => { detached = true }; queueMicrotask(() => child.emit('spawn')); return child
    } })
    assert.equal(detached, true)
  }
  await assert.rejects(openSampleLocation('/project/reference.wav', { platform: 'darwin', spawnImpl: () => {
    const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit('error', new Error('launch failed'))); return child
  } }), /launch failed/)
})

test('online voice install endpoints require an authenticated local session', async () => {
  let handler, calls = 0
  const service = { install: async (id, options) => { calls++; assert.equal(id, 'voice-cloud'); assert.equal(options.mirror, 'ghfast'); return { ok: true } }, cancelInstall: () => ({ ok: true }) }
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function invoke(auth) {
    const req = Readable.from([JSON.stringify({ id: 'voice-cloud', mirror: 'ghfast' })])
    Object.assign(req, { url: '/dsh-voice/api/voice/packs/install', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', ...(auth ? { cookie: 'x' } : {}) } })
    let status, body
    await handler(req, { writeHead: code => { status = code }, end: value => { body = JSON.parse(value) } })
    return { status, body }
  }
  assert.equal((await invoke(false)).status, 401)
  assert.equal(calls, 0)
  assert.equal((await invoke(true)).status, 200)
  assert.equal(calls, 1)
})

test('voice import cleanup endpoints require an authenticated same-origin JSON request', async () => {
  let handler, calls = 0
  const service = { deleteImportSource: async (id, path) => { calls++; assert.equal(id, 'voice-cloud'); assert.equal(path, '/source'); return { ok: true } }, deleteImportBackup: async () => { calls++; return { ok: true } } }
  registerVoiceHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function invoke(path, headers = {}) {
    const req = Readable.from([JSON.stringify({ id: 'voice-cloud', sourceDir: '/source', backupDir: '/backup' })])
    Object.assign(req, { url: `/dsh-voice/api/voice/packs/${path}`, method: 'POST', headers: { host: '127.0.0.1:3082', ...headers } })
    let status; await handler(req, { writeHead: code => { status = code }, end() {} }); return status
  }
  assert.equal(await invoke('import-delete-source', { 'content-type': 'application/json' }), 401)
  assert.equal(await invoke('import-delete-source', { cookie: 'x', origin: 'https://example.com', 'content-type': 'application/json' }), 403)
  assert.equal(await invoke('import-delete-source', { cookie: 'x' }), 415)
  assert.equal(await invoke('import-delete-source', { cookie: 'x', 'content-type': 'application/json' }), 200)
  assert.equal(await invoke('import-delete-backup', { cookie: 'x', 'content-type': 'application/json' }), 200)
  assert.equal(calls, 2)
})
