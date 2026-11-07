import { createHash, randomUUID } from 'node:crypto'
import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export function commentItemKey(item) {
  const id = String(item.id ?? '')
  return createHash('sha256').update(JSON.stringify([item.kind ?? '', id, item.mid ?? '', Number(item.t), item.oid ?? '', item.root ?? '', item.parent ?? '', id ? '' : item.who ?? ''])).digest('hex')
}

export function isCommentUnseen(item, state) {
  const time = Number(item.t), since = state?.lastSeen ?? 0
  return time > since || (time === since && Array.isArray(state?.boundaryKeys) && !state.boundaryKeys.includes(commentItemKey(item)))
}

function validKeys(keys) {
  return Array.isArray(keys) && keys.length <= 5000 && keys.every(key => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))
}

/** Read every page through the saved timestamp; refuse a truncated or cyclic scan. */
export async function loadCommentFeed({ pullFeed, kind, headers, since, signal, maxPages = 20 }) {
  const items = [], visited = new Set(), seen = new Set()
  let cursor = ''
  for (let page = 0; page < maxPages; page++) {
    signal?.throwIfAborted()
    if (visited.has(cursor)) throw new Error('评论收件箱分页出现循环')
    visited.add(cursor)
    const result = await pullFeed(kind, { headers, pages: 1, cursor, signal })
    signal?.throwIfAborted()
    if (!result || !Array.isArray(result.items) || (result.nextCursor !== undefined && typeof result.nextCursor !== 'string')) throw new Error('评论收件箱分页结果无效')
    for (const item of result.items) {
      if (!item || !Number.isSafeInteger(Number(item.t)) || Number(item.t) <= 0) throw new Error('评论收件箱消息时间无效')
      const key = commentItemKey(item)
      if (!seen.has(key)) { seen.add(key); items.push(item) }
    }
    const next = result.nextCursor ?? ''
    if (!since || !next || result.items.length === 0 || result.items.every(item => Number(item.t) < since)) return items
    cursor = next
  }
  throw new Error('评论收件箱分页过多，无法确认读取完整')
}

function objectFile(file) {
  let value
  try { value = JSON.parse(readFileSync(file, 'utf8')) } catch (error) { if (error?.code === 'ENOENT') return null; throw error }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('评论监听状态格式无效')
  return value
}

function validatePending(value) {
  if (!value || typeof value !== 'object' || !/^bili-whale-listen-[0-9a-f-]{36}$/.test(value.requestId) || !['reply', 'both'].includes(value.scope) || typeof value.onlyOwner !== 'boolean' || typeof value.ownerMid !== 'string' || !Number.isSafeInteger(value.lastSeen) || value.lastSeen <= 0 || !Number.isSafeInteger(value.count) || value.count <= 0 || typeof value.who !== 'string' || value.who.length > 4000) throw new Error('待处理评论批次格式无效')
  if (value.boundaryKeys !== undefined && !validKeys(value.boundaryKeys)) throw new Error('待处理评论批次边界无效')
  return value
}

export function createCommentPending(fields) {
  return validatePending({ ...fields, requestId: `bili-whale-listen-${randomUUID()}` })
}

export function readCommentPending(file) {
  const value = objectFile(file)
  return value === null ? null : validatePending(value)
}

export function saveCommentPending(file, pending) {
  validatePending(pending); mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, `${JSON.stringify(pending)}\n`, { flag: 'wx', mode: 0o600 }); linkSync(temporary, file) }
  finally { try { unlinkSync(temporary) } catch {} }
}

export function clearCommentPending(file, expected) {
  const current = readCommentPending(file)
  if (current === null) return
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error('待处理评论批次已发生变化')
  unlinkSync(file)
}

export function readCommentCursor(file) {
  const state = objectFile(file)
  if (state === null) return null
  if (state.lastSeen === undefined) return state
  if ((typeof state.lastSeen !== 'number' && !(typeof state.lastSeen === 'string' && /^\d+$/.test(state.lastSeen))) || !Number.isSafeInteger(Number(state.lastSeen)) || Number(state.lastSeen) < 0) throw new Error('评论监听游标无效')
  if (state.boundaryKeys !== undefined && !validKeys(state.boundaryKeys)) throw new Error('评论监听游标边界无效')
  return { ...state, lastSeen: Number(state.lastSeen) }
}

export function commitCommentCursor(file, lastSeen, boundaryKeys) {
  if (!Number.isSafeInteger(lastSeen) || lastSeen <= 0) throw new Error('评论监听游标无效')
  if (boundaryKeys !== undefined && !validKeys(boundaryKeys)) throw new Error('评论监听游标边界无效')
  const state = readCommentCursor(file) ?? {}
  const next = { ...state, lastSeen: Math.max(state.lastSeen ?? 0, lastSeen) }
  if (lastSeen > (state.lastSeen ?? 0)) {
    if (boundaryKeys === undefined) delete next.boundaryKeys
    else next.boundaryKeys = [...new Set(boundaryKeys)]
  } else if (lastSeen === state.lastSeen && boundaryKeys !== undefined) {
    next.boundaryKeys = [...new Set([...(state.boundaryKeys ?? []), ...boundaryKeys])]
    if (!validKeys(next.boundaryKeys)) throw new Error('评论监听游标边界过大')
  }
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try { writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: 'wx', mode: 0o600 }); renameSync(temporary, file) }
  catch (error) { try { unlinkSync(temporary) } catch {}; throw error }
}
