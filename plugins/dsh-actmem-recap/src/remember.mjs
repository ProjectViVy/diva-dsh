/**
 * Card placement for dsh-actmem-recap: write a generated recap into the
 * decaying ActMem memory card (`dsh-local-memory`) over component IPC.
 *
 * Why `scope: 'qq'` is the only accepted scope — the card's own visibility
 * rule decides where a record may travel (`card-engine.mjs`, `visibleFor`):
 *
 *   scope 'shared' or 'bili'  → lands in the B站 module, which the Bilibili
 *                               context renders (limit 8): it would cross into
 *                               public replies.
 *   scope 'qq' + source manual → dropped from the Bilibili context outright
 *                               ("Private conversations never cross platforms"),
 *                               and still visible to the owner-facing context.
 *
 * `addManualMemory` stamps `source: 'manual'`, so a qq-scoped recap can never
 * reach the Bilibili context. A recap is a working note about 大湿's own
 * conversation; it has no business in a public reply context. Anything that
 * would cross is refused here rather than silently exported.
 *
 * @module dsh-actmem-recap/remember
 */

import { callComponent } from '../../_shared/ipc.mjs'

/** `redactForMemory` default cap applied by the memory plugin's `add` action. */
export const CARD_TEXT_MAX_CHARS = 600

/** Largest title the memory plugin keeps after its own truncation. */
const CARD_TITLE_MAX_CHARS = 80

/**
 * Compose the card body, protecting the actionable tail from truncation.
 * @param recap - `{ summary, nextAction }`.
 * @param maxChars - hard cap the memory plugin will also apply.
 * @returns text no longer than `maxChars`.
 */
export function composeCardText(recap, maxChars = CARD_TEXT_MAX_CHARS) {
  const next = typeof recap.nextAction === 'string' && recap.nextAction.length > 0
    ? `\n下一步：${recap.nextAction}`
    : ''
  const room = Math.max(0, maxChars - next.length)
  const summary = typeof recap.summary === 'string' ? recap.summary : ''
  const head = summary.length > room ? `${summary.slice(0, Math.max(0, room - 1))}…` : summary
  return `${head}${next}`.slice(0, maxChars)
}

/**
 * Build the card title, which carries the provenance the body does not.
 * @param options - `{ at, turn }`.
 * @returns a title within the card's own title budget.
 */
export function cardTitle({ at, turn }) {
  const stamp = formatStamp(new Date(at))
  const parts = ['归队简报', stamp]
  if (Number.isInteger(turn)) parts.push(`第 ${turn} 轮`)
  return parts.join(' · ').slice(0, CARD_TITLE_MAX_CHARS)
}

/**
 * Store one recap in the memory card.
 *
 * Never throws: a recap is useful even when the card is unavailable, so every
 * failure is reported as data for the caller to surface and record.
 *
 * @param options - `{ home, recap, at, turn, config }`.
 * @returns `{ stored, duplicate, reason }`.
 */
export async function rememberRecap({ home, recap, at, turn, config }) {
  const text = composeCardText(recap, config.maxChars)
  if (text.length === 0) return { stored: false, duplicate: false, reason: 'empty recap text' }
  try {
    await callComponent({
      home,
      name: 'memory',
      path: '/actmem/add',
      body: {
        scope: config.scope,
        text,
        title: cardTitle({ at, turn }),
        importance: config.importance,
        tags: config.tags,
      },
      timeoutMs: config.timeoutMs,
    })
    return { stored: true, duplicate: false, reason: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/duplicat|empty|重复|为空/i.test(message)) return { stored: false, duplicate: true, reason: 'already in the card' }
    return { stored: false, duplicate: false, reason: message }
  }
}

/** Local `YYYY-MM-DD HH:mm` stamp, matching the command surface. */
function formatStamp(date) {
  if (Number.isNaN(date.getTime())) return String(date)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
