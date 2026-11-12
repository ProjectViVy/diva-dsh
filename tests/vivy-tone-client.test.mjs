/**
 * dsh-vivy-tone — the 语气 card's browser half.
 *
 * The client runs in a `window.__ModuleLoader__` factory, so each test loads it
 * into a fresh VM context with a stubbed React and a recording `fetch`.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const CLIENT = resolve('plugins/dsh-vivy-tone/src/client.js')

function reactStub(state) {
  let index = 0
  return {
    reset() { index = 0 },
    React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: value => {
        const slot = index++
        if (!(slot in state)) state[slot] = value
        return [state[slot], next => { state[slot] = typeof next === 'function' ? next(state[slot]) : next }]
      },
      useEffect: () => {},
      // The real component only acts after its mount effect ran; the stub has
      // no effects, so a fresh ref stands in for a mounted card.
      useRef: () => ({ current: true }),
      useCallback: fn => fn,
    },
  }
}

function loadClient(state, fetch) {
  let exported
  const react = reactStub(state)
  const window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        assert.equal(id, 'dsh-vivy-tone')
        exported = factory(() => react.React)
      },
    },
  }
  runInNewContext(readFileSync(CLIENT, 'utf8'), {
    window, fetch, setTimeout: () => 0, clearTimeout: () => {}, TextEncoder,
  })
  assert.ok(exported)
  return { exported, react }
}

function register(exported) {
  const entries = []
  const slots = []
  exported.apply({
    slots: {
      inject: (slot, install) => { slots.push(slot); install() },
      register: (options, component) => { entries.push({ options, component }); return () => {} },
    },
  })
  return { entries, slots }
}

function walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  return [node, ...node.children.flat(Infinity).flatMap(walk)]
}

const textOf = nodes => nodes
  .flatMap(node => (Array.isArray(node.children) ? node.children : []))
  .filter(child => typeof child === 'string')
  .join(' ')

const ENTRY = { ok: true, text: '旧的语气', defaultText: '默认语气', custom: false, maxChars: 20000 }

test('the card registers into the persona settings slot', () => {
  const { exported } = loadClient([], async () => new Response('{}'))
  const { entries, slots } = register(exported)
  assert.deepEqual(Array.from(exported.inject), ['slots'])
  assert.deepEqual(slots, ['settings.laputa.item'])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].options.name, 'settings.laputa.item')
  assert.equal(entries[0].options.id, 'vivy-tone')
})

test('renders the tone, its state and the actions', () => {
  const state = [ENTRY, ENTRY.text, false, false, '', '']
  const { exported } = loadClient(state, async () => new Response('{}'))
  const card = register(exported).entries[0].component
  const nodes = walk(card())
  assert.match(textOf(nodes), /语气/)
  assert.match(textOf(nodes), /插件默认/)
  const textarea = nodes.find(node => node.type === 'textarea')
  assert.ok(textarea)
  assert.equal(textarea.props.value, '旧的语气')
  assert.equal(textarea.props['aria-label'], '语气文本')
  assert.ok(nodes.some(node => node.type === 'button' && node.children.includes('保存')))
})

test('saving sends the draft and reports the new revision', async () => {
  const state = [ENTRY, '新的语气', false, false, '', '']
  const calls = []
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    return new Response(JSON.stringify({ ok: true, text: '新的语气', custom: true, revision: 4 }), { status: 200 })
  }
  const { exported } = loadClient(state, fetch)
  const card = register(exported).entries[0].component
  const button = walk(card()).find(node => node.type === 'button' && node.children.includes('保存'))
  assert.ok(button)
  await button.props.onClick()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, '/dsh-vivy-tone/api/tone')
  assert.equal(calls[0].options.method, 'PUT')
  assert.equal(calls[0].options.headers['content-type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].options.body), { text: '新的语气' })
  assert.match(String(state[5]), /r4/)
})

test('restoring the default fills the editor without saving', () => {
  const state = [ENTRY, '旧的语气', false, false, '', '']
  let calls = 0
  const { exported } = loadClient(state, async () => { calls += 1; return new Response('{}') })
  const card = register(exported).entries[0].component
  const button = walk(card()).find(node => node.type === 'button' && node.children.includes('恢复默认'))
  assert.ok(button)
  button.props.onClick()
  assert.equal(state[1], '默认语气')
  assert.equal(calls, 0)
})

test('a refused save surfaces the hint', async () => {
  const state = [ENTRY, '新的语气', false, false, '', '']
  const fetch = async () => new Response(JSON.stringify({
    ok: false, code: 'PROMPT_CONFLICT', error: 'Superagent 的提示词已被别处改动', hint: '刷新后重试',
  }), { status: 409 })
  const { exported } = loadClient(state, fetch)
  const card = register(exported).entries[0].component
  const button = walk(card()).find(node => node.type === 'button' && node.children.includes('保存'))
  await button.props.onClick()
  assert.match(String(state[4]), /刷新后重试/)
  assert.equal(state[5], '')
})
