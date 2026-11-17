// Third-party community plugins live under `third-party/` as git submodules, one
// directory per plugin, each pinned to an upstream tag that *declares*
// compatibility with the DSH version this deployment runs.
//
// The pin is not decoration: `third-party/pins.json` records the tag, and this
// module re-checks it against what is actually on disk (the checked-out
// package version) and against the plugin's own `dsh.compatibility.dshReleases`
// map. A plugin that silently drifts to `main` fails the check instead of
// loading into the panel.
//
// Read-only: nothing here writes. Registration lives in `scripts/setup-third-party.mjs`.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
export const THIRD_PARTY_DIR = join(ROOT, 'third-party')
export const PINS_FILE = join(THIRD_PARTY_DIR, 'pins.json')

/** Parse `0.2.1-rc.5`, `v0.83.1`, `0.2.1-rc.2+` (the trailing `+` marks a floor). */
export function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(text).trim().replace(/\+$/, ''))
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ? match[4].split('.') : [] }
}

/** Semver precedence for the subset we see here: numeric identifiers sort below alphanumeric, release sorts above its prereleases. */
function comparePrerelease(left, right) {
  if (!left.length && !right.length) return 0
  if (!left.length) return 1
  if (!right.length) return -1
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index], b = right[index]
    if (a === undefined) return -1
    if (b === undefined) return 1
    const numericA = /^\d+$/.test(a), numericB = /^\d+$/.test(b)
    if (numericA && numericB) {
      if (Number(a) !== Number(b)) return Number(a) < Number(b) ? -1 : 1
    } else if (numericA !== numericB) {
      return numericA ? -1 : 1
    } else if (a !== b) {
      return a < b ? -1 : 1
    }
  }
  return 0
}

export function compareVersions(left, right) {
  const a = typeof left === 'string' ? parseVersion(left) : left
  const b = typeof right === 'string' ? parseVersion(right) : right
  if (!a || !b) throw new Error(`Unparseable version: ${typeof left === 'string' ? left : 'object'} vs ${typeof right === 'string' ? right : 'object'}`)
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] < b.core[index] ? -1 : 1
  }
  return comparePrerelease(a.pre, b.pre)
}

/** `0.2.1-rc.2+` means ">= 0.2.1-rc.2"; an unknown constraint form throws rather than guessing. */
export function satisfiesRelease(version, constraint) {
  if (!String(constraint).endsWith('+')) throw new Error(`Unsupported DSH release constraint: ${constraint}`)
  const floor = parseVersion(constraint)
  const current = parseVersion(version)
  if (!floor) throw new Error(`Unparseable DSH release constraint: ${constraint}`)
  if (!current) throw new Error(`Unparseable DSH version: ${version}`)
  return compareVersions(current, floor) >= 0
}

/** One comparator: ^x.y.z-pre, >=x.y.z, <=, >, <, or an exact version. */
const COMPARATOR_RE = /^(\^|>=|<=|>|<|=)?\s*v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/

/**
 * Whether a package's own engines.dsh range covers the deployed DSH version.
 * That is the second declaration form in the wild (dsh-genui) - a semver range
 * instead of the dshReleases floor map. Only the comparator forms the range uses
 * are accepted; anything else throws rather than guessing. The caret upper bound
 * ignores node-semver's prerelease rule: ^0.2.1-rc.1 is read as >=0.2.1-rc.1 <0.3.0.
 */
export function satisfiesRange(version, range) {
  if (typeof range !== 'string' || range.trim() === '') throw new Error('Unparseable DSH range: ' + range)
  const current = parseVersion(version)
  if (!current) throw new Error('Unparseable DSH version: ' + version)
  return range.split('||').some(part => satisfiesComparator(current, part.trim()))
}

function satisfiesComparator(current, text) {
  const match = COMPARATOR_RE.exec(text)
  if (!match) throw new Error('Unsupported DSH range comparator: ' + text)
  const operator = match[1] ?? '='
  const target = parseVersion(match[2])
  const order = compareVersions(current, target)
  if (operator === '^') {
    if (order < 0) return false
    const [major, minor, patch] = target.core
    const upper = major > 0
      ? { core: [major + 1, 0, 0], pre: [] }
      : minor > 0 ? { core: [0, minor + 1, 0], pre: [] } : { core: [0, 0, patch + 1], pre: [] }
    return compareVersions(current, upper) < 0
  }
  if (operator === '>=') return order >= 0
  if (operator === '>') return order > 0
  if (operator === '<') return order < 0
  if (operator === '<=') return order <= 0
  return order === 0
}

export function readPins(root = ROOT) {
  const file = join(root, 'third-party', 'pins.json')
  const pins = JSON.parse(readFileSync(file, 'utf8'))
  if (pins?.version !== 1 || typeof pins.plugins !== 'object' || pins.plugins === null) throw new Error(`${file} is not a version 1 pin file`)
  for (const [name, pin] of Object.entries(pins.plugins)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) throw new Error(`${file}: invalid plugin name ${name}`)
    if (typeof pin?.tag !== 'string' || !parseVersion(pin.tag)) throw new Error(`${file}: ${name} needs a version-shaped tag`)
  }
  return pins
}

/** The DSH version this deployment actually runs, not the one a plugin wishes for. */
export function deployedDshVersion(root = ROOT) {
  const manifest = JSON.parse(readFileSync(join(root, 'deepseek-harness', 'package.json'), 'utf8'))
  if (!parseVersion(manifest.version)) throw new Error(`Unparseable DSH version: ${manifest.version}`)
  return manifest.version
}

/**
 * Inspect one pinned plugin without touching it.
 * `missing` lists what blocks registration; empty means ready.
 */
export function inspectThirdPartyPlugin(root, name, pins = readPins(root)) {
  const pin = pins.plugins[name]
  if (!pin) throw new Error(`No pin for third-party plugin ${name}`)
  const dir = join(root, 'third-party', name)
  const manifestFile = join(dir, 'package.json')
  const result = { name, dir, pinnedTag: pin.tag, version: null, dshVersion: deployedDshVersion(root), releases: [], range: null, missing: [] }
  if (!existsSync(manifestFile)) {
    result.missing.push('source: the submodule is not checked out')
    return result
  }
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  result.version = manifest.version
  if (`v${manifest.version}` !== pin.tag) result.missing.push(`pin: pins.json says ${pin.tag}, the checkout is ${manifest.version}`)
  const declared = manifest.dsh?.compatibility?.dshReleases
  const range = typeof manifest.engines?.dsh === 'string' ? manifest.engines.dsh.trim() : ''
  if (declared && typeof declared === 'object' && Object.keys(declared).length) {
    result.releases = Object.keys(declared).filter(key => declared[key] === 'compatible')
    if (!result.releases.some(key => satisfiesRelease(result.dshVersion, key))) result.missing.push('compatibility: no declared release covers DSH ' + result.dshVersion)
  } else if (range !== '') {
    // The other declaration form in the wild: a package engines.dsh semver range.
    result.range = range
    try {
      if (!satisfiesRange(result.dshVersion, range)) result.missing.push('compatibility: engines.dsh "' + range + '" does not cover DSH ' + result.dshVersion)
    } catch (error) {
      result.missing.push('compatibility: ' + (error instanceof Error ? error.message : String(error)))
    }
  } else {
    result.missing.push('compatibility: the package declares no dsh.compatibility.dshReleases and no engines.dsh')
  }
  for (const entry of ['lib/index.js', 'lib/client.js']) {
    if (!existsSync(join(dir, entry))) result.missing.push(`build: ${entry} is missing (run the package build)`)
  }
  return result
}
