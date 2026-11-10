import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { installDreamSkill } from '../scripts/lib/dream-skill.mjs'

test('Dream workflow installation is idempotent and preserves user-owned skills', t => {
  const home = mkdtempSync(join(tmpdir(), 'diva-dream-skill-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  const root = resolve('.')
  const file = installDreamSkill(root, home)
  const expected = readFileSync(file, 'utf8')
  assert.match(expected, /real isolated execution/)
  assert.equal(installDreamSkill(root, home), file)
  assert.equal(readFileSync(file, 'utf8'), expected)
  writeFileSync(file, expected.replace(/\r?\n/g, '\r\n'))
  assert.equal(installDreamSkill(root, home), file)
  writeFileSync(file, '# My own skill\n')
  assert.throws(() => installDreamSkill(root, home), /user-owned/)
  assert.equal(readFileSync(file, 'utf8'), '# My own skill\n')
})
