/** Cross-domain envelope shared by ActMem, MemPalace, Laputa and Evolution. */

export const SUBJECT_SCHEMA_VERSION = 1

const SUBJECT = /^subject_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export class ContractError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ContractError'
    this.code = code
  }
}

export const isSubjectId = value => typeof value === 'string' && SUBJECT.test(value)

const text = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContractError('PROVENANCE_INVALID', `provenance.${field} must be a non-empty string`)
  }
  return value.trim()
}

export function normalizeProvenance(input = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ContractError('PROVENANCE_INVALID', 'provenance must be an object')
  }
  const source = text(input.source, 'source')
  const time = Date.parse(input.at ?? new Date().toISOString())
  if (!Number.isFinite(time)) {
    throw new ContractError('PROVENANCE_INVALID', 'provenance.at must be a timestamp')
  }
  const result = { source, at: new Date(time).toISOString() }
  for (const field of ['externalId', 'actor', 'note']) {
    if (input[field] !== undefined) result[field] = text(input[field], field)
  }
  return result
}

export function envelope(record = {}) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new ContractError('SCHEMA_INVALID', 'record must be an object')
  }
  const { subjectId, schemaVersion = SUBJECT_SCHEMA_VERSION, provenance, ...rest } = record
  if (!isSubjectId(subjectId)) {
    throw new ContractError('SUBJECT_INVALID', 'subjectId must be subject_<uuid>')
  }
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new ContractError('SCHEMA_INVALID', 'schemaVersion must be a positive integer')
  }
  if (schemaVersion > SUBJECT_SCHEMA_VERSION) {
    throw new ContractError('SCHEMA_UNSUPPORTED', `schemaVersion ${schemaVersion} is newer than ${SUBJECT_SCHEMA_VERSION}`)
  }
  return { ...rest, subjectId, schemaVersion, provenance: normalizeProvenance(provenance) }
}

export function assertEnvelope(record) {
  envelope(record)
  return record
}
