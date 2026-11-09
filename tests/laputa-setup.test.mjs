import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { componentPackages } from '../scripts/lib/component-setup.mjs'
import { PERSONA_FILES, initPersonaFiles, upsertLaputaProfileConfig } from '../scripts/lib/laputa.mjs'
import * as laputaSetup from '../scripts/lib/laputa.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const POSIX = process.platform !== 'win32'
const tempDirs = []

function tempRoot() {
  const directory = mkdtempSync(join(tmpdir(), 'laputa-setup-'))
  tempDirs.push(directory)
  return directory
}

test.afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

const PROFILE = [
  '# profile comment',
  '- id: webserver',
  '  config:',
  '    host: 127.0.0.1',
  '    port: 3082',
  '- id: dsh-superagent',
  '  config:',
  '    stateDir: /tmp/state',
  '',
].join('\n')

test('default component activation enables an empty persona and is idempotent', () => {
  const root = tempRoot()
  const profile = join(root, 'profile')
  mkdirSync(profile)
  const patch = join(profile, 'cordis.patch.yml')
  writeFileSync(patch, PROFILE)
  assert.equal(typeof laputaSetup.activateDefaultPersona, 'function')
  assert.equal(laputaSetup.activateDefaultPersona(profile, join(root, 'laputa')), true)
  const activated = readFileSync(patch, 'utf8')
  assert.ok(activated.includes('enabled: true'))
  assert.ok(activated.includes('personaId: default'))
  assert.equal(readFileSync(join(profile, 'cordis.patch.pre-default-persona.yml'), 'utf8'), PROFILE)
  writeFileSync(join(root, 'laputa/default/IDENTITY.MD'), 'My identity')
  assert.equal(laputaSetup.activateDefaultPersona(profile, join(root, 'laputa')), false)
  assert.equal(readFileSync(patch, 'utf8'), activated)
  assert.equal(readFileSync(join(root, 'laputa/default/IDENTITY.MD'), 'utf8'), 'My identity')
  // Turning off in the host editor removes the now-redundant enabled override.
  writeFileSync(patch, PROFILE)
  assert.equal(laputaSetup.activateDefaultPersona(profile, join(root, 'laputa')), false)
  assert.equal(readFileSync(patch, 'utf8'), PROFILE)
})

test('default component activation preserves an existing persona configuration', () => {
  const root = tempRoot()
  const selected = upsertLaputaProfileConfig(PROFILE, { enabled: false, personaId: 'custom', sourceDir: join(root, 'custom') })
  writeFileSync(join(root, 'cordis.patch.yml'), selected)
  assert.equal(typeof laputaSetup.activateDefaultPersona, 'function')
  assert.equal(laputaSetup.activateDefaultPersona(root, join(root, 'laputa')), false)
  assert.equal(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), selected)
  writeFileSync(join(root, 'cordis.patch.yml'), PROFILE)
  assert.equal(laputaSetup.activateDefaultPersona(root, join(root, 'laputa')), false)
  assert.equal(readFileSync(join(root, 'cordis.patch.yml'), 'utf8'), PROFILE)
})

test('initPersonaFiles creates a restricted directory and six empty files', () => {
  const root = tempRoot()
  const result = initPersonaFiles(join(root, 'laputa'), 'vivy')
  assert.equal(result.created.length, PERSONA_FILES.length)
  assert.deepEqual(result.existing, [])
  assert.equal(result.directory, realpathSync(join(root, 'laputa', 'vivy')))
  for (const name of PERSONA_FILES) {
    assert.ok(statSync(join(result.directory, name)).isFile(), `${name} should exist`)
    assert.equal(readFileSync(join(result.directory, name), 'utf8'), '', `${name} should be an empty template`)
  }
  if (POSIX) {
    assert.equal(statSync(result.directory).mode & 0o777, 0o700)
    for (const name of PERSONA_FILES) {
      assert.equal(statSync(join(result.directory, name)).mode & 0o777, 0o600)
    }
  }
})

test('initPersonaFiles never overwrites existing persona files', () => {
  const root = tempRoot()
  const directory = join(root, 'laputa', 'vivy')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'MISSION.MD'), 'my own mission\n')
  writeFileSync(join(directory, 'IDENTITY.MD'), 'my own identity\n')
  const result = initPersonaFiles(join(root, 'laputa'), 'vivy')
  assert.equal(readFileSync(join(directory, 'MISSION.MD'), 'utf8'), 'my own mission\n')
  assert.equal(readFileSync(join(directory, 'IDENTITY.MD'), 'utf8'), 'my own identity\n')
  assert.deepEqual(result.existing.sort(), ['IDENTITY.MD', 'MISSION.MD'])
  assert.ok(result.created.includes('RELATIONSHIP.MD'))
})

test('initPersonaFiles rejects unsafe persona ids', () => {
  const root = tempRoot()
  for (const value of ['', '.', '..', 'a/b', 'a\\b']) {
    assert.throws(() => initPersonaFiles(join(root, 'laputa'), value), /Invalid personaId/)
  }
})

test('initPersonaFiles refuses a symlinked persona directory', { skip: !POSIX }, () => {
  const root = tempRoot()
  const base = join(root, 'laputa')
  mkdirSync(base, { recursive: true })
  mkdirSync(join(base, 'real'))
  symlinkSync(join(base, 'real'), join(base, 'vivy'))
  assert.throws(() => initPersonaFiles(base, 'vivy'), /symlink/)
})

test('profile override is appended and preserves other entries and comments', () => {
  const next = upsertLaputaProfileConfig(PROFILE, { enabled: true, personaId: 'vivy' })
  assert.ok(next.includes('# profile comment'))
  assert.ok(next.includes('- id: webserver'))
  assert.ok(next.includes('- id: dsh-superagent'))
  assert.ok(next.includes('- id: laputa'))
  assert.ok(next.includes('    enabled: true'))
  assert.ok(next.includes('    personaId: vivy'))
  assert.ok(next.endsWith('\n'))
})

test('profile override is idempotent', () => {
  const once = upsertLaputaProfileConfig(PROFILE, { enabled: true, personaId: 'vivy' })
  const twice = upsertLaputaProfileConfig(once, { enabled: true, personaId: 'vivy' })
  assert.equal(twice, once)
})

test('profile override replaces an existing laputa block in place', () => {
  const withVivy = upsertLaputaProfileConfig(PROFILE, { enabled: true, personaId: 'vivy' })
  const withOther = `${withVivy}- id: ui-settings-general\n  config:\n    welcomeNoticeVersion: 1\n`
  const replaced = upsertLaputaProfileConfig(withOther, { enabled: false, personaId: 'other' })
  assert.equal(replaced.match(/^- id: laputa$/gm)?.length, 1)
  assert.ok(replaced.includes('    enabled: false'))
  assert.ok(replaced.includes('    personaId: other'))
  assert.ok(replaced.includes('- id: ui-settings-general'))
  assert.ok(!replaced.includes('personaId: vivy'))
})

test('profile override accepts an absolute sourceDir and quotes it', () => {
  const next = upsertLaputaProfileConfig(PROFILE, {
    enabled: true,
    personaId: 'vivy',
    sourceDir: '/srv/personas/vivy',
  })
  assert.ok(next.includes('    sourceDir: "/srv/personas/vivy"'))
  assert.throws(() => upsertLaputaProfileConfig(PROFILE, {
    enabled: true,
    personaId: 'vivy',
    sourceDir: 'relative/path',
  }), /must be absolute/)
})

test('profile override accepts an empty array placeholder', () => {
  const next = upsertLaputaProfileConfig('[]\n', { enabled: true, personaId: 'vivy' })
  assert.ok(next.startsWith('- id: laputa\n'))
})

test('profile override refuses non-simple YAML', () => {
  assert.throws(
    () => upsertLaputaProfileConfig('- [webserver, dsh-superagent]\n', { personaId: 'vivy' }),
    /not a simple YAML array/,
  )
  assert.throws(
    () => upsertLaputaProfileConfig('---\n- id: webserver\n', { personaId: 'vivy' }),
    /not a simple YAML array/,
  )
})

test('component registration includes dsh-laputa', () => {
  const packages = componentPackages(ROOT)
  assert.deepEqual(packages.find(([name]) => name === 'dsh-laputa'), [
    'dsh-laputa',
    join(ROOT, 'plugins', 'dsh-laputa'),
  ])
})

test('the plugin package is a source bundle with a built entrypoint', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'plugins', 'dsh-laputa', 'package.json'), 'utf8'))
  assert.equal(manifest.name, 'dsh-laputa')
  assert.equal(manifest.main, 'lib/types/index.js')
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.equal(manifest.exports?.['./client'], './src/client.js')
  assert.ok(manifest.files.includes('src/client.js'))
  assert.ok(statSync(join(ROOT, 'plugins', 'dsh-laputa', 'src', 'index.ts')).isFile())
  assert.ok(statSync(join(ROOT, 'plugins', 'dsh-laputa', 'src', 'client.js')).isFile())
  assert.equal(lstatSync(join(ROOT, 'plugins', 'dsh-laputa', 'pnpm-lock.yaml')).isFile(), true)
})
