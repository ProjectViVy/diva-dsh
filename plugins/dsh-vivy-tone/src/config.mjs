/**
 * dsh-vivy-tone — plugin configuration.
 *
 * Hand-validated rather than schema-validated, so the package stays build-free
 * and dependency-free like `dsh-actmem-recap`. A wrong value names itself; a
 * misspelled key is refused rather than silently ignored, because a silent
 * `autoInstall: "false"` would look like a working off switch.
 *
 * @module dsh-vivy-tone/config
 */

/** Configuration defaults: on, installed once at startup, never forcing. */
export const DEFAULTS = Object.freeze({
  enabled: true,
  autoInstall: true,
  force: false,
  stateDir: '',
  timeoutMs: 10000,
})

const BOOLEAN_KEYS = ['enabled', 'autoInstall', 'force']

/**
 * Validate and normalize plugin configuration.
 *
 * @param {Record<string, unknown>} [raw] - configuration as the bundle or the
 *   profile hands it over.
 * @returns {Readonly<{enabled: boolean, autoInstall: boolean, force: boolean, stateDir: string, timeoutMs: number}>}
 * @throws {TypeError} naming the offending key.
 */
export function resolveConfig(raw = {}) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new TypeError('dsh-vivy-tone: configuration must be an object')
  }

  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(DEFAULTS, key)) throw new TypeError(`dsh-vivy-tone: unknown key "${key}"`)
  }

  const resolved = { ...DEFAULTS }
  for (const key of BOOLEAN_KEYS) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'boolean') throw new TypeError(`dsh-vivy-tone: "${key}" must be a boolean`)
    resolved[key] = raw[key]
  }

  if (raw.stateDir !== undefined) {
    if (typeof raw.stateDir !== 'string') throw new TypeError('dsh-vivy-tone: "stateDir" must be a string')
    resolved.stateDir = raw.stateDir
  }

  if (raw.timeoutMs !== undefined) {
    if (!Number.isInteger(raw.timeoutMs) || raw.timeoutMs <= 0) {
      throw new TypeError('dsh-vivy-tone: "timeoutMs" must be a positive integer')
    }
    resolved.timeoutMs = raw.timeoutMs
  }

  return Object.freeze(resolved)
}
