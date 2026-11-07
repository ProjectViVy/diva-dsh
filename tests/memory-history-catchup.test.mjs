import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildHistoryCatchupLine,
  historyWatermark,
  normalizeHistoryConfig,
  selectMissedHistory,
  summarizeHistoryCatchup,
} from '../plugins/memory/src/history-catchup.mjs'

test('history config normalizes invalid user values', () => {
  assert.deepEqual(normalizeHistoryConfig(null), { enabled: true, limit: 30, maxAgeMinutes: 720, wake: true, includePrivate: true })
  assert.deepEqual(normalizeHistoryConfig({ enabled: false, limit: '999', maxAgeMinutes: -3, wake: 'yes', includePrivate: 0 }), {
    enabled: false,
    limit: 100,
    maxAgeMinutes: 1,
    wake: true,
    includePrivate: true,
  })
})

test('history watermark takes the newest signal minus tolerance and never goes below the window floor', () => {
  const state = {
    lastIncomingAt: 100_000,
    lastHistoryMessageTime: 90_000,
    recentMessages: [{ time: 95_000 }, { time: 80_000 }, null],
  }
  assert.equal(historyWatermark(state, { now: 105_000, maxAgeMs: 100_000, toleranceMs: 5_000 }), 95_000)
  assert.equal(historyWatermark({ lastIncomingAt: 1 }, { now: 105_000, maxAgeMs: 10_000, toleranceMs: 0 }), 95_000)
})

test('history selection drops stale, duplicate, blocked, and future messages', () => {
  const now = 1_000_000
  const picked = selectMissedHistory([
    { messageId: 'a', time: now - 1000, userId: '1' },
    { messageId: 'a', time: now - 1000, userId: '1' },
    { messageId: 'old', time: now - 900_000 },
    { messageId: 'blocked', time: now - 1000, userId: '42' },
    { messageId: 'future', time: now + 10 * 60_000 },
    { messageId: '', time: now - 1000 },
    { messageId: 'b', time: now - 2000, userId: '2' },
  ], {
    now,
    watermark: now - 60_000,
    maxAgeMs: 120_000,
    blockedUsers: [42],
    existingIds: ['x'],
  })
  assert.deepEqual(picked.map(item => item.messageId), ['b', 'a'])
})

test('history selection caps to the newest entries', () => {
  const now = 1_000_000
  const candidates = Array.from({ length: 8 }, (_, index) => ({ messageId: `m${index}`, time: now - 10_000 + index * 1000 }))
  const picked = selectMissedHistory(candidates, { now, watermark: 0, maxAgeMs: 60_000, limit: 3 })
  assert.deepEqual(picked.map(item => item.messageId), ['m5', 'm6', 'm7'])
})

test('history summary and line count incoming versus self messages', () => {
  const summary = summarizeHistoryCatchup([{ isSelf: true }, { isSelf: false }, { isSelf: false }, null])
  assert.deepEqual(summary, { incoming: 2, self: 1, total: 3 })
  assert.match(buildHistoryCatchupLine(summary), /2 条群友\/好友消息/)
  assert.match(buildHistoryCatchupLine(summary), /1 条你自己以前发过的消息/)
  assert.equal(buildHistoryCatchupLine({ incoming: 0, self: 0 }), '')
})
