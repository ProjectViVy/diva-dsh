import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const moduleFile = resolve('plugins/voice/src/install-runner.mjs')
async function runner() {
  assert.ok(existsSync(moduleFile), 'the project-local installer process runner must exist')
  return import(pathToFileURL(moduleFile).href)
}
function workspace(t) {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'installer-runner-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('installer child uses project-local home, temporary and package cache paths', async t => {
  const dir = workspace(t), { runInstallCommand } = await runner()
  const out = join(dir, 'result.json')
  const program = 'require("node:fs").writeFileSync(process.argv[1],JSON.stringify({home:process.env.HOME,tmp:process.env.TMPDIR,cache:process.env.PIP_CACHE_DIR,user:process.env.PYTHONUSERBASE,opts:process.env.NODE_OPTIONS || ""}))'
  await runInstallCommand({ root: dir, cwd: dir, command: process.execPath, args: ['-e', program, out] })
  const result = JSON.parse(readFileSync(out, 'utf8'))
  for (const value of [result.home, result.tmp, result.cache, result.user]) assert.ok(value.startsWith(`${dir}/`), value)
  assert.equal(result.opts, '')
})

test('cancelling a running install command stops its own child process', async t => {
  const dir = workspace(t), { runInstallCommand } = await runner()
  const controller = new AbortController()
  const started = new Promise((resolve, reject) => {
    const work = runInstallCommand({ root: dir, cwd: dir, command: process.execPath, args: ['-e', 'console.log("ready"); setInterval(() => {}, 1000)'], signal: controller.signal, onOutput: text => { if (text.includes('ready')) resolve({ work }) } })
    work.catch(reject)
  })
  const { work } = await started
  controller.abort()
  await assert.rejects(work, /cancel/i)
})

test('cancelling the installer also stops subprocesses launched by its bootstrap', async t => {
  const dir = workspace(t), { runInstallCommand } = await runner()
  const controller = new AbortController(), marker = join(dir, 'orphan.txt')
  const nested = 'setTimeout(() => require("node:fs").writeFileSync(process.argv[1],"escaped"), 350)'
  const parent = 'require("node:child_process").spawn(process.execPath,["-e",process.argv[1],process.argv[2]],{stdio:"ignore"}); console.log("ready");setInterval(()=>{},1000)'
  let ready
  const started = new Promise(resolve => { ready = resolve })
  const work = runInstallCommand({ root: dir, cwd: dir, command: process.execPath, args: ['-e', parent, nested, marker], signal: controller.signal, onOutput: text => { if (text.includes('ready')) ready() } })
  await started
  controller.abort()
  await assert.rejects(work, /cancel/i)
  await new Promise(resolve => setTimeout(resolve, 500))
  assert.equal(existsSync(marker), false)
})
