import { installProjectSkill } from './skills.mjs'

/**
 * Install the Dream refinement workflow, never taking ownership of a user's skill.
 * @param {string} root - repository root.
 * @param {string} home - harness home.
 * @returns {string} the installed SKILL.md path.
 */
export function installDreamSkill(root, home) {
  return installProjectSkill(root, home, 'diva-dream')
}
