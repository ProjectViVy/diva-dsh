import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installDreamSkill } from '../scripts/lib/dream-skill.mjs'
import { installProjectSkill } from '../scripts/lib/skills.mjs'

test('Dream workflow installation is idempotent and preserves user-owned skills', t => {
  const home = mkdtempSync(join(tmpdir(), 'diva-dream-skill-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = resolve('.')
  const file = installDreamSkill(root, home)
  const expected = readFileSync(file, 'utf8')
  assert.match(expected, /approves or rejects them in|human approves or rejects/)
  assert.equal(installDreamSkill(root, home), file)
  assert.equal(readFileSync(file, 'utf8'), expected)
  writeFileSync(file, expected.replace(/\r?\n/g, '\r\n'))
  assert.equal(installDreamSkill(root, home), file)
  writeFileSync(file, '# My own skill\n')
  assert.throws(() => installDreamSkill(root, home), /user-owned/)
  assert.equal(readFileSync(file, 'utf8'), '# My own skill\n')
})

test('project skills install idempotently and preserve user-owned copies', t => {
  const home = mkdtempSync(join(tmpdir(), 'diva-project-skills-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = resolve('.')
  const file = installProjectSkill(root, home, 'more-faster-better-economical')
  const expected = readFileSync(file, 'utf8')
  assert.match(expected, /author: diva-dsh/)
  assert.equal(installProjectSkill(root, home, 'more-faster-better-economical'), file)
  assert.equal(readFileSync(file, 'utf8'), expected)
  assert.ok(installProjectSkill(root, home, 'diva-dream').endsWith(join('diva-dream', 'SKILL.md')))
  assert.throws(() => installProjectSkill(root, home, '../escape'), /Invalid skill name/)
  writeFileSync(file, '# Mine\n')
  assert.throws(() => installProjectSkill(root, home, 'more-faster-better-economical'), /user-owned/)
  assert.equal(readFileSync(file, 'utf8'), '# Mine\n')
})
