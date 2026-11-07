#!/usr/bin/env node
// Install, build and verify the vendored dsh-continual-harness source checkout.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTIFACTS, ROOT, state } from './lib/vivy.mjs'
import { localEnvironment, prepareLocalDirectories } from './lib/source.mjs'

const PLUGIN = join(ROOT, 'plugins', 'dsh-continual-harness')
const MARKER = join(ROOT, '.artifacts', 'continual-harness-setup.json')
const PNPM_JS = join(ARTIFACTS, 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
const args = process.argv.slice(2)
const force = args.includes('--force')
const registryIndex = args.indexOf('--registry')
const registry = registryIndex >= 0 ? args[registryIndex + 1] : process.env.npm_config_registry || ''

function step(message) {
  console.log(`\n== ${message}`)
}

function pnpm(pnpmArgs) {
  const env = { ...localEnvironment(ROOT), CI: 'true', ...(registry ? { npm_config_registry: registry } : {}) }
  const result = spawnSync(process.execPath, [PNPM_JS, ...pnpmArgs], {
    cwd: PLUGIN,
    stdio: 'inherit',
    env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${pnpmArgs[0]} exited with ${result.status ?? result.signal}`)
}

function verify() {
  const result = spawnSync(process.execPath, ['-e', "import('./lib/types/index.js').then(() => console.log('ok'))"], {
    cwd: PLUGIN,
    encoding: 'utf8',
    env: localEnvironment(ROOT),
    timeout: 120_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Plugin import failed: ${(result.stderr || result.stdout || '').trim()}`)
}

if (!existsSync(join(PLUGIN, 'src', 'index.ts'))) throw new Error(`Missing source checkout: ${PLUGIN}`)
if ((await state()) !== undefined) throw new Error('Stop the local panel with "npm run stop" before building components.')
prepareLocalDirectories(ROOT)
const built = existsSync(join(PLUGIN, 'lib', 'types', 'index.js'))
if (force || !built) {
  if (force || !existsSync(join(PLUGIN, 'node_modules'))) {
    step('Install dsh-continual-harness source dependencies')
    pnpm(['install', '--frozen-lockfile', '--reporter=append-only'])
  }
  step('Build dsh-continual-harness')
  pnpm(['run', 'build'])
} else {
  console.log('dsh-continual-harness is already built; use --force to rebuild.')
}
step('Verify plugin import')
verify()
mkdirSync(dirname(MARKER), { recursive: true })
writeFileSync(MARKER, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  pluginDir: PLUGIN,
  built: true,
}, null, 2)}\n`, { mode: 0o600 })
console.log('dsh-continual-harness is ready.')
