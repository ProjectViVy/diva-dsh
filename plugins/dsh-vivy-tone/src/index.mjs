/**
 * dsh-vivy-tone — Superagent's prompts in Chinese, on one switch.
 *
 * The Superagent main Session's system prompt is a single `complete` section
 * Superagent composes itself, so no third-party section can join it
 * (`superagent/src/app/sessions.ts:244-249`). The only way in is Superagent's
 * own prompt API, which is also its panel's: this plugin reads, replaces the
 * parts it owns, and saves against the revision it read.
 *
 * Mounting the bundle installs wave 1 once at startup; installing or removing
 * the plugin is the switch. Removing our overrides without unmounting is
 * `removeTranslations`, reachable from the CLI, and any single part can still
 * be reset from Superagent's own panel (Settings -> Prompts).
 *
 * @module dsh-vivy-tone
 */

import { resolveConfig } from './config.mjs'
import { applyTranslations, resolveStateDir } from './install.mjs'

export const name = 'dsh-vivy-tone'
export const inject = ['webServer']

/** The main Session's prompt API is loopback-only, as Superagent's own guard says. */
const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost'])

/**
 * @param {any} ctx - the plugin's Cordis context.
 * @param {Record<string, unknown>} [rawConfig] - the patch row's `config`.
 */
export function apply(ctx, rawConfig = {}) {
  const config = resolveConfig(rawConfig)
  const log = message => {
    try {
      ctx.logger?.info?.(message)
    } catch {
      // A logger that refuses a message must not fail the install.
    }
    if (config.enabled && config.autoInstall) console.info(message)
  }

  if (!config.enabled) {
    log('dsh-vivy-tone: disabled by configuration; Superagent keeps whatever prompts it has')
    return
  }

  const webServer = ctx.webServer
  if (!webServer || !LOOPBACK.has(webServer.host)) {
    log(`dsh-vivy-tone: not installing; the prompt API is loopback-only and this server is at ${webServer?.host ?? 'unknown'}`)
    return
  }
  if (!config.autoInstall) {
    log('dsh-vivy-tone: autoInstall is off; run `node plugins/dsh-vivy-tone/src/cli.mjs --install` when you want the Chinese text')
    return
  }

  const baseUrl = `http://${webServer.host}:${webServer.port}`
  const stateDir = resolveStateDir(config.stateDir)
  const run = () => applyTranslations({
    baseUrl, stateDir, force: config.force, timeoutMs: config.timeoutMs, log,
  }).catch(error => {
    // A missing or older Superagent is not this plugin's failure to escalate:
    // the panel still works, and the CLI reports the same thing on demand.
    log(`dsh-vivy-tone: ${error?.message ?? error}`)
  })

  if (typeof ctx.effect === 'function') ctx.effect(() => { void run() })
  else void run()
}
