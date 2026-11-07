import { createHash, randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function dmBatchRequestId(items) {
  const identity = items.map(({ mid, ts }) => [String(mid), Number(ts)])
  return `bili-whale-dm-${createHash('sha256').update(JSON.stringify(identity)).digest('hex')}`
}

function validatePending(batch) {
  if (!batch || typeof batch !== 'object' || typeof batch.any !== 'boolean' || !/^\d+$/.test(String(batch.ownerMid ?? '')) || !Array.isArray(batch.items) || batch.items.length < 1 || batch.items.length > 5) throw new Error('待处理私信批次格式无效')
  for (const item of batch.items) {
    if (!item || !/^\d+$/.test(String(item.mid ?? '')) || !Number.isSafeInteger(item.ts) || item.ts <= 0 || typeof item.name !== 'string' || typeof item.text !== 'string' || item.name.length > 500 || item.text.length > 300) throw new Error('待处理私信内容无效')
  }
  return batch
}

export function readDmPending(file) {
  try { return validatePending(JSON.parse(readFileSync(file, 'utf8'))) }
  catch (error) { if (error?.code === 'ENOENT') return null; throw error }
}

export function saveDmPending(file, batch) {
  validatePending(batch)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, `${JSON.stringify(batch)}\n`, { flag: 'wx', mode: 0o600 }); linkSync(temporary, file) }
  finally { try { unlinkSync(temporary) } catch {} }
}

export function clearDmPending(file, expected) {
  const current = readDmPending(file)
  if (current === null) return
  if (expected && JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('待处理私信批次已发生变化')
  unlinkSync(file)
}

function validateDmState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('私信游标格式无效')
  const validTime = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0
  if (state.lastSeen !== undefined && !validTime(state.lastSeen)) throw new Error('私信游标 lastSeen 无效')
  if (state.seen !== undefined) {
    if (!state.seen || typeof state.seen !== 'object' || Array.isArray(state.seen)) throw new Error('私信游标 seen 格式无效')
    if (Object.values(state.seen).some(value => !validTime(value))) throw new Error('私信游标时间无效')
  }
  return state
}

export function readDmState(file) {
  let state
  try { state = JSON.parse(readFileSync(file, 'utf8')) }
  catch (error) { if (error?.code === 'ENOENT') return {}; throw error }
  return validateDmState(state)
}

export function writeDmState(file, state) {
  validateDmState(state)
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); renameSync(temporary, file) }
  catch (error) { try { unlinkSync(temporary) } catch {}; throw error }
}

/** Commit only a batch delivered to the session. A failed write leaves the prior cursor intact. */
export function commitDmSeen(file, any, items) {
  const state = readDmState(file)
  if (!Array.isArray(items) || !items.length) throw new Error('私信确认批次为空')
  const seen = { ...(state.seen || {}) }
  let last = Number(state.lastSeen ?? 0)
  if (!Number.isSafeInteger(last) || last < 0) throw new Error('私信游标 lastSeen 无效')
  for (const item of items) {
    const mid = String(item?.mid ?? ''), timestamp = Number(item?.ts)
    if (!/^\d+$/.test(mid) || !Number.isSafeInteger(timestamp) || timestamp <= 0) throw new Error('私信确认数据无效')
    if (any) {
      const previous = Number(seen[mid] ?? 0)
      if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('私信游标时间无效')
      seen[mid] = Math.max(previous, timestamp)
    } else last = Math.max(last, timestamp)
  }
  const now = new Date().toISOString()
  const next = any ? { ...state, seen, seenAt: Math.floor(Date.now() / 1000), at: now } : { ...state, lastSeen: last, at: now }
  writeDmState(file, next)
}
