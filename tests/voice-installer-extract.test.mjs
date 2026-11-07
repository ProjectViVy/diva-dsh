import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as tar from 'tar'

const moduleFile = resolve('plugins/voice/src/install-extract.mjs')
function workspace(t) {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-extract-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('verified model archive extracts regular files to the selected project directory', async t => {
  assert.ok(existsSync(moduleFile), 'safe archive extractor must exist')
  const { extractInstallArchive } = await import(pathToFileURL(moduleFile).href)
  const dir = workspace(t), source = join(dir, 'source'), dest = join(dir, 'dest'), archive = join(dir, 'model.tar.gz')
  mkdirSync(source); mkdirSync(dest); writeFileSync(join(source, 'model.bin'), 'model bytes')
  await tar.c({ gzip: true, cwd: source, file: archive }, ['model.bin'])
  await extractInstallArchive({ root: dir, archive, destination: dest })
  assert.equal(readFileSync(join(dest, 'model.bin'), 'utf8'), 'model bytes')
})

test('model archive cannot create a symlink pointing outside its extraction directory', async t => {
  assert.ok(existsSync(moduleFile), 'safe archive extractor must exist')
  const { extractInstallArchive } = await import(pathToFileURL(moduleFile).href)
  const dir = workspace(t), source = join(dir, 'source'), dest = join(dir, 'dest'), archive = join(dir, 'model.tar.gz')
  mkdirSync(source); mkdirSync(dest); writeFileSync(join(dir, 'outside.txt'), 'untouched')
  symlinkSync('../outside.txt', join(source, 'escape'))
  await tar.c({ gzip: true, cwd: source, file: archive }, ['escape'])
  await assert.rejects(extractInstallArchive({ root: dir, archive, destination: dest }), /链接|link/i)
  assert.equal(readFileSync(join(dir, 'outside.txt'), 'utf8'), 'untouched')
  assert.equal(existsSync(join(dest, 'escape')), false)
})

test('model archive rejects parent traversal before writing any files', async t => {
  const { extractInstallArchive } = await import(pathToFileURL(moduleFile).href)
  const dir = workspace(t), dest = join(dir, 'dest'), archive = join(dir, 'bad.tar')
  mkdirSync(dest)
  const header = new tar.Header({ path: '../outside.txt', mode: 0o644, size: 0, type: 'File' })
  header.encode()
  writeFileSync(archive, Buffer.concat([header.block, Buffer.alloc(1024)]))
  await assert.rejects(extractInstallArchive({ root: dir, archive, destination: dest }), /路径|path/i)
  assert.equal(existsSync(join(dir, 'outside.txt')), false)
})
