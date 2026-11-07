import test from 'node:test'
import assert from 'node:assert/strict'
import { buildContextSnapshot, DEFAULT_SNAPSHOT_CAPS } from '../plugins/memory/src/context-snapshot.mjs'

test('context snapshot filters self messages and respects afterSeq', () => {
  const snapshot = buildContextSnapshot({
    key: 'group:1',
    now: 1_000,
    afterSeq: 2,
    st: {
      unread: [
        { seq: 1, messageId: 'a', time: 10, sender: '甲', text: '旧' },
        { seq: 2, messageId: 'b', time: 20, sender: '乙', text: '第二条' },
        { seq: 3, messageId: 'c', time: 30, sender: '我', text: '自己', isSelf: true },
        { seq: 4, messageId: 'd', time: 40, sender: '甲', text: '新' },
      ],
      recentMessages: [{ seq: 4, time: 40, sender: '甲', text: '新' }],
    },
  })
  assert.deepEqual(snapshot.unread.items.map(item => item.messageId), ['d'])
  assert.equal(snapshot.unread.total, 1)
  assert.equal(snapshot.unread.nextAfterSeq, 4)
  assert.equal(snapshot.counts.unread, 3)
})

test('context snapshot truncates text and emits detail refs', () => {
  const long = 'x'.repeat(300)
  const snapshot = buildContextSnapshot({ now: 1, st: { recentMessages: [{ seq: 1, time: 1, sender: '甲', text: long }] } })
  assert.equal(snapshot.recent.items[0].text.length, DEFAULT_SNAPSHOT_CAPS.textChars)
  assert.equal(snapshot.recent.items[0].textTruncated, true)
  assert.deepEqual(snapshot.refs[0], { type: 'message', seq: 1, detailTool: 'qq_get_message_detail', reason: 'textTruncated' })
})

test('context snapshot honors include and caps', () => {
  const snapshot = buildContextSnapshot({
    now: 1,
    include: ['unread'],
    caps: { unread: 2, textChars: 40 },
    st: { unread: Array.from({ length: 5 }, (_, index) => ({ seq: index, time: index, sender: '甲', text: 'x' })) },
  })
  assert.equal(snapshot.unread.items.length, 2)
  assert.equal(snapshot.unread.truncated, true)
  assert.equal(snapshot.recent, undefined)
  assert.equal(snapshot.social, undefined)
  assert.equal(snapshot.caps.unread, 2)
})

test('context snapshot ranks active members from recent messages', () => {
  const snapshot = buildContextSnapshot({
    now: 1,
    st: { recentMessages: [{ sender: '甲', text: '1' }, { sender: '乙', text: '2' }, { sender: '甲', text: '3' }, { sender: '我', text: '4', isSelf: true }] },
  })
  assert.deepEqual(snapshot.activeMembers, [{ name: '甲', count: 2 }, { name: '乙', count: 1 }])
})
