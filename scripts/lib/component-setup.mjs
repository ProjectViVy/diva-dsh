import { existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { validateStateDirectory } from './source.mjs'

/** Relocate only known project-owned profile links, preserving both original files. */
export function relocateProfileDependencies(root, profileName) {
  if (!/^[a-zA-Z0-9_-]+$/.test(profileName)) throw new Error('Invalid profile name')
  const project = resolve(root), profile = join(project, '.artifacts/dsh-home/profiles', profileName)
  if (!validateStateDirectory(project, profile)) throw new Error('Profile resolves outside the project')
  const pendingFile = join(profile, '.dependency-relocation.json')
  const hash = value => createHash('sha256').update(value).digest('hex')
  const validName = name => ['package.json', 'pnpm-lock.yaml'].includes(name)
  function resume() {
    if (!existsSync(pendingFile)) return false
    if (!lstatSync(pendingFile).isFile()) throw new Error('Profile dependency relocation record is invalid')
    const pending = JSON.parse(readFileSync(pendingFile, 'utf8'))
    if (pending?.version !== 1 || !/^[a-f0-9-]{36}$/.test(pending.id || '') || !Array.isArray(pending.files) || !pending.files.length || pending.files.some(item => !validName(item.name) || !/^[a-f0-9]{64}$/.test(item.before || '') || !/^[a-f0-9]{64}$/.test(item.after || '')) || new Set(pending.files.map(item => item.name)).size !== pending.files.length) throw new Error('Profile dependency relocation record is invalid')
    for (const item of pending.files) {
      const file = join(profile, item.name), stage = join(profile, `.${item.name}.${pending.id}.relocation`)
      if (!lstatSync(file).isFile()) throw new Error('Profile dependency file is not a regular file')
      const current = hash(readFileSync(file))
      if (current !== item.before && current !== item.after) throw new Error('Profile dependency file changed during relocation')
      if (current === item.before && (!lstatSync(stage).isFile() || hash(readFileSync(stage)) !== item.after)) throw new Error('Profile dependency relocation data is invalid')
    }
    for (const item of pending.files) {
      const file = join(profile, item.name), stage = join(profile, `.${item.name}.${pending.id}.relocation`)
      if (hash(readFileSync(file)) === item.before) renameSync(stage, file)
      else rmSync(stage, { force: true })
    }
    rmSync(pendingFile)
    return true
  }
  if (resume()) return true
  const manifestFile = join(profile, 'package.json')
  if (!existsSync(manifestFile)) return false
  let marker
  try { marker = JSON.parse(readFileSync(join(project, '.artifacts/component-migration.json'), 'utf8')) } catch { return false }
  const backup = typeof marker?.backup === 'string' ? marker.backup.replaceAll('\\', '/') : ''
  const boundary = backup.lastIndexOf('/.artifacts/backups/'), oldRoot = boundary > 0 ? backup.slice(0, boundary) : ''
  if (marker?.version !== 1 || !oldRoot || oldRoot === project.replaceAll('\\', '/')) return false
  const mappings = { 'dsh-superagent': 'superagent', 'dsh-local-memory': 'plugins/memory', 'dsh-local-voice': 'plugins/voice', 'dsh-mempalace': 'plugins/dsh-mempalace', 'dsh-continual-harness': 'plugins/dsh-continual-harness', 'dsh-evolution': 'plugins/dsh-evolution', 'dsh-laputa': 'plugins/dsh-laputa', 'dsh-actmem-recap': 'plugins/dsh-actmem-recap', 'dsh-capability-hub': 'plugins/capability-hub', surfcore: '.artifacts/surfcore-adapter/bundle', 'surfcore-local-qq-mode': '.artifacts/surfcore-adapter/qq-mode' }
  const manifestText = readFileSync(manifestFile, 'utf8'), manifest = JSON.parse(manifestText)
  const lockFile = join(profile, 'pnpm-lock.yaml'), lockText = existsSync(lockFile) ? readFileSync(lockFile, 'utf8') : null
  let updatedLock = lockText, changed = false
  for (const [name, suffix] of Object.entries(mappings)) {
    const old = `link:${oldRoot}/${suffix}`
    if (manifest.dependencies?.[name]?.replaceAll('\\', '/') !== old) continue
    const target = join(project, suffix)
    if (existsSync(oldRoot) || !existsSync(target) || !validateStateDirectory(project, target)) throw new Error(`Cannot safely relocate profile dependency ${name}`)
    const next = `link:${relative(profile, target).replaceAll('\\', '/')}`
    if (updatedLock !== null) {
      const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const entry = new RegExp(`(^[ \\t]+(?:${escape(name)}|'${escape(name)}'|"${escape(name)}"):[ \\t]*\\r?\\n[ \\t]+specifier:[ \\t]*)(["']?)${escape(old)}\\2([ \\t]*\\r?$)`, 'gm')
      const matches = [...updatedLock.matchAll(entry)]
      if (matches.length !== 1) throw new Error(`Profile lockfile does not match dependency ${name}`)
      updatedLock = updatedLock.replace(entry, (_match, prefix, quote, ending) => `${prefix}${quote}${next}${quote}${ending}`)
    }
    manifest.dependencies[name] = next; changed = true
  }
  if (!changed) return false
  const files = [{ name: 'package.json', old: manifestText, next: `${JSON.stringify(manifest, null, 2)}\n` }]
  if (lockText !== null && updatedLock !== lockText) files.push({ name: 'pnpm-lock.yaml', old: lockText, next: updatedLock })
  const id = randomUUID()
  for (const item of files) {
    const file = join(profile, item.name)
    if (!lstatSync(file).isFile()) throw new Error('Profile dependency file is not a regular file')
    writeFileSync(join(profile, `${item.name}.pre-relocation-${id}`), item.old, { flag: 'wx', mode: 0o600 })
    writeFileSync(join(profile, `.${item.name}.${id}.relocation`), item.next, { flag: 'wx', mode: 0o600 })
  }
  const pendingStage = `${pendingFile}.${id}.tmp`
  try {
    writeFileSync(pendingStage, JSON.stringify({ version: 1, id, files: files.map(item => ({ name: item.name, before: hash(item.old), after: hash(item.next) })) }), { flag: 'wx', mode: 0o600 })
    renameSync(pendingStage, pendingFile)
  } finally { rmSync(pendingStage, { force: true }) }
  return resume()
}

/** Inspect a profile without rewriting its existing dependencies or other bundles. */
export function inspectComponents(profile, packages) {
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const missing = []
  for (const [name, target] of packages) {
    const installed = join(profile, 'node_modules', name)
    let linked = false
    try {
      lstatSync(installed)
      linked = existsSync(installed) && realpathSync(installed) === realpathSync(target)
      if (!linked) throw new Error(`Existing profile dependency ${name} points elsewhere; it was left unchanged`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      if (manifest.dependencies?.[name]) throw new Error(`Existing profile dependency ${name} is missing or points elsewhere; it was left unchanged`)
    }
    if (!linked || !manifest.dependencies?.[name] || !bundles.includes(name)) missing.push([name, target])
  }
  return { missing }
}

export function componentMigrationReady(root) {
  const artifacts = join(root, '.artifacts')
  try {
    const marker = JSON.parse(readFileSync(join(artifacts, 'component-migration.json'), 'utf8'))
    return marker.version === 1 && ['memory', 'voice'].every(name => existsSync(join(artifacts, 'dsh-home', name)))
  } catch { return false }
}

export function componentCutoverReady(root, profile, packages) {
  try { return componentMigrationReady(root) && inspectComponents(profile, packages).missing.length === 0 }
  catch { return false }
}

export function componentPackages(root) {
  return [
    ['dsh-local-memory', join(root, 'plugins', 'memory')],
    ['dsh-local-voice', join(root, 'plugins', 'voice')],
    ['dsh-local-asr', join(root, 'plugins', 'asr')],
    ['dsh-live2d', join(root, 'plugins', 'dsh-live2d')],
    ['dsh-mempalace', join(root, 'plugins', 'dsh-mempalace')],
    ['dsh-continual-harness', join(root, 'plugins', 'dsh-continual-harness')],
    ['dsh-evolution', join(root, 'plugins', 'dsh-evolution')],
    ['dsh-laputa', join(root, 'plugins', 'dsh-laputa')],
    ['dsh-actmem-recap', join(root, 'plugins', 'dsh-actmem-recap')],
    ['dsh-capability-hub', join(root, 'plugins', 'capability-hub')],
    ['dsh-surfcore-adapter', join(root, 'plugins', 'dsh-surfcore-adapter')],
    ['dsh-vivy-studio', join(root, 'plugins', 'dsh-vivy-studio')],
    ['dsh-skin-manager', join(root, 'plugins', 'dsh-skin-manager')],
    ['dsh-vivy-tone', join(root, 'plugins', 'dsh-vivy-tone')],
  ]
}
