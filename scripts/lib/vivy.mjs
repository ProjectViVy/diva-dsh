// Shared runtime facts for the vivy-dsh launcher: paths, the profile and panel
// address, the management API probe, and process bookkeeping.
//
// The upstream control script (superagent/scripts/dsh-superagent) does this in
// Python and starts the service in tmux. This module keeps the same contract —
// same management API, same control files, same exit codes — without tmux.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync } from 'node:fs'

export const ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const ARTIFACTS = join(ROOT, '.artifacts')
export const CONTROL = join(ARTIFACTS, 'control')
export const BUNDLE_DIR = join(ROOT, 'superagent')
export const DSH_JS = join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
export const STATE_SHARE = 20

export const PROFILE = process.env.VIVY_DSH_PROFILE || process.env.DSH_SUPERAGENT_PROFILE || 'superagent-template'
export const SERVICE_URL = process.env.VIVY_DSH_URL || process.env.DSH_SUPERAGENT_URL || 'http://127.0.0.1:3082'

// The exit codes of `status`, `start` and `restart`, identical to the upstream script.
export const OK = 0
export const BROKEN = 1
export const PART_ERROR = 2
export const SETUP_WAITS = 3

export function home() {
  return process.env.DSH_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
}

export function profileDir() {
  return join(home(), 'profiles', PROFILE)
}

export function controlDir() {
  const dir = join(CONTROL, 'profiles', PROFILE)
  mkdirSync(dir, { recursive: true })
  return dir
}

export function manuallyStopped() {
  return existsSync(join(controlDir(), 'manually-stopped'))
}

export function markManuallyStopped(stopped) {
  const marker = join(controlDir(), 'manually-stopped')
  if (stopped) writeFileSync(marker, new Date().toISOString() + '\n')
  else if (existsSync(marker)) unlinkSync(marker)
}

export function recordedPid() {
  try {
    const value = Number.parseInt(readFileSync(join(controlDir(), 'service.pid'), 'utf8').trim(), 10)
    return Number.isInteger(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function recordPid(pid) {
  if (pid === undefined) {
    const file = join(controlDir(), 'service.pid')
    if (existsSync(file)) unlinkSync(file)
    return
  }
  writeFileSync(join(controlDir(), 'service.pid'), `${pid}\n`)
}

export function alive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

/** Command line of a live process, or undefined when it cannot be read. */
export function commandLine(pid) {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
        `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], { encoding: 'utf8' }).trim()
      return out || undefined
    }
    const out = execFileSync('ps', ['-ww', '-o', 'pid=,args=', '-p', String(pid)], { encoding: 'utf8' }).trim()
    return out.replace(/^\s*\d+\s+/, '') || undefined
  } catch {
    return undefined
  }
}

/** Whether `pid` is still the DSH service for `PROFILE`, not a recycled pid. */
export function serving(pid) {
  if (!alive(pid)) return false
  const line = commandLine(pid)
  if (line === undefined) return true // cannot inspect it; trust the pid file
  return line.includes(DSH_JS) || (line.includes('dsh') && line.includes(`--profile ${PROFILE}`))
}

/** Pids of running services: the recorded one, plus anything our marker knows about. */
export function processes() {
  const pid = recordedPid()
  const live = pid !== undefined && serving(pid)
  if (pid !== undefined && !live) recordPid(undefined)
  return live ? [pid] : []
}

/** The `/orchestrator/api/state` answer, or undefined when nothing answers. */
export async function state(url = SERVICE_URL) {
  try {
    const response = await fetch(url.replace(/\/$/, '') + '/orchestrator/api/state', {
      headers: { 'x-orchestrator-request': '1' },
      signal: AbortSignal.timeout(2000),
    })
    const value = await response.json()
    const health = value.health ?? {}
    const entries = Object.fromEntries(Object.entries(health).map(([name, entry]) =>
      [name, entry && typeof entry === 'object' ? entry : {}]))
    return {
      health: Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, entry.state])),
      errors: Object.fromEntries(Object.entries(entries)
        .filter(([, entry]) => entry.state === 'error')
        .map(([name, entry]) => [name, String(entry.detail ?? '')])),
      setup: value.setup?.problem,
      feishu: value.setup?.feishuProblem,
    }
  } catch {
    return undefined
  }
}

export function runtimeUp(current) {
  const runtime = current?.health?.runtime
  return runtime === 'ready' || runtime === 'paused'
}

export function partErrors(current) {
  return Object.fromEntries(Object.entries(current?.errors ?? {})
    .filter(([name]) => name !== 'runtime').sort(([left], [right]) => left.localeCompare(right)))
}

export function outcome(pids, current) {
  if (pids.length !== 1 || !runtimeUp(current)) return BROKEN
  if (current.setup) return SETUP_WAITS
  return Object.keys(partErrors(current)).length > 0 ? PART_ERROR : OK
}

export function report(pids, current) {
  return {
    pids,
    cwd: ROOT,
    url: SERVICE_URL,
    profile: PROFILE,
    manually_stopped: manuallyStopped(),
    health: current ? current.health : null,
    errors: current ? current.errors : null,
    setup: current ? current.setup : null,
    feishu: current ? current.feishu : null,
  }
}

/** Keep only the newest `STATE_SHARE` launcher logs. */
export function pruneLogs() {
  if (!existsSync(ARTIFACTS)) return
  const prefix = `vivy-dsh-${PROFILE}-`
  const logs = readdirSync(ARTIFACTS)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.log'))
    .map((name) => join(ARTIFACTS, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
  for (const path of logs.slice(0, Math.max(0, logs.length - STATE_SHARE))) unlinkSync(path)
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The state directory this profile is configured with. The runtime takes an OS lock
 * beside it (`<stateDir>.lock`), and a Windows stop kills the process before it can
 * release that lock — so the launcher has to clear it, never while a service is live.
 */
export function stateDir() {
  try {
    const patch = readFileSync(join(profileDir(), 'cordis.patch.yml'), 'utf8')
    const match = /^\s*stateDir\s*:\s*(.+?)\s*$/m.exec(patch)
    if (match) return match[1].replace(/^['"]|['"]$/g, '')
  } catch {
    /* fall through to the default */
  }
  return join(home(), 'state', PROFILE)
}

export function lockPath() {
  return stateDir() + '.lock'
}

/**
 * Remove the runtime's lock directory when nothing holds it any more.
 * Returns true when no lock is left behind.
 */
export async function clearStaleLock({ maxAgeMs = 30000, live = true } = {}) {
  const lock = lockPath()
  let stats
  try {
    stats = statSync(lock)
  } catch {
    return true
  }
  if (live || (await state()) !== undefined) return false
  const age = Date.now() - stats.mtimeMs
  if (age < maxAgeMs) return false
  try {
    rmSync(lock, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

export function fail(message) {
  console.error(message)
  process.exit(BROKEN)
}
