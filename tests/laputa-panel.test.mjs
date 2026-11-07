import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'

const CLIENT = resolve('plugins/dsh-laputa/src/client.js')

function reactStub(state) {
  let index = 0
  return {
    reset() { index = 0 },
    React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: value => {
        const slot = index++
        if (!(slot in state)) state[slot] = value
        return [state[slot], next => {
          state[slot] = typeof next === 'function' ? next(state[slot]) : next
        }]
      },
      useEffect: () => {},
      useRef: value => ({ current: value }),
      useCallback: fn => fn,
    },
  }
}

function loadClient(state) {
  let exported
  const react = reactStub(state)
  const window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        assert.equal(id, 'dsh-laputa')
        exported = factory(() => react.React)
      },
    },
  }
  runInNewContext(readFileSync(CLIENT, 'utf8'), {
    window, setTimeout: () => 0, clearTimeout: () => {}, TextEncoder,
  })
  assert.ok(exported)
  return { exported, react }
}

function register(exported) {
  const entries = []
  exported.apply({
    slots: {
      inject: (_slot, install) => install(),
      register: (options, component) => {
        entries.push({ options, component })
        return () => {}
      },
    },
  })
  return entries
}

function walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return []
  return [node, ...node.children.flat(Infinity).flatMap(walk)]
}

function textOf(nodes) {
  return nodes
    .flatMap(node => (Array.isArray(node.children) ? node.children : []))
    .filter(child => typeof child === 'string')
    .join(' ')
}

const FILE_DETAILS = {
  'MISSION.MD': { bytes: 7, digest: 'm', blank: false, exists: true },
  'IDENTITY.MD': { bytes: 8, digest: 'i', blank: false, exists: true },
  'RELATIONSHIP.MD': { bytes: 12, digest: 'r', blank: false, exists: true },
  'REDLINE.MD': { bytes: 7, digest: 'l', blank: false, exists: true },
  'DREAM.MD': { bytes: 0, digest: 'e', blank: true, exists: true },
  'DARK.MD': { bytes: 0, digest: 'e', blank: true, exists: true },
}

function status(overrides = {}) {
  return {
    enabled: true,
    loaded: true,
    initialized: false,
    personaId: 'vivy',
    directory: '/srv/persona/vivy',
    customSource: true,
    files: Object.fromEntries(Object.entries(FILE_DETAILS).map(([name, detail]) => [name, detail.bytes])),
    chars: 0,
    fingerprint: 'abcdef0123456789',
    pendingFiles: ['IDENTITY.MD', 'MISSION.MD'],
    pendingChanges: false,
    stale: false,
    revision: 1,
    liveDigest: 'e'.repeat(64),
    draftDigest: 'e'.repeat(64),
    draftInitialized: false,
    draftChars: 0,
    draftPendingFiles: ['IDENTITY.MD', 'MISSION.MD'],
    revisionPending: false,
    revisionCount: 1,
    stateDirectory: '/srv/persona/.state/vivy',
    ...overrides,
  }
}

function loadClientWithFetch(state, fetch, extras = {}) {
  const react = reactStub(state)
  let exported
  const window = {
    __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react.React) } },
    ...extras,
  }
  runInNewContext(readFileSync(CLIENT, 'utf8'), {
    window, fetch, setTimeout: () => 0, clearTimeout: () => {}, TextEncoder,
  })
  assert.ok(exported)
  return { exported, react }
}

function snapshot(overrides = {}) {
  return {
    ok: true,
    status: status({ initialized: true, pendingFiles: [], ...overrides }),
    fileDetails: FILE_DETAILS,
  }
}

function editorState() {
  return {
    name: '', content: '', loaded: '', digest: '', exists: false,
    loading: false, saving: false, error: '', conflict: false,
  }
}

function history(current = 2) {
  return {
    ok: true,
    current,
    revisions: [
      {
        revision: 1,
        createdAt: '2026-11-01T00:00:00.000Z',
        parent: null,
        restoredFrom: null,
        contentDigest: 'a'.repeat(64),
        current: current === 1,
      },
      {
        revision: 2,
        createdAt: '2026-11-02T00:00:00.000Z',
        parent: 1,
        restoredFrom: null,
        contentDigest: 'b'.repeat(64),
        current: current === 2,
      },
      {
        revision: 3,
        createdAt: '2026-11-03T00:00:00.000Z',
        parent: 2,
        restoredFrom: 1,
        contentDigest: 'c'.repeat(64),
        current: current === 3,
      },
    ],
  }
}

function revisionView(overrides = {}) {
  return {
    ok: true,
    revision: 1,
    liveRevision: 2,
    sameAsLive: false,
    manifest: {
      schemaVersion: 1,
      personaId: 'vivy',
      revision: 1,
      parent: null,
      restoredFrom: null,
      createdAt: '2026-11-01T00:00:00.000Z',
      contentDigest: 'a'.repeat(64),
      files: Object.fromEntries(Object.entries(FILE_DETAILS).map(([name, detail]) => [
        name,
        { bytes: detail.bytes, digest: detail.digest.padStart(64, '0') },
      ])),
    },
    diff: {
      from: 2,
      to: 1,
      files: [
        {
          name: 'MISSION.MD',
          changed: true,
          added: 1,
          removed: 1,
          truncated: false,
          hunks: [{
            oldStart: 1,
            oldLines: 1,
            newStart: 1,
            newLines: 1,
            lines: [
              { kind: 'remove', text: 'new mission', oldLine: 1, newLine: null },
              { kind: 'add', text: 'mission', oldLine: null, newLine: 1 },
            ],
          }],
        },
        {
          name: 'IDENTITY.MD',
          changed: false,
          added: 0,
          removed: 0,
          truncated: false,
          hunks: [],
        },
      ],
    },
    ...overrides,
  }
}

function laputaComponent(exported) {
  return register(exported).find(entry => entry.options.key === 'laputa').component
}

function findButton(nodes, label) {
  return [nodes].flat().flatMap(walk).find(node => node.type === 'button' && node.children.includes(label))
}

test('the laputa client registers a same-level main panel and sidebar entry', () => {
  const { exported, react } = loadClient([])
  assert.deepEqual(Array.from(exported.inject), ['slots'])
  const entries = register(exported)
  assert.ok(entries.some(entry => entry.options.name === 'main' && entry.options.key === 'laputa'))
  const sidebar = entries.find(entry => entry.options.name === 'sidebar.panellist')
  assert.ok(sidebar)
  assert.equal(sidebar.options.id, 'laputa')
  assert.equal(sidebar.options.order, 14)
  assert.equal(sidebar.options.label(), '人格')
  react.reset()
})

test('the overview explains the two questions while uninitialized', () => {
  const state = ['overview', { ok: true, status: status(), fileDetails: FILE_DETAILS }]
  const { exported } = loadClient(state)
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  const rendered = textOf(walk(component()))
  assert.match(rendered, /未初始化/)
  assert.match(rendered, /我是谁？/)
  assert.match(rendered, /我的使命是什么？/)
  assert.match(rendered, /IDENTITY\.MD/)
  assert.match(rendered, /MISSION\.MD/)
  assert.match(rendered, /去填写/)
})

test('the files tab shows each document size in bytes', () => {
  const state = [
    'files',
    { ok: true, status: status(), fileDetails: FILE_DETAILS },
    '', '', false, 'IDENTITY.MD',
  ]
  const { exported } = loadClient(state)
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  const rendered = textOf(walk(component()))
  assert.match(rendered, /7 B/)
  assert.match(rendered, /12 B/)
  assert.match(rendered, /0 B · 空白/)
})

test('saving a file sends its name, content, and loaded digest', async () => {
  const state = [
    'files',
    { ok: true, status: status({ initialized: true, pendingFiles: [] }), fileDetails: FILE_DETAILS },
    '', '', false, 'IDENTITY.MD',
    {
      name: 'IDENTITY.MD', content: 'changed identity\n', loaded: 'identity',
      digest: 'i', exists: true, loading: false, saving: false, error: '', conflict: false,
    },
  ]
  const calls = []
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/file') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: true, digest: 'new', status: status({ initialized: true, pendingFiles: [] }),
        fileDetails: FILE_DETAILS,
      }), { status: 200 })
    }
    if (url.endsWith('/status')) {
      return new Response(JSON.stringify({
        ok: true, status: status({ initialized: true, pendingFiles: [] }), fileDetails: FILE_DETAILS,
      }))
    }
    return new Response(JSON.stringify({ ok: true }))
  }
  const react = reactStub(state)
  let exported
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react.React) } } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), {
    window, fetch, setTimeout: () => 0, clearTimeout: () => {}, TextEncoder,
  })
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  react.reset()
  const button = walk(component()).find(node => node.type === 'button' && node.children.includes('保存'))
  assert.ok(button)
  await button.props.onClick()
  const posted = calls.find(call => call.options.method === 'POST' && call.url.endsWith('/file'))
  assert.ok(posted)
  assert.deepEqual(JSON.parse(posted.options.body), {
    name: 'IDENTITY.MD',
    content: 'changed identity\n',
    expectedDigest: 'i',
  })
})

test('a concurrent change shows a reload hint instead of overwriting', async () => {
  const state = [
    'files',
    { ok: true, status: status(), fileDetails: FILE_DETAILS },
    '', '', false, 'IDENTITY.MD',
    {
      name: 'IDENTITY.MD', content: 'mine\n', loaded: 'identity',
      digest: 'i', exists: true, loading: false, saving: false, error: '', conflict: false,
    },
  ]
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/file') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: false, code: 'FILE_CHANGED', error: '文件已被其他方式修改',
      }), { status: 409 })
    }
    return new Response(JSON.stringify({ ok: true, status: status(), fileDetails: FILE_DETAILS }))
  }
  const react = reactStub(state)
  let exported
  const window = { __ModuleLoader__: { load: ({ factory }) => { exported = factory(() => react.React) } } }
  runInNewContext(readFileSync(CLIENT, 'utf8'), {
    window, fetch, setTimeout: () => 0, clearTimeout: () => {}, TextEncoder,
  })
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  react.reset()
  const button = walk(component()).find(node => node.type === 'button' && node.children.includes('保存'))
  await button.props.onClick()
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /文件已被其他方式修改/)
  assert.match(rendered, /重新加载此文件/)
})

test('the overview shows the live revision and a pending draft', () => {
  const state = ['overview', {
    ok: true,
    status: status({
      initialized: true,
      pendingFiles: [],
      draftInitialized: true,
      revision: 2,
      revisionCount: 2,
      revisionPending: true,
    }),
    fileDetails: FILE_DETAILS,
  }]
  const { exported } = loadClient(state)
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  const rendered = textOf(walk(component()))
  assert.match(rendered, /版本/)
  assert.match(rendered, /r2 · 共 2 个/)
  assert.match(rendered, /有未发布修改/)
  assert.match(rendered, /发布草稿/)
})

test('publishing sends the base revision and draft digest', async () => {
  const live = status({
    initialized: true,
    pendingFiles: [],
    draftInitialized: true,
    revision: 2,
    revisionCount: 2,
    revisionPending: true,
    draftDigest: 'd'.repeat(64),
    liveDigest: 'e'.repeat(64),
  })
  const next = status({
    initialized: true,
    pendingFiles: [],
    draftInitialized: true,
    revision: 3,
    revisionCount: 3,
    revisionPending: false,
    draftDigest: 'd'.repeat(64),
    liveDigest: 'd'.repeat(64),
  })
  const state = ['overview', { ok: true, status: live, fileDetails: FILE_DETAILS }]
  const calls = []
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/publish')) {
      return new Response(JSON.stringify({
        ok: true, published: true, revision: 3, status: next, fileDetails: FILE_DETAILS,
      }))
    }
    return new Response(JSON.stringify({ ok: true, status: next, fileDetails: FILE_DETAILS }))
  }
  const { exported, react } = loadClientWithFetch(state, fetch)
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  const button = walk(component()).find(node => node.type === 'button' && node.children.includes('发布草稿'))
  assert.ok(button)
  assert.equal(button.props.disabled, false)
  await button.props.onClick()
  const posted = calls.find(call => call.options.method === 'POST' && call.url.endsWith('/publish'))
  assert.ok(posted)
  assert.deepEqual(JSON.parse(posted.options.body), {
    expectedBaseRevision: 2,
    expectedDraftDigest: 'd'.repeat(64),
  })
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /已发布 r3；新会话生效/)
})

test('a publish conflict refreshes the panel and reports the error', async () => {
  const live = status({
    initialized: true,
    pendingFiles: [],
    draftInitialized: true,
    revision: 2,
    revisionCount: 2,
    revisionPending: true,
    draftDigest: 'd'.repeat(64),
    liveDigest: 'e'.repeat(64),
  })
  const state = ['overview', { ok: true, status: live, fileDetails: FILE_DETAILS }]
  let statusCalls = 0
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/publish') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: false, code: 'REVISION_CONFLICT', error: 'revision conflict',
      }), { status: 409 })
    }
    statusCalls += 1
    return new Response(JSON.stringify({ ok: true, status: live, fileDetails: FILE_DETAILS }))
  }
  const { exported, react } = loadClientWithFetch(state, fetch)
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  const button = walk(component()).find(node => node.type === 'button' && node.children.includes('发布草稿'))
  await button.props.onClick()
  assert.ok(statusCalls >= 1)
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /版本已在其他位置变化/)
  assert.doesNotMatch(rendered, /已发布 r/)
})

test('saving reports a draft save that still needs publishing', async () => {
  const state = [
    'files',
    { ok: true, status: status({ initialized: true, pendingFiles: [] }), fileDetails: FILE_DETAILS },
    '', '', false, 'IDENTITY.MD',
    {
      name: 'IDENTITY.MD', content: 'changed identity\n', loaded: 'identity',
      digest: 'i', exists: true, loading: false, saving: false, error: '', conflict: false,
    },
  ]
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/file') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: true,
        digest: 'new',
        status: status({
          initialized: true,
          pendingFiles: [],
          draftInitialized: true,
          revisionPending: true,
        }),
        fileDetails: FILE_DETAILS,
      }))
    }
    return new Response(JSON.stringify({
      ok: true,
      status: status({ initialized: true, pendingFiles: [] }),
      fileDetails: FILE_DETAILS,
    }))
  }
  const { exported, react } = loadClientWithFetch(state, fetch)
  const entries = register(exported)
  const component = entries.find(entry => entry.options.key === 'laputa').component
  const button = walk(component()).find(node => node.type === 'button' && node.children.includes('保存'))
  await button.props.onClick()
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /已保存草稿；发布后生效/)
  assert.doesNotMatch(rendered, /下一轮对话生效/)
})

test('the version tab appears only with a revision store', () => {
  const withStore = loadClient(['overview', snapshot()])
  let component = laputaComponent(withStore.exported)
  assert.ok(findButton(component(), '版本'))
  withStore.react.reset()

  const withoutStore = loadClient([
    'overview',
    snapshot({ stateDirectory: null }),
  ])
  component = laputaComponent(withoutStore.exported)
  assert.equal(findButton(component(), '版本'), undefined)
})

test('opening the version tab loads revision history', async () => {
  const state = ['overview', snapshot()]
  const calls = []
  const fetch = async url => {
    calls.push(url)
    if (url.endsWith('/revisions')) return new Response(JSON.stringify(history()))
    return new Response(JSON.stringify(snapshot()))
  }
  const { exported, react } = loadClientWithFetch(state, fetch)
  const component = laputaComponent(exported)
  const tab = findButton(component(), '版本')
  assert.ok(tab)
  await tab.props.onClick()
  assert.ok(calls.some(url => url.endsWith('/revisions')))
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /版本历史/)
  assert.match(rendered, /r1/)
  assert.match(rendered, /初始版本/)
  assert.match(rendered, /发布基于 r1/)
  assert.match(rendered, /回滚自 r1/)
  assert.match(rendered, /当前/)
})

test('selecting an old revision renders the server diff', () => {
  const state = [
    'history', snapshot(), '', '', false, 'IDENTITY.MD', editorState(),
    history(), '', false, 1, revisionView(),
  ]
  const { exported } = loadClient(state)
  const component = laputaComponent(exported)
  const nodes = walk(component())
  const rendered = textOf(nodes)
  assert.match(rendered, /差异方向：当前 r2 → r1（回滚后）/)
  assert.match(rendered, /MISSION\.MD/)
  assert.match(rendered, /\+1 -1/)
  assert.match(rendered, /new mission/)
  assert.match(rendered, /mission/)
  assert.match(rendered, /无变化/)
  assert.ok(findButton(nodes, '回滚到 r1'))
  assert.ok(nodes.some(node => node.props?.className === 'lp-diff-line remove'))
  assert.ok(nodes.some(node => node.props?.className === 'lp-diff-line add'))
})

test('rollback posts the target and expected base, then reports the new revision', async () => {
  const live = snapshot({
    revision: 2,
    revisionCount: 2,
    draftInitialized: true,
    revisionPending: true,
    draftDigest: 'd'.repeat(64),
  })
  const state = [
    'history', live, '', '', false, 'IDENTITY.MD', editorState(),
    history(), '', false, 1, revisionView(),
  ]
  const calls = []
  let confirmMessage = ''
  const confirm = message => {
    confirmMessage = message
    return true
  }
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    if (url.endsWith('/rollback') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: true,
        published: true,
        revision: 3,
        status: status({
          initialized: true,
          pendingFiles: [],
          revision: 3,
          revisionCount: 3,
          draftInitialized: true,
          draftDigest: 'f'.repeat(64),
          liveDigest: 'f'.repeat(64),
        }),
        fileDetails: FILE_DETAILS,
      }))
    }
    if (url.includes('/revision?revision=3')) {
      return new Response(JSON.stringify(revisionView({
        revision: 3,
        liveRevision: 3,
        sameAsLive: true,
        diff: null,
        manifest: {
          ...revisionView().manifest,
          revision: 3,
          parent: 2,
          restoredFrom: 1,
          contentDigest: 'c'.repeat(64),
        },
      })))
    }
    if (url.endsWith('/revisions')) return new Response(JSON.stringify(history(3)))
    return new Response(JSON.stringify(live))
  }
  const { exported, react } = loadClientWithFetch(state, fetch, { confirm })
  const component = laputaComponent(exported)
  const button = findButton(component(), '回滚到 r1')
  assert.ok(button)
  await button.props.onClick()

  const posted = calls.find(call =>
    call.url.endsWith('/rollback') && call.options.method === 'POST')
  assert.ok(posted)
  assert.deepEqual(JSON.parse(posted.options.body), {
    targetRevision: 1,
    expectedBaseRevision: 2,
    expectedDraftDigest: 'd'.repeat(64),
  })
  assert.match(confirmMessage, /草稿/)

  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /已回滚到 r1，生成 r3；新会话生效/)
})

test('a rollback conflict refreshes and reports instead of claiming success', async () => {
  let statusCalls = 0
  let confirmMessage = ''
  const confirm = message => {
    confirmMessage = message
    return true
  }
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/rollback') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: false, code: 'REVISION_CONFLICT', error: 'revision conflict',
      }), { status: 409 })
    }
    if (url.endsWith('/status')) {
      statusCalls += 1
      return new Response(JSON.stringify(snapshot()))
    }
    if (url.endsWith('/revisions')) return new Response(JSON.stringify(history()))
    return new Response(JSON.stringify(snapshot()))
  }
  const state = [
    'history',
    snapshot({ revision: 2, revisionCount: 2, draftInitialized: true }),
    '', '', false, 'IDENTITY.MD', editorState(),
    history(), '', false, 1, revisionView(),
  ]
  const { exported, react } = loadClientWithFetch(state, fetch, { confirm })
  const component = laputaComponent(exported)
  await findButton(component(), '回滚到 r1').props.onClick()
  assert.ok(statusCalls >= 1)
  assert.match(confirmMessage, /回滚会创建新版本/)
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /版本已在其他位置变化，请刷新后再回滚。/)
  assert.doesNotMatch(rendered, /已回滚到 r/)
})

test('cancelling the rollback confirmation sends no request', async () => {
  const calls = []
  const fetch = async (url, options = {}) => {
    calls.push({ url, options })
    return new Response(JSON.stringify(snapshot()))
  }
  const state = [
    'history', snapshot(), '', '', false, 'IDENTITY.MD', editorState(),
    history(), '', false, 1, revisionView(),
  ]
  const { exported } = loadClientWithFetch(state, fetch, {
    confirm: () => false,
  })
  const component = laputaComponent(exported)
  await findButton(component(), '回滚到 r1').props.onClick()
  assert.equal(calls.length, 0)
})

test('an identical rollback reports that no revision was created', async () => {
  let confirmMessage = ''
  const fetch = async (url, options = {}) => {
    if (url.endsWith('/rollback') && options.method === 'POST') {
      return new Response(JSON.stringify({
        ok: true,
        published: false,
        revision: 2,
        status: status({ initialized: true, pendingFiles: [], revision: 2 }),
        fileDetails: FILE_DETAILS,
      }))
    }
    if (url.includes('/revision?revision=2')) {
      return new Response(JSON.stringify(revisionView({
        revision: 2,
        liveRevision: 2,
        sameAsLive: true,
        diff: null,
      })))
    }
    if (url.endsWith('/revisions')) return new Response(JSON.stringify(history()))
    return new Response(JSON.stringify(snapshot()))
  }
  const state = [
    'history', snapshot(), '', '', false, 'IDENTITY.MD', editorState(),
    history(), '', false, 1, revisionView(),
  ]
  const { exported, react } = loadClientWithFetch(state, fetch, {
    confirm: message => {
      confirmMessage = message
      return true
    },
  })
  const component = laputaComponent(exported)
  await findButton(component(), '回滚到 r1').props.onClick()
  assert.match(confirmMessage, /回滚会创建新版本/)
  react.reset()
  const rendered = textOf(walk(component()))
  assert.match(rendered, /目标版本与当前内容一致，未生成新版本/)
})
