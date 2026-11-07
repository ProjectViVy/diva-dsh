#!/usr/bin/env node
// Register dsh-vivy-tone in the profile: the Superagent prompts in Chinese, on
// one switch.
//
// Build-free and dependency-free, so there is nothing to compile here: this
// links the package into the profile and adds it to the profile's bundles. From
// then on, mounting it writes the wave it carries into Superagent's prompt store
// once at startup, idempotently, and removing the overrides is the off switch.
//
//   npm run setup:vivy-tone             # register (the panel must be stopped)
//   npm run setup:vivy-tone -- --check  # report the current state, change nothing
//   npm run setup:vivy-tone -- --remove # unregister; the prompt text stays until
//                                       # the package's own CLI takes it back
//
// The translations themselves live in `plugins/dsh-vivy-tone/src/zh.mjs`. To
// write them without waiting for a restart, or to take them back out while the
// plugin is still mounted:
//
//   node plugins/dsh-vivy-tone/src/cli.mjs --install
//   node plugins/dsh-vivy-tone/src/cli.mjs --remove
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { PROFILE, ROOT, profileDir, state } from './lib/vivy.mjs'
import { sourceRuntimeInvocation } from './lib/source.mjs'
import { inspectComponents } from './lib/component-setup.mjs'

const NAME = 'dsh-vivy-tone'
const PLUGIN = join(ROOT, 'plugins', NAME)
const PACKAGES = [[NAME, PLUGIN]]

function step(message) {
  console.log(`\n== ${message}`)
}

function parseArgs(argv) {
  const options = { check: false, remove: false }
  for (const arg of argv) {
    if (arg === '--check') options.check = true
    else if (arg === '--remove') options.remove = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.check && options.remove) throw new Error('--check and --remove cannot be combined')
  return options
}

/** Run the deployment's own DSH CLI against this profile. */
function dsh(args) {
  const invocation = sourceRuntimeInvocation(ROOT, args)
  const result = spawnSync(process.execPath, invocation.args, {
    cwd: invocation.cwd,
    env: { ...invocation.env, CI: 'true' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`dsh ${args.join(' ')} exited with ${result.status ?? result.signal}`)
}

const options = parseArgs(process.argv.slice(2))
if (!existsSync(join(PLUGIN, 'src', 'index.mjs'))) throw new Error(`Missing package: ${PLUGIN}`)

if (options.check) {
  step(`Inspect ${PROFILE}`)
  const { missing } = inspectComponents(profileDir(), PACKAGES)
  console.log(missing.length
    ? `${NAME} is not registered yet; run "npm run stop && npm run setup:vivy-tone && npm run start".`
    : `${NAME} is registered; it installs its wave at startup.`)
  process.exit(missing.length ? 1 : 0)
}

if ((await state()) !== undefined) {
  throw new Error('Stop the local panel with "npm run stop" before changing profile registration.')
}

if (options.remove) {
  step(`Unregister ${NAME}`)
  dsh(['plugin', '--profile', PROFILE, 'remove', NAME])
  console.log(`\n${NAME} is unregistered. Superagent keeps the prompt text it was given;`)
  console.log('take that back separately, while the panel is up:')
  console.log('  node plugins/dsh-vivy-tone/src/cli.mjs --remove')
  process.exit(0)
}

step(`Register ${NAME}`)
dsh(['plugin', '--profile', PROFILE, 'add', `link:${PLUGIN}`])

step('Confirm')
const { missing } = inspectComponents(profileDir(), PACKAGES)
if (missing.length) throw new Error(`Registration is incomplete: ${missing.map(([name]) => name).join(', ')}`)
console.log(`${NAME} is registered. Start the panel with "npm run start": the wave it carries is written once at startup,`)
console.log('and Superagent\'s Prompts panel shows the result at Settings -> Prompts -> Full prompt.')
