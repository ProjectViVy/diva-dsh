#!/usr/bin/env node
// Keep plugins/dsh-see-now (pinned to vivy-dsh/dsh-see-now) carrying the one
// local change this repo needs: a `main` + `sidebar.panellist` entry so the
// plugin shows up under VIVY心核. The submodule itself stays at the upstream
// commit; the patch is applied here, idempotently.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN = join(ROOT, 'plugins', 'dsh-see-now')
const PATCH = join(ROOT, 'patches', 'see-now-vivy-core.patch')

function git(args) {
  const result = spawnSync('git', args, { cwd: PLUGIN, encoding: 'utf8' })
  if (result.error) throw result.error
  return result
}

if (!existsSync(join(PLUGIN, 'client.js'))) {
  throw new Error('plugins/dsh-see-now is missing; run "git submodule update --init plugins/dsh-see-now" first')
}
if (!existsSync(PATCH)) throw new Error(`patch missing: ${PATCH}`)

const already = git(['apply', '--reverse', '--check', PATCH])
if (already.status === 0) {
  console.log('dsh-see-now: VIVY心核 panel patch already applied')
  process.exit(0)
}

const check = git(['apply', '--check', PATCH])
if (check.status !== 0) {
  throw new Error(`dsh-see-now: patch does not apply cleanly\n${(check.stderr || check.stdout).trim()}`)
}
const applied = git(['apply', PATCH])
if (applied.status !== 0) {
  throw new Error(`dsh-see-now: patch failed\n${(applied.stderr || applied.stdout).trim()}`)
}
console.log('dsh-see-now: applied VIVY心核 panel patch')
