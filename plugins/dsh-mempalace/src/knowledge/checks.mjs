import { createHash } from 'node:crypto'

/**
 * Every model- or panel-facing knowledge write shares one asset scope: the
 * installation's knowledge graph. `commitKeyFor` namespaces its ledger keys
 * under `kg:` so they stay isolated from the evolution ledger's `evo:` keys.
 */
export const KNOWLEDGE_ASSET_SCOPE = 'knowledge:graph'

const COMMIT_KEY_PREFIX = 'kg:'

const KNOWN_OPS = new Set([
  'upsert_entity',
  'set_entity',
  'restore_entity',
  'upsert_triple',
  'invalidate_triple',
  'set_validity',
])

/** JSON with object keys sorted recursively, so the same op always digests identically. */
function canonical(value) {
  if (value === null || value === undefined) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== ''
}

function integrityOf(op) {
  if (!op || typeof op !== 'object') return false
  switch (op.op) {
    case 'upsert_entity': return nonEmptyString(op.name)
    case 'set_entity': return nonEmptyString(op.entityId) || nonEmptyString(op.name)
    case 'restore_entity': return nonEmptyString(op.entityId)
    case 'upsert_triple': return nonEmptyString(op.subject) && nonEmptyString(op.predicate) && nonEmptyString(op.object)
    case 'invalidate_triple':
    case 'set_validity': return Number.isInteger(Number(op.tripleId))
    default: return false
  }
}

/**
 * Read-only gate in front of every `knowledge_commits` write. A commit is only
 * applied when all four checks pass; the expected shape mirrors the store's
 * `KNOWLEDGE_CHECKS` so a failing check surfaces as `MEMPALACE_KNOWLEDGE_CHECKS`.
 */
export function evaluateKnowledgeChecks({ op, provenance } = {}) {
  const provenanceOk = provenance === undefined || provenance === null
    || (typeof provenance === 'object' && !Array.isArray(provenance))
  return {
    provenance: provenanceOk,
    conflict: typeof op?.op === 'string' && KNOWN_OPS.has(op.op),
    integrity: integrityOf(op),
    retrieval: true,
  }
}

/**
 * A stable, payload-derived ledger key: the same write replays the same
 * revision, a different payload lands on a different key.
 */
export function commitKeyFor({ subjectId, assetScope, op } = {}) {
  const digest = createHash('sha256').update(canonical(op ?? null), 'utf8').digest('hex').slice(0, 16)
  return `${COMMIT_KEY_PREFIX}${subjectId}:${assetScope}:${digest}`
}
