import * as path from 'node:path'

export function projectFromCwd(cwd) {
  const base = path.basename(String(cwd ?? '').trim())
  return base && base !== '.' && base !== path.sep ? base : 'general'
}

export function resolveProject({ defaultProject, sessionProject, cwd }) {
  if (defaultProject) return defaultProject
  if (sessionProject) return sessionProject
  return projectFromCwd(cwd)
}
