import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { registerMemoryHttp } from '../plugins/memory/src/http.mjs'
import { resolveBiliPaths } from '../plugins/memory/src/bili-api.mjs'
import { createBiliMemory } from '../plugins/memory/src/bili-memory.mjs'
import { createSessionMemoryStore } from '../plugins/memory/src/session-memory.mjs'
import { startMemoryMaintenance } from '../plugins/memory/src/maintenance.mjs'
import { addManualMemory, createEmptyCard, fullMemoryCardStatus, resolveMemoryCardPaths, scanFullRecords } from '../plugins/memory/src/card-engine.mjs'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

function make(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'memory-plugin-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: dir })
  service.sessions = createSessionMemoryStore({ stateDir: dir })
  return { dir, service }
}

test('manual maintenance skips a disabled memory card without changing it', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '需要保留的记忆', scope: 'qq' })
  await service.updateSettings({ enabled: false })
  const file = resolveMemoryCardPaths(join(dir, 'data')).json
  const before = readFileSync(file, 'utf8')
  const result = await service.action('maintain', { forceDecay: true })
  assert.equal(result.disabled, true)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('manual compaction respects its requested target ratio', async t => {
  const source = createEmptyCard()
  for (let i = 0; i < 24; i++) addManualMemory(source, { text: `公开内容${i}：${'记录'.repeat(120)}`, scope: 'bili', importance: 20 }, { maxChars: 2000, autoCompact: false })
  const outcomes = []
  for (const ratio of [0.9, 0.3]) {
    const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
    mkdirSync(paths.dir, { recursive: true })
    writeFileSync(paths.json, JSON.stringify(source))
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ memoryCard: { maxChars: 2000, autoCompact: false } }))
    outcomes.push(await service.action('compact', { targetRatio: ratio }))
  }
  assert.ok(outcomes[1].steps > outcomes[0].steps, `expected tighter ratio to compact further: ${outcomes.map(value => value.steps)}`)
})

test('memory status exposes saved alert and acknowledgement levels after a service restart', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '测试容量提醒的记忆', scope: 'qq' })
  const file = resolveMemoryCardPaths(join(dir, 'data')).json
  const card = JSON.parse(readFileSync(file, 'utf8'))
  card.alerts.level = 2
  writeFileSync(file, JSON.stringify(card))
  const before = await service.snapshot()
  assert.equal(before.status.alertLevel, 2)
  assert.equal(before.status.acknowledgedLevel, 0)
  await service.action('ack', { level: 2 })
  const after = await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(after.status.alertLevel, 2)
  assert.equal(after.status.acknowledgedLevel, 2)
})

test('manual acknowledgement and compaction retain their original timestamps and default level', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '记忆容量测试' })
  const file = resolveMemoryCardPaths(join(dir, 'data')).json
  const card = JSON.parse(readFileSync(file, 'utf8'))
  card.alerts.level = 2; card.updatedAt = '2000-01-01T00:00:00.000Z'; card.lastMaintenanceAt = '2000-01-01T00:00:00.000Z'
  writeFileSync(file, JSON.stringify(card))
  const started = Date.now()
  await service.action('ack')
  const acknowledged = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(acknowledged.alerts.acknowledgedLevel, 2)
  assert.ok(Date.parse(acknowledged.alerts.acknowledgedAt) >= started)
  assert.ok(Date.parse(acknowledged.updatedAt) >= started)
  await service.action('compact')
  const compacted = JSON.parse(readFileSync(file, 'utf8'))
  assert.ok(Date.parse(compacted.lastMaintenanceAt) >= started)
  assert.ok(Date.parse(compacted.updatedAt) >= started)
})

test('memory event journal is processed without loading the entire file at once', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'events.jsonl')
  const entries = Array.from({ length: 1000 }, (_, index) => ({ id: `event-${index}`, platform: 'qq', kind: 'private', text: `事件${index}`, at: '2026-11-01T01:00:00Z' }))
  writeFileSync(journal, entries.map(entry => JSON.stringify(entry)).join('\n') + '\n')
  writeFileSync(join(data, 'events-cursor.json'), JSON.stringify({ count: entries.length }))
  const original = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', function (file, ...args) { if (file === journal) throw new Error('whole journal read forbidden'); return original.call(this, file, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  assert.equal((await service.snapshot()).ok, true)
  const duplicate = await service.record(entries[500])
  assert.equal(duplicate.duplicate, true)
})

test('large journal validation yields to the event loop', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'events.jsonl')
  const entry = JSON.stringify({ id: 'old', platform: 'qq', kind: 'private', text: '测试事件', at: '2026-11-01T01:00:00Z' }) + '\n'
  writeFileSync(journal, entry.repeat(20000))
  writeFileSync(join(data, 'events-cursor.json'), JSON.stringify({ count: 20000 }))
  const original = fs.promises.open.bind(fs.promises); let yielded = false
  t.mock.method(fs.promises, 'open', async (file, ...args) => {
    const result = await original(file, ...args)
    if (file === journal) setImmediate(() => { yielded = true })
    return result
  })
  await service.snapshot()
  assert.equal(yielded, true)
})

test('validated event journals reuse their index and replay only newly appended bytes', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'events.jsonl')
  const events = Array.from({ length: 500 }, (_, index) => ({ id: `indexed-${index}`, platform: 'qq', kind: 'private', text: `旧事件${index}`, at: '2026-11-01T01:00:00Z' }))
  writeFileSync(journal, events.map(event => JSON.stringify(event)).join('\n') + '\n')
  writeFileSync(join(data, 'events-cursor.json'), JSON.stringify({ count: events.length }))
  await service.snapshot()
  const originalSize = fs.statSync(journal).size, starts = []
  const originalOpen = fs.promises.open.bind(fs.promises)
  t.mock.method(fs.promises, 'open', async (file, ...args) => {
    const handle = await originalOpen(file, ...args)
    if (file === journal) {
      const stream = handle.createReadStream.bind(handle)
      handle.createReadStream = options => { starts.push(options.start); return stream(options) }
    }
    return handle
  })
  await service.snapshot()
  assert.deepEqual(starts, [])
  const fresh = { id: 'new-event', platform: 'qq', kind: 'private', text: '新增事件', at: '2026-11-01T01:00:00Z' }
  assert.equal((await service.record(fresh)).duplicate, false)
  assert.ok(starts.length > 0)
  assert.ok(starts.every(start => start >= originalSize), `unexpected full journal scan: ${starts}`)
  assert.equal((await service.record(fresh)).duplicate, true)
})

test('event index rebuilds after external journal or cursor changes', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'events.jsonl'), cursor = join(data, 'events-cursor.json')
  const first = { id: 'one', platform: 'qq', kind: 'private', text: '第一条事件', at: '2026-11-01T01:00:00Z' }
  await service.record(first)
  const second = { id: 'two', platform: 'qq', kind: 'private', text: '外部追加事件', at: '2026-11-01T01:00:01Z' }
  fs.appendFileSync(journal, JSON.stringify(second) + '\n')
  await service.snapshot()
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).count, 2)
  assert.equal((await service.record(second)).duplicate, true)
  writeFileSync(cursor, '{"count":0}')
  await service.snapshot()
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).count, 2)
  fs.appendFileSync(journal, '{broken')
  await assert.rejects(service.snapshot(), /incomplete/)
})

test('event index distinguishes matching IDs from different platforms', async t => {
  const { service } = make(t)
  const event = { id: 'same-id', kind: 'private', text: '一条记录', at: '2026-11-01T01:00:00Z' }
  assert.equal((await service.record({ ...event, platform: 'qq' })).duplicate, false)
  assert.equal((await service.record({ ...event, platform: 'bili', kind: 'dynamic' })).duplicate, false)
  assert.equal((await service.record({ ...event, platform: 'qq' })).duplicate, true)
})

test('event index rebuilds if another writer appends during recording', async t => {
  const { dir, service } = make(t), journal = join(dir, 'data', 'events.jsonl')
  const first = { id: 'local', platform: 'qq', kind: 'private', text: '本地事件', at: '2026-11-01T01:00:00Z' }
  const external = { ...first, id: 'external', text: '并发事件' }
  const original = fs.appendFileSync; let injected = false
  const mock = t.mock.method(fs, 'appendFileSync', function (file, data, ...args) {
    const result = original.call(this, file, data, ...args)
    if (file === journal && !injected) { injected = true; original.call(this, file, JSON.stringify(external) + '\n', ...args) }
    return result
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await service.record(first)
  assert.equal(JSON.parse(readFileSync(join(dir, 'data', 'events-cursor.json'), 'utf8')).count, 2)
  assert.equal((await service.record(external)).duplicate, true)
  const restarted = createMemoryService({ stateDir: dir })
  assert.equal((await restarted.record(first)).duplicate, true)
})

test('damaged event journal is rejected before any pending record is applied', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'events.jsonl')
  const content = JSON.stringify({ id: 'good', platform: 'qq', kind: 'private', text: '不应部分写入', at: '2026-11-01T01:00:00Z' }) + '\n{broken\n'
  writeFileSync(file, content)
  await assert.rejects(service.snapshot())
  assert.equal(existsSync(join(data, 'memory-card.json')), false)
  assert.equal(existsSync(join(data, 'events-cursor.json')), false)
  assert.equal(readFileSync(file, 'utf8'), content)
})

test('a damaged event journal prevents importing legacy memory until it is repaired', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'events.jsonl'), legacy = join(data, 'memory-inbox.jsonl')
  const oldEvent = JSON.stringify({ id: 'legacy-1', at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '旧对话记忆' }) + '\n'
  writeFileSync(legacy, oldEvent)
  writeFileSync(journal, '{broken\n')
  await assert.rejects(service.snapshot())
  assert.equal(existsSync(join(data, 'memory-card.json')), false)
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
  assert.equal(readFileSync(legacy, 'utf8'), oldEvent)
  writeFileSync(journal, '')
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('旧对话记忆')))
})

test('chunked journal replay advances its cursor after each complete batch', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'events.jsonl')
  const events = Array.from({ length: 501 }, (_, index) => ({ id: `batch-${index}`, platform: 'qq', kind: 'private', isOwner: true, text: `批次记录${index}`, at: '2026-11-01T01:00:00Z' }))
  writeFileSync(journal, events.map(event => JSON.stringify(event)).join('\n') + '\n')
  await service.snapshot()
  assert.equal(JSON.parse(readFileSync(join(data, 'events-cursor.json'), 'utf8')).count, 501)
  assert.equal((await service.record(events[500])).duplicate, true)
  assert.equal(JSON.parse(readFileSync(join(data, 'events-cursor.json'), 'utf8')).count, 501)
})

test('event replay does not duplicate the archive after a card write fails', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const card = join(data, 'memory-card.json'), archive = join(data, 'memory-card-full.jsonl')
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.record({ id: 'journal-1', platform: 'qq', kind: 'private', isOwner: true, text: '正常事件记忆' }), /simulated card failure/)
  mock.mock.restore()
  await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(readFileSync(archive, 'utf8').trim().split('\n').length, 1)
  assert.equal(JSON.parse(readFileSync(join(data, 'events-cursor.json'), 'utf8')).count, 1)
})

test('event replay completes an interrupted cursor before newly appended events', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const cursor = join(data, 'events-cursor.json'), journal = join(data, 'events.jsonl'), archive = join(data, 'memory-card-full.jsonl')
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === cursor && !failed) { failed = true; throw new Error('simulated cursor failure') }
    return original.call(this, source, destination, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.record({ id: 'journal-1', platform: 'qq', kind: 'private', isOwner: true, text: '第一条正常事件' }), /simulated cursor failure/)
  mock.mock.restore(); syncBuiltinESMExports()
  fs.appendFileSync(journal, JSON.stringify({ id: 'journal-2', platform: 'qq', kind: 'private', isOwner: true, text: '恢复前追加的事件', at: '2026-11-01T01:00:00Z' }) + '\n')
  const result = await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).count, 2)
  assert.equal(readFileSync(archive, 'utf8').trim().split('\n').length, 2)
  assert.ok(result.records.some(record => record.text.includes('第一条正常事件')))
  assert.ok(result.records.some(record => record.text.includes('恢复前追加的事件')))
})

test('event replay preserves an incomplete archive and refuses recovery', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const archive = join(data, 'memory-card-full.jsonl')
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const original = fs.appendFileSync; let failed = false
  const mock = t.mock.method(fs, 'appendFileSync', function (file, content, ...args) {
    if (file === archive && !failed) { failed = true; original.call(this, file, String(content).slice(0, 30), ...args); throw new Error('simulated partial archive') }
    return original.call(this, file, content, ...args)
  })
  await assert.rejects(service.record({ id: 'journal-1', platform: 'qq', kind: 'private', isOwner: true, text: '需要恢复的事件' }), /simulated partial archive/)
  mock.mock.restore()
  const partial = readFileSync(archive, 'utf8')
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /archive is incomplete/)
  assert.equal(readFileSync(archive, 'utf8'), partial)
  assert.equal(existsSync(join(data, 'events-cursor.json')), false)
})

test('archive scanning preserves Chinese text across byte chunk boundaries', t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const content = JSON.stringify({ id: 'one', text: '记录一段跨块中文和星星', title: '中文记忆' }) + '\n'
  writeFileSync(file, content)
  const records = []
  scanFullRecords({ fullJsonl: file }, record => records.push(record), { chunkBytes: 7 })
  assert.equal(records.length, 1)
  assert.equal(records[0].text, '记录一段跨块中文和星星')
  assert.equal(readFileSync(file, 'utf8'), content)
})

test('archive status rebuild does not read the whole JSONL archive into memory', t => {
  const { dir } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.fullJsonl, [JSON.stringify({ text: '第一段记忆', platform: 'qq' }), JSON.stringify({ text: '第二段记忆', platform: 'bili' })].join('\n') + '\n')
  const read = fs.readFileSync
  t.mock.method(fs, 'readFileSync', function (file, ...args) { if (file === paths.fullJsonl) throw new Error('whole-file read forbidden'); return read.call(this, file, ...args) })
  const status = fullMemoryCardStatus(paths)
  assert.equal(status.records, 2)
  assert.equal(status.counts.qq, 1)
  assert.equal(status.counts.bili, 1)
  assert.equal(status.chars, 10)
})

test('archive capacity status does not synchronously scan an archive when statistics are missing', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.fullJsonl, JSON.stringify({ text: '保留的历史记忆', platform: 'qq' }) + '\n')
  const read = fs.readFileSync
  t.mock.method(fs, 'readFileSync', function (file, ...args) { if (file === paths.fullJsonl) throw new Error('whole-file read forbidden'); return read.call(this, file, ...args) })
  const status = await service.archiveStatus()
  assert.equal(status.pending, true)
  assert.equal(status.records, null)
  assert.ok(status.bytes > 0)
})

test('archive capacity status reports existing totals without changing the archive', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '需要保留的归档事件', scope: 'qq' })
  const file = join(dir, 'data/memory-card-full.jsonl'), before = readFileSync(file, 'utf8')
  const status = await service.archiveStatus()
  assert.equal(status.pending, false)
  assert.ok(status.records >= 1)
  assert.equal(status.bytes, Buffer.byteLength(before))
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('memory service asynchronously rebuilds missing archive statistics before maintenance', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const source = Array.from({ length: 3000 }, (_, index) => JSON.stringify({ id: String(index), text: '公开历史记忆', platform: 'qq' })).join('\n') + '\n'
  writeFileSync(paths.fullJsonl, source)
  writeFileSync(paths.fullStats, '{broken')
  const read = fs.readFileSync
  t.mock.method(fs, 'readFileSync', function (file, ...args) { if (file === paths.fullJsonl) throw new Error('whole-file read forbidden'); return read.call(this, file, ...args) })
  let timerRan = false; setImmediate(() => { timerRan = true })
  await service.snapshot()
  assert.ok(timerRan)
  const status = await service.archiveStatus()
  assert.equal(status.records, 3000)
  assert.equal(status.bytes, Buffer.byteLength(source))
  assert.equal(read.call(fs, paths.fullJsonl, 'utf8'), source)
  const backups = fs.readdirSync(paths.dir).filter(name => name.startsWith('memory-card-full-stats.json.corrupt-'))
  assert.equal(backups.length, 1)
  assert.equal(read.call(fs, join(paths.dir, backups[0]), 'utf8'), '{broken')
})

test('corrupt legacy full-memory JSON is not replaced with an empty archive', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.fullJson, '{broken')
  await assert.rejects(service.action('add', { text: '新记忆', scope: 'qq' }), /归档|archive/i)
  assert.equal(readFileSync(paths.fullJson, 'utf8'), '{broken')
  assert.equal(existsSync(paths.fullJsonl), false)
})

test('damaged legacy archive does not block listing card backups or managing Bilibili share history', async t => {
  const { dir } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true }); mkdirSync(join(dir, 'backups'), { recursive: true })
  writeFileSync(paths.fullJson, '{broken-archive')
  writeFileSync(join(dir, 'backups/memory-card-example.json'), '{"records":[]}')
  const memory = createBiliMemory({ stateDir: paths.dir, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: memory, qqFeedFile: join(dir, 'qq-state/qq-public-feed.jsonl') })
  writeFileSync(memory.paths.roleFree, '{"version":2}')
  writeFileSync(memory.paths.index, '{"entries":[{"id":"video","text":"公开视频","shareable":true}]}')
  writeFileSync(memory.paths.brief, '公开的视频见闻')
  assert.deepEqual(await service.backups(), ['memory-card-example.json'])
  assert.equal((await service.biliStatus()).entries, 1)
  assert.match((await service.biliBriefPreview()).text, /公开的视频见闻/)
  writeFileSync(memory.paths.publication, '{}')
  assert.equal((await service.biliBriefPreview()).text, '')
  rmSync(memory.paths.publication)
  await service.recordBiliShare('first', 'slot-1')
  await service.recordBiliShare('second', 'slot-2')
  const [backup] = (await service.biliShareHistoryBackups()).backups
  assert.ok(backup)
  await service.restoreBiliShareHistory(backup)
  assert.ok(memory.lastSlot('slot-1'))
  assert.equal(memory.lastSlot('slot-2'), '')
  assert.equal(readFileSync(paths.fullJson, 'utf8'), '{broken-archive')
})

test('legacy archive with invalid records is preserved without partial conversion', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const source = JSON.stringify({ records: [{ id: 'valid', text: '完整的旧记录' }, { invalid: true }] })
  writeFileSync(paths.fullJson, source)
  await assert.rejects(service.snapshot(), /旧版全量归档|记录/)
  assert.equal(readFileSync(paths.fullJson, 'utf8'), source)
  assert.equal(existsSync(paths.fullJsonl), false)
})

test('legacy full-memory JSON is migrated even if an old statistics file exists', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.fullJson, JSON.stringify({ records: [{ id: 'old', text: '很久以前的珍贵记录' }] }))
  writeFileSync(paths.fullStats, JSON.stringify({ records: 1, bytes: 0 }))
  await service.action('add', { text: '新记忆', scope: 'qq' })
  assert.ok((await service.search('珍贵记录')).some(record => record.id === 'old'))
  assert.ok(existsSync(paths.fullJson), 'legacy source remains available after conversion')
})

test('legacy archive conversion runs off the main event loop', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(paths.fullJson, JSON.stringify({ records: [{ id: 'old', text: '原有记忆' }] }))
  let timerRan = false; setImmediate(() => { timerRan = true })
  await service.snapshot()
  assert.equal(timerRan, true)
  assert.ok((await service.search('原有记忆')).some(record => record.id === 'old'))
  assert.ok(existsSync(paths.fullJson))
})

test('streamed legacy conversion preserves every record across write batches', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const records = Array.from({ length: 4500 }, (_, index) => ({ id: `record-${index}`, text: `旧记录${index} ${'中文'.repeat(150)}`, custom: { original: index } }))
  const source = JSON.stringify({ label: '备份', records, version: 1 })
  writeFileSync(paths.fullJson, source)
  await service.snapshot()
  const lines = readFileSync(paths.fullJsonl, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(lines.length, records.length)
  assert.deepEqual(lines.map(line => line.id), records.map(record => record.id))
  assert.equal(lines[4499].custom.original, 4499)
  assert.equal(readFileSync(paths.fullJson, 'utf8'), source)
})

test('streamed legacy conversion retains longer archive text and extra fields', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const text = '长篇旧记忆'.repeat(350), source = JSON.stringify([{ id: 'old', text, extra: '原始附加信息' }])
  writeFileSync(paths.fullJson, source)
  await service.snapshot()
  const record = JSON.parse(readFileSync(paths.fullJsonl, 'utf8').trim())
  assert.equal(record.text, text)
  assert.equal(record.extra, '原始附加信息')
  assert.equal(readFileSync(paths.fullJson, 'utf8'), source)
})

test('converted legacy archive retains searchable and paged long text', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const text = '旧记忆🌟'.repeat(2500) + '末尾独特关键词'
  writeFileSync(paths.fullJson, JSON.stringify({ records: [{ id: 'legacy-long', text }] }))
  const [hit] = await service.search('末尾独特关键词')
  assert.equal(hit.id, 'legacy-long')
  let output = '', start = 0
  while (start !== null) { const page = await service.archiveRecord({ ...hit.location, start }); output += page.text; start = page.nextStart }
  assert.equal(output, text)
})

test('legacy JSON with a damaged tail never publishes a partial conversion', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const source = '{"records":[{"id":"old","text":"原有记忆"}],"trailing":'
  writeFileSync(paths.fullJson, source)
  await assert.rejects(service.snapshot(), /旧版全量归档/)
  assert.equal(readFileSync(paths.fullJson, 'utf8'), source)
  assert.equal(existsSync(paths.fullJsonl), false)
})

test('legacy JSON with duplicate records arrays is rejected instead of partially migrated', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const source = '{"records":[{"id":"one","text":"第一条记忆"}],"records":[{"id":"two","text":"第二条记忆"}]}'
  writeFileSync(paths.fullJson, source)
  await assert.rejects(service.snapshot(), /旧版全量归档/)
  assert.equal(existsSync(paths.fullJsonl), false)
  assert.equal(readFileSync(paths.fullJson, 'utf8'), source)
})

test('legacy JSON larger than 128 MB can be converted without altering the source', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  const fd = fs.openSync(paths.fullJson, 'w')
  try {
    fs.writeSync(fd, '[')
    const spaces = Buffer.alloc(1024 * 1024, 32)
    for (let index = 0; index < 129; index++) fs.writeSync(fd, spaces)
    fs.writeSync(fd, JSON.stringify({ id: 'old', text: '大型归档里的旧记录' }) + ']')
  } finally { fs.closeSync(fd) }
  const size = fs.statSync(paths.fullJson).size
  await service.snapshot()
  assert.ok((await service.search('大型归档')).some(record => record.id === 'old'))
  assert.equal(fs.statSync(paths.fullJson).size, size)
})

test('archive scanning skips a truncated first record at the search window boundary', t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const first = JSON.stringify({ id: 'first', text: '很长的旧记忆'.repeat(10) }) + '\n'
  const second = JSON.stringify({ id: 'second', text: '完整的近期记忆' }) + '\n'
  writeFileSync(file, first + second)
  const records = []
  scanFullRecords({ fullJsonl: file }, record => records.push(record), { chunkBytes: 11, maxScanBytes: Buffer.byteLength(second) + 5 })
  assert.deepEqual(records.map(record => record.id), ['second'])
})

test('asynchronous archive search finds old records beyond the bounded tail without blocking timers', async t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const first = JSON.stringify({ id: 'early', text: '特别罕见的蓝色鲸鱼故事', title: '蓝色鲸鱼' }) + '\n'
  const rest = Array.from({ length: 2000 }, (_, index) => JSON.stringify({ id: `recent-${index}`, text: '普通的近期记录' }) + '\n').join('')
  writeFileSync(file, first + rest)
  const engine = await import('../plugins/memory/src/card-engine.mjs')
  const tail = []
  engine.scanFullRecords({ fullJsonl: file }, record => tail.push(record), { maxScanBytes: 256, chunkBytes: 64 })
  assert.ok(!tail.some(record => record.id === 'early'))
  let timerRan = false
  setImmediate(() => { timerRan = true })
  const results = await engine.recallFullMemoryAsync({ fullJsonl: file }, '蓝色鲸鱼', { limit: 5, chunkBytes: 128 })
  assert.equal(results[0].id, 'early')
  assert.ok(timerRan)
  assert.ok(results.length <= 5)
  const data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'memory-card-full.jsonl'), first + rest)
  const serviceResults = await createMemoryService({ stateDir: dir }).search('蓝色鲸鱼', 5)
  assert.equal(serviceResults[0].id, 'early')
})

test('full archive search keeps the original relevance ordering and bounded result count', async t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const entries = Array.from({ length: 300 }, (_, index) => ({ id: String(index), text: index % 2 ? '蓝色鲸鱼' : '蓝色海洋', createdAt: new Date(1700000000000 + index * 1000).toISOString() }))
  writeFileSync(file, entries.map(value => JSON.stringify(value)).join('\n') + '\n')
  const engine = await import('../plugins/memory/src/card-engine.mjs')
  const old = engine.recallFullMemory({ fullJsonl: file }, '蓝色鲸鱼', { limit: 7 })
  const current = await engine.recallFullMemoryAsync({ fullJsonl: file }, '蓝色鲸鱼', { limit: 7, chunkBytes: 99 })
  assert.deepEqual(current.map(value => value.id), old.map(value => value.id))
  assert.equal(current.length, 7)
})

test('full archive search matches text beyond the result preview limit', async t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const text = '前文'.repeat(2200) + '独特的远处关键词'
  writeFileSync(file, JSON.stringify({ id: 'long', text }) + '\n')
  const { recallFullMemoryAsync } = await import('../plugins/memory/src/card-engine.mjs')
  const records = await recallFullMemoryAsync({ fullJsonl: file }, '远处关键词')
  assert.equal(records[0]?.id, 'long')
  assert.equal(records[0].text.length, 4000)
  assert.match(records[0].matchExcerpt, /远处关键词/)
  assert.equal(records[0].textTruncated, true)
})

test('archive results support paged full-text reading and reject stale locations', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'memory-card-full.jsonl')
  const text = '完整记忆🌟'.repeat(3000), source = JSON.stringify({ id: 'long', title: '长记录', text }) + '\n'
  writeFileSync(file, source)
  const service = createMemoryService({ stateDir: dir })
  const hits = await service.search('完整记忆')
  const recent = await service.search('')
  assert.ok(hits[0].location)
  assert.ok(recent[0].location)
  const first = await service.archiveRecord({ ...hits[0].location, start: 0 })
  await assert.rejects(service.archiveRecord({ ...hits[0].location, offset: 1, length: hits[0].location.length - 1, start: 0 }), /位置无效/)
  assert.ok(first.nextStart > 0)
  let reconstructed = first.text, next = first.nextStart
  while (next !== null) {
    const page = await service.archiveRecord({ ...hits[0].location, start: next })
    reconstructed += page.text; next = page.nextStart
  }
  assert.equal(reconstructed, text)
  fs.appendFileSync(file, JSON.stringify({ id: 'new', text: '新记忆' }) + '\n')
  await assert.rejects(service.archiveRecord({ ...hits[0].location, start: 0 }), /变化|重新搜索/)
})

test('recent archive view reads and pages a record larger than the old two-megabyte window', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'memory-card-full.jsonl'), text = '长'.repeat(800000)
  writeFileSync(file, `${JSON.stringify({ id: 'older', text: '旧记录' })}\n${JSON.stringify({ id: 'long-recent', text })}\n`)
  const original = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', function (path, ...args) { if (path === file) throw new Error('不能整体读取归档'); return original.call(this, path, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  const service = createMemoryService({ stateDir: dir })
  const records = await service.search('')
  assert.equal(records[0].id, 'long-recent')
  assert.equal(records[0].textTruncated, true)
  assert.ok(records[0].location)
  assert.equal((await service.archiveRecord({ ...records[0].location, start: 790000 })).text, text.slice(790000))
  assert.equal(records[1].id, 'older')
})

test('archive locations remain exact after a damaged UTF-8 line', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const damaged = Buffer.from([0x7b, 0xff, 0x7d, 0x0a])
  const good = Buffer.from(JSON.stringify({ id: 'good', text: '可读的有效记录' }) + '\n')
  writeFileSync(join(data, 'memory-card-full.jsonl'), Buffer.concat([damaged, good]))
  const service = createMemoryService({ stateDir: dir })
  const hits = await service.search('有效记录')
  assert.equal(hits[0].location.offset, damaged.length)
  assert.equal((await service.archiveRecord(hits[0].location)).text, '可读的有效记录')
})

test('full archive search reports abnormally large records without altering the file', async t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const source = 'x'.repeat(4 * 1024 * 1024 + 1)
  writeFileSync(file, source)
  const { recallFullMemoryAsync } = await import('../plugins/memory/src/card-engine.mjs')
  await assert.rejects(recallFullMemoryAsync({ fullJsonl: file }, '关键词'), /单条记录/)
  assert.equal(readFileSync(file, 'utf8').length, source.length)
})

test('full archive search can be cancelled without changing its source', async t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  const source = JSON.stringify({ id: 'one', text: '原始记忆' }) + '\n'
  writeFileSync(file, source)
  const { recallFullMemoryAsync } = await import('../plugins/memory/src/card-engine.mjs')
  const controller = new AbortController(); controller.abort()
  await assert.rejects(recallFullMemoryAsync({ fullJsonl: file }, '原始', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(readFileSync(file, 'utf8'), source)
})

test('full archive search stops after cancellation during scanning', async t => {
  const { dir } = make(t), file = join(dir, 'archive.jsonl')
  writeFileSync(file, (JSON.stringify({ id: 'one', text: '原始记忆' }) + '\n').repeat(10000))
  const { recallFullMemoryAsync } = await import('../plugins/memory/src/card-engine.mjs')
  const controller = new AbortController()
  const result = recallFullMemoryAsync({ fullJsonl: file }, '原始', { signal: controller.signal, chunkBytes: 128 })
  setTimeout(() => controller.abort(), 10)
  await assert.rejects(result, { name: 'AbortError' })
})

test('memory service records events once, redacts before writing and respects platform boundaries', async (t) => {
  const { dir, service } = make(t)
  const event = { id: 'qq-1', platform: 'qq', kind: 'private', isOwner: true, text: '我们一起看猫，token=secret-value' }
  await Promise.all([service.record(event), service.record(event)])
  const snapshot = await service.snapshot()
  assert.equal(snapshot.records.length, 1)
  assert.doesNotMatch(readFileSync(join(dir, 'data/events.jsonl'), 'utf8'), /secret-value/)
  assert.match(await service.context('qq'), /我们一起看猫/)
  assert.doesNotMatch(await service.context('bili'), /我们一起看猫/)
  assert.ok(existsSync(join(dir, 'data/memory-card-full.jsonl')))
  assert.equal(existsSync(join(dir, 'data/memory-card-full-prompt.md')), false)
  writeFileSync(join(dir, 'data/events-cursor.json'), '{"count":0}')
  const restarted = createMemoryService({ stateDir: dir })
  assert.equal((await restarted.snapshot()).records.length, 1)
})

test('a corrupt session store does not prevent the independent card and backups from loading', async t => {
  const { dir } = make(t), oldHome = process.env.DSH_HOME
  t.after(() => { if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome })
  process.env.DSH_HOME = dir
  mkdirSync(join(dir, 'memory'), { recursive: true })
  const damaged = '{broken session data'
  writeFileSync(join(dir, 'memory/session-memory.json'), damaged)
  const handlers = new Map(), effects = []
  const ctx = { webServer: { port: 3082, register: route => { handlers.set(route.path, route.handler); return () => {} } }, get: () => ({ requestRejection: () => null }), effect: fn => effects.push(fn) }
  const { apply } = await import('../plugins/memory/src/index.mjs')
  assert.doesNotThrow(() => apply(ctx))
  t.after(() => { for (const effect of effects) effect()() })
  async function get(path) {
    const req = Readable.from([]); Object.assign(req, { url: `/dsh-memory/api${path}`, method: 'GET', headers: { host: '127.0.0.1:3082' } })
    let status; await handlers.get('/dsh-memory/api')(req, { writeHead: code => { status = code }, end() {} }); return status
  }
  assert.equal(await get('/card'), 200)
  assert.equal(await get('/backups'), 200)
  assert.equal(await get('/sessions'), 400)
  assert.equal(readFileSync(join(dir, 'memory/session-memory.json'), 'utf8'), damaged)
})

test('memory plugin startup preserves an interrupted Bilibili publication for card recovery', async t => {
  const { dir } = make(t), oldHome = process.env.DSH_HOME, data = join(dir, 'memory/data')
  process.env.DSH_HOME = dir
  t.after(() => { if (oldHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = oldHome })
  mkdirSync(data, { recursive: true }); writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const entry = { id: 'dynamic:plugin-start', type: 'dynamic', text: '插件启动后恢复的动态', at: '2026-11-01T01:00:00Z' }
  const journal = join(data, 'bili-publication-pending.json')
  writeFileSync(journal, JSON.stringify({ version: 1, outputs: { index: JSON.stringify({ entries: [entry] }), roleFree: JSON.stringify({ version: 2 }) } }))
  const handlers = new Map(), effects = []
  const ctx = { webServer: { port: 3082, register: route => { handlers.set(route.path, route.handler); return () => {} } }, get: () => ({ requestRejection: () => null }), effect: fn => effects.push(fn) }
  const { apply } = await import('../plugins/memory/src/index.mjs'); apply(ctx)
  t.after(async () => { for (const effect of effects) await effect()() })
  assert.ok(existsSync(journal), 'startup must not publish before recovery is journaled')
  const req = Readable.from([]); Object.assign(req, { url: '/dsh-memory/api/card', method: 'GET', headers: { host: '127.0.0.1:3082' } })
  let status, body
  await handlers.get('/dsh-memory/api')(req, { writeHead: code => { status = code }, end: text => { body = JSON.parse(text) } })
  assert.equal(status, 200)
  assert.ok(body.records.some(record => record.text.includes('插件启动后恢复的动态')))
  assert.equal(existsSync(journal), false)
})

test('session database recovery HTTP routes require authentication', async () => {
  let handler, restored = 0
  const service = { sessions: { databaseBackups: async () => ['session-db-1-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json'], recoverDatabase: async () => { restored++; return { ok: true } } } }
  registerMemoryHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(path, auth, method = 'GET') {
    const req = Readable.from(method === 'POST' ? ['{"name":"session-db-1-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json"}'] : [])
    Object.assign(req, { url: `/dsh-memory/api${path}`, method, headers: { host: '127.0.0.1:3082', 'content-type': 'application/json', ...(auth ? { cookie: 'yes' } : {}) } })
    let status, result; await handler(req, { writeHead: code => { status = code }, end: text => { result = JSON.parse(text) } }); return { status, result }
  }
  assert.equal((await request('/session/database-backups', false)).status, 401)
  assert.equal((await request('/session/database-backups', true)).result.backups.length, 1)
  assert.equal((await request('/session/database-restore', false, 'POST')).status, 401)
  assert.equal((await request('/session/database-restore', true, 'POST')).status, 200)
  assert.equal(restored, 1)
})

test('QQ sync purge HTTP route requires an authenticated same-origin JSON request', async () => {
  let handler, purges = 0
  registerMemoryHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, { purgeQqSync: async () => { purges++; return { ok: true, backup: 'local-backup' } } })
  async function request(headers) {
    const req = Readable.from(['{}']); Object.assign(req, { url: '/dsh-memory/api/qq-sync/purge', method: 'POST', headers: { host: '127.0.0.1:3082', ...headers } })
    let status; await handler(req, { writeHead: code => { status = code }, end() {} }); return status
  }
  assert.equal(await request({ 'content-type': 'application/json' }), 401)
  assert.equal(await request({ cookie: 'yes', origin: 'https://example.com', 'content-type': 'application/json' }), 403)
  assert.equal(await request({ cookie: 'yes' }), 415)
  assert.equal(await request({ cookie: 'yes', 'content-type': 'application/json' }), 200)
  assert.equal(purges, 1)
})

test('memory module HTTP routes require authentication and dispatch management actions', async () => {
  let handler
  const calls = []
  const service = {
    moduleStatus: async () => (calls.push(['modules']), { ok: true, closure: {}, slang: {}, history: {} }),
    closureStatus: async key => (calls.push(['closure', key]), { ok: true, record: null }),
    slangList: async ({ status }) => (calls.push(['slang', status]), { ok: true, entries: [] }),
    historyStatus: async key => (calls.push(['history', key]), { ok: true, record: null }),
    updateModuleSettings: async (section, changes) => (calls.push(['settings', section, changes]), { ok: true, section }),
  }
  registerMemoryHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(path, { auth = true, body = null } = {}) {
    const req = Readable.from(body === null ? [] : [JSON.stringify(body)])
    Object.assign(req, { url: `/dsh-memory/api${path}`, method: body === null ? 'GET' : 'POST', headers: { host: '127.0.0.1:3082', ...(body === null ? {} : { 'content-type': 'application/json' }), ...(auth ? { cookie: 'yes' } : {}) } })
    let status, result; await handler(req, { writeHead: code => { status = code }, end: text => { result = JSON.parse(text) } })
    return { status, result }
  }
  assert.equal((await request('/modules', { auth: false })).status, 401)
  assert.equal((await request('/modules')).status, 200)
  await request('/closure?key=group%3A1')
  await request('/slang?status=candidate')
  await request('/history?key=group%3A1')
  assert.deepEqual(calls, [['modules'], ['closure', 'group:1'], ['slang', 'candidate'], ['history', 'group:1']])
  const req = Readable.from(['{"section":"slang","changes":{"enabled":false}}'])
  Object.assign(req, { url: '/dsh-memory/api/settings/module', method: 'POST', headers: { host: '127.0.0.1:3082', cookie: 'yes' } })
  let status; await handler(req, { writeHead: code => { status = code }, end() {} })
  assert.equal(status, 415)
  assert.equal((await request('/settings/module', { body: { section: 'slang', changes: { enabled: false } } })).status, 200)
  assert.deepEqual(calls.at(-1), ['settings', 'slang', { enabled: false }])
})

test('private QQ events remain out of Bilibili context even when QQ sharing is enabled', async (t) => {
  const { dir, service } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ memoryCard: { includeQqInBili: true } }))
  await service.record({ id: 'private-first', platform: 'qq', kind: 'private', isOwner: true, text: '最早的交谈' })
  await service.record({ id: 'private-1', platform: 'qq', kind: 'private', isOwner: true, text: '这是一条私密的约定' })
  const privateRecord = (await service.snapshot()).records.find(record => record.text.includes('这是一条私密'))
  await service.action('pin', { id: privateRecord.id })
  assert.doesNotMatch(await service.context('bili'), /这是一条私密的约定/)
})

test('legacy private QQ records remain private even if an old card lacks the private flag', async t => {
  const { dir, service } = make(t)
  await service.record({ id: 'legacy-private', platform: 'qq', kind: 'private', text: '今天看到蓝天', direct: true })
  const file = join(dir, 'data/memory-card.json')
  const card = JSON.parse(readFileSync(file, 'utf8'))
  card.records[0].private = false
  writeFileSync(file, JSON.stringify(card))
  await service.updateSettings({ includeQqInBili: true })
  assert.doesNotMatch(await service.context('bili'), /今天看到蓝天/)
})

test('startup regenerates legacy prompt files before they can expose old private records', async t => {
  const { dir, service } = make(t)
  await service.record({ id: 'old-private', platform: 'qq', kind: 'private', text: '今天看到蓝天', direct: true })
  const file = join(dir, 'data/memory-card.json')
  const card = JSON.parse(readFileSync(file, 'utf8')); card.records[0].private = false
  writeFileSync(file, JSON.stringify(card))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ memoryCard: { includeQqInBili: true } }))
  writeFileSync(join(dir, 'data/memory-card-prompt-bili.md'), '今天看到蓝天')
  const restarted = createMemoryService({ stateDir: dir })
  assert.doesNotMatch(await restarted.context('bili'), /今天看到蓝天/)
})

test('legacy owner records without group provenance are not treated as public group messages', async t => {
  const { dir, service } = make(t)
  await service.record({ id: 'old-owner-first', platform: 'qq', kind: 'private', isOwner: true, text: '早些时候的聊天' })
  await service.record({ id: 'old-owner', platform: 'qq', kind: 'private', isOwner: true, text: '今天看到蓝天' })
  const file = join(dir, 'data/memory-card.json')
  const card = JSON.parse(readFileSync(file, 'utf8'))
  const record = card.records.find(item => item.text.includes('今天看到蓝天'))
  record.private = false; record.conversationKey = ''; record.groupId = ''
  writeFileSync(file, JSON.stringify(card))
  await service.action('pin', { id: record.id })
  await service.updateSettings({ includeQqInBili: true })
  assert.doesNotMatch(await service.context('bili'), /今天看到蓝天/)
})

test('memory settings persist and immediately refresh the platform contexts', async (t) => {
  const { dir, service } = make(t)
  await service.record({ id: 'public', platform: 'qq', kind: 'group', direct: true, text: '今天看到很有趣的猫' })
  assert.doesNotMatch(await service.context('bili'), /今天看到很有趣的猫/)
  await service.updateSettings({ includeQqInBili: true })
  assert.match(await service.context('bili'), /今天看到很有趣的猫/)
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).memoryCard.includeQqInBili, true)
  await service.updateSettings({ includeQqInBili: false })
  assert.doesNotMatch(await service.context('bili'), /今天看到很有趣的猫/)
})

test('Bilibili memories can be excluded from QQ context without deleting them', async t => {
  const { service } = make(t)
  await service.action('add', { text: '公开看过的视频', scope: 'bili' })
  assert.match(await service.context('qq'), /公开看过的视频/)
  await service.updateSettings({ includeBiliInQq: false })
  assert.doesNotMatch(await service.context('qq'), /公开看过的视频/)
  assert.match(await service.context('bili'), /公开看过的视频/)
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('公开看过的视频')))
  await service.updateSettings({ includeBiliInQq: true })
  assert.match(await service.context('qq'), /公开看过的视频/)
})

test('memory preview shows the exact platform context without exposing QQ private records to Bilibili', async t => {
  const { service } = make(t)
  await service.updateSettings({ includeQqInBili: true })
  await service.record({ id: 'preview-private', platform: 'qq', kind: 'private', text: '私下约定明天去看猫' })
  await service.record({ id: 'preview-public', platform: 'qq', kind: 'group', direct: true, text: '今天看到很有趣的猫' })
  const preview = await service.previews()
  assert.equal(preview.qq, await service.context('qq'))
  assert.equal(preview.bili, await service.context('bili'))
  assert.match(preview.qq, /私下约定明天去看猫/)
  assert.doesNotMatch(preview.bili, /私下约定明天去看猫/)
  assert.match(preview.bili, /今天看到很有趣的猫/)
})

test('QQ public sync rejects oversized or non-scalar group lists without changing settings', async t => {
  const { dir, service } = make(t)
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const file = join(dir, 'config.json'), before = readFileSync(file, 'utf8')
  await assert.rejects(service.updateQqSync({ includeGroups: Array.from({ length: 501 }, (_, i) => String(10000 + i)) }), /最多.*500/)
  assert.equal(readFileSync(file, 'utf8'), before)
  await assert.rejects(service.updateQqSync({ includeGroups: [[12345]] }), /有效群号/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('damaged QQ public summary does not hide sync settings or prevent disabling', async t => {
  const { dir, service } = make(t)
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const file = join(dir, 'data/qq-public-summary.json')
  mkdirSync(join(dir, 'data'), { recursive: true }); writeFileSync(file, '{damaged-summary')
  const status = await service.qqSyncStatus()
  assert.equal(status.config.enabled, true)
  assert.equal(status.text, '')
  assert.match(status.summaryError, /摘要/)
  await service.updateQqSync({ enabled: false })
  assert.equal((await service.qqSyncStatus()).config.enabled, false)
  assert.equal(readFileSync(file, 'utf8'), '{damaged-summary')
})

test('QQ public sync status distinguishes a privacy-blocked summary from an empty one', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '公开聊天中的天气' }) + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] }); await service.syncQqFeed()
  const file = join(dir, 'data/qq-public-summary.json'), saved = JSON.parse(readFileSync(file, 'utf8'))
  saved.text = 'password=example-secret-value'; writeFileSync(file, JSON.stringify(saved))
  const status = await service.qqSyncStatus()
  assert.equal(status.summaryBlocked, true)
  assert.ok(status.summaryLabels.includes('密码'))
  assert.equal(status.text, '')
  assert.doesNotMatch(await service.context('bili'), /example-secret-value/)
  assert.match(readFileSync(file, 'utf8'), /example-secret-value/)
})

test('QQ public sync remains independent of the memory card switch', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, `${JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '公开群里的猫' })}\n`)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.action('add', { text: 'B站记忆卡里的视频', scope: 'bili' })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  await service.syncQqFeed()
  await service.updateSettings({ enabled: false })
  assert.match(await service.context('bili'), /公开群里的猫/)
  assert.doesNotMatch(await service.context('bili'), /B站记忆卡里的视频/)
  assert.equal((await service.previews()).bili, await service.context('bili'))
  assert.equal(await service.context('qq'), '')
  await service.updateQqSync({ enabled: false })
  assert.equal(await service.context('bili'), '')
})

test('QQ public sync reports published summary when audit append fails', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '公开群里的天气' }) + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const original = fs.appendFileSync
  const mock = t.mock.method(fs, 'appendFileSync', function (file, ...args) {
    if (String(file).endsWith('qq-sync-audit.jsonl')) throw new Error('simulated audit failure')
    return original.call(this, file, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  const result = await service.syncQqFeed()
  assert.equal(result.ok, true)
  assert.match(result.auditWarning, /审计/)
  assert.match(await service.context('bili'), /公开群里的天气/)
})

test('QQ public feed sync is opt-in, filters groups and private material, and revokes old output', async t => {
  const { dir } = make(t)
  const feed = join(dir, 'qq-feed.jsonl')
  const now = new Date().toISOString()
  writeFileSync(feed, [
    { at: now, groupId: '12345', text: '今天看到可爱的小猫', senderId: '11111' },
    { at: now, groupId: '98765', text: '不在白名单的公开消息', senderId: '22222' },
    { at: now, groupId: '12345', text: '这是我们之间的秘密', senderId: '33333' },
    { at: now, text: '不能进入 B站的私聊', senderId: '44444' },
  ].map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await assert.rejects(service.syncQqFeed(), /未启用/)
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const result = await service.syncQqFeed()
  assert.equal(result.stats.kept, 1)
  assert.match(await service.context('bili'), /今天看到可爱的小猫/)
  assert.match(await service.context('bili'), /猫\/动物/)
  assert.doesNotMatch(await service.context('bili'), /98765|12345|不在白名单|秘密|不能进入 B站的私聊/)
  assert.equal((await service.qqSyncStatus()).audit.length, 1)
  await service.updateQqSync({ includeGroups: ['98765'] })
  assert.doesNotMatch(await service.context('bili'), /今天看到可爱的小猫/)
  await service.updateQqSync({ includeGroups: ['12345'] })
  await service.syncQqFeed()
  const configFile = join(dir, 'config.json')
  const config = JSON.parse(readFileSync(configFile, 'utf8'))
  config.qqSync.includeGroups = ['98765']
  writeFileSync(configFile, JSON.stringify(config))
  assert.doesNotMatch(await service.context('bili'), /今天看到可爱的小猫/)
  await service.updateQqSync({ includeGroups: ['12345'] })
  await service.syncQqFeed()
  await service.updateQqSync({ enabled: false })
  assert.doesNotMatch(await service.context('bili'), /今天看到可爱的小猫/)
  await service.updateQqSync({ enabled: true })
  assert.doesNotMatch(await service.context('bili'), /今天看到可爱的小猫/)
})

test('QQ public sync reads rotated feed even before the new current file exists', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  writeFileSync(`${feed}.1`, `${JSON.stringify({ at, groupId: '12345', senderId: '11111', text: '轮转文件中的公开群聊' })}\n`)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  assert.equal((await service.syncQqFeed()).stats.kept, 1)
  assert.match(await service.context('bili'), /轮转文件中的公开群聊/)
})

test('QQ sync applies the message limit to eligible public messages across rotated and current files', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  const row = (groupId, text, extra = {}) => ({ at, groupId, senderId: '11111', text, ...extra })
  writeFileSync(`${feed}.1`, [row('12345', '较早允许消息'), row('12345', '轮转文件允许消息')].map(JSON.stringify).join('\n') + '\n')
  writeFileSync(feed, [row('12345', '当前文件允许消息'), row('99999', '不允许群的消息'), row('12345', '明确私聊', { private: true })].map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'], maxMessages: 2 })
  const result = await service.syncQqFeed(), text = await service.context('bili')
  assert.equal(result.stats.kept, 2)
  assert.match(text, /轮转文件允许消息/); assert.match(text, /当前文件允许消息/)
  assert.doesNotMatch(text, /较早允许消息|不允许群的消息|明确私聊/)
})

test('QQ public sync retries a snapshot when the bridge rotates the feed during reading', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  const row = text => `${JSON.stringify({ at, groupId: '12345', senderId: '11111', text })}\n`
  writeFileSync(`${feed}.1`, row('先前轮转记录'))
  writeFileSync(feed, row('刚轮转的消息'))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const original = fs.promises.open; let rotated = false
  const mock = t.mock.method(fs.promises, 'open', async function (file, ...args) {
    const value = await original.call(this, file, ...args)
    if (file === `${feed}.1` && !rotated) { rotated = true; fs.renameSync(feed, `${feed}.1`); writeFileSync(feed, row('轮转后的新消息')) }
    return value
  })
  t.after(() => mock.mock.restore())
  assert.equal((await service.syncQqFeed()).stats.kept, 2)
  const text = await service.context('bili')
  assert.match(text, /刚轮转的消息/); assert.match(text, /轮转后的新消息/)
  assert.doesNotMatch(text, /先前轮转记录/)
})

test('QQ public sync yields to the event loop while reading a large feed', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  const row = JSON.stringify({ at, groupId: '12345', senderId: '11111', text: '公开消息' + '话'.repeat(500) }) + '\n'
  writeFileSync(feed, row.repeat(20000))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'], maxMessages: 10 })
  let timerRan = false
  const timer = new Promise(resolve => setTimeout(() => { timerRan = true; resolve() }, 0))
  const result = await service.syncQqFeed()
  assert.equal(timerRan, true); await timer
  assert.equal(result.stats.scanned, 20000); assert.equal(result.stats.kept, 10)
})

test('QQ public sync counts oversized lines and preserves later UTF-8 records', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  writeFileSync(feed, `${'x'.repeat(1024 * 1024 + 1)}\n${JSON.stringify({ at, groupId: '12345', senderId: '11111', text: '跨块后的中文记录' })}\n`)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const result = await service.syncQqFeed()
  assert.equal(result.stats.invalidLines, 1); assert.equal(result.stats.kept, 1)
  assert.match(await service.context('bili'), /跨块后的中文记录/)
})

test('QQ sync retains its previous summary if the feed changes during every snapshot attempt', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  const row = text => `${JSON.stringify({ at, groupId: '12345', senderId: '11111', text })}\n`
  writeFileSync(feed, row('原有可用摘要'))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] }); await service.syncQqFeed()
  const original = fs.promises.open
  const mock = t.mock.method(fs.promises, 'open', async function (file, ...args) {
    const value = await original.call(this, file, ...args)
    if (file === feed) fs.appendFileSync(feed, row('持续写入的消息'))
    return value
  })
  t.after(() => mock.mock.restore())
  await assert.rejects(service.syncQqFeed(), /正在变化/)
  assert.match(await service.context('bili'), /原有可用摘要/)
})

test('QQ public sync does not publish when owner configuration changes during scanning', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), qqConfig = join(dir, 'qq.json'), at = new Date().toISOString()
  writeFileSync(feed, JSON.stringify({ at, groupId: '12345', senderId: '11111', text: '需要按管理员过滤' }) + '\n')
  writeFileSync(qqConfig, JSON.stringify({ ownerQQ: '22222' }))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed, qqConfigFile: qqConfig })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] }); await service.syncQqFeed()
  const summary = join(dir, 'data/qq-public-summary.json'), before = readFileSync(summary, 'utf8')
  const original = fs.promises.open; let changed = false
  const mock = t.mock.method(fs.promises, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args)
    if (file === feed && !changed) { changed = true; writeFileSync(qqConfig, JSON.stringify({ ownerQQ: '11111' })) }
    return handle
  }); t.after(() => mock.mock.restore())
  await assert.rejects(service.syncQqFeed(), /配置.*变化/)
  assert.equal(readFileSync(summary, 'utf8'), before)
})

test('legacy QQ sync scope is available in the new panel without automatically enabling sync', async t => {
  const { dir } = make(t), qqConfig = join(dir, 'qq-config.json')
  writeFileSync(qqConfig, JSON.stringify({ allow: { groups: ['12345', '67890'] } }))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ memory: { qqToBili: { enabled: true, includeGroups: [], lookbackDays: 14, maxMessages: 12, maxChars: 3000, intervalMs: 3600000, includeOwner: true, useNicknames: true } } }))
  const service = createMemoryService({ stateDir: dir, qqConfigFile: qqConfig })
  const config = (await service.qqSyncStatus()).config
  assert.equal(config.enabled, false)
  assert.equal(config.autoSync, false)
  assert.deepEqual(config.includeGroups, ['12345', '67890'])
  assert.equal(config.lookbackDays, 14)
  assert.equal(config.maxMessages, 12)
  assert.equal(config.maxChars, 3000)
  assert.equal(config.intervalMs, 3600000)
  assert.equal(config.includeOwner, true)
  assert.equal(config.useNicknames, true)
  await service.updateQqSync({ enabled: true })
  assert.equal((await service.qqSyncStatus()).config.maxMessages, 12)
})

test('QQ sync purge moves public feed and summary into local backup without touching memory or alignment', async t => {
  const { dir } = make(t), feedDir = join(dir, 'qq-state'), feed = join(feedDir, 'qq-public-feed.jsonl')
  mkdirSync(feedDir, { recursive: true })
  const now = new Date().toISOString(), input = JSON.stringify({ at: now, groupId: '12345', senderId: '11111', text: '公开群内容' }) + '\n'
  writeFileSync(feed, input); writeFileSync(`${feed}.1`, '旧公开群记录\n')
  const alignment = join(dir, 'alignments.json'); writeFileSync(alignment, '{"links":[]}')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed, alignmentFile: alignment })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  await service.syncQqFeed()
  await service.action('add', { text: '保留的长期记忆' })
  const before = readFileSync(join(dir, 'data/qq-public-summary.json'), 'utf8')
  const result = await service.purgeQqSync()
  assert.equal(result.ok, true)
  assert.equal(existsSync(feed), false); assert.equal(existsSync(`${feed}.1`), false)
  assert.equal((await service.qqSyncStatus()).text, '')
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('保留的长期记忆')))
  assert.equal(readFileSync(alignment, 'utf8'), '{"links":[]}')
  const backup = join(dir, 'backups', 'qq-sync-purge', result.backup)
  assert.equal(readFileSync(join(backup, 'qq-public-feed.jsonl'), 'utf8'), input)
  assert.equal(readFileSync(join(backup, 'qq-public-feed.jsonl.1'), 'utf8'), '旧公开群记录\n')
  assert.equal(readFileSync(join(backup, 'qq-public-summary.json'), 'utf8'), before)
})

test('QQ sync purge refuses while the bridge lock exists', async t => {
  const { dir } = make(t), feedDir = join(dir, 'qq-state'), feed = join(feedDir, 'qq-public-feed.jsonl')
  mkdirSync(feedDir, { recursive: true }); writeFileSync(feed, '保留的记录\n'); writeFileSync(join(feedDir, 'bridge.lock'), String(process.pid))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await assert.rejects(service.purgeQqSync(), /停止 QQ 桥接/)
  assert.equal(readFileSync(feed, 'utf8'), '保留的记录\n')
})

test('QQ sync purge restores moved files and releases its lock if a later move fails', async t => {
  const { dir } = make(t), feedDir = join(dir, 'qq-state'), feed = join(feedDir, 'qq-public-feed.jsonl'), data = join(dir, 'data')
  mkdirSync(feedDir, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(feed, '当前公开记录\n'); writeFileSync(`${feed}.1`, '轮转公开记录\n')
  const summary = join(data, 'qq-public-summary.json'); writeFileSync(summary, '{"text":"摘要"}')
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (source === summary && !failed) { failed = true; throw new Error('simulated move failure') }
    return original.call(this, source, destination, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(createMemoryService({ stateDir: dir, qqFeedFile: feed }).purgeQqSync(), /simulated move failure/)
  assert.equal(readFileSync(feed, 'utf8'), '当前公开记录\n')
  assert.equal(readFileSync(`${feed}.1`, 'utf8'), '轮转公开记录\n')
  assert.equal(readFileSync(summary, 'utf8'), '{"text":"摘要"}')
  assert.equal(existsSync(join(feedDir, 'bridge.lock')), false)
})

test('QQ sync purge refuses a symbolic-link source without changing its target', async t => {
  const { dir } = make(t), feedDir = join(dir, 'qq-state'), feed = join(feedDir, 'qq-public-feed.jsonl'), target = join(dir, 'user-file')
  mkdirSync(feedDir, { recursive: true }); writeFileSync(target, '原始文件'); fs.symlinkSync(target, feed)
  await assert.rejects(createMemoryService({ stateDir: dir, qqFeedFile: feed }).purgeQqSync(), /普通文件/)
  assert.equal(readFileSync(target, 'utf8'), '原始文件')
  assert.equal(fs.lstatSync(feed).isSymbolicLink(), true)
  assert.equal(existsSync(join(feedDir, 'bridge.lock')), false)
})

test('QQ public feed rejects explicitly private or inconsistent session records even with an allowed group ID', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), now = new Date().toISOString()
  const rows = [
    { at: now, groupId: '12345', senderId: '11111', text: '正常群聊记录' },
    { at: now, groupId: '12345', senderId: '11111', kind: 'private', text: '明确私聊内容' },
    { at: now, groupId: '12345', senderId: '11111', private: true, text: '带私密标记的内容' },
    { at: now, groupId: '12345', senderId: '11111', conversationKey: 'private:11111', text: '会话类型冲突内容' },
    { at: now, groupId: '12345', senderId: '11111', conversationKey: 'group:98765', text: '群号不一致的内容' },
  ]
  writeFileSync(feed, rows.map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const result = await service.syncQqFeed(), text = await service.context('bili')
  assert.equal(result.stats.kept, 1)
  assert.match(text, /正常群聊记录/)
  assert.doesNotMatch(text, /私聊内容|私密标记|会话类型冲突|群号不一致/)
})

test('QQ sync skips and counts malformed feed lines without changing the source', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), at = new Date().toISOString()
  const first = JSON.stringify({ at, groupId: '12345', senderId: '11111', text: '有效的第一条群聊' })
  const second = JSON.stringify({ at, groupId: '12345', senderId: '22222', text: '有效的第二条群聊' })
  const source = `${first}\n{invalid\n${second}\n{"at":"partial`
  writeFileSync(feed, source)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const result = await service.syncQqFeed()
  assert.equal(result.stats.kept, 2)
  assert.equal(result.stats.invalidLines, 2)
  assert.match(await service.context('bili'), /有效的第一条群聊/)
  assert.match(await service.context('bili'), /有效的第二条群聊/)
  assert.equal(readFileSync(feed, 'utf8'), source)
  assert.equal((await service.qqSyncStatus()).audit[0].invalidLines, 2)
})

test('QQ sync status retains valid audit entries when some audit lines are damaged', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const audit = join(data, 'qq-sync-audit.jsonl')
  const source = `${JSON.stringify({ at: 'first', scanned: 2, kept: 1, dropped: 1 })}\n{broken\nnull\n${JSON.stringify({ at: 'last', scanned: 3, kept: 2, dropped: 1 })}\n`
  writeFileSync(audit, source)
  const service = createMemoryService({ stateDir: dir })
  const status = await service.qqSyncStatus()
  assert.deepEqual(status.audit.map(item => item.at), ['first', 'last'])
  assert.equal(status.invalidAuditLines, 2)
  assert.equal(readFileSync(audit, 'utf8'), source)
  await service.updateQqSync({ enabled: false })
})

test('QQ sync audit status streams large logs without blocking or reading the whole file', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const audit = join(data, 'qq-sync-audit.jsonl')
  const lines = Array.from({ length: 25000 }, (_, i) => JSON.stringify({ at: `记录${i}`, scanned: i, kept: 1, dropped: 0 }))
  lines.splice(200, 0, '{broken'); lines.splice(400, 0, 'x'.repeat(1024 * 1024 + 1))
  writeFileSync(audit, lines.join('\n') + '\n')
  const original = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', function (file, ...args) { if (file === audit) throw new Error('不应整体读取审计日志'); return original.call(this, file, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  let yielded = false; setImmediate(() => { yielded = true })
  const status = await createMemoryService({ stateDir: dir }).qqSyncStatus()
  assert.equal(yielded, true)
  assert.equal(status.invalidAuditLines, 2)
  assert.equal(status.audit.length, 40)
  assert.equal(status.audit.at(-1).at, '记录24999')
})

test('a slow QQ audit scan does not block other memory operations', async t => {
  const { dir, service } = make(t), audit = join(dir, 'data', 'qq-sync-audit.jsonl')
  mkdirSync(join(dir, 'data'), { recursive: true }); writeFileSync(audit, '')
  const stream = new PassThrough(), original = fs.createReadStream
  let begin; const started = new Promise(resolve => { begin = resolve })
  const mock = t.mock.method(fs, 'createReadStream', function (file, ...args) { if (file === audit) { begin(); return stream } return original.call(this, file, ...args) })
  syncBuiltinESMExports(); t.after(() => { stream.destroy(); mock.mock.restore(); syncBuiltinESMExports() })
  const reading = service.qqSyncStatus(); await started
  let timer
  const updated = service.updateQqSync({ includeGroups: ['12345'] })
  const finished = await Promise.race([updated.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), 100) })])
  clearTimeout(timer); stream.end(); const result = await reading; await updated
  assert.equal(finished, true, '读取审计不应阻止保存同步设置')
  assert.deepEqual(result.config.includeGroups, ['12345'])
})

test('QQ sync preserves an unfinished audit line and appends the new audit separately', async t => {
  const { dir } = make(t), data = join(dir, 'data'), feed = join(dir, 'feed.jsonl'); mkdirSync(data, { recursive: true })
  const audit = join(data, 'qq-sync-audit.jsonl'); writeFileSync(audit, '{unfinished')
  writeFileSync(feed, `${JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '有效群聊消息' })}\n`)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] }); await service.syncQqFeed()
  const status = await service.qqSyncStatus()
  assert.equal(status.invalidAuditLines, 1); assert.equal(status.audit.length, 1)
  assert.equal(status.audit[0].kept, 1)
  assert.match(readFileSync(audit, 'utf8'), /^\{unfinished\n/)
})

test('QQ sync panel reports damaged audit entries while retaining controls', () => {
  let exported, index = 0
  const sync = { config: { enabled: false, intervalMs: 300000, includeGroups: [], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '', invalidAuditLines: 2 }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 9 ? sync : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  const visible = nodes.flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  assert.match(visible, /审计.*2.*损坏/)
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('保存同步设置')))
})

test('unreadable QQ sync audit does not prevent reading or disabling sync settings', async t => {
  const { dir, service } = make(t), audit = join(dir, 'data', 'qq-sync-audit.jsonl')
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  mkdirSync(audit, { recursive: true })
  const status = await service.qqSyncStatus()
  assert.equal(status.config.enabled, true)
  assert.match(status.auditError, /审计.*无法读取/)
  assert.deepEqual(status.audit, [])
  await service.updateQqSync({ enabled: false })
  assert.equal((await service.qqSyncStatus()).config.enabled, false)
  assert.ok(fs.statSync(audit).isDirectory())
})

test('QQ sync panel reports an unreadable audit and retains controls', () => {
  let exported, index = 0
  const sync = { config: { enabled: true, intervalMs: 300000, includeGroups: [], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '', auditError: '同步审计无法读取，原文件已保留' }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 9 ? sync : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  assert.ok(nodes.some(node => node.props.role === 'alert' && node.children.some(child => typeof child === 'string' && child.includes('审计无法读取'))))
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('保存同步设置')))
})

test('QQ sync accepts a complete final feed record without a trailing newline', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '末尾完整记录' }))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  const result = await service.syncQqFeed()
  assert.equal(result.stats.kept, 1)
  assert.equal(result.stats.invalidLines, 0)
})

test('an entirely damaged QQ feed does not replace the last valid summary', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '11111', text: '先前有效的群聊' }) + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] }); await service.syncQqFeed()
  writeFileSync(feed, '{broken\n')
  await assert.rejects(service.syncQqFeed(), /有效记录/)
  assert.match(await service.context('bili'), /先前有效的群聊/)
})

test('QQ public sync excludes the configured owner in older feed records without an owner flag', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), qqConfig = join(dir, 'qq-config.json'), now = new Date().toISOString()
  writeFileSync(qqConfig, JSON.stringify({ ownerQQ: '11111' }))
  writeFileSync(feed, [{ at: now, groupId: '12345', senderId: '11111', text: '管理员的公开发言' }, { at: now, groupId: '12345', senderId: '22222', text: '群友的公开发言' }].map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed, qqConfigFile: qqConfig })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  await service.syncQqFeed()
  const text = await service.context('bili')
  assert.match(text, /群友的公开发言/)
  assert.doesNotMatch(text, /管理员的公开发言/)
  writeFileSync(qqConfig, JSON.stringify({ ownerQQ: '22222' }))
  assert.doesNotMatch(await service.context('bili'), /群友的公开发言/)
  await service.syncQqFeed()
  assert.doesNotMatch(await service.context('bili'), /群友的公开发言/)
  await service.updateQqSync({ includeOwner: true })
  await service.syncQqFeed()
  assert.match(await service.context('bili'), /管理员的公开发言/)
})

test('QQ public sync can optionally use sanitized group nicknames', async t => {
  const { dir } = make(t)
  const feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '45678', senderName: '小猫', text: '今天又看到蓝色的天空' }) + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'], useNicknames: true })
  await service.syncQqFeed()
  assert.match(await service.context('bili'), /小猫：今天又看到蓝色的天空/)
  assert.doesNotMatch(await service.context('bili'), /12345|45678/)
  await service.updateQqSync({ useNicknames: false })
  await service.syncQqFeed()
  assert.doesNotMatch(await service.context('bili'), /小猫/)
})

test('QQ public summaries preserve meme context and usage boundaries even when truncated', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl'), now = new Date().toISOString()
  const rows = Array.from({ length: 40 }, (_, i) => ({ at: now, groupId: '12345', senderId: '45678', text: `今天讨论游戏画面笑死啦${'可爱'.repeat(60)}第${i}条` }))
  writeFileSync(feed, rows.map(JSON.stringify).join('\n') + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'], maxChars: 1200 })
  await service.syncQqFeed()
  const text = (await service.qqSyncStatus()).text
  assert.match(text, /最近的梗/)
  assert.match(text, /边界/)
  assert.match(text, /不要.*QQ.*群号/)
  assert.ok(text.length <= 1200)
  assert.doesNotMatch(text, /12345|45678/)
})

test('QQ public summaries are checked again before reuse after external modification', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '45678', text: '今天讨论游戏画面' }) + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  await service.syncQqFeed()
  const file = join(dir, 'data/qq-public-summary.json'), saved = JSON.parse(readFileSync(file, 'utf8'))
  saved.text = 'QQ号：123456789'
  writeFileSync(file, JSON.stringify(saved))
  assert.doesNotMatch(await service.context('bili'), /123456789/)
})

test('QQ public sync only includes verified identity links and revokes them when alignment changes', async t => {
  const { dir } = make(t)
  const feed = join(dir, 'qq-feed.jsonl'), align = join(dir, 'alignments.json')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '45678', senderName: '小猫', text: '今天又看到蓝色的天空' }) + '\n')
  writeFileSync(align, JSON.stringify({ links: [{ identities: { qq: { id: '45678' }, bili: { id: '66666', name: '未标注' } } }, { verified: true, identities: { qq: { id: '45678' }, bili: { id: '77777', name: '星空' } } }, { verified: false, identities: { qq: { id: '45678' }, bili: { id: '88888', name: '未确认' } } }] }))
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed, alignmentFile: align })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'], includeIdentityLinks: true })
  await service.syncQqFeed()
  const text = await service.context('bili')
  assert.match(text, /星空/)
  assert.match(text, /群友近况/)
  assert.doesNotMatch(text, /未确认|未标注|45678|66666|77777|88888/)
  writeFileSync(align, JSON.stringify({ links: [] }))
  assert.doesNotMatch(await service.context('bili'), /星空/)
})

test('QQ public synchronization timer is opt-in and respects its interval', async t => {
  const { dir } = make(t)
  const feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '45678', text: '今天有好天气' }) + '\n')
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateQqSync({ enabled: true, includeGroups: ['12345'] })
  assert.equal((await service.autoSyncQqFeed(1000000)).skipped, true)
  await service.updateQqSync({ autoSync: true, intervalMs: 300000 })
  assert.equal((await service.autoSyncQqFeed(1000000)).ok, true)
  assert.equal((await service.autoSyncQqFeed(1001000)).skipped, true)
  assert.equal((await service.autoSyncQqFeed(1300000)).ok, true)
  assert.equal((await service.qqSyncStatus()).audit.length, 2)
})

test('automatic QQ public synchronization works with the memory card disabled', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, `${JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '45678', text: '公开群里的天气' })}\n`)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateSettings({ enabled: false })
  await service.updateQqSync({ enabled: true, autoSync: true, intervalMs: 300000, includeGroups: ['12345'] })
  const result = await service.autoSyncQqFeed(1000000)
  assert.equal(result.stats.kept, 1)
  assert.match(await service.context('bili'), /公开群里的天气/)
  assert.equal((await service.autoSyncQqFeed(1001000)).skipped, true)
  await service.updateQqSync({ autoSync: false })
  assert.equal((await service.autoSyncQqFeed(1400000)).skipped, true)
})

test('disabled damaged memory card does not block independent QQ public synchronization', async t => {
  const { dir } = make(t), feed = join(dir, 'qq-feed.jsonl')
  writeFileSync(feed, `${JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '45678', text: '公开群里的天气' })}\n`)
  const service = createMemoryService({ stateDir: dir, qqFeedFile: feed })
  await service.updateSettings({ enabled: false })
  await service.updateQqSync({ enabled: true, autoSync: true, includeGroups: ['12345'] })
  const paths = resolveMemoryCardPaths(join(dir, 'data'))
  writeFileSync(paths.json, '{damaged-card')
  writeFileSync(paths.fullJson, '{damaged-archive')
  const result = await service.autoSyncQqFeed(1000000)
  assert.equal(result.stats.kept, 1)
  assert.match(await service.context('bili'), /公开群里的天气/)
  assert.match((await service.previews()).bili, /公开群里的天气/)
  await service.updateQqSync({ enabled: false })
  assert.equal(await service.context('bili'), '')
  assert.equal((await service.qqSyncStatus()).config.enabled, false)
  const purged = await service.purgeQqSync()
  assert.equal(existsSync(feed), false)
  assert.ok(existsSync(join(dir, 'backups/qq-sync-purge', purged.backup, 'qq-public-feed.jsonl')))
  assert.equal(readFileSync(paths.json, 'utf8'), '{damaged-card')
  assert.equal(readFileSync(paths.fullJson, 'utf8'), '{damaged-archive')
})

test('disabled memory can be re-enabled even if a journal event awaits processing', async (t) => {
  const { dir, service } = make(t)
  await service.updateSettings({ enabled: false })
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(join(dir, 'data/events.jsonl'), `${JSON.stringify({ id: 'pending', platform: 'qq', kind: 'private', text: '待处理记忆', at: '2026-11-01T01:00:00Z' })}\n`)
  await service.updateSettings({ enabled: true })
  assert.match(await service.context('qq'), /待处理记忆/)
})

test('memory maintenance is local, backs up before daily decay, and skips disabled memory', async t => {
  const { service } = make(t)
  await service.action('add', { text: '一个较早的约定', scope: 'qq' })
  await service.maintenance(new Date('2030-01-02T12:00:00').getTime())
  assert.equal((await service.backups()).length, 1)
  await service.maintenance(new Date('2030-01-02T13:00:00').getTime())
  assert.equal((await service.backups()).length, 1)
  await service.updateSettings({ enabled: false })
  assert.equal((await service.maintenance()).disabled, true)
})

test('owner capacity alerts require explicit opt-in and respect a persisted cooldown', async t => {
  const { dir } = make(t)
  let calls = 0
  const service = createMemoryService({ stateDir: dir, notifyOwner: async payload => { calls++; assert.ok(payload.level > 0); return { ok: true } } })
  await service.updateSettings({ warnChars: 2000 })
  for (let i = 0; i < 20; i++) await service.action('add', { text: `记录${i} ${'小猫和阳光'.repeat(30)}`, scope: 'qq' })
  assert.ok((await service.snapshot()).status.percent >= 80)
  assert.equal((await service.notifyOwnerIfNeeded(2000000000000)).skipped, 'disabled')
  assert.equal(calls, 0)
  await service.updateOwnerAlert({ enabled: true })
  assert.equal((await service.notifyOwnerIfNeeded(2000000000000)).notified, true)
  assert.equal(calls, 1)
  const restarted = createMemoryService({ stateDir: dir, notifyOwner: async () => { calls++; return { ok: true } } })
  assert.equal((await restarted.notifyOwnerIfNeeded(2000000001000)).skipped, 'cooldown')
  assert.equal(calls, 1)
  await restarted.updateOwnerAlert({ enabled: false })
  assert.equal((await restarted.notifyOwnerIfNeeded(2000000000000 + 13 * 3600000)).skipped, 'disabled')
})

test('a failed owner alert is not marked as delivered or allowed to erase concurrent memories', async t => {
  const { dir } = make(t)
  let count = 0
  const service = createMemoryService({ stateDir: dir, notifyOwner: async () => ({ ok: ++count > 1, error: 'bridge offline' }) })
  await service.updateSettings({ warnChars: 2000 })
  for (let i = 0; i < 20; i++) await service.action('add', { text: `经历${i} ${'星星和阳光'.repeat(30)}`, scope: 'qq' })
  await service.updateOwnerAlert({ enabled: true })
  assert.equal((await service.notifyOwnerIfNeeded(2000000000000)).ok, false)
  await service.action('add', { text: '通知失败后新写入的记忆', scope: 'qq' })
  assert.equal((await service.notifyOwnerIfNeeded(2000000001000)).notified, true)
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('通知失败后新写入的记忆')))
})

test('memory maintenance timer is stopped when the plugin is disposed', async () => {
  const callbacks = [], cleared = []
  const fakeTimers = { setTimeout: fn => (callbacks.push(fn), callbacks.length), setInterval: fn => (callbacks.push(fn), callbacks.length), clearTimeout: id => cleared.push(id), clearInterval: id => cleared.push(id) }
  let ticks = 0
  const stop = startMemoryMaintenance({ maintenance: async () => { ticks++ } }, { timers: fakeTimers })
  await callbacks[0]()
  stop()
  await callbacks[1]()
  assert.equal(ticks, 1)
  assert.deepEqual(cleared, [1, 2, 3])
})

test('automatic local QQ sync runs before a slow Bilibili refresh', async t => {
  const callbacks = [], order = []
  const fakeTimers = { setTimeout: fn => (callbacks.push(fn), callbacks.length), setInterval: fn => (callbacks.push(fn), callbacks.length), clearTimeout() {}, clearInterval() {} }
  let release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  const stop = startMemoryMaintenance({ autoSyncQqFeed: async () => { order.push('qq') }, autoRefreshBili: async () => { order.push('bili'); entered(); await waiting } }, { timers: fakeTimers })
  const tick = callbacks[2]()
  await started
  assert.deepEqual(order, ['qq', 'bili'])
  release(); await tick; stop()
})

test('automatic QQ sync logs a published summary with an audit warning', async () => {
  const callbacks = [], messages = []
  const timers = { setTimeout: fn => (callbacks.push(fn), 1), setInterval: fn => (callbacks.push(fn), callbacks.length), clearTimeout() {}, clearInterval() {} }
  const stop = startMemoryMaintenance({ autoSyncQqFeed: async () => ({ ok: true, auditWarning: '审计日志写入失败' }) }, { timers, log: message => messages.push(message) })
  await callbacks[2]()
  stop()
  assert.match(messages.join(' '), /同步已完成.*审计日志写入失败/)
})

test('cross-platform context omits private topics and identities from public QQ records', async (t) => {
  const { dir, service } = make(t)
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ memoryCard: { includeQqInBili: true } }))
  await service.record({ id: 'group-private', platform: 'qq', kind: 'group', direct: true, text: '这是我们之间的秘密', sender: '真实姓名' })
  await service.record({ id: 'group-public', platform: 'qq', kind: 'group', direct: true, text: '今天看到很有趣的猫', sender: 'Alice' })
  const bili = await service.context('bili')
  assert.doesNotMatch(bili, /秘密|Alice|真实姓名/)
  assert.match(bili, /今天看到很有趣的猫/)
})

test('QQ events with distinct ids do not collapse merely because their text is identical', async (t) => {
  const { service } = make(t)
  const common = { platform: 'qq', kind: 'private', isOwner: true, text: '记得今天的约定', at: '2026-11-01T01:00:00Z' }
  await service.record({ ...common, id: 'first' })
  const result = await service.record({ ...common, id: 'second' })
  assert.equal(result.duplicate, false)
  const journalCount = (await service.snapshot()).status.stats.fromQq
  assert.ok(journalCount >= 1)
})

test('memory service persists manual records and rejects a damaged card instead of overwriting it', async (t) => {
  const { dir, service } = make(t)
  await service.action('add', { text: '记住这件事', scope: 'shared' })
  assert.match(await service.context('bili'), /记住这件事/)
  writeFileSync(join(dir, 'data/memory-card.json'), '{broken')
  await assert.rejects(service.action('add', { text: '新内容' }), /corrupt/i)
  assert.equal(readFileSync(join(dir, 'data/memory-card.json'), 'utf8'), '{broken')
})

test('memory HTTP routes require a DSH session and expose independent card operations', async (t) => {
  const { service } = make(t)
  let handler
  const ctx = { webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }
  registerMemoryHttp(ctx, service)
  async function request(url, { method = 'GET', body, auth = true, origin } = {}) {
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(req, { url, method, headers: { host: '127.0.0.1:3082', ...(auth ? { cookie: 'session=ok' } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) } })
    let status, data
    const res = { writeHead: code => { status = code }, end: value => { data = value ? JSON.parse(value) : null } }
    await handler(req, res)
    return { status, data }
  }
  assert.equal((await request('/dsh-memory/api/card', { auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/card', { method: 'POST', body: { action: 'add', text: '独立记忆', scope: 'shared' }, origin: 'https://example.com' })).status, 403)
  assert.equal((await request('/dsh-memory/api/card', { method: 'POST', body: { action: 'add', text: '独立记忆', scope: 'shared' } })).status, 200)
  assert.match((await request('/dsh-memory/api/card')).data.records[0].text, /独立记忆/)
  assert.equal((await request('/dsh-memory/api/previews', { auth: false })).status, 401)
  assert.match((await request('/dsh-memory/api/previews')).data.qq, /独立记忆/)
  assert.equal((await request('/dsh-memory/api/archive/preview', { auth: false })).status, 401)
  assert.match((await request('/dsh-memory/api/archive/preview')).data.text, /独立记忆/)
  const archive = await request('/dsh-memory/api/archive?q=%E7%8B%AC%E7%AB%8B%E8%AE%B0%E5%BF%86')
  const position = new URLSearchParams({ ...archive.data.records[0].location, start: '0' })
  assert.equal((await request(`/dsh-memory/api/archive/record?${position}`, { auth: false })).status, 401)
  assert.match((await request(`/dsh-memory/api/archive/record?${position}`)).data.text, /独立记忆/)
  assert.equal((await request('/dsh-memory/api/bili/brief', { auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/settings', { method: 'POST', body: { enabled: false }, auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/settings', { method: 'POST', body: { enabled: false } })).data.config.enabled, false)
  assert.equal((await request('/dsh-memory/api/settings', { method: 'POST', body: { enabled: true } })).data.config.enabled, true)
  assert.equal((await request('/dsh-memory/api/sync-settings', { method: 'POST', body: { enabled: true }, auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/sync-settings', { method: 'POST', body: { enabled: true } })).data.sync.enabled, true)
  assert.equal((await request('/dsh-memory/api/owner-alert', { method: 'POST', body: { enabled: true }, auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/owner-alert', { method: 'POST', body: { enabled: true } })).data.ownerAlert.enabled, true)
  assert.equal((await request('/dsh-memory/api/owner-alert/check', { method: 'POST', body: {}, auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/owner-alert/check', { method: 'POST', body: {} })).data.skipped, 'no-alert')
  assert.equal((await request('/dsh-memory/api/owner-alert', { method: 'POST', body: { enabled: false } })).data.ownerAlert.enabled, false)
  assert.equal((await request('/dsh-memory/api/qq-sync', { auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/qq-sync/settings', { method: 'POST', body: { enabled: true, includeGroups: ['12345'] } })).data.config.enabled, true)
  assert.deepEqual((await request('/dsh-memory/api/qq-sync')).data.config.includeGroups, ['12345'])
  assert.equal((await request('/dsh-memory/api/qq-sync/run', { method: 'POST', body: {} })).status, 400)
  assert.equal((await request('/dsh-memory/api/session?key=group%3A123', { auth: false })).status, 401)
  const session = (await request('/dsh-memory/api/session?key=group%3A123')).data
  session.value.activeTopics.push({ text: '会话话题' })
  assert.equal((await request('/dsh-memory/api/session', { method: 'POST', body: { key: 'group:123', revision: session.revision, value: session.value } })).status, 200)
  assert.deepEqual((await request('/dsh-memory/api/sessions')).data.sessions, ['group:123'])
  assert.equal((await request('/dsh-memory/api/session', { method: 'POST', body: { key: 'group:123', revision: session.revision, value: session.value } })).status, 400)
  const savedSessions = (await request('/dsh-memory/api/session/backups?key=group%3A123')).data.backups
  assert.equal(savedSessions.length, 1)
  assert.equal((await request('/dsh-memory/api/session/restore', { method: 'POST', body: { key: 'group:123', name: savedSessions[0], revision: 1 } })).data.value.activeTopics.length, 0)
  const unavailable = await request('/dsh-memory/api/bili/refresh', { method: 'POST', body: {} })
  assert.equal(unavailable.status, 400)
  assert.ok(unavailable.data.code && unavailable.data.hint)
})

test('manual edits are backed up and full archive remains searchable after restore', async (t) => {
  const { service } = make(t)
  await service.action('add', { text: '第一个重要事件', scope: 'shared' })
  await service.action('add', { text: '第二个重要事件', scope: 'shared' })
  const backups = await service.backups()
  assert.equal(backups.length, 1)
  await service.restore(backups[0])
  assert.equal((await service.snapshot()).records.length, 1)
  assert.ok((await service.search('第二个重要事件')).some(item => item.text.includes('第二个重要事件')))
  await assert.rejects(service.restore('../outside'), /invalid/i)
})

test('memory list prioritizes a manually designated first meeting and pinned items without changing stored order', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '高重要度但未置顶', importance: 100 })
  await service.action('add', { text: '较低重要度的置顶', importance: 20 })
  const pin = (await service.snapshot()).records.find(item => item.text.includes('较低重要度的置顶'))
  await service.action('pin', { id: pin.id })
  await service.record({ id: 'first-owner', platform: 'qq', kind: 'private', isOwner: true, text: '第一次一起看星星' })
  // 初次相遇不再自动产生：没人指定，这个位置就一直是空的。
  let before = await service.snapshot()
  assert.equal(before.firstMet.source, '')
  assert.ok(before.records.every(record => !record.firstMet))
  const owner = before.records.find(item => item.text.includes('第一次一起看星星'))
  await service.action('set-first-meet', { ids: [owner.id] })
  const file = join(dir, 'data/memory-card.json'), before2 = readFileSync(file, 'utf8')
  const records = (await service.snapshot()).records
  assert.ok(records[0].firstMet)
  assert.ok(records[1].text.includes('较低重要度的置顶'))
  assert.ok(records[2].text.includes('高重要度但未置顶'))
  assert.equal(readFileSync(file, 'utf8'), before2)
})

test('a corrupt memory card can be restored while preserving the damaged file and pending events', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '备份中的记忆', scope: 'qq' })
  await service.action('add', { text: '另一个记忆', scope: 'qq' })
  const [backup] = await service.backups()
  const pending = { id: 'pending-1', platform: 'qq', kind: 'group', text: '等待处理的群聊记忆', at: new Date().toISOString(), isOwner: true }
  const events = join(dir, 'data/events.jsonl')
  writeFileSync(events, `${JSON.stringify(pending)}\n`)
  writeFileSync(join(dir, 'data/events-cursor.json'), '{"count":0}')
  const damaged = '{broken json'
  writeFileSync(join(dir, 'data/memory-card.json'), damaged)
  await service.restore(backup)
  const snapshot = await service.snapshot()
  assert.ok(snapshot.records.some(record => record.text.includes('备份中的记忆')))
  assert.ok(snapshot.records.some(record => record.text.includes('等待处理的群聊记忆')))
  const backups = await service.backups()
  assert.ok(backups.some(name => readFileSync(join(dir, 'backups', name), 'utf8') === damaged))
})

test('a structurally invalid memory card is not normalized into an empty card and can be restored', async t => {
  const { dir, service } = make(t)
  await service.action('add', { text: '要保留的记忆', scope: 'qq' })
  await service.action('add', { text: '第二条记忆', scope: 'qq' })
  const [backup] = await service.backups()
  const file = join(dir, 'data/memory-card.json'), damaged = '{"records":{"unexpected":"payload"}}'
  writeFileSync(file, damaged)
  await assert.rejects(service.action('add', { text: '不能覆盖损坏文件', scope: 'qq' }), /corrupt/i)
  assert.equal(readFileSync(file, 'utf8'), damaged)
  await service.restore(backup)
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('要保留的记忆')))
  assert.ok((await service.backups()).some(name => readFileSync(join(dir, 'backups', name), 'utf8') === damaged))
})

test('full archive preview is bounded and remains separate from platform context', async t => {
  const { service } = make(t)
  await service.action('add', { text: '归档中的一段私密经历', scope: 'qq' })
  const archive = await service.archivePreview()
  assert.match(archive.text, /归档中的一段私密经历/)
  assert.doesNotMatch(await service.context('bili'), /归档中的一段私密经历/)
  assert.ok(archive.text.length <= 200000)
  const card = await service.cardPreview()
  assert.match(card.text, /归档中的一段私密经历/)
  assert.ok(card.text.length <= 200000)
})

test('merging memory records preserves the originals in the full archive', async t => {
  const { service } = make(t)
  await service.action('add', { text: '第一次看见白色小猫', scope: 'shared' })
  await service.action('add', { text: '第二次看见黑色小猫', scope: 'shared' })
  const before = await service.snapshot()
  await service.action('merge-memories', { ids: before.records.map(record => record.id), title: '两次见猫' })
  const after = await service.snapshot()
  assert.equal(after.records.length, 1)
  assert.match(after.records[0].title, /两次见猫/)
  assert.ok((await service.search('第一次看见白色小猫')).some(item => item.text.includes('第一次看见白色小猫')))
  assert.ok((await service.search('第二次看见黑色小猫')).some(item => item.text.includes('第二次看见黑色小猫')))
})

test('memory batch actions reject oversized selections instead of silently ignoring records', async t => {
  const { service } = make(t)
  for (let i = 0; i < 51; i++) await service.action('add', { text: `测试记忆条目 ${i}`, scope: 'shared', tags: ['owner'] })
  const before = await service.snapshot(), ids = before.records.map(record => record.id)
  assert.equal(ids.length, 51)
  await assert.rejects(service.action('merge-memories', { ids }), /最多.*50/)
  await assert.rejects(service.action('set-first-meet', { ids: ids.slice(0, 21) }), /最多.*20/)
  assert.deepEqual((await service.snapshot()).records.map(record => record.id), ids)
})

test('interrupted manual memory addition resumes without duplicate archive entries', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), card = join(data, 'memory-card.json'), archive = join(data, 'memory-card-full.jsonl')
  await service.snapshot()
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.action('add', { text: '手动添加的重要记忆', scope: 'qq' }), /simulated card failure/)
  mock.mock.restore()
  const restored = await createMemoryService({ stateDir: dir }).snapshot()
  assert.ok(restored.records.some(record => record.text.includes('手动添加的重要记忆')))
  const archived = readFileSync(archive, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(archived.filter(record => record.text.includes('手动添加的重要记忆')).length, 1)
})

test('interrupted manual action stores redacted fields and excludes unrelated payload data', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), card = join(data, 'memory-card.json'), pending = join(data, 'manual-action-pending.json')
  await service.snapshot()
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.action('add', { text: '记住 password=hidden-secret 这个事情', scope: 'qq', unrelated: 'unrelated-secret' }), /simulated card failure/)
  mock.mock.restore()
  const saved = readFileSync(pending, 'utf8')
  assert.doesNotMatch(saved, /hidden-secret|unrelated-secret/)
  await createMemoryService({ stateDir: dir }).snapshot()
})

test('interrupted manual merge resumes and preserves originals without duplicate archive entries', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), card = join(data, 'memory-card.json'), archive = join(data, 'memory-card-full.jsonl')
  await service.action('add', { text: '合并前的第一段记忆', scope: 'shared' })
  await service.action('add', { text: '合并前的第二段记忆', scope: 'shared' })
  const ids = (await service.snapshot()).records.map(record => record.id)
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.action('merge-memories', { ids, title: '合并后的事件' }), /simulated card failure/); mock.mock.restore()
  const result = await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(result.records.length, 1)
  assert.match(result.records[0].title, /合并后的事件/)
  const archived = readFileSync(archive, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(archived.length, 3)
  assert.equal(new Set(archived.map(record => record.id)).size, 3)
})

test('manual action recovery recognizes a card saved before a derived output failed', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), markdown = join(data, 'memory-card.md'), archive = join(data, 'memory-card-full.jsonl')
  await service.snapshot()
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === markdown && !failed) { failed = true; throw new Error('simulated output failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.action('add', { text: '保存后需要恢复输出的记忆' }), /simulated output failure/); mock.mock.restore()
  const result = await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(result.records.filter(record => record.text.includes('保存后需要恢复输出的记忆')).length, 1)
  assert.equal(readFileSync(archive, 'utf8').trim().split('\n').length, 1)
  assert.match(readFileSync(markdown, 'utf8'), /保存后需要恢复输出的记忆/)
})

test('memory card restore recovers derived output after an interrupted write in the same process', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), prompt = join(data, 'memory-card-prompt-qq.md')
  await service.action('add', { text: '恢复前的第一条记忆' })
  await service.action('add', { text: '恢复后不应存在的记忆' })
  const backup = (await service.backups()).find(name => readFileSync(join(dir, 'backups', name), 'utf8').includes('恢复前的第一条记忆'))
  assert.ok(backup); await service.snapshot()
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('模拟恢复输出失败') }
    return original.call(this, source, destination, ...args)
  })
  t.after(() => mock.mock.restore())
  await assert.rejects(service.restore(backup), error => error.code === 'MEMORY_RESTORE_PENDING' && /模拟恢复输出失败/.test(error.message))
  mock.mock.restore()
  assert.ok(existsSync(join(data, 'restore-pending.json')))
  const snapshot = await service.snapshot()
  assert.equal(snapshot.records.some(record => record.text.includes('恢复后不应存在')), false)
  assert.doesNotMatch(readFileSync(prompt, 'utf8'), /恢复后不应存在/)
  assert.equal(existsSync(join(data, 'restore-pending.json')), false)
})

test('memory HTTP exposes a distinct result when restoration committed but output failed', async t => {
  const { dir, service } = make(t), prompt = join(dir, 'data/memory-card-prompt-qq.md')
  await service.action('add', { text: '备份前记忆' }); await service.action('add', { text: '稍后新增的记忆' })
  const backup = (await service.backups()).find(name => readFileSync(join(dir, 'backups', name), 'utf8').includes('备份前记忆'))
  let handler
  registerMemoryHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: () => false }) }, service)
  const req = Readable.from([JSON.stringify({ name: backup })]); Object.assign(req, { url: '/dsh-memory/api/restore', method: 'POST', headers: { host: '127.0.0.1:3082', 'content-type': 'application/json' } })
  let status, data; const res = { writeHead: code => { status = code }, end: body => { data = JSON.parse(body) } }
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('模拟输出写入失败') }
    return original.call(this, source, destination, ...args)
  }); t.after(() => mock.mock.restore())
  await handler(req, res); mock.mock.restore()
  assert.equal(status, 400); assert.equal(data.code, 'MEMORY_RESTORE_PENDING'); assert.match(data.error, /已替换.*模拟输出写入失败/)
  assert.ok((await service.snapshot()).records.every(record => !record.text.includes('稍后新增')))
})

test('interrupted legacy backup restore recovers after restart and rejects external card changes', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), backupDir = join(dir, 'backups')
  await service.action('add', { text: '旧卡片内容' }); await service.snapshot()
  mkdirSync(backupDir, { recursive: true })
  const backup = 'memory-card-legacy-test.json'
  writeFileSync(join(backupDir, backup), JSON.stringify({ records: [{ text: '从旧版备份恢复' }] }))
  const prompt = join(data, 'memory-card-prompt-qq.md'), marker = join(data, 'restore-pending.json'), file = join(data, 'memory-card.json')
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('模拟中断') }
    return original.call(this, source, destination, ...args)
  }); t.after(() => mock.mock.restore())
  await assert.rejects(service.restore(backup), /模拟中断/); mock.mock.restore()
  const expected = readFileSync(file, 'utf8')
  const configFile = join(dir, 'config.json'), configBefore = existsSync(configFile) ? readFileSync(configFile, 'utf8') : null
  writeFileSync(configFile, JSON.stringify({ memoryCard: { enabled: false } }))
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /恢复期间配置发生变化/)
  assert.ok(existsSync(marker))
  if (configBefore === null) rmSync(configFile); else writeFileSync(configFile, configBefore)
  writeFileSync(file, JSON.stringify({ records: [{ text: '外部修改' }] }))
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /恢复期间记忆卡发生变化/)
  assert.ok(existsSync(marker)); assert.match(readFileSync(file, 'utf8'), /外部修改/)
  writeFileSync(file, expected)
  const recovered = await createMemoryService({ stateDir: dir }).snapshot()
  assert.match(recovered.records[0].text, /从旧版备份恢复/)
  assert.match(readFileSync(prompt, 'utf8'), /从旧版备份恢复/)
  assert.equal(existsSync(marker), false)
})

test('restore interrupted before card replacement preserves the original card', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), file = join(data, 'memory-card.json')
  await service.action('add', { text: '原有记忆' }); await service.action('add', { text: '需要保留的较新记忆' })
  const backup = (await service.backups()).find(name => readFileSync(join(dir, 'backups', name), 'utf8').includes('原有记忆'))
  const before = readFileSync(file, 'utf8'), original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === file && !failed) { failed = true; throw new Error('模拟替换失败') }
    return original.call(this, source, destination, ...args)
  }); syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.restore(backup), /模拟替换失败/)
  mock.mock.restore(); syncBuiltinESMExports()
  assert.equal(readFileSync(file, 'utf8'), before)
  const snapshot = await createMemoryService({ stateDir: dir }).snapshot()
  assert.ok(snapshot.records.some(record => record.text.includes('需要保留的较新记忆')))
  assert.equal(existsSync(join(data, 'restore-pending.json')), false)
})

test('a conflicting restore marker blocks new events before they reach the journal', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), events = join(data, 'events.jsonl')
  await service.record({ platform: 'qq', id: 'before', text: '已记录事件' })
  const original = readFileSync(events, 'utf8')
  writeFileSync(join(data, 'restore-pending.json'), '{损坏')
  await assert.rejects(service.record({ platform: 'qq', id: 'after', text: '不应写入事件' }), /恢复记录损坏/)
  assert.equal(readFileSync(events, 'utf8'), original)
})

test('unresolved memory settings and manual actions block new journal writes', async t => {
  for (const marker of ['settings-pending.json', 'manual-action-pending.json']) {
    const { dir, service } = make(t), data = join(dir, 'data'), events = join(data, 'events.jsonl')
    await service.record({ platform: 'qq', id: `before-${marker}`, text: '已有事件' })
    const original = readFileSync(events, 'utf8')
    writeFileSync(join(data, marker), '{损坏')
    await assert.rejects(service.record({ platform: 'qq', id: `after-${marker}`, text: '不应写入事件' }))
    assert.equal(readFileSync(events, 'utf8'), original)
  }
})

test('disabled memory reports disabled without reading a corrupt card or appending events', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), events = join(data, 'events.jsonl')
  await service.updateSettings({ enabled: false })
  writeFileSync(join(data, 'memory-card.json'), '{损坏')
  await assert.rejects(service.record({ platform: 'qq', id: 'disabled', text: '不应写入' }), error => error.code === 'MEMORY_DISABLED')
  assert.equal(existsSync(events), false)
  assert.equal(readFileSync(join(data, 'memory-card.json'), 'utf8'), '{损坏')
})

test('recording an event first completes an interrupted manual memory action', async t => {
  const { dir, service } = make(t), prompt = join(dir, 'data/memory-card-prompt-qq.md')
  await service.snapshot()
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('模拟提示词写入失败') }
    return original.call(this, source, destination, ...args)
  }); t.after(() => mock.mock.restore())
  await assert.rejects(service.action('add', { text: '待恢复的手动记忆' }), /模拟提示词写入失败/)
  mock.mock.restore()
  await service.record({ platform: 'qq', id: 'new-event', text: '恢复后新事件', kind: 'private', isOwner: true })
  const records = (await service.snapshot()).records
  assert.equal(records.filter(record => record.text.includes('待恢复的手动记忆')).length, 1)
  assert.equal(records.filter(record => record.text.includes('恢复后新事件')).length, 1)
})

test('unresolved restore prevents sync and owner settings writes', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), configFile = join(dir, 'config.json')
  await service.updateSettings({ enabled: false })
  const original = readFileSync(configFile, 'utf8')
  writeFileSync(join(data, 'restore-pending.json'), '{损坏')
  await assert.rejects(service.updateSyncSettings({ enabled: true }), /恢复记录损坏/)
  await assert.rejects(service.updateOwnerAlert({ enabled: true }), /恢复记录损坏/)
  await assert.rejects(service.updateQqSync({ enabled: true }), /恢复记录损坏/)
  assert.equal(readFileSync(configFile, 'utf8'), original)
})

test('disabled memory maintenance still recovers pending restore outputs', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), prompt = join(data, 'memory-card-prompt-qq.md')
  await service.action('add', { text: '旧备份' }); await service.action('add', { text: '较新的记忆' })
  const backup = (await service.backups()).find(name => readFileSync(join(dir, 'backups', name), 'utf8').includes('旧备份'))
  await service.updateSettings({ enabled: false })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('模拟输出失败') }
    return original.call(this, source, destination, ...args)
  }); t.after(() => mock.mock.restore())
  await assert.rejects(service.restore(backup), /模拟输出失败/); mock.mock.restore()
  assert.ok(existsSync(join(data, 'restore-pending.json')))
  assert.equal((await service.maintenance()).disabled, true)
  assert.equal(existsSync(join(data, 'restore-pending.json')), false)
})

test('memory settings recover derived outputs after a partial write in the same process', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), prompt = join(data, 'memory-card-prompt-qq.md')
  await service.action('add', { text: '持久化设置恢复测试' })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('simulated prompt failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.updateSettings({ injectMaxChars: { qq: 400 } }), /simulated prompt failure/)
  mock.mock.restore()
  assert.ok(existsSync(join(data, 'settings-pending.json')))
  const result = await service.snapshot()
  assert.equal(result.config.injectMaxChars.qq, 400)
  assert.match(readFileSync(prompt, 'utf8'), /持久化设置恢复测试/)
  assert.equal(existsSync(join(data, 'settings-pending.json')), false)
})

test('memory settings recovery rejects changes made to the card after interruption', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), prompt = join(data, 'memory-card-prompt-qq.md'), card = join(data, 'memory-card.json')
  await service.action('add', { text: '原来的记忆' })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('simulated prompt failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.updateSettings({ injectMaxChars: { qq: 400 } }), /simulated prompt failure/); mock.mock.restore()
  const changed = JSON.parse(readFileSync(card, 'utf8')); changed.records[0].text = '外部修改'; writeFileSync(card, JSON.stringify(changed))
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /记忆卡发生变化/)
  assert.equal(JSON.parse(readFileSync(card, 'utf8')).records[0].text, '外部修改')
  assert.ok(existsSync(join(data, 'settings-pending.json')))
})

test('first memory settings save recovers when interrupted before creating the initial card', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), card = join(data, 'memory-card.json')
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated initial card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.updateSettings({ enabled: false }), /simulated initial card failure/); mock.mock.restore()
  await new Promise(resolve => setTimeout(resolve, 5))
  const snapshot = await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(snapshot.config.enabled, false)
  assert.ok(existsSync(card)); assert.equal(existsSync(join(data, 'settings-pending.json')), false)
})

test('background maintenance recovers interrupted settings before honoring disabled memory', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), prompt = join(data, 'memory-card-prompt-qq.md')
  await service.action('add', { text: '后台恢复设置' })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt && !failed) { failed = true; throw new Error('simulated prompt failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.updateSettings({ enabled: false }), /simulated prompt failure/); mock.mock.restore()
  const restarted = createMemoryService({ stateDir: dir })
  const result = await restarted.maintenance()
  assert.equal(result.disabled, true)
  assert.equal(existsSync(join(data, 'settings-pending.json')), false)
})

test('other memory settings finish pending recovery before changing the shared config', async t => {
  for (const update of [service => service.updateSyncSettings({ intervalMs: 900000 }), service => service.updateOwnerAlert({ enabled: true }), service => service.updateQqSync({ enabled: false })]) {
    const { dir, service } = make(t), prompt = join(dir, 'data/memory-card-prompt-qq.md')
    await service.action('add', { text: '待恢复的记忆' })
    const original = fs.renameSync; let failed = false
    const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
      if (destination === prompt && !failed) { failed = true; throw new Error('simulated prompt failure') }
      return original.call(this, source, destination, ...args)
    })
    await assert.rejects(service.updateSettings({ injectMaxChars: { qq: 400 } }), /simulated prompt failure/); mock.mock.restore()
    await update(service)
    assert.equal((await service.snapshot()).config.injectMaxChars.qq, 400)
    assert.equal(existsSync(join(dir, 'data/settings-pending.json')), false)
  }
})

test('memory sync settings do not change if pending output recovery still fails', async t => {
  const { dir, service } = make(t), prompt = join(dir, 'data/memory-card-prompt-qq.md'), config = join(dir, 'config.json')
  await service.action('add', { text: '待恢复的记忆' })
  const original = fs.renameSync
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === prompt) throw new Error('simulated prompt failure')
    return original.call(this, source, destination, ...args)
  })
  t.after(() => mock.mock.restore())
  await assert.rejects(service.updateSettings({ injectMaxChars: { qq: 400 } }), /simulated prompt failure/)
  const before = readFileSync(config, 'utf8')
  await assert.rejects(service.updateSyncSettings({ intervalMs: 900000 }), /simulated prompt failure/)
  await assert.rejects(service.updateQqSync({ enabled: true, includeGroups: ['12345'] }), /simulated prompt failure/)
  assert.equal(readFileSync(config, 'utf8'), before)
  assert.ok(existsSync(join(dir, 'data/settings-pending.json')))
})

test('manual action interrupted while memory is disabled is recovered before later actions', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'), card = join(data, 'memory-card.json')
  await service.updateSettings({ enabled: false })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.action('add', { text: '关闭期间的手动记忆' }), /simulated card failure/); mock.mock.restore()
  const result = await createMemoryService({ stateDir: dir }).snapshot()
  assert.ok(result.records.some(record => record.text.includes('关闭期间的手动记忆')))
  assert.equal(existsSync(join(data, 'manual-action-pending.json')), false)
})

test('merged private QQ memories never become visible to Bilibili', async t => {
  const { service } = make(t)
  await service.updateSettings({ includeQqInBili: true })
  await service.record({ id: 'private-a', platform: 'qq', kind: 'private', text: '第一条私密聊天内容', direct: true })
  await service.record({ id: 'private-b', platform: 'qq', kind: 'private', text: '第二条私密聊天内容', direct: true })
  const ids = (await service.snapshot()).records.map(record => record.id)
  await service.action('merge-memories', { ids })
  assert.equal((await service.snapshot()).records[0].private, true)
  assert.doesNotMatch(await service.context('bili'), /第一条私密聊天内容|第二条私密聊天内容/)
})

test('migrated legacy inbox and Bilibili memory are ingested once after startup', async (t) => {
  const { dir } = make(t)
  mkdirSync(join(dir, 'data'), { recursive: true })
  writeFileSync(join(dir, 'data/memory-inbox.jsonl'), `${JSON.stringify({ at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '旧对话记忆' })}\n`)
  writeFileSync(join(dir, 'data/bili-memory.json'), JSON.stringify({ entries: [{ id: 'b1', type: 'dynamic', text: '旧动态记忆', at: '2026-11-01T01:00:00Z' }] }))
  const service = createMemoryService({ stateDir: dir })
  const first = await service.snapshot()
  assert.equal(first.records.length, 2)
  assert.equal((await createMemoryService({ stateDir: dir }).snapshot()).records.length, 2)
})

test('legacy import archives records evicted during a batch and recovers without duplicates', async t => {
  const { dir, service } = make(t), data = join(dir, 'data')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ memoryCard: { maxRecords: 100, autoCompact: false } }))
  const events = Array.from({ length: 251 }, (_, i) => JSON.stringify({ id: `capacity-${i}`, at: '2026-11-01T01:00:00Z', kind: 'group', direct: true, sender: '测试用户', text: `独立旧群聊记录编号${i}` }))
  writeFileSync(join(data, 'memory-inbox.jsonl'), events.join('\n') + '\n')
  const entries = Array.from({ length: 125 }, (_, i) => ({ id: `bili-capacity-${i}`, type: 'dynamic', at: '2026-11-01T01:00:00Z', text: `独立旧动态记录编号${i}` }))
  writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries }))
  const card = join(data, 'memory-card.json'), archive = join(data, 'memory-card-full.jsonl')
  const original = fs.renameSync; let writes = 0
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && ++writes === 1) throw new Error('simulated card failure')
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.snapshot(), /simulated card failure/); mock.mock.restore()
  const snapshot = await createMemoryService({ stateDir: dir }).snapshot()
  const records = readFileSync(archive, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(records.length, events.length + entries.length)
  assert.equal(new Set(records.map(record => record.id)).size, events.length + entries.length)
  assert.ok(snapshot.records.length <= 100)
})

test('manual memory evicted at capacity is archived even after interrupted save', async t => {
  const { dir, service } = make(t), paths = resolveMemoryCardPaths(join(dir, 'data'))
  mkdirSync(paths.dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ memoryCard: { maxRecords: 100, autoCompact: false } }))
  const card = createEmptyCard()
  for (let i = 0; i < 100; i++) addManualMemory(card, { text: `已有高重要度记录${i}`, importance: 90 }, { maxRecords: 100 }, Date.now() + i)
  writeFileSync(paths.json, JSON.stringify(card))
  await service.snapshot()
  const original = fs.renameSync; let fail = true
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === paths.json && fail) { fail = false; throw new Error('simulated manual save failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.action('add', { text: '低重要度的新记忆', importance: 1 }), /simulated manual save failure/)
  mock.mock.restore()
  await createMemoryService({ stateDir: dir }).snapshot()
  const records = readFileSync(paths.fullJsonl, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(records.filter(record => record.text === '低重要度的新记忆').length, 1)
})

test('legacy inbox import streams both files, yields, and preserves a final unterminated record', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl'), rotated = `${inbox}.1`
  const event = id => JSON.stringify({ id, at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: `旧记录${id}` })
  writeFileSync(rotated, Array.from({ length: 251 }, (_, i) => event(`old-${i}`)).join('\n') + '\n')
  writeFileSync(inbox, event('last'))
  const originalRead = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', function (file, ...args) { if (file === inbox || file === rotated) throw new Error('whole legacy inbox read forbidden'); return originalRead.call(this, file, ...args) })
  let yielded = false
  setImmediate(() => { yielded = true })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  const result = await service.snapshot()
  assert.equal(yielded, true)
  assert.ok(result.records.some(record => record.text.includes('旧记录last')))
  assert.ok(existsSync(join(data, 'legacy-imported.json')))
})

test('legacy inbox import reads every numbered rotation in oldest-first order', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl')
  for (const suffix of ['10', '2', '1', '']) {
    const event = { id: `rotation-${suffix || 'current'}`, at: '2026-11-01T01:00:00Z', kind: 'group', direct: true, text: `历史分卷${suffix || 'current'}` }
    writeFileSync(inbox + (suffix ? `.${suffix}` : ''), JSON.stringify(event) + '\n')
  }
  await service.snapshot()
  const archived = readFileSync(join(data, 'memory-card-full.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).text)
  assert.deepEqual(archived, ['历史分卷10', '历史分卷2', '历史分卷1', '历史分卷current'])
})

test('legacy inbox import refuses rotations added while taking snapshots', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl')
  const event = JSON.stringify({ id: 'rotated', kind: 'group', direct: true, text: '旧分卷测试消息' }) + '\n'
  writeFileSync(inbox, event)
  const original = fs.promises.copyFile; let added = false
  const mock = t.mock.method(fs.promises, 'copyFile', async function (source, target, ...args) {
    const result = await original.call(this, source, target, ...args)
    if (source === inbox && !added) { added = true; writeFileSync(`${inbox}.2`, event) }
    return result
  })
  await assert.rejects(service.snapshot(), /changed during import/)
  mock.mock.restore()
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
  assert.equal(existsSync(join(data, 'memory-card.json')), false)
})

test('invalid legacy inbox tail leaves card and import marker untouched', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl')
  const event = JSON.stringify({ id: 'old', at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '旧记忆' })
  const input = `${event}\n{broken`
  writeFileSync(inbox, input)
  await assert.rejects(service.snapshot())
  assert.equal(existsSync(join(data, 'memory-card.json')), false)
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
  assert.equal(readFileSync(inbox, 'utf8'), input)
})

test('legacy inbox changed during snapshot is not imported and temporary copies are removed', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl')
  const event = JSON.stringify({ id: 'old', at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '旧记忆' }) + '\n'
  writeFileSync(inbox, event)
  const original = fs.promises.copyFile.bind(fs.promises)
  t.mock.method(fs.promises, 'copyFile', async (source, destination, ...args) => { await original(source, destination, ...args); if (source === inbox) fs.appendFileSync(inbox, event) })
  await assert.rejects(service.snapshot(), /changed during import/)
  assert.equal(existsSync(join(data, 'memory-card.json')), false)
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
  assert.equal(fs.readdirSync(data).some(name => name.startsWith('.legacy-inbox-')), false)
})

test('legacy inbox changed during validation does not modify the card', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl')
  const event = JSON.stringify({ id: 'old', at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '旧记忆' }) + '\n'
  writeFileSync(inbox, event)
  const original = fs.promises.open.bind(fs.promises); let changed = false
  t.mock.method(fs.promises, 'open', async (file, ...args) => {
    const handle = await original(file, ...args)
    if (String(file).includes('.legacy-inbox-') && !changed) { changed = true; fs.appendFileSync(inbox, event) }
    return handle
  })
  await assert.rejects(service.snapshot(), /changed during import/)
  assert.equal(existsSync(join(data, 'memory-card.json')), false)
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
})

test('interrupted large legacy inbox import resumes without reapplying completed batches', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl'), card = join(data, 'memory-card.json')
  const events = Array.from({ length: 3251 }, (_, i) => JSON.stringify({ id: `old-${i}`, at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: `第${i}条独立旧记忆内容` }))
  writeFileSync(inbox, events.join('\n') + '\n')
  const original = fs.renameSync; let writes = 0
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && ++writes === 14) throw new Error('simulated interruption')
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.snapshot(), /simulated interruption/)
  mock.mock.restore()
  const before = JSON.parse(readFileSync(card, 'utf8')).stats.fromQq
  const resumed = createMemoryService({ stateDir: dir })
  await resumed.snapshot()
  const after = JSON.parse(readFileSync(card, 'utf8')).stats.fromQq
  assert.equal(after, before + 1)
  assert.ok(existsSync(join(data, 'legacy-imported.json')))
})

test('partial legacy import rejects changed inputs until the original data is restored', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const inbox = join(data, 'memory-inbox.jsonl'), card = join(data, 'memory-card.json')
  const events = Array.from({ length: 251 }, (_, i) => JSON.stringify({ id: `old-${i}`, at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: `旧记忆${i}` }))
  const input = events.join('\n') + '\n'; writeFileSync(inbox, input)
  const original = fs.renameSync; let writes = 0
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && ++writes === 2) throw new Error('simulated interruption')
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.snapshot(), /simulated interruption/); mock.mock.restore()
  const before = readFileSync(card, 'utf8')
  fs.appendFileSync(inbox, events[0] + '\n')
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /changed after partial progress/)
  assert.equal(readFileSync(card, 'utf8'), before)
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
  writeFileSync(inbox, input)
  await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(JSON.parse(readFileSync(card, 'utf8')).stats.fromQq, 251)
})

test('legacy import resumes without duplicating archive entries after card write fails', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const card = join(data, 'memory-card.json'), archive = join(data, 'memory-card-full.jsonl')
  const events = Array.from({ length: 251 }, (_, i) => JSON.stringify({ id: `archive-${i}`, at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: `归档旧记忆${i}` }))
  writeFileSync(join(data, 'memory-inbox.jsonl'), events.join('\n') + '\n')
  const original = fs.renameSync; let writes = 0
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && ++writes === 2) throw new Error('simulated card failure')
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.snapshot(), /simulated card failure/); mock.mock.restore()
  await createMemoryService({ stateDir: dir }).snapshot()
  const records = readFileSync(archive, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(records.length, 251)
  assert.equal(new Set(records.map(record => record.id)).size, 251)
})

test('legacy import preserves a partial archive append and refuses automatic recovery', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const archive = join(data, 'memory-card-full.jsonl')
  writeFileSync(join(data, 'memory-inbox.jsonl'), JSON.stringify({ id: 'legacy', at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '一条旧记忆' }) + '\n')
  const original = fs.appendFileSync; let injected = false
  const mock = t.mock.method(fs, 'appendFileSync', function (file, content, ...args) {
    if (file === archive && !injected) { injected = true; original.call(this, file, String(content).slice(0, 30), ...args); throw new Error('simulated partial write') }
    return original.call(this, file, content, ...args)
  })
  await assert.rejects(service.snapshot(), /simulated partial write/); mock.mock.restore()
  const partial = readFileSync(archive, 'utf8')
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /archive is incomplete/)
  assert.equal(readFileSync(archive, 'utf8'), partial)
  assert.ok(existsSync(join(data, 'legacy-import-inflight.json')))
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
})

test('legacy import rebuilds archive statistics when they fail after an append', async t => {
  const { dir, service } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const stats = join(data, 'memory-card-full-stats.json'), archive = join(data, 'memory-card-full.jsonl')
  writeFileSync(join(data, 'memory-inbox.jsonl'), JSON.stringify({ id: 'legacy', at: '2026-11-01T01:00:00Z', kind: 'private', isOwner: true, text: '需要恢复统计的旧记忆' }) + '\n')
  const original = fs.renameSync; let writes = 0
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === stats && ++writes === 2) throw new Error('simulated stats failure')
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.snapshot(), /simulated stats failure/); mock.mock.restore()
  await createMemoryService({ stateDir: dir }).snapshot()
  assert.equal(readFileSync(archive, 'utf8').trim().split('\n').length, 1)
  assert.equal(JSON.parse(readFileSync(stats, 'utf8')).records, 1)
})

test('legacy Bilibili records are neutralized before being ingested into the memory card', async t => {
  const { dir } = make(t), data = join(dir, 'data')
  mkdirSync(join(dir, 'surfcore'), { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ persona: { ownerTitle: '旧角色称呼' } }))
  const source = JSON.stringify({ entries: [{ id: 'dynamic:1', type: 'dynamic', text: '分享旧角色称呼的公开动态内容', at: '2026-11-01T01:00:00Z' }] })
  writeFileSync(join(data, 'bili-memory.json'), source)
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(biliMemory.ensureRoleFreeOutputs().ok, true)
  const snapshot = await createMemoryService({ stateDir: dir, biliMemory }).snapshot()
  assert.equal(snapshot.records.length, 1)
  assert.match(snapshot.records[0].text, /管理员/)
  assert.doesNotMatch(JSON.stringify(snapshot.records), /旧角色称呼/)
  assert.equal(readFileSync(join(data, 'bili-memory.json'), 'utf8'), source)
})

test('legacy Bilibili conversion retries after a transient startup failure without restarting', async t => {
  const { dir } = make(t), data = join(dir, 'data')
  mkdirSync(join(dir, 'surfcore'), { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ persona: { ownerTitle: '旧角色称呼' } }))
  const source = JSON.stringify({ entries: [{ id: 'dynamic:retry', type: 'dynamic', text: '分享旧角色称呼的公开动态', at: '2026-11-01T01:00:00Z' }] })
  writeFileSync(join(data, 'bili-memory.json'), source)
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧版简报')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const original = fs.renameSync
  const mock = t.mock.method(fs, 'renameSync', function (from, to, ...args) {
    if (to === join(data, 'bili-memory-brief.md')) throw new Error('simulated temporary failure')
    return original.call(this, from, to, ...args)
  })
  assert.equal(memory.ensureRoleFreeOutputs().ok, false)
  mock.mock.restore()
  const snapshot = await createMemoryService({ stateDir: dir, biliMemory: memory }).snapshot()
  assert.equal(snapshot.records.length, 1)
  assert.match(snapshot.records[0].text, /管理员/)
  assert.equal(readFileSync(join(data, 'bili-memory.json'), 'utf8'), source)
  assert.equal(memory.roleFreeStatus().ready, true)
})

test('legacy Bilibili conversion retry preserves a corrupt publication record', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const index = join(data, 'bili-memory.json'), journal = join(data, 'bili-publication-pending.json')
  const source = JSON.stringify({ entries: [{ id: 'old', type: 'dynamic', text: '旧公开动态' }] })
  writeFileSync(index, source); writeFileSync(journal, '{损坏')
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir })
  await assert.rejects(createMemoryService({ stateDir: dir, biliMemory }).snapshot(), /发布记录损坏/)
  assert.equal(readFileSync(index, 'utf8'), source)
  assert.equal(readFileSync(journal, 'utf8'), '{损坏')
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
})

test('legacy import resumes a pending Bilibili publication before checking for its index', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'bili-publication-pending.json')
  const entry = { id: 'dynamic:pending', type: 'dynamic', text: '尚未发布的公开动态', at: '2026-11-01T01:00:00Z' }
  writeFileSync(journal, JSON.stringify({ version: 1, outputs: { index: JSON.stringify({ entries: [entry] }), roleFree: JSON.stringify({ version: 2 }) } }))
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory })
  const snapshot = await service.snapshot()
  assert.ok(snapshot.records.some(record => record.text.includes('尚未发布的公开动态')))
  assert.equal(existsSync(journal), false)
  assert.ok(existsSync(join(data, 'legacy-imported.json')))
})

test('legacy import refuses a corrupt pending publication even when Bilibili index is absent', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'bili-publication-pending.json')
  writeFileSync(journal, '{损坏')
  const service = createMemoryService({ stateDir: dir, biliMemory: createBiliMemory({ stateDir: data, dshHome: dir }) })
  await assert.rejects(service.snapshot(), /发布记录损坏/)
  assert.equal(readFileSync(journal, 'utf8'), '{损坏')
  assert.equal(existsSync(join(data, 'legacy-imported.json')), false)
})

test('existing memory imports an interrupted Bilibili publication without a refresh intent', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const journal = join(data, 'bili-publication-pending.json')
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const entry = { id: 'dynamic:adopt', type: 'dynamic', text: '现有记忆恢复的公开动态', at: '2026-11-01T01:00:00Z' }
  writeFileSync(journal, JSON.stringify({ version: 1, outputs: { index: JSON.stringify({ entries: [entry] }), roleFree: JSON.stringify({ version: 2 }) } }))
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory })
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('现有记忆恢复的公开动态')))
  assert.equal(existsSync(journal), false)
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
  assert.equal((await createMemoryService({ stateDir: dir, biliMemory }).snapshot()).records.length, 1)
})

test('adopted Bilibili publication resumes when staging its card import fails', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const entry = { id: 'dynamic:adopt-retry', type: 'dynamic', text: '恢复阶段的公开动态', at: '2026-11-01T01:00:00Z' }
  writeFileSync(join(data, 'bili-publication-pending.json'), JSON.stringify({ version: 1, outputs: { index: JSON.stringify({ entries: [entry] }), roleFree: JSON.stringify({ version: 2 }) } }))
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir }), service = createMemoryService({ stateDir: dir, biliMemory })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (from, to, ...args) {
    if (to === join(data, 'bili-refresh-pending.json') && !failed) { failed = true; throw new Error('staging failed') }
    return original.call(this, from, to, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.snapshot(), /staging failed/); mock.mock.restore(); syncBuiltinESMExports()
  assert.ok(existsSync(join(data, 'bili-refresh-intent.json')))
  const recovered = await createMemoryService({ stateDir: dir, biliMemory }).snapshot()
  assert.equal(recovered.records.filter(record => record.text.includes('恢复阶段的公开动态')).length, 1)
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
})

test('existing Bilibili card records are neutralized in prompts while originals remain intact', async t => {
  const { dir } = make(t), data = join(dir, 'data')
  mkdirSync(join(dir, 'surfcore'), { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ persona: { ownerTitle: '旧角色称呼' } }))
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory })
  await service.action('add', { text: '分享旧角色称呼的公开动态内容', scope: 'bili' })
  assert.match(JSON.stringify((await service.snapshot()).records), /旧角色称呼/)
  const text = await service.context('qq')
  assert.match(text, /管理员/)
  assert.doesNotMatch(text, /旧角色称呼/)
  assert.doesNotMatch((await service.previews()).qq, /旧角色称呼/)
  assert.match(readFileSync(join(data, 'memory-card.json'), 'utf8'), /旧角色称呼/)
})

test('disposing memory drains queued session writes and rejects new session operations', async t => {
  const { dir, service } = make(t), store = service.sessions
  const writes = Array.from({ length: 30 }, (_, index) => store.write('group:1234', { activeTopics: [{ text: `话题 ${index}` }] }, index))
  const all = Promise.all(writes)
  await service.dispose()
  const restored = await createSessionMemoryStore({ stateDir: dir }).read('group:1234')
  await all
  assert.equal(restored.revision, 30)
  assert.equal(restored.value.activeTopics[0].text, '话题 29')
  await assert.rejects(store.write('group:1234', { activeTopics: [] }, 30), /关闭|stopped|disposed/i)
})

test('disposing memory cancels an in-flight Bilibili network refresh before publication', { timeout: 5000 }, async t => {
  const { dir } = make(t), data = join(dir, 'data'), bili = join(dir, 'surfcore/bili')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { mid: '123456' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
  let entered, release
  const started = new Promise(resolve => { entered = resolve })
  t.after(() => release?.())
  t.mock.method(globalThis, 'fetch', async (_url, { signal }) => {
    entered()
    return new Promise((resolve, reject) => {
      release = () => resolve(new Response(JSON.stringify({ code: 0, data: { items: [] } })))
      if (signal.aborted) reject(signal.reason)
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    })
  })
  const source = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  const refresh = service.refreshBili().catch(error => error)
  await started
  await service.dispose()
  assert.ok(await refresh instanceof Error)
  assert.equal(existsSync(join(data, 'bili-memory.json')), false)
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
  await assert.rejects(service.snapshot(), /关闭|stopped|disposed/i)
})

test('disposing memory waits for a Bilibili publication already in progress', { timeout: 5000 }, async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  let entered, release, finished = false
  const started = new Promise(resolve => { entered = resolve }), waiting = new Promise(resolve => { release = resolve })
  t.after(() => release())
  const source = { supportsStagedRefresh: true, refresh: async ({ commit }) => commit(async () => {
    entered(); await waiting
    writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries: [{ id: 'test', type: 'dynamic', text: '需要完整导入的公开记忆' }] }))
    return { ok: true }
  }) }
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  const refresh = service.refreshBili(); await started
  const dispose = service.dispose().then(() => { finished = true })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(finished, false)
  release(); await refresh; await dispose
  assert.equal(finished, true)
  const recovered = await createMemoryService({ stateDir: dir }).snapshot()
  assert.match(JSON.stringify(recovered.records), /需要完整导入的公开记忆/)
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
})

test('Bilibili network refresh does not block unrelated memory writes', { timeout: 5000 }, async t => {
  const { dir } = make(t), data = join(dir, 'data'), bili = join(dir, 'surfcore/bili')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { mid: '123456' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
  let release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  t.mock.method(globalThis, 'fetch', async () => { entered(); await waiting; return new Response(JSON.stringify({ code: 0, data: { items: [] } })) })
  const source = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  const refresh = service.refreshBili()
  await started
  const action = service.action('add', { text: '网络等待期间新增的记忆', scope: 'qq' })
  const completed = await Promise.race([action.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 200))])
  release()
  await refresh
  await action
  assert.equal(completed, true, 'memory writes should finish before the network responds')
  assert.match(JSON.stringify((await service.snapshot()).records), /网络等待期间新增的记忆/)
})

test('disabling Bilibili auto sync while network is pending prevents publication', { timeout: 5000 }, async t => {
  const { dir } = make(t), data = join(dir, 'data'), bili = join(dir, 'surfcore/bili')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { mid: '123456' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
  let release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  t.mock.method(globalThis, 'fetch', async () => { entered(); await waiting; return new Response(JSON.stringify({ code: 0, data: { items: [] } })) })
  const source = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  await service.updateSyncSettings({ enabled: true })
  const refresh = service.autoRefreshBili(1000000)
  await started
  await service.updateSyncSettings({ enabled: false })
  release()
  assert.equal((await refresh).skipped, true)
  assert.equal(existsSync(join(data, 'bili-memory.json')), false)
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
})

test('staged Bilibili publication recovers an interruption before card import', async t => {
  const { dir } = make(t), data = join(dir, 'data'), bili = join(dir, 'surfcore/bili')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  const bv = 'BV1234567890'
  writeFileSync(join(bili, 'favorites.json'), JSON.stringify({ items: [{ bv, title: '测试视频', reason: '一段公开的视频见闻' }] }))
  writeFileSync(join(data, 'bili-video-titles.json'), JSON.stringify({ items: { [bv]: { title: '测试视频' } } }))
  const source = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (from, to, ...args) {
    if (to === join(data, 'bili-refresh-pending.json') && !failed) { failed = true; throw new Error('模拟导入标记写入失败') }
    return original.call(this, from, to, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.refreshBili(), /模拟导入标记写入失败/)
  mock.mock.restore(); syncBuiltinESMExports()
  const restored = await createMemoryService({ stateDir: dir, biliMemory: source }).snapshot()
  assert.match(JSON.stringify(restored.records), /一段公开的视频见闻/)
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
})

test('Bilibili refresh runs in the memory service and imports its public entries', async (t) => {
  const { dir } = make(t)
  const fake = {
    refresh: async () => {
      mkdirSync(join(dir, 'data'), { recursive: true })
      writeFileSync(join(dir, 'data/bili-memory.json'), JSON.stringify({ entries: [{ id: 'refreshed-1', type: 'dynamic', text: '公开的视频见闻' }] }))
      return { ok: true }
    },
    status: () => ({ entries: 1 }), recordShare: () => {},
  }
  const service = createMemoryService({ stateDir: dir, biliMemory: fake })
  assert.equal((await service.refreshBili()).ok, true)
  assert.match((await service.snapshot()).records[0].text, /公开的视频见闻/)
  assert.equal((await service.biliStatus()).entries, 1)
})

test('Bilibili output publication resumes after a partial write without exposing mixed versions', async t => {
  const { dir } = make(t), data = join(dir, 'memory-data'), bili = join(dir, 'surfcore/bili')
  mkdirSync(data, { recursive: true }); mkdirSync(bili, { recursive: true })
  writeFileSync(join(data, 'bili-memory.md'), '旧文档')
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧简报')
  writeFileSync(join(data, 'bili-memory.json'), '{"entries":[]}')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":2}')
  writeFileSync(join(bili, 'whale-diary.md'), '## 2026-11-01\n发现了有趣的天空和可爱的小猫。\n')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === join(data, 'bili-memory.json') && !failed) { failed = true; throw new Error('模拟索引写入失败') }
    return original.call(this, source, destination, ...args)
  })
  const result = await memory.refresh({ force: true })
  assert.equal(result.ok, false); assert.match(result.error, /模拟索引写入失败/)
  assert.equal(memory.briefBlock(), '')
  assert.equal(memory.roleFreeStatus().ready, false)
  mock.mock.restore()
  const restarted = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(restarted.ensureRoleFreeOutputs().ok, true)
  assert.equal(restarted.roleFreeStatus().ready, true)
  assert.notEqual(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '旧简报')
  assert.ok(Array.isArray(JSON.parse(readFileSync(join(data, 'bili-memory.json'), 'utf8')).entries))
})

test('damaged Bilibili publication record blocks output without overwriting existing files', t => {
  const { dir } = make(t), data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'bili-memory-brief.md'), '需要保留的简报')
  writeFileSync(join(data, 'bili-memory.json'), '{"entries":[]}')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":2}')
  const journal = join(data, 'bili-publication-pending.json'); writeFileSync(journal, '{损坏')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(memory.briefBlock(), '')
  assert.match(memory.ensureRoleFreeOutputs().error, /发布记录损坏/)
  assert.equal(readFileSync(journal, 'utf8'), '{损坏')
  assert.equal(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '需要保留的简报')
})

test('Bilibili share history reports write failure instead of claiming a recorded share', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'bili-share-history.json')
  const biliMemory = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory })
  await service.recordBiliShare('first', 'slot-1')
  const original = readFileSync(file, 'utf8'), rename = fs.renameSync
  const mocked = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === file) throw new Error('模拟磁盘写入失败')
    return rename.call(this, source, destination, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mocked.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.recordBiliShare('second', 'slot-2'), /模拟磁盘写入失败/)
  assert.equal(readFileSync(file, 'utf8'), original)
})

test('damaged Bilibili share history is not treated as an empty history or overwritten', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'bili-share-history.json'), memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: memory, qqFeedFile: join(dir, 'qq-state/qq-public-feed.jsonl') })
  writeFileSync(file, '{损坏')
  await assert.rejects(service.recordBiliShare('item', 'slot'), /分享历史.*损坏/)
  assert.throws(() => memory.lastSlot('slot'), /分享历史.*损坏/)
  assert.equal(readFileSync(file, 'utf8'), '{损坏')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":2}')
  writeFileSync(join(data, 'bili-memory.json'), '{"entries":[]}')
  assert.throws(() => memory.pickShareCard(), /分享历史.*损坏/)
  writeFileSync(file, '{"used":[]}')
  await assert.rejects(service.recordBiliShare('item', 'slot'), /分享历史.*损坏/)
  assert.equal(readFileSync(file, 'utf8'), '{"used":[]}')
})

test('Bilibili share history backups restore valid state while preserving damaged data', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const file = join(data, 'bili-share-history.json'), memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const service = createMemoryService({ stateDir: dir, biliMemory: memory, qqFeedFile: join(dir, 'qq-state/qq-public-feed.jsonl') })
  await service.recordBiliShare('first', 'slot-1')
  await service.recordBiliShare('second', 'slot-2')
  const backups = (await service.biliShareHistoryBackups()).backups
  assert.equal(backups.length, 1)
  writeFileSync(file, '{损坏')
  await assert.rejects(service.restoreBiliShareHistory('../outside'), /invalid/i)
  const restored = await service.restoreBiliShareHistory(backups[0])
  assert.ok(restored.preserved)
  assert.equal(readFileSync(join(data, 'backups/share-history', restored.preserved), 'utf8'), '{损坏')
  assert.ok(memory.lastSlot('slot-1'))
  assert.equal(memory.lastSlot('slot-2'), '')
  assert.equal((await service.biliShareHistoryBackups()).backups.length, 1)
  const rollback = await service.restoreBiliShareHistory(backups[0])
  assert.match(rollback.preserved, /^history-/)
  assert.equal((await service.biliShareHistoryBackups()).backups.length, 2)
  const backupFile = join(data, 'backups/share-history', backups[0])
  writeFileSync(backupFile, '{无效备份')
  const before = readFileSync(file, 'utf8')
  await assert.rejects(service.restoreBiliShareHistory(backups[0]), /损坏/)
  assert.equal(readFileSync(file, 'utf8'), before)
})

test('Bilibili share history restore requires an idle QQ bridge and releases locks on failure', async t => {
  const { dir } = make(t), data = join(dir, 'data'), qqDir = join(dir, 'qq-state'); mkdirSync(data, { recursive: true }); mkdirSync(qqDir, { recursive: true })
  const memory = createBiliMemory({ stateDir: data, dshHome: dir }), service = createMemoryService({ stateDir: dir, biliMemory: memory, qqFeedFile: join(qqDir, 'qq-public-feed.jsonl') })
  await service.recordBiliShare('first', 'slot-1'); await service.recordBiliShare('second', 'slot-2')
  const [name] = (await service.biliShareHistoryBackups()).backups, file = join(data, 'bili-share-history.json'), before = readFileSync(file, 'utf8')
  writeFileSync(join(qqDir, 'bridge.lock'), String(process.pid))
  await assert.rejects(service.restoreBiliShareHistory(name), /停止 QQ 桥接/)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal(existsSync(join(qqDir, 'bridge-maintenance.lock')), false)
  rmSync(join(qqDir, 'bridge.lock'))
  await assert.rejects(service.restoreBiliShareHistory('../bad'), /invalid/i)
  assert.equal(existsSync(join(qqDir, 'bridge.lock')), false)
  assert.equal(existsSync(join(qqDir, 'bridge-maintenance.lock')), false)
  await service.restoreBiliShareHistory(name)
  assert.equal(existsSync(join(qqDir, 'bridge.lock')), false)
  assert.equal(existsSync(join(qqDir, 'bridge-maintenance.lock')), false)
})

test('Bilibili share history recovery HTTP requires a local authenticated session', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const memory = createBiliMemory({ stateDir: data, dshHome: dir }), service = createMemoryService({ stateDir: dir, biliMemory: memory, qqFeedFile: join(dir, 'qq-state/qq-public-feed.jsonl') })
  await service.recordBiliShare('first', 'slot-1'); await service.recordBiliShare('second', 'slot-2')
  const [name] = (await service.biliShareHistoryBackups()).backups
  writeFileSync(join(data, 'bili-share-history.json'), '{损坏')
  let handler
  registerMemoryHttp({ webServer: { register: route => { handler = route.handler; return () => {} } }, get: () => ({ requestRejection: req => req.headers.cookie ? null : 401 }) }, service)
  async function request(url, { method = 'GET', auth = true, origin, body } = {}) {
    const req = Readable.from(body ? [JSON.stringify(body)] : [])
    Object.assign(req, { url, method, headers: { host: '127.0.0.1:3082', ...(auth ? { cookie: 'session=ok' } : {}), ...(origin ? { origin } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } })
    let status, data; await handler(req, { writeHead: code => { status = code }, end: text => { data = JSON.parse(text) } }); return { status, data }
  }
  assert.equal((await request('/dsh-memory/api/bili/share-history/backups', { auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/bili/share-history/restore', { method: 'POST', body: { name }, origin: 'https://example.com' })).status, 403)
  assert.deepEqual((await request('/dsh-memory/api/bili/share-history/backups')).data.backups, [name])
  assert.equal((await request('/dsh-memory/api/bili/share-history/restore', { method: 'POST', body: { name }, auth: false })).status, 401)
  assert.equal((await request('/dsh-memory/api/bili/share-history/restore', { method: 'POST', body: { name } })).status, 200)
  assert.ok(memory.lastSlot('slot-1'))
})

test('interrupted Bilibili refresh resumes all batches offline without duplicating the archive', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const card = join(data, 'memory-card.json'), archive = join(data, 'memory-card-full.jsonl')
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const entries = Array.from({ length: 251 }, (_, i) => ({ id: `bili-${i}`, type: 'dynamic', text: `公开动态编号${i}`, at: '2026-11-01T01:00:00Z' }))
  let refreshes = 0
  const service = createMemoryService({ stateDir: dir, biliMemory: { refresh: async () => { refreshes++; writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries })); return { ok: true } } } })
  const original = fs.renameSync; let writes = 0
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && ++writes === 2) throw new Error('simulated card failure')
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.refreshBili(), /simulated card failure/); mock.mock.restore()
  await createMemoryService({ stateDir: dir }).snapshot()
  const records = readFileSync(archive, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(records.length, 251)
  assert.equal(new Set(records.map(record => record.id)).size, 251)
  assert.equal(JSON.parse(readFileSync(card, 'utf8')).stats.fromBili, 251)
  assert.equal(refreshes, 1)
})

test('Bilibili refresh resumes import when failure occurs after publishing the index', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const entry = { id: 'gap-1', type: 'dynamic', text: '发布后尚未导入的动态', at: '2026-11-01T01:00:00Z' }
  let refreshes = 0
  const source = { refresh: async () => { refreshes++; writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries: [entry] })); return { ok: true } } }
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === join(data, 'bili-refresh-pending.json') && !failed) { failed = true; throw new Error('模拟导入标记写入失败') }
    return original.call(this, source, destination, ...args)
  })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  await assert.rejects(service.refreshBili(), /模拟导入标记写入失败/)
  mock.mock.restore(); syncBuiltinESMExports()
  const restarted = createMemoryService({ stateDir: dir, biliMemory: source })
  assert.match(JSON.stringify((await restarted.snapshot()).records), /发布后尚未导入的动态/)
  assert.equal(refreshes, 1)
  const archive = readFileSync(join(data, 'memory-card-full.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(archive.length, 1)
  await restarted.snapshot()
  assert.equal(readFileSync(join(data, 'memory-card-full.jsonl'), 'utf8').trim().split('\n').length, 1)
})

test('failed Bilibili refresh before publishing does not import the old index', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries: [{ id: 'old', type: 'dynamic', text: '旧索引不应被重新导入' }] }))
  const source = { refresh: async () => ({ ok: false, error: '模拟刷新失败' }) }
  const service = createMemoryService({ stateDir: dir, biliMemory: source })
  await assert.rejects(service.refreshBili(), /模拟刷新失败/)
  const restarted = createMemoryService({ stateDir: dir, biliMemory: source })
  assert.deepEqual((await restarted.snapshot()).records, [])
  assert.equal(existsSync(join(data, 'bili-refresh-intent.json')), false)
})

test('Bilibili refresh recovery rejects a modified saved batch without changing the card', async t => {
  const { dir } = make(t), data = join(dir, 'data'); mkdirSync(data, { recursive: true })
  const card = join(data, 'memory-card.json'), pending = join(data, 'bili-refresh-pending.json')
  writeFileSync(join(data, 'legacy-imported.json'), '{}')
  const entries = [{ id: 'bili-1', type: 'dynamic', text: '公开动态', at: '2026-11-01T01:00:00Z' }]
  const service = createMemoryService({ stateDir: dir, biliMemory: { refresh: async () => { writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries })); return { ok: true } } } })
  const original = fs.renameSync; let failed = false
  const mock = t.mock.method(fs, 'renameSync', function (source, destination, ...args) {
    if (destination === card && !failed) { failed = true; throw new Error('simulated card failure') }
    return original.call(this, source, destination, ...args)
  })
  await assert.rejects(service.refreshBili(), /simulated card failure/); mock.mock.restore()
  const saved = JSON.parse(readFileSync(pending, 'utf8')); saved.entries[0].text = '被修改的内容'
  const damaged = JSON.stringify(saved); writeFileSync(pending, damaged)
  await assert.rejects(createMemoryService({ stateDir: dir }).snapshot(), /recovery data is invalid/)
  assert.equal(readFileSync(pending, 'utf8'), damaged)
  assert.equal(existsSync(card), false)
})

test('Bilibili brief preview reports privacy blocks without exposing unsafe text', async t => {
  const { dir } = make(t)
  let text = '公开的视频见闻\n边界：B 站私信里的内容不在我的记忆里。'
  const service = createMemoryService({ stateDir: dir, biliMemory: { briefBlock: () => text, status: () => ({ generatedAt: 'now' }) } })
  assert.equal((await service.biliBriefPreview()).text, text)
  text = 'password=unsafe-secret'
  const blocked = await service.biliBriefPreview()
  assert.equal(blocked.blocked, true)
  assert.equal(blocked.text, '')
  await service.updateSettings({ includeBiliInQq: false })
  assert.equal((await service.biliBriefPreview()).enabled, false)
})

test('automatic Bilibili refresh is opt-in, respects its interval and the memory master switch', async t => {
  const { dir } = make(t)
  let refreshes = 0
  const service = createMemoryService({ stateDir: dir, biliMemory: { refresh: async () => { refreshes++; return { ok: true } } } })
  assert.equal((await service.autoRefreshBili(1000000)).skipped, true)
  assert.equal(refreshes, 0)
  await service.updateSyncSettings({ enabled: true, intervalMs: 300000 })
  await service.autoRefreshBili(1000000)
  await service.autoRefreshBili(1100000)
  assert.equal(refreshes, 1)
  await service.autoRefreshBili(1300000)
  assert.equal(refreshes, 2)
  await service.updateSettings({ enabled: false })
  await service.autoRefreshBili(2000000)
  assert.equal(refreshes, 2)
})

test('default Bilibili refresh interval matches the original ten minutes and stays disabled', async t => {
  const { service } = make(t)
  const sync = (await service.snapshot()).sync
  assert.equal(sync.enabled, false)
  assert.equal(sync.intervalMs, 600000)
  await service.updateSyncSettings({ intervalMs: 1800000 })
  assert.equal((await service.snapshot()).sync.intervalMs, 1800000)
})

test('queued Bilibili auto refresh respects a preceding disable request', { timeout: 5000 }, async t => {
  const { dir } = make(t)
  let calls = 0, release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  t.after(() => release())
  const service = createMemoryService({ stateDir: dir, biliMemory: { refresh: async () => { calls++; if (calls === 1) { entered(); await waiting } return { ok: true } } } })
  await service.updateSyncSettings({ enabled: true })
  const manual = service.refreshBili()
  await started
  const disable = service.updateSyncSettings({ enabled: false })
  const automatic = service.autoRefreshBili(1000000)
  release()
  await manual; await disable
  assert.equal((await automatic).skipped, true)
  assert.equal(calls, 1)
})

test('Bilibili account paths use the supplied project-local DSH home', (t) => {
  const { dir } = make(t)
  const paths = resolveBiliPaths(undefined, dir)
  assert.equal(paths.config, join(dir, 'surfcore/bili.config.json'))
  assert.equal(paths.credentials, join(dir, 'surfcore/bili/credentials.json'))
})

test('Bilibili memory uses account identity without importing a legacy persona name', async t => {
  const { dir } = make(t)
  mkdirSync(join(dir, 'surfcore'), { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { name: '公开账号' }, persona: { name: '旧角色名' } }))
  const memory = createBiliMemory({ stateDir: join(dir, 'memory-data'), dshHome: dir })
  const result = await memory.refresh({ force: true })
  assert.equal(result.ok, true)
  const brief = readFileSync(join(dir, 'memory-data/bili-memory-brief.md'), 'utf8')
  const doc = readFileSync(join(dir, 'memory-data/bili-memory.md'), 'utf8')
  assert.match(brief, /公开账号/)
  assert.doesNotMatch(`${brief}\n${doc}`, /旧角色名/)
})

test('Bilibili memory does not import legacy persona titles when anonymizing public content', async t => {
  const { dir } = make(t), data = join(dir, 'memory-data')
  mkdirSync(join(dir, 'surfcore'), { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { name: '公开账号' }, owner: { name: '管理员昵称' }, persona: { ownerTitle: '旧角色专属称呼' } }))
  writeFileSync(join(data, 'bili-dynamics-cache.json'), JSON.stringify({ at: Date.now(), items: [{ id: '123', text: '这是一条提到管理员昵称的公开动态内容' }] }))
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal((await memory.refresh({ force: true })).ok, true)
  const doc = readFileSync(join(data, 'bili-memory.md'), 'utf8')
  const index = readFileSync(join(data, 'bili-memory.json'), 'utf8')
  assert.doesNotMatch(doc + index, /旧角色专属称呼|管理员昵称/)
  assert.match(index, /管理员/)
})

test('Bilibili video title failures are remembered across refreshes and renewed after expiry', async t => {
  const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  const bv = 'BV1234567890', cache = join(data, 'bili-video-titles.json')
  writeFileSync(join(bili, 'favorites.json'), JSON.stringify({ items: [{ bv, title: '测试视频' }] }))
  let requests = 0
  t.mock.method(globalThis, 'fetch', async () => { requests++; return new Response(JSON.stringify({ code: -1 })) })
  const refresh = () => createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
  assert.equal((await refresh()).ok, true)
  assert.equal(requests, 1)
  assert.equal((await refresh()).ok, true)
  assert.equal(requests, 1, 'a recent failed request should not be repeated after restart')
  const saved = JSON.parse(readFileSync(cache, 'utf8'))
  saved.items[bv].failedAt = '2000-01-01T00:00:00.000Z'
  writeFileSync(cache, JSON.stringify(saved))
  assert.equal((await refresh()).ok, true)
  assert.equal(requests, 2, 'an expired failure should be retried')
  assert.equal((await refresh()).ok, true)
  assert.equal(requests, 2, 'a repeated failure should renew its retry delay')
})

test('Bilibili memory refresh refuses corrupt source data without replacing prior memory', async t => {
  const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(bili, 'scores.json'), '{corrupt')
  const oldIndex = '{"entries":[{"text":"保留原有记忆"}]}'
  writeFileSync(join(data, 'bili-memory.json'), oldIndex)
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧摘要')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":1}')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const result = await memory.refresh({ force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /scores\.json/)
  assert.equal(readFileSync(join(data, 'bili-memory.json'), 'utf8'), oldIndex)
  assert.equal(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '旧摘要')
  assert.equal(readFileSync(join(bili, 'scores.json'), 'utf8'), '{corrupt')
})

test('Bilibili memory refresh refuses a damaged existing index and preserves it', async t => {
  for (const damaged of ['{broken', JSON.stringify({ entries: 'not an array' })]) {
    const { dir } = make(t), data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
    const index = join(data, 'bili-memory.json'), brief = join(data, 'bili-memory-brief.md')
    writeFileSync(index, damaged); writeFileSync(brief, '原有摘要')
    const result = await createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
    assert.equal(result.ok, false)
    assert.match(result.error, /bili-memory\.json/)
    assert.equal(readFileSync(index, 'utf8'), damaged)
    assert.equal(readFileSync(brief, 'utf8'), '原有摘要')
  }
})

test('Bilibili memory refresh does not overwrite an index changed while awaiting a response', async t => {
  const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { mid: '123456' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
  const index = join(data, 'bili-memory.json'), brief = join(data, 'bili-memory-brief.md')
  writeFileSync(index, '{"entries":[]}'); writeFileSync(brief, '原有摘要')
  let release, reached
  const pending = new Promise(resolve => { release = resolve }), fetching = new Promise(resolve => { reached = resolve })
  const mock = t.mock.method(globalThis, 'fetch', async () => { reached(); await pending; return new Response('{"code":0,"data":{"items":[]}}', { status: 200 }) })
  t.after(() => { release(); mock.mock.restore() })
  const operation = createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
  await fetching
  const newer = JSON.stringify({ entries: [{ id: 'dynamic:new', type: 'dynamic', text: '并发更新的记忆' }] })
  writeFileSync(index, newer); release()
  const result = await operation
  assert.equal(result.ok, false)
  assert.match(result.error, /变化/)
  assert.equal(readFileSync(index, 'utf8'), newer)
  assert.equal(readFileSync(brief, 'utf8'), '原有摘要')
})

test('Bilibili memory refresh rejects malformed score lists without replacing earlier memory', async t => {
  const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  const scores = join(bili, 'scores.json'), originalScores = JSON.stringify({ '2026-10-30': { bv: 'BV1234567890', score: 10 } })
  const index = join(data, 'bili-memory.json'), originalIndex = JSON.stringify({ entries: [{ type: 'video', text: '先前的公开视频记忆' }] })
  writeFileSync(scores, originalScores); writeFileSync(index, originalIndex); writeFileSync(join(data, 'bili-memory-brief.md'), '旧摘要')
  const result = await createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /scores\.json/)
  assert.equal(readFileSync(scores, 'utf8'), originalScores)
  assert.equal(readFileSync(index, 'utf8'), originalIndex)
  assert.equal(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '旧摘要')
})

test('Bilibili memory refresh preserves previous outputs when the diary cannot be read', async t => {
  const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  const diary = join(bili, 'whale-diary.md'), index = join(data, 'bili-memory.json'), brief = join(data, 'bili-memory-brief.md')
  writeFileSync(diary, '原始日记'); const previous = JSON.stringify({ entries: [{ type: 'diary', text: '原有记忆' }] })
  writeFileSync(index, previous); writeFileSync(brief, '原有摘要')
  const original = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', function (file, ...args) {
    if (file === diary) { const error = new Error('simulated diary permission error'); error.code = 'EACCES'; throw error }
    return original.call(this, file, ...args)
  })
  t.after(() => mock.mock.restore())
  const result = await createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /diary permission error/)
  assert.equal(original(index, 'utf8'), previous)
  assert.equal(original(brief, 'utf8'), '原有摘要')
  assert.equal(original(diary, 'utf8'), '原始日记')
})

test('Bilibili memory refresh refuses damaged dynamics and video-title caches', async t => {
  for (const name of ['bili-dynamics-cache.json', 'bili-video-titles.json']) {
    const { dir } = make(t), data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
    const file = join(data, name), index = join(data, 'bili-memory.json'), brief = join(data, 'bili-memory-brief.md')
    const previous = JSON.stringify({ entries: [{ type: 'diary', text: '原有记忆' }] })
    writeFileSync(file, '{damaged'); writeFileSync(index, previous); writeFileSync(brief, '原有摘要')
    const result = await createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
    assert.equal(result.ok, false, name)
    assert.match(result.error, new RegExp(name.replaceAll('.', '\\.')))
    assert.equal(readFileSync(file, 'utf8'), '{damaged')
    assert.equal(readFileSync(index, 'utf8'), previous)
    assert.equal(readFileSync(brief, 'utf8'), '原有摘要')
  }
})

test('Bilibili memory refresh reports damaged credentials and preserves previous outputs', async t => {
  const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
  mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { mid: '123456' } }))
  const credentials = join(bili, 'credentials.json'), index = join(data, 'bili-memory.json'), brief = join(data, 'bili-memory-brief.md')
  const oldIndex = JSON.stringify({ entries: [{ type: 'diary', text: '原有记忆' }] })
  writeFileSync(credentials, '{broken'); writeFileSync(index, oldIndex); writeFileSync(brief, '原有摘要')
  const result = await createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /credentials\.json/)
  assert.equal(readFileSync(credentials, 'utf8'), '{broken')
  assert.equal(readFileSync(index, 'utf8'), oldIndex)
  assert.equal(readFileSync(brief, 'utf8'), '原有摘要')
})

test('Bilibili memory preserves prior dynamics when fetch fails and cache is absent', async t => {
  const { dir } = make(t), data = join(dir, 'memory-data')
  mkdirSync(data, { recursive: true })
  const oldIndex = JSON.stringify({ entries: [{ id: 'dynamic:123', type: 'dynamic', text: '之前保存的公开动态内容' }] })
  writeFileSync(join(data, 'bili-memory.json'), oldIndex)
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧摘要')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":1}')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const result = await memory.refresh({ force: true })
  assert.equal(result.ok, false)
  assert.match(result.error, /动态/)
  assert.equal(readFileSync(join(data, 'bili-memory.json'), 'utf8'), oldIndex)
  assert.equal(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '旧摘要')
})

test('Bilibili memory keeps prior dynamics when a successful-looking response is incomplete', async t => {
  for (const response of [{ code: 0, data: {} }, { code: 0, data: { items: [{}] } }]) {
    const { dir } = make(t), bili = join(dir, 'surfcore/bili'), data = join(dir, 'memory-data')
    mkdirSync(bili, { recursive: true }); mkdirSync(data, { recursive: true })
    writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { mid: '123456' } }))
    writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'fixture', bili_jct: 'fixture', buvid3: 'fixture' }))
    const index = join(data, 'bili-memory.json'), brief = join(data, 'bili-memory-brief.md')
    const original = JSON.stringify({ entries: [{ id: 'dynamic:123', type: 'dynamic', text: '原有公开动态' }] })
    writeFileSync(index, original); writeFileSync(brief, '原有摘要')
    const mock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(response), { status: 200 }))
    try {
      const result = await createBiliMemory({ stateDir: data, dshHome: dir }).refresh({ force: true })
      assert.equal(result.ok, false)
      assert.match(result.error, /动态/)
      assert.equal(readFileSync(index, 'utf8'), original)
      assert.equal(readFileSync(brief, 'utf8'), '原有摘要')
    } finally { mock.mock.restore() }
  }
})

test('Bilibili memory can refresh offline when its dynamics cache covers prior entries', async t => {
  const { dir } = make(t), data = join(dir, 'memory-data')
  mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries: [{ id: 'dynamic:123', type: 'dynamic' }] }))
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":1}')
  writeFileSync(join(data, 'bili-dynamics-cache.json'), JSON.stringify({ at: Date.now(), items: [{ id: '123', text: '之前保存的公开动态内容' }] }))
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  const result = await memory.refresh({ force: true })
  assert.equal(result.ok, true)
  const index = JSON.parse(readFileSync(join(data, 'bili-memory.json'), 'utf8'))
  assert.ok(index.entries.some(entry => entry.id === 'dynamic:123'))
})

test('Bilibili memory uses a newer QQ bridge dynamics cache when offline', async t => {
  const { dir } = make(t), data = join(dir, 'memory-data'), bridge = join(dir, 'qq-state')
  mkdirSync(data, { recursive: true }); mkdirSync(bridge, { recursive: true })
  const own = join(data, 'bili-dynamics-cache.json'), feed = join(bridge, 'bili-dynamics-cache.json')
  writeFileSync(own, JSON.stringify({ at: Date.now() - 60000, items: [{ id: 'old', text: '之前看到的公开动态' }] }))
  writeFileSync(feed, JSON.stringify({ at: Date.now(), items: [{ id: 'new', text: '桥接刚获取的公开动态' }] }))
  const source = createBiliMemory({ stateDir: data, dshHome: dir, qqDynamicsCacheFile: feed })
  const result = await source.refresh({ force: true })
  assert.equal(result.ok, true)
  const entries = JSON.parse(readFileSync(join(data, 'bili-memory.json'), 'utf8')).entries
  assert.ok(entries.some(entry => entry.id === 'dynamic:new'))
  assert.equal(JSON.parse(readFileSync(own, 'utf8')).items[0].id, 'old')
  assert.equal(JSON.parse(readFileSync(feed, 'utf8')).items[0].id, 'new')
})

test('Bilibili memory retains its own dynamics cache when the bridge cache is older or damaged', async t => {
  for (const bridgeData of [JSON.stringify({ at: Date.now() - 60000, items: [{ id: 'old', text: '过期动态' }] }), '{invalid']) {
    const { dir } = make(t), data = join(dir, 'memory-data'), bridge = join(dir, 'qq-state')
    mkdirSync(data, { recursive: true }); mkdirSync(bridge, { recursive: true })
    const feed = join(bridge, 'bili-dynamics-cache.json')
    writeFileSync(join(data, 'bili-dynamics-cache.json'), JSON.stringify({ at: Date.now(), items: [{ id: 'current', text: '记忆插件保存的一条公开动态内容' }] }))
    writeFileSync(feed, bridgeData)
    const result = await createBiliMemory({ stateDir: data, dshHome: dir, qqDynamicsCacheFile: feed }).refresh({ force: true })
    assert.equal(result.ok, true)
    assert.ok(JSON.parse(readFileSync(join(data, 'bili-memory.json'), 'utf8')).entries.some(entry => entry.id === 'dynamic:current'))
    assert.equal(readFileSync(feed, 'utf8'), bridgeData)
  }
})

test('legacy Bilibili briefs are backed up and rebuilt offline before being injected', t => {
  const { dir } = make(t)
  const data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries: [] }))
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧角色注入内容')
  writeFileSync(join(data, 'bili-memory.md'), '旧角色长文')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(memory.briefBlock(), '')
  assert.equal(memory.ensureRoleFreeOutputs().ok, true)
  assert.doesNotMatch(memory.briefBlock(), /旧角色/)
  const backup = memory.ensureRoleFreeOutputs().backup
  assert.ok(backup)
  assert.equal(readFileSync(join(backup, 'bili-memory-brief.md'), 'utf8'), '旧角色注入内容')
})

test('Bilibili status reports document character count without reading oversized files', t => {
  const { dir } = make(t), data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
  const doc = join(data, 'bili-memory.md'), memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(memory.status().docChars, 0)
  writeFileSync(doc, '公开中文🌟')
  assert.equal(memory.status().docChars, '公开中文🌟'.length)
  writeFileSync(doc, 'a'.repeat(1024 * 1024 + 1))
  assert.equal(memory.status().docChars, null)
})

test('Bilibili memory reloads replaced brief and index even when modification times are unchanged', t => {
  const { dir } = make(t), data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
  const brief = join(data, 'bili-memory-brief.md'), index = join(data, 'bili-memory.json'), date = new Date(1700000000000)
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":2}')
  const document = text => JSON.stringify({ entries: [{ id: 'dynamic:123', type: 'dynamic', text, shareable: true }] })
  writeFileSync(brief, '原有公开摘要'); writeFileSync(index, document('原有动态'))
  fs.utimesSync(brief, date, date); fs.utimesSync(index, date, date)
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.match(memory.briefBlock(), /原有公开摘要/)
  assert.equal(memory.purposeEntries()[0].text, '原有动态')
  const nextBrief = `${brief}.next`, nextIndex = `${index}.next`
  writeFileSync(nextBrief, '新的公开摘要'); writeFileSync(nextIndex, document('新的动态'))
  fs.utimesSync(nextBrief, date, date); fs.utimesSync(nextIndex, date, date)
  fs.renameSync(nextBrief, brief); fs.renameSync(nextIndex, index)
  assert.match(memory.briefBlock(), /新的公开摘要/)
  assert.equal(memory.purposeEntries()[0].text, '新的动态')
})

test('previously converted Bilibili memory is neutralized offline without changing its original index', t => {
  const { dir } = make(t), data = join(dir, 'memory-data')
  mkdirSync(join(dir, 'surfcore'), { recursive: true }); mkdirSync(data, { recursive: true })
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ self: { name: '公开账号' }, persona: { ownerTitle: '旧角色称呼' } }))
  const oldIndex = JSON.stringify({ entries: [{ id: 'dynamic:1', type: 'dynamic', date: '2026-10-31', text: '分享关于旧角色称呼的公开动态内容', title: '旧角色称呼的公开动态', shareable: false }] })
  writeFileSync(join(data, 'bili-memory.json'), oldIndex)
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧角色称呼简报')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":1}')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(memory.briefBlock(), '')
  assert.equal(memory.recallBlock('分享公开动态内容'), '')
  const result = memory.ensureRoleFreeOutputs()
  assert.equal(result.ok, true)
  assert.equal(readFileSync(join(result.backup, 'bili-memory-brief.md'), 'utf8'), '旧角色称呼简报')
  assert.equal(readFileSync(join(data, 'bili-memory.json'), 'utf8'), oldIndex)
  assert.doesNotMatch(memory.briefBlock() + memory.recallBlock('分享公开动态内容'), /旧角色称呼/)
  assert.match(memory.recallBlock('分享公开动态内容'), /管理员/)
})

test('Bilibili brief rechecks current owner names and refuses damaged configuration', t => {
  const { dir } = make(t), data = join(dir, 'memory-data'), config = join(dir, 'surfcore/bili.config.json')
  mkdirSync(join(dir, 'surfcore'), { recursive: true }); mkdirSync(data, { recursive: true })
  const brief = join(data, 'bili-memory-brief.md')
  writeFileSync(brief, '今天和新昵称看了公开的视频')
  writeFileSync(join(data, 'bili-role-free.json'), '{"version":2}')
  writeFileSync(config, JSON.stringify({ owner: { name: '旧昵称' } }))
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.match(memory.briefBlock(), /新昵称/)
  writeFileSync(config, JSON.stringify({ owner: { name: '新昵称' } }))
  assert.match(memory.briefBlock(), /管理员/)
  assert.doesNotMatch(memory.briefBlock(), /新昵称/)
  assert.match(readFileSync(brief, 'utf8'), /新昵称/)
  writeFileSync(config, '{invalid')
  assert.equal(memory.briefBlock(), '')
  assert.throws(() => memory.neutralizeEntries([{ text: '新昵称' }]), /配置|损坏/)
})

test('legacy Bilibili briefs without a valid index stay preserved but are not injected', t => {
  const { dir } = make(t)
  const data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true })
  writeFileSync(join(data, 'bili-memory-brief.md'), '旧角色注入内容')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(memory.ensureRoleFreeOutputs().ok, false)
  assert.equal(memory.briefBlock(), '')
  assert.equal(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '旧角色注入内容')
})

test('a legacy Bilibili conversion error preserves its original brief and leaves it disabled', t => {
  const { dir } = make(t)
  const data = join(dir, 'memory-data'); mkdirSync(data, { recursive: true }); mkdirSync(join(dir, 'surfcore'))
  writeFileSync(join(dir, 'surfcore/bili.config.json'), JSON.stringify({ preferences: { like: 'malformed' } }))
  writeFileSync(join(data, 'bili-memory.json'), JSON.stringify({ entries: [] }))
  writeFileSync(join(data, 'bili-memory-brief.md'), '原始简报')
  const memory = createBiliMemory({ stateDir: data, dshHome: dir })
  assert.equal(memory.ensureRoleFreeOutputs().ok, false)
  assert.equal(memory.briefBlock(), '')
  assert.equal(readFileSync(join(data, 'bili-memory-brief.md'), 'utf8'), '原始简报')
})

test('memory client registers its own main panel and sidebar entry', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exports
  const window = { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, 'dsh-local-memory'); exports = factory(() => ({ createElement() {} })) } } }
  runInNewContext(client, { window })
  assert.deepEqual(Array.from(exports.inject), ['slots'])
  const entries = []
  exports.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => { entries.push({ options, component }); return () => {} } } })
  assert.ok(entries.some(entry => entry.options.name === 'main' && entry.options.key === 'memory'))
  assert.ok(entries.some(entry => entry.options.name === 'sidebar.panellist' && entry.options.id === 'memory'))
})

test('memory panel loads recovery backups even when the card cannot be read', async () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  const effects = [], updates = []
  let exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [value, next => updates.push(next)], useEffect: fn => effects.push(fn), useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => url.endsWith('/card')
    ? new Response('{"ok":false,"error":"card is corrupt"}', { status: 400 })
    : new Response(JSON.stringify(url.endsWith('/backups') ? { ok: true, backups: ['memory-card-safe.json'] } : { ok: true, sessions: [] }), { status: 200 })
  runInNewContext(client, { window, fetch })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  entries.find(entry => entry.options.key === 'memory').component()
  effects[0]()
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(updates.some(value => Array.isArray(value) && value.includes('memory-card-safe.json')))
  assert.ok(updates.some(value => typeof value === 'string' && value.includes('card is corrupt')))
})

test('legacy memory backups are visibly labeled as unattributed', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported, index = 0
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 12 ? ['memory-card-legacy-unattributed-2026.json'] : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  assert.ok(walk(entries.find(entry => entry.options.key === 'memory').component()).some(node => node.type === 'span' && node.children.some(value => typeof value === 'string' && value.includes('来源未标注'))))
})

test('memory backup restore warns that later consumed events are not replayed', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported, index = 0, confirmation = ''
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 12 ? ['memory-card-safe.json'] : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: message => { confirmation = message; return false }, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const button = walk(entries.find(entry => entry.options.key === 'memory').component()).find(node => node.type === 'button' && node.children.includes('恢复'))
  button.props.onClick()
  assert.match(confirmation, /不会自动重放/)
  assert.match(confirmation, /备份/)
})

test('restoring a memory card clears selections and stale previews even when refresh fails', async () => {
  let exported, cursor = 0; const state = []
  state[0] = { records: [{ id: 'old', text: '原记忆' }], config: {}, status: {} }
  state[6] = { text: '旧卡片' }; state[7] = { qq: '旧上下文', bili: '旧上下文' }
  state[12] = ['memory-card-safe.json']; state[17] = ['old']
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: () => true, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => {
    if (url.endsWith('/restore')) return new Response('{"ok":true}')
    if (url.endsWith('/card')) return new Response('{"ok":false,"error":"记忆卡暂不可读"}', { status: 500 })
    if (url.endsWith('/backups')) return new Response('{"ok":true,"backups":[]}')
    if (url.endsWith('/sessions')) return new Response('{"ok":true,"sessions":[]}')
    throw new Error(`unexpected ${url}`)
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const panel = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => { cursor = 0; return walk(panel()) }
  await render().find(node => node.type === 'button' && node.children.includes('恢复')).props.onClick()
  assert.equal(state[17].length, 0); assert.equal(state[6], null); assert.equal(state[7], null)
  const text = render().flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.match(text, /记忆卡已恢复/); assert.match(text, /记忆卡暂不可读/)
})

test('a partial restore invalidates the old memory view and explains that recovery remains', async () => {
  let exported, cursor = 0; const state = []
  state[0] = { records: [{ id: 'old', text: '原记忆' }], config: {}, status: {} }
  state[6] = { text: '旧卡片' }; state[7] = { qq: '旧上下文' }; state[12] = ['memory-card-safe.json']; state[17] = ['old']
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: () => true, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => {
    if (url.endsWith('/restore')) return new Response('{"ok":false,"code":"MEMORY_RESTORE_PENDING","error":"卡片已替换，输出待恢复"}', { status: 400 })
    if (url.endsWith('/card')) return new Response(JSON.stringify({ ok: true, records: [], config: {}, status: {} }))
    if (url.endsWith('/backups')) return new Response('{"ok":true,"backups":[]}')
    if (url.endsWith('/sessions')) return new Response('{"ok":true,"sessions":[]}')
    throw new Error(`unexpected ${url}`)
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const panel = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => { cursor = 0; return walk(panel()) }
  await render().find(node => node.type === 'button' && node.children.includes('恢复')).props.onClick()
  assert.equal(state[17].length, 0); assert.equal(state[0], null); assert.equal(state[6], null); assert.equal(state[7], null)
  const text = render().flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.match(text, /卡片已替换/); assert.match(text, /待恢复/)
  const retry = render().find(node => node.type === 'button' && node.children.includes('重新读取记忆状态'))
  assert.ok(retry); await retry.props.onClick()
  assert.equal(state[0].ok, true)
  assert.equal(render().some(node => node.type === 'button' && node.children.includes('重新读取记忆状态')), false)
})

test('memory panel asks before clearing QQ public sync data', async () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported, index = 0, confirmation = '', requests = []
  const sync = { config: { enabled: true, intervalMs: 300000, includeGroups: ['12345'], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '' }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 9 ? sync : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: message => { confirmation = message; return false }, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window, fetch: async url => { requests.push(url); return new Response('{"ok":true,"backup":"test"}', { status: 200 }) } })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const button = walk(entries.find(entry => entry.options.key === 'memory').component()).find(node => node.type === 'button' && node.children.includes('清空公开群同步数据'))
  assert.ok(button)
  await button.props.onClick()
  assert.match(confirmation, /停止 QQ 桥接/)
  assert.match(confirmation, /备份/)
  assert.equal(requests.length, 0)
  window.confirm = () => true
  await button.props.onClick()
  assert.deepEqual(requests, ['/dsh-memory/api/qq-sync/purge', '/dsh-memory/api/qq-sync'])
})

test('QQ sync edits made while saving remain visible and unsaved', async () => {
  let exported, cursor = 0, refCursor = 0, release, submitted
  const state = [], refs = [], waiting = new Promise(resolve => { release = resolve })
  const sync = { config: { enabled: true, intervalMs: 300000, includeGroups: ['12345'], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '' }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = i === 9 ? sync : i === 10 ? '12345' : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useRef: initial => { const i = refCursor++; return refs[i] ||= { current: initial } }, useCallback: fn => fn }
  const window = { confirm: () => true, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, opts = {}) => {
    if (url.endsWith('/qq-sync/settings')) { submitted = JSON.parse(opts.body); await waiting; return new Response('{"ok":true}') }
    if (url.endsWith('/qq-sync/purge')) return new Response('{"ok":true,"backup":"fixture"}')
    if (url.endsWith('/qq-sync')) return new Response(JSON.stringify({ ok: true, ...sync }))
    throw new Error(`unexpected ${url}`)
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const panel = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => { cursor = 0; refCursor = 0; return walk(panel()) }
  const save = render().find(node => node.type === 'button' && node.children.includes('保存同步设置'))
  const pending = save.props.onClick(); await Promise.resolve()
  const input = render().find(node => node.type === 'input' && node.props.placeholder === '群号，逗号分隔')
  input.props.onChange({ target: { value: '99999' } }); release(); await pending
  const nodes = render(), group = nodes.find(node => node.type === 'input' && node.props.placeholder === '群号，逗号分隔')
  assert.deepEqual(submitted.includeGroups, ['12345']); assert.equal(group.props.value, '99999')
  assert.equal(nodes.find(node => node.type === 'button' && node.children.includes('立即同步公开群消息')).props.disabled, true)
  assert.match(nodes.flatMap(node => node.children.filter(value => typeof value === 'string')).join(' '), /尚未保存/)
  const enabled = nodes.find(node => node.type === 'label' && node.children.includes('启用公开群同步')).children.find(node => node.type === 'input')
  enabled.props.onChange({ target: { checked: false } })
  await render().find(node => node.type === 'button' && node.children.includes('清空公开群同步数据')).props.onClick()
  const afterPurge = render()
  assert.equal(afterPurge.find(node => node.type === 'label' && node.children.includes('启用公开群同步')).children.find(node => node.type === 'input').props.checked, false)
  assert.equal(afterPurge.find(node => node.type === 'input' && node.props.placeholder === '群号，逗号分隔').props.value, '99999')
  let confirmation = ''
  window.confirm = text => { confirmation = text; return false }
  await afterPurge.find(node => node.type === 'button' && node.children.includes('读取同步设置')).props.onClick()
  assert.match(confirmation, /尚未保存/)
  assert.equal(render().find(node => node.type === 'input' && node.props.placeholder === '群号，逗号分隔').props.value, '99999')
})

test('memory panel reports a completed QQ purge even when status refresh fails', async () => {
  let exported, cursor = 0
  const state = [], sync = { config: { enabled: true, intervalMs: 300000, includeGroups: [], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '' }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = i === 9 ? sync : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: () => true, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => url.endsWith('/qq-sync/purge') ? new Response('{"ok":true,"backup":"fixture"}') : new Response('{"ok":false,"error":"状态不可读"}', { status: 500 })
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const panel = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => { cursor = 0; return walk(panel()) }
  await render().find(node => node.type === 'button' && node.children.includes('清空公开群同步数据')).props.onClick()
  const visible = render().flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.match(visible, /已清空/); assert.match(visible, /fixture/); assert.match(visible, /状态.*刷新失败.*状态不可读/)
})

test('memory panel reports a completed QQ sync with an audit warning', async () => {
  let exported, cursor = 0
  const state = [], sync = { config: { enabled: true, intervalMs: 300000, includeGroups: ['12345'], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '' }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = i === 9 ? sync : initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => url.endsWith('/qq-sync/run') ? new Response(JSON.stringify({ ok: true, auditWarning: '审计日志写入失败' })) : new Response(JSON.stringify({ ok: true, ...sync }))
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const panel = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => { cursor = 0; return walk(panel()) }
  await render().find(node => node.type === 'button' && node.children.includes('立即同步公开群消息')).props.onClick()
  const text = render().flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.match(text, /同步已完成/)
  assert.match(text, /审计日志写入失败/)
})

test('session restore remains reported as completed if backup-list refresh fails', async () => {
  let exported, cursor = 0; const state = []
  state[13] = ['group:123']; state[14] = 'group:123'
  state[15] = { revision: 2, value: { activeTopics: [], pendingThoughts: [], memberImpressions: {} } }
  state[16] = ['old-backup.json']
  const requests = []
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: initial => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value }] },
    useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: () => true, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => { requests.push(url); return url.endsWith('/session/restore')
    ? new Response(JSON.stringify({ ok: true, revision: 3, value: { activeTopics: [], pendingThoughts: [], memberImpressions: {} } }))
    : new Response('{"ok":false,"error":"备份不可读"}', { status: 500 }) }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const panel = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const render = () => { cursor = 0; return walk(panel()) }
  const button = render().find(node => node.type === 'button' && node.children.includes('恢复'))
  assert.ok(button); await button.props.onClick()
  const text = render().flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.equal(state[15].revision, 3); assert.match(text, /会话记忆已恢复.*备份列表刷新失败.*备份不可读/)
  assert.equal(requests.length, 2)
})

test('memory panel shows an unreadable QQ summary while retaining sync controls', () => {
  let exported, index = 0
  const sync = { config: { enabled: true, intervalMs: 300000, includeGroups: ['12345'], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '', summaryError: '同步摘要无法读取，原文件已保留' }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 9 ? sync : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  assert.ok(nodes.some(node => node.props.role === 'alert' && node.children.some(child => typeof child === 'string' && child.includes('同步摘要无法读取'))))
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('保存同步设置')))
})

test('memory panel identifies a QQ summary blocked by privacy checks', () => {
  let exported, index = 0
  const sync = { config: { enabled: true, intervalMs: 300000, includeGroups: [], lookbackDays: 7, maxMessages: 100, maxChars: 2000 }, audit: [], text: '', summaryBlocked: true, summaryLabels: ['密码'] }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 9 ? sync : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  assert.ok(nodes.some(node => node.props.role === 'alert' && node.children.some(child => typeof child === 'string' && /隐私.*密码/.test(child))))
})

test('memory panel provides access to whole-session database backups', async () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported, requested = ''
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async url => { requested = url; return new Response('{"ok":true,"backups":[]}', { status: 200 }) }
  runInNewContext(client, { window, fetch })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const button = walk(entries.find(entry => entry.options.key === 'memory').component()).find(node => node.type === 'button' && node.children.includes('读取会话数据库备份'))
  assert.ok(button)
  await button.props.onClick()
  assert.match(requested, /session\/database-backups$/)
})

test('memory panel requires confirmation before restoring Bilibili share history', async () => {
  let exported, index = 0, confirmed = false, confirmation = '', posts = 0
  const state = []
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: message => { confirmation = message; return confirmed }, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    if (options.method === 'POST') { posts++; assert.equal(JSON.parse(options.body).name, 'history-1234567890123-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'); return new Response('{"ok":true,"preserved":"preserved-file"}', { status: 200 }) }
    return new Response('{"ok":true,"backups":["history-1234567890123-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json"]}', { status: 200 })
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  const load = render().find(node => node.type === 'button' && node.children.includes('读取分享历史备份'))
  assert.ok(load); await load.props.onClick()
  const restore = render().find(node => node.type === 'button' && node.children.includes('恢复分享历史'))
  assert.ok(restore); await restore.props.onClick()
  assert.match(confirmation, /备份/); assert.match(confirmation, /重复/); assert.equal(posts, 0)
  confirmed = true; await restore.props.onClick(); assert.equal(posts, 1)
})

test('memory panel edits and clears session categories with revision checks and backups', async t => {
  const { dir } = make(t), store = createSessionMemoryStore({ stateDir: dir })
  const key = 'group:123', original = { activeTopics: [{ text: '旧话题', pendingQuestion: '后续问题' }], pendingThoughts: [{ text: '旧想法', motivation: '原因' }], memberImpressions: { 小明: { traits: ['喜欢猫'], interactionCount: 3 } } }
  const initial = await store.write(key, original, 0), state = []; state[13] = [key]; state[14] = key; state[15] = initial
  let exported, index = 0, promptValue = '新话题', confirmed = false, writes = 0, failSessions = false, failBackups = false
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { prompt: () => promptValue, confirm: () => confirmed, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    try {
      if (url === '/dsh-memory/api/session' && options.method === 'POST') {
        const body = JSON.parse(options.body); writes++
        return new Response(JSON.stringify({ ok: true, ...await store.write(body.key, body.value, body.revision, { backup: true }) }), { status: 200 })
      }
      if (url.startsWith('/dsh-memory/api/session/backups')) {
        if (failBackups) throw new Error('备份列表不可用')
        return new Response(JSON.stringify({ ok: true, backups: await store.backups(key) }), { status: 200 })
      }
      if (url.startsWith('/dsh-memory/api/session?')) return new Response(JSON.stringify({ ok: true, ...await store.read(key) }), { status: 200 })
      if (url === '/dsh-memory/api/sessions') {
        if (failSessions) throw new Error('会话列表不可用')
        return new Response(JSON.stringify({ ok: true, sessions: await store.list() }), { status: 200 })
      }
      throw new Error('unexpected request')
    } catch (error) { return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 400 }) }
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  const displayed = render().flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  assert.match(displayed, /待追问：后续问题/)
  assert.match(displayed, /原因/)
  assert.match(displayed, /互动\s*3\s*次/)
  const firstArticle = render().find(node => node.type === 'article' && node.children.some(child => child?.type === 'span' && child.children.includes('旧话题')))
  const edit = walk(firstArticle).find(node => node.type === 'button' && node.children.includes('编辑'))
  assert.ok(edit)
  await edit.props.onClick()
  assert.equal((await store.read(key)).value.activeTopics[0].text, '新话题')
  assert.equal((await store.read(key)).value.activeTopics[0].pendingQuestion, '后续问题')
  assert.equal((await store.backups(key)).length, 1)
  const impression = render().find(node => node.type === 'article' && node.children.some(child => child?.type === 'span' && child.children.includes('小明：喜欢猫')))
  promptValue = '喜欢狗、爱音乐'
  await walk(impression).find(node => node.type === 'button' && node.children.includes('编辑')).props.onClick()
  assert.deepEqual((await store.read(key)).value.memberImpressions.小明.traits, ['喜欢狗', '爱音乐'])
  assert.equal((await store.read(key)).value.memberImpressions.小明.interactionCount, 3)
  const thought = render().find(node => node.type === 'article' && node.children.some(child => child?.type === 'span' && child.children.includes('旧想法')))
  promptValue = '新想法'
  await walk(thought).find(node => node.type === 'button' && node.children.includes('编辑')).props.onClick()
  assert.equal((await store.read(key)).value.pendingThoughts[0].motivation, '原因')
  let clear = render().find(node => node.type === 'button' && node.children.includes('清空待说的想法'))
  assert.ok(clear); await clear.props.onClick(); assert.equal(writes, 3)
  confirmed = true; await clear.props.onClick()
  assert.deepEqual((await store.read(key)).value.pendingThoughts, [])
  assert.equal((await store.read(key)).value.memberImpressions.小明.interactionCount, 3)
  const staleEdit = render().find(node => node.type === 'article' && node.children.some(child => child?.type === 'span' && child.children.includes('新话题')))
  const staleButton = walk(staleEdit).find(node => node.type === 'button' && node.children.includes('编辑'))
  const latest = await store.read(key); await store.write(key, { ...latest.value, activeTopics: [{ text: '并发更新' }] }, latest.revision)
  promptValue = '不应覆盖的修改'; await staleButton.props.onClick()
  assert.equal((await store.read(key)).value.activeTopics[0].text, '并发更新')
  assert.equal(state[15].value.activeTopics[0].text, '并发更新')
  const draft = render().find(node => node.type === 'textarea' && node.props['aria-label'] === '未保存的会话编辑草稿')
  assert.equal(draft?.props.value, '不应覆盖的修改')
  assert.ok(render().some(node => node.type === 'button' && node.children.includes('清除会话编辑草稿')))
  await render().find(node => node.type === 'button' && node.children.includes('清空全部会话记忆')).props.onClick()
  const cleared = (await store.read(key)).value
  assert.deepEqual(cleared.activeTopics, [])
  assert.deepEqual(cleared.pendingThoughts, [])
  assert.deepEqual(cleared.memberImpressions, {})
  assert.equal((await store.backups(key)).length, 5)
  const current = await store.read(key)
  await store.write(key, { ...current.value, activeTopics: [{ text: '外部新话题' }] }, current.revision)
  await store.write('group:456', { activeTopics: [{ text: '另一会话' }], pendingThoughts: [], memberImpressions: {} }, 0)
  const refreshSessions = render().find(node => node.type === 'button' && node.children.includes('刷新会话'))
  assert.ok(refreshSessions); await refreshSessions.props.onClick()
  assert.deepEqual(Array.from(state[13]), [key, 'group:456'])
  assert.equal(state[15].value.activeTopics[0].text, '外部新话题')
  assert.equal(writes, 6)
  failSessions = true
  await render().find(node => node.type === 'button' && node.children.includes('刷新会话')).props.onClick()
  assert.match(state[19], /会话列表不可用/)
  assert.equal(state[15].value.activeTopics[0].text, '外部新话题')
  assert.equal(writes, 6)
  failBackups = true; promptValue = '已保存的话题'
  const currentArticle = render().find(node => node.type === 'article' && node.children.some(child => child?.type === 'span' && child.children.includes('外部新话题')))
  await walk(currentArticle).find(node => node.type === 'button' && node.children.includes('编辑')).props.onClick()
  assert.equal((await store.read(key)).value.activeTopics[0].text, '已保存的话题')
  assert.match(state[19], /会话已保存.*备份列表刷新失败/)
  assert.equal(render().filter(node => node.type === 'textarea' && node.props['aria-label'] === '未保存的会话编辑草稿').length, 1)
})

test('memory panel exposes and saves the original capacity and decay settings', async () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  const calls = []
  const snapshot = { records: [], status: {}, config: { maxChars: 12345, warnChars: 60000, recentDays: 7, fuzzyAfterDays: 7, forgetAfterDays: 60, dailyHour: 4, fullMaxBytes: 10737418240, injectMaxChars: { qq: 2200, bili: 2000 } }, sync: {} }
  let initial = true, exported
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    useState: value => [initial && value === null ? (initial = false, snapshot) : value, () => {}],
    useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn,
  }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => { calls.push({ url, options }); return { ok: true, json: async () => url.endsWith('/card') ? snapshot : { ok: true, backups: [], sessions: [] } } }
  runInNewContext(client, { window, fetch })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const tree = entries.find(entry => entry.options.key === 'memory').component()
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(tree)
  for (const label of ['衰减卡字数上限', '容量警告字数', 'QQ 注入上限（字）', 'B站 注入上限（字）', '最近 N 天保持清楚', '多少天后开始模糊', '多少天后可以遗忘', '每日整理时间（点）']) assert.ok(nodes.some(node => node.props['aria-label'] === label), label)
  const limit = nodes.find(node => node.props['aria-label'] === '衰减卡字数上限')
  assert.equal(limit.props.defaultValue, 12345)
  await limit.props.onBlur({ target: { value: '20000' } })
  assert.ok(calls.some(call => call.url.endsWith('/settings') && JSON.parse(call.options.body).maxChars === 20000))
})

test('memory capacity input displays the value actually accepted by the service', async () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  const snapshot = { records: [], status: {}, config: { maxChars: 0, injectMaxChars: { qq: 2200, bili: 2000 } }, sync: {} }
  let initial = true, exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [initial && value === null ? (initial = false, snapshot) : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => ({ ok: true, json: async () => url.endsWith('/settings') ? { ok: true, config: { ...snapshot.config, maxChars: 2000 } } : url.endsWith('/card') ? snapshot : { ok: true, backups: [], sessions: [] } })
  runInNewContext(client, { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const input = walk(entries.find(entry => entry.options.key === 'memory').component()).find(node => node.props['aria-label'] === '衰减卡字数上限')
  const target = { value: '1000' }; await input.props.onBlur({ target })
  assert.equal(target.value, '2000')
})

test('memory panel can configure record limits and owner protection', async t => {
  const { service } = make(t), snapshot = await service.snapshot()
  let exported, index = 0; const state = [snapshot]
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    const value = url.endsWith('/settings') ? await service.updateSettings(JSON.parse(options.body)) : url.endsWith('/card') ? await service.snapshot() : url.endsWith('/backups') ? { ok: true, backups: await service.backups() } : { ok: true, sessions: [] }
    return new Response(JSON.stringify(value))
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  for (const [label, value] of [['衰减卡记录上限', '850'], ['管理员记忆保护阈值', '80']]) {
    const input = render().find(node => node.props['aria-label'] === label)
    assert.ok(input, label)
    await input.props.onBlur({ target: { value } })
  }
  const config = (await service.snapshot()).config
  assert.equal(config.maxRecords, 850)
  assert.equal(config.minOwnerImportance, 80)
  assert.equal(config.fullMaxRecords, 0)
  assert.equal(config.fullMarkdownMaxBytes, 5 * 1024 * 1024)
})

test('memory panel can set a one-minute Bilibili refresh interval', async t => {
  const { service } = make(t), snapshot = await service.snapshot()
  let exported, index = 0; const state = [snapshot]
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    const value = url.endsWith('/sync-settings') ? await service.updateSyncSettings(JSON.parse(options.body)) : url.endsWith('/card') ? await service.snapshot() : url.endsWith('/backups') ? { ok: true, backups: await service.backups() } : { ok: true, sessions: [] }
    return new Response(JSON.stringify(value))
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const input = walk(component()).find(node => node.props['aria-label'] === 'B站公开记忆刷新间隔（分钟）')
  assert.ok(input)
  const target = { value: '1' }; await input.props.onBlur({ target })
  assert.equal((await service.snapshot()).sync.intervalMs, 60000)
  assert.equal(target.value, '1')
  assert.equal((await service.snapshot()).sync.enabled, false)
})

test('memory panel projects the archive outbox instead of archive browsing', () => {
  let exported, primed = false
  const snapshot = {
    records: [], status: {}, config: {}, sessions: [],
    archiveOut: { pending: 3, conflicts: 1, receipts: 9, invalid: 2, lastError: { message: 'bridge offline' } },
  }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [value === null && !primed ? (primed = true, snapshot) : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async () => new Response(JSON.stringify({ ok: true, backups: [], sessions: [] }))
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const visible = walk(entries.find(entry => entry.options.key === 'memory').component())
    .flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  for (const text of ['归档出站', '待投递', '冲突', '已确认', '无效', 'bridge offline']) assert.ok(visible.includes(text), text)
})

test('memory panel no longer exposes archive browsing or archive caps', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  for (const banned of ['/archive/status', '/archive/preview', '/archive?q=', 'archiveTab', '全量归档记录告警上限', '全量 Markdown 导出上限']) {
    assert.equal(client.includes(banned), false, banned)
  }
  assert.match(client, /归档出站/)
})

test('memory capacity input keeps the draft when saving fails', async () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  const snapshot = { records: [], status: {}, config: { maxChars: 0, injectMaxChars: { qq: 2200, bili: 2000 } }, sync: {} }
  let initial = true, exported, error = ''
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [initial && value === null ? (initial = false, snapshot) : value, next => { if (typeof next === 'string') error = next }], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, error: '保存失败' }) })
  runInNewContext(client, { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const input = walk(entries.find(entry => entry.options.key === 'memory').component()).find(node => node.props['aria-label'] === '衰减卡字数上限')
  const target = { value: '1000' }; await input.props.onBlur({ target })
  assert.equal(target.value, '1000'); assert.match(error, /保存失败/)
})

test('memory panel exposes QQ public feed synchronization controls', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  assert.ok(nodes.some(node => node.type === 'h2' && node.children.includes('QQ 公开群同步到 B站')))
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('读取同步设置')))
})

test('memory panel explains bridge limits for a large legacy session identifier', () => {
  let exported, index = 0
  const key = 'group:9007199254740993'
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [index++ === 13 ? [key] : index === 15 ? key : value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...(node.children || []).flat(Infinity).flatMap(walk)] : []
  const text = walk(entries.find(entry => entry.options.key === 'memory').component()).flatMap(node => node.children.filter(value => typeof value === 'string')).join(' ')
  assert.match(text, /桥接.*不支持|不支持.*桥接/)
})

test('memory panel provides manual importance and merge title controls', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => [value, () => {}], useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window })
  const entries = []
  exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  for (const label of ['记忆重要度', '合并后的事件标题', '合并后置顶']) assert.ok(nodes.some(node => node.props['aria-label'] === label), label)
})

test('memory snapshot exposes only a manually designated first meeting', async t => {
  const { service } = make(t)
  await service.record({ id: 'owner-first', platform: 'qq', kind: 'private', isOwner: true, text: '第一次聊天', at: '2026-10-01T10:00:00Z' })
  // 自动指定已移除：哪怕这是最早一条主人互动，也不会自己成为初次相遇。
  let snapshot = await service.snapshot()
  assert.equal(snapshot.firstMet.source, '')
  assert.equal(snapshot.firstMet.recordId, '')
  assert.ok(snapshot.records.every(record => !record.firstMet))
  const first = snapshot.records[0]
  await service.action('set-first-meet', { ids: [first.id] })
  snapshot = await service.snapshot()
  assert.equal(snapshot.firstMet.source, 'manual')
  assert.equal(snapshot.firstMet.recordId, first.id)
  // 取消后回到空，并把这个记录的特权一起收回。
  await service.action('clear-first-meet', {})
  snapshot = await service.snapshot()
  assert.equal(snapshot.firstMet.source, '')
  assert.equal(snapshot.firstMet.recordId, '')
  const cleared = snapshot.records.find(record => record.id === first.id)
  assert.notEqual(cleared.firstMet, true)
  assert.notEqual(cleared.pinned, true)
  assert.ok(Number(cleared.importance) <= 60)
})

test('memory panel shows record status and prevents selecting non-owner memories as first meeting', () => {
  const client = readFileSync(resolve('plugins/memory/src/client.js'), 'utf8')
  let exported, index = 0
  const state = []
  state[0] = { records: [{ id: 'one', text: '重要内容', platform: 'qq', scope: 'qq', clarity: 'vivid', importance: 90, createdAt: '2026-10-01T10:00:00.000Z', tags: ['owner', 'merged'], pinned: true, firstMet: true, botReply: '好的' }, { id: 'two', text: '群友记录', tags: [] }], status: {}, config: {}, firstMet: { source: 'manual', recordId: 'one', at: '2026-10-01T10:00:00.000Z' } }
  state[17] = ['two']
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], () => {}] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(client, { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  const visible = nodes.flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  for (const text of ['手动指定', '初次互动', '合并事件', '置顶', '重要', '90', '清晰', '好的', '管理员']) assert.ok(visible.includes(text), text)
  assert.equal(nodes.find(node => node.type === 'button' && node.children.includes('标记初次互动')).props.disabled, true)
})

test('memory panel pages large cards while preserving selections across pages', () => {
  let exported, index = 0; const state = []
  state[0] = { records: Array.from({ length: 125 }, (_, i) => ({ id: String(i), text: `记忆 ${i}`, tags: ['owner'] })), status: {}, config: {} }
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  let nodes = render()
  assert.equal(nodes.filter(node => node.type === 'article').length, 50)
  nodes.find(node => node.props['aria-label'] === '选择记忆：记忆 0').props.onChange({ target: { checked: true } })
  render().find(node => node.type === 'button' && node.children.includes('记忆下一页')).props.onClick()
  nodes = render()
  assert.ok(nodes.some(node => node.props['aria-label'] === '选择记忆：记忆 50'))
  nodes.find(node => node.props['aria-label'] === '选择记忆：记忆 50').props.onChange({ target: { checked: true } })
  nodes = render()
  assert.ok(nodes.some(node => node.type === 'p' && node.children.some(text => typeof text === 'string' && text.includes('已选择 2 条'))))
  assert.equal(nodes.find(node => node.type === 'button' && node.children.includes('合并所选')).props.disabled, false)
  nodes.find(node => node.type === 'button' && node.children.includes('记忆下一页')).props.onClick()
  assert.ok(render().some(node => node.props['aria-label'] === '选择记忆：记忆 124'))
})

test('memory panel explains and disables batch actions above their limits', () => {
  let exported, index = 0
  const state = []
  state[0] = { records: Array.from({ length: 51 }, (_, i) => ({ id: String(i), text: `记录 ${i}`, tags: ['owner'] })), status: {}, config: {} }
  state[17] = state[0].records.map(record => record.id)
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], () => {}] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const nodes = walk(entries.find(entry => entry.options.key === 'memory').component())
  const visible = nodes.flatMap(node => node.children.filter(child => typeof child === 'string')).join(' ')
  assert.match(visible, /合并.*50/); assert.match(visible, /初次互动.*20/)
  for (const label of ['合并所选', '标记初次互动']) assert.equal(nodes.find(node => node.type === 'button' && node.children.includes(label)).props.disabled, true)
})

test('memory panel allows card edits while a Bilibili refresh is pending', async t => {
  const { service } = make(t), state = [await service.snapshot(), '网络等待期间的记忆']
  let exported, index = 0, release, started
  const waiting = new Promise(resolve => { release = resolve }), entered = new Promise(resolve => { started = resolve })
  t.after(() => release())
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/bili/refresh')) { started(); await waiting; return new Response(JSON.stringify({ ok: true })) }
    const result = url.endsWith('/card') && options.method === 'POST' ? await service.action(JSON.parse(options.body).action, JSON.parse(options.body)) : url.endsWith('/card') ? await service.snapshot() : url.endsWith('/backups') ? { ok: true, backups: [] } : { ok: true, sessions: [] }
    return new Response(JSON.stringify(result))
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  const button = label => render().find(node => node.type === 'button' && node.children.includes(label))
  const pending = button('同步 B站公开记忆').props.onClick()
  await entered
  const addDisabled = button('添加记忆').props.disabled
  const syncDisabled = button('同步 B站公开记忆').props.disabled
  if (!addDisabled) await button('添加记忆').props.onClick()
  release(); await pending
  assert.equal(addDisabled, false)
  assert.equal(syncDisabled, true)
  assert.match(JSON.stringify((await service.snapshot()).records), /网络等待期间的记忆/)
  assert.equal(button('同步 B站公开记忆').props.disabled, false)
})

test('memory panel ignores an older snapshot that arrives after a newer refresh', async t => {
  const { service } = make(t), initial = await service.snapshot(), state = [initial, '最新记忆']
  let exported, stateIndex = 0, refIndex = 0, releaseBili, releaseOld, enteredBili, enteredOld, cardReads = 0
  const refs = [], biliWait = new Promise(resolve => { releaseBili = resolve }), biliStarted = new Promise(resolve => { enteredBili = resolve }), oldWait = new Promise(resolve => { releaseOld = resolve }), oldStarted = new Promise(resolve => { enteredOld = resolve })
  t.after(() => { releaseBili(); releaseOld() })
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = stateIndex++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => { const i = refIndex++; return refs[i] ||= { current: value } }, useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/bili/refresh')) { enteredBili(); await biliWait; return new Response(JSON.stringify({ ok: true })) }
    if (url.endsWith('/card') && options.method === 'POST') return new Response(JSON.stringify(await service.action('add', JSON.parse(options.body))))
    if (url.endsWith('/card')) {
      if (++cardReads === 1) { enteredOld(); await oldWait; return new Response(JSON.stringify(initial)) }
      return new Response(JSON.stringify(await service.snapshot()))
    }
    return new Response(JSON.stringify(url.endsWith('/backups') ? { ok: true, backups: [] } : { ok: true, sessions: [] }))
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { stateIndex = 0; refIndex = 0; return walk(component()) }
  const button = label => render().find(node => node.type === 'button' && node.children.includes(label))
  const bili = button('同步 B站公开记忆').props.onClick(); await biliStarted
  const add = button('添加记忆').props.onClick(); await oldStarted
  releaseBili(); await bili
  releaseOld(); await add
  assert.match(JSON.stringify(state[0].records), /最新记忆/)
})

test('memory card actions preserve unsaved drafts and unrelated selections', async () => {
  let exported, index = 0, failAdd = false, resolveAdd
  const state = []
  state[0] = { records: [{ id: 'one', text: '旧记忆', pinned: false }], config: {}, status: {} }
  state[1] = '尚未提交'; state[17] = ['one']
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body)
      if (body.action === 'add' && failAdd) return new Response(JSON.stringify({ ok: false, error: '保存失败' }), { status: 400 })
      if (body.action === 'add' && resolveAdd) await new Promise(resolve => { resolveAdd.resolve = resolve })
      return new Response(JSON.stringify({ ok: true }))
    }
    const data = url.endsWith('/card') ? state[0] : url.endsWith('/backups') ? { backups: [] } : { sessions: [] }
    return new Response(JSON.stringify({ ok: true, ...data }))
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  const click = label => render().find(node => node.type === 'button' && node.children.includes(label)).props.onClick()
  await click('置顶')
  assert.equal(state[1], '尚未提交'); assert.deepEqual(state[17], ['one'])
  failAdd = true; await click('添加记忆'); assert.equal(state[1], '尚未提交')
  failAdd = false; resolveAdd = {}; const pending = click('添加记忆')
  await new Promise(resolve => setImmediate(resolve))
  state[1] = '请求期间输入的新草稿'; resolveAdd.resolve(); await pending; resolveAdd = null
  assert.equal(state[1], '请求期间输入的新草稿')
  await click('添加记忆'); assert.equal(state[1], '')
})

test('memory panel confirms destructive card actions and reports their result', async () => {
  let exported, index = 0, confirmed = false, prompt = '', posts = []
  const state = []
  state[0] = { records: [{ id: 'one', text: '第一条', pinned: false }, { id: 'two', text: '第二条', pinned: false }], config: {}, status: {} }
  state[17] = ['one', 'two']
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { confirm: value => { prompt = value; return confirmed }, __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => {
    if (options.method === 'POST') { const body = JSON.parse(options.body); posts.push(body); return new Response(JSON.stringify({ ok: true, merged: 2 })) }
    return new Response(JSON.stringify(url.endsWith('/card') ? { ok: true, ...state[0] } : url.endsWith('/backups') ? { ok: true, backups: [] } : { ok: true, sessions: [] }))
  }
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const render = () => { index = 0; return walk(component()) }
  const click = label => render().find(node => node.type === 'button' && node.children.includes(label)).props.onClick()
  for (const label of ['遗忘', '合并所选', '标记初次互动', '清除初次互动']) { prompt = ''; await click(label); assert.ok(prompt, label); assert.equal(posts.length, 0) }
  confirmed = true; await click('合并所选')
  assert.equal(posts[0].action, 'merge-memories')
  assert.match(state[20], /合并.*2/)
})

test('memory panel reports when maintenance is skipped because memory is disabled', async () => {
  let exported, index = 0
  const state = [{ records: [], config: { enabled: false }, status: {} }]
  const React = { createElement: (type, props, ...children) => ({ type, props: props || {}, children }), useState: value => { const i = index++; if (!(i in state)) state[i] = value; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] }, useEffect: () => {}, useRef: value => ({ current: value }), useCallback: fn => fn }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => React) } } }
  const fetch = async (url, options = {}) => new Response(JSON.stringify(options.method === 'POST' ? { ok: true, disabled: true } : url.endsWith('/card') ? { ok: true, ...state[0] } : url.endsWith('/backups') ? { ok: true, backups: [] } : { ok: true, sessions: [] }))
  runInNewContext(readFileSync(resolve('plugins/memory/src/client.js'), 'utf8'), { window, fetch })
  const entries = []; exported.apply({ slots: { inject: (_slot, fn) => fn(), register: (options, component) => entries.push({ options, component }) } })
  const component = entries.find(entry => entry.options.key === 'memory').component
  const walk = node => node && typeof node === 'object' ? [node, ...node.children.flat(Infinity).flatMap(walk)] : []
  const button = walk(component()).find(node => node.type === 'button' && node.children.includes('整理记忆'))
  await button.props.onClick()
  assert.match(state[20], /记忆已关闭，未进行整理/)
})
