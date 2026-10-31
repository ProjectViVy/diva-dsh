#!/usr/bin/env node
// One-time setup for vivy-dsh: check the toolchain, build the bundle, create the
// DSH profile that loads it, and write the profile's machine configuration.
//
// Safe to re-run: every step reports what it found and skips work already done.

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import semver from 'semver'

import {
  BUNDLE_DIR, DSH_JS, PROFILE, ROOT, SERVICE_URL, home, profileDir,
} from './lib/vivy.mjs'

const PORT = Number(process.env.VIVY_DSH_PORT || new URL(SERVICE_URL).port || 3082)
const STATE_DIR = process.env.VIVY_DSH_STATE_DIR || join(home(), 'state', PROFILE)

function step(message) {
  console.log('\n== ' + message)
}

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function run(command, args, options = {}) {
  console.log(`$ ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { stdio: 'inherit', cwd: ROOT, ...options })
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`)
}

/** pnpm ships as a .cmd shim on Windows, which only runs through a shell. */
function runPnpm(args, cwd) {
  console.log(`$ pnpm ${args.join(' ')}`)
  const result = spawnSync(['pnpm', ...args].join(' '), { stdio: 'inherit', shell: true, cwd })
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} exited with ${result.status}`)
}

step('Check the toolchain')
const nodeVersion = process.versions.node
if (!semver.satisfies(nodeVersion, '^22.19.0 || >=24.0.0')) {
  throw new Error(`Node.js ${nodeVersion} is outside the supported range (^22.19.0 || >=24.0.0).`)
}
console.log(`node        ${nodeVersion}`)

const pnpmVersion = (() => {
  try {
    return execFileSync(process.platform === 'win32' ? 'pnpm --version' : 'pnpm', process.platform === 'win32' ? [] : ['--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).trim()
  } catch {
    return undefined
  }
})()
if (pnpmVersion === undefined) throw new Error('pnpm is not on PATH; the DSH profile installs its plugins with pnpm.')
console.log(`pnpm        ${pnpmVersion}`)

if (!existsSync(DSH_JS)) throw new Error(`dsh is not installed at ${DSH_JS}; run "npm install" in ${ROOT}.`)
const dshVersion = read(join(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')).version
console.log(`dsh         ${dshVersion} (local, not your global dsh)`)

const bundle = read(join(BUNDLE_DIR, 'package.json'))
const wanted = bundle.engines?.dsh
if (wanted && !semver.satisfies(dshVersion, wanted, { includePrerelease: true })) {
  throw new Error(`dsh ${dshVersion} does not satisfy the bundle's engines.dsh (${wanted}). ` +
    'Set the @deepseek-ai/dsh version in package.json to a release inside that range and run "npm install" again.')
}
console.log(`bundle      ${bundle.name} ${bundle.version} (needs dsh ${wanted})`)

step('Build the bundle')
if (existsSync(join(BUNDLE_DIR, 'lib', 'index.js'))) {
  console.log('superagent/lib/index.js already exists; run "npm run build:bundle" to rebuild it.')
} else {
  runPnpm(['install', '--reporter=append-only'], BUNDLE_DIR)
  runPnpm(['run', 'build'], BUNDLE_DIR)
}

step(`Create the DSH profile "${PROFILE}"`)
const manifest = join(profileDir(), 'package.json')
if (existsSync(manifest)) {
  console.log(`${manifest} already exists; keeping it as is.`)
} else {
  // Upstream creates the profile from the Web template first, because a profile
  // that starts from nothing has no app to serve the panel.
  run(process.execPath, [DSH_JS, PROFILE, '--from-default-profile', 'web', '--dump-config'], { stdio: 'ignore' })
}

step('Install the bundle into the profile')
const installed = existsSync(manifest)
  ? Object.keys(read(manifest).dependencies ?? {})
  : []
if (installed.includes(bundle.name)) {
  console.log(`${bundle.name} is already installed in the profile.`)
} else {
  run(process.execPath, [DSH_JS, 'plugin', '--profile', PROFILE, 'add', `link:${BUNDLE_DIR}`])
}

step('Write the profile machine configuration')
const patch = join(profileDir(), 'cordis.patch.yml')
const existingPatch = existsSync(patch) ? readFileSync(patch, 'utf8') : undefined
// A fresh profile ships an empty patch layer (`[]`); upstream replaces that file
// with the machine configuration, so an unconfigured layer counts as missing.
const configured = existingPatch !== undefined && /stateDir\s*:/.test(existingPatch)
if (configured) {
  console.log(`${patch} already sets stateDir; keeping it as is. Delete it to regenerate from the template.`)
} else {
  if (existingPatch !== undefined) {
    const nonEmpty = existingPatch.split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#'))
    if (nonEmpty.length > 0 && nonEmpty.join('') !== '[]') {
      writeFileSync(patch + '.bak', existingPatch)
      console.log(`kept a copy of the previous patch layer at ${patch}.bak`)
    }
  }
  mkdirSync(STATE_DIR, { recursive: true })
  writeFileSync(patch, [
    '# Written by vivy-dsh setup. Machine configuration for this profile; see docs/006-deployment.md',
    '# in the upstream bundle for the meaning of each key.',
    '- id: webserver',
    '  config:',
    '    host: 127.0.0.1',
    `    port: ${PORT}`,
    '- id: dsh-superagent',
    '  config:',
    `    stateDir: ${STATE_DIR.replaceAll('\\', '/')}`,
    '# Feishu is optional: uncomment to enable its Source, then set the bot lark-cli on the Feishu Source.',
    '# - id: dsh-superagent-feishu',
    '#   disabled: false',
    '',
  ].join('\n'))
  console.log(`wrote ${patch}`)
}

step('Done')
console.log(`Panel:  ${SERVICE_URL}  (Superagent entry in the sidebar)`)
console.log(`Logs:   ${join(ROOT, '.artifacts')}`)
console.log(`State:  ${STATE_DIR}`)
console.log('\nNext: "npm start". The first start reports what the panel still needs:')
console.log('  - a Source pointing at a GitHub repository,')
console.log('  - a Policy listing the people who may ask the agent for work,')
console.log('  - an Executor checkout and prepare command.')
console.log('The agent account itself is created by the operator and signed in through a gh wrapper;')
console.log('see the handbook (README.md) before your first real request.')
