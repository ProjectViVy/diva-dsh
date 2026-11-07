import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import * as componentSetup from '../scripts/lib/component-setup.mjs'
const { inspectComponents, componentCutoverReady, componentMigrationReady } = componentSetup

test('component registration is idempotent and refuses to replace unrelated dependencies', (t) => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'component-setup-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const profile = join(root, 'profile'); const voice = join(root, 'voice'); const memory = join(root, 'memory')
  mkdirSync(join(profile, 'node_modules'), { recursive: true }); mkdirSync(voice); mkdirSync(memory)
  const packages = [['dsh-local-voice', voice], ['dsh-local-memory', memory]]
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: [] } } }))
  assert.deepEqual(inspectComponents(profile, packages).missing, packages)
  for (const [name, target] of packages) symlinkSync(target, join(profile, 'node_modules', name), process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-local-voice': 'link:voice', 'dsh-local-memory': 'link:memory' }, dsh: { profile: { bundles: packages.map(x => x[0]) } } }))
  assert.deepEqual(inspectComponents(profile, packages).missing, [])
  assert.equal(componentCutoverReady(root, profile, packages), false)
  mkdirSync(join(root, '.artifacts/dsh-home/voice'), { recursive: true })
  mkdirSync(join(root, '.artifacts/dsh-home/memory'), { recursive: true })
  writeFileSync(join(root, '.artifacts/component-migration.json'), '{"version":1}')
  assert.equal(componentCutoverReady(root, profile, packages), true)
  rmSync(join(profile, 'node_modules', 'dsh-local-voice'))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-local-memory': 'link:memory' }, dsh: { profile: { bundles: ['dsh-local-memory'] } } }))
  assert.equal(componentMigrationReady(root), true)
  assert.equal(componentCutoverReady(root, profile, packages), false)
  symlinkSync(memory, join(profile, 'node_modules', 'dsh-local-voice'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => inspectComponents(profile, packages), /points elsewhere/i)
})

test('moving a project rewrites only its own pinned profile links and matching lock specifiers', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const temp = mkdtempSync(join(base, 'profile-relocate-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const old = join(temp, 'old'), moved = join(temp, 'new'), profile = join(old, '.artifacts/dsh-home/profiles/superagent-local')
  mkdirSync(profile, { recursive: true })
  mkdirSync(join(old, 'plugins/voice'), { recursive: true }); mkdirSync(join(old, 'superagent'), { recursive: true })
  const voice = `link:${join(old, 'plugins/voice')}`, superagent = `link:${join(old, 'superagent')}`
  const manifest = { dependencies: { 'dsh-local-voice': voice, 'dsh-superagent': superagent, other: 'link:/unrelated/package' }, dsh: { profile: { bundles: ['dsh-local-voice'] } } }
  writeFileSync(join(profile, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  writeFileSync(join(profile, 'pnpm-lock.yaml'), `importers:\n  .:\n    dependencies:\n      dsh-local-voice:\n        specifier: ${voice}\n        version: link:../../../../plugins/voice\n      dsh-superagent:\n        specifier: ${superagent}\n        version: link:../../../../superagent\n`)
  writeFileSync(join(old, '.artifacts/component-migration.json'), JSON.stringify({ version: 1, backup: join(old, '.artifacts/backups/migration') }))
  renameSync(old, moved)
  assert.equal(typeof componentSetup.relocateProfileDependencies, 'function')
  assert.equal(componentSetup.relocateProfileDependencies(moved, 'superagent-local'), true)
  const newProfile = join(moved, '.artifacts/dsh-home/profiles/superagent-local')
  const updated = JSON.parse(readFileSync(join(newProfile, 'package.json'), 'utf8'))
  assert.equal(updated.dependencies['dsh-local-voice'], 'link:../../../../plugins/voice')
  assert.equal(updated.dependencies['dsh-superagent'], 'link:../../../../superagent')
  assert.equal(updated.dependencies.other, 'link:/unrelated/package')
  const lock = readFileSync(join(newProfile, 'pnpm-lock.yaml'), 'utf8')
  assert.match(lock, /specifier: link:\.\.\/\.\.\/\.\.\/\.\.\/plugins\/voice/)
  assert.doesNotMatch(lock, /profile-relocate-.*\/old/)
  const backups = readdirSync(newProfile)
  assert.ok(backups.some(name => name.startsWith('package.json.pre-relocation-')))
  assert.ok(backups.some(name => name.startsWith('pnpm-lock.yaml.pre-relocation-')))
})

test('profile dependency relocation resumes after interruption between its two files', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const temp = mkdtempSync(join(base, 'profile-interrupt-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const old = join(temp, 'old'), moved = join(temp, 'new'), profile = join(old, '.artifacts/dsh-home/profiles/superagent-local')
  mkdirSync(profile, { recursive: true }); mkdirSync(join(old, 'plugins/voice'), { recursive: true })
  const voice = `link:${join(old, 'plugins/voice')}`
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-local-voice': voice } }))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), `importers:\n  .:\n    dependencies:\n      dsh-local-voice:\n        specifier: ${voice}\n        version: link:../../../../plugins/voice\n`)
  writeFileSync(join(old, '.artifacts/component-migration.json'), JSON.stringify({ version: 1, backup: join(old, '.artifacts/backups/migration') }))
  renameSync(old, moved)
  const module = new URL('../scripts/lib/component-setup.mjs', import.meta.url).href
  const script = `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module'; const original = fs.renameSync; fs.renameSync = (...args) => { original(...args); if (args[1].endsWith('/package.json')) process.exit(73) }; syncBuiltinESMExports(); const mod = await import(${JSON.stringify(module)}); mod.relocateProfileDependencies(process.argv[1], 'superagent-local')`
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, moved], { encoding: 'utf8' })
  assert.equal(child.status, 73, child.stderr)
  assert.equal(componentSetup.relocateProfileDependencies(moved, 'superagent-local'), true)
  const newProfile = join(moved, '.artifacts/dsh-home/profiles/superagent-local')
  assert.equal(JSON.parse(readFileSync(join(newProfile, 'package.json'), 'utf8')).dependencies['dsh-local-voice'], 'link:../../../../plugins/voice')
  assert.match(readFileSync(join(newProfile, 'pnpm-lock.yaml'), 'utf8'), /specifier: link:\.\.\/\.\.\/\.\.\/\.\.\/plugins\/voice/)
})

test('profile dependency relocation preserves files when the lockfile does not match', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const temp = mkdtempSync(join(base, 'profile-mismatch-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const old = join(temp, 'old'), moved = join(temp, 'new'), profile = join(old, '.artifacts/dsh-home/profiles/superagent-local')
  mkdirSync(profile, { recursive: true }); mkdirSync(join(old, 'plugins/voice'), { recursive: true })
  const manifest = JSON.stringify({ dependencies: { 'dsh-local-voice': `link:${join(old, 'plugins/voice')}` } })
  writeFileSync(join(profile, 'package.json'), manifest); writeFileSync(join(profile, 'pnpm-lock.yaml'), 'different-lock\n')
  writeFileSync(join(old, '.artifacts/component-migration.json'), JSON.stringify({ version: 1, backup: join(old, '.artifacts/backups/migration') }))
  renameSync(old, moved)
  assert.throws(() => componentSetup.relocateProfileDependencies(moved, 'superagent-local'), /lockfile/)
  assert.equal(readFileSync(join(moved, '.artifacts/dsh-home/profiles/superagent-local/package.json'), 'utf8'), manifest)
})

test('profile dependency relocation leaves unrelated links sharing an old path prefix untouched', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const temp = mkdtempSync(join(base, 'profile-prefix-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const old = join(temp, 'old'), moved = join(temp, 'new'), profile = join(old, '.artifacts/dsh-home/profiles/superagent-local')
  mkdirSync(profile, { recursive: true }); mkdirSync(join(old, 'superagent'), { recursive: true })
  const managed = `link:${join(old, 'superagent')}`, custom = `${managed}-custom`
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'dsh-superagent': managed, custom } }))
  writeFileSync(join(profile, 'pnpm-lock.yaml'), `importers:\n  .:\n    dependencies:\n      dsh-superagent:\n        specifier: ${managed}\n        version: link:../../../../superagent\n      custom:\n        specifier: ${custom}\n        version: ${custom}\n`)
  writeFileSync(join(old, '.artifacts/component-migration.json'), JSON.stringify({ version: 1, backup: join(old, '.artifacts/backups/migration') }))
  renameSync(old, moved)
  assert.equal(componentSetup.relocateProfileDependencies(moved, 'superagent-local'), true)
  const newProfile = join(moved, '.artifacts/dsh-home/profiles/superagent-local')
  assert.equal(JSON.parse(readFileSync(join(newProfile, 'package.json'), 'utf8')).dependencies.custom, custom)
  assert.ok(readFileSync(join(newProfile, 'pnpm-lock.yaml'), 'utf8').includes(`specifier: ${custom}`))
})

test('relocated profile links pass a real offline frozen pnpm install', t => {
  const pnpm = resolve('.artifacts/tools/node_modules/pnpm/bin/pnpm.cjs')
  if (!fs.existsSync(pnpm)) return t.skip('project-local pnpm is not installed')
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const temp = mkdtempSync(join(base, 'profile-pnpm-')); t.after(() => rmSync(temp, { recursive: true, force: true }))
  const old = join(temp, 'old'), moved = join(temp, 'new'), profile = join(old, '.artifacts/dsh-home/profiles/superagent-local'), voice = join(old, 'plugins/voice')
  mkdirSync(profile, { recursive: true }); mkdirSync(voice, { recursive: true })
  writeFileSync(join(voice, 'package.json'), JSON.stringify({ name: 'dsh-local-voice', version: '1.0.0' }))
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'fixture', private: true, dependencies: { 'dsh-local-voice': `link:${voice}` } }))
  writeFileSync(join(old, '.artifacts/component-migration.json'), JSON.stringify({ version: 1, backup: join(old, '.artifacts/backups/migration') }))
  const env = { ...process.env, CI: 'true', pnpm_config_store_dir: join(temp, 'store'), npm_config_cache: join(temp, 'cache'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_CACHE_HOME: join(temp, 'xdg-cache'), TMPDIR: temp, TMP: temp, TEMP: temp }
  const install = (cwd, frozen) => spawnSync(process.execPath, [pnpm, 'install', '--offline', '--ignore-scripts', ...(frozen ? ['--frozen-lockfile'] : [])], { cwd, env, encoding: 'utf8' })
  const initial = install(profile, false); assert.equal(initial.status, 0, initial.stderr || initial.stdout)
  renameSync(old, moved)
  assert.equal(componentSetup.relocateProfileDependencies(moved, 'superagent-local'), true)
  const result = install(join(moved, '.artifacts/dsh-home/profiles/superagent-local'), true)
  assert.equal(result.status, 0, result.stderr || result.stdout)
})
