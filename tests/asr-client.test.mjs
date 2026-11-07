// 客户端插件测试：只验证「注册到哪个槽位」和「初始渲染不炸」。
// 录音与插入要靠浏览器（见 README 的手工验收步骤），这里不假装跑得过。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const CLIENT = resolve('plugins/asr/src/client.js')

/** 极简 React 替身：createElement 出普通树，hook 只记账不重渲染。 */
function fakeReact() {
  const effects = []
  return {
    effects,
    api: {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: (fn, deps) => { effects.push({ fn, deps }) },
      useMemo: fn => fn(),
      useCallback: fn => fn,
      useRef: value => ({ current: value }),
    },
  }
}

function load() {
  let exported = null
  const react = fakeReact()
  const window = { __ModuleLoader__: { load: ({ id, factory }) => { assert.equal(id, 'dsh-local-asr'); exported = factory(() => react.api) } } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), { window })
  const entries = []
  const slots = []
  exported.apply({ slots: {
    inject: (slot, register) => { slots.push(slot); register() },
    register: (options, component) => entries.push({ options, component }),
  } })
  return { entries, slots, react }
}

/** 把一个渲染树摊平成节点数组。 */
function walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  const children = (node.children ?? []).flat(Infinity)
  return [node, ...children.flatMap(walk)]
}

test('the client registers only the composer microphone', () => {
  const { entries, slots } = load()
  assert.deepEqual(slots, ['conversation.input.activity'])
  assert.equal(entries.length, 1)
  assert.equal(entries[0].options.name, 'conversation.input.activity')
  assert.equal(typeof entries[0].component, 'function')
})

test('the microphone control collapses to a single button and respects locked', () => {
  const { entries } = load()
  const MicControl = entries[0].component
  const locked = walk(MicControl({ sessionId: 's1', inputActions: {}, locked: true, onActiveChange: () => {} }))
  const button = locked.find(node => node.type === 'button')
  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-label'], '准备语音识别模型')
  assert.equal(button.props.title, '识别模型还没准备好（点一下开始下载）')
  const free = walk(MicControl({ sessionId: 's1', inputActions: {}, locked: false, onActiveChange: () => {} }))
  assert.equal(free.find(node => node.type === 'button').props.disabled, false)
})

test('the stylesheet is mounted at apply time and only styles the microphone', () => {
  // The microphone lives in conversation.input.activity; configuration moved to
  // settings, so the old panel selectors must not ship to every page.
  let exported = null
  const react = fakeReact()
  const mounted = []
  const document = {
    createElement: tag => ({ tag, id: '', dataset: {}, textContent: '', remove() {} }),
    head: { appendChild: node => mounted.push(node) },
  }
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react.api) } } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), { window, document })

  const entries = []
  const disposers = []
  exported.apply({
    slots: { inject: (_slot, register) => register(), register: (options, component) => entries.push({ options, component }) },
    effect: callback => { disposers.push(callback); return () => {} },
  })

  assert.equal(mounted.length, 1, 'the stylesheet is mounted exactly once')
  const css = mounted[0].textContent
  assert.match(css, /\.asr-mic-btn\{/)
  assert.match(css, /\.asr-mic,\.asr-mic \*\{box-sizing:border-box\}/, 'the mic keeps its authored 28px box outside the panel reset')
  assert.doesNotMatch(css, /\.asr-panel/, 'the retired panel styles must not ship')
  assert.equal(entries.length, 1)
  assert.equal(walk(entries[0].component({ sessionId: 's1', inputActions: {}, locked: false, onActiveChange: () => {} })).some(node => node.type === 'style'), false)
})

test('the source keeps the recording pipeline and never re-registers a panel', () => {
  const source = readFileSync(CLIENT, 'utf8')
  assert.match(source, /'\/dsh-asr\/api'/)
  assert.match(source, /captureInsertion\(\)/)
  assert.match(source, /insertText\(/)
  assert.match(source, /OfflineAudioContext/)
  assert.doesNotMatch(source, /sidebar\.panellist/)
  assert.doesNotMatch(source, /name:\s*'main'/)
  assert.doesNotMatch(source, /语音识别当前是关闭的/)
})
