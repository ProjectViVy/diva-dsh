import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

import {
  PROXY_NAMES, applyProxy, clearProxyConfig, describeProxy, parseProxyUrl, proxyConfigFile,
  proxyReport, readLaunchedProxy, readProxyConfig, recordLaunchedProxy, resolveProxy,
  serviceEnvironment, writeProxyConfig,
} from '../scripts/lib/proxy.mjs'

const scratch = resolve('.artifacts', 'test-tmp')

/** An empty deployment root; nothing here reads the real checkout. */
function fixture(t) {
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, 'proxy-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('a bare host and port is read as an http proxy', () => {
  assert.equal(parseProxyUrl('127.0.0.1:7897'), 'http://127.0.0.1:7897')
  assert.equal(parseProxyUrl(' http://127.0.0.1:7897/ '), 'http://127.0.0.1:7897')
  assert.equal(parseProxyUrl('https://proxy.example:8443'), 'https://proxy.example:8443')
  assert.equal(parseProxyUrl('http://user:pass@proxy.example:8080'), 'http://user:pass@proxy.example:8080')
})

test('a SOCKS address names the way forward instead of being accepted', () => {
  assert.throws(() => parseProxyUrl('socks5://127.0.0.1:7897'), /不支持.*HTTP 端口|HTTP 端口/)
  assert.throws(() => parseProxyUrl('socks5h://127.0.0.1:7897'), /HTTP 端口/)
  assert.throws(() => parseProxyUrl('ftp://127.0.0.1:7897'), /http:\/\/ 或 https:\/\//)
  assert.throws(() => parseProxyUrl('   '), /地址为空/)
  assert.throws(() => parseProxyUrl('http://'), /不是合法 URL|缺少主机名/)
})

test('a display value never carries credentials', () => {
  const resolved = { kind: 'proxy', url: 'http://alice:s3cret@127.0.0.1:8123' }
  const shown = describeProxy(resolved)
  assert.equal(shown, 'http://127.0.0.1:8123')
  assert.doesNotMatch(shown, /s3cret|alice/)
  assert.equal(describeProxy({ kind: 'off' }), 'off')
  assert.equal(describeProxy({ kind: 'none' }), 'none')
  assert.equal(describeProxy({ kind: 'invalid', error: 'x' }), 'invalid')
})

test('the saved configuration survives a round trip and reports its bypass list', (t) => {
  const root = fixture(t)
  assert.equal(readProxyConfig(root), undefined)
  writeProxyConfig(root, { proxy: '127.0.0.1:7897', noProxy: ' localhost,10.0.0.5 ' })
  const stored = JSON.parse(readFileSync(proxyConfigFile(root), 'utf8'))
  assert.deepEqual(stored, { proxy: 'http://127.0.0.1:7897', noProxy: 'localhost,10.0.0.5' })
  assert.deepEqual(readProxyConfig(root), { proxy: 'http://127.0.0.1:7897', noProxy: 'localhost,10.0.0.5' })
  clearProxyConfig(root)
  assert.equal(readProxyConfig(root), undefined)
  clearProxyConfig(root)
})

test('a broken configuration fails loud with the file and the way out', (t) => {
  const root = fixture(t)
  mkdirSync(join(root, '.artifacts'), { recursive: true })
  writeFileSync(proxyConfigFile(root), '{ not json')
  assert.throws(() => readProxyConfig(root), /不是合法 JSON.*npm run proxy -- off/s)
  writeFileSync(proxyConfigFile(root), '{"noProxy":"localhost"}')
  assert.throws(() => readProxyConfig(root), /缺少 "proxy".*npm run proxy -- off/s)
  writeFileSync(proxyConfigFile(root), '["http://127.0.0.1:7897"]')
  assert.throws(() => readProxyConfig(root), /必须是一个 JSON 对象/)
})

test('a configuration that says off is read as off', (t) => {
  const root = fixture(t)
  mkdirSync(join(root, '.artifacts'), { recursive: true })
  writeFileSync(proxyConfigFile(root), '{"proxy":"off"}')
  assert.deepEqual(readProxyConfig(root), { proxy: 'off' })
  assert.equal(resolveProxy({ root, env: {} }).kind, 'off')
})

test('the one-shot flag outranks the saved configuration', (t) => {
  const root = fixture(t)
  writeProxyConfig(root, { proxy: 'http://127.0.0.1:7897' })
  assert.deepEqual(resolveProxy({ root, env: {} }), { kind: 'proxy', url: 'http://127.0.0.1:7897', source: 'config' })
  assert.deepEqual(
    resolveProxy({ root, flag: { url: '127.0.0.1:9999' }, env: {} }),
    { kind: 'proxy', url: 'http://127.0.0.1:9999', source: 'flag' },
  )
  assert.deepEqual(resolveProxy({ root, flag: { off: true }, env: {} }), { kind: 'off', source: 'flag' })
  assert.throws(() => resolveProxy({ root, flag: { url: 'socks5://127.0.0.1:7897' }, env: {} }), /HTTP 端口/)
})

test('without a flag or a configuration the launcher leaves the environment alone', (t) => {
  const root = fixture(t)
  assert.deepEqual(resolveProxy({ root, env: {} }), { kind: 'none', source: 'none' })
  assert.deepEqual(
    resolveProxy({ root, env: { HTTPS_PROXY: 'http://127.0.0.1:7897' } }),
    { kind: 'none', source: 'none', inherited: 'http://127.0.0.1:7897' },
  )
})

test('a configured proxy replaces the inherited names instead of being shadowed by them', () => {
  const env = {
    PATH: '/bin',
    DSH_HOME: '/home/.artifacts/dsh-home',
    http_proxy: 'http://old:1',
    https_proxy: 'http://old:1',
    ALL_PROXY: 'socks5://old:2',
    all_proxy: 'socks5://old:2',
    NO_PROXY: 'old.example',
    no_proxy: 'old.example',
  }
  const applied = applyProxy(env, { kind: 'proxy', url: 'http://127.0.0.1:7897', noProxy: 'localhost' })
  assert.equal(applied.HTTP_PROXY, 'http://127.0.0.1:7897')
  assert.equal(applied.HTTPS_PROXY, 'http://127.0.0.1:7897')
  assert.equal(applied.NO_PROXY, 'localhost')
  assert.equal(applied.http_proxy, undefined)
  assert.equal(applied.https_proxy, undefined)
  assert.equal(applied.ALL_PROXY, undefined)
  assert.equal(applied.all_proxy, undefined)
  assert.equal(applied.no_proxy, undefined)
  assert.equal(applied.PATH, '/bin')
  assert.equal(applied.DSH_HOME, '/home/.artifacts/dsh-home')
})

test('a configuration without a bypass list keeps the inherited one', () => {
  const applied = applyProxy(
    { PATH: '/bin', NO_PROXY: 'corp.example', no_proxy: 'corp.example' },
    { kind: 'proxy', url: 'http://127.0.0.1:7897' },
  )
  assert.equal(applied.NO_PROXY, 'corp.example')
  assert.equal(applied.no_proxy, 'corp.example')
})

test('off removes every proxy name, so a shell export cannot survive it', () => {
  const env = Object.fromEntries(PROXY_NAMES.map((name) => [name, 'http://127.0.0.1:7897']))
  const applied = applyProxy({ PATH: '/bin', ...env }, { kind: 'off' })
  assert.deepEqual(applied, { PATH: '/bin' })
})

test('none and invalid leave the environment untouched', () => {
  const env = { PATH: '/bin', HTTPS_PROXY: 'http://127.0.0.1:7897' }
  assert.deepEqual(applyProxy(env, { kind: 'none', source: 'none' }), env)
  assert.deepEqual(applyProxy(env, { kind: 'invalid', error: 'x' }), env)
})

test('the service environment keeps the SurfCore isolation and adds the proxy', (t) => {
  const root = fixture(t)
  const env = serviceEnvironment(root, { PATH: '/bin', NODE_OPTIONS: '--no-warnings' }, {
    kind: 'proxy', url: 'http://127.0.0.1:7897',
  })
  assert.equal(env.SURFCORE_ROOT, join(root, 'plugins', 'surfcore'))
  assert.equal(env.SURFCORE_COMPONENT_SPLIT, '1')
  assert.equal(env.DSH_MEMORY_STATE_DIR, join(root, '.artifacts', 'dsh-home', 'memory'))
  assert.match(String(env.NODE_OPTIONS), /--no-warnings/)
  assert.match(String(env.NODE_OPTIONS), /surfcore-loader\.mjs/)
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7897')
})

test('the launch marker tells a stale configuration from an effective one', (t) => {
  const root = fixture(t)
  const profile = 'superagent-local'
  assert.equal(readLaunchedProxy(root, profile), undefined)
  assert.deepEqual(
    proxyReport({ resolved: { kind: 'proxy', url: 'http://127.0.0.1:7897', source: 'config' }, launched: undefined, running: true }),
    { configured: 'http://127.0.0.1:7897', source: 'config', launched: null, needs_restart: false },
  )
  recordLaunchedProxy(root, profile, { kind: 'proxy', url: 'http://127.0.0.1:7897' })
  assert.equal(readLaunchedProxy(root, profile), 'http://127.0.0.1:7897')
  assert.equal(
    proxyReport({ resolved: { kind: 'proxy', url: 'http://127.0.0.1:7897', source: 'config' }, launched: readLaunchedProxy(root, profile), running: true }).needs_restart,
    false,
  )
  assert.equal(
    proxyReport({ resolved: { kind: 'off', source: 'config' }, launched: readLaunchedProxy(root, profile), running: true }).needs_restart,
    true,
  )
  recordLaunchedProxy(root, profile, undefined)
  assert.equal(readLaunchedProxy(root, profile), undefined)
})

test('a stopped service never asks for a restart', (t) => {
  const root = fixture(t)
  assert.equal(
    proxyReport({ resolved: { kind: 'off', source: 'config' }, launched: 'http://127.0.0.1:7897', running: false }).needs_restart,
    false,
  )
})
