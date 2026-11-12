import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { compareVersions, inspectThirdPartyPlugin, parseVersion, readPins, satisfiesRelease } from '../scripts/lib/third-party.mjs'

test('version precedence covers prereleases, releases and the floor marker', () => {
  assert.equal(compareVersions('0.2.1-rc.5', '0.2.1-rc.2'), 1)
  assert.equal(compareVersions('0.2.1-rc.2', '0.2.1-rc.5'), -1)
  assert.equal(compareVersions('0.2.1', '0.2.1-rc.5'), 1)
  assert.equal(compareVersions('v0.83.1', '0.83.1'), 0)
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1)
  assert.deepEqual(parseVersion('0.2.1-rc.5'), { core: [0, 2, 1], pre: ['rc', '5'] })
  assert.equal(parseVersion('not-a-version'), null)
})

test('a declared release floor is read as "this version or newer"', () => {
  assert.equal(satisfiesRelease('0.2.1-rc.5', '0.2.1-rc.2+'), true)
  assert.equal(satisfiesRelease('0.2.1-rc.5', '0.2.0-rc.2+'), true)
  assert.equal(satisfiesRelease('0.2.1-rc.5', '0.2.2-rc.1+'), false)
  assert.equal(satisfiesRelease('0.2.0-rc.1', '0.2.1-rc.2+'), false)
  assert.throws(() => satisfiesRelease('0.2.1-rc.5', '0.2.1-rc.2'), /Unsupported DSH release constraint/)
})

test('the committed pin file is valid and pins dsh-context by tag', () => {
  const pins = readPins(resolve('.'))
  assert.equal(pins.version, 1)
  assert.ok(pins.plugins['dsh-context'], 'dsh-context should be pinned')
  assert.match(pins.plugins['dsh-context'].tag, /^v\d+\.\d+\.\d+/)
})

test('the pinned checkout declares compatibility with the DSH this repo runs', () => {
  const root = resolve('.')
  const entry = inspectThirdPartyPlugin(root, 'dsh-context', readPins(root))
  assert.equal(entry.pinnedTag, `v${entry.version}`, 'the checkout must sit on the pinned tag')
  assert.deepEqual(entry.missing.filter(item => !item.startsWith('build:')), [])
  assert.ok(entry.releases.some(key => satisfiesRelease(entry.dshVersion, key)))
})

function fixture(t, { version = '0.83.1', tag = 'v0.83.1', dshVersion = '0.2.1-rc.5', releases = { '0.2.1-rc.2+': 'compatible' }, build = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'diva-third-party-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(root, 'deepseek-harness'), { recursive: true })
  writeFileSync(join(root, 'deepseek-harness', 'package.json'), JSON.stringify({ name: 'dsh-root', version: dshVersion }))
  const dir = join(root, 'third-party', 'demo')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo', version, dsh: { compatibility: { dshReleases: releases } } }))
  if (build) for (const file of ['index.js', 'client.js']) writeFileSync(join(dir, 'lib', file), '')
  return { root, pins: { version: 1, plugins: { demo: { tag } } } }
}

test('a plugin on the pinned tag with a built lib is installable', t => {
  const { root, pins } = fixture(t)
  assert.deepEqual(inspectThirdPartyPlugin(root, 'demo', pins).missing, [])
})

test('drift off the pinned tag blocks registration', t => {
  const { root, pins } = fixture(t, { version: '0.84.0' })
  assert.deepEqual(inspectThirdPartyPlugin(root, 'demo', pins).missing, ['pin: pins.json says v0.83.1, the checkout is 0.84.0'])
})

test('a plugin that does not declare this DSH version is rejected', t => {
  const { root, pins } = fixture(t, { releases: { '0.2.2-rc.1+': 'compatible' } })
  assert.deepEqual(inspectThirdPartyPlugin(root, 'demo', pins).missing, ['compatibility: no declared release covers DSH 0.2.1-rc.5'])
})

test('a plugin that declares nothing at all is rejected', t => {
  const { root, pins } = fixture(t, { releases: {} })
  assert.deepEqual(inspectThirdPartyPlugin(root, 'demo', pins).missing, ['compatibility: the package declares no dsh.compatibility.dshReleases'])
})

test('a source checkout without build output reports the missing entries', t => {
  const { root, pins } = fixture(t, { build: false })
  const { missing } = inspectThirdPartyPlugin(root, 'demo', pins)
  assert.deepEqual(missing, ['build: lib/index.js is missing (run the package build)', 'build: lib/client.js is missing (run the package build)'])
})

test('an un-pinned plugin name is refused instead of guessed', t => {
  const { root, pins } = fixture(t)
  assert.throws(() => inspectThirdPartyPlugin(root, 'not-pinned', pins), /No pin for third-party plugin not-pinned/)
})
