/**
 * dsh-superagent-reset：排队标记、搬移、设置路由与注册形状。
 *
 * 全部在临时目录里跑，不碰真实的 `.artifacts/dsh-home`。
 */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'

import {
  MARKER_FILE, RESULT_FILE, applyReset, cancelReset, describe, lastResult,
  masterSessions, pendingRequest, requestReset, targets,
} from '../plugins/dsh-superagent-reset/lib/reset.mjs'

const roots = []
function home() {
  const root = mkdtempSync(join(tmpdir(), 'sar-'))
  roots.push(root)
  return root
}
test.after(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

const MASTER = 'orchestrator-4d1802aebad9163249a492fde7acb59a'
const MASTER_WS = '--C-Users-x-div a-.artifacts-dsh-home-state-superagent-local--'

/** 摆一份最小现场：master 会话、一条普通会话、投影缓存、洞察缓存。 */
function scene() {
  const root = home()
  const workspace = join(root, 'sessions', MASTER_WS)
  mkdirSync(join(workspace, MASTER), { recursive: true })
  writeFileSync(join(workspace, MASTER, 'session.v4.jsonl.zstd'), 'x'.repeat(32))
  mkdirSync(join(root, 'sessions', '--C-Users-x-div-a--', 'session-1111'), { recursive: true })
  writeFileSync(join(root, 'sessions', '--C-Users-x-div-a--', 'session-1111', 'session.v4.jsonl.zstd'), 'keep')
  mkdirSync(join(root, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  writeFileSync(join(root, 'storages', 'session_projcache', 'sessions', MASTER + '.json'), '{}')
  mkdirSync(join(root, 'storages', 'dsh-context'), { recursive: true })
  writeFileSync(join(root, 'storages', 'dsh-context', 'overview-cache.v1.json'), '{}')
  return root
}

test('只认 master 会话：普通会话与别的工作区都不碰', () => {
  const root = scene()
  assert.deepEqual(masterSessions(root).map(path => path.split(/[\\/]/).pop()), [MASTER])
  assert.equal(masterSessions(home()).length, 0, '没有会话目录时是空列表')
})

test('目标清单：会话 + 投影缓存 + 洞察缓存，路径都在 $DSH_HOME 下', () => {
  const root = scene()
  const list = targets(root)
  assert.equal(list.length, 3)
  assert.deepEqual(list.map(item => item.label), ['master 会话日志', '会话投影缓存', '上下文洞察缓存'])
  assert.ok(list.every(item => item.path.startsWith(root)))
})

test('排队标记能写、能读、能取消', () => {
  const root = scene()
  assert.equal(pendingRequest(root), null)
  requestReset(root, '2026-11-15T05:00:00.000Z')
  assert.equal(pendingRequest(root).requestedAt, '2026-11-15T05:00:00.000Z')
  assert.ok(!existsSync(join(root, MARKER_FILE + '.tmp')), '临时文件不该留下')
  assert.equal(cancelReset(root), true)
  assert.equal(pendingRequest(root), null)
  assert.equal(cancelReset(root), false, '没有标记时取消不算成功')
  writeFileSync(join(root, MARKER_FILE), 'not json')
  assert.equal(pendingRequest(root), null, '坏标记当作没排队')
})

test('搬移：进 backups/reset-<时间戳>，标记清掉，结果写下来', () => {
  const root = scene()
  requestReset(root, '2026-11-15T05:00:00.000Z')
  const result = applyReset(root, '2026-11-15T05:00:00.000Z')
  assert.equal(result.ok, true)
  assert.equal(result.moved.length, 3)
  assert.equal(pendingRequest(root), null)
  assert.ok(existsSync(join(root, result.backup, 'sessions', MASTER_WS, MASTER, 'session.v4.jsonl.zstd')))
  assert.ok(existsSync(join(root, 'sessions', '--C-Users-x-div-a--', 'session-1111', 'session.v4.jsonl.zstd')), '普通会话必须还在')
  assert.equal(lastResult(root).ok, true)
  assert.ok(existsSync(join(root, RESULT_FILE)))
})

test('没有 master 会话时搬移是空操作，不会诈称成功之外的失败', () => {
  const root = home()
  const result = applyReset(root, '2026-11-15T05:00:00.000Z')
  assert.equal(result.ok, true)
  assert.deepEqual(result.moved, [])
  assert.equal(result.missing.length, 1, '洞察缓存本来不在就算 missing')
})

test('搬不动就报失败、保留排队，下次启动还能再试', () => {
  const root = scene()
  requestReset(root, '2026-11-15T05:00:00.000Z')
  /* 先占住目标位置，让 mkdir 失败：用一个同名文件挡路。 */
  mkdirSync(join(root, 'backups', 'reset-20261115050000', 'storages'), { recursive: true })
  writeFileSync(join(root, 'backups', 'reset-20261115050000', 'storages', 'dsh-context'), 'block')
  const result = applyReset(root, '2026-11-15T05:00:00.000Z')
  assert.equal(result.ok, false)
  assert.ok(result.failures.some(item => item.path.endsWith('overview-cache.v1.json')))
  assert.notEqual(pendingRequest(root), null, '失败要保留排队')
  assert.ok(existsSync(join(root, 'storages', 'dsh-context', 'overview-cache.v1.json')), '没搬成的原样留着')
})

test('describe 只报相对路径和体积，不外泄绝对路径', () => {
  const root = scene()
  const view = describe(root)
  assert.equal(view.pending, null)
  assert.equal(view.targets.length, 3)
  assert.ok(view.targets.every(item => !item.path.startsWith('/') && !item.path.includes(root)))
  assert.ok(view.targets.every(item => item.exists))
  assert.ok(view.targets.some(item => item.bytes > 0))
})

// ── 设置页那一半：路由与注册 ─────────────────────────────────────────────────

const API = '/dsh-superagent-reset/api'

function request(method, url, { headers = {}, body = null } = {}) {
  const req = Readable.from(body === null ? [] : [Buffer.from(body)])
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3082', ...headers }
  return req
}

function answer() {
  const res = {
    status: 0,
    body: null,
    writeHead(status) { this.status = status },
    end(text) { this.body = JSON.parse(text) },
  }
  return res
}

/** 用一个假上下文把 host 半边挂起来，返回可以直接调用的 handler。 */
async function hostBridge(root) {
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const routes = []
  const logs = []
  const ctx = {
    logger: () => ({ info: message => logs.push(message), warn: message => logs.push(message) }),
    inject(deps, callback) {
      assert.deepEqual(deps, ['webServer', 'connection'])
      callback({
        effect(run) { run() },
        get(name) {
          if (name === 'webServer') return { register: route => { routes.push(route); return () => {} } }
          return { requestRejection: () => undefined }
        },
      })
    },
  }
  const module = await import('../plugins/dsh-superagent-reset/index.js')
  module.apply(ctx)
  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, API)
  return {
    logs,
    async call(method, path, options) {
      const res = answer()
      await routes[0].handler(request(method, path, options), res)
      return res
    },
    restore() { if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous },
  }
}

test('GET /status 报现场；非本机 host 一律 403', async () => {
  const root = scene()
  const bridge = await hostBridge(root)
  try {
    const ok = await bridge.call('GET', API + '/status')
    assert.equal(ok.status, 200)
    assert.equal(ok.body.ok, true)
    assert.equal(ok.body.pending, null)
    assert.equal(ok.body.targets.length, 3)

    const res = await bridge.call('GET', API + '/status', { headers: { host: 'evil.example:80' } })
    assert.equal(res.status, 403)
  } finally { bridge.restore() }
})

test('POST /queue 要明确确认；确认后排队，重复提交是幂等的', async () => {
  const root = scene()
  const bridge = await hostBridge(root)
  try {
    const bare = await bridge.call('POST', API + '/queue', { headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(bare.status, 400)
    assert.equal(pendingRequest(root), null)

    const json = { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirm: true }) }
    const first = await bridge.call('POST', API + '/queue', json)
    assert.equal(first.status, 200)
    assert.equal(first.body.pending.requestedAt.length > 0, true)
    const at = first.body.pending.requestedAt
    const second = await bridge.call('POST', API + '/queue', json)
    assert.equal(second.body.pending.requestedAt, at, '重复点不该刷新时间')

    const cancelled = await bridge.call('POST', API + '/cancel')
    assert.equal(cancelled.body.pending, null)
    assert.equal(pendingRequest(root), null)
  } finally { bridge.restore() }
})

test('POST /queue 拒绝跨站与没有 JSON 的请求', async () => {
  const root = scene()
  const bridge = await hostBridge(root)
  try {
    const crossSite = await bridge.call('POST', API + '/queue', {
      headers: { 'content-type': 'application/json', origin: 'http://evil.example' },
      body: JSON.stringify({ confirm: true }),
    })
    assert.equal(crossSite.status, 403)

    const noJson = await bridge.call('POST', API + '/queue', { body: JSON.stringify({ confirm: true }) })
    assert.equal(noJson.status, 415)
    assert.equal(pendingRequest(root), null)
  } finally { bridge.restore() }
})

test('浏览器半边：注册到 settings.general.item 的一行，id/order 固定', () => {
  const registered = []
  let loaded = null
  const appended = []
  globalThis.document = {
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: element => appended.push(element) },
  }
  globalThis.window = {
    __ModuleLoader__: { load: definition => { loaded = definition } },
  }
  const file = new URL('../plugins/dsh-superagent-reset/client.js', import.meta.url)
  const source = readFileSync(file, 'utf8')
  // 在 vm 之外最简单的装载方式：把文件当脚本跑，window 是刚摆好的假货。
  // eslint-disable-next-line no-new-func
  new Function(source)()
  assert.equal(loaded.id, 'dsh-superagent-reset')

  const React = {
    createElement: (type, props) => ({ type, props }),
    useState: value => [value, () => {}],
    useCallback: fn => fn,
    useEffect: () => {},
    useRef: value => ({ current: value }),
  }
  const mod = loaded.factory(specifier => {
    assert.equal(specifier, 'react')
    return React
  })
  assert.equal(mod.name, 'dsh-superagent-reset')
  assert.deepEqual(mod.inject, ['slots'])
  mod.apply({
    slots: {
      inject(name, callback) {
        assert.equal(name, 'settings.general.item')
        callback()
      },
      register(definition, component) { registered.push({ definition, component }) },
    },
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].definition.name, 'settings.general.item')
  assert.equal(registered[0].definition.id, 'superagent-reset')
  assert.equal(typeof registered[0].component, 'function')
  assert.equal(appended.length, 1, '样式只挂一次')
  assert.equal(appended[0].dataset.plugin, 'dsh-superagent-reset')
  delete globalThis.window
  delete globalThis.document
})
