// Persona scaffolding and profile overrides for dsh-laputa.
//
// The plugin reads opaque Markdown files; this module only creates an empty
// template (without overwriting anything) and edits the profile patch that
// enables the selected persona. The first conversation fills the template
// through the create-only laputa_init tool, or the user edits it directly.
// It never writes a SOUL.md and never rewrites the source files.

import { chmodSync, existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** Assembly order shared with the plugin. */
export const PERSONA_FILES = [
  'MISSION.MD', 'IDENTITY.MD', 'RELATIONSHIP.MD', 'REDLINE.MD', 'DREAM.MD', 'DARK.MD',
]

/** Validate the persona directory name used by the plugin and these scripts. */
export function validatePersonaId(personaId) {
  if (typeof personaId !== 'string' || personaId === '' || personaId === '.' || personaId === '..'
    || /[\\/\0]/.test(personaId)) {
    throw new Error(`Invalid personaId: ${JSON.stringify(personaId)}`)
  }
  return personaId
}

/**
 * Create `<dataRoot>/<personaId>/` with the six empty persona files.
 * Existing files are never overwritten; the directory is kept at 0700 and new
 * files at 0600. Returns which files were created and which already existed.
 */
export function initPersonaFiles(dataRoot, personaId) {
  validatePersonaId(personaId)
  const root = resolve(dataRoot)
  const directory = join(root, personaId)

  if (existsSync(directory)) {
    const info = lstatSync(directory)
    if (info.isSymbolicLink()) throw new Error(`Persona directory is a symlink: ${directory}`)
    if (!info.isDirectory()) throw new Error(`Persona path is not a directory: ${directory}`)
  } else {
    mkdirSync(root, { recursive: true, mode: 0o700 })
    mkdirSync(directory, { mode: 0o700 })
    chmodSync(directory, 0o700)
  }

  const canonicalRoot = realpathSync(root)
  const canonicalDirectory = realpathSync(directory)
  if (canonicalDirectory !== join(canonicalRoot, personaId)) {
    throw new Error(`Persona directory resolves outside ${canonicalRoot}: ${canonicalDirectory}`)
  }

  const created = []
  const existing = []
  for (const name of PERSONA_FILES) {
    const file = join(canonicalDirectory, name)
    try {
      writeFileSync(file, '', { flag: 'wx', mode: 0o600 })
      chmodSync(file, 0o600)
      created.push(name)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const info = lstatSync(file)
      if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Persona file is not a regular file: ${file}`)
      existing.push(name)
    }
  }
  return { directory: canonicalDirectory, created, existing }
}

/** Render the profile override block for one persona. */
function laputaBlock({ enabled, personaId, sourceDir }) {
  return [
    '- id: laputa',
    '  config:',
    `    enabled: ${enabled ? 'true' : 'false'}`,
    `    personaId: ${personaId}`,
    ...(sourceDir === undefined ? [] : [`    sourceDir: ${JSON.stringify(sourceDir)}`]),
  ]
}

/**
 * Insert or replace the `- id: laputa` entry in a profile `cordis.patch.yml`.
 * Other entries and comments are preserved; the function is idempotent and
 * refuses flow-style or multi-document YAML rather than guessing at it.
 */
export function upsertLaputaProfileConfig(patchText, options) {
  const { enabled = true, personaId = 'default', sourceDir } = options ?? {}
  validatePersonaId(personaId)
  if (sourceDir !== undefined && !isAbsolute(sourceDir)) {
    throw new Error(`sourceDir must be absolute: ${sourceDir}`)
  }

  const text = String(patchText ?? '')
  const lines = (text.trim() === '[]' ? '' : text).split('\n')
  if (lines.some(line => /^[\[{]/.test(line) || /^-\s*[\[{]/.test(line) || /^---\s*$/.test(line))) {
    throw new Error('The profile cordis.patch.yml is not a simple YAML array; edit it manually')
  }

  const block = laputaBlock({ enabled, personaId, sourceDir })
  const isItem = line => /^-\s/.test(line)
  const isLaputa = line => /^-\s+id:\s*['"]?laputa['"]?\s*(?:#.*)?$/.test(line)

  const start = lines.findIndex(isLaputa)
  if (start >= 0) {
    let end = lines.length
    for (let index = start + 1; index < lines.length; index += 1) {
      if (isItem(lines[index])) { end = index; break }
    }
    while (end > start + 1 && lines[end - 1].trim() === '') end -= 1
    const next = [...lines.slice(0, start), ...block, ...lines.slice(end)]
    return `${next.join('\n').replace(/\n+$/, '')}\n`
  }

  const next = [...lines]
  while (next.length > 0 && next[next.length - 1].trim() === '') next.pop()
  if (next.length > 0) next.push('')
  next.push(...block)
  return `${next.join('\n')}\n`
}
