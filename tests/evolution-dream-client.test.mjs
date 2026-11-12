import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

function harness(snapshot, handler = () => ({}), options = {}) {
  const states = [], effects = [], requests = []
  let cursor = 0, first = true, exports
  const react = {
    createElement: (type, props, ...children) => typeof type === 'function' ? type({ ...props, children }) : ({ type, props: props ?? {}, children }),
    Fragment: 'fragment',
    useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }] },
    useEffect: fn => { if (first) effects.push(fn) }, useCallback: fn => fn, useRef: value => ({ current: value }),
  }
  const source = readFileSync('plugins/dsh-evolution/src/client.js', 'utf8').replace(/return \{\n      inject: \['slots', 'layout'\]/, "return { DreamTab, ApprovalTab, inject: ['slots', 'layout']")
  runInNewContext(source, {
    window: { __ModuleLoader__: { load: ({ factory }) => { exports = factory(() => react) } } },
    AbortController, setTimeout, clearTimeout,
    fetch: async (url, init = {}) => {
      const body = init.body ? JSON.parse(init.body) : undefined
      requests.push({ url, body })
      const data = body !== undefined ? await handler(url, body)
        : url.startsWith('/dsh-continual-harness/api/') ? (options.harness ?? { pending: [] })
        : typeof snapshot === 'function' ? await snapshot(url) : snapshot
      return { ok: true, json: async () => data }
    },
  })
  const mount = (name, props = {}) => { cursor = 0; const tree = exports[name]({ refreshKey: 0, ...props }); first = false; return tree }
  const render = (props = {}) => mount('DreamTab', props)
  const renderApproval = () => mount('ApprovalTab')
  const settle = async () => { effects.forEach(fn => fn()); effects.length = 0; await new Promise(resolve => setImmediate(resolve)) }
  return { render, renderApproval, requests, load: async () => { render(); await settle() }, loadApproval: async () => { renderApproval(); await settle() } }
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

test('the approval tab shows the diff, attachments and provenance before one explicit confirmation', async () => {
  const pending = [{
    candidateId: 'candidate-one', skillId: 'test-skill', subjectId: 'subject-1', ticketId: 'ticket-1',
    evidenceRefs: [{ eventId: 'event-1' }], bundleDigest: 'a'.repeat(64), baselineDigest: 'b'.repeat(64),
    description: 'Use when testing', files: ['scripts/run.sh'], content: 'Do the thing.', stagedAt: '2026-01-02',
    bundle: [{ name: 'SKILL.md', content: '---\nname: test-skill\n---\n\nDo the thing.' }, { name: 'scripts/run.sh', content: 'echo hi' }],
    baselineBundle: [{ name: 'SKILL.md', content: '---\nname: test-skill\n---\n\nOld thing.' }],
  }]
  const app = harness(snapshot, () => ({ ok: true, publication: { version: 1 } }), { harness: { ok: true, pending, decided: [], live: [] } })
  await app.loadApproval()
  const text = textOf(app.renderApproval())
  for (const expected of ['test-skill', 'Do the thing.', 'Old thing.', 'ticket-1', 'subject-1', 'event-1', 'scripts/run.sh', 'echo hi', 'Use when testing', '人格 → 提案']) assert.ok(text.includes(expected), expected)
  assert.match(text, /\+ Do the thing\./)
  await nodes(app.renderApproval()).find(node => node.type === 'button' && textOf(node) === '批准并发布').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(app.requests.filter(item => item.body).at(-1), { url: '/dsh-continual-harness/api/decide', body: { candidateId: 'candidate-one', decision: 'approved', expectedBundleDigest: 'a'.repeat(64), confirm: true } })
  assert.equal(app.requests.filter(item => item.body?.decision === 'rejected').length, 0)
  assert.match(textOf(app.renderApproval()), /已批准并发布 test-skill · v1/)
})

test('a truncated candidate hides its body and says why instead of showing a bogus diff', async () => {
  const pending = [{ candidateId: 'candidate-big', skillId: 'big-skill', subjectId: 'subject-1', ticketId: 'ticket-3',
    evidenceRefs: [], bundleDigest: 'd'.repeat(64), baselineDigest: null, description: '', files: [], content: '', stagedAt: '2026-01-04',
    bundle: [{ name: 'SKILL.md', content: '' }], baselineBundle: null, truncated: true }]
  const app = harness(snapshot, () => ({}), { harness: { ok: true, pending, decided: [], live: [] } })
  await app.loadApproval()
  const text = textOf(app.renderApproval())
  assert.match(text, /内容较大/)
  assert.doesNotMatch(text, /没有可显示的差异/)
  assert.match(text, /批准并发布/)
})

test('the approval tab lists decided candidates and retries a stuck approval', async () => {
  const decided = [{ candidateId: 'candidate-two', skillId: 'stuck-skill', subjectId: 'subject-1', ticketId: 'ticket-2',
    decision: 'approved', decidedAt: '2026-01-03', bundleDigest: 'c'.repeat(64), publication: null }]
  const app = harness(snapshot, () => ({ ok: true, publication: { version: 2 } }), { harness: { ok: true, pending: [], decided, live: [] } })
  await app.loadApproval()
  let text = textOf(app.renderApproval())
  assert.match(text, /已处置（1）/)
  assert.match(text, /未发布/)
  await nodes(app.renderApproval()).find(node => node.type === 'button' && textOf(node) === '重试发布').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(app.requests.filter(item => item.body).at(-1), { url: '/dsh-continual-harness/api/decide', body: { candidateId: 'candidate-two', decision: 'approved', expectedBundleDigest: 'c'.repeat(64), confirm: true } })
  assert.match(textOf(app.renderApproval()), /已批准并发布 stuck-skill · v2/)
})

test('the approval tab creates a rollback candidate instead of rewriting the live pointer', async () => {
  const live = [{ skillId: 'test-skill', bundleDigest: 'a'.repeat(64), version: 3 }]
  const app = harness(snapshot, () => ({ ok: true, candidate: { candidateId: 'candidate-three' }, previous: { version: 2, publicationId: 'publication-two' } }), { harness: { ok: true, pending: [], decided: [], live } })
  await app.loadApproval()
  await nodes(app.renderApproval()).find(node => node.type === 'button' && textOf(node) === '回滚到上一版').props.onClick()
  let tree = app.renderApproval()
  assert.match(textOf(tree), /确认生成回滚候选/)
  await nodes(tree).find(node => node.type === 'button' && textOf(node) === '确认生成回滚候选').props.onClick()
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(app.requests.filter(item => item.body).at(-1), { url: '/dsh-continual-harness/api/rollback', body: { skillId: 'test-skill', confirm: true } })
  assert.match(textOf(app.renderApproval()), /已生成回滚候选（目标 v2）/)
})

test('the approval tab states the empty case instead of vanishing and shows live versions', async () => {
  const empty = harness(snapshot, () => ({}), { harness: { ok: true, pending: [], decided: [], live: [] } })
  await empty.loadApproval()
  assert.match(textOf(empty.renderApproval()), /暂无待批技能候选/)
  const live = [{ skillId: 'test-skill', bundleDigest: 'a'.repeat(64), version: 3 }]
  const app = harness(snapshot, () => ({}), { harness: { ok: true, pending: [], decided: [], live } })
  await app.loadApproval()
  const text = textOf(app.renderApproval())
  assert.match(text, /已发布的 harness 技能/)
  assert.match(text, /test-skill/)
  assert.match(text, /v3/)
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
