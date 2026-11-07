import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join, resolve } from 'node:path'
import * as voiceBridge from '../plugins/voice/src/bridge-readiness.mjs'
const { createVoiceBridgeReadiness } = voiceBridge

test('voice readiness uses an authenticated local read-only bridge request', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'voice-readiness-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  let seen
  const server = createServer((req, res) => { seen = { method: req.method, path: req.url, token: req.headers['x-console-token'] }; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"toolEnabled":false,"connected":true}') })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const config = join(dir, 'config.json'), token = join(dir, 'token')
  writeFileSync(config, JSON.stringify({ consolePort: server.address().port }))
  writeFileSync(token, 'fixture-console-token')
  const check = createVoiceBridgeReadiness({ qqConfigFile: config, tokenFile: token })
  assert.deepEqual(await check(), { ok: true, toolEnabled: false, connected: true })
  assert.deepEqual(seen, { method: 'GET', path: '/api/voice/readiness', token: 'fixture-console-token' })
})

test('voice library probe checks files through the authenticated running QQ bridge', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'voice-probe-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  let seen
  const server = createServer((req, res) => { seen = { method: req.method, path: req.url, token: req.headers['x-console-token'] }; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, voices: [{ name: 'hello.wav', ok: true, detail: '1 秒' }] })) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const config = join(dir, 'config.json'), token = join(dir, 'token')
  writeFileSync(config, JSON.stringify({ consolePort: server.address().port })); writeFileSync(token, 'fixture-console-token')
  assert.equal(typeof voiceBridge.createVoiceLibraryProbe, 'function')
  const probe = voiceBridge.createVoiceLibraryProbe({ qqConfigFile: config, tokenFile: token })
  const result = await probe()
  assert.equal(result.voices[0].detail, '1 秒')
  assert.deepEqual(seen, { method: 'GET', path: '/api/voice/list?probe=1', token: 'fixture-console-token' })
})

test('voice trial send uses the authenticated bridge and preserves dry-run choice', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'voice-send-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  let seen
  const server = createServer((req, res) => { let data = ''; req.on('data', chunk => { data += chunk }); req.on('end', () => { seen = { method: req.method, path: req.url, token: req.headers['x-console-token'], body: JSON.parse(data) }; res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true,"dryRun":true}') }) })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)))
  const config = join(dir, 'config.json'), token = join(dir, 'token')
  writeFileSync(config, JSON.stringify({ consolePort: server.address().port })); writeFileSync(token, 'fixture-console-token')
  assert.equal(typeof voiceBridge.createVoiceLibrarySender, 'function')
  const send = voiceBridge.createVoiceLibrarySender({ qqConfigFile: config, tokenFile: token })
  const body = { target: 'group:123', file: '/project/audio/hello.wav', dryRun: true }
  assert.equal((await send(body)).dryRun, true)
  assert.deepEqual(seen, { method: 'POST', path: '/api/voice/send', token: 'fixture-console-token', body })
})
