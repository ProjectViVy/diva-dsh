import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  assertOutboundAuditOk,
  createVoiceLedger,
  evaluateVoiceTrigger,
  normalizeVoiceLimits,
  voiceBudgetCheck,
  voiceBudgetCommit,
  VOICE_OWNER_WINDOW_MS,
} from '../plugins/voice/src/voice-policy.mjs'

const now = 1_000_000_000

test('voice trigger allows the owner window and blocks stale or repeated speech', () => {
  const base = { key: 'group:456', kind: 'group', id: '456', ownerId: '1', trigger: { who: 'owner' }, now }
  assert.equal(evaluateVoiceTrigger(base).block, '仅主人可触发语音（这个群还没有主人发言记录）')
  assert.equal(evaluateVoiceTrigger({ ...base, ownerLastAt: now - 1000 }).ok, true)
  assert.equal(evaluateVoiceTrigger({ ...base, ownerLastAt: now - VOICE_OWNER_WINDOW_MS - 1 }).block, '最近 10 分钟主人都没说话，不能主动发语音')
  assert.equal(evaluateVoiceTrigger({ ...base, ownerLastAt: now - 1000, lastSentAt: now - 1000 }).block, '这条消息已经发过语音了，等主人再说一句')
  assert.equal(evaluateVoiceTrigger({ ...base, ownerLastAt: now - 1000, lastSentAt: now - 2000 }).ok, true)
})

test('voice trigger honors private targets, member lists, group allowlists and anyone', () => {
  const owner = { who: 'owner' }
  assert.equal(evaluateVoiceTrigger({ kind: 'private', id: '2', ownerId: '1', trigger: owner, now }).block, '仅主人可触发语音（当前私聊对象不是主人）')
  assert.equal(evaluateVoiceTrigger({ kind: 'private', id: '1', ownerId: '1', trigger: owner, now }).ok, true)
  const list = { who: 'list', members: ['456'] }
  assert.equal(evaluateVoiceTrigger({ kind: 'private', id: '456', ownerId: '1', trigger: list, now }).ok, true)
  assert.equal(evaluateVoiceTrigger({ kind: 'private', id: '789', ownerId: '1', trigger: list, now }).block, '该成员不在语音触发名单里')
  assert.equal(evaluateVoiceTrigger({ kind: 'private', id: '1', ownerId: '1', trigger: list, now }).ok, true)
  assert.equal(evaluateVoiceTrigger({ kind: 'group', id: '456', key: 'group:456', trigger: { who: 'anyone', groups: ['456'] }, now }).ok, true)
  assert.equal(evaluateVoiceTrigger({ kind: 'group', id: '789', key: 'group:789', trigger: { who: 'anyone', groups: ['456'] }, now }).block, '这个群不在语音触发名单里')
  assert.equal(evaluateVoiceTrigger({ kind: 'private', id: '789', trigger: { who: 'anyone', groups: ['456'] }, now }).ok, true)
  assert.equal(evaluateVoiceTrigger({ kind: 'group', id: '456', key: 'group:456', trigger: { who: 'anyone', groups: ['123456789012345678'] }, now }).block, '这个群不在语音触发名单里')
})

test('voice trigger checks the last permitted speaker and one voice per message', () => {
  const base = { key: 'group:789', kind: 'group', id: '789', ownerId: '1', trigger: { who: 'list', members: ['123'] }, now }
  assert.equal(evaluateVoiceTrigger({ ...base, lastSpeaker: { userId: '123', isOwner: false, at: now } }).ok, true)
  assert.equal(evaluateVoiceTrigger({ ...base, lastSpeaker: { userId: '999', isOwner: false, at: now } }).block, '该成员不在语音触发名单里')
  assert.equal(evaluateVoiceTrigger({ ...base, lastSpeaker: { userId: '123', isOwner: false, at: now - VOICE_OWNER_WINDOW_MS - 1 } }).block, '最近没有允许的成员发言，不能触发语音')
  assert.equal(evaluateVoiceTrigger({ ...base, lastSpeaker: { userId: '123', isOwner: false, at: now - 1000 }, lastSentAt: now }).block, '这条消息已经发过语音了，等下一条消息')
  assert.equal(evaluateVoiceTrigger({ ...base, lastSpeaker: { userId: '1', isOwner: true, at: now - 1000 } }).ok, true)
})

test('voice budgets default safely, reject zero-byte config values, and never spend on check', () => {
  assert.deepEqual(normalizeVoiceLimits({}), { maxPerMinute: 2, maxPerHour: 10 })
  assert.deepEqual(normalizeVoiceLimits({ maxPerMinute: '4', maxPerHour: -1 }), { maxPerMinute: 4, maxPerHour: 10 })
  assert.doesNotThrow(() => voiceBudgetCheck([now - 1000], { maxPerMinute: 2, maxPerHour: 2, now }))
  assert.throws(() => voiceBudgetCheck([now - 1000, now - 500], { maxPerMinute: 2, maxPerHour: 10, now }), error => error.code === 'voice.rate-limited' && /分钟/.test(error.message))
  assert.throws(() => voiceBudgetCheck([now - 1000], { maxPerMinute: 0, maxPerHour: 1, now }), error => error.code === 'voice.rate-limited' && /小时/.test(error.message))
  assert.doesNotThrow(() => voiceBudgetCheck([now, now, now], { maxPerMinute: 0, maxPerHour: 0, now }))
  const before = [now - 1000]
  voiceBudgetCheck(before, { maxPerMinute: 2, maxPerHour: 2, now })
  assert.deepEqual(before, [now - 1000])
  assert.deepEqual(voiceBudgetCommit([now - 3_600_001, now - 1000], now), [now - 1000, now])
})

test('voice ledger persists across instances and refuses a corrupt file', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-ledger-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'data', 'send-ledger.json')
  const first = createVoiceLedger({ file, now: () => now + 2000 })
  first.commit('group:1', now)
  first.commit('group:1', now + 1000)
  const second = createVoiceLedger({ file, now: () => now + 2000 })
  assert.equal(second.snapshot('group:1').inMinute, 2)
  assert.throws(() => second.check('group:1', { maxPerMinute: 2, maxPerHour: 10 }), error => error.code === 'voice.rate-limited')
  writeFileSync(file, '{broken')
  assert.throws(() => createVoiceLedger({ file }).snapshot('group:1'), /损坏/)
  assert.equal(readFileSync(file, 'utf8'), '{broken')
})

test('voice audit blocks sensitive file names and known tokens without touching normal names', () => {
  assert.doesNotThrow(() => assertOutboundAuditOk('[语音:晚安.silk]', { knownTokens: ['a'.repeat(32)] }))
  assert.throws(() => assertOutboundAuditOk('/Users/owner/voice/secret.mp3'), error => error.code === 'voice.audit-blocked')
  assert.throws(() => assertOutboundAuditOk('token=abcdef'), error => error.code === 'voice.audit-blocked')
  assert.throws(() => assertOutboundAuditOk(`clip-${'b'.repeat(32)}.mp3`, { knownTokens: ['b'.repeat(32)] }), error => error.code === 'voice.audit-blocked')
  assert.doesNotThrow(() => assertOutboundAuditOk('/Users/owner/voice/secret.mp3', { audit: false }))
})
