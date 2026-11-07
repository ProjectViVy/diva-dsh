import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { runInNewContext } from 'node:vm'
import * as transforms from '../scripts/lib/surfcore-runtime-transform.mjs'

test('DM peek retains the upstream cursor until delivery', () => {
  const source = readFileSync(resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs'), 'utf8')
  assert.equal(typeof transforms.renderDmAwaitSource, 'function')
  const rendered = transforms.renderDmAwaitSource(source)
  assert.match(rendered, /if \(!PEEK\) saveState\(\{ \.\.\.st0, seen: seenMap, seenAt: now/)
  assert.match(rendered, /if \(!PEEK\) saveState\(\{ \.\.\.st, lastSeen: r\.ts/)
})

test('DM peek runs through the project loader without advancing either cursor mode', (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-peek-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bili = join(dir, 'surfcore/bili'); mkdirSync(bili, { recursive: true })
  const config = join(dir, 'surfcore/bili.config.json'), cursor = join(bili, 'dm-await-state.json')
  writeFileSync(config, JSON.stringify({ owner: { mid: '1001', name: 'owner' }, self: { mid: '9999' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'test', bili_jct: 'test', buvid3: 'test' }))
  const initial = JSON.stringify({ lastSeen: 1, seen: { 1001: 1 } }); writeFileSync(cursor, initial)
  const fetchStub = join(dir, 'fetch.mjs')
  writeFileSync(fetchStub, `globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { session_list: [{ talker_id: 1001, last_msg: { sender_uid: 1001, timestamp: 2, content: 'hi' } }] } }) });`)
  const command = resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs')
  const args = ['--import', resolve('scripts/surfcore-loader.mjs'), '--import', fetchStub, command, '--once', '--json', '--peek']
  const env = { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_BILI_CONFIG: config, NODE_OPTIONS: '' }
  for (const extra of [[], ['--any']]) {
    const result = JSON.parse(execFileSync(process.execPath, [...args, ...extra], { env, encoding: 'utf8' }))
    assert.equal(result.hit, true)
    assert.equal(readFileSync(cursor, 'utf8'), initial)
  }
  writeFileSync(cursor, '{broken')
  const broken = spawnSync(process.execPath, args, { env, encoding: 'utf8' })
  assert.notEqual(broken.status, 0)
  assert.equal(readFileSync(cursor, 'utf8'), '{broken')
})

test('owner DM peek does not advance the cursor when the latest message is from self', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-peek-self-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bili = join(dir, 'surfcore/bili'); mkdirSync(bili, { recursive: true })
  const config = join(dir, 'surfcore/bili.config.json'), cursor = join(bili, 'dm-await-state.json')
  writeFileSync(config, JSON.stringify({ owner: { mid: '1001' }, self: { mid: '9999' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'test', bili_jct: 'test', buvid3: 'test' }))
  const initial = JSON.stringify({ lastSeen: 100, seen: { 1001: 100 } }); writeFileSync(cursor, initial)
  const stub = join(dir, 'fetch.mjs')
  const response = (sender, timestamp) => `globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { session_list: [{ talker_id: 1001, last_msg: { sender_uid: ${sender}, timestamp: ${timestamp}, content: 'message' } }] } }) });`
  writeFileSync(stub, response(9999, 200))
  const command = resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs')
  const args = ['--import', resolve('scripts/surfcore-loader.mjs'), '--import', stub, command, '--once', '--json']
  const env = { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_BILI_CONFIG: config, NODE_OPTIONS: '' }
  const peek = spawnSync(process.execPath, [...args, '--peek'], { env, encoding: 'utf8' })
  assert.equal(peek.status, 1); assert.equal(JSON.parse(peek.stdout).hit, false)
  assert.equal(readFileSync(cursor, 'utf8'), initial)
  writeFileSync(stub, response(1001, 150))
  const owner = spawnSync(process.execPath, [...args, '--peek'], { env, encoding: 'utf8' })
  assert.equal(owner.status, 0); assert.equal(JSON.parse(owner.stdout).hit, true)
  writeFileSync(stub, response(9999, 200))
  const normal = spawnSync(process.execPath, args, { env, encoding: 'utf8' })
  assert.equal(normal.status, 1); assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).lastSeen, 200)
})

test('initializing or updating all-person DM mode preserves the owner cursor', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-mode-cursor-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bili = join(dir, 'surfcore/bili'); mkdirSync(bili, { recursive: true })
  const config = join(dir, 'surfcore/bili.config.json'), cursor = join(bili, 'dm-await-state.json')
  writeFileSync(config, JSON.stringify({ owner: { mid: '1001', name: 'owner' }, self: { mid: '9999' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'test', bili_jct: 'test', buvid3: 'test' }))
  const stub = join(dir, 'fetch.mjs')
  writeFileSync(stub, `globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { session_list: [{ talker_id: 1001, last_msg: { sender_uid: 1001, timestamp: 100, content: 'old' } }] } }) });`)
  const command = resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs')
  const args = ['--import', resolve('scripts/surfcore-loader.mjs'), '--import', stub, command]
  const env = { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_BILI_CONFIG: config, NODE_OPTIONS: '' }
  for (const extra of [['--once', '--json', '--peek', '--any'], ['--baseline', '--any'], ['--once', '--json', '--any']]) {
    writeFileSync(cursor, JSON.stringify({ lastSeen: 100, other: 'keep', ...(extra.includes('--peek') || extra.includes('--baseline') ? {} : { seen: { 1001: 1 } }) }))
    const mode = spawnSync(process.execPath, [...args, ...extra], { env, encoding: 'utf8' })
    assert.equal(mode.status, extra.includes('--peek') ? 1 : 0, mode.stderr)
    const saved = JSON.parse(readFileSync(cursor, 'utf8'))
    assert.equal(saved.lastSeen, 100, extra.join(' '))
    assert.equal(saved.other, 'keep', extra.join(' '))
    assert.equal(saved.seen['1001'], 100, extra.join(' '))
    const owner = spawnSync(process.execPath, [...args, '--once', '--json', '--peek'], { env, encoding: 'utf8' })
    assert.equal(JSON.parse(owner.stdout).hit, false, extra.join(' '))
  }
})

test('malformed DM session responses cannot initialize the all-person baseline', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-invalid-response-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bili = join(dir, 'surfcore/bili'); mkdirSync(bili, { recursive: true })
  const config = join(dir, 'surfcore/bili.config.json'), cursor = join(bili, 'dm-await-state.json')
  writeFileSync(config, JSON.stringify({ owner: { mid: '1001' }, self: { mid: '9999' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'test', bili_jct: 'test', buvid3: 'test' }))
  const stub = join(dir, 'fetch.mjs'), initial = JSON.stringify({ lastSeen: 100, other: 'keep' })
  const command = resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs')
  const args = ['--import', resolve('scripts/surfcore-loader.mjs'), '--import', stub, command, '--once', '--json', '--peek', '--any']
  const env = { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_BILI_CONFIG: config, NODE_OPTIONS: '' }
  for (const data of [null, {}, { session_list: {} }]) {
    writeFileSync(cursor, initial)
    writeFileSync(stub, `globalThis.fetch = async () => ({ json: async () => (${JSON.stringify({ code: 0, data })}) });`)
    const result = spawnSync(process.execPath, args, { env, encoding: 'utf8' })
    assert.equal(result.status, 3, JSON.stringify(data))
    assert.equal(readFileSync(cursor, 'utf8'), initial)
  }
  writeFileSync(stub, `globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { session_list: [] } }) });`)
  const empty = spawnSync(process.execPath, args, { env, encoding: 'utf8' })
  assert.equal(empty.status, 1)
  assert.equal(JSON.parse(empty.stdout).hit, false)
})

test('invalid DM cursor contents are preserved by polling, baseline and acknowledgement', async t => {
  const { commitDmSeen } = await import('../scripts/lib/bili-dm-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-invalid-cursor-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bili = join(dir, 'surfcore/bili'); mkdirSync(bili, { recursive: true })
  const config = join(dir, 'surfcore/bili.config.json'), cursor = join(bili, 'dm-await-state.json')
  writeFileSync(config, JSON.stringify({ owner: { mid: '1001' }, self: { mid: '9999' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'test', bili_jct: 'test', buvid3: 'test' }))
  const stub = join(dir, 'fetch.mjs')
  writeFileSync(stub, `globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { session_list: [{ talker_id: 1001, last_msg: { sender_uid: 1001, timestamp: 100, content: 'message' } }] } }) });`)
  const command = resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs')
  const args = ['--import', resolve('scripts/surfcore-loader.mjs'), '--import', stub, command]
  const env = { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_BILI_CONFIG: config, NODE_OPTIONS: '' }
  for (const original of ['{broken', '[]', '{"lastSeen":"bad"}', '{"seen":{"1001":"bad"}}', '{"seen":[]}']) {
    for (const extra of [['--once', '--json', '--peek'], ['--baseline', '--any']]) {
      writeFileSync(cursor, original)
      const result = spawnSync(process.execPath, [...args, ...extra], { env, encoding: 'utf8' })
      assert.notEqual(result.status, 0, `${original} ${extra.join(' ')}`)
      assert.match(result.stderr, /私信游标|SyntaxError/, `${original} ${extra.join(' ')}`)
      assert.equal(readFileSync(cursor, 'utf8'), original)
    }
    for (const any of [false, true]) {
      writeFileSync(cursor, original)
      assert.throws(() => commitDmSeen(cursor, any, [{ mid: '1001', ts: 100 }]))
      assert.equal(readFileSync(cursor, 'utf8'), original)
    }
  }
})

test('DM baseline preserves the previous cursor if atomic publication fails', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-atomic-state-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const bili = join(dir, 'surfcore/bili'); mkdirSync(bili, { recursive: true })
  const config = join(dir, 'surfcore/bili.config.json'), cursor = join(bili, 'dm-await-state.json')
  const original = JSON.stringify({ lastSeen: 50, other: 'keep' }); writeFileSync(cursor, original)
  writeFileSync(config, JSON.stringify({ owner: { mid: '1001' }, self: { mid: '9999' } }))
  writeFileSync(join(bili, 'credentials.json'), JSON.stringify({ sessdata: 'test', bili_jct: 'test', buvid3: 'test' }))
  const stub = join(dir, 'fetch.mjs')
  writeFileSync(stub, `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const original = fs.renameSync; fs.renameSync = (from, to) => { if (to === ${JSON.stringify(cursor)}) throw new Error('simulated cursor publication failure'); return original(from, to); }; syncBuiltinESMExports(); globalThis.fetch = async () => ({ json: async () => ({ code: 0, data: { session_list: [{ talker_id: 1001, last_msg: { sender_uid: 1001, timestamp: 100, content: 'message' } }] } }) });`)
  const command = resolve('plugins/surfcore/plugins/surfcore/tools/commands/dm-await.mjs')
  const args = ['--import', resolve('scripts/surfcore-loader.mjs'), '--import', stub, command, '--baseline', '--any']
  const env = { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_BILI_CONFIG: config, NODE_OPTIONS: '' }
  const failed = spawnSync(process.execPath, args, { env, encoding: 'utf8' })
  assert.notEqual(failed.status, 0)
  assert.match(failed.stderr, /simulated cursor publication failure/)
  assert.equal(readFileSync(cursor, 'utf8'), original)
  assert.deepEqual(readdirSync(bili).filter(name => name.endsWith('.tmp')), [])
})

test('DM scheduler reports invalid command output but treats a no-hit result as normal', async () => {
  const source = transforms.renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('    async function dmTick() {'), source.indexOf('  async function listenTick() {'))
  let output = '', reported = null
  const tick = runInNewContext(`let dmBusy = false, lastDmAt = 0; ${body}; async function run() { lastDmAt = 0; await dmTick() }; run`, {
    Date, path, schedulerStop: new AbortController(), CFG_FILE_REF: 'config', PLATFORM_DIR: '/project', fs: { readFileSync: () => JSON.stringify({ owner: { mid: '1000' }, listen: { dm: true } }), appendFileSync() {} },
    budgetBlockedNow: async () => false, readDmPending: () => null, runBili: async () => ({ ok: false, out: output, err: 'private diagnostic' }), onSessionStatus: error => { reported = error }, platformDir: () => '/project',
  })
  await tick()
  assert.match(String(reported?.message), /私信.*读取失败/)
  assert.doesNotMatch(String(reported?.message), /private diagnostic/)
  reported = null; output = '{"hit":false}'
  await tick()
  assert.equal(reported, null)
})

test('DM cursor updates only delivered messages and preserves other state', async (t) => {
  const { commitDmSeen, dmBatchRequestId } = await import('../scripts/lib/bili-dm-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-cursor-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'cursor.json')
  writeFileSync(file, JSON.stringify({ seen: { 1234: 5, 9999: 20 }, lastSeen: 4, other: 'keep' }))
  commitDmSeen(file, true, [{ mid: '1234', ts: 8 }, { mid: '5678', ts: 3 }])
  let state = JSON.parse(readFileSync(file, 'utf8'))
  assert.deepEqual(state.seen, { 1234: 8, 5678: 3, 9999: 20 })
  assert.equal(state.lastSeen, 4); assert.equal(state.other, 'keep')
  commitDmSeen(file, false, [{ mid: '1234', ts: 2 }])
  state = JSON.parse(readFileSync(file, 'utf8')); assert.equal(state.lastSeen, 4)
  writeFileSync(file, JSON.stringify({ seen: { 1234: '5' }, lastSeen: '4' }))
  commitDmSeen(file, true, [{ mid: '1234', ts: 8 }])
  state = JSON.parse(readFileSync(file, 'utf8')); assert.equal(state.seen['1234'], 8); assert.equal(state.lastSeen, '4')
  assert.equal(dmBatchRequestId([{ mid: '1234', ts: 2, text: 'first' }]), dmBatchRequestId([{ mid: '1234', ts: 2, text: 'changed' }]))
  assert.notEqual(dmBatchRequestId([{ mid: '1234', ts: 2 }]), dmBatchRequestId([{ mid: '1234', ts: 3 }]))
  writeFileSync(file, '{broken')
  assert.throws(() => commitDmSeen(file, true, [{ mid: '1234', ts: 10 }]))
  assert.equal(readFileSync(file, 'utf8'), '{broken')
})

test('DM listener acknowledges only the delivered batch and retries on failure', async () => {
  const source = transforms.renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('    async function dmTick() {'), source.indexOf('  async function listenTick() {'))
  const all = Array.from({ length: 7 }, (_, i) => ({ mid: String(1000 + i), ts: 100 + i, name: 'test', text: 'hello' }))
  const acked = [], sent = []
  let fail = 'prompt', admitted = false, pending = null
  const tick = runInNewContext(`let dmBusy = false, lastDmAt = 0; const toolLine = () => ''; ${body}; async function run() { lastDmAt = 0; await dmTick() }; run`, {
    Date, path, schedulerStop: new AbortController(), CFG_FILE_REF: 'config', PLATFORM_DIR: '/project', fs: { readFileSync: () => JSON.stringify({ owner: { mid: '1000' }, listen: { dm: true, dmScope: 'all' } }), appendFileSync() {} },
    budgetBlockedNow: async () => false, runBili: async (args) => { assert.ok(args.includes('--peek')); return { out: JSON.stringify({ hit: true, items: all.filter((item) => !acked.includes(item.mid)) }) } },
    ensureSession: async () => {}, awaitMemoryContext: async () => {}, identityContextLines: () => [], sessionId: 'bili-whale', platformDir: () => '/project',
    promptBili: async (value) => { if (fail === 'prompt') throw new Error('offline'); sent.push(value); return { accepted: true } },
    commitDmSeen: (_file, _any, items) => { acked.push(...items.map((item) => item.mid)) }, dmBatchRequestId: (items) => JSON.stringify(items.map((item) => item.mid)),
    readDmPending: () => pending, saveDmPending: (_file, value) => { pending = structuredClone(value) }, clearDmPending: () => { pending = null },
    ingestSurfcoreBiliEvents: async () => ({ ok: true }),
    ctx: { sessions: { get: () => ({ snapshotEvents: () => admitted ? [{ type: 'user/message', data: { source: { kind: 'user', rpcId: sent.at(-1)?.requestId } } }] : [] }), flush: async () => fail !== 'flush' } }, AbortController,
  })
  await tick(); assert.equal(acked.length, 0)
  fail = 'flush'
  await tick(); assert.equal(acked.length, 0)
  all.unshift({ mid: '2000', ts: 50, name: 'late-arrival', text: 'newer observation' })
  fail = null
  await tick(); assert.equal(acked.length, 0)
  admitted = true
  await tick(); assert.equal(acked.length, 5); assert.match(sent[2].content[0].text, /5 条/)
  assert.equal(sent[0].requestId, sent[1].requestId)
  assert.equal(sent[1].requestId, sent[2].requestId)
  await tick(); assert.equal(acked.length, 8); assert.equal(sent.length, 4)
})

test('DM pending batch survives restart and refuses invalid stored data', async (t) => {
  const { readDmPending, saveDmPending, clearDmPending } = await import('../scripts/lib/bili-dm-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-pending-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'pending.json')
  assert.equal(readDmPending(file), null)
  const batch = { any: true, ownerMid: '1000', items: [{ mid: '1001', ts: 22, name: 'A', text: 'hello' }] }
  saveDmPending(file, batch)
  assert.deepEqual(readDmPending(file), batch)
  assert.throws(() => saveDmPending(file, batch))
  clearDmPending(file)
  assert.equal(readDmPending(file), null)
  writeFileSync(file, '{broken')
  assert.throws(() => readDmPending(file))
  assert.equal(readFileSync(file, 'utf8'), '{broken')
})

test('DM listener preserves a pending batch when the allowed scope changes', async () => {
  const source = transforms.renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('    async function dmTick() {'), source.indexOf('  async function listenTick() {'))
  const pending = { any: true, ownerMid: '1000', items: [{ mid: '1001', ts: 100, name: 'A', text: 'hello' }] }
  let reported, submitted = 0
  const tick = runInNewContext(`let dmBusy = false, lastDmAt = 0; const toolLine = () => ''; ${body}; dmTick`, {
    Date, path, schedulerStop: new AbortController(), CFG_FILE_REF: 'config', PLATFORM_DIR: '/project', fs: { readFileSync: () => JSON.stringify({ owner: { mid: '1000' }, listen: { dm: true, dmScope: 'owner' } }), appendFileSync() {} },
    budgetBlockedNow: async () => false, readDmPending: () => pending, onSessionStatus: (error) => { reported = error },
    platformDir: () => '/project', promptBili: async () => { submitted++ },
  })
  await tick()
  assert.equal(submitted, 0)
  assert.match(reported.message, /范围|管理员/)
  assert.equal(pending.items.length, 1)
})

test('DM pending batch is recovered after scheduler restart even when the feed changes', async (t) => {
  const cursor = await import('../scripts/lib/bili-dm-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'dm-restart-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const config = join(dir, 'config.json'); writeFileSync(config, JSON.stringify({ owner: { mid: '1000' }, listen: { dm: true, dmScope: 'all' } }))
  const source = transforms.renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('    async function dmTick() {'), source.indexOf('  async function listenTick() {'))
  let admitted = false, polls = 0, requestId
  const feed = [{ mid: '1001', ts: 100, name: 'A', text: 'original' }]
  const makeTick = () => runInNewContext(`let dmBusy = false, lastDmAt = 0; const toolLine = () => ''; ${body}; dmTick`, {
    Date, path, schedulerStop: new AbortController(), CFG_FILE_REF: config, PLATFORM_DIR: dir, fs: { readFileSync, appendFileSync() {} },
    budgetBlockedNow: async () => false, runBili: async () => { polls++; return { out: JSON.stringify({ hit: true, items: feed }) } },
    ensureSession: async () => {}, awaitMemoryContext: async () => {}, identityContextLines: () => [], sessionId: 'bili-whale', platformDir: () => dir,
    promptBili: async (value) => { if (requestId) assert.equal(value.requestId, requestId); requestId = value.requestId; return { accepted: true } },
    ...cursor, ingestSurfcoreBiliEvents: async () => ({ ok: true }), ctx: { sessions: { get: () => ({ snapshotEvents: () => admitted ? [{ type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } }] : [] }), flush: async () => true } }, AbortController,
  })
  await makeTick()()
  assert.equal(cursor.readDmPending(join(dir, 'dm-pending.json')).items[0].text, 'original')
  feed[0] = { mid: '1002', ts: 200, name: 'B', text: 'new' }; admitted = true
  await makeTick()()
  assert.equal(polls, 1)
  assert.equal(cursor.readDmPending(join(dir, 'dm-pending.json')), null)
  assert.equal(JSON.parse(readFileSync(join(dir, 'dm-await-state.json'), 'utf8')).seen['1001'], 100)
})
