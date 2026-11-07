#!/usr/bin/env node
// Build the vendored dsh-laputa plugin and optionally scaffold a persona.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { ARTIFACTS, ROOT, home, profileDir, state } from './lib/vivy.mjs'
import { localEnvironment, prepareLocalDirectories, validateStateDirectory } from './lib/source.mjs'
import { initPersonaFiles, upsertLaputaProfileConfig, validatePersonaId } from './lib/laputa.mjs'

const PLUGIN = join(ROOT, 'plugins', 'dsh-laputa')
const MARKER = join(ARTIFACTS, 'laputa-setup.json')
const PNPM_JS = join(ARTIFACTS, 'tools', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
const BUILT = join(PLUGIN, 'lib', 'types', 'index.js')

function step(message) {
  console.log(`\n== ${message}`)
}

function parseArgs(argv) {
  const options = { force: false, verify: false, enable: true, init: undefined, dataRoot: undefined, registry: '' }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = name => {
      const value = argv[index + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${name} requires a value`)
      index += 1
      return value
    }
    if (arg === '--force') options.force = true
    else if (arg === '--verify') options.verify = true
    else if (arg === '--no-enable') options.enable = false
    else if (arg === '--init') options.init = take('--init')
    else if (arg.startsWith('--init=')) options.init = arg.slice('--init='.length)
    else if (arg === '--data-root') options.dataRoot = take('--data-root')
    else if (arg.startsWith('--data-root=')) options.dataRoot = arg.slice('--data-root='.length)
    else if (arg === '--registry') options.registry = take('--registry')
    else if (arg.startsWith('--registry=')) options.registry = arg.slice('--registry='.length)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function pnpm(args, registry) {
  const env = { ...localEnvironment(ROOT), CI: 'true', ...(registry ? { npm_config_registry: registry } : {}) }
  const result = spawnSync(process.execPath, [PNPM_JS, ...args], {
    cwd: PLUGIN,
    stdio: 'inherit',
    env,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`pnpm ${args[0]} exited with ${result.status ?? result.signal}`)
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

/** Write the profile patch atomically, keeping one backup of the previous text. */
function writeProfile(patchPath, before, next) {
  const directory = dirname(patchPath)
  let backup = join(directory, 'cordis.patch.pre-laputa.yml')
  if (existsSync(backup)) backup = join(directory, `cordis.patch.pre-laputa-${randomUUID()}.yml`)
  writeFileSync(backup, before, { flag: 'wx', mode: 0o600 })
  const temp = `${patchPath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temp, next, { flag: 'wx', mode: 0o600 })
    renameSync(temp, patchPath)
  } finally {
    rmSync(temp, { force: true })
  }
  return backup
}

const options = parseArgs(process.argv.slice(2))
if (!existsSync(join(PLUGIN, 'src', 'index.ts'))) throw new Error(`Missing source checkout: ${PLUGIN}`)

if (options.verify) {
  step('Verify plugin import')
  verify()
  console.log('dsh-laputa is ready.')
  process.exit(0)
}

if ((await state()) !== undefined) throw new Error('Stop the local panel with "npm run stop" before building components.')
prepareLocalDirectories(ROOT)

let persona
if (options.init !== undefined) {
  const personaId = validatePersonaId(options.init)
  const dataRoot = options.dataRoot === undefined
    ? join(home(), 'laputa')
    : resolve(ROOT, options.dataRoot)
  if (!validateStateDirectory(ROOT, dataRoot)) {
    throw new Error(`The persona data root is outside the project: ${dataRoot}`)
  }
  const directory = options.dataRoot === undefined
    ? join(dataRoot, personaId)
    : resolve(ROOT, options.dataRoot, personaId)
  if (!validateStateDirectory(ROOT, directory)) {
    throw new Error(`The persona directory is outside the project: ${directory}`)
  }

  step(`Initialise persona "${personaId}"`)
  const result = initPersonaFiles(dataRoot, personaId)
  console.log(`Directory: ${result.directory}`)
  console.log(result.created.length ? `Created: ${result.created.join(', ')}` : 'Created: (none)')
  if (result.existing.length) console.log(`Preserved: ${result.existing.join(', ')}`)
  console.log('The template is empty; the first conversation will guide IDENTITY and MISSION, or run /laputa init.')

  const patchPath = join(profileDir(), 'cordis.patch.yml')
  if (!existsSync(patchPath)) {
    throw new Error(`Missing ${patchPath}; run "npm run setup" before initialising a persona.`)
  }
  const before = readFileSync(patchPath, 'utf8')
  const next = upsertLaputaProfileConfig(before, {
    enabled: options.enable,
    personaId,
    ...(options.dataRoot === undefined ? {} : { sourceDir: result.directory }),
  })
  if (next === before) {
    console.log('Profile override is already current.')
  } else {
    const backup = writeProfile(patchPath, before, next)
    console.log(`Profile override: ${patchPath}`)
    console.log(`Backup: ${backup}`)
  }
  persona = { personaId, dataRoot, directory: result.directory }
  if (!options.enable) console.log('The plugin was written as disabled; set enabled: true to inject the persona.')
}

const built = existsSync(BUILT)
if (options.force || !built) {
  if (options.force || !existsSync(join(PLUGIN, 'node_modules'))) {
    step('Install dsh-laputa source dependencies')
    pnpm(['install', '--frozen-lockfile', '--reporter=append-only'], options.registry)
  }
  step('Build dsh-laputa')
  pnpm(['run', 'build'], options.registry)
} else {
  console.log('dsh-laputa is already built; use --force to rebuild.')
}

step('Verify plugin import')
verify()

mkdirSync(dirname(MARKER), { recursive: true })
writeFileSync(MARKER, `${JSON.stringify({
  version: 1,
  generatedAt: new Date().toISOString(),
  personaId: persona?.personaId ?? null,
  dataRoot: persona?.dataRoot ?? null,
  pluginDir: PLUGIN,
  built: true,
}, null, 2)}\n`, { mode: 0o600 })

console.log('dsh-laputa is ready.')
if (persona !== undefined) {
  console.log(`Persona files: ${persona.directory}`)
  console.log('The first conversation will guide IDENTITY and MISSION; you can also edit the six Markdown files directly. The next turn picks up changes.')
  console.log('Run /laputa status, /laputa validate, /laputa reload, or /laputa init in a session.')
}
