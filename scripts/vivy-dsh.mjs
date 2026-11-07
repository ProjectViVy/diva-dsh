#!/usr/bin/env node
// Start, stop, restart and inspect the vivy-dsh service without tmux.
//
// Same contract as superagent/scripts/dsh-superagent: one DSH profile, the
// management API at /orchestrator/api/state, and exit codes 0/1/2/3 meaning
// healthy, broken, a part failed, and waiting for setup.
//
//   node scripts/vivy-dsh.mjs start|stop|restart|status|proxy

import { spawn, execFileSync } from 'node:child_process'
import { openSync, closeSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import {
  ARTIFACTS, BROKEN, DSH_JS, OK, PROFILE, ROOT, STATE_SHARE, SERVICE_URL,
  alive, clearStaleLock, fail, lockPath, manuallyStopped, markManuallyStopped, outcome,
  partErrors, processes, pruneLogs, recordPid, report, runtimeUp, serving, sleep, state,
} from './lib/vivy.mjs'
import { ensureRootWorkspace, panelLinkFromLogs, prepareLocalDirectories, sourceRuntimeInvocation, verifyPinnedSubmodule } from './lib/source.mjs'
import { ensureSurfcoreAdapter } from './lib/surfcore.mjs'
import { componentMigrationReady } from './lib/component-setup.mjs'
import {
  clearProxyConfig, describeProxy, proxyConfigFile, proxyReport, readLaunchedProxy,
  recordLaunchedProxy, resolveProxy, safeResolveProxy, serviceEnvironment, writeProxyConfig,
} from './lib/proxy.mjs'

const argv = process.argv.slice(2)
const action = argv[0]

function flag(name, fallback) {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}

const timeout = Number(flag('--timeout', 60)) * 1000
const stopTimeout = Number(flag('--stop-timeout', 300)) * 1000
const respectStop = argv.includes('--respect-stop')

/**
 * The one-shot proxy choice on `start`/`restart`, which outranks the saved configuration.
 * @returns `{ url }`, `{ off: true }`, or nothing to fall back to the configuration.
 */
function proxyFlag() {
  if (argv.includes('--no-proxy')) return { off: true }
  if (!argv.includes('--proxy')) return {}
  const value = flag('--proxy', undefined)
  if (value === undefined || value.startsWith('--')) {
    fail('--proxy 需要地址，例如 --proxy http://127.0.0.1:7897')
  }
  return { url: value }
}

if (!['start', 'stop', 'restart', 'status', 'proxy'].includes(action)) {
  fail('usage: node scripts/vivy-dsh.mjs start|stop|restart|status|proxy')
}
// `proxy` manages configuration rather than launching, so it stays usable when the
// checkout cannot boot — configuring a proxy is often what makes setup succeed.
if (action !== 'proxy' && !existsSync(DSH_JS)) {
  fail(`DSH source is missing at ${DSH_JS}; run "npm run setup" in ${ROOT} first.`)
}

/** The `proxy` block shared by `status` and `proxy status`. */
function currentProxyReport(running) {
  return proxyReport({
    resolved: safeResolveProxy({ root: ROOT, env: process.env }),
    launched: readLaunchedProxy(ROOT, PROFILE),
    running,
  })
}

function print(current, pids) {
  console.log(JSON.stringify({ ...report(pids, current), proxy: currentProxyReport(pids.length > 0) }, null, 2))
}

function hint(current) {
  if (!current) return
  if (current.setup) {
    console.log('dsh-superagent is waiting for setup: ' + String(current.setup.detail ?? ''))
    console.log('Open the panel URL, then the Superagent entry in the sidebar.')
  }
  if (current.feishu) {
    console.log('dsh-superagent runs without Feishu: ' + String(current.feishu.detail ?? ''))
  }
  for (const [name, detail] of Object.entries(partErrors(current))) {
    console.log(`${name} reports an error, which a restart does not fix: ${detail}`)
  }
}

/**
 * `proxy <url>|off|status`: manage the saved outbound proxy without launching anything.
 * A changed configuration applies at the next start or restart.
 * @param args - the arguments after `proxy`.
 * @returns the exit code.
 */
function proxyCommand(args) {
  const target = args.find((value) => !value.startsWith('--'))
  const running = processes().length > 0
  if (target === undefined || target === 'status') {
    console.log(JSON.stringify(currentProxyReport(running), null, 2))
    return OK
  }
  if (target === 'off') {
    clearProxyConfig(ROOT)
    console.log('代理已关闭：删除了 ' + proxyConfigFile(ROOT) + '。')
  } else {
    const written = writeProxyConfig(ROOT, { proxy: target })
    console.log('代理已保存到 ' + proxyConfigFile(ROOT) + '：' + describeProxy({ kind: 'proxy', url: written.proxy }))
  }
  if (running) console.log('服务正在运行；运行 npm run restart 后生效。')
  return OK
}

async function status() {
  const pids = processes()
  const current = pids.length > 0 ? await state() : undefined
  print(current, pids)
  return outcome(pids, current)
}

/** End one service process: SIGINT where the OS delivers it, taskkill on Windows. */
function interrupt(pid) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T'], { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
    return
  }
  try {
    process.kill(pid, 'SIGINT')
  } catch {
    /* already gone */
  }
}

function forceKill(pid) {
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    } catch {
      /* already gone */
    }
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    /* already gone */
  }
}

async function stop({ intentional }) {
  const pids = processes()
  if (intentional) markManuallyStopped(true)
  for (const pid of pids) interrupt(pid)
  const deadline = Date.now() + stopTimeout
  while (pids.some((pid) => serving(pid))) {
    if (Date.now() >= deadline) {
      for (const pid of pids.filter((candidate) => serving(candidate))) forceKill(pid)
      await sleep(1500)
      if (pids.some((pid) => serving(pid))) {
        throw new Error('Stop timed out; a forced kill was sent but the process is still alive. Check status.')
      }
      break
    }
    await sleep(500)
  }
  recordPid(undefined)
  recordLaunchedProxy(ROOT, PROFILE, undefined)
  // A Windows stop cannot let the runtime release its lock, so clear it once nothing runs.
  if (process.platform === 'win32') await clearStaleLock({ maxAgeMs: 0, live: false })
  console.log(intentional
    ? 'vivy-dsh stopped. Automatic recovery is paused until start/restart.'
    : 'vivy-dsh stopped.')
}

async function start() {
  const pids = processes()
  if (pids.length > 1) throw new Error('Multiple vivy-dsh processes found; refusing to start another.')
  if (pids.length === 1) {
    recordPid(pids[0])
    console.log(`vivy-dsh already running (PID ${pids[0]}); no duplicate started.`)
    // A running service keeps the proxy it was launched with, so an ignored flag would
    // read as applied. Say so instead.
    const requested = proxyFlag()
    if (requested.url !== undefined || requested.off === true) {
      console.log('The proxy flag was not applied: the running service keeps its launch-time proxy. Run npm run restart to apply it.')
    }
  } else {
    if ((await state()) !== undefined) {
      throw new Error(`An existing service answers at ${SERVICE_URL}; refusing duplicate startup.`)
    }
    if (!componentMigrationReady(ROOT)) {
      throw new Error('Voice and memory migration is incomplete; stop the service and run "npm run setup".')
    }
    ensureSurfcoreAdapter(ROOT, join(ARTIFACTS, 'surfcore-adapter'), { splitComponents: true })
    // Wait out a lock left by a previous instance instead of failing on it.
    let waited = 0
    while (!(await clearStaleLock({ live: false })) && waited < 35000) {
      if (waited === 0) console.log(`Waiting for the previous instance to release ${lockPath()}...`)
      await sleep(1000)
      waited += 1000
    }
    mkdirSync(ARTIFACTS, { recursive: true })
    pruneLogs()
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
    const log = join(ARTIFACTS, `vivy-dsh-${PROFILE}-${stamp}-${process.pid}.log`)
    const fd = openSync(log, 'a')
    const invocation = sourceRuntimeInvocation(ROOT, ['--profile', PROFILE, '--no-open'])
    // Resolve before spawning: a broken configuration must fail here instead of leaving a
    // service that silently connects directly while the operator believes it is proxied.
    const proxy = resolveProxy({ root: ROOT, flag: proxyFlag(), env: invocation.env })
    const child = spawn(process.execPath, invocation.args, {
      cwd: invocation.cwd,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', fd, fd],
      env: serviceEnvironment(ROOT, invocation.env, proxy),
    })
    child.unref()
    closeSync(fd)
    if (child.pid === undefined) throw new Error('Failed to start the dsh process.')
    recordPid(child.pid)
    recordLaunchedProxy(ROOT, PROFILE, proxy)
    console.log('Log: ' + log)
    console.log('Proxy: ' + describeProxy(proxy) + ' (' + proxy.source + ')')
  }
  markManuallyStopped(false)

  const deadline = Date.now() + timeout
  let pid = processes()[0]
  while (Date.now() < deadline) {
    const current = await state()
    if (processes().length > 0 && runtimeUp(current)) {
      const pids = processes()
      print(current, pids)
      hint(current)
      const panel = panelLinkFromLogs(ARTIFACTS, PROFILE, SERVICE_URL)
      if (!panel) throw new Error('The panel login link was not found in the latest log; the project workspace was not registered.')
      await ensureRootWorkspace(panel, ROOT)
      console.log(`Workspace: ${ROOT}`)
      console.log(`Panel: ${panel}`)
      return outcome(pids, current)
    }
    // A process that already exited will never become healthy; report that instead of timing out.
    if (pid !== undefined && !alive(pid)) {
      await status()
      throw new Error('The dsh process exited during startup; read the log above for the reason.')
    }
    await sleep(1000)
  }
  await status()
  throw new Error(`Startup health check timed out after ${timeout / 1000}s; inspect the log. Any running process was left intact.`)
}

async function main() {
  prepareLocalDirectories(ROOT)
  if (action === 'proxy') return proxyCommand(argv.slice(1))
  if (action === 'start' || action === 'restart') {
    verifyPinnedSubmodule(ROOT, 'deepseek-harness')
    verifyPinnedSubmodule(ROOT, 'superagent')
    verifyPinnedSubmodule(ROOT, 'plugins/surfcore')
  }
  if (respectStop && (action === 'start' || action === 'restart') && manuallyStopped()) {
    console.log('Intentional stop is active; automatic recovery skipped.')
    return OK
  }
  if (action === 'status') return status()
  if (action === 'stop' || action === 'restart') {
    // Only a stop keeps automatic recovery off; a restart whose stop timed out leaves it on.
    await stop({ intentional: action === 'stop' })
  }
  if (action === 'start' || action === 'restart') return start()
  return OK
}

try {
  process.exitCode = await main()
} catch (error) {
  fail(String(error instanceof Error ? error.message : error))
}

export { BROKEN, STATE_SHARE }
