import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { createMemoryService } from '../plugins/memory/src/service.mjs'
import { registerMemoryInternal } from '../plugins/memory/src/internal.mjs'
import { createBridgeHooks } from '../scripts/lib/surfcore-bridge-hooks.mjs'

process.env.DSH_SUBJECT_ID ??= 'subject_00000000-0000-4000-8000-000000000001'

test('memory module settings, closure, slang, history and snapshots are reachable through authenticated IPC', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'memory-modules-ipc-')); t.after(() => rmSync(home, { recursive: true, force: true }))
  const service = createMemoryService({ stateDir: join(home, 'memory') })
  let handler
  const stop = registerMemoryInternal({ webServer: { port: 3082, register: route => { handler = route.handler; return () => {} } } }, home, service)
  t.after(stop)
  const hooks = createBridgeHooks({ home, log() {}, fetchImpl: async (url, options) => {
    const req = Readable.from(options.body ? [options.body] : [])
    Object.assign(req, { url: new URL(url).pathname, method: options.method, headers: { ...options.headers, host: '127.0.0.1:3082' } })
    let status = 200, data
    await handler(req, { writeHead: code => { status = code }, end: value => { data = value } })
    return new Response(data, { status })
  } })

  const modules = await hooks.memoryModules()
  assert.equal(modules.closure.enabled, true)
  assert.equal(modules.slang.enabled, true)
  assert.equal(modules.history.enabled, true)
  const updated = await hooks.updateMemoryModule('closure', { cooldownMs: 60000, promptInWake: false })
  assert.equal(updated.config.cooldownMs, 60000)
  assert.equal(updated.config.promptInWake, false)
  assert.equal((await hooks.memoryModules()).closure.promptInWake, false)
  await assert.rejects(hooks.updateMemoryModule('persona', { enabled: false }), /Unknown memory module settings/)
  await hooks.updateMemoryModule('closure', { promptInWake: true })

  const now = 1_000_000
  const assessed = await hooks.assessClosure({ now, kind: 'group', messages: [{ messageId: '1', time: now - 1000, text: '晚安', sender: '甲' }] })
  assert.equal(assessed.assessment.verdict, 'close')
  const saved = await hooks.saveClosure({ key: 'group:1', assessment: assessed.assessment, body: { summary: '聊完了', nextOpening: '下次聊' }, now })
  assert.equal(saved.record.summary, '聊完了')
  assert.equal(saved.status.cooldownActive, true)
  assert.equal((await hooks.closureStatusRemote('group:1')).record.summary, '聊完了')
  assert.match((await hooks.closurePrompt({ key: 'group:1', assessment: assessed.assessment, now })).text, /对话收尾判断/)
  assert.equal((await hooks.closureSuppress({ key: 'group:1', reason: 'probability', now })).suppressed, true)
  const reopened = await hooks.reopenClosureRemote({ key: 'group:1', now: now + 10_000 })
  assert.equal(reopened.record.reopenedAt, now + 10_000)

  const upserted = await hooks.slangUpsert({ content: '典中典', patch: { meaning: '经典场面', status: 'confirmed' } })
  assert.equal(upserted.created, true)
  assert.equal((await hooks.slangList()).entries.length, 1)
  assert.match((await hooks.slangContext()).text, /典中典/)
  await hooks.slangDelete(upserted.entry.id)
  assert.equal((await hooks.slangList()).entries.length, 0)

  const at = Date.now()
  const catchup = await hooks.historyCatchup({
    key: 'group:1',
    state: { lastIncomingAt: at - 60_000 },
    candidates: [{ messageId: 'missed-1', time: at - 1000, text: '漏掉的一条', sender: '甲' }],
    persist: true,
  })
  assert.deepEqual(catchup.picked.map(item => item.messageId), ['missed-1'])
  assert.match(catchup.line, /上线补历史/)

  const snapshot = await hooks.contextSnapshot({
    key: 'group:1', now,
    st: {
      unread: [{ seq: 1, messageId: 'm1', time: now - 1000, sender: '甲', text: '在吗' }],
      recentMessages: [{ seq: 1, messageId: 'm1', time: now - 1000, sender: '甲', text: '在吗' }],
    },
  })
  assert.equal(snapshot.version, 1)
  assert.equal(snapshot.unread.total, 1)
  assert.deepEqual(snapshot.activeMembers, [{ name: '甲', count: 1 }])

  const deduped = await hooks.dedupeSessions({ 'group:1': 'session-a', 'group:2': 'session-a', 'group:3': 'session-b' })
  assert.deepEqual(deduped.removed, ['group:1', 'group:2'])
  assert.deepEqual(deduped.mappings, { 'group:3': 'session-b' })
})
