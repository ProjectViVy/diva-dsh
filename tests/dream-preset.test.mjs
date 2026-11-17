import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const preset = readFileSync(join(root, 'plugins', 'dsh-evolution', 'cordis.patch.yml'), 'utf8')
const launcher = readFileSync(join(root, 'plugins', 'dsh-evolution', 'src', 'dream-session.mjs'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'patches', 'superagent-patches.json'), 'utf8'))

/** The preset id Evolution creates Dream Sessions with. */
function declaredPreset() {
  const match = /DREAM_PRESET = '([^']+)'/.exec(launcher)
  assert.ok(match, 'dream-session.mjs must name the preset it creates Dream Sessions with')
  return match[1]
}

test('the evolution bundle declares the preset the Dream launcher mounts', () => {
  assert.equal(declaredPreset(), 'dsh-autodream')
  assert.match(preset, new RegExp(`id: ${declaredPreset()}$`, 'm'), 'the bundle must declare the preset id the launcher mounts')
  assert.match(preset, /^        name: 自动精炼$/m, 'the preset needs the display name the panel wording refers to')
  assert.match(preset, /^        order: 92$/m, 'the preset must sort after the two dsh-superagent presets (90, 91)')
  assert.match(preset, /不供手动选择/, 'a preset row has no hidden flag, so the description must say whom it is for')
})

test('the AutoDream preset carries no workspace tools', () => {
  for (const forbidden of ['dsh-tool-fs', 'dsh-tool-fs-search', 'dsh-tool-bash', 'dsh-tool-pwsh', 'dsh-tool-jobs', 'dsh-web-search']) {
    assert.equal(preset.includes(forbidden), false, `${forbidden} must not reach a Dream Session`)
  }
  assert.match(preset, /dsh-skill-filesystem/, 'the preset needs the skills the refinement workflow is written in')
  assert.match(preset, /dsh-compaction-basic/, 'a paged read of thousands of refs needs compaction')
})

test('the launcher is the only place that narrows the tool surface', () => {
  assert.match(launcher, /const DREAM_TOOLS = Object\.freeze\(\['skill'\]\)/, 'the global tool surface is skills only')
  assert.match(launcher, /const DREAM_PERMISSION = 'read-only'/, 'a refinement never needs write permission')
  assert.match(launcher, /tools\.restrict\(\{ allow: DREAM_TOOLS \}\)/, 'the restriction is applied in the Session scope')
  assert.match(launcher, /tools\.register\(dreamToolDefinition\(dream\)\)/, 'the domain tool is registered inside the same scope')
})

test('Superagent carries no Dream mode: the patch and its manifest entry are gone', () => {
  assert.equal(manifest.patches.includes('superagent-dream.patch'), false, 'the manifest must not list the retired patch')
  assert.equal(existsSync(join(root, 'patches', 'superagent-dream.patch')), false, 'the retired patch file must be gone')
})
