import * as crypto from 'node:crypto'

export const CHUNK_SIZE = 800
export const CHUNK_OVERLAP = 100
export const MIN_CHUNK_SIZE = 50
export const EMBEDDING_DIM = 384

export function contentHash(content) {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex').slice(0, 16)
}

/**
 * Split long content on paragraph or line boundaries with a bounded overlap.
 * Progress is guaranteed even when the caller supplies overlap >= chunk size.
 */
export function chunkText(content, options = {}) {
  const chunkSize = Math.max(1, options.chunkSize ?? CHUNK_SIZE)
  const overlap = Math.max(0, Math.min(options.chunkOverlap ?? CHUNK_OVERLAP, chunkSize - 1))
  const minSize = Math.max(0, options.minChunkSize ?? MIN_CHUNK_SIZE)
  if (content.length <= chunkSize) return [content]

  const chunks = []
  let offset = 0
  while (offset < content.length) {
    let end = Math.min(offset + chunkSize, content.length)
    if (end < content.length) {
      const paraBreak = content.lastIndexOf('\n\n', end)
      if (paraBreak > offset + chunkSize / 2) end = paraBreak
      else {
        const lineBreak = content.lastIndexOf('\n', end)
        if (lineBreak > offset + chunkSize / 2) end = lineBreak
      }
    }
    const chunk = content.slice(offset, end).trim()
    if (chunk.length >= minSize) chunks.push(chunk)
    if (end >= content.length) break
    offset = Math.max(end - overlap, offset + 1)
  }
  return chunks.length > 0 ? chunks : [content]
}

/** Convert sqlite-vec L2 distance to cosine similarity for L2-normalized vectors. */
export function distanceToSimilarity(distance) {
  return 1 - (distance * distance) / 2
}

export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4)
}

export function normalizeProjectLabel(value) {
  const label = String(value ?? '').trim()
  if (!label || label === '.' || label === '/') return 'general'
  return label.slice(0, 80)
}

export function normalizeTopicLabel(label) {
  const cleaned = String(label ?? '')
    .trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/g, '')
    .replace(/^topic\s*:\s*/i, '')
    .toLowerCase()
    .replace(/["'`]/g, '')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  if (!cleaned || cleaned.length < 2) return 'general'
  if (['none', 'n-a', 'na', 'unknown', 'misc', 'other'].includes(cleaned)) return 'general'
  return cleaned
}

/** Turn free-form query text into a safe FTS5 MATCH expression. */
export function ftsQuery(text) {
  const tokens = String(text ?? '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}_-]+/u)
    .map(token => token.trim())
    .filter(token => /[\p{L}\p{N}]/u.test(token))
    .slice(0, 16)
  return tokens.map(token => `"${token.replaceAll('"', '""')}"`).join(' OR ')
}
