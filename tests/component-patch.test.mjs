import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { applyComponentPatches, loadPins, PatchDriftError } from '../scripts/lib/surfcore-component-patch.mjs'

const root = resolve('.')
const sourceRoot = join(root, 'plugins', 'surfcore')

function fixture(t) {
  const parent = join(root, '.artifacts', 'test-tmp')
  mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'component-patch-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function copyPinnedSources(destination) {
  const pins = loadPins()
  for (const file of Object.keys(pins.sources)) {
    if (!file.startsWith('src/') && !file.startsWith('plugins/surfcore/')) continue
    const target = join(destination, file)
    mkdirSync(join(target, '..'), { recursive: true })
    if (existsSync(join(sourceRoot, file))) cpSync(join(sourceRoot, file), target)
  }
  return pins
}

test('component patches are generated from pinned sources with a verifiable manifest', t => {
  const dir = fixture(t), outDir = join(dir, 'patches')
  const first = applyComponentPatches({ sourceRoot, outDir, projectRoot: root })
  assert.equal(first.version, loadPins().patchVersion)
  assert.equal(first.files.length, 9)
  const manifest = JSON.parse(readFileSync(join(outDir, 'patched-manifest.json'), 'utf8'))
  assert.deepEqual(manifest.files, first.files)
  for (const file of first.files) {
    const output = readFileSync(join(outDir, file.path), 'utf8')
    assert.equal(createHash('sha256').update(output).digest('hex'), file.outputSha256, file.path)
    assert.ok(file.labels.length > 0)
  }
  const bridge = readFileSync(join(outDir, 'src/bridge.js'), 'utf8')
  assert.match(bridge, /hydrateSession/)
  assert.doesNotMatch(bridge, /from '\.\/voice-tts\.js'/)
  assert.match(bridge, /void ingestSurfcoreEvent\(\{ kind, id, key, event, text: textContent, plain: plainContent, isOwner, quoteTargetIsSelf \}\)/)
  const scheduler = readFileSync(join(outDir, 'plugins/surfcore/lib/scheduler.js'), 'utf8')
  assert.match(scheduler, /void ingestSurfcoreBiliEvents\(batch\)/)
  assert.match(scheduler, /［出站］发评论、回私信、发弹幕、发动态这类写操作已停用/)
  assert.doesNotMatch(scheduler, /所有命令都用这一条/)
  const labels = Object.fromEntries(first.files.map(file => [file.path, file.labels]))
  assert.ok(labels['src/bridge.js'].includes('bridge-surfcore-ingest'))
  assert.deepEqual(labels['plugins/surfcore/lib/scheduler.js'], ['scheduler-component-hooks', 'scheduler-bili-ingest', 'scheduler-egress-boundary'])
  const second = applyComponentPatches({ sourceRoot, outDir, projectRoot: root })
  assert.deepEqual(second.files.map(file => file.outputSha256), first.files.map(file => file.outputSha256))
})

test('component patches reject a changed pinned source before writing outputs', t => {
  const dir = fixture(t), copy = join(dir, 'surfcore')
  copyPinnedSources(copy)
  const bridge = join(copy, 'src/bridge.js')
  writeFileSync(bridge, `${readFileSync(bridge, 'utf8')}\n// local drift\n`)
  const outDir = join(dir, 'patches')
  assert.throws(() => applyComponentPatches({ sourceRoot: copy, outDir, projectRoot: root }), error => {
    assert.ok(error instanceof PatchDriftError)
    assert.equal(error.code, 'SURFCORE_PATCH_DRIFT')
    assert.match(error.message, /src\/bridge\.js sha256 mismatch/)
    return true
  })
  assert.equal(existsSync(join(outDir, 'patched-manifest.json')), false)
})

test('component patches report anchor drift with the failing labels', t => {
  const dir = fixture(t), copy = join(dir, 'surfcore')
  const pins = copyPinnedSources(copy)
  const file = join(copy, 'src/bridge.js')
  const changed = readFileSync(file, 'utf8').replace('function acquireLock() {\n', 'function acquireLock() { // drifted\n')
  writeFileSync(file, changed)
  const custom = { ...pins, sources: { ...pins.sources, 'src/bridge.js': createHash('sha256').update(changed).digest('hex') } }
  assert.throws(() => applyComponentPatches({ sourceRoot: copy, outDir: join(dir, 'patches'), pins: custom, projectRoot: root }), error => {
    assert.equal(error.code, 'SURFCORE_PATCH_DRIFT')
    assert.match(error.message, /src\/bridge\.js anchors no longer match/)
    assert.match(error.message, /bridge-component-imports/)
    return true
  })
})

test('the SurfCore ingest anchor is enforced when the bridge silent-mode gate no longer matches', t => {
  const dir = fixture(t), copy = join(dir, 'surfcore')
  const pins = copyPinnedSources(copy)
  const file = join(copy, 'src/bridge.js')
  const changed = readFileSync(file, 'utf8')
    .replace('      log(`静默模式，忽略群友消息 ${key}`);\n', '')
  assert.notEqual(changed, readFileSync(file, 'utf8'))
  writeFileSync(file, changed)
  const custom = { ...pins, sources: { ...pins.sources, 'src/bridge.js': createHash('sha256').update(changed).digest('hex') } }
  assert.throws(() => applyComponentPatches({ sourceRoot: copy, outDir: join(dir, 'patches'), pins: custom, projectRoot: root }), error => {
    assert.equal(error.code, 'SURFCORE_PATCH_DRIFT')
    assert.match(error.message, /src\/bridge\.js anchors no longer match/)
    return true
  })
})

test('the loader refuses stale generated patches and loads fresh ones', t => {
  const dir = fixture(t), copy = join(dir, 'plugins', 'surfcore'), outDir = join(dir, 'patches')
  copyPinnedSources(copy)
  applyComponentPatches({ sourceRoot: copy, outDir, projectRoot: dir })
  const module = join(copy, 'plugins', 'surfcore', 'tools', 'lib', 'state-paths.mjs')
  const loader = join(root, 'scripts', 'surfcore-loader.mjs'), home = join(dir, 'home')
  const env = { ...process.env, DSH_HOME: home, SURFCORE_LOCAL_SOURCE: copy, SURFCORE_COMPONENT_SPLIT: '1', SURFCORE_PATCH_DIR: outDir, NODE_OPTIONS: '' }
  const run = () => execFileSync(process.execPath, ['--import', pathToFileURL(loader).href, '--input-type=module', '-e', `import * as p from ${JSON.stringify(pathToFileURL(module).href)}; console.log(p.currentCharacter())`], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.equal(run().trim(), 'null')
  writeFileSync(module, `${readFileSync(module, 'utf8')}\n// stale\n`)
  assert.throws(run, error => {
    assert.match(String(error.stderr ?? error.message), /SURFCORE_PATCH_DRIFT/)
    return true
  })
})
