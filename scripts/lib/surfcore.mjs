import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { validateStateDirectory } from './source.mjs'
import { GENERATED_CLIENT_HEADER, renderSurfcorePanelClient } from './surfcore-panel.mjs'
import { applyComponentPatches } from './surfcore-component-patch.mjs'

function managedFile(file, contents) {
  const desired = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  if (existsSync(file)) {
    if (!readFileSync(file).equals(desired)) throw new Error(`Refusing to overwrite the existing SurfCore adapter file: ${file}`)
    return
  }
  writeFileSync(file, desired, { flag: 'wx' })
}

function sourceLink(target, link) {
  let existing
  try { existing = lstatSync(link) } catch (error) { if (error.code !== 'ENOENT') throw error }
  if (existing) {
    if (!existing.isSymbolicLink()) throw new Error(`The SurfCore adapter link points elsewhere: ${link}`)
    if (existsSync(link)) {
      if (realpathSync(link) !== realpathSync(target)) throw new Error(`The SurfCore adapter link points elsewhere: ${link}`)
      return
    }
    const old = readlinkSync(link).replaceAll('\\', '/')
    const suffix = `/plugins/surfcore/plugins/surfcore/${target.split(/[\\/]/).pop()}`
    if (!isAbsolute(readlinkSync(link)) || !old.endsWith(suffix)) {
      throw new Error(`The SurfCore adapter link points elsewhere: ${link}`)
    }
    const temp = `${link}.${randomUUID()}.tmp`
    try { symlinkSync(process.platform === 'win32' ? target : relative(dirname(link), target), temp, process.platform === 'win32' ? 'junction' : 'dir'); renameSync(temp, link) }
    catch (error) { try { unlinkSync(temp) } catch {}; throw error }
  } else {
    symlinkSync(process.platform === 'win32' ? target : relative(dirname(link), target), link, process.platform === 'win32' ? 'junction' : 'dir')
  }
}

function updateManagedFile(file, contents, acceptsPrevious) {
  const desired = Buffer.isBuffer(contents) ? contents : Buffer.from(contents)
  if (existsSync(file)) {
    if (!lstatSync(file).isFile()) throw new Error(`The SurfCore adapter file is not a regular file: ${file}`)
    const previous = readFileSync(file)
    if (previous.equals(desired)) return
    if (!acceptsPrevious(previous)) throw new Error(`Refusing to overwrite the existing SurfCore adapter file: ${file}`)
  }
  const temporary = `${file}.${randomUUID()}.tmp`
  writeFileSync(temporary, desired, { flag: 'wx' })
  renameSync(temporary, file)
}

/** Build a small metadata adapter; plugin code stays in the pinned source checkout. */
export function ensureSurfcoreAdapter(root, artifacts = join(root, '.artifacts', 'surfcore-adapter'), { splitComponents = false } = {}) {
  const project = resolve(root)
  const original = join(project, 'plugins', 'surfcore', 'plugins', 'surfcore')
  if (!validateStateDirectory(project, artifacts) || !validateStateDirectory(project, original)) {
    throw new Error('SurfCore adapter or source resolves outside the project.')
  }
  const bundle = join(artifacts, 'bundle')
  const qqMode = join(artifacts, 'qq-mode')
  if (!validateStateDirectory(project, bundle) || !validateStateDirectory(project, qqMode)) {
    throw new Error('A SurfCore adapter directory resolves outside the project.')
  }
  const originalPatch = readFileSync(join(original, 'cordis.patch.yml'), 'utf8')
  const oldEntry = 'name: ./lib/qq-mode.js'
  if (originalPatch.split(oldEntry).length !== 2) throw new Error('The pinned SurfCore bundle no longer matches the compatibility adapter.')
  mkdirSync(bundle, { recursive: true })
  mkdirSync(qqMode, { recursive: true })
  for (const name of ['lib', 'tools', 'presets', 'platforms', 'locale', 'extensions', 'persona']) {
    if (existsSync(join(original, name))) sourceLink(join(original, name), join(bundle, name))
  }
  for (const name of ['icon.svg', 'qq-tool-restrict.mjs']) {
    if (existsSync(join(original, name))) managedFile(join(bundle, name), readFileSync(join(original, name)))
  }
  const originalManifest = readFileSync(join(original, 'package.json'))
  const manifest = JSON.parse(originalManifest.toString('utf8'))
  const client = renderSurfcorePanelClient(readFileSync(join(original, 'lib', 'client.js'), 'utf8'), { splitComponents })
  const clientName = 'surfcore-panel.client.js'
  updateManagedFile(join(bundle, clientName), client, previous => previous.toString('utf8').startsWith(GENERATED_CLIENT_HEADER))
  manifest.exports['./client'] = `./${clientName}`
  const previousPanelManifest = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  // DSH identifies a client by the resolved host module's nearest package.json.
  // A host wrapper keeps that lookup in this adapter while executing upstream.
  const hostName = 'surfcore-host.mjs'
  const hostHeader = '// Generated SurfCore host adapter; the implementation lives in the pinned submodule.\n'
  const hostSource = pathToFileURL(join(original, 'lib', 'index.js')).href
  const host = `${hostHeader}export * from ${JSON.stringify(hostSource)}\nexport { default } from ${JSON.stringify(hostSource)}\n`
  updateManagedFile(join(bundle, hostName), host, previous => previous.toString('utf8').startsWith(hostHeader))
  manifest.main = `./${hostName}`
  manifest.exports['.'] = `./${hostName}`
  updateManagedFile(join(bundle, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`,
    previous => previous.equals(originalManifest) || previous.equals(previousPanelManifest))
  managedFile(join(bundle, 'cordis.patch.yml'), originalPatch.replace(oldEntry, 'name: surfcore-local-qq-mode'))
  managedFile(join(qqMode, 'package.json'), `${JSON.stringify({ name: 'surfcore-local-qq-mode', private: true, type: 'module', main: './index.mjs' }, null, 2)}\n`)
  const source = pathToFileURL(join(original, 'lib', 'qq-mode.js')).href
  updateManagedFile(join(qqMode, 'index.mjs'), `export * from ${JSON.stringify(source)}\n`, previous => {
    const match = /^export \* from ("[^\r\n]+")\r?\n$/.exec(previous.toString('utf8'))
    if (!match) return false
    try {
      const old = fileURLToPath(JSON.parse(match[1]))
      return old.replaceAll('\\', '/').endsWith('/plugins/surfcore/plugins/surfcore/lib/qq-mode.js') && !existsSync(old)
    } catch { return false }
  })
  if (splitComponents) {
    applyComponentPatches({ sourceRoot: join(project, 'plugins', 'surfcore'), outDir: join(artifacts, 'patches'), projectRoot: project })
  }
  return { bundle, qqMode }
}

/** Isolate plugin state without changing the caller's shell or HOME. */
export function surfcoreEnvironment(root, parent = process.env, { splitComponents = false } = {}) {
  const projectRoot = resolve(root)
  const source = join(projectRoot, 'plugins', 'surfcore')
  const hook = pathToFileURL(join(projectRoot, 'scripts', 'surfcore-loader.mjs')).href
  const home = parent.DSH_HOME && isAbsolute(parent.DSH_HOME) ? resolve(parent.DSH_HOME) : join(projectRoot, '.artifacts', 'dsh-home')
  const memory = join(home, 'memory'), voice = join(home, 'voice')
  return {
    ...parent,
    SURFCORE_LOCAL_SOURCE: source,
    SURFCORE_ROOT: source,
    SURFCORE_QQBOT_ROOT: source,
    SURFCORE_SKIP_AUTOSTART: '1',
    SURFCORE_DISABLE_CHARACTER_MIGRATION: '1',
    SURFCORE_DISABLE_MEMORY_TIMER: '1',
    SURFCORE_DISABLE_PLATFORM_RESTART: '1',
    SURFCORE_COMPONENT_SPLIT: splitComponents ? '1' : '0',
    SURFCORE_BILI_CONFIG: join(home, 'surfcore', 'bili.config.json'),
    DSH_MEMORY_STATE_DIR: parent.DSH_MEMORY_STATE_DIR || memory,
    DSH_VOICE_STATE_DIR: parent.DSH_VOICE_STATE_DIR || voice,
    DSH_QQ_PUBLIC_FEED: parent.DSH_QQ_PUBLIC_FEED || join(memory, 'inbox', 'qq-public-feed.jsonl'),
    DSH_BILI_DYNAMICS_CACHE: parent.DSH_BILI_DYNAMICS_CACHE || join(memory, 'data', 'bili-dynamics-cache.json'),
    DSH_ALIGNMENTS_FILE: parent.DSH_ALIGNMENTS_FILE || join(memory, 'inbox', 'alignments.json'),
    DSH_SESSION_LEGACY_FILE: parent.DSH_SESSION_LEGACY_FILE || join(memory, 'inbox', 'social-v2.json'),
    SURFCORE_CONFIG_FILE: parent.SURFCORE_CONFIG_FILE || join(source, 'config.json'),
    SURFCORE_CONSOLE_TOKEN_FILE: parent.SURFCORE_CONSOLE_TOKEN_FILE || join(source, 'state', 'console-token'),
    NODE_OPTIONS: [parent.NODE_OPTIONS, `--import=${hook}`].filter(Boolean).join(' '),
  }
}
