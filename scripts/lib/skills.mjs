import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/** Skills installed from this repository carry this marker so a re-run may update them. */
const OWNER_MARKER = '  author: diva-dsh'

/**
 * Install one project-owned skill into `<home>/skills/<name>/SKILL.md`.
 * A re-run replaces only files this project owns; anything else is preserved and
 * reported by throwing, mirroring the Dream workflow installer.
 * @param {string} root - repository root containing `skills/<name>/SKILL.md`.
 * @param {string} home - harness home whose `skills` directory DSH scans.
 * @param {string} name - kebab-case skill name.
 * @returns {string} the installed SKILL.md path.
 */
export function installProjectSkill(root, home, name) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`Invalid skill name: ${name}`)
  const skills = join(home, 'skills')
  const directory = join(skills, name)
  for (const path of [home, skills, directory]) {
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error(`${name} skill directory must not be a symlink`)
  }
  const file = join(directory, 'SKILL.md')
  if (existsSync(file)) {
    if (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink()) throw new Error(`${name} skill is not a regular file`)
    const previous = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
    if (!previous.includes(OWNER_MARKER)) throw new Error(`The existing ${name} skill is user-owned; it was preserved`)
  }
  const source = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const temporary = join(directory, `.SKILL.${randomUUID()}.tmp`)
  writeFileSync(temporary, source, { mode: 0o600, flag: 'wx' })
  renameSync(temporary, file)
  return file
}

/** The skills this repository installs into a harness home. */
export const PROJECT_SKILLS = Object.freeze(['diva-dream', 'more-faster-better-economical'])
