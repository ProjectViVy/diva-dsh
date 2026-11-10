import test from 'node:test'

test('standalone mempalace installation confines caches and temporary files to the project', async () => {
  const { runMempalaceNpm } = await import('../scripts/lib/mempalace-setup.mjs')
  let call
  runMempalaceNpm(['install'], { root: '/project', parent: { PATH: '/bin', DSH_HOME: '/outside/home', npm_config_cache: '/outside/cache', TMPDIR: '/outside/tmp' }, spawnImpl: (cmd, args, options) => { call = { cmd, args, options }; return { status: 0 } }, platform: 'linux' })
  assert.equal(call.options.cwd, '/project/plugins/dsh-mempalace')
  assert.equal(call.options.env.DSH_HOME, '/project/.artifacts/dsh-home')
  assert.equal(call.options.env.npm_config_cache, '/project/.artifacts/npm-cache')
  assert.equal(call.options.env.npm_package_config_node_gyp_devdir, '/project/.artifacts/node-gyp')
  assert.equal(call.options.env.npm_config_devdir, '/project/.artifacts/node-gyp')
  assert.equal(call.options.env.TMPDIR, '/project/.artifacts/tmp')
  assert.equal(call.options.env.XDG_CACHE_HOME, '/project/.artifacts/xdg-cache')
})
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { createServer } from 'node:http'
import * as source from '../scripts/lib/source.mjs'

const scratch = resolve('.artifacts', 'test-tmp')

test('state directory parsing accepts YAML escaped line continuations emitted by plugin registration', () => {
  for (const newline of ['\n', '\r\n']) {
    const patch = `- id: dsh-superagent${newline}  config:${newline}    stateDir: "C:/project/state/su\\${newline}      peragent-local"${newline}`
    assert.equal(source.configuredStateDirectory(patch), 'C:/project/state/superagent-local')
  }
})

test('root npm commands use the project-local cache by default', (t) => {
  const { root } = fixture(t)
  const logs = join(root, 'logs')
  mkdirSync(logs)
  const env = { ...process.env }
  delete env.npm_config_cache
  delete env.NPM_CONFIG_CACHE
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const cache = execFileSync(npm, ['config', 'get', 'cache', '--logs-dir', logs], {
    encoding: 'utf8', env, shell: process.platform === 'win32',
  }).trim()
  assert.equal(cache, resolve('.artifacts', 'npm-cache'))
})

function fixture(t) {
  mkdirSync(scratch, { recursive: true })
  const parent = mkdtempSync(join(scratch, 'source-runtime-'))
  const root = join(parent, 'project')
  mkdirSync(root)
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  return { parent, root }
}

test('npm lifecycle receives the project-local native build cache', async t => {
  const { runMempalaceNpm } = await import('../scripts/lib/mempalace-setup.mjs')
  const { root } = fixture(t), plugin = join(root, 'plugins', 'dsh-mempalace')
  mkdirSync(plugin, { recursive: true }); mkdirSync(join(root, '.artifacts', 'tmp'), { recursive: true })
  writeFileSync(join(plugin, 'package.json'), JSON.stringify({ name: 'local-env-probe', version: '1.0.0', private: true, scripts: { install: 'node probe.cjs' } }))
  writeFileSync(join(plugin, 'probe.cjs'), "require('node:fs').writeFileSync('result.json', JSON.stringify({cache:process.env.npm_config_cache, devdir:process.env.npm_package_config_node_gyp_devdir, tmp:process.env.TMPDIR}))")
  const result = runMempalaceNpm(['install', '--offline', '--no-audit', '--no-fund', '--package-lock=false'], { root, spawnImpl: (cmd, args, opts) => spawnSync(cmd, args, { ...opts, stdio: 'pipe', encoding: 'utf8' }) })
  assert.equal(result.status, 0, result.stderr)
  const env = JSON.parse(readFileSync(join(plugin, 'result.json'), 'utf8'))
  assert.equal(env.cache, join(root, '.artifacts', 'npm-cache'))
  assert.equal(env.devdir, join(root, '.artifacts', 'node-gyp'))
  assert.equal(env.tmp, join(root, '.artifacts', 'tmp'))
})

test('child processes keep DSH data, package caches and temporary files in the project', (t) => {
  const { root } = fixture(t)
  const env = source.localEnvironment(root, {
    PATH: '/existing/bin', DSH_HOME: '/outside/dsh', PNPM_HOME: '/outside/pnpm',
    XDG_CONFIG_HOME: '/outside/config', TMPDIR: '/outside/tmp', KEEP_THIS: 'yes',
  })
  assert.equal(env.DSH_HOME, join(root, '.artifacts', 'dsh-home'))
  assert.equal(env.PNPM_HOME, join(root, '.artifacts', 'pnpm-home'))
  assert.equal(env.pnpm_config_store_dir, join(root, '.artifacts', 'pnpm-store'))
  assert.equal(env.npm_config_cache, join(root, '.artifacts', 'npm-cache'))
  assert.equal(env.XDG_CONFIG_HOME, join(root, '.artifacts', 'xdg-config'))
  assert.equal(env.XDG_CACHE_HOME, join(root, '.artifacts', 'xdg-cache'))
  assert.equal(env.XDG_DATA_HOME, join(root, '.artifacts', 'xdg-data'))
  assert.equal(env.TMPDIR, join(root, '.artifacts', 'tmp'))
  assert.equal(env.TMP, env.TMPDIR)
  assert.equal(env.TEMP, env.TMPDIR)
  assert.equal(env.KEEP_THIS, 'yes')
  assert.equal(env.PATH, `${join(root, 'deepseek-harness', 'node_modules', '.bin')}${delimiter}/existing/bin`)
})

test('a fresh profile receives a local state directory and requested port', (t) => {
  const { root } = fixture(t)
  const changed = source.ensureMachineConfig(root, 'superagent-local', 3082)
  const patch = readFileSync(join(root, '.artifacts', 'dsh-home', 'profiles', 'superagent-local', 'cordis.patch.yml'), 'utf8')
  assert.equal(changed, true)
  assert.match(patch, /port: 3082/)
  assert.ok(patch.includes(JSON.stringify(join(root, '.artifacts', 'dsh-home', 'state', 'superagent-local'))))
})

test('setup preserves an already configured local profile', (t) => {
  const { root } = fixture(t)
  const profile = join(root, '.artifacts', 'dsh-home', 'profiles', 'superagent-local')
  mkdirSync(profile, { recursive: true })
  const existing = `- id: dsh-superagent\n  config:\n    stateDir: ${join(root, 'saved-state')}\n- id: other\n  disabled: true\n`
  const patch = join(profile, 'cordis.patch.yml')
  writeFileSync(patch, existing)
  assert.equal(source.ensureMachineConfig(root, 'superagent-local', 3082), false)
  assert.equal(readFileSync(patch, 'utf8'), existing)
})

test('setup relocates its own profile state path after the whole project moves', t => {
  const { root, parent } = fixture(t), profile = 'superagent-local'
  source.ensureMachineConfig(root, profile, 3082)
  const artifacts = join(root, '.artifacts')
  writeFileSync(join(artifacts, 'component-migration.json'), JSON.stringify({ version: 1, backup: join(artifacts, 'backups', 'component-migration-fixture') }))
  const original = readFileSync(join(artifacts, 'dsh-home/profiles', profile, 'cordis.patch.yml'), 'utf8')
  const moved = join(parent, 'moved-project'); renameSync(root, moved)
  assert.equal(source.ensureMachineConfig(moved, profile, 3082), true)
  const patch = readFileSync(join(moved, '.artifacts/dsh-home/profiles', profile, 'cordis.patch.yml'), 'utf8')
  assert.equal(source.configuredStateDirectory(patch), join(moved, '.artifacts/dsh-home/state', profile))
  assert.match(patch, /port: 3082/)
  assert.ok(readFileSync(join(moved, '.artifacts/dsh-home/profiles', profile, 'cordis.patch.pre-relocation.yml'), 'utf8') === original)
})

test('setup leaves a copied project state path untouched while the original still exists', t => {
  const { root, parent } = fixture(t), profile = 'superagent-local'
  source.ensureMachineConfig(root, profile, 3082)
  const copied = join(parent, 'copy'), patchDir = join(copied, '.artifacts/dsh-home/profiles', profile)
  mkdirSync(patchDir, { recursive: true }); mkdirSync(join(copied, '.artifacts/dsh-home/state', profile), { recursive: true })
  const patch = readFileSync(join(root, '.artifacts/dsh-home/profiles', profile, 'cordis.patch.yml'), 'utf8')
  writeFileSync(join(patchDir, 'cordis.patch.yml'), patch)
  writeFileSync(join(copied, '.artifacts/component-migration.json'), JSON.stringify({ version: 1, backup: join(root, '.artifacts/backups/component-migration-fixture') }))
  assert.throws(() => source.ensureMachineConfig(copied, profile, 3082), /outside the project/)
  assert.equal(readFileSync(join(patchDir, 'cordis.patch.yml'), 'utf8'), patch)
})

test('a state directory outside the project, including a symlink escape, is rejected', (t) => {
  const { root, parent } = fixture(t)
  const outside = join(parent, 'outside')
  mkdirSync(outside)
  symlinkSync(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(source.validateStateDirectory(root, join(root, 'nested', 'state')), true)
  assert.equal(source.validateStateDirectory(root, join(parent, 'outside', 'state')), false)
  assert.equal(source.validateStateDirectory(root, join(root, 'escape', 'state')), false)
  assert.equal(source.validateStateDirectory(root, 'relative-state'), false)
})

test('setup refuses a package-cache symlink pointing outside the project', (t) => {
  const { root, parent } = fixture(t)
  const outside = join(parent, 'outside')
  mkdirSync(outside)
  mkdirSync(join(root, '.artifacts'))
  symlinkSync(outside, join(root, '.artifacts', 'pnpm-store'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => source.prepareLocalDirectories(root), /outside the project/)
})

test('setup refuses a control directory symlink pointing outside the project', (t) => {
  const { root, parent } = fixture(t)
  const outside = join(parent, 'outside')
  mkdirSync(outside)
  mkdirSync(join(root, '.artifacts'))
  symlinkSync(outside, join(root, '.artifacts', 'control'), process.platform === 'win32' ? 'junction' : 'dir')
  assert.throws(() => source.prepareLocalDirectories(root), /outside the project/)
})

test('startup runs the source entry with the template root as its working directory', (t) => {
  const { root } = fixture(t)
  const harness = join(root, 'deepseek-harness')
  const tsx = join(harness, 'node_modules', 'tsx')
  const cli = join(harness, 'apps', 'cli', 'src')
  mkdirSync(tsx, { recursive: true })
  mkdirSync(cli, { recursive: true })
  writeFileSync(join(harness, 'package.json'), '{"type":"module"}')
  writeFileSync(join(tsx, 'package.json'), '{"name":"tsx","type":"module","exports":{"./esm":"./esm.mjs"}}')
  writeFileSync(join(tsx, 'esm.mjs'), '')
  writeFileSync(join(cli, 'bin.ts'), 'console.log(process.cwd())')
  const invocation = source.sourceRuntimeInvocation(root, ['--profile', 'superagent-local'])
  assert.equal(invocation.env.TSX_TSCONFIG_PATH, join(harness, 'tsconfig.json'))
  const output = execFileSync(process.execPath, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: 'utf8' }).trim()
  assert.equal(output, root)
})

test('a malformed configured state directory cannot silently fall back to another lock path', (t) => {
  const { root } = fixture(t)
  const lib = join(root, 'scripts', 'lib')
  const profile = join(root, '.artifacts', 'dsh-home', 'profiles', 'superagent-local')
  mkdirSync(lib, { recursive: true })
  mkdirSync(profile, { recursive: true })
  copyFileSync(resolve('scripts/lib/source.mjs'), join(lib, 'source.mjs'))
  copyFileSync(resolve('scripts/lib/vivy.mjs'), join(lib, 'vivy.mjs'))
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: dsh-superagent\n  config:\n    stateDir: "unterminated\n')
  const script = `import { stateDir } from ${JSON.stringify(pathToFileURL(join(lib, 'vivy.mjs')).href)}; stateDir()`
  assert.throws(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], { stdio: 'pipe' }))
})

test('the startup link is read from the newest local profile log only', (t) => {
  const { root } = fixture(t)
  const logs = join(root, 'logs')
  mkdirSync(logs)
  const old = join(logs, 'vivy-dsh-superagent-local-old.log')
  const latest = join(logs, 'vivy-dsh-superagent-local-new.log')
  writeFileSync(old, 'dsh web: http://127.0.0.1:3082/?token=old\n')
  writeFileSync(latest, 'dsh web: http://127.0.0.1:3082/?token=current\n')
  writeFileSync(join(logs, 'vivy-dsh-other-later.log'), 'dsh web: http://127.0.0.1:3082/?token=wrong\n')
  utimesSync(old, 1, 1)
  utimesSync(latest, 2, 2)
  assert.equal(source.panelLinkFromLogs(logs, 'superagent-local', 'http://127.0.0.1:3082'), 'http://127.0.0.1:3082/?token=current')
  writeFileSync(latest, 'dsh web: https://untrusted.example/?token=wrong\n')
  utimesSync(latest, 2, 2)
  assert.equal(source.panelLinkFromLogs(logs, 'superagent-local', 'http://127.0.0.1:3082'), undefined)
})

function patchFixture(t, contents = 'before\nunchanged\n') {
  const { root } = fixture(t)
  mkdirSync(join(root, 'src'))
  const target = join(root, 'src', 'config.txt')
  const patch = join(root, 'change.patch')
  writeFileSync(target, contents)
  writeFileSync(patch, '--- a/src/config.txt\n+++ b/src/config.txt\n@@ -1,2 +1,2 @@\n-before\n+after\n unchanged\n')
  return { root, target, patch }
}

test('a build patch is restored even when the build fails', (t) => {
  const { root, target, patch } = patchFixture(t)
  assert.throws(() => source.withTemporaryPatch(root, patch, () => {
    assert.equal(readFileSync(target, 'utf8'), 'after\nunchanged\n')
    throw new Error('build failed')
  }), /build failed/)
  assert.equal(readFileSync(target, 'utf8'), 'before\nunchanged\n')
})

test('a patch already present in the working tree is preserved', (t) => {
  const { root, target, patch } = patchFixture(t, 'after\nunchanged\n')
  assert.equal(source.withTemporaryPatch(root, patch, () => 'built'), 'built')
  assert.equal(readFileSync(target, 'utf8'), 'after\nunchanged\n')
})

test('the build patch preserves CRLF checkouts', (t) => {
  const { root, target, patch } = patchFixture(t, 'before\r\nunchanged\r\n')
  source.withTemporaryPatch(root, patch, () => {
    assert.equal(readFileSync(target, 'utf8'), 'after\r\nunchanged\r\n')
  })
  assert.equal(readFileSync(target, 'utf8'), 'before\r\nunchanged\r\n')
})

test('the build patch handles mixed line endings across source files', (t) => {
  const { root, target, patch } = patchFixture(t, 'before\r\nunchanged\r\n')
  const other = join(root, 'src', 'other.txt')
  writeFileSync(other, 'before\nunchanged\n')
  const first = readFileSync(patch, 'utf8')
  writeFileSync(patch, `${first}--- a/src/other.txt\n+++ b/src/other.txt\n@@ -1,2 +1,2 @@\n-before\n+after\n unchanged\n`)
  source.withTemporaryPatch(root, patch, () => {
    assert.equal(readFileSync(target, 'utf8'), 'after\r\nunchanged\r\n')
    assert.equal(readFileSync(other, 'utf8'), 'after\nunchanged\n')
  })
  assert.equal(readFileSync(target, 'utf8'), 'before\r\nunchanged\r\n')
  assert.equal(readFileSync(other, 'utf8'), 'before\nunchanged\n')
})

test('a conflicting source edit is left untouched and the build is not run', (t) => {
  const { root, target, patch } = patchFixture(t, 'user change\nunchanged\n')
  let ran = false
  assert.throws(() => source.withTemporaryPatch(root, patch, () => { ran = true }), /cannot apply.*patch/i)
  assert.equal(ran, false)
  assert.equal(readFileSync(target, 'utf8'), 'user change\nunchanged\n')
})

test('setup detects a submodule at another commit without changing that checkout', (t) => {
  const { root } = fixture(t)
  const child = join(root, 'superagent')
  mkdirSync(child)
  const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  const commit = () => git(child, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  git(root, ['init', '-q'])
  git(child, ['init', '-q'])
  writeFileSync(join(child, 'file'), 'first\n')
  git(child, ['add', 'file'])
  commit()
  const pinned = git(child, ['rev-parse', 'HEAD'])
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${pinned},superagent`])
  assert.equal(source.verifyPinnedSubmodule(root, 'superagent'), pinned)
  writeFileSync(join(child, 'file'), 'second\n')
  git(child, ['add', 'file'])
  commit()
  const other = git(child, ['rev-parse', 'HEAD'])
  assert.throws(() => source.verifyPinnedSubmodule(root, 'superagent'), /pinned/i)
  assert.equal(git(child, ['rev-parse', 'HEAD']), other)
})

test('pinned submodule verification warns about tracked edits but allows local work', t => {
  const { root } = fixture(t), child = join(root, 'superagent'); mkdirSync(child)
  const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  git(root, ['init', '-q']); git(child, ['init', '-q'])
  const file = join(child, 'file'); writeFileSync(file, 'fixed source\n')
  git(child, ['add', 'file'])
  git(child, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  const pinned = git(child, ['rev-parse', 'HEAD'])
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${pinned},superagent`])
  const warnings = [], warn = message => warnings.push(message)
  writeFileSync(join(child, 'generated'), 'local build output')
  assert.equal(source.verifyPinnedSubmodule(root, 'superagent', warn), pinned)
  assert.equal(warnings.length, 0)
  writeFileSync(file, 'user modification\n')
  assert.equal(source.verifyPinnedSubmodule(root, 'superagent', warn), pinned)
  assert.match(warnings.pop(), /modified|changes/i)
  assert.equal(readFileSync(file, 'utf8'), 'user modification\n')
  git(child, ['add', 'file'])
  assert.equal(source.verifyPinnedSubmodule(root, 'superagent', warn), pinned)
  assert.match(warnings.pop(), /modified|changes/i)
  assert.equal(readFileSync(file, 'utf8'), 'user modification\n')
})

test('setup initializes an empty nested submodule at the recorded commit', (t) => {
  const { root, parent } = fixture(t)
  const remote = join(parent, 'remote')
  mkdirSync(remote)
  const git = (dir, args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim()
  git(remote, ['init', '-q'])
  writeFileSync(join(remote, 'file'), 'source\n')
  git(remote, ['add', 'file'])
  git(remote, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'])
  const pinned = git(remote, ['rev-parse', 'HEAD'])
  git(root, ['init', '-q'])
  writeFileSync(join(root, '.gitmodules'), `[submodule "surfcore"]\n\tpath = plugins/surfcore\n\turl = ${pathToFileURL(remote).href}\n\tshallow = true\n`)
  git(root, ['add', '.gitmodules'])
  git(root, ['update-index', '--add', '--cacheinfo', `160000,${pinned},plugins/surfcore`])
  source.prepareLocalDirectories(root)
  const env = { ...source.localEnvironment(root), GIT_ALLOW_PROTOCOL: 'file' }
  assert.equal(source.initializePinnedSubmodule(root, 'plugins/surfcore', env), pinned)
  assert.equal(readFileSync(join(root, 'plugins', 'surfcore', 'file'), 'utf8'), 'source\n')
})

test('setup leaves a nonempty non-submodule directory untouched', (t) => {
  const { root } = fixture(t)
  mkdirSync(join(root, 'superagent'))
  const file = join(root, 'superagent', 'user-file')
  writeFileSync(file, 'keep me')
  assert.throws(() => source.initializePinnedSubmodule(root, 'superagent'), /not empty/)
  assert.equal(readFileSync(file, 'utf8'), 'keep me')
})

test('startup registers the project root through the local DSH workspace API', async (t) => {
  const { root } = fixture(t)
  let requestBody
  let requestCookie
  const server = createServer((req, res) => {
    if (req.method === 'GET') {
      res.writeHead(302, { 'set-cookie': 'dsh_session=fixture; Path=/', location: '/' }).end()
      return
    }
    requestCookie = req.headers.cookie
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      requestBody = JSON.parse(body)
      res.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ result: { ok: true, value: { created: true } } }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const url = `http://127.0.0.1:${server.address().port}/?token=fixture`
  assert.equal(await source.ensureRootWorkspace(url, root), true)
  assert.equal(requestCookie, 'dsh_session=fixture')
  assert.equal(requestBody.method, 'workspace/create')
  assert.equal(requestBody.payload.args.request.path, root)
})

test('multiple build patches apply in order and restore in reverse', (t) => {
  const { root, target, patch } = patchFixture(t)
  const second = join(root, 'second.patch')
  writeFileSync(patch, '--- a/src/config.txt\n+++ b/src/config.txt\n@@ -1,2 +1,2 @@\n-before\n+middle\n unchanged\n')
  writeFileSync(second, '--- a/src/config.txt\n+++ b/src/config.txt\n@@ -1,2 +1,2 @@\n-middle\n+after\n unchanged\n')
  source.withTemporaryPatch(root, [patch, second], () => {
    assert.equal(readFileSync(target, 'utf8'), 'after\nunchanged\n')
  })
  assert.equal(readFileSync(target, 'utf8'), 'before\nunchanged\n')
})

test('a later patch failure restores the earlier patches', (t) => {
  const { root, target, patch } = patchFixture(t)
  const broken = join(root, 'broken.patch')
  writeFileSync(patch, '--- a/src/config.txt\n+++ b/src/config.txt\n@@ -1,2 +1,2 @@\n-before\n+middle\n unchanged\n')
  writeFileSync(broken, '--- a/src/config.txt\n+++ b/src/config.txt\n@@ -1,2 +1,2 @@\n-missing\n+after\n unchanged\n')
  assert.throws(() => source.withTemporaryPatch(root, [patch, broken], () => {}), /cannot apply.*patch/i)
  assert.equal(readFileSync(target, 'utf8'), 'before\nunchanged\n')
})

test('the patch manifest accepts only flat patch names', (t) => {
  const { root } = fixture(t)
  const manifest = join(root, 'patches.json')
  writeFileSync(manifest, JSON.stringify({ patches: ['one.patch', 'two.patch'] }))
  assert.deepEqual(source.patchManifest(manifest), ['one.patch', 'two.patch'])
  writeFileSync(manifest, JSON.stringify({ patches: ['../escape.patch'] }))
  assert.throws(() => source.patchManifest(manifest), /patch/i)
  writeFileSync(manifest, JSON.stringify({ patches: ['/absolute.patch'] }))
  assert.throws(() => source.patchManifest(manifest), /patch/i)
})

test('the project patch manifest applies twelve patches in order', () => {
  const root = resolve(import.meta.dirname, '..')
  const names = source.patchManifest(join(root, 'patches', 'superagent-patches.json'))
  assert.deepEqual(names, ['superagent-windows.patch', 'superagent-personal.patch', 'superagent-subject.patch', 'superagent-input.patch',
    'superagent-effects.patch', 'superagent-surfcore.patch', 'superagent-voice.patch', 'superagent-context.patch',
    'superagent-schedule.patch', 'superagent-schedule-panel.patch', 'superagent-voice-closeout.patch', 'superagent-dream.patch'])
  for (const name of names) assert.ok(existsSync(join(root, 'patches', name)), `${name} is missing`)
})
