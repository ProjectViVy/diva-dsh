import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const file = resolve('plugins/memory/src/owner-bridge.mjs')
test('capacity alerts use only the authenticated loopback QQ bridge and carry numeric status', async t => {
  assert.ok(existsSync(file), 'QQ bridge notification transport must exist')
  const { createOwnerBridgeNotifier } = await import(pathToFileURL(file).href)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'owner-bridge-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const calls = []
  const server = createServer((req, res) => {
    let data = ''; req.on('data', chunk => { data += chunk }); req.on('end', () => { calls.push({ url: req.url, token: req.headers['x-console-token'], body: JSON.parse(data) }); res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const config = join(dir, 'config.json'), token = join(dir, 'console-token')
  writeFileSync(config, JSON.stringify({ consolePort: server.address().port }))
  writeFileSync(token, 'local-test-token')
  const send = createOwnerBridgeNotifier({ qqConfigFile: config, tokenFile: token })
  assert.equal((await send({ level: 2, chars: 1800, maxChars: 2000, percent: 90 })).ok, true)
  assert.deepEqual(calls, [{ url: '/api/memory-card/notify', token: 'local-test-token', body: { level: 2, chars: 1800, maxChars: 2000, percent: 90 } }])
  assert.equal(readFileSync(token, 'utf8'), 'local-test-token')
})

test('capacity notification refuses a missing bridge token without sending a request', async t => {
  assert.ok(existsSync(file), 'QQ bridge notification transport must exist')
  const { createOwnerBridgeNotifier } = await import(pathToFileURL(file).href)
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'owner-bridge-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const send = createOwnerBridgeNotifier({ qqConfigFile: join(dir, 'absent.json'), tokenFile: join(dir, 'absent-token') })
  assert.equal((await send({ level: 1, chars: 1, maxChars: 2, percent: 50 })).ok, false)
})
