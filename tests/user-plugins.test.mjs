import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { inspectUserPlugin, needsBuild, pruneNames, sameTarget, scanUserPlugins } from '../scripts/lib/user-plugins.mjs'

/** 临时目录：user-plugins/ 与一个最小 profile。 */
function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), 'diva-user-plugins-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const userDir = join(root, 'user-plugins')
  const profileDir = join(root, 'profile')
  mkdirSync(userDir, { recursive: true })
  mkdirSync(profileDir, { recursive: true })
  return { root, userDir, profileDir }
}

function writePlugin(dir, manifest, files = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const [name, body] of Object.entries(files)) {
    const file = join(dir, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, body)
  }
}

function validManifest(extra = {}) {
  return {
    name: 'my-tool',
    version: '0.0.1',
    type: 'module',
    main: './index.js',
    dsh: { bundle: { patch: './cordis.patch.yml' } },
    ...extra,
  }
}

function validFiles() {
  return { 'cordis.patch.yml': '- insert:\n    - id: my-tool\n      name: my-tool\n', 'index.js': 'export const name = "my-tool"\n' }
}

/** 写一个合法插件并返回它的检查结果。 */
function inspectOne(t, { manifest = validManifest(), files = validFiles(), dependencies = {}, profileDir } = {}) {
  const { userDir, profileDir: defaultProfile } = sandbox(t)
  const dir = join(userDir, 'my-tool')
  writePlugin(dir, manifest, files)
  const [entry] = scanUserPlugins(userDir)
  return { result: inspectUserPlugin(entry, { profileDependencies: dependencies, profileDir: profileDir ?? defaultProfile }), userDir, dir }
}

test('scan skips drafts, hidden directories and entries without a manifest', t => {
  const { userDir } = sandbox(t)
  writePlugin(join(userDir, 'tool-a'), validManifest())
  writePlugin(join(userDir, 'tool-b'), validManifest({ name: 'tool-b' }))
  mkdirSync(join(userDir, '_draft'))
  mkdirSync(join(userDir, '.hidden'))
  mkdirSync(join(userDir, 'not-a-plugin'))
  writeFileSync(join(userDir, 'README.md'), '# docs\n')
  assert.deepEqual(scanUserPlugins(userDir).map(entry => entry.dirName), ['tool-a', 'tool-b'])
  assert.deepEqual(scanUserPlugins(join(userDir, 'missing')), [], 'a missing directory is an empty source of plugins, not an error')
})

test('a well-formed private plugin is ready to register without a build', t => {
  const { result } = inspectOne(t)
  assert.deepEqual(result.problems, [])
  assert.equal(result.name, 'my-tool')
  assert.equal(result.needsBuild, false)
})

test('a directory without package.json is refused', t => {
  const { userDir } = sandbox(t)
  mkdirSync(join(userDir, 'broken'), { recursive: true })
  writeFileSync(join(userDir, 'broken', 'package.json'), '{ not json')
  const [entry] = scanUserPlugins(userDir)
  assert.equal(entry.manifest, undefined)
  assert.match(inspectUserPlugin(entry).problems[0], /package\.json 缺失、不是常规文件或不是合法 JSON/)
})

test('an invalid package name is refused', t => {
  const { result } = inspectOne(t, { manifest: validManifest({ name: 'My Tool' }) })
  assert.match(result.problems.join('\n'), /不是 npm 接受的包名/)
})

test('a plugin without dsh.bundle.patch is refused instead of being installed as a plain dependency', t => {
  const { result } = inspectOne(t, { manifest: validManifest({ dsh: undefined }) })
  assert.match(result.problems.join('\n'), /没有声明 dsh\.bundle\.patch/)
})

test('a bundle patch that points outside the package is refused', t => {
  const { result } = inspectOne(t, { manifest: validManifest({ dsh: { bundle: { patch: '../outside.yml' } } }) })
  assert.match(result.problems.join('\n'), /指向包目录之外/)
})

test('a bundle patch that does not exist is refused', t => {
  const { result } = inspectOne(t, { manifest: validManifest({ dsh: { bundle: { patch: './missing.yml' } } }) })
  assert.match(result.problems.join('\n'), /指向的 \.\/missing\.yml 不存在/)
})

test('exports["."] counts as an entry when main is absent', t => {
  const { result } = inspectOne(t, {
    manifest: validManifest({ main: undefined, exports: { '.': './src/index.js' } }),
    files: { 'cordis.patch.yml': '- insert: []\n', 'src/index.js': 'export const name = "my-tool"\n' },
  })
  assert.deepEqual(result.problems, [])
})

test('a build script makes a source-only plugin pending instead of broken', t => {
  const { userDir, profileDir } = sandbox(t)
  const dir = join(userDir, 'my-tool')
  writePlugin(dir, validManifest({ main: './lib/index.js', scripts: { build: 'node build.mjs' } }), {
    'cordis.patch.yml': '- insert: []\n',
  })
  const [entry] = scanUserPlugins(userDir)
  assert.equal(needsBuild(entry), true)
  const result = inspectUserPlugin(entry, { profileDependencies: {}, profileDir })
  assert.deepEqual(result.problems, [])
  assert.equal(result.needsBuild, true)
})

test('a plugin with neither an entry nor a build script is refused', t => {
  const { result } = inspectOne(t, {
    manifest: validManifest({ main: './lib/index.js' }),
    files: { 'cordis.patch.yml': '- insert: []\n' },
  })
  assert.match(result.problems.join('\n'), /入口文件不存在/)
})

test('a package name already used by another profile source is refused to prevent hijacking', t => {
  const { root } = sandbox(t)
  const { result } = inspectOne(t, {
    dependencies: { 'my-tool': `link:${join(root, 'plugins', 'dsh-daily')}` },
  })
  assert.match(result.problems.join('\n'), /已被 profile 里另一个来源占用/)
})

test('the same package already linked to this directory is idempotent, not a conflict', t => {
  const { userDir } = sandbox(t)
  const dir = join(userDir, 'my-tool')
  writePlugin(dir, validManifest(), validFiles())
  const [entry] = scanUserPlugins(userDir)
  const result = inspectUserPlugin(entry, { profileDependencies: { 'my-tool': `link:${dir}` }, profileDir: join(userDir, '..', 'profile') })
  assert.deepEqual(result.problems, [])
  assert.equal(sameTarget(`link:${dir}`, dir, join(userDir, '..', 'profile')), true)
})

test('stale links are only the ones inside the user-plugins directory whose source is gone', t => {
  const { userDir, profileDir } = sandbox(t)
  const alive = join(userDir, 'alive')
  writePlugin(alive, validManifest(), validFiles())
  const gone = join(userDir, 'gone')
  const outside = join(userDir, '..', 'plugins', 'dsh-daily')
  const profile = {
    dependencies: {
      alive: `link:${alive}`,
      gone: `link:${gone}`,
      'dsh-daily': `link:${outside}`,
      relative: 'link:../user-plugins/gone',
      registry: '^1.2.3',
    },
  }
  assert.deepEqual(pruneNames(profile, { profileDir, userDir }), ['gone', 'relative'])
})
