import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  renderAlignmentSource, renderBiliShareSource, renderBiliStatePathsSource, renderBridgeSource,
  renderCharacterSource, renderDmAwaitSource, renderHostSource, renderHostWorkdirSource,
  renderMsgfeedSource, renderSchedulerSource,
} from './surfcore-runtime-transform.mjs'

export const PINS_FILE = fileURLToPath(new URL('./surfcore-component-pins.json', import.meta.url))

export class PatchDriftError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'SurfCorePatchDrift'
    this.code = 'SURFCORE_PATCH_DRIFT'
  }
}

function drift(message, cause) { return new PatchDriftError(`SURFCORE_PATCH_DRIFT: ${message}`, cause) }
function sha256(value) { return createHash('sha256').update(value).digest('hex') }

function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error(`anchor not found exactly once: ${before.slice(0, 120)}`)
  return source.replace(before, after)
}

function renderHostBootSource(source) {
  let result = source
  result = replaceOnce(result, 'try { resumePendingApply({ stateDir: STATE_DIR, pluginLog }); }',
    "try { if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') resumePendingApply({ stateDir: STATE_DIR, pluginLog }); }")
  result = replaceOnce(result, '  startSchedulerNow();\n\n  // 管理员称呼',
    "  if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') startSchedulerNow();\n\n  // 管理员称呼")
  result = replaceOnce(result, 'enabled: updCfg.enabled !== false && updCfg.checkOnStart !== false,',
    "enabled: process.env.SURFCORE_SKIP_AUTOSTART !== '1' && updCfg.enabled !== false && updCfg.checkOnStart !== false,")
  result = replaceOnce(result, '  ensureAdminProjection();',
    "  if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') ensureAdminProjection();")
  return replaceOnce(result, 'try { petPurpose.start(); }',
    "try { if (process.env.SURFCORE_SKIP_AUTOSTART !== '1') petPurpose.start(); }")
}

export function loadPins() {
  return JSON.parse(readFileSync(PINS_FILE, 'utf8'))
}

const targets = [
  { path: 'src/bridge.js', labels: ['bridge-component-imports', 'bridge-memory-context', 'bridge-voice-pipeline', 'bridge-session-memory', 'bridge-role-decoupling', 'bridge-surfcore-ingest'], render: (source, ctx) => renderBridgeSource(source, ctx.hooksUrl, ctx.memoryEngineUrl) },
  { path: 'src/bili-share-scheduler.js', labels: ['bili-share-scheduler'], render: source => renderBiliShareSource(source) },
  { path: 'src/character-persona.js', labels: ['character-role-decoupling'], render: source => renderCharacterSource(source) },
  { path: 'plugins/surfcore/lib/index.js', labels: ['host-memory-voice-delegation', 'host-boot-gates', 'host-workdir-paths'], render: source => renderHostSource(renderHostWorkdirSource(renderHostBootSource(source))) },
  { path: 'plugins/surfcore/lib/scheduler.js', labels: ['scheduler-component-hooks', 'scheduler-bili-ingest', 'scheduler-egress-boundary'], render: (source, ctx) => renderSchedulerSource(source, ctx.hooksUrl) },
  { path: 'plugins/surfcore/lib/align.js', labels: ['alignment-component'], render: source => renderAlignmentSource(source) },
  { path: 'plugins/surfcore/tools/commands/dm-await.mjs', labels: ['dm-await-component'], render: source => renderDmAwaitSource(source) },
  { path: 'plugins/surfcore/tools/lib/msgfeed.mjs', labels: ['msgfeed-component'], render: source => renderMsgfeedSource(source) },
  { path: 'plugins/surfcore/tools/lib/state-paths.mjs', labels: ['bili-state-paths'], render: source => renderBiliStatePathsSource(source) },
]

const byPath = new Map(targets.map(target => [target.path, target]))

function context(projectRoot) {
  return {
    projectRoot,
    hooksUrl: pathToFileURL(join(projectRoot, 'scripts', 'lib', 'surfcore-bridge-hooks.mjs')).href,
    memoryEngineUrl: pathToFileURL(join(projectRoot, 'plugins', 'memory', 'src', 'card-engine.mjs')).href,
  }
}

function verifyPinnedCommit(sourceRoot, pins) {
  if (!existsSync(join(sourceRoot, '.git'))) return null
  let head
  try { head = execFileSync('git', ['-C', sourceRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() }
  catch { return null }
  if (head !== pins.submodule?.commit) {
    throw drift(`pinned SurfCore commit changed: expected ${pins.submodule?.commit}, found ${head}. Update scripts/lib/surfcore-component-pins.json after running npm run setup:surfcore.`)
  }
  return head
}

function renderTarget(target, source, ctx, pins) {
  const expected = pins.sources?.[target.path]
  if (!expected) throw drift(`${target.path} is not pinned in ${PINS_FILE}`)
  const actual = sha256(source)
  if (actual !== expected) {
    throw drift(`${target.path} sha256 mismatch: expected ${expected}, found ${actual}. The pinned SurfCore checkout changed; re-pin and re-check the component patches.`)
  }
  try {
    return target.render(source, ctx)
  } catch (error) {
    throw drift(`${target.path} anchors no longer match (${target.labels.join(', ')}): ${error?.message ?? error}`, error)
  }
}

/** Apply every component patch to the pinned source and record hashes in patched-manifest.json. */
export function applyComponentPatches({ sourceRoot, outDir, pins = loadPins(), projectRoot } = {}) {
  const root = resolve(sourceRoot)
  const project = resolve(projectRoot ?? join(root, '..', '..'))
  const destinationRoot = resolve(outDir)
  const ctx = context(project)
  const commit = verifyPinnedCommit(root, pins)
  const files = []
  for (const target of targets) {
    const source = readFileSync(join(root, target.path), 'utf8')
    const output = renderTarget(target, source, ctx, pins)
    const destination = join(destinationRoot, target.path)
    mkdirSync(dirname(destination), { recursive: true })
    const temporary = `${destination}.tmp`
    writeFileSync(temporary, output)
    renameSync(temporary, destination)
    files.push({ path: target.path, labels: target.labels, sourceSha256: sha256(source), outputSha256: sha256(output), bytes: Buffer.byteLength(output) })
  }
  const manifest = {
    version: pins.patchVersion,
    submodule: { ...pins.submodule, verifiedCommit: commit },
    generatedAt: new Date().toISOString(),
    hooksUrl: ctx.hooksUrl,
    memoryEngineUrl: ctx.memoryEngineUrl,
    files,
  }
  writeFileSync(join(destinationRoot, 'patched-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return manifest
}

/** Loader fallback for development runs where the build has not generated patches yet. */
export function renderPatchedSource(relativeFile, source, { projectRoot, pins = loadPins() } = {}) {
  const target = byPath.get(relativeFile.replaceAll('\\', '/'))
  if (!target) return null
  return renderTarget(target, source, context(resolve(projectRoot)), pins)
}
