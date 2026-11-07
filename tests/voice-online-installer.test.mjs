import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const file = resolve('plugins/voice/src/online-installer.mjs')
function workspace(t) {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-online-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('online installation publishes a prepared pack only after all stages succeed', async t => {
  assert.ok(existsSync(file), 'online voice installer must exist')
  const { createOnlineVoiceInstaller } = await import(pathToFileURL(file).href)
  const dir = workspace(t), calls = []
  const install = createOnlineVoiceInstaller({ stateDir: dir, platform: 'win32',
    stageSource: async ({ destination }) => {
      mkdirSync(destination, { recursive: true }); mkdirSync(join(destination, 'scripts'))
      writeFileSync(join(destination, 'config.example.toml'), '[server]\nport = 8767\n[engine]\nprimary = "cloud"\ncloud_access_key = "untrusted-key"\n')
      writeFileSync(join(destination, 'models.json'), JSON.stringify({ archives: [{ name: 'models.tar.gz', url: 'https://github.com/Mieksido/surfvoicecloud/releases/download/v0.1.0/models.tar.gz', sha256: 'a'.repeat(64), size: 4, dest: 'models' }] }))
      calls.push('source')
    },
    downloadAsset: async ({ destination }) => { mkdirSync(resolve(destination, '..'), { recursive: true }); writeFileSync(destination, 'data'); calls.push('download') },
    extract: async ({ destination }) => { writeFileSync(join(destination, 'model.bin'), 'model'); calls.push('extract') },
    bootstrap: async ({ destination }) => { mkdirSync(join(destination, '.venv/Scripts'), { recursive: true }); writeFileSync(join(destination, '.venv/Scripts/python.exe'), 'fixture'); calls.push('bootstrap') },
  })
  assert.equal((await install.start('voice-cloud')).ok, true)
  await install.wait('voice-cloud')
  const status = install.status('voice-cloud')
  assert.equal(status.phase, '完成')
  assert.deepEqual(calls, ['source', 'download', 'extract', 'bootstrap'])
  assert.equal(readFileSync(join(dir, 'packs/voice-cloud/models/model.bin'), 'utf8'), 'model')
  assert.equal(JSON.parse(readFileSync(join(dir, 'packs/voice-cloud/voices/age12-cloud/voice.json'), 'utf8')).engine, 'cloud')
  assert.doesNotMatch(readFileSync(join(dir, 'packs/voice-cloud/config.toml'), 'utf8'), /untrusted-key/)
  await assert.rejects(install.start('voice-cloud'), /已存在|已经安装/)
})

test('cancelled installation does not replace an existing pack or publish a partial pack', async t => {
  assert.ok(existsSync(file), 'online voice installer must exist')
  const { createOnlineVoiceInstaller } = await import(pathToFileURL(file).href)
  const dir = workspace(t)
  let entered
  const ready = new Promise(resolve => { entered = resolve })
  const install = createOnlineVoiceInstaller({ stateDir: dir, platform: 'win32', stageSource: async ({ destination, signal }) => {
    mkdirSync(destination, { recursive: true }); entered()
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Install cancelled')), { once: true }))
  } })
  await install.start('voice-cloud'); await ready
  assert.equal(install.cancel('voice-cloud').ok, true)
  await install.wait('voice-cloud')
  assert.equal(install.status('voice-cloud').phase, '已取消')
  assert.equal(existsSync(join(dir, 'packs/voice-cloud')), false)
})

test('installer refuses a download directory symlink before creating anything outside its state directory', async t => {
  const { createOnlineVoiceInstaller } = await import(pathToFileURL(file).href)
  const dir = workspace(t), state = join(dir, 'state'), outside = join(dir, 'outside')
  mkdirSync(state); mkdirSync(outside); symlinkSync(outside, join(state, 'downloads'), process.platform === 'win32' ? 'junction' : 'dir')
  const install = createOnlineVoiceInstaller({ stateDir: state, platform: 'win32' })
  await assert.rejects(async () => install.start('voice-cloud'), /符号链接|项目外/)
  assert.equal(existsSync(join(outside, 'voice-cloud')), false)
})

test('staged voice configuration is rewritten for its final project-local location', async t => {
  const { prepareRelocatedConfig } = await import(pathToFileURL(file).href)
  const dir = workspace(t), stage = join(dir, 'stage with space'), target = join(dir, 'packs', 'voice-cloud')
  mkdirSync(stage)
  const oldPath = join(stage, '.venv', 'ffmpeg.exe').replaceAll('\\', '/')
  writeFileSync(join(stage, 'config.toml'), `[ffmpeg]\npath = "${oldPath}"\n`)
  prepareRelocatedConfig(stage, target)
  const text = readFileSync(join(stage, 'config.toml'), 'utf8')
  assert.match(text, /packs\/voice-cloud\/\.venv\/ffmpeg\.exe/)
  assert.equal(text.includes(oldPath), false)
})

test('project bootstrap resolves an installation path containing spaces', async t => {
  const { prepareProjectBootstrap } = await import(pathToFileURL(file).href)
  const { runInstallCommand } = await import('../plugins/voice/src/install-runner.mjs')
  const dir = workspace(t), stage = join(dir, 'stage with space')
  mkdirSync(join(stage, 'scripts'), { recursive: true })
  const program = "import path from 'node:path';\nconst root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, '$1')), '..');\nconsole.log(root);\n"
  writeFileSync(join(stage, 'scripts/bootstrap-env.mjs'), program)
  const script = prepareProjectBootstrap(stage)
  let output = ''
  await runInstallCommand({ root: dir, cwd: stage, command: process.execPath, args: [script], onOutput: text => { output += text } })
  assert.equal(output.trim(), stage)
})

test('cloud bootstrap skips the local-only GPT-SoVITS environment', async t => {
  const { prepareProjectBootstrap } = await import(pathToFileURL(file).href)
  const { runInstallCommand } = await import('../plugins/voice/src/install-runner.mjs')
  const dir = workspace(t), stage = join(dir, 'cloud')
  mkdirSync(join(stage, 'scripts'), { recursive: true })
  writeFileSync(join(stage, 'requirements-gsv.txt'), 'local only')
  const program = "import path from 'node:path'; import fs from 'node:fs';\nconst root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, '$1')), '..');\nconst reqGsv=path.join(root,'requirements-gsv.txt'); if (fs.existsSync(reqGsv)) console.log('gsv installed');\nconsole.log('cloud ready');\n"
  writeFileSync(join(stage, 'scripts/bootstrap-env.mjs'), program)
  const script = prepareProjectBootstrap(stage, 'voice-cloud')
  let output = ''
  await runInstallCommand({ root: dir, cwd: stage, command: process.execPath, args: [script], onOutput: text => { output += text } })
  assert.match(output, /cloud ready/)
  assert.doesNotMatch(output, /gsv installed/)
})

test('cleaning installer residues moves only the selected pack files into a recoverable backup', async t => {
  const { createOnlineVoiceInstaller } = await import(pathToFileURL(file).href)
  const dir = workspace(t)
  const downloads = join(dir, 'downloads/voice-cloud'), unrelated = join(dir, 'downloads/voice-local')
  mkdirSync(downloads, { recursive: true }); mkdirSync(unrelated, { recursive: true })
  writeFileSync(join(downloads, 'models.tar.gz.part'), 'partial')
  writeFileSync(join(unrelated, 'keep.part'), 'other pack')
  const install = createOnlineVoiceInstaller({ stateDir: dir, platform: 'win32' })
  const result = install.cleanup('voice-cloud')
  assert.equal(result.ok, true)
  assert.equal(readFileSync(join(dir, 'installer-backups', result.backup, 'downloads/models.tar.gz.part'), 'utf8'), 'partial')
  assert.equal(readFileSync(join(unrelated, 'keep.part'), 'utf8'), 'other pack')
  assert.equal(existsSync(downloads), false)
})

test('the real bootstrap selects only the project-local Python runtime', async t => {
  const { prepareProjectBootstrap } = await import(pathToFileURL(file).href)
  const dir = workspace(t), stage = join(dir, 'stage')
  mkdirSync(join(stage, 'scripts'), { recursive: true })
  const upstream = "#!/usr/bin/env node\nimport path from 'node:path'; import fs from 'node:fs';\nconst root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\\/([A-Za-z]:)/, '$1')), '..');\nfunction findPythons() { return [['py', ['-3.13', '--version']]]; }\nfunction pickPython(list) { return list[0]; }\nconst reqGsv = ''; if (fs.existsSync(reqGsv)) {}\n"
  writeFileSync(join(stage, 'scripts/bootstrap-env.mjs'), upstream)
  const adapted = readFileSync(prepareProjectBootstrap(stage, 'voice-cloud', { localPython: true }), 'utf8')
  assert.match(adapted, /runtime.*python.*python\.exe/)
  assert.doesNotMatch(adapted, /\['py', \['-3\.13', '--version'\]\]/)
  const { spawnSync } = await import('node:child_process')
  assert.equal(spawnSync(process.execPath, ['--check', join(stage, 'scripts/bootstrap-project.mjs')]).status, 0)
})

test('venv configuration points at the published project-local Python', async t => {
  const { prepareRelocatedVenv } = await import(pathToFileURL(file).href)
  const dir = workspace(t), stage = join(dir, 'stage'), target = join(dir, 'packs', 'voice-cloud')
  mkdirSync(join(stage, '.venv'), { recursive: true })
  writeFileSync(join(stage, '.venv/pyvenv.cfg'), `home = ${stage}/runtime/python\nexecutable = ${stage}/runtime/python/python.exe\ninclude-system-site-packages = false\n`)
  prepareRelocatedVenv(stage, target)
  const result = readFileSync(join(stage, '.venv/pyvenv.cfg'), 'utf8')
  assert.ok(result.includes(target))
  assert.equal(result.includes(stage), false)
})
