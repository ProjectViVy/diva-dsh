/**
 * Archive delivery contract shared by ActMem (sender) and MemPalace (receiver).
 * Only one implementation of the digest lives here, so both sides always agree on it.
 */

import { createHash } from 'node:crypto'

export const ARCHIVE_SCHEMA_VERSION = 1
/** Marks archived rows apart from MemPalace's own auto-capture rows. */
export const ARCHIVE_SOURCE = 'actmem-archive'
export const ARCHIVE_ID_PATTERN = /^arch_[a-zA-Z0-9._-]{1,200}_r\d{1,7}$/
export const ARCHIVE_DIGEST_PATTERN = /^[0-9a-f]{64}$/

function canonical(value) {
  if (Array.isArray(value)) return value.map(entry => entry === undefined ? null : canonical(entry))
  if (value === null || typeof value !== 'object') return value === undefined ? null : value
  const result = {}
  for (const key of Object.keys(value).sort()) {
    const entry = value[key]
    if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue
    result[key] = canonical(entry)
  }
  return result
}

/** Deterministic JSON: keys sorted recursively, no whitespace, undefined dropped from objects. */
export function canonicalJson(value) {
  return JSON.stringify(canonical(value))
}

/**
 * sha256 over the archive envelope only; retries of the same body always reproduce the same digest.
 * @param {{schema_version?: unknown, subject_id?: unknown, archive_id?: unknown, content?: unknown, meta?: unknown}} item
 */
export function archiveDigest(item = {}) {
  const payload = canonicalJson({
    schema_version: item.schema_version,
    subject_id: item.subject_id,
    archive_id: item.archive_id,
    content: item.content,
    meta: item.meta,
  })
  return createHash('sha256').update(payload, 'utf8').digest('hex')
}
