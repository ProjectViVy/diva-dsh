import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { runInNewContext } from 'node:vm'

import {
  EvolutionError,
  assertSessionKey,
  emptyState,
  listEntries,
  readBenchmark,
  readHarnessState,
  readJsonlTail,
} from '../plugins/dsh-evolution/src/harness.mjs'
import { CONFIG_FIELDS, applyConfig, assertAllowedPatch, mergePatch, readConfig, resetConfig } from '../plugins/dsh-evolution/src/config.mjs'

const CLIENT = resolve('plugins/dsh-evolution/src/client.js')

function tempHome(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const home = mkdtempSync(join(base, 'evolution-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

test('a missing harness_state.json reads as the empty schema', async t => {
  const home = tempHome(t)
  assert.deepEqual(await readHarnessState(home), emptyState())
})

test('a corrupt harness_state.json reports STATE_INVALID instead of throwing a parse error', async t => {
  const home = tempHome(t)
  writeFileSync(join(home, 'harness_state.json'), '{ not json')
  await assert.rejects(readHarnessState(home), error => error instanceof EvolutionError && error.code === 'STATE_INVALID')
})

test('readJsonlTail skips corrupt lines, honors the limit, and drops a truncated first line', async t => {
  const home = tempHome(t)
  const corrupt = join(home, 'corrupt.jsonl')
  writeFileSync(corrupt, '{"id":1}\nnot-json\n\n{"id":2}\n')
  assert.deepEqual(await readJsonlTail(corrupt, 10), [{ id: 1 }, { id: 2 }])
  assert.deepEqual(await readJsonlTail(corrupt, 1), [{ id: 2 }])

  const truncated = join(home, 'truncated.jsonl')
  writeFileSync(truncated, `${JSON.stringify({ id: 'first', pad: 'x'.repeat(400) })}\n{"id":"second"}\n`)
  assert.deepEqual(await readJsonlTail(truncated, 10, 60), [{ id: 'second' }])
})

test('session keys reject traversal shapes before reaching the filesystem', () => {
  for (const key of ['', '.', '..', 'a/b', 'a\\b', '../escape']) {
    assert.throws(() => assertSessionKey(key), error => error instanceof EvolutionError && error.code === 'INVALID_SESSION')
  }
  assert.equal(assertSessionKey('session-1_ok.json'), 'session-1_ok.json')
})

test('listEntries filters by kind and searches id, title, and content', () => {
  const state = {
    entries: {
      prompt: { p1: { id: 'p1', kind: 'prompt', title: 'Alpha', content: 'rules', updatedAt: '2026-01-01T00:00:00.000Z' } },
      memory: { m1: { id: 'm1', kind: 'memory', title: 'Beta', content: 'alpha fact', updatedAt: '2026-02-01T00:00:00.000Z' } },
      skill: {},
      subagent: {},
    },
    refinements: [],
  }
  assert.deepEqual(listEntries(state).map(item => item.id), ['m1', 'p1'])
  assert.deepEqual(listEntries(state, { kind: 'memory' }).map(item => item.id), ['m1'])
  assert.deepEqual(listEntries(state, { q: 'ALPHA' }).map(item => item.id), ['m1', 'p1'])
  assert.deepEqual(listEntries(state, { q: 'missing' }), [])
})

test('readBenchmark reports a corrupt cases.json without throwing', async t => {
  const home = tempHome(t)
  mkdirSync(join(home, 'benchmark'))
  writeFileSync(join(home, 'benchmark', 'cases.json'), 'nope')
  writeFileSync(join(home, 'benchmark', 'runs.jsonl'), `${JSON.stringify({
    runId: 'r1',
    decision: { status: 'ACCEPTED', refinementId: 'x1', referenceOverall: 80, candidateOverall: 85, createdAt: '2026-01-01T00:00:00.000Z' },
  })}\n`)
  const result = await readBenchmark(home)
  assert.ok(result.casesError)
  assert.deepEqual(result.cases, [])
  assert.deepEqual(result.runs[0], {
    runId: 'r1', status: 'ACCEPTED', refinementId: 'x1',
    referenceOverall: 80, candidateOverall: 85, createdAt: '2026-01-01T00:00:00.000Z',
  })
  assert.deepEqual(result.snapshots, [])
})

test('config paths are unique and the write whitelist rejects unknown or invalid fields', () => {
  const keys = CONFIG_FIELDS.map(field => field.path.join('.'))
  assert.equal(new Set(keys).size, keys.length)

  assert.doesNotThrow(() => assertAllowedPatch({
    protectedKinds: ['prompt', 'memory'],
    injectionAnchor: 'query',
    benchmark: { passThreshold: 80 },
  }))
  for (const patch of [
    { harnessRoot: '/tmp/harness' },
    { autoRefine: { enabled: false } },
    { autoRefine: { unknown: 1 } },
    { benchmark: { passThreshold: 200 } },
    { autoRefine: { turnInterval: 0 } },
    { autoRefine: { turnInterval: 1.5 } },
    { injectionAnchor: 'nope' },
    { protectedKinds: ['other'] },
  ]) {
    assert.throws(() => assertAllowedPatch(patch), error => error instanceof EvolutionError && error.code === 'INVALID_FIELD')
  }
})

test('mergePatch deep-merges objects and replaces arrays wholesale', () => {
  const merged = mergePatch(
    { autoRefine: { enabled: true, turnInterval: 10 }, protectedKinds: ['prompt'], defaultGlobal: true },
    { autoRefine: { enabled: false }, protectedKinds: ['memory'] },
  )
  assert.deepEqual(merged, {
    autoRefine: { enabled: false, turnInterval: 10 },
    protectedKinds: ['memory'],
    defaultGlobal: true,
  })
})

test('applyConfig sends the merged raw config through configEditor.edit', async () => {
  const seen = []
  const entry = { options: { id: 'continual-harness' }, fiber: {} }
  const ctx = {
    configEditor: {
      entries: () => [entry],
      edit: async (_entry, change) => { seen.push(change({ protectedKinds: ['memory'] }, {})) },
    },
  }
  await applyConfig(ctx, { protectedKinds: ['memory'] })
  assert.deepEqual(seen, [{ protectedKinds: ['memory'] }])
})

test('resetConfig hands the inherited config back to configEditor.edit', async () => {
  const inherited = { autoRefine: { enabled: true } }
  const seen = []
  const entry = { options: { id: 'continual-harness' }, fiber: {} }
  const ctx = {
    configEditor: {
      entries: () => [entry],
      edit: async (_entry, change) => { seen.push(change({ autoRefine: { enabled: false } }, inherited)) },
    },
  }
  await resetConfig(ctx)
  assert.deepEqual(seen, [inherited])
  seen[0].autoRefine.enabled = false
  assert.equal(inherited.autoRefine.enabled, true)
})

test('readConfig projects the effective values and defaults the data directories', () => {
  const entry = { options: { id: 'continual-harness' }, fiber: { config: { autoRefine: { enabled: false } } } }
  const ctx = {
    configEditor: {
      documentPath: '/profile/cordis.patch.yml',
      configuration: () => [{ entry, override: { autoRefine: { enabled: false } }, inherited: {} }],
    },
  }
  const config = readConfig(ctx, '/dsh-home')
  assert.equal(config.available, true)
  assert.equal(config.active, true)
  assert.equal(config.documentPath, '/profile/cordis.patch.yml')
  assert.equal(config.harnessRoot, join('/dsh-home', 'harness'))
  assert.equal(config.skillsDir, join('/dsh-home', 'skills'))
  assert.deepEqual(config.values, { autoRefine: { enabled: false } })
})

function reactStub() {
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
    Fragment: Symbol('fragment'),
    useState: value => [value, () => {}],
    useEffect: () => {},
    useRef: value => ({ current: value }),
    useCallback: fn => fn,
  }
  return React
}

function loadClient(React) {
  let exported
  runInNewContext(readFileSync(CLIENT, 'utf8'), {
    window: {
      __ModuleLoader__: {
        load: ({ id, factory }) => {
          assert.equal(id, 'dsh-evolution')
          exported = factory(name => {
            if (name === 'react') return React
            throw new Error(`unexpected external ${name}`)
          })
        },
      },
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  })
  assert.ok(exported)
  return exported
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
      entriesOfSlot: () => [],
    },
    layout: { selectPanel: () => {} },
    effect: () => () => {},
  })
  return entries
}

function cssPreludes(css) {
  const preludes = []
  let depth = 0
  let buffer = ''
  for (const char of css) {
    if (char === '{') {
      preludes.push(buffer.trim())
      buffer = ''
      depth += 1
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      buffer = ''
    } else {
      buffer += char
    }
  }
  return preludes
}

test('the evolution client registers a main panel, sidebar entry, and settings row', () => {
  const exported = loadClient(reactStub())
  assert.deepEqual(Array.from(exported.inject), ['slots', 'layout'])
  const entries = register(exported)
  const main = entries.find(entry => entry.options.name === 'main')
  assert.equal(main.options.key, 'evolution')
  const sidebar = entries.find(entry => entry.options.name === 'sidebar.panellist')
  assert.equal(sidebar.options.id, 'evolution')
  assert.equal(sidebar.options.order, 15)
  assert.equal(sidebar.options.label(), '进化')
  const row = entries.find(entry => entry.options.name === 'settings.general.item')
  assert.equal(row.options.id, 'dsh-evolution')
  assert.equal(row.options.order, 92)
  assert.equal(typeof row.options.inject().openPanel, 'function')
})

test('the approval tab sits directly after 概览 and before AutoDream', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('const TABS = [')
  const block = source.slice(start, start + 400)
  const ids = [...block.matchAll(/\['([a-z]+)', '([^']+)'\]/g)].map(match => match[1])
  assert.deepEqual(ids.slice(0, 3), ['overview', 'approval', 'dream'])
})

test('the evolution CSS keeps every selector prefixed and only animates evo-in', () => {
  const source = readFileSync(CLIENT, 'utf8')
  const start = source.indexOf('const EVO_CSS = `')
  const end = source.indexOf('`\n\n    const ROW_CSS')
  assert.ok(start >= 0 && end > start)
  const css = source.slice(start + 'const EVO_CSS = `'.length, end)
  const preludes = cssPreludes(css).filter(prelude => !prelude.startsWith('@'))
  for (const prelude of preludes) {
    for (const selector of prelude.split(',')) {
      const value = selector.trim()
      if (!value || value === 'from' || value === 'to' || value === '0%' || value === '100%') continue
      assert.ok(
        value.includes('.evo-') || value.includes('.evolution-panel'),
        `unscoped selector: ${value}`,
      )
    }
  }
  const names = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map(match => match[1])
  assert.deepEqual([...new Set(names)], ['evo-in'])
  assert.equal((source.match(/styles\./g) ?? []).length, 0)
})

test('the plugin mounts a lazy record store and still renders /overview when it cannot open', async t => {
  const home = tempHome(t)
  mkdirSync(join(home, 'blocked'), { recursive: true })
  writeFileSync(join(home, 'blocked', 'not-a-dir'), 'a file where a directory should be')
  const saved = {
    DSH_HOME: process.env.DSH_HOME,
    DSH_SUBJECT_ID: process.env.DSH_SUBJECT_ID,
    DSH_EVOLUTION_STATE_DIR: process.env.DSH_EVOLUTION_STATE_DIR,
  }
  process.env.DSH_HOME = home
  process.env.DSH_SUBJECT_ID = 'subject_2f6a5e4b-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
  process.env.DSH_EVOLUTION_STATE_DIR = join(home, 'blocked', 'not-a-dir', 'evolution')
  t.after(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })
  const routes = []
  const disposers = []
  const ctx = {
    get: name => (name === 'connection' ? { requestRejection: () => undefined } : undefined),
    logger: { warn() {} },
    configEditor: { entries: () => [], documentPath: join(home, 'cordis.patch.yml') },
    webServer: { port: 3082, register: route => { routes.push(route); disposers.push(route.dispose ?? (() => {})); return () => {} } },
    effect: (run) => { const cleanup = run(); if (typeof cleanup === 'function') disposers.push(cleanup) },
  }
  const plugin = await import('../plugins/dsh-evolution/src/index.mjs')
  plugin.apply(ctx)
  // The component IPC endpoint publishes its loopback discovery file under
  // `<home>/evolution`, which is unavoidable. The laziness invariant is about
  // the record store: applying must not create or open the database.
  assert.deepEqual(readdirSync(join(home, 'evolution')), ['runtime.json'],
    'applying the plugin publishes discovery only, never the record store')
  assert.ok(!existsSync(join(home, 'evolution', 'evolution.db')), 'applying the plugin must not create the database')
  const call = async path => {
    const url = `/dsh-evolution/api${path}`
    const route = routes.find(item => url.startsWith(item.path))
    const req = Readable.from([])
    Object.assign(req, { url, method: 'GET', headers: { host: '127.0.0.1:3082' } })
    let status = 0
    let text = ''
    await route.handler(req, { writeHead: code => { status = code }, end: value => { text = value } })
    return { status, data: JSON.parse(text) }
  }
  const overview = await call('/overview')
  assert.equal(overview.status, 200, 'a broken record store must not take the harness views down')
  assert.equal(overview.data.snapshot.evolution.available, false)
  const store = await call('/store')
  assert.equal(store.status, 200)
  assert.equal(store.data.available, false)
  assert.ok(store.data.hint, 'the operator has to be told why the store is missing')
  for (const dispose of disposers) await dispose()
})

test('the records tab browses Evolution records through GET-only endpoints', () => {
  const source = readFileSync(CLIENT, 'utf8')
  assert.match(source, /\['records', '进化记录'\]/)
  assert.match(source, /function RecordsTab\(/)
  assert.match(source, /else if \(tab === 'records'\) content = h\(RecordsTab, \{ refreshKey \}\)/)
  const region = source.slice(source.indexOf('function RecordsTab('), source.indexOf('function SessionsTab('))
  assert.ok(region.length > 0)
  assert.ok((region.match(/request\(`/g) ?? []).length >= 2, 'list and detail each read through request')
  assert.equal((region.match(/, undefined, controller\.signal\)/g) ?? []).length, 2)
  assert.match(region, /encodeURIComponent/)
  assert.doesNotMatch(region, /method: 'POST'|body:/)
  // /proposal and /publication answer { ok, record: { id, kind, record, history } }.
  assert.match(region, /setDetail\(result\.record\)/)
  assert.doesNotMatch(region, /setDetail\(result\)/)
  assert.match(region, /kind === 'proposal' \|\| selected\.kind === 'publication'|selected\.kind === 'proposal' \|\| selected\.kind === 'publication'/)
})
