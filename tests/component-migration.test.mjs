import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { migrateComponents } from '../scripts/lib/component-migration.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createBiliDynamicsSync } from '../plugins/surfcore/src/bili-dynamics.js'
import { createBiliShareScheduler } from '../plugins/surfcore/src/bili-share-scheduler.js'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

function fixture(t) {
  const parent = resolve('.artifacts/test-tmp')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'component-migration-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const put = (name, value) => {
    const file = join(root, name)
    mkdirSync(join(file, '..'), { recursive: true })
    writeFileSync(file, value)
  }
  return { root, put }
}

test('migration backs up sources and copies the active role memory and voice packs without merging other roles', () => {
  const { root, put } = fixture({ after: () => {} })
  try {
    put('.artifacts/dsh-home/surfcore/characters/current.json', JSON.stringify({ id: 'active' }))
    put('.artifacts/dsh-home/surfcore/characters/active/memory/memory-card.json', '{"records":[1]}')
    put('.artifacts/dsh-home/surfcore/characters/other/memory/memory-card.json', '{"records":[2]}')
    put('plugins/surfcore/state/voice-packs/voice-local/config.toml', 'local config')
    put('plugins/surfcore/audio/example.wav', 'audio data')
    put('.artifacts/dsh-home/surfcore/config.json', JSON.stringify({ memoryCard: { enabled: false }, socialV2: { voice: { tts: { enabled: true } } } }))
    const result = migrateComponents(root)
    assert.equal(readFileSync(join(root, '.artifacts/dsh-home/memory/data/memory-card.json'), 'utf8'), '{"records":[1]}')
    assert.equal(readFileSync(join(root, '.artifacts/dsh-home/voice/packs/voice-local/config.toml'), 'utf8'), 'local config')
    assert.equal(readFileSync(join(root, '.artifacts/dsh-home/voice/audio/example.wav'), 'utf8'), 'audio data')
    assert.ok(existsSync(join(result.backup, '.artifacts/dsh-home/surfcore/characters/other/memory/memory-card.json')))
    assert.equal(JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/memory/config.json'))).memoryCard.enabled, false)
    assert.equal(JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json'))).voice.tts.enabled, true)
    assert.equal(migrateComponents(root).alreadyMigrated, true)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('migration preserves the old Bilibili refresh interval without enabling automatic refresh', t => {
  const { root, put } = fixture(t)
  put('plugins/surfcore/config.json', JSON.stringify({ biliBridge: { memory: { enabled: true, refreshIntervalMs: 60000 } } }))
  migrateComponents(root)
  const config = JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/memory/config.json'), 'utf8'))
  assert.equal(config.biliSync.intervalMs, 60000)
  assert.equal(config.biliSync.enabled, false)
})

test('migration uses the QQ bridge voice configuration and library when unified settings conflict', t => {
  const { root, put } = fixture(t)
  put('plugins/surfcore/config.json', JSON.stringify({ socialV2: { voice: { enabled: true, dir: 'active-audio', tts: { route: 'cloud' } } } }))
  put('.artifacts/dsh-home/surfcore/config.json', JSON.stringify({ socialV2: { voice: { enabled: false, dir: 'stale-audio', tts: { route: 'local' } } } }))
  put('plugins/surfcore/active-audio/real.wav', 'active')
  put('plugins/surfcore/stale-audio/old.wav', 'stale')
  migrateComponents(root)
  const voice = JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json'), 'utf8')).voice
  assert.equal(voice.enabled, true)
  assert.equal(voice.tts.route, 'cloud')
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/voice/audio/real.wav'), 'utf8'), 'active')
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/voice/audio/old.wav')), false)
})

test('migration keeps QQ voice defaults when its config omits voice settings', t => {
  const { root, put } = fixture(t)
  put('plugins/surfcore/config.json', '{}')
  put('.artifacts/dsh-home/surfcore/config.json', JSON.stringify({ socialV2: { voice: { enabled: true, dir: 'stale-audio' } } }))
  put('plugins/surfcore/audio/default.wav', 'default library')
  migrateComponents(root)
  const voice = JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json'), 'utf8')).voice
  assert.notEqual(voice.enabled, true)
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/voice/audio/default.wav'), 'utf8'), 'default library')
})

test('migration uses legacy memory when no role exists and leaves existing destinations untouched', (t) => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/memory/memory-card.json', '{"records":[]}')
  put('.artifacts/dsh-home/voice/existing', 'do not overwrite')
  assert.throws(() => migrateComponents(root), /destination.*exists/i)
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/voice/existing'), 'utf8'), 'do not overwrite')
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory')), false)
  rmSync(join(root, '.artifacts/dsh-home/voice'), { recursive: true })
  migrateComponents(root)
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/memory/data/memory-card.json'), 'utf8'), '{"records":[]}')
})

test('migration refuses a symlink in source state without writing component destinations', (t) => {
  const { root, put } = fixture(t)
  put('outside.txt', 'outside')
  mkdirSync(join(root, 'plugins/surfcore/state'), { recursive: true })
  symlinkSync(join(root, 'outside.txt'), join(root, 'plugins/surfcore/state/link'))
  assert.throws(() => migrateComponents(root), /symlink/i)
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory')), false)
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/voice')), false)
})

test('migration carries platform memory and backups custom in-project voice packs', (t) => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/bili-memory.json', '{"entries":[1]}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/watch-history.jsonl', '{"bvid":"BV123"}\n')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/bili-share-history.json', '{"used":{"a":1}}')
  put('plugins/surfcore/config.json', JSON.stringify({ voicePacks: { dir: '../../custom-packs' } }))
  put('custom-packs/voice-local/config.toml', 'settings')
  const result = migrateComponents(root)
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/memory/data/bili-memory.json'), 'utf8'), '{"entries":[1]}')
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/memory/data/bili-share-history.json'), 'utf8'), '{"used":{"a":1}}')
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/surfcore/bili/watch-history.jsonl'), 'utf8'), '{"bvid":"BV123"}\n')
  assert.equal(readFileSync(join(result.backup, 'custom-packs/voice-local/config.toml'), 'utf8'), 'settings')
  const config = JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json')))
  assert.equal(config.voicePacks.dir, undefined)
})

test('migration retains Bilibili share and dynamics cursors for the QQ bridge', t => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  for (const [name, content] of [['bili-share-state.json', '{"lastSlot":"slot"}'], ['bili-dynamics-state.json', '{"baselineAt":123,"seen":{"42":"old"}}'], ['bili-dynamics-cache.json', '{"items":[]}']]) {
    put(`.artifacts/dsh-home/surfcore/characters/active/bili/${name}`, content)
  }
  migrateComponents(root)
  assert.equal(JSON.parse(readFileSync(join(root, 'plugins/surfcore/state/bili-share-state.json'))).lastSlot, 'slot')
  assert.equal(JSON.parse(readFileSync(join(root, 'plugins/surfcore/state/bili-dynamics-state.json'))).baselineAt, 123)
  assert.deepEqual(JSON.parse(readFileSync(join(root, 'plugins/surfcore/state/bili-dynamics-cache.json'))).items, [])
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory/data/bili-dynamics-cache.json')), true)
  const stateDir = join(root, 'plugins/surfcore/state')
  assert.equal(createBiliDynamicsSync({ stateDir }).status().seen, 1)
  assert.equal(createBiliShareScheduler({ stateDir, memory: {}, deliverPrompt: async () => {} }).status().lastSlot, 'slot')
})

test('migration refuses conflicting existing QQ bridge Bilibili state', t => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/bili-share-state.json', '{"lastSlot":"old"}')
  put('plugins/surfcore/state/bili-share-state.json', '{"lastSlot":"new"}')
  assert.throws(() => migrateComponents(root), /QQ bridge state conflict/)
  assert.equal(JSON.parse(readFileSync(join(root, 'plugins/surfcore/state/bili-share-state.json'))).lastSlot, 'new')
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory')), false)
})

test('rerunning completed migration restores missing QQ bridge Bilibili cursors without replacing newer ones', t => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/bili-share-state.json', '{"lastSlot":"old"}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/bili-dynamics-state.json', '{"baselineAt":123}')
  migrateComponents(root)
  put('plugins/surfcore/state/bili-share-state.json', '{"lastSlot":"new"}')
  rmSync(join(root, 'plugins/surfcore/state/bili-dynamics-state.json'), { force: true })
  migrateComponents(root)
  assert.equal(JSON.parse(readFileSync(join(root, 'plugins/surfcore/state/bili-share-state.json'))).lastSlot, 'new')
  assert.equal(JSON.parse(readFileSync(join(root, 'plugins/surfcore/state/bili-dynamics-state.json'))).baselineAt, 123)
})

test('migrated Bilibili watch history combines platform records with independent memory through the real loader', t => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/watch-history.jsonl', JSON.stringify({ bvid: 'BV1234567890', title: '观看记录', at: '2026-10-01T00:00:00Z', mode: 'full' }) + '\n')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/bili-memory.json', JSON.stringify({ entries: [{ type: 'video', bvid: 'BVabcdefghij', title: '旧记忆视频', date: '2026-09-01' }] }))
  migrateComponents(root)
  const moduleUrl = pathToFileURL(resolve('plugins/surfcore/plugins/surfcore/tools/lib/watch-history.mjs')).href
  const program = `import { readWatchHistory } from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(readWatchHistory().items));`
  const output = execFileSync(process.execPath, ['--import', resolve('scripts/surfcore-loader.mjs'), '--input-type=module', '-e', program], {
    env: { ...process.env, DSH_HOME: join(root, '.artifacts/dsh-home'), SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1' }, encoding: 'utf8',
  })
  const items = JSON.parse(output)
  assert.ok(items.some(item => item.bvid === 'BV1234567890' && item.mode === 'full'))
  assert.ok(items.some(item => item.bvid === 'BVabcdefghij' && item.backfilled === true))
})

test('migration refuses to replace an existing conflicting platform state file', (t) => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  put('.artifacts/dsh-home/surfcore/characters/active/bili/quota.json', '{"count":1}')
  put('.artifacts/dsh-home/surfcore/bili/quota.json', '{"count":2}')
  assert.throws(() => migrateComponents(root), /conflict/i)
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/surfcore/bili/quota.json'), 'utf8'), '{"count":2}')
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory')), false)
})

test('migration relocates bundled voice runtimes and ffmpeg paths while preserving the original backup', t => {
  const { root, put } = fixture(t)
  const old = join(root, 'plugins/surfcore/state/voice-packs/voice-local').replaceAll('\\', '/')
  const dest = join(root, '.artifacts/dsh-home/voice/packs/voice-local').replaceAll('\\', '/')
  const config = `[ffmpeg]\npath = "${old}/.venv/Lib/site-packages/imageio_ffmpeg/ffmpeg.exe"\n`
  put('plugins/surfcore/state/voice-packs/voice-local/config.toml', config)
  for (const [venv, ver] of [['.venv', '313'], ['.venv-gsv', '312']]) {
    put(`plugins/surfcore/state/voice-packs/voice-local/runtime/python${ver}/python.exe`, 'runtime')
    put(`plugins/surfcore/state/voice-packs/voice-local/${venv}/pyvenv.cfg`, `home = ${old}/runtime/python${ver}\nexecutable = ${old}/runtime/python${ver}/python.exe\n`)
  }
  const result = migrateComponents(root)
  for (const [venv, ver] of [['.venv', '313'], ['.venv-gsv', '312']]) {
    const cfg = readFileSync(join(dest, venv, 'pyvenv.cfg'), 'utf8')
    assert.match(cfg, new RegExp(`home = .*/runtime/python${ver}`))
    assert.ok(cfg.includes(dest)); assert.equal(cfg.includes(old), false)
  }
  assert.ok(readFileSync(join(dest, 'config.toml'), 'utf8').includes(dest))
  assert.equal(readFileSync(join(result.backup, 'plugins/surfcore/state/voice-packs/voice-local/config.toml'), 'utf8'), config)
  assert.equal(readFileSync(join(root, 'plugins/surfcore/state/voice-packs/voice-local/config.toml'), 'utf8'), config)
})

test('migration relocates voice rule tool paths inside the copied voice packs', t => {
  const { root, put } = fixture(t)
  const source = join(root, 'plugins/surfcore')
  const oldFfmpeg = join(source, 'state/voice-packs/voice-local/bin/ffmpeg')
  put('plugins/surfcore/config.json', JSON.stringify({ socialV2: { voice: { ffmpegPath: oldFfmpeg, ffprobePath: 'state/voice-packs/voice-local/bin/ffprobe' } } }))
  put('plugins/surfcore/state/voice-packs/voice-local/bin/ffmpeg', 'ffmpeg fixture')
  put('plugins/surfcore/state/voice-packs/voice-local/bin/ffprobe', 'ffprobe fixture')
  migrateComponents(root)
  const voice = JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json'), 'utf8')).voice
  rmSync(join(source, 'state/voice-packs'), { recursive: true })
  assert.equal(readFileSync(resolve(source, voice.ffmpegPath), 'utf8'), 'ffmpeg fixture')
  assert.equal(readFileSync(resolve(source, voice.ffprobePath), 'utf8'), 'ffprobe fixture')
  assert.equal(voice.ffmpegPath.startsWith(root), false, 'path remains portable when the project moves')
})

test('migration preserves voice rule tool paths outside the copied packs', t => {
  const { root, put } = fixture(t)
  put('plugins/surfcore/config.json', JSON.stringify({ socialV2: { voice: { ffmpegPath: 'bin/ffmpeg', ffprobePath: '/custom/ffprobe' } } }))
  put('plugins/surfcore/bin/ffmpeg', 'fixture')
  migrateComponents(root)
  const voice = JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json'), 'utf8')).voice
  assert.equal(voice.ffmpegPath, 'bin/ffmpeg')
  assert.equal(voice.ffprobePath, '/custom/ffprobe')
})

test('migration stops without publishing when a bundled Python environment cannot be relocated safely', t => {
  const { root, put } = fixture(t)
  put('plugins/surfcore/state/voice-packs/voice-cloud/runtime/python313/python.exe', 'runtime')
  put('plugins/surfcore/state/voice-packs/voice-cloud/.venv/pyvenv.cfg', 'broken = true\n')
  assert.throws(() => migrateComponents(root), /no home field/)
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/voice')), false)
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory')), false)
  assert.equal(readFileSync(join(root, 'plugins/surfcore/state/voice-packs/voice-cloud/.venv/pyvenv.cfg'), 'utf8'), 'broken = true\n')
})

test('migration leaves a Python environment without a bundled runtime unchanged', t => {
  const { root, put } = fixture(t)
  const cfg = 'home = /external/runtime\nexecutable = /external/runtime/python.exe\n'
  put('plugins/surfcore/state/voice-packs/voice-cloud/.venv/pyvenv.cfg', cfg)
  migrateComponents(root)
  assert.equal(readFileSync(join(root, '.artifacts/dsh-home/voice/packs/voice-cloud/.venv/pyvenv.cfg'), 'utf8'), cfg)
})

test('legacy card backups remain available for explicit recovery without importing full archive backups', async t => {
  const { root, put } = fixture(t)
  const old = '.artifacts/dsh-home/surfcore/backups/'
  put(`${old}memory-card-2026-10-01T12-00-00-000Z.json`, '{"records":[]}')
  put(`${old}memory-card-full-stats-2026-10-01T12-00-00-000Z.json`, '{"count":1}')
  migrateComponents(root)
  const service = createMemoryService({ stateDir: join(root, '.artifacts/dsh-home/memory') })
  const backups = await service.backups()
  assert.equal(backups.length, 1)
  assert.match(backups[0], /^memory-card-legacy-unattributed-/)
  await service.restore(backups[0])
  assert.deepEqual((await service.snapshot()).records, [])
  assert.equal(readFileSync(join(root, old, 'memory-card-2026-10-01T12-00-00-000Z.json'), 'utf8'), '{"records":[]}')
})

test('legacy card backups can be added to an already migrated project idempotently', async t => {
  const { root, put } = fixture(t)
  migrateComponents(root)
  put('.artifacts/dsh-home/surfcore/backups/memory-card-before-restore-2026.json', '{"records":[]}')
  migrateComponents(root)
  migrateComponents(root)
  const service = createMemoryService({ stateDir: join(root, '.artifacts/dsh-home/memory') })
  assert.equal((await service.backups()).length, 1)
})

test('migration copies public feed and legacy session inputs into the memory inbox and records verified sources', t => {
  const { root, put } = fixture(t)
  const feed = '{"id":"public-1"}\n', sessions = '{"sessions":{}}', alignments = '{"aliases":{}}'
  put('.artifacts/dsh-home/surfcore/qq-public-feed.jsonl', feed)
  put('plugins/surfcore/state/social-v2.json', sessions)
  put('.artifacts/dsh-home/surfcore/alignments.json', alignments)
  put('plugins/surfcore/config.json', JSON.stringify({ socialV2: { voice: { enabled: true } } }))
  const result = migrateComponents(root)
  const inbox = join(root, '.artifacts/dsh-home/memory/inbox')
  assert.equal(readFileSync(join(inbox, 'qq-public-feed.jsonl'), 'utf8'), feed)
  assert.equal(readFileSync(join(inbox, 'social-v2.json'), 'utf8'), sessions)
  assert.equal(readFileSync(join(inbox, 'alignments.json'), 'utf8'), alignments)
  assert.equal(JSON.parse(readFileSync(join(root, '.artifacts/dsh-home/voice/config.json'))).voice.dir, undefined)
  const markerFile = join(root, '.artifacts/dsh-home/memory/migration.json'), markerText = readFileSync(markerFile, 'utf8')
  const marker = JSON.parse(markerText)
  assert.equal(marker.version, 1)
  assert.equal(marker.backup, result.backup)
  assert.ok(Date.parse(marker.completedAt))
  for (const [path, content] of [
    ['.artifacts/dsh-home/surfcore/qq-public-feed.jsonl', feed],
    ['plugins/surfcore/state/social-v2.json', sessions],
    ['.artifacts/dsh-home/surfcore/alignments.json', alignments],
  ]) {
    const entry = marker.sources.find(item => item.path === path)
    assert.equal(entry.sha256, createHash('sha256').update(content).digest('hex'))
  }
  const manifest = JSON.parse(readFileSync(join(result.backup, 'manifest.json'), 'utf8'))
  for (const row of manifest.files) {
    assert.equal(row.sha256, createHash('sha256').update(readFileSync(join(root, row.path))).digest('hex'), row.path)
  }
  assert.equal(migrateComponents(root).alreadyMigrated, true)
  assert.equal(readFileSync(markerFile, 'utf8'), markerText)
})

test('migration relocates voice pack manifest URLs and keeps remote URLs untouched', t => {
  const { root, put } = fixture(t)
  put('plugins/surfcore/config.json', JSON.stringify({ voicePacks: { manifests: [
    { id: 'local', url: 'state/voice-packs/voice-local' },
    { id: 'audio', url: 'audio' },
    { id: 'remote', url: 'https://example.invalid/pack.zip' },
    { id: 'outside', url: '/custom/pack.zip' },
  ] } }))
  put('plugins/surfcore/state/voice-packs/voice-local/config.toml', 'settings')
  migrateComponents(root)
  const voice = join(root, '.artifacts/dsh-home/voice')
  const manifests = JSON.parse(readFileSync(join(voice, 'config.json'))).voicePacks.manifests
  assert.equal(manifests[0].url, join(voice, 'packs', 'voice-local'))
  assert.equal(manifests[1].url, join(voice, 'audio'))
  assert.equal(manifests[2].url, 'https://example.invalid/pack.zip')
  assert.equal(manifests[3].url, '/custom/pack.zip')
})

test('migration rejects corrupt source JSON without publishing component destinations', t => {
  const { root, put } = fixture(t)
  put('.artifacts/dsh-home/surfcore/characters/current.json', '{"id":"active"}')
  put('.artifacts/dsh-home/surfcore/config.json', '{broken')
  assert.throws(() => migrateComponents(root), /Invalid JSON in migration source/)
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/memory')), false)
  assert.equal(existsSync(join(root, '.artifacts/dsh-home/voice')), false)
})
