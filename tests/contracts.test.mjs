import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ContractError, SUBJECT_SCHEMA_VERSION, assertEnvelope, envelope, isSubjectId, normalizeProvenance,
} from '../plugins/_shared/contracts.mjs'

const SUBJECT = 'subject_00000000-0000-4000-8000-000000000000'

const codeOf = (run) => {
  try {
    run()
    assert.fail('expected a ContractError')
  } catch (error) {
    assert.ok(error instanceof ContractError, `expected ContractError, got ${error}`)
    return error.code
  }
}

test('envelope normalizes provenance and keeps unknown fields', () => {
  const result = envelope({
    subjectId: SUBJECT,
    provenance: { source: 'qq', at: '2026-11-03T10:00:00+08:00', externalId: 'msg_1' },
    memoryId: 'mem_1',
  })
  assert.equal(result.memoryId, 'mem_1')
  assert.equal(result.schemaVersion, SUBJECT_SCHEMA_VERSION)
  assert.equal(result.provenance.at, '2026-11-03T02:00:00.000Z')
  assert.equal(result.provenance.externalId, 'msg_1')
})

test('subject ids are subject_ plus a UUID', () => {
  assert.equal(isSubjectId(SUBJECT), true)
  assert.equal(isSubjectId('subject_not-a-uuid'), false)
  assert.equal(isSubjectId(''), false)
})

test('an invalid subject is rejected', () => {
  assert.equal(codeOf(() => envelope({ subjectId: 'x', provenance: { source: 'qq' } })), 'SUBJECT_INVALID')
})

test('provenance requires a source and normalizes timestamps', () => {
  assert.equal(codeOf(() => normalizeProvenance({})), 'PROVENANCE_INVALID')
  assert.equal(codeOf(() => normalizeProvenance({ source: '  ' })), 'PROVENANCE_INVALID')
  assert.equal(codeOf(() => normalizeProvenance({ source: 'qq', at: 'not-a-time' })), 'PROVENANCE_INVALID')
  const normalized = normalizeProvenance({ source: ' qq ', at: '2026-11-03T10:00:00Z' })
  assert.deepEqual(normalized, { source: 'qq', at: '2026-11-03T10:00:00.000Z' })
})

test('a newer schema version is refused', () => {
  assert.equal(codeOf(() => envelope({
    subjectId: SUBJECT,
    schemaVersion: SUBJECT_SCHEMA_VERSION + 1,
    provenance: { source: 'qq' },
  })), 'SCHEMA_UNSUPPORTED')
  assert.equal(codeOf(() => envelope({
    subjectId: SUBJECT,
    schemaVersion: 0,
    provenance: { source: 'qq' },
  })), 'SCHEMA_INVALID')
})

test('assertEnvelope returns the original record', () => {
  const record = envelope({ subjectId: SUBJECT, provenance: { source: 'qq' } })
  assert.equal(assertEnvelope(record), record)
})
