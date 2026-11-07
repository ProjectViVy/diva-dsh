/**
 * Idempotent archive intake for MemPalace.
 *
 * ActMem delivers faded memory bodies here; `archive_id` (minted by ActMem) plus a canonical digest is the
 * ledger key, so a retry, a crash between write and receipt, or a re-sent batch can never duplicate a row
 * and never silently accepts a body the sender declared differently from what it actually sent.
 */

import { isSubjectId, normalizeProvenance } from '../../_shared/contracts.mjs'
import {
  ARCHIVE_DIGEST_PATTERN,
  ARCHIVE_ID_PATTERN,
  ARCHIVE_SCHEMA_VERSION,
  ARCHIVE_SOURCE,
  archiveDigest,
  canonicalJson,
} from '../../_shared/archive-contract.mjs'
import { normalizeProjectLabel } from './store/chunk.mjs'

/** Kept below the 512 KB component-IPC body cap so a batch is never rejected by the transport first. */
export const ARCHIVE_LIMITS = Object.freeze({ maxItems: 200, maxBytes: 384 * 1024, maxContentChars: 40_000, maxIds: 200 })

/** ActMem sections are the only project labels an archive may claim; anything else lands in 'other'. */
const PROJECTS = new Set(['qq', 'bili', 'owner', 'pet', 'other'])

function fail(code, message, hint) {
  return Object.assign(new Error(message), { code, hint })
}

function readLimits(limits = {}) {
  const positive = (value, fallback) => (Number.isInteger(value) && value > 0 ? value : fallback)
  return {
    maxItems: positive(limits.maxItems, ARCHIVE_LIMITS.maxItems),
    maxBytes: positive(limits.maxBytes, ARCHIVE_LIMITS.maxBytes),
    maxContentChars: positive(limits.maxContentChars, ARCHIVE_LIMITS.maxContentChars),
    maxIds: positive(limits.maxIds, ARCHIVE_LIMITS.maxIds),
  }
}

function checkItem(item, { maxContentChars }) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'archive item must be an object', '重新生成归档意图后再投递')
  }
  if (typeof item.archive_id !== 'string' || !ARCHIVE_ID_PATTERN.test(item.archive_id)) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', `archive_id ${item.archive_id ?? ''} does not match arch_<记录id>_r<修订>`, '归档标识必须由 ActMem 按记录与修订铸造')
  }
  if (typeof item.digest !== 'string' || !ARCHIVE_DIGEST_PATTERN.test(item.digest)) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', `archive ${item.archive_id} carries a malformed digest`, 'digest 必须是 canonical JSON 的 sha256 十六进制')
  }
  if (typeof item.content !== 'string' || !item.content.trim()) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', `archive ${item.archive_id} has no content`, '归档正文不能为空，请保留本地全量档案并修正该记录')
  }
  if (item.content.length > maxContentChars) {
    throw fail('MEMPALACE_ARCHIVE_BATCH_TOO_LARGE', `archive ${item.archive_id} exceeds ${maxContentChars} content characters`, '缩小单条归档正文或降低 archiveOut.batchChars')
  }
  const meta = item.meta
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', `archive ${item.archive_id} has no meta`, '归档必须携带 project/topic/timestamp/provenance 元数据')
  }
  try {
    normalizeProvenance(meta.provenance)
  } catch {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', `archive ${item.archive_id} has no valid provenance`, '缺少 provenance.source/at 的归档会被拒绝')
  }
}

/** Validates the delivery envelope; never rewrites the signed fields, so both sides compute the same digest. */
export function readArchiveRequest(body, { subjectId, limits } = {}) {
  const { maxItems, maxBytes, maxContentChars } = readLimits(limits)
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'archive request must be an object', '请投递 {schema_version, subject_id, items}')
  }
  if (!Number.isInteger(body.schema_version) || body.schema_version < 1) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'schema_version must be a positive integer', '归档请求必须带版本号')
  }
  if (body.schema_version > ARCHIVE_SCHEMA_VERSION) {
    throw fail('MEMPALACE_ARCHIVE_SCHEMA_UNSUPPORTED', `archive schema ${body.schema_version} is newer than ${ARCHIVE_SCHEMA_VERSION}`, '升级 MemPalace 后再投递归档')
  }
  if (!isSubjectId(body.subject_id)) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'subject_id must be subject_<uuid>', '无主归档不会被接收')
  }
  if (!isSubjectId(subjectId) || body.subject_id !== subjectId) {
    throw fail('MEMPALACE_ARCHIVE_SUBJECT_MISMATCH', `archive subject ${body.subject_id} is not the local subject`, '确认 DSH_SUBJECT_ID 与记忆插件的 subject 一致')
  }
  if (!Array.isArray(body.items) || !body.items.length) {
    throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'archive request must carry at least one item', '空批次不应该投递')
  }
  if (body.items.length > maxItems) {
    throw fail('MEMPALACE_ARCHIVE_BATCH_TOO_LARGE', `archive batch carries ${body.items.length} items (limit ${maxItems})`, '降低 archiveOut.batchLimit')
  }
  for (const item of body.items) checkItem(item, { maxContentChars })
  const bytes = Buffer.byteLength(canonicalJson(body.items), 'utf8')
  if (bytes > maxBytes) {
    throw fail('MEMPALACE_ARCHIVE_BATCH_TOO_LARGE', `archive batch is ${bytes} bytes (limit ${maxBytes})`, '降低 archiveOut.batchBytes')
  }
  return {
    schemaVersion: body.schema_version,
    subjectId: body.subject_id,
    items: body.items.map(item => ({ archive_id: item.archive_id, digest: item.digest, content: item.content, meta: item.meta })),
  }
}

function archiveMetaOf(item) {
  const meta = item.meta
  return {
    ...meta,
    project: normalizeProjectLabel(PROJECTS.has(meta.project) ? meta.project : 'other'),
    topic: typeof meta.topic === 'string' ? meta.topic : '',
    session_id: typeof meta.session_id === 'string' ? meta.session_id : '',
    importance: Number.isFinite(meta.importance) ? Math.min(1, Math.max(0, meta.importance)) : 0.5,
  }
}

function receiptOf(row, subjectId) {
  return {
    archive_id: row.archive_id,
    digest: row.digest,
    memory_ids: Array.isArray(row.memory_ids) ? row.memory_ids : [],
    chunks: Number.isInteger(row.chunks) ? row.chunks : 0,
    subject_id: row.subject_id ?? subjectId,
    received_at: row.received_at ?? null,
  }
}

async function persistArchive(store, { subjectId, items, now, receivedAt }) {
  const results = []
  for (const item of items) {
    const expected = archiveDigest({ schema_version: ARCHIVE_SCHEMA_VERSION, subject_id: subjectId, archive_id: item.archive_id, content: item.content, meta: item.meta })
    if (item.digest !== expected) {
      results.push({
        archive_id: item.archive_id,
        state: 'rejected',
        digest: expected,
        code: 'MEMPALACE_ARCHIVE_DIGEST_MISMATCH',
        message: `declared digest does not match the delivered body for ${item.archive_id}`,
        hint: '归档正文与意图必须逐字节一致；请检查意图是否被改写',
      })
      continue
    }
    const row = await store.findArchiveById(item.archive_id)
    if (row?.conflict) {
      results.push({
        archive_id: item.archive_id,
        state: 'conflict',
        digest: expected,
        code: 'MEMPALACE_ARCHIVE_ROWS_INCONSISTENT',
        message: `archive ${item.archive_id} is stored with more than one digest`,
        hint: '归档账本已不一致，需要人工核对 MemPalace 的 memories 行',
        digests: Array.isArray(row.digests) ? row.digests : [],
      })
      continue
    }
    if (row) {
      if (row.subject_id && row.subject_id !== subjectId) {
        results.push({
          archive_id: item.archive_id,
          state: 'conflict',
          digest: expected,
          code: 'MEMPALACE_ARCHIVE_SUBJECT_MISMATCH',
          message: `archive ${item.archive_id} already belongs to another subject`,
          hint: '确认 DSH_SUBJECT_ID 未变更；换主体后不得复用同一归档标识',
        })
        continue
      }
      const same = row.digest === expected
      results.push(same
        ? { archive_id: item.archive_id, state: 'duplicate', digest: expected, receipt: receiptOf(row, subjectId) }
        : {
          archive_id: item.archive_id,
          state: 'conflict',
          digest: expected,
          stored_digest: row.digest ?? null,
          code: 'MEMPALACE_ARCHIVE_DIGEST_CONFLICT',
          message: `archive ${item.archive_id} already exists with different content`,
          hint: '同一 archive_id 承载了不同正文；请把该意图送入 conflict/ 隔离，不要自动重试',
        })
      continue
    }
    const inserted = await store.insertArchive({
      archive_id: item.archive_id,
      digest: expected,
      content: item.content,
      meta: archiveMetaOf(item),
      subject_id: subjectId,
      source: ARCHIVE_SOURCE,
      schema_version: ARCHIVE_SCHEMA_VERSION,
      received_at: receivedAt,
      now,
    })
    results.push({
      archive_id: item.archive_id,
      state: 'archived',
      digest: expected,
      receipt: { archive_id: item.archive_id, digest: expected, memory_ids: inserted.memory_ids ?? [], chunks: inserted.chunks ?? 0, subject_id: subjectId, received_at: receivedAt },
    })
  }
  return { ok: true, schema_version: ARCHIVE_SCHEMA_VERSION, results }
}

/**
 * Commits one batch. Store failures propagate instead of being turned into per-item results: an unknown
 * outcome must stay unknown so ActMem keeps the intent and reconciles through queryArchive later.
 */
export function commitArchive(store, { subjectId, items, now = Date.now() } = {}) {
  if (!isSubjectId(subjectId)) throw fail('MEMPALACE_ARCHIVE_SUBJECT_MISMATCH', 'the receiving MemPalace has no valid subject', '确认 subject 解析成功后再投递归档')
  if (!Array.isArray(items) || !items.length) throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'archive batch is empty', '空批次不应该投递')
  return persistArchive(store, { subjectId, items, now, receivedAt: new Date(now).toISOString() })
}

async function lookupArchive(store, ids) {
  const states = []
  for (const archiveId of ids) {
    const row = await store.findArchiveById(archiveId)
    if (!row) states.push({ archive_id: archiveId, state: 'absent' })
    else if (row.conflict) states.push({ archive_id: archiveId, state: 'conflict', code: 'MEMPALACE_ARCHIVE_ROWS_INCONSISTENT' })
    else states.push({ archive_id: archiveId, state: 'archived', digest: row.digest, memory_ids: row.memory_ids ?? [], chunks: row.chunks ?? 0 })
  }
  return { ok: true, states }
}

/** Reconciliation read used before any re-send: "already archived" must never require the original body. */
export function queryArchive(store, { archiveIds } = {}, { limits } = {}) {
  const { maxIds } = readLimits(limits)
  if (!Array.isArray(archiveIds)) throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'archive_ids must be an array', '状态查询需要归档标识数组')
  const ids = []
  for (const archiveId of archiveIds) {
    if (typeof archiveId !== 'string' || !ARCHIVE_ID_PATTERN.test(archiveId)) {
      throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', `archive_id ${archiveId ?? ''} does not match arch_<记录id>_r<修订>`, '状态查询只接受 ActMem 铸造的归档标识')
    }
    if (!ids.includes(archiveId)) ids.push(archiveId)
  }
  if (!ids.length) throw fail('MEMPALACE_ARCHIVE_ENVELOPE_INVALID', 'archive_ids must not be empty', '至少查询一个归档标识')
  if (ids.length > maxIds) throw fail('MEMPALACE_ARCHIVE_BATCH_TOO_LARGE', `archive status asks for ${ids.length} ids (limit ${maxIds})`, '降低 archiveOut.statusLimit')
  return lookupArchive(store, ids)
}
