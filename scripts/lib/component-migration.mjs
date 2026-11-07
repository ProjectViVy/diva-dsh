import {
  chmodSync, closeSync, constants, copyFileSync, existsSync, linkSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, readdirSync, renameSync, rmSync, statfsSync, writeFileSync,
} from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { validateStateDirectory } from './source.mjs'

const validId = /^[a-z0-9][a-z0-9_-]{0,39}$/
const memoryNames = /^(?:memory-card(?:[-.].*)?|memory-inbox\.jsonl(?:\.\d+)?|qq-for-bili\.md|bili-for-qq\.md|sync-state\.json)$/
const biliBridgeStateNames = ['bili-share-state.json', 'bili-dynamics-state.json', 'bili-dynamics-cache.json']

function checkedPath(root, file) {
  const path = resolve(file)
  const rel = relative(root, path)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Path is outside the project: ${file}`)
  let cursor = root
  for (const part of rel.split(sep)) {
    cursor = join(cursor, part)
    try { if (lstatSync(cursor).isSymbolicLink()) throw new Error(`Refusing symlink: ${cursor}`) }
    catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return path
}

function tree(root, source) {
  checkedPath(root, source)
  if (!existsSync(source)) return []
  const stat = lstatSync(source)
  if (stat.isDirectory()) return readdirSync(source).sort().flatMap(name => tree(root, join(source, name)))
  if (!stat.isFile()) throw new Error(`Unsupported migration item: ${source}`)
  return [{ source, size: stat.size }]
}

function digest(file) {
  const hash = createHash('sha256')
  const fd = openSync(file, 'r')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null)
      if (!count) break
      hash.update(buffer.subarray(0, count))
    }
  } finally { closeSync(fd) }
  return hash.digest('hex')
}

function copyVerified(source, destination) {
  mkdirSync(dirname(destination), { recursive: true, mode: 0o700 })
  copyFileSync(source, destination, constants.COPYFILE_EXCL)
  chmodSync(destination, 0o600 | (lstatSync(source).mode & 0o100))
  const before = digest(source)
  const after = digest(destination)
  if (before !== after) throw new Error(`Backup verification failed: ${source}`)
  return before
}

function jsonFile(file, fallback = {}) {
  if (!existsSync(file)) return fallback
  try { return JSON.parse(readFileSync(file, 'utf8')) }
  catch { throw new Error(`Invalid JSON in migration source: ${file}`) }
}

function writeJson(file, value) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
}

function legacyCardBackups(root, oldHome) {
  const source = join(oldHome, 'backups')
  return tree(root, source).filter(item => {
    const name = relative(source, item.source)
    return /^memory-card-(?!full|prompt)[a-zA-Z0-9._-]+\.json$/.test(name)
  })
}

function copyLegacyCardBackups(root, oldHome, memoryTarget) {
  const source = join(oldHome, 'backups')
  const items = legacyCardBackups(root, oldHome)
  if (!items.length) return 0
  const target = checkedPath(root, join(memoryTarget, 'backups'))
  mkdirSync(target, { recursive: true, mode: 0o700 })
  for (const item of items) {
    const name = relative(source, item.source).slice('memory-card-'.length)
    const file = checkedPath(root, join(target, `memory-card-legacy-unattributed-${name}`))
    if (existsSync(file)) {
      if (!lstatSync(file).isFile() || digest(file) !== digest(item.source)) throw new Error(`Legacy memory backup conflict: ${file}`)
    } else copyVerified(item.source, file)
  }
  return items.length
}

function recoverBiliBridgeState(root, oldHome, memoryTarget) {
  for (const name of biliBridgeStateNames) {
    const target = checkedPath(root, join(root, 'plugins', 'surfcore', 'state', name))
    if (existsSync(target)) continue
    const source = checkedPath(root, name === 'bili-dynamics-cache.json' ? join(memoryTarget, 'data', name) : join(oldHome, 'bili', name))
    if (existsSync(source)) {
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 })
      const staged = checkedPath(root, join(dirname(target), `.bili-state-${randomUUID()}.tmp`))
      try {
        copyVerified(source, staged)
        try { linkSync(staged, target) } catch (error) { if (error.code !== 'EEXIST') throw error }
      } finally { rmSync(staged, { force: true }) }
    }
  }
}

/** Repair paths in copied packs before publishing; original files and backup stay untouched. */
function relocateVoicePacks(stagedPacks, oldPacks, finalPacks) {
  if (!existsSync(stagedPacks)) return
  for (const entry of readdirSync(stagedPacks, { withFileTypes: true })) {
    if (!entry.isDirectory() || !validId.test(entry.name)) continue
    const stage = join(stagedPacks, entry.name), source = join(oldPacks, entry.name), target = join(finalPacks, entry.name)
    for (const [venv, version] of [['.venv', '313'], ['.venv-gsv', '312']]) {
      const config = join(stage, venv, 'pyvenv.cfg'), runtime = join(stage, 'runtime', `python${version}`, 'python.exe')
      if (!existsSync(config) || !existsSync(runtime)) continue
      const original = readFileSync(config, 'utf8')
      const home = join(target, 'runtime', `python${version}`).replaceAll('\\', '/')
      if (!/^[ \t]*home[ \t]*=/m.test(original)) throw new Error(`Voice environment has no home field: ${config}`)
      let updated = original.replace(/^[ \t]*home[ \t]*=.*$/m, `home = ${home}`)
      if (/^[ \t]*executable[ \t]*=/m.test(updated)) updated = updated.replace(/^[ \t]*executable[ \t]*=.*$/m, `executable = ${home}/python.exe`)
      else updated = `${updated.trimEnd()}\nexecutable = ${home}/python.exe\n`
      writeFileSync(config, updated, { mode: 0o600 })
    }
    const config = join(stage, 'config.toml')
    if (!existsSync(config)) continue
    const original = readFileSync(config, 'utf8')
    const oldPath = source.replaceAll('\\', '/'), newPath = target.replaceAll('\\', '/')
    const updated = original.replaceAll(`${oldPath}/`, `${newPath}/`)
    if (updated !== original) writeFileSync(config, updated, { mode: 0o600 })
  }
}

/** Copy old state into new component directories. Call only while the service is stopped. */
export function migrateComponents(projectRoot) {
  const root = resolve(projectRoot)
  const artifacts = checkedPath(root, join(root, '.artifacts'))
  if (!validateStateDirectory(root, artifacts)) throw new Error('Artifacts resolve outside the project')
  mkdirSync(artifacts, { recursive: true, mode: 0o700 })
  const lock = checkedPath(root, join(artifacts, 'component-migration.lock'))
  try { mkdirSync(lock, { mode: 0o700 }) }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Component migration is already running or needs recovery'); throw error }
  try {
    const home = checkedPath(root, join(artifacts, 'dsh-home'))
    const voiceTarget = checkedPath(root, join(home, 'voice'))
    const memoryTarget = checkedPath(root, join(home, 'memory'))
    const oldHome = join(home, 'surfcore')
    const marker = checkedPath(root, join(artifacts, 'component-migration.json'))
    if (existsSync(marker)) {
      if (!existsSync(voiceTarget) || !existsSync(memoryTarget)) throw new Error('Completed migration is missing a component directory')
      copyLegacyCardBackups(root, oldHome, memoryTarget)
      recoverBiliBridgeState(root, oldHome, memoryTarget)
      return { alreadyMigrated: true, ...jsonFile(marker) }
    }
    if (existsSync(voiceTarget) || existsSync(memoryTarget)) throw new Error('Component destination already exists; it was left untouched')

    const oldSource = join(root, 'plugins', 'surfcore')
    const profile = join(home, 'profiles', 'superagent-local')
    const backupRoots = [oldHome, join(oldSource, 'state'), join(oldSource, 'roles'), join(oldSource, 'config.json'),
      join(profile, 'package.json'), join(profile, 'cordis.patch.yml'), join(profile, 'cordis.yml'), join(profile, 'pnpm-lock.yaml')]
    const unified = jsonFile(join(oldHome, 'config.json'))
    const qqConfigFile = join(oldSource, 'config.json')
    const qq = jsonFile(qqConfigFile)
    // The old bridge read its voice settings from QQ's config, not the unified store.
    const oldVoice = existsSync(qqConfigFile) ? (qq.socialV2?.voice ?? {}) : (unified.socialV2?.voice ?? {})
    const currentFile = join(oldHome, 'characters', 'current.json')
    const current = jsonFile(currentFile)
    if (current.id && (!validId.test(current.id) || !existsSync(join(oldHome, 'characters', current.id)))) throw new Error('Current character is invalid or missing')
    const oldMemory = current.id ? join(oldHome, 'characters', current.id, 'memory') : join(oldHome, 'memory')
    const memoryFiles = tree(root, oldMemory).filter(item => memoryNames.test(relative(oldMemory, item.source)))
    const biliState = current.id ? join(oldHome, 'characters', current.id, 'bili') : join(oldSource, 'state')
    const biliFiles = tree(root, biliState)
    const isBiliMemory = item => /^(?:bili-memory\.json|bili-memory\.md|bili-memory-brief\.md|bili-video-titles\.json|bili-dynamics-cache\.json|bili-share-history\.json)$/.test(relative(biliState, item.source))
    const biliMemoryFiles = biliFiles.filter(isBiliMemory)
    const platformTarget = join(oldHome, 'bili')
    const platformFiles = current.id ? biliFiles.filter(item => !isBiliMemory(item)) : []
    const platformCopies = []
    for (const item of platformFiles) {
      const target = checkedPath(root, join(platformTarget, relative(biliState, item.source)))
      if (existsSync(target)) {
        if (!lstatSync(target).isFile() || digest(target) !== digest(item.source)) throw new Error(`Platform state conflict; original files were left untouched: ${target}`)
      } else platformCopies.push({ ...item, target })
    }
    const bridgeCopies = []
    if (current.id) for (const name of biliBridgeStateNames) {
      const item = biliFiles.find(file => relative(biliState, file.source) === name)
      if (!item) continue
      const target = checkedPath(root, join(oldSource, 'state', name))
      if (existsSync(target)) {
        if (!lstatSync(target).isFile() || digest(target) !== digest(item.source)) throw new Error(`QQ bridge state conflict; original files were left untouched: ${target}`)
      } else bridgeCopies.push({ ...item, target })
    }
    const memoryExtras = []
    for (const [name, candidates] of [
      ['qq-public-feed.jsonl', [join(oldHome, 'qq-public-feed.jsonl'), join(oldSource, 'state', 'qq-public-feed.jsonl')]],
      ['social-v2.json', [join(oldHome, 'social-v2.json'), join(oldSource, 'state', 'social-v2.json')]],
      ['alignments.json', [join(oldHome, 'alignments.json')]],
    ]) {
      const source = candidates.find(file => existsSync(file))
      if (!source) continue
      const stat = lstatSync(source)
      if (!stat.isFile()) throw new Error(`Unsupported migration item: ${source}`)
      memoryExtras.push({ name, source, size: stat.size })
    }
    const configuredPacks = qq.voicePacks?.dir
    const packs = configuredPacks ? checkedPath(root, resolve(oldSource, String(configuredPacks))) : join(oldSource, 'state', 'voice-packs')
    const voiceFiles = tree(root, packs)
    const voiceFilePaths = new Set(voiceFiles.map(item => item.source))
    const migratedVoice = { ...oldVoice }
    delete migratedVoice.dir
    for (const key of ['ffmpegPath', 'ffprobePath']) {
      if (typeof oldVoice[key] !== 'string' || !oldVoice[key].trim()) continue
      const source = resolve(oldSource, oldVoice[key])
      if (voiceFilePaths.has(source)) migratedVoice[key] = relative(oldSource, join(voiceTarget, 'packs', relative(packs, source)))
    }
    const audioDir = checkedPath(root, resolve(oldSource, String(oldVoice.dir ?? 'audio')))
    const audioFiles = tree(root, audioDir)
    const backupFiles = [...new Map([...backupRoots.flatMap(item => tree(root, item)), ...voiceFiles, ...audioFiles, ...memoryExtras].map(item => [item.source, item])).values()]
    const bytes = [...backupFiles, ...memoryFiles, ...memoryExtras, ...biliMemoryFiles, ...platformCopies, ...bridgeCopies, ...voiceFiles, ...audioFiles, ...legacyCardBackups(root, oldHome)].reduce((sum, item) => sum + item.size, 0)
    const space = statfsSync(artifacts)
    if (Number(space.bavail) * Number(space.bsize) < bytes + 1024 * 1024) throw new Error('Not enough project disk space for migration and backup')

    const id = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`
    const backup = checkedPath(root, join(artifacts, 'backups', `component-migration-${id}`))
    const stage = checkedPath(root, join(artifacts, 'migrations', id))
    mkdirSync(backup, { recursive: true, mode: 0o700 })
    mkdirSync(stage, { recursive: true, mode: 0o700 })
    const manifest = []
    for (const item of backupFiles) {
      const rel = relative(root, item.source)
      manifest.push({ path: rel, bytes: item.size, sha256: copyVerified(item.source, join(backup, rel)) })
    }
    writeJson(join(backup, 'manifest.json'), { createdAt: new Date().toISOString(), files: manifest })
    const stagedVoice = join(stage, 'voice')
    const stagedMemory = join(stage, 'memory')
    mkdirSync(stagedVoice, { recursive: true, mode: 0o700 })
    mkdirSync(stagedMemory, { recursive: true, mode: 0o700 })
    copyLegacyCardBackups(root, oldHome, stagedMemory)
    for (const item of memoryFiles) copyVerified(item.source, join(stagedMemory, 'data', relative(oldMemory, item.source)))
    for (const item of memoryExtras) copyVerified(item.source, join(stagedMemory, 'inbox', item.name))
    for (const item of biliMemoryFiles) copyVerified(item.source, join(stagedMemory, 'data', relative(biliState, item.source)))
    for (const item of platformCopies) copyVerified(item.source, join(stage, 'bili', relative(biliState, item.source)))
    for (const item of bridgeCopies) copyVerified(item.source, join(stage, 'qq-bili', relative(biliState, item.source)))
    for (const item of voiceFiles) copyVerified(item.source, join(stagedVoice, 'packs', relative(packs, item.source)))
    relocateVoicePacks(join(stagedVoice, 'packs'), packs, join(voiceTarget, 'packs'))
    for (const item of audioFiles) copyVerified(item.source, join(stagedVoice, 'audio', relative(audioDir, item.source)))
    const legacyBiliInterval = qq.biliBridge?.memory?.refreshIntervalMs
    const intervalNumber = typeof legacyBiliInterval === 'number' || (typeof legacyBiliInterval === 'string' && legacyBiliInterval.trim()) ? Number(legacyBiliInterval) : NaN
    const biliSync = Number.isFinite(intervalNumber) ? { enabled: false, intervalMs: Math.max(60000, Math.min(3600000, Math.round(intervalNumber))) } : undefined
    writeJson(join(stagedMemory, 'config.json'), { memoryCard: unified.memoryCard ?? {}, memory: unified.memory ?? {}, ...(biliSync ? { biliSync } : {}) })
    writeJson(join(stagedMemory, 'migration.json'), {
      version: 1, completedAt: new Date().toISOString(), backup,
      sources: [...memoryFiles, ...memoryExtras, ...biliMemoryFiles, ...voiceFiles, ...audioFiles]
        .map(item => ({ path: relative(root, item.source), sha256: digest(item.source) })),
    })
    const { dir: _oldPacksDirectory, ...voicePacks } = qq.voicePacks ?? {}
    const relocatePacksUrl = value => {
      if (typeof value !== 'string' || !value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value
      const absolute = resolve(oldSource, value), rel = relative(oldSource, absolute)
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return value
      const fromPacks = relative(packs, absolute)
      if (fromPacks && fromPacks !== '..' && !fromPacks.startsWith(`..${sep}`) && !isAbsolute(fromPacks)) return join(voiceTarget, 'packs', fromPacks)
      return join(voiceTarget, rel)
    }
    if (Array.isArray(voicePacks.manifests)) voicePacks.manifests = voicePacks.manifests.map(item => item && typeof item === 'object' ? { ...item, ...(typeof item.url === 'string' ? { url: relocatePacksUrl(item.url) } : {}) } : item)
    writeJson(join(stagedVoice, 'config.json'), { voice: migratedVoice, voicePacks })
    mkdirSync(home, { recursive: true, mode: 0o700 })
    let voicePublished = false
    let memoryPublished = false
    const platformPublished = []
    try {
      renameSync(stagedVoice, voiceTarget); voicePublished = true
      renameSync(stagedMemory, memoryTarget); memoryPublished = true
      for (const item of platformCopies) {
        const staged = join(stage, 'bili', relative(biliState, item.source))
        mkdirSync(dirname(item.target), { recursive: true, mode: 0o700 })
        if (existsSync(item.target)) throw new Error(`Platform state conflict: ${item.target}`)
        renameSync(staged, item.target)
        platformPublished.push({ target: item.target, staged })
      }
      for (const item of bridgeCopies) {
        const staged = join(stage, 'qq-bili', relative(biliState, item.source))
        mkdirSync(dirname(item.target), { recursive: true, mode: 0o700 })
        if (existsSync(item.target)) throw new Error(`QQ bridge state conflict: ${item.target}`)
        renameSync(staged, item.target)
        platformPublished.push({ target: item.target, staged })
      }
      writeJson(marker, { version: 1, backup, completedAt: new Date().toISOString() })
    } catch (error) {
      for (const item of platformPublished.reverse()) renameSync(item.target, item.staged)
      if (memoryPublished) renameSync(memoryTarget, stagedMemory)
      if (voicePublished) renameSync(voiceTarget, stagedVoice)
      throw error
    }
    return { backup, alreadyMigrated: false }
  } finally { rmSync(lock, { recursive: true, force: true }) }
}
