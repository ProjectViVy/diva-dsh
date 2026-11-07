import test from 'node:test'
import assert from 'node:assert/strict'
import {
  assessConversationClosure,
  classifyMessage,
  closeGate,
  closurePromptBlock,
  closureStatus,
  closureSuppressesWake,
  makeClosureRecord,
  normalizeClosureConfig,
  normalizeClosureRecord,
  reopenClosure,
} from '../plugins/memory/src/conversation-closure.mjs'

test('closure classifies common message kinds', () => {
  assert.equal(classifyMessage('晚安').kind, 'ending')
  assert.equal(classifyMessage('你在吗？').kind, 'question')
  assert.equal(classifyMessage('帮我看看这个').kind, 'request')
  assert.equal(classifyMessage('好的').kind, 'ack')
  assert.equal(classifyMessage('今天去了公园').kind, 'substantive')
  assert.equal(classifyMessage('').kind, 'silence')
})

test('closure config normalizes user values', () => {
  assert.equal(normalizeClosureConfig({ cooldownMs: 1 }).cooldownMs, 60_000)
  assert.equal(normalizeClosureConfig({ maxSummaryChars: 9999 }).maxSummaryChars, 500)
  assert.equal(normalizeClosureConfig({ enabled: 'no' }).enabled, true)
})

test('closure refuses to end while the other side is waiting for an answer', () => {
  const now = 1_000_000
  const assessment = assessConversationClosure({
    now,
    kind: 'group',
    messages: [{ messageId: '1', time: now - 1000, text: '你能帮我查一下吗？', sender: '甲' }],
  })
  assert.equal(assessment.signals.awaitingTheirAnswer, true)
  assert.equal(assessment.verdict, 'continue')
  const gate = closeGate(assessment)
  assert.equal(gate.blocked, true)
  assert.equal(gate.reason, 'open-question')
})

test('closure recommends a natural close after an ending and an ack', () => {
  const now = 1_000_000
  const assessment = assessConversationClosure({
    now,
    kind: 'group',
    messages: [
      { messageId: '1', time: now - 2000, text: '嗯', sender: '甲' },
      { messageId: '2', time: now - 1000, text: '晚安', sender: '我', isSelf: true },
    ],
  })
  assert.equal(assessment.verdict, 'close')
  assert.equal(assessment.signals.topicClosure, 0.9)
  assert.equal(closeGate(assessment).blocked, false)
})

test('closure record lifecycle covers cooldown, status, reopen, and wake suppression', () => {
  const now = 1_000_000
  const assessment = assessConversationClosure({ now, messages: [{ messageId: '1', time: now - 1000, text: '晚安', sender: '甲' }] })
  const record = makeClosureRecord({ key: 'group:1', assessment, body: { summary: '聊完了', nextOpening: '下次聊' }, now, config: { cooldownMs: 60_000 } })
  assert.equal(record.reason, 'explicit-end')
  assert.equal(record.cooldownUntil, now + 60_000)
  assert.equal(closureStatus(record, now).cooldownActive, true)
  assert.equal(closureSuppressesWake(record, 'probability', now), true)
  assert.equal(closureSuppressesWake(record, 'direct', now), false)
  const reopened = reopenClosure(record, { now: now + 10_000 })
  assert.equal(reopened.reopenedAt, now + 10_000)
  assert.equal(normalizeClosureRecord(record, {}).summary, '聊完了')
  assert.equal(normalizeClosureRecord({ at: 0 }, {}), null)
})

test('closure prompt block is empty when disabled and explains the verdict otherwise', () => {
  const assessment = assessConversationClosure({ messages: [{ messageId: '1', time: Date.now() - 1000, text: '晚安', sender: '甲' }] })
  assert.equal(closurePromptBlock(assessment, { config: { enabled: false } }), '')
  const block = closurePromptBlock(assessment, { config: { enabled: true } })
  assert.match(block, /对话收尾判断/)
  assert.match(block, /qq_close_conversation/)
})
