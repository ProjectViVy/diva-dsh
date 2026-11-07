import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import path from 'node:path'
import { runInNewContext } from 'node:vm'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { renderSchedulerSource } from '../scripts/lib/surfcore-runtime-transform.mjs'

test('comment feed scans pages until it passes the saved cursor', async () => {
  const { loadCommentFeed } = await import('../scripts/lib/bili-comment-cursor.mjs')
  const calls = []
  const pages = { '': { items: [{ id: '3', t: 30 }], nextCursor: 'a' }, a: { items: [{ id: '2', t: 20 }], nextCursor: 'b' }, b: { items: [{ id: '1', t: 9 }], nextCursor: 'c' } }
  const items = await loadCommentFeed({ kind: 'reply', headers: {}, since: 10, pullFeed: async (_kind, options) => { calls.push(options.cursor); return pages[options.cursor] } })
  assert.deepEqual(calls, ['', 'a', 'b'])
  assert.deepEqual(items.map(item => item.id), ['3', '2', '1'])
})

test('comment feed refuses incomplete or looping pagination', async () => {
  const { loadCommentFeed } = await import('../scripts/lib/bili-comment-cursor.mjs')
  await assert.rejects(loadCommentFeed({ kind: 'reply', headers: {}, since: 1, maxPages: 2, pullFeed: async (_kind, { cursor }) => ({ items: [{ id: cursor || 'first', t: 3 }], nextCursor: cursor ? 'b' : 'a' }) }), /分页|完整/)
  await assert.rejects(loadCommentFeed({ kind: 'reply', headers: {}, since: 1, pullFeed: async () => ({ items: [{ id: 'x', t: 3 }], nextCursor: 'a' }) }), /分页|循环/)
})

test('comment cursor retains IDs at its timestamp and accepts later same-second messages', async (t) => {
  const h = await import('../scripts/lib/bili-comment-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'comment-same-second-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'cursor.json')
  const a = { kind: 'reply', id: '1', t: 10, mid: '1001' }, b = { kind: 'reply', id: '2', t: 10, mid: '1002' }
  const aKey = h.commentItemKey(a), bKey = h.commentItemKey(b)
  h.commitCommentCursor(file, 10, [aKey])
  let state = h.readCommentCursor(file)
  assert.equal(h.isCommentUnseen(a, state), false)
  assert.equal(h.isCommentUnseen(b, state), true)
  h.commitCommentCursor(file, 10, [bKey])
  state = h.readCommentCursor(file)
  assert.equal(h.isCommentUnseen(b, state), false)
  assert.deepEqual(new Set(state.boundaryKeys), new Set([aKey, bKey]))
  assert.equal(h.isCommentUnseen(b, { lastSeen: 10 }), false)
})

test('project loader exposes message feed pagination without changing IDs', (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'comment-loader-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const moduleUrl = pathToFileURL(resolve('plugins/surfcore/plugins/surfcore/tools/lib/msgfeed.mjs')).href
  const code = `globalThis.fetch = async (url) => ({ json: async () => ({ code: 0, data: { cursor: String(url).includes('cursor=next') ? '' : 'next', items: [{ id: 1, reply_time: 20, user: { mid: '123', nickname: 'u' }, item: { uri: 'https://t.bilibili.com/1261813571425140745' } }] } }) }); const { pullFeed } = await import(${JSON.stringify(moduleUrl)}); const a = await pullFeed('reply', { headers: {} }); const b = await pullFeed('reply', { headers: {}, cursor: a.nextCursor }); process.stdout.write(JSON.stringify({ first: a.nextCursor, last: b.nextCursor, oid: a.items[0].oid }));`
  const output = execFileSync(process.execPath, ['--import', resolve('scripts/surfcore-loader.mjs'), '--input-type=module', '-e', code], {
    env: { ...process.env, DSH_HOME: dir, SURFCORE_LOCAL_SOURCE: resolve('plugins/surfcore'), SURFCORE_COMPONENT_SPLIT: '1', NODE_OPTIONS: '' }, encoding: 'utf8',
  })
  assert.deepEqual(JSON.parse(output), { first: 'next', last: '', oid: '1261813571425140745' })
})

test('comment batch waits for history, survives restart, and preserves later messages', async (t) => {
  const helpers = await import('../scripts/lib/bili-comment-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'comment-pending-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const config = join(dir, 'config.json'), cursor = join(dir, 'whale-listen.json')
  writeFileSync(config, JSON.stringify({ owner: { mid: '1234' }, listen: { comment: true, allDay: true } }))
  writeFileSync(cursor, JSON.stringify({ lastSeen: 1 }))
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function listenTick() {'), source.indexOf('  // ── 直播间监听：起一个'))
  let admitted = false, polls = 0, requestId, failure
  let replies = [{ t: 2, who: 'test', mid: '1234', kind: 'reply', id: 'a' }]
  const makeTick = () => runInNewContext(`let listening = false, lastListenAt = 0; ${body}; listenTick`, {
    path, schedulerStop: new AbortController(), Date, AbortController, CFG_FILE_REF: config, CRED_REF: 'cred', LSTATE: cursor, PLATFORM_DIR: dir, sessionId: 'bili-whale',
    fs: { readFileSync: (file) => file === 'cred' ? '{}' : readFileSync(file, 'utf8') },
    budgetBlockedNow: async () => false, makeHeaders: () => ({}), readL: () => JSON.parse(readFileSync(cursor, 'utf8')),
    pullFeed: async (kind) => { polls++; return { items: kind === 'reply' ? replies : [] } },
    limitsNow: () => ({ replyDaily: 7, mineDaily: 8, minePerPerson: 2 }), ensureSession: async () => {}, awaitMemoryContext: async () => {},
    promptBili: async (value) => { if (requestId) assert.equal(value.requestId, requestId); requestId = value.requestId }, identityContextLines: () => [], toolLine: () => '', log() {},
    ctx: { sessions: { get: () => ({ snapshotEvents: () => admitted ? [{ type: 'user/message', data: { source: { kind: 'user', rpcId: requestId } } }] : [] }), flush: async () => true } }, onSessionStatus: (error) => { failure = error }, ...helpers,
  })
  await makeTick()()
  assert.equal(failure, undefined)
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).lastSeen, 1)
  assert.ok(helpers.readCommentPending(join(dir, 'comment-pending.json')))
  admitted = true
  await makeTick()()
  assert.equal(polls, 2)
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).lastSeen, 2)
  assert.equal(helpers.readCommentPending(join(dir, 'comment-pending.json')), null)
  requestId = undefined
  replies = [{ t: 2, who: 'test2', mid: '1235', kind: 'reply', id: 'b' }]
  await makeTick()()
  assert.equal(JSON.parse(readFileSync(cursor, 'utf8')).boundaryKeys.length, 2)
  assert.equal(polls, 4)
})

test('comment state rejects corruption and preserves pending data', async (t) => {
  const helpers = await import('../scripts/lib/bili-comment-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'comment-corrupt-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const cursor = join(dir, 'whale-listen.json'), pendingFile = join(dir, 'comment-pending.json')
  writeFileSync(cursor, '{broken')
  assert.throws(() => helpers.commitCommentCursor(cursor, 42))
  assert.equal(readFileSync(cursor, 'utf8'), '{broken')
  writeFileSync(cursor, JSON.stringify({ lastSeen: '40', extra: 'preserved' }))
  helpers.commitCommentCursor(cursor, 42)
  assert.deepEqual(JSON.parse(readFileSync(cursor, 'utf8')), { lastSeen: 42, extra: 'preserved' })
  const pending = helpers.createCommentPending({ scope: 'both', onlyOwner: false, ownerMid: '', lastSeen: 42, count: 1, who: 'test' })
  helpers.saveCommentPending(pendingFile, pending)
  assert.throws(() => helpers.saveCommentPending(pendingFile, pending))
  assert.throws(() => helpers.clearCommentPending(pendingFile, { ...pending, lastSeen: 43 }))
  assert.deepEqual(helpers.readCommentPending(pendingFile), pending)
  writeFileSync(pendingFile, '{broken')
  assert.throws(() => helpers.readCommentPending(pendingFile))
  assert.equal(readFileSync(pendingFile, 'utf8'), '{broken')
})

test('saving Bilibili settings does not reset the comment cursor', () => {
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const section = source.slice(source.indexOf('    invalidate() {'), source.indexOf('    stop() {'))
  assert.doesNotMatch(section, /writeL\(\{\}\)/)
})

test('comment listener preserves pending batch after scope changes', async (t) => {
  const helpers = await import('../scripts/lib/bili-comment-cursor.mjs')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'comment-scope-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const pending = helpers.createCommentPending({ scope: 'both', onlyOwner: false, ownerMid: '1234', lastSeen: 42, count: 1, who: 'test' })
  helpers.saveCommentPending(join(dir, 'comment-pending.json'), pending)
  const source = renderSchedulerSource(readFileSync(resolve('plugins/surfcore/plugins/surfcore/lib/scheduler.js'), 'utf8'), 'file:///hooks.mjs')
  const body = source.slice(source.indexOf('  async function listenTick() {'), source.indexOf('  // ── 直播间监听：起一个'))
  let error, prompted = 0
  const tick = runInNewContext(`let listening = false, lastListenAt = 0; ${body}; listenTick`, {
    path, schedulerStop: new AbortController(), Date, CFG_FILE_REF: 'config', PLATFORM_DIR: dir,
    fs: { readFileSync: () => JSON.stringify({ owner: { mid: '1234' }, listen: { comment: true, allDay: true, scope: 'reply' } }) },
    budgetBlockedNow: async () => false, onSessionStatus: (value) => { error = value }, promptBili: async () => { prompted++ }, log() {}, ...helpers,
  })
  await tick()
  assert.equal(prompted, 0)
  assert.match(error.message, /范围|管理员/)
  assert.deepEqual(helpers.readCommentPending(join(dir, 'comment-pending.json')), pending)
})
