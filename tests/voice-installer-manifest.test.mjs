import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const file = resolve('plugins/voice/src/install-manifest.mjs')
const asset = { name: 'models.tar.gz', url: 'https://github.com/Mieksido/surfvoicecloud/releases/download/v0.1.0/models.tar.gz', sha256: 'a'.repeat(64), size: 42, dest: 'models' }
async function load() { assert.ok(existsSync(file), 'locked model manifest validation must exist'); return import(pathToFileURL(file).href) }

test('model manifests accept only pinned release sources and project-relative archive destinations', async () => {
  const { validateModelManifest } = await load()
  assert.deepEqual(validateModelManifest('voice-cloud', { archives: [asset] }), [asset])
  for (const bad of [
    { ...asset, url: 'https://attacker.invalid/models.tar.gz' },
    { ...asset, dest: '../../outside' },
    { ...asset, name: '../outside.tar.gz' },
    { ...asset, sha256: '' },
    { ...asset, url: 'https://github.com/Mieksido/surfvoicecloud/releases/download/v0.1.0/../other' },
  ]) assert.throws(() => validateModelManifest('voice-cloud', { archives: [bad] }))
})

test('split model manifests require part sizes to match the signed archive size', async () => {
  const { validateModelManifest } = await load()
  const part = { url: 'https://github.com/Mieksido/surfvoicelocal/releases/download/v0.1.0/piece', size: 21 }
  const split = { name: 'vendor.tar.gz', sha256: 'b'.repeat(64), size: 42, dest: '.', parts: [part, part] }
  assert.equal(validateModelManifest('voice-local', { archives: [split] })[0].parts.length, 2)
  assert.throws(() => validateModelManifest('voice-local', { archives: [{ ...split, size: 43 }] }))
})
