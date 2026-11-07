#!/usr/bin/env node
// Install only project-local dependencies and register the pinned SurfCore source.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, PROFILE, home, profileDir, state } from './lib/vivy.mjs'
import { initializePinnedSubmodule, localEnvironment, prepareLocalDirectories, sourceRuntimeInvocation, validateStateDirectory } from './lib/source.mjs'
import { ensureSurfcoreAdapter } from './lib/surfcore.mjs'
import { relocateProfileDependencies } from './lib/component-setup.mjs'

function run(command, args, cwd, env = localEnvironment(ROOT)) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, {
    cwd, env: { ...env, CI: 'true' }, stdio: 'inherit',
    shell: process.platform === 'win32' && command.endsWith('.cmd'),
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`)
}

prepareLocalDirectories(ROOT)
if ((await state()) !== undefined) throw new Error('Stop the local panel with "npm run stop" before registering SurfCore.')
if (!existsSync(join(profileDir(), 'package.json'))) throw new Error('Run "npm run setup" before setting up SurfCore.')
console.log(`Pinned SurfCore: ${initializePinnedSubmodule(ROOT, 'plugins/surfcore')}`)
const source = join(ROOT, 'plugins', 'surfcore')
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
run(npm, ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], source)
// Run only the upstream postinstall we inspected; it changes package files inside node_modules.
run(process.execPath, ['scripts/patch-snowluma-sdk.mjs'], source)

const { bundle, qqMode } = ensureSurfcoreAdapter(ROOT)
if (relocateProfileDependencies(ROOT, PROFILE)) console.log('Relocated project-owned profile dependencies; originals were backed up.')
const settings = join(home(), 'surfcore')
if (!validateStateDirectory(ROOT, settings)) throw new Error('The SurfCore state directory resolves outside the project.')
mkdirSync(settings, { recursive: true })
const config = join(settings, 'config.json')
if (!validateStateDirectory(ROOT, config)) throw new Error('The SurfCore settings file resolves outside the project.')
if (!existsSync(config)) {
  writeFileSync(config, `${JSON.stringify({
    platforms: { start: { qq: false, bili: false } },
    updates: { enabled: false, checkOnStart: false },
    extensions: { enabled: false },
    memoryCard: { notifyOwner: false },
  }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  console.log('Created project-local SurfCore settings with platform startup disabled.')
} else console.log('Preserved existing project-local SurfCore settings.')

const manifest = JSON.parse(readFileSync(join(profileDir(), 'package.json'), 'utf8'))
for (const [name, target] of [['surfcore', bundle], ['surfcore-local-qq-mode', qqMode]]) {
  const installed = join(profileDir(), 'node_modules', name)
  if (manifest.dependencies?.[name] && (!existsSync(installed) || realpathSync(installed) !== realpathSync(target))) {
    throw new Error(`Existing profile dependency ${name} points elsewhere; it was left unchanged.`)
  }
}
const linked = ['surfcore', 'surfcore-local-qq-mode'].every(name => existsSync(join(profileDir(), 'node_modules', name)))
if (linked && manifest.dsh?.profile?.bundles?.includes('surfcore')) {
  console.log('SurfCore is already linked to the local adapter.')
} else {
  const invocation = sourceRuntimeInvocation(ROOT, ['plugin', '--profile', PROFILE, 'add', `link:${bundle}`, `link:${qqMode}`])
  run(process.execPath, invocation.args, invocation.cwd, invocation.env)
}
console.log('SurfCore is registered; run "npm start" to use the local panel.')
