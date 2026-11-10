import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function harness(snapshot, handler = () => ({})) {
  const states = [], effects = [], requests = []
  let cursor = 0, first = true, exports
  const react = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props ?? {}, children }),
    Fragment: 'fragment',
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
    useEffect: fn => { if (first) effects.push(fn) }, useCallback: fn => fn, useRef: value => ({ current: value }),
  }
  const source = readFileSync('plugins/dsh-evolution/src/client.js', 'utf8').replace(/return \{\s+inject: \['slots', 'layout'\]/, "return { DreamTab, inject: ['slots', 'layout']")
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exports = factory(() => react) } } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      requests.push({ url, body })
      const data = body === undefined ? (typeof snapshot === 'function' ? await snapshot(url) : snapshot) : await handler(url, body)
      return { ok: true, json: async () => data }
    },
  })
  const render = (props = {}) => { cursor = 0; const tree = exports.DreamTab({ refreshKey: 0, ...props }); first = false; return tree }
  return { render, requests, load: async () => { render(); effects.forEach(fn => fn()); await new Promise(resolve => setImmediate(resolve)) } }
}
function nodes(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.children.flat(Infinity).flatMap(nodes)] : [] }
function textOf(tree) { return tree && typeof tree === 'object' ? tree.children.flat(Infinity).map(textOf).join(' ') : String(tree ?? '') }
const snapshot = { config: { enabled: true, cooldownHours: 24, minSessions: 5, minPrimaryEvents: 10 }, lastCheck: { reason: 'insufficient_sessions', sessionCount: 2, primaryEventCount: 12 }, requests: [{ id: 'req1', status: 'submitted', inputId: 'input1', createdAt: '2026-01-01' }], runs: [] }

test('AutoDream separates submitted Input from an accepted Ticket and shows gate counts', async () => {
  const app = harness(snapshot)
  await app.load()
  const text = textOf(app.render())
  assert.match(text, /Input.*input1/)
  assert.match(text, /Ticket.*尚未接纳/)
  assert.match(text, /2 \/ 5/)
  assert.match(text, /12 \/ 10/)
  assert.doesNotMatch(text, /精炼已完成/)
})

test('manual refine submits one ordinary request and preserves the entered session on failure', async () => {
  const app = harness(snapshot, () => { throw new Error('policy unavailable') })
  await app.load()
  let tree = app.render()
  nodes(tree).find(node => node.props['aria-label'] === '精炼会话 ID').props.onChange({ target: { value: 'session-one' } })
  tree = app.render()
  await nodes(tree).find(node => node.type === 'button' && textOf(node) === '提交手动精炼').props.onClick()
  tree = app.render()
  assert.equal(app.requests.filter(item => item.body?.mode === 'manual').length, 1)
  assert.deepEqual(app.requests.at(-1).body, { mode: 'manual', sessionId: 'session-one', crossSession: false })
  assert.equal(nodes(tree).find(node => node.props['aria-label'] === '精炼会话 ID').props.value, 'session-one')
  assert.match(textOf(tree), /policy unavailable/)
})

test('settings retain edited values after save failure and reject invalid gates locally', async () => {
  const app = harness(snapshot, () => { throw new Error('write denied') })
  await app.load()
  let tree = app.render({ settingsOnly: true })
  nodes(tree).filter(node => node.type === 'input' && node.props.type === 'number')[0].props.onChange({ target: { value: '48' } })
  tree = app.render({ settingsOnly: true })
  await nodes(tree).find(node => node.type === 'button' && textOf(node) === '保存 AutoDream 设置').props.onClick()
  tree = app.render({ settingsOnly: true })
  assert.equal(app.requests.at(-1).url, '/dsh-evolution/api/dream/config')
  assert.equal(app.requests.at(-1).body.cooldownHours, 48)
  assert.equal(nodes(tree).find(node => node.type === 'input' && node.props.type === 'number').props.value, 48)
  assert.match(textOf(tree), /write denied/)
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { value: '0' } })
  tree = app.render({ settingsOnly: true })
  await nodes(tree).find(node => node.type === 'button' && textOf(node) === '保存 AutoDream 设置').props.onClick()
  assert.equal(app.requests.filter(item => item.body).length, 1)
  assert.match(textOf(app.render({ settingsOnly: true })), /必须为正整数/)
})

test('blocked validation exposes coverage, candidate reports and rollback references separately from publication', async () => {
  const app = harness({ ...snapshot, runs: [{ id: 'run-one', requestId: 'req1', phase: 'blocked', coverage: ['evidence-1'], candidates: [{ kind: 'skill', ownerCandidateId: 'candidate-one', status: 'blocked', validation: { reason: 'docker unavailable' }, publication: { revision: 'v2', rollbackRef: 'v1' } }] }] })
  await app.load()
  const text = textOf(app.render())
  for (const expected of ['验证受阻', 'evidence-1', 'candidate-one', 'docker unavailable', 'rollbackRef', 'v1', '最近尝试', '最近完成精炼', '最近发布']) assert.ok(text.includes(expected), expected)
  assert.doesNotMatch(text, /已发布/)
})

test('refresh failure keeps the committed run snapshot and unsaved settings', async () => {
  let fail = false
  const app = harness(() => { if (fail) throw new Error('network offline'); return snapshot })
  await app.load()
  let tree = app.render({ settingsOnly: true })
  nodes(tree).find(node => node.type === 'input' && node.props.type === 'number').props.onChange({ target: { value: '72' } })
  fail = true
  tree = app.render()
  nodes(tree).find(node => node.type === 'button' && textOf(node) === '刷新运行状态').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  tree = app.render()
  assert.match(textOf(tree), /network offline/)
  assert.match(textOf(tree), /input1/)
  assert.equal(nodes(app.render({ settingsOnly: true })).find(node => node.type === 'input' && node.props.type === 'number').props.value, 72)
})
