import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleFile = resolve('plugins/voice/src/install-source.mjs')
function git(cwd, ...args) { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim() }

test('voice source staging checks out the explicitly pinned commit instead of the current branch head', async t => {
  assert.ok(existsSync(moduleFile), 'pinned voice source staging must exist')
  const { stagePinnedSource } = await import(pathToFileURL(moduleFile).href)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-source-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const repo = join(dir, 'origin'), target = join(dir, 'stage'); mkdirSync(repo)
  git(repo, 'init', '-q')
  writeFileSync(join(repo, 'version.txt'), 'pinned')
  git(repo, 'add', 'version.txt'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'first')
  const commit = git(repo, 'rev-parse', 'HEAD')
  writeFileSync(join(repo, 'version.txt'), 'newer')
  git(repo, 'add', 'version.txt'); git(repo, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'second')
  await stagePinnedSource({ root: dir, destination: target, sourceUrl: repo, commit })
  assert.equal(readFileSync(join(target, 'version.txt'), 'utf8'), 'pinned')
  assert.equal(git(target, 'rev-parse', 'HEAD'), commit)
  await assert.rejects(stagePinnedSource({ root: dir, destination: target, sourceUrl: repo, commit }), /存在|exists/i)
  assert.equal(readFileSync(join(target, 'version.txt'), 'utf8'), 'pinned')
})
