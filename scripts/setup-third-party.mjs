#!/usr/bin/env node
// Register the third-party community plugins under `third-party/` into the profile.
//
// Each of them is a git submodule pinned to an upstream tag that declares
// compatibility with the DSH version this deployment runs (see
// `third-party/pins.json`). `lib/` is gitignored upstream, so a source-level
// checkout has to be built once before it can be mounted.
//
//   npm run setup:third-party              # build if needed, then register (panel stopped)
//   npm run setup:third-party -- --check   # report pin/build/registration state, change nothing
//   npm run setup:third-party -- --build   # force a rebuild before registering
//   npm run setup:third-party -- --remove  # unregister every pinned plugin
//
// Adding a plugin means: `git submodule add` it to the pinned tag, add one entry
// to `third-party/pins.json`, then run this. No other edit is needed.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { ARTIFACTS, PROFILE, ROOT, profileDir, state } from './lib/vivy.mjs'
import { localEnvironment, prepareLocalDirectories, sourceRuntimeInvocation } from './lib/source.mjs'
import { inspectComponents } from './lib/component-setup.mjs'
import { inspectThirdPartyPlugin, readPins } from './lib/third-party.mjs'

const pnpm = join(ARTIFACTS, 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')

function step(message) {
  console.log(`\n== ${message}`)
}

function parseArgs(argv) {
  const options = { check: false, remove: false, build: false }
  for (const arg of argv) {
    if (arg === '--check') options.check = true
    else if (arg === '--remove') options.remove = true
    else if (arg === '--build') options.build = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  if (options.check && options.remove) throw new Error('--check and --remove cannot be combined')
  return options
}

function runIn(directory, args, env) {
  console.log(`$ pnpm ${args.join(' ')}`)
  const result = spawnSync(process.execPath, [pnpm, ...args], { cwd: directory, env, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} exited with ${result.status ?? result.signal}`)
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
const pins = readPins(ROOT)
const names = Object.keys(pins.plugins)
if (!names.length) throw new Error('third-party/pins.json pins no plugins')

const inspectAll = () => names.map(name => inspectThirdPartyPlugin(ROOT, name, pins))
const registrationMissing = () => inspectComponents(profileDir(), names.map(name => [name, join(ROOT, 'third-party', name)])).missing

function describe(entry) {
  console.log(`\n${entry.name}`)
  console.log(`  pin:       ${entry.pinnedTag}`)
  console.log(`  checkout:  ${entry.version ?? '(missing)'}`)
  console.log(`  DSH:       ${entry.dshVersion}`)
  console.log(`  declares:  ${entry.releases.length ? entry.releases.join(', ') : '(nothing)'}`)
  if (entry.missing.length) for (const item of entry.missing) console.log(`  MISSING    ${item}`)
}

if (options.check) {
  const entries = inspectAll()
  step(`Inspect third-party plugins for DSH ${entries[0]?.dshVersion ?? '?'}`)
  for (const entry of entries) describe(entry)
  const pending = registrationMissing()
  for (const [name] of pending) console.log(`\n${name} is not registered in ${PROFILE}.`)
  const failed = entries.some(entry => entry.missing.length) || pending.length > 0
  console.log(failed
    ? `\nNot ready. Fix the entries above, then run "npm run stop && npm run setup:third-party && npm start".`
    : `\nAll third-party plugins are pinned, built and registered.`)
  process.exit(failed ? 1 : 0)
}

if ((await state()) !== undefined) {
  throw new Error('Stop the local panel with "npm run stop" before changing profile registration.')
}

if (options.remove) {
  for (const name of names) {
    step(`Unregister ${name}`)
    dsh(['plugin', '--profile', PROFILE, 'remove', name])
  }
  console.log(`\nUnregistered: ${names.join(', ')}. The sources stay under third-party/.`)
  process.exit(0)
}

const entries = inspectAll()
for (const entry of entries) {
  const fatal = entry.missing.filter(item => !item.startsWith('build:'))
  if (fatal.length) throw new Error(`${entry.name} is not installable: ${fatal.join('; ')}`)
}

const needsBuild = entries.filter(entry => options.build || entry.missing.some(item => item.startsWith('build:')))
if (needsBuild.length) prepareLocalDirectories(ROOT)
for (const entry of needsBuild) {
  if (!existsSync(pnpm)) throw new Error('The project-local package manager is missing; run "npm run setup" first.')
  step(`Build ${entry.name} at ${entry.pinnedTag}`)
  const env = { ...localEnvironment(ROOT), CI: 'true' }
  runIn(entry.dir, ['install', '--frozen-lockfile'], env)
  runIn(entry.dir, ['run', 'build'], env)
  const after = inspectThirdPartyPlugin(ROOT, entry.name, pins)
  if (after.missing.some(item => item.startsWith('build:'))) throw new Error(`${entry.name} produced no build output: ${after.missing.join('; ')}`)
}

for (const name of names) {
  step(`Register ${name}`)
  dsh(['plugin', '--profile', PROFILE, 'add', `link:${join(ROOT, 'third-party', name)}`])
}

step('Confirm')
const pending = registrationMissing()
if (pending.length) throw new Error(`Registration is incomplete: ${pending.map(([name]) => name).join(', ')}`)
console.log(`${names.join(', ')} registered in ${PROFILE}. Start the panel with "npm run start".`)
