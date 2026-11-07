import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createMemoryOutbox } from '../scripts/lib/memory-outbox.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { createSessionMemoryStore } from '../plugins/memory/src/session-memory.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'
import { callComponent } from '../plugins/_shared/ipc.mjs'
import { createServer } from 'node:http'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

test('disabled memory card retains old events without blocking independent session topic updates', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-disabled-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const stateDir = join(home, 'memory'), service = createMemoryService({ stateDir })
  service.sessions = createSessionMemoryStore({ stateDir }); service.sessions.initialize()
  await service.sessions.write('group:1', { activeTopics: [{ text: '测试话题', lastMentionAt: 10 }], pendingThoughts: [], memberImpressions: {} }, 0)
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  const warnings = []
  const box = createMemoryOutbox({ home, retryMs: 100000, log: message => warnings.push(message),
    send: event => callComponent({ home, name: 'memory', path: '/events', body: { ...event, platform: 'qq' } }),
    sendTouch: event => callComponent({ home, name: 'memory', path: '/session/touch-topics', body: { ...event, hashed: true } }),
  })
  t.after(async () => { box.stop(); dispose(); await new Promise(resolve => server.close(resolve)); await service.dispose() })
  assert.equal(box.enqueue({ text: '关闭前待投递的记忆', at: 1000 }), true)
  assert.equal(box.enqueue({ text: '第二条待投递的记忆', at: 2000 }), true)
  await service.updateSettings({ enabled: false })
  const cardPath = join(stateDir, 'data/memory-card.json'), card = readFileSync(cardPath, 'utf8')
  writeFileSync(cardPath, '{损坏')
  await assert.rejects(callComponent({ home, name: 'memory', path: '/events', body: { id: 'check', platform: 'qq', text: '检查', at: 1000 } }), error => error.code === 'MEMORY_DISABLED')
  await box.drain()
  box.enqueueTouch('group:1', ['测试话题'], 20)
  await box.drain()
  assert.equal((await service.sessions.read('group:1')).value.activeTopics[0].lastMentionAt, 20, warnings.join('; '))
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).filter(name => name.endsWith('.json')).length, 2)
  assert.equal(readFileSync(cardPath, 'utf8'), '{损坏')
  writeFileSync(cardPath, card)
  await service.updateSettings({ enabled: true })
  await box.drain()
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).filter(name => name.endsWith('.json')).length, 0)
  assert.ok((await service.snapshot()).records.some(record => record.text.includes('关闭前待投递的记忆')))
  const events = readFileSync(join(stateDir, 'data/events.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line).text)
  assert.deepEqual(events, ['关闭前待投递的记忆', '第二条待投递的记忆'])
})

test('a general memory transport failure does not bypass the queued event order', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-general-failure-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let offline = true, touches = 0
  const box = createMemoryOutbox({ home, retryMs: 100000, log() {}, send: async () => { if (offline) throw new Error('offline'); return { ok: true } }, sendTouch: async () => { touches++; return { ok: true } } })
  t.after(() => box.stop())
  box.enqueue({ text: '先入队的事件' })
  box.enqueueTouch('group:1', ['话题'], 10)
  await box.drain()
  assert.equal(touches, 0)
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).filter(name => name.endsWith('.json')).length, 2)
  offline = false; await box.drain()
  assert.equal(touches, 1)
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).filter(name => name.endsWith('.json')).length, 0)
})

test('a drain requested during delivery also processes the newly queued topic update', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-barrier-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let release, entered, touches = 0
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const box = createMemoryOutbox({ home, retryMs: 100000, log() {}, send: async () => { entered(); await waiting; return { ok: true } }, sendTouch: async () => { touches++; return { ok: true } } })
  t.after(() => box.stop())
  box.enqueue({ text: '第一条' })
  const first = box.drain(); await started
  box.enqueueTouch('group:1', ['话题'], 20)
  const second = box.drain(); release()
  await Promise.all([first, second])
  assert.equal(touches, 1)
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).filter(name => name.endsWith('.json')).length, 0)
})

test('acknowledging an old queue item does not delete a replacement written during delivery', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-replaced-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let release, entered
  const waiting = new Promise(resolve => { release = resolve }), started = new Promise(resolve => { entered = resolve })
  const received = []
  const box = createMemoryOutbox({ home, retryMs: 100000, log() {}, send: async event => { received.push(event.text); if (received.length === 1) { entered(); await waiting } return { ok: true } } })
  t.after(() => box.stop())
  box.enqueue({ text: '原来的事件' })
  const first = box.drain(); await started
  const dir = join(home, 'surfcore/memory-outbox'), name = readdirSync(dir).find(item => item.endsWith('.json'))
  writeFileSync(join(dir, name), JSON.stringify({ id: 'replacement', text: '替换后的事件', at: new Date().toISOString() }))
  release(); await first
  assert.ok(readdirSync(dir).includes(name))
  await box.drain()
  assert.deepEqual(received, ['原来的事件', '替换后的事件'])
  assert.equal(readdirSync(dir).filter(item => item.endsWith('.json')).length, 0)
})

test('QQ events remain redacted on disk until the memory service acknowledges them', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let online = false
  const received = []
  const send = async event => { if (!online) throw new Error('offline'); received.push(event); return { ok: true } }
  const outbox = createMemoryOutbox({ home, send, log() {}, retryMs: 100000 })
  t.after(() => outbox.stop())
  outbox.enqueue({ at: 1234, kind: 'private', senderId: '123', text: '今天聊猫 token=secret-value' })
  await outbox.drain()
  const dir = join(home, 'surfcore/memory-outbox')
  assert.equal(readdirSync(dir).length, 1)
  assert.doesNotMatch(readFileSync(join(dir, readdirSync(dir)[0]), 'utf8'), /secret-value/)
  online = true
  await outbox.drain()
  assert.equal(received.length, 1)
  assert.match(received[0].text, /今天聊猫/)
  assert.equal(readdirSync(dir).length, 0)
})

test('a new bridge process resumes pending events after restart', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-restart-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const first = createMemoryOutbox({ home, send: async () => { throw new Error('offline') }, log() {}, retryMs: 100000 })
  first.enqueue({ at: 456, kind: 'group', text: '待发送的记忆' })
  await first.drain(); first.stop()
  const delivered = []
  const second = createMemoryOutbox({ home, send: async event => { delivered.push(event); return { ok: true } }, log() {}, retryMs: 100000 })
  t.after(() => second.stop())
  await second.drain()
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].text, '待发送的记忆')
})

test('events added during an in-flight delivery are scheduled after it finishes', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-race-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let release
  const gate = new Promise(resolve => { release = resolve })
  const received = []
  const box = createMemoryOutbox({ home, retryMs: 10, log() {}, send: async event => { if (!received.length) await gate; received.push(event.text); return { ok: true } } })
  t.after(() => box.stop())
  box.enqueue({ text: '第一条' })
  const pending = box.drain()
  box.enqueue({ text: '第二条' })
  await new Promise(resolve => setTimeout(resolve, 5))
  release(); await pending
  await new Promise(resolve => setTimeout(resolve, 40))
  assert.deepEqual(received, ['第一条', '第二条'])
})

test('queued QQ events survive an offline service and arrive in the real memory service', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-integration-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: join(home, 'memory') })
  const box = createMemoryOutbox({ home, retryMs: 100000, log() {}, send: event => callComponent({ home, name: 'memory', path: '/events', body: { ...event, platform: 'qq' } }) })
  t.after(() => box.stop())
  box.enqueue({ kind: 'private', text: '离线时的测试约定', isOwner: true })
  await box.drain()
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  try {
    await box.drain()
    assert.match((await service.snapshot()).records[0].text, /离线时的测试约定/)
    assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).length, 0)
  } finally { dispose(); await new Promise(resolve => server.close(resolve)) }
})

test('queued QQ owner messages and replies become paired memories without crossing conversations', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-replies-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: join(home, 'memory') })
  const box = createMemoryOutbox({ home, retryMs: 100000, log() {}, send: event => callComponent({ home, name: 'memory', path: '/events', body: { ...event, platform: 'qq' } }) })
  t.after(() => box.stop())
  const now = Date.now()
  box.enqueue({ at: now, kind: 'private', conversationKey: 'private:123', isOwner: true, text: '我们约好一起看星星' })
  box.enqueue({ at: now + 1, kind: 'private', conversationKey: 'private:456', isSelf: true, text: '另一会话的回复' })
  box.enqueue({ at: now + 2, kind: 'private', conversationKey: 'private:123', isSelf: true, text: '好的，一起去看' })
  let handler
  const server = createServer((req, res) => handler(req, res))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const dispose = registerMemoryInternal({ webServer: { port: server.address().port, register: route => { handler = route.handler; return () => {} } } }, home, service)
  try {
    await box.drain()
    const records = (await service.snapshot()).records
    const owner = records.find(record => record.text.includes('我们约好一起看星星'))
    assert.equal(owner.botReply, '好的，一起去看')
    assert.ok(records.some(record => record.isSelf && record.text.includes('另一会话的回复')))
    assert.doesNotMatch(await service.context('bili'), /我们约好一起看星星|好的，一起去看|另一会话的回复/)
    assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).length, 0)
  } finally { dispose(); await new Promise(resolve => server.close(resolve)) }
})

test('lost acknowledgement retries without recording the same QQ event twice', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-lost-ack-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: join(home, 'memory') }); let first = true
  const box = createMemoryOutbox({ home, retryMs: 100000, log() {}, send: async event => {
    const result = await service.record({ ...event, platform: 'qq' })
    if (first) { first = false; throw new Error('acknowledgement lost') }
    return result
  } })
  t.after(() => box.stop())
  box.enqueue({ kind: 'private', isOwner: true, text: '确认丢失时仍只记录一次' })
  await box.drain()
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).length, 1)
  await box.drain()
  assert.equal(readdirSync(join(home, 'surfcore/memory-outbox')).length, 0)
  const journal = readFileSync(join(home, 'memory/data/events.jsonl'), 'utf8').trim().split('\n')
  assert.equal(journal.length, 1)
  assert.equal((await service.snapshot()).records.filter(record => record.text.includes('确认丢失时仍只记录一次')).length, 1)
})

test('a damaged queue entry is preserved separately and does not block later valid events', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-corrupt-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'surfcore/memory-outbox'); mkdirSync(dir, { recursive: true })
  const brokenName = '0000000000000-000001-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json'
  writeFileSync(join(dir, brokenName), '{incomplete')
  const received = []
  const box = createMemoryOutbox({ home, log() {}, retryMs: 100000, send: async event => { received.push(event); return { ok: true } } })
  t.after(() => box.stop())
  assert.equal(box.enqueue({ text: '后续有效事件', at: 1000 }), true)
  await box.drain()
  assert.equal(received.length, 1)
  assert.equal(received[0].text, '后续有效事件')
  assert.equal(readFileSync(join(dir, 'corrupt', brokenName), 'utf8'), '{incomplete')
})

test('a valid JSON queue entry with unusable content is preserved and does not block later events', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-invalid-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'surfcore/memory-outbox'); mkdirSync(dir, { recursive: true })
  const bad = '0000000000000-000001-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json'
  writeFileSync(join(dir, bad), JSON.stringify({ id: 'bad', text: '', at: 'not-a-date' }))
  const received = []
  const box = createMemoryOutbox({ home, log() {}, retryMs: 100000, send: async event => { if (!event.text) throw new Error('invalid'); received.push(event); return { ok: true } } })
  t.after(() => box.stop())
  box.enqueue({ text: '后续有效事件' })
  await box.drain()
  assert.equal(received.length, 1)
  assert.equal(received[0].text, '后续有效事件')
  assert.equal(JSON.parse(readFileSync(join(dir, 'corrupt', bad), 'utf8')).id, 'bad')
})

test('queue retains an event if the receiver explicitly refuses or fails to acknowledge it', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-ack-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  let answer = { ok: false }, received = 0
  const box = createMemoryOutbox({ home, log() {}, retryMs: 100000, send: async () => { received++; return answer } })
  t.after(() => box.stop())
  box.enqueue({ text: '需要确认的事件' })
  await box.drain()
  const dir = join(home, 'surfcore/memory-outbox')
  assert.equal(readdirSync(dir).filter(name => name.endsWith('.json')).length, 1)
  answer = undefined
  await box.drain()
  assert.equal(readdirSync(dir).filter(name => name.endsWith('.json')).length, 1)
  answer = { ok: true }
  await box.drain()
  assert.equal(readdirSync(dir).filter(name => name.endsWith('.json')).length, 0)
  assert.equal(received, 3)
})

test('an oversized queue entry is quarantined without being read or blocking later events', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-oversize-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'surfcore/memory-outbox'); mkdirSync(dir, { recursive: true })
  const name = '0000000000000-000001-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json', file = join(dir, name)
  writeFileSync(file, 'x'.repeat(512 * 1024 + 1))
  const original = fs.readFileSync
  const mock = t.mock.method(fs, 'readFileSync', function (path, ...args) { if (path === file) throw new Error('oversized queue file must not be read'); return original.call(this, path, ...args) })
  syncBuiltinESMExports(); t.after(() => { mock.mock.restore(); syncBuiltinESMExports() })
  let delivered = 0
  const box = createMemoryOutbox({ home, log() {}, retryMs: 100000, send: async () => { delivered++; return { ok: true } } })
  t.after(() => box.stop())
  box.enqueue({ text: '有效事件' })
  await box.drain()
  assert.equal(delivered, 1)
  assert.equal(readFileSync(join(dir, 'corrupt', name)).length, 512 * 1024 + 1)
})

test('queue quarantines entries that exceed the IPC limit after protocol fields are added', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-outbox-ipc-limit-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const dir = join(home, 'surfcore/memory-outbox'); mkdirSync(dir, { recursive: true })
  const name = '0000000000000-000001-aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.json'
  const event = { id: 'large', text: '事件', extra: '' }
  event.extra = 'x'.repeat(512 * 1024 - Buffer.byteLength(JSON.stringify(event)) - 1)
  writeFileSync(join(dir, name), JSON.stringify(event))
  let received = 0
  const box = createMemoryOutbox({ home, log() {}, retryMs: 100000, send: async value => {
    if (Buffer.byteLength(JSON.stringify({ ...value, id: String(value.id), platform: 'qq' })) > 512 * 1024) throw new Error('request too large')
    received++; return { ok: true }
  } })
  t.after(() => box.stop())
  box.enqueue({ text: '后续事件' })
  await box.drain()
  assert.equal(received, 1)
  assert.equal(fs.statSync(join(dir, 'corrupt', name)).size, 512 * 1024 - 1)
})
