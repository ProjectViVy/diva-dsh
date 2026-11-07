/**
 * Recap history selection for dsh-actmem-recap.
 *
 * Ported from OpenAI Codex's TUI recap reader
 * (`codex-rs/tui/src/app/recap_history.rs`), which selects recent *visible*
 * exchanges without reading tools, reasoning, or another thread's history.
 *
 * Rules preserved here:
 * - the caller hands in cells already filtered to human prompts and assistant
 *   prose, in chronological order; injected context never reaches this module;
 * - at most `maxTurns` answered exchanges, collected newest-first;
 * - adjacent user cells merge into one request (steering stays one request);
 * - a trailing unanswered user request is retained once and labelled pending;
 * - over budget: drop the oldest exchanges behind an omission marker, then
 *   excerpt every remaining field head+tail under a fair-share byte budget.
 *
 * Budgets are bytes, matching the upstream implementation. Byte counts are
 * language-neutral, so a CJK-heavy transcript is bounded honestly here even
 * though any 4-bytes-per-token estimate would underprice it.
 *
 * @module dsh-actmem-recap/history
 */

/** Marker replacing dropped oldest exchanges. */
export const OMITTED_HISTORY = '[更早的往来已省略]\n\n'

/** Marker replacing an excerpted field's middle. */
export const EXCERPT_MARKER = '\n[... 已截断 ...]\n'

/** Label for a user request that has no assistant reply yet. */
export const PENDING_LABEL = '用户（尚未回答）'

const USER_LABEL = '用户'
const ASSISTANT_LABEL = '助手'

/** UTF-8 byte length of one string. */
export function byteLength(text) {
  return Buffer.byteLength(text, 'utf8')
}

/**
 * Collect the newest answered exchanges plus one trailing pending request.
 * @param cells - `{ kind: 'user' | 'assistant', text: string }`, chronological.
 * @param maxTurns - maximum answered exchanges to retain.
 * @returns exchanges oldest-first, each `{ user, assistant }` (either may be '').
 */
export function recentExchanges(cells, maxTurns) {
  const exchanges = []
  let current = { user: '', assistant: '' }
  let answered = 0
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index]
    if (cell === null || typeof cell !== 'object') continue
    const isUser = cell.kind === 'user'
    if (!isUser && cell.kind !== 'assistant') continue
    const content = typeof cell.text === 'string' ? cell.text.trim() : ''
    if (content.length === 0) continue
    // Walking backwards: a request is complete once an assistant cell arrives.
    if (!isUser && current.user.length > 0) {
      if (current.assistant.length > 0) answered += 1
      exchanges.push(current)
      current = { user: '', assistant: '' }
      if (answered === maxTurns) break
    }
    // Prepending keeps the reconstructed order chronological inside one request.
    if (isUser) current.user = current.user.length > 0 ? `${content}\n\n${current.user}` : content
    else current.assistant = current.assistant.length > 0 ? `${content}\n\n${current.assistant}` : content
  }
  if (current.user.length > 0 || current.assistant.length > 0) exchanges.push(current)
  exchanges.reverse()
  return exchanges
}

/**
 * Flatten one exchange into labelled fields, pending requests first-class.
 * @param exchange - `{ user, assistant }` from {@link recentExchanges}.
 * @returns `[label, text]` pairs for the fields this exchange actually has.
 */
export function exchangeFields(exchange) {
  const fields = []
  if (exchange.user.length > 0) {
    fields.push([exchange.assistant.length > 0 ? USER_LABEL : PENDING_LABEL, exchange.user])
  }
  if (exchange.assistant.length > 0) fields.push([ASSISTANT_LABEL, exchange.assistant])
  return fields
}

/**
 * Head+tail excerpt of one field under a byte budget, cutting on code points.
 * @param text - full field text.
 * @param budget - bytes available for the returned excerpt.
 * @returns the excerpt, or the original text when it already fits.
 */
export function excerpt(text, budget) {
  const limit = Math.max(0, budget)
  if (byteLength(text) <= limit) return text
  const markerBytes = byteLength(EXCERPT_MARKER)
  if (limit <= markerBytes) return ''
  const available = limit - markerBytes
  const headBudget = Math.ceil(available / 2)
  const tailBudget = available - headBudget
  return `${headByBytes(text, headBudget)}${EXCERPT_MARKER}${tailByBytes(text, tailBudget)}`
}

/** Longest code-point prefix within a UTF-8 byte budget. */
function headByBytes(text, budget) {
  let bytes = 0
  let end = 0
  for (const character of text) {
    const size = byteLength(character)
    if (bytes + size > budget) break
    bytes += size
    end += character.length
  }
  return text.slice(0, end)
}

/** Longest code-point suffix within a UTF-8 byte budget. */
function tailByBytes(text, budget) {
  const characters = [...text]
  let bytes = 0
  let start = characters.length
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const size = byteLength(characters[index])
    if (bytes + size > budget) break
    bytes += size
    start = index
  }
  return characters.slice(start).join('')
}

/**
 * Render the recap history block under a byte budget.
 * @param cells - chronological visible cells (see {@link recentExchanges}).
 * @param options - `maxTurns` (default 8) and `maxBytes` (default 16000).
 * @returns the history text, or '' when no visible exchange exists.
 */
export function recapHistory(cells, { maxTurns = 8, maxBytes = 16_000 } = {}) {
  const exchanges = recentExchanges(cells, maxTurns)
  if (exchanges.length === 0) return ''
  const budget = Math.max(0, maxBytes)
  const fields = exchanges.map(exchangeFields)
  const blocks = fields.map(renderBlock)
  let bytes = joinBytes(blocks)
  if (bytes <= budget) return blocks.join('\n\n')

  // A pending request is the reason for the recap; keep it ahead of its reply.
  const newest = exchanges.at(-1)
  const protectedCount = newest.assistant.length === 0 ? 2 : 1
  const oldestRetained = Math.max(0, exchanges.length - protectedCount)
  const omissionBytes = byteLength(OMITTED_HISTORY)
  let start = 0
  while (bytes > budget - omissionBytes && start < oldestRetained) {
    bytes -= byteLength(blocks[start]) + 2
    start += 1
  }
  const kept = fields.slice(start).flat()
  const omission = start > 0 ? OMITTED_HISTORY : ''
  return `${omission}${excerptFields(kept, Math.max(0, budget - byteLength(omission))).join('\n\n')}`
}

/** Render one exchange's labelled fields as a block. */
function renderBlock(fields) {
  return fields.map(([label, text]) => `${label}: ${text}`).join('\n\n')
}

/** Total bytes of blocks joined by a blank line. */
function joinBytes(blocks) {
  return blocks.reduce((sum, block) => sum + byteLength(block), 0) + 2 * Math.max(0, blocks.length - 1)
}

/**
 * Give every field a fair share of the remaining budget, oldest first, while
 * reserving enough for the fields that follow it.
 * @param fields - `[label, text]` pairs still under consideration.
 * @param budget - bytes available for labelled fields joined by blank lines.
 * @returns rendered `label: excerpt` strings.
 */
/** Smallest excerpt worth rendering per field; below it the oldest field is dropped instead. */
const MIN_FIELD_BYTES = 64

function excerptFields(fields, budget) {
  if (fields.length === 0) return []
  // A budget too small to say anything about the oldest fields is better spent
  // on the newest ones, which carry the pending request and the latest state.
  let kept = fields
  while (kept.length > 1) {
    const labels = kept.reduce((sum, [label]) => sum + byteLength(label) + 2, 0)
    const separators = 2 * (kept.length - 1)
    if ((budget - labels - separators) / kept.length >= MIN_FIELD_BYTES) break
    kept = kept.slice(1)
  }
  const labelBytes = kept.reduce((sum, [label]) => sum + byteLength(label) + 2, 0)
  const separators = 2 * (kept.length - 1)
  let remaining = budget - labelBytes - separators
  const rendered = []
  for (let index = 0; index < kept.length; index += 1) {
    const [label, text] = kept[index]
    const share = Math.floor(remaining / (kept.length - index))
    const reserved = kept.slice(index + 1)
      .reduce((sum, [, later]) => sum + Math.min(byteLength(later), Math.max(0, share)), 0)
    const piece = excerpt(text, Math.max(0, remaining - reserved))
    remaining -= byteLength(piece)
    rendered.push(`${label}: ${piece}`)
  }
  return rendered
}
