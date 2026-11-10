import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** Install the deployment workflow, never taking ownership of a user's skill. */
export function installDreamSkill(root, home) {
  const skills = join(home, 'skills')
  const directory = join(skills, 'diva-dream')
  for (const path of [home, skills, directory]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error('Dream skill directory must not be a symlink')
  }
  const file = join(directory, 'SKILL.md')
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error('Dream skill is not a regular file')
    const previous = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    if (!previous.includes('  author: diva-dsh\n') || !previous.includes('  role: evolution-workflow\n')) throw new Error('The existing diva-dream skill is user-owned; it was preserved')
  }
  const source = readFileSync(join(root, 'skills/diva-dream/SKILL.md'), 'utf8')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.SKILL.${randomUUID()}.tmp`)
  writeFileSync(temporary, source, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
  return file
}
