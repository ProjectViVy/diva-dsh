/**
 * Strict recap-output parsing for dsh-actmem-recap.
 *
 * Follows Codex's contract (`GeneratedRecap`, `deny_unknown_fields`, 700/200
 * character caps) with one deliberate deviation: overlong text is truncated and
 * flagged instead of failing the run, because a recap that already answered
 * correctly should not be thrown away over a few words.
 *
 * @module dsh-actmem-recap/parse
 */

/** Raised when the model's answer does not match the recap contract. */
export class RecapParseError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RecapParseError'
  }
}

const ALLOWED_KEYS = new Set(['summary', 'next_action'])
const FENCE = /^```[a-zA-Z0-9]*\s*\n?|\n?```$/g

/**
 * Parse one model answer into the recap contract.
 * @param raw - the model's raw text output.
 * @param options - `summaryMaxChars` (700) and `nextActionMaxChars` (200).
 * @returns `{ summary, nextAction, truncated }`.
 * @throws {RecapParseError} when the answer is not one JSON object with a usable summary.
 */
export function parseRecap(raw, { summaryMaxChars = 700, nextActionMaxChars = 200 } = {}) {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (text.length === 0) throw new RecapParseError('the model returned no text')
  const unfenced = stripFence(text)
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) throw new RecapParseError('no JSON object in the model output')
  let parsed
  try {
    parsed = JSON.parse(unfenced.slice(start, end + 1))
  } catch (error) {
    throw new RecapParseError(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RecapParseError('the recap must be a JSON object')
  }
  const unknown = Object.keys(parsed).filter(key => !ALLOWED_KEYS.has(key))
  if (unknown.length > 0) throw new RecapParseError(`unknown recap fields: ${unknown.join(', ')}`)

  if (typeof parsed.summary !== 'string') throw new RecapParseError('summary must be a string')
  let truncated = false
  let summary = parsed.summary.trim()
  if (summary.length === 0) throw new RecapParseError('summary must not be empty')
  if (summary.length > summaryMaxChars) {
    summary = summary.slice(0, summaryMaxChars)
    truncated = true
  }

  const rawNext = parsed.next_action
  if (rawNext !== undefined && rawNext !== null && typeof rawNext !== 'string') {
    throw new RecapParseError('next_action must be a string or null')
  }
  let nextAction = typeof rawNext === 'string' ? rawNext.trim() : null
  if (nextAction !== null && nextAction.length === 0) nextAction = null
  if (nextAction !== null && nextAction.length > nextActionMaxChars) {
    nextAction = nextAction.slice(0, nextActionMaxChars)
    truncated = true
  }
  return { summary, nextAction, truncated }
}

/** Remove one surrounding Markdown code fence, if present. */
function stripFence(text) {
  return text.startsWith('```') ? text.replace(FENCE, '').trim() : text
}

/**
 * Render a stored recap for a human-facing surface.
 * @param recap - a record produced by the plugin, or `{ summary, nextAction }`.
 * @returns the recap text without any JSON framing.
 */
export function renderRecap(recap) {
  const lines = [recap.summary]
  if (typeof recap.nextAction === 'string' && recap.nextAction.length > 0) {
    lines.push('', `下一步：${recap.nextAction}`)
  }
  return lines.join('\n')
}
