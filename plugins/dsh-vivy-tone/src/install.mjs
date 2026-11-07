/**
 * dsh-vivy-tone — one run of the install, shared by the plugin and the CLI.
 *
 * The whole package is this module plus a trigger: the plugin calls it once at
 * startup, the CLI calls it on demand. Both paths go through Superagent's own
 * prompt API, and both leave the panel's prompt history in charge of rollback.
 *
 * @module dsh-vivy-tone/install
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  composeConfig, hashText, planParts, readPrompts, readState, savePrompts, stripConfig, writeState,
} from './write.mjs'
import { TRANSLATIONS, WAVE } from './zh.mjs'

/** Where the record of our writes lives unless the configuration says otherwise. */
export function defaultStateDir(env = process.env) {
  const home = env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  return join(home, 'vivy-tone')
}

/**
 * Resolve the state directory: what the configuration says, resolved like any
 * path, otherwise the deployment's own home.
 *
 * @param {string} stateDir
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveStateDir(stateDir, env = process.env) {
  return stateDir ? resolve(stateDir) : defaultStateDir(env)
}

/** One line per part, for a log a person reads. */
const describe = ({ skipped }) => skipped.map(({ part, reason, missing }) => (
  missing?.length ? `${part} (${reason}: ${missing.join(', ')})` : `${part} (${reason})`
)).join(', ')

/**
 * Write the Chinese text of every part this wave owns.
 *
 * Idempotent: a part already holding our text is skipped, and a part holding
 * an override this package did not write is left alone unless `force` is set.
 *
 * @param {{baseUrl: string, stateDir: string, force?: boolean, dryRun?: boolean,
 *   fetchImpl?: typeof fetch, timeoutMs?: number, log?: (message: string) => void}} options
 */
export async function applyTranslations({
  baseUrl, stateDir, force = false, dryRun = false, fetchImpl, timeoutMs, log = () => {},
}) {
  const view = await readPrompts({ baseUrl, fetchImpl, timeoutMs })
  const installed = readState(stateDir).parts
  const { writes, skipped } = planParts({ view, table: TRANSLATIONS, installed, force })

  if (!writes.length) {
    log(`dsh-vivy-tone: nothing to write at revision ${view.revision}${skipped.length ? ` (${describe({ skipped })})` : ''}`)
    return { revision: view.revision, written: [], skipped, saved: false }
  }
  log(`dsh-vivy-tone: wave ${WAVE} writes ${writes.map(write => write.part).join(', ')}`
    + `${skipped.length ? ` (leaving ${describe({ skipped })})` : ''}`)
  if (dryRun) return { revision: view.revision, written: writes.map(write => write.part), skipped, saved: false, dryRun: true }

  const config = composeConfig(view, writes)
  const result = await savePrompts({ baseUrl, config, baseRevision: view.revision, fetchImpl, timeoutMs })
  const parts = { ...installed }
  for (const write of writes) parts[write.part] = hashText(write.text)
  writeState(stateDir, { parts, revision: result?.revision ?? view.revision + 1 })
  const revision = result?.revision ?? view.revision + 1
  log(`dsh-vivy-tone: saved revision ${revision} with ${writes.length} translated part(s)`)
  return { revision, written: writes.map(write => write.part), skipped, saved: true }
}

/**
 * Remove the overrides this package wrote, leaving every other override, team
 * section and skill exactly as read. This is the off switch: the parts return
 * to their built-in English text, and Superagent keeps the previous revision
 * in its history either way.
 *
 * @param {{baseUrl: string, stateDir: string, dryRun?: boolean,
 *   fetchImpl?: typeof fetch, timeoutMs?: number, log?: (message: string) => void}} options
 */
export async function removeTranslations({ baseUrl, stateDir, dryRun = false, fetchImpl, timeoutMs, log = () => {} }) {
  const view = await readPrompts({ baseUrl, fetchImpl, timeoutMs })
  const installed = readState(stateDir).parts
  const ours = Object.keys(installed).filter(part => Object.hasOwn(view.config.overrides ?? {}, part))

  if (!ours.length) {
    log(`dsh-vivy-tone: no override of ours to remove at revision ${view.revision}`)
    return { revision: view.revision, removed: [], saved: false }
  }
  log(`dsh-vivy-tone: removing ${ours.join(', ')}`)
  if (dryRun) return { revision: view.revision, removed: ours, saved: false, dryRun: true }

  const config = stripConfig(view, ours)
  const result = await savePrompts({ baseUrl, config, baseRevision: view.revision, fetchImpl, timeoutMs })
  const parts = { ...installed }
  for (const part of ours) delete parts[part]
  writeState(stateDir, { parts, revision: result?.revision ?? view.revision + 1 })
  const revision = result?.revision ?? view.revision + 1
  log(`dsh-vivy-tone: saved revision ${revision}; ${ours.length} part(s) are back to their built-in text`)
  return { revision, removed: ours, saved: true }
}
