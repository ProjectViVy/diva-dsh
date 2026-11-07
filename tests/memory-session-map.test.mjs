import test from 'node:test'
import assert from 'node:assert/strict'
import { dedupeSessionMappings, findDuplicateSessionIds } from '../plugins/memory/src/session-map.mjs'

test('session map finds every key sharing a session id', () => {
  const duplicates = findDuplicateSessionIds({ 'group:1': 's1', 'group:2': 's1', 'private:9': 's2' })
  assert.deepEqual([...duplicates.entries()], [['s1', ['group:1', 'group:2']]])
})

test('session map removes all mappings for duplicate ids and keeps unique ones', () => {
  const result = dedupeSessionMappings({ 'group:1': 's1', 'group:2': 's1', 'private:9': 's2', 'group:3': '' })
  assert.deepEqual(result.mappings, { 'private:9': 's2' })
  assert.deepEqual(result.removed.sort(), ['group:1', 'group:2'])
  assert.deepEqual(result.duplicates, [{ sessionId: 's1', keys: ['group:1', 'group:2'] }])
})

test('session map tolerates missing or malformed input', () => {
  assert.deepEqual(dedupeSessionMappings(null), { mappings: {}, removed: [], duplicates: [] })
  assert.deepEqual(dedupeSessionMappings([]), { mappings: {}, removed: [], duplicates: [] })
  assert.deepEqual([...findDuplicateSessionIds(undefined).keys()], [])
})
