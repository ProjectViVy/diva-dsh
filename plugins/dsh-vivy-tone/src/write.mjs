/**
 * dsh-vivy-tone — read, plan and save Superagent's prompt configuration.
 *
 * Superagent owns its prompt store; this module only ever talks to the owner's
 * own HTTP API (`GET`/`PUT /orchestrator/api/prompts`), which is the same API
 * its panel uses. Nothing here touches `superagent/`, its SQLite file, or any
 * other plugin's data (docs/architecture.md §17 invariant 11).
 *
 * Two properties matter more than the code:
 *
 *   - A `PUT` replaces the whole configuration, so every request is built from
 *     the configuration just read (`composeConfig`), never from a remembered
 *     one. The four team sections and the skills travel through untouched.
 *   - An override this package did not write is never overwritten. The state
 *     file records a hash per part we saved; a part whose text matches neither
 *     our current translation nor a hash we recorded is treated as a human
 *     edit and left alone, because the whole point is that the panel stays
 *     editable.
 *
 * @module dsh-vivy-tone/write
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { missingPlaceholders } from './zh.mjs'

/** The header Superagent's panel API requires of a same-origin caller. */
export const REQUEST_HEADER = 'x-orchestrator-request'

/** Path of the prompt API on the deployment's web server. */
export const PROMPTS_PATH = '/orchestrator/api/prompts'

/** How long a part may be skipped forever without being called a problem. */
export const STATE_FILE = 'installed.json'

/** @param {string} text */
export const hashText = text => createHash('sha256').update(text, 'utf8').digest('hex')

/** An error from the prompt API, carrying what the server said. */
export class PromptsApiError extends Error {
  /**
   * @param {string} message
   * @param {{status?: number, body?: string}} [detail]
   */
  constructor(message, detail = {}) {
    super(message)
    this.name = 'PromptsApiError'
    this.status = detail.status
    this.body = detail.body
  }
}

/**
 * Read the current prompt configuration.
 *
 * @param {{baseUrl: string, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 * @returns {Promise<{revision: number, config: Record<string, unknown>, parts: Map<string, {key: string, roles?: readonly string[], text: string, base?: string}>}>}
 */
export async function readPrompts({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const response = await fetchImpl(`${baseUrl}${PROMPTS_PATH}`, {
    method: 'GET',
    headers: { [REQUEST_HEADER]: '1' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new PromptsApiError(`dsh-vivy-tone: reading the prompts failed with HTTP ${response.status}`, {
      status: response.status, body: await safeText(response),
    })
  }
  return normalizeView(await response.json())
}

/**
 * Reduce the panel's view to what this package needs.
 *
 * @param {any} view
 */
export function normalizeView(view) {
  const parts = new Map()
  for (const part of view?.parts ?? []) {
    if (part && typeof part.key === 'string') parts.set(part.key, part)
  }
  return {
    revision: view?.revision ?? view?.current?.revision ?? 0,
    config: view?.current?.config ?? {},
    parts,
  }
}

/**
 * Decide, part by part, what to write and what to leave alone.
 *
 * Reasons a part is skipped: `unknown-part` (this Superagent has no such part),
 * `missing-placeholder` (our own text would be rejected — a bug here, not
 * there), `current` (already our text), `foreign` (an override we did not
 * write).
 *
 * @param {{view: ReturnType<typeof normalizeView>, table: Record<string, string>, installed?: Record<string, string>, force?: boolean}} input
 * @returns {{writes: Array<{part: string, text: string, base?: string, replacing?: string}>, skipped: Array<{part: string, reason: string, missing?: readonly string[]}>}}
 */
export function planParts({ view, table, installed = {}, force = false }) {
  const writes = []
  const skipped = []
  for (const [part, text] of Object.entries(table)) {
    const known = view.parts.get(part)
    if (!known) {
      skipped.push({ part, reason: 'unknown-part' })
      continue
    }
    const missing = missingPlaceholders(part, text)
    if (missing.length) {
      skipped.push({ part, reason: 'missing-placeholder', missing })
      continue
    }
    const current = view.config.overrides?.[part]
    if (!current) {
      writes.push({ part, text, ...(known.base ? { base: known.base } : {}) })
      continue
    }
    if (current.text === text) {
      skipped.push({ part, reason: 'current' })
      continue
    }
    const recorded = installed[part]
    const ours = typeof recorded === 'string' && hashText(String(current.text)) === recorded
    if (ours || force) {
      writes.push({ part, text, ...(known.base ? { base: known.base } : {}), replacing: ours ? 'ours' : 'foreign' })
      continue
    }
    skipped.push({ part, reason: 'foreign' })
  }
  return { writes, skipped }
}

/**
 * Build the complete configuration to save: what was just read, with our parts
 * replaced. The team sections and skills are carried through as read, because
 * a save replaces all of them.
 *
 * @param {ReturnType<typeof normalizeView>} view
 * @param {readonly {part: string, text: string, base?: string}[]} writes
 */
export function composeConfig(view, writes) {
  const overrides = { ...(view.config.overrides ?? {}) }
  for (const { part, text, base } of writes) overrides[part] = { text, ...(base ? { base } : {}) }
  return withOverrides(view.config, overrides)
}

/**
 * Build the configuration to save with the named overrides removed — how this
 * package turns itself off without touching anything else.
 *
 * @param {ReturnType<typeof normalizeView>} view
 * @param {readonly string[]} parts
 */
export function stripConfig(view, parts) {
  const overrides = { ...(view.config.overrides ?? {}) }
  for (const part of parts) delete overrides[part]
  return withOverrides(view.config, overrides)
}

/** @param {Record<string, unknown>} config */
function withOverrides(config, overrides) {
  const { overrides: _dropped, ...rest } = config
  return Object.keys(overrides).length ? { ...rest, overrides } : { ...rest }
}

/**
 * Save a configuration against the revision it was read from.
 *
 * @param {{baseUrl: string, config: Record<string, unknown>, baseRevision: number, fetchImpl?: typeof fetch, timeoutMs?: number}} options
 */
export async function savePrompts({ baseUrl, config, baseRevision, fetchImpl = globalThis.fetch, timeoutMs = 10000 }) {
  const response = await fetchImpl(`${baseUrl}${PROMPTS_PATH}`, {
    method: 'PUT',
    headers: { [REQUEST_HEADER]: '1', 'content-type': 'application/json' },
    body: JSON.stringify({ config, baseRevision }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new PromptsApiError(`dsh-vivy-tone: saving the prompts failed with HTTP ${response.status}`, {
      status: response.status, body: await safeText(response),
    })
  }
  const body = await response.json().catch(() => undefined)
  return body ?? {}
}

/** @param {Response} response */
async function safeText(response) {
  try {
    return (await response.text()).slice(0, 800)
  } catch {
    return undefined
  }
}

/**
 * Read the record of what this package wrote.
 *
 * @param {string} stateDir
 * @returns {{savedAt?: string, revision?: number, parts: Record<string, string>}}
 */
export function readState(stateDir) {
  const file = join(stateDir, STATE_FILE)
  if (!existsSync(file)) return { parts: {} }
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { ...parsed, parts: parsed?.parts && typeof parsed.parts === 'object' ? parsed.parts : {} }
  } catch {
    return { parts: {} }
  }
}

/**
 * Record what this package wrote, atomically, so a crash cannot leave a
 * half-written record that would make a later run mistake our own text for a
 * hand edit.
 *
 * @param {string} stateDir
 * @param {{parts: Record<string, string>, revision?: number}} data
 */
export function writeState(stateDir, data) {
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, STATE_FILE)
  const temporary = join(dirname(file), `.${STATE_FILE}.tmp`)
  writeFileSync(temporary, `${JSON.stringify({ savedAt: new Date().toISOString(), ...data }, null, 2)}\n`, 'utf8')
  renameSync(temporary, file)
  return file
}
