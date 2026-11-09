#!/usr/bin/env node
// Prepare the two source checkouts and an isolated, project-local DSH profile.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  ARTIFACTS, BUNDLE_DIR, DSH_DIR, DSH_JS, PROFILE, ROOT, SERVICE_URL, home, profileDir, state,
} from './lib/vivy.mjs'
import { ensureMachineConfig, initializePinnedSubmodule, localEnvironment, prepareLocalDirectories, superagentPatches, withTemporaryPatch } from './lib/source.mjs'
import { relocateProfileDependencies } from './lib/component-setup.mjs'

const PNPM_VERSION = '11.28.5'
const PNPM_JS = join(ARTIFACTS, 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

function step(message) {
  console.log(`\n== ${message}`)
}

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: ROOT,
    env: { ...localEnvironment(ROOT), CI: 'true' },
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

function pnpm(args, cwd) {
  run(process.execPath, [PNPM_JS, ...args], { cwd })
}

function dsh(args, options = {}) {
  run(process.execPath, ['--import', 'tsx/esm', DSH_JS, ...args], { cwd: DSH_DIR, ...options })
}

step('Check the toolchain')
const [major, minor] = process.versions.node.split('.').map(Number)
if (!(major >= 24 || (major === 22 && minor >= 19))) {
  throw new Error(`Node.js ${process.versions.node} is unsupported; use Node.js 22.19+ or 24+.`)
}
console.log(`node        ${process.versions.node}`)
prepareLocalDirectories(ROOT)
if ((await state()) !== undefined) throw new Error('The local panel is running. Run "npm run stop" before setup.')

step('Install project-local runtime dependencies')
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'])

step('Prepare the pinned source submodules')
for (const name of ['deepseek-harness', 'superagent', 'plugins/surfcore']) {
  console.log(`${name}  ${initializePinnedSubmodule(ROOT, name)}`)
}
if (!existsSync(DSH_JS) || !existsSync(join(DSH_DIR, 'pnpm-lock.yaml'))) {
  throw new Error(`${DSH_DIR} is not a complete DeepSeek Harness source checkout.`)
}
const dshVersion = read(join(DSH_DIR, 'package.json')).version
if (dshVersion !== '0.2.1-rc.5') {
  throw new Error(`The source checkout is DSH ${dshVersion}; this template expects 0.2.1-rc.5. It was left unchanged.`)
}
console.log(`dsh         ${dshVersion} (source: ${DSH_DIR})`)

step('Prepare the project-local package manager')
if (!existsSync(PNPM_JS)) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  run(npm, ['install', '--prefix', join(ARTIFACTS, 'tools'), '--ignore-scripts', '--no-audit', '--no-fund', `pnpm@${PNPM_VERSION}`])
}

step('Install and build DSH from source')
pnpm(['install', '--frozen-lockfile', '--reporter=append-only'], DSH_DIR)
pnpm(['run', 'build:artifacts'], DSH_DIR)

step('Install and build Superagent from source')
pnpm(['install', '--frozen-lockfile', '--reporter=append-only'], BUNDLE_DIR)
withTemporaryPatch(BUNDLE_DIR, superagentPatches(ROOT), () => pnpm(['run', 'build'], BUNDLE_DIR))

step(`Prepare the DSH profile "${PROFILE}"`)
const manifest = join(profileDir(), 'package.json')
if (!existsSync(manifest)) {
  dsh([PROFILE, '--from-default-profile', 'web', '--dump-config'], { stdio: 'ignore' })
} else {
  console.log(`Preserving ${manifest}`)
}
const configured = ensureMachineConfig(ROOT, PROFILE, 3082)
console.log(configured ? `Wrote ${join(profileDir(), 'cordis.patch.yml')}` : 'Preserved the existing profile configuration.')
if (relocateProfileDependencies(ROOT, PROFILE)) console.log('Relocated project-owned profile dependencies; originals were backed up.')
const profilePlugin = join(profileDir(), 'node_modules', 'dsh-superagent')
let linkedToSource = false
try {
  linkedToSource = realpathSync(profilePlugin) === realpathSync(BUNDLE_DIR)
} catch {
  // The profile has not linked the bundle yet.
}
if (!linkedToSource) dsh(['plugin', '--profile', PROFILE, 'add', `link:${BUNDLE_DIR}`])
else console.log(`Superagent is already linked to ${BUNDLE_DIR}`)

step('Install and register SurfCore from its pinned source')
run(process.execPath, [join(ROOT, 'scripts', 'setup-surfcore.mjs')])

step('Install and verify the dsh-mempalace native dependencies')
run(process.execPath, [join(ROOT, 'scripts', 'setup-mempalace.mjs')])

step('Build the dsh-continual-harness source checkout')
run(process.execPath, [join(ROOT, 'scripts', 'setup-continual-harness.mjs')])

step('Build the dsh-laputa persona plugin')
run(process.execPath, [join(ROOT, 'scripts', 'setup-laputa.mjs')])

step('Install the dsh-surfcore-adapter dependencies')
run(process.execPath, [join(ROOT, 'scripts', 'setup-surfcore-adapter.mjs')])

step('Register dsh-vivy-tone (Superagent prompts in Chinese, on one switch)')
run(process.execPath, [join(ROOT, 'scripts', 'setup-vivy-tone.mjs')])

step('Migrate and register the local components, including the DIVA skins and skin manager')
run(process.execPath, [join(ROOT, 'scripts', 'setup-components.mjs')])

step('Done')
console.log(`Panel: ${SERVICE_URL}`)
console.log(`Data:  ${home()}`)
console.log('Run "npm start" to start the source runtime.')
