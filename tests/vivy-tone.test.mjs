/**
 * dsh-vivy-tone — unit tests.
 *
 * Nothing here touches a real Superagent: the prompt API is a fake that records
 * what was sent, and the state directory is a fresh `mkdtemp`.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { resolveConfig } from '../plugins/dsh-vivy-tone/src/config.mjs'
import { applyTranslations, removeTranslations, resolveStateDir, defaultStateDir, saveTone } from '../plugins/dsh-vivy-tone/src/install.mjs'
import { parseArgs } from '../plugins/dsh-vivy-tone/src/cli.mjs'
import {
  composeConfig, hashText, normalizeView, planParts, readPrompts, readState, stripConfig, writeState,
} from '../plugins/dsh-vivy-tone/src/write.mjs'
import { DEFAULT_TONE, ORCHESTRATOR_HEAD, REQUIRED_PLACEHOLDERS, TRANSLATIONS, missingPlaceholders } from '../plugins/dsh-vivy-tone/src/zh.mjs'
import {
  MAX_TONE_CHARS, TONE_FILE, composeOrchestrator, normalizeTone, readTone, toneTable, writeTone,
} from '../plugins/dsh-vivy-tone/src/tone.mjs'
import { TONE_PREFIX, registerTonePanel } from '../plugins/dsh-vivy-tone/src/server.mjs'

const TEAM = Object.freeze({
  communication: '## communication\nEnglish team text',
  scope: '## scope\nEnglish team text',
  delivery: '## delivery\nEnglish team text',
  skills: {},
})

const dirs = []

it('waits for the prompt route during startup without retrying writes', async () => {
  let calls = 0
  const result = await readPrompts({ baseUrl: 'http://localhost', waitForReadyMs: 1000,
    fetchImpl: async (_url, options) => {
      assert.equal(options.method, 'GET')
      calls += 1
      return calls === 1 ? new Response('', { status: 404 }) : Response.json({ revision: 3, parts: [] })
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.revision, 3)
})

it('does not retry a prompt permission failure during startup', async () => {
  let calls = 0
  await assert.rejects(readPrompts({ baseUrl: 'http://localhost', waitForReadyMs: 1000,
    fetchImpl: async () => { calls += 1; return new Response('', { status: 403 }) },
  }), /HTTP 403/)
  assert.equal(calls, 1)
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'vivy-tone-'))
  dirs.push(dir)
  return dir
}
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

/** A view shaped like `GET /orchestrator/api/prompts` returns. */
const view = ({ overrides } = {}) => normalizeView({
  revision: overrides ? 7 : 0,
  current: { config: { ...TEAM, ...(overrides ? { overrides } : {}) } },
  parts: [
    { key: 'runtime/orchestrator', roles: ['orchestrator'], text: 'English A', base: 'base-a' },
    { key: 'runtime/environment', roles: ['orchestrator', 'worker'], text: 'English B', base: 'base-b' },
  ],
})

const json = (status, body) => ({
  ok: status < 400,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
})

/** A `fetch` that returns `initial` on GET and records every PUT body. */
function fakeFetch(initial) {
  const puts = []
  const gets = []
  const impl = async (url, init = {}) => {
    if ((init.method ?? 'GET') === 'GET') {
      gets.push(url)
      return json(200, initial)
    }
    const body = JSON.parse(String(init.body))
    puts.push(body)
    return json(200, { revision: (initial.revision ?? 0) + puts.length })
  }
  return { impl, puts, gets }
}

describe('the translated texts', () => {
  it('keeps every placeholder Superagent requires', () => {
    for (const part of Object.keys(TRANSLATIONS)) {
      assert.deepEqual(missingPlaceholders(part, TRANSLATIONS[part]), [], part)
    }
    assert.deepEqual(Object.keys(REQUIRED_PLACEHOLDERS).sort(), ['runtime/environment', 'runtime/policy', 'runtime/policy/none'])
  })

  it('is Chinese, not a copy of the built-in', () => {
    for (const [part, text] of Object.entries(TRANSLATIONS)) {
      assert.match(text, /[\u4e00-\u9fff]/u, `${part} has no Chinese`)
      assert.ok(text.length > 20, part)
    }
  })

  it('carries no persona, so Laputa stays the only persona source', () => {
    for (const [part, text] of Object.entries(TRANSLATIONS)) {
      for (const forbidden of ['汐', 'Laputa', 'laputa', '大湿', '你是我的', '伴侣']) {
        assert.ok(!text.includes(forbidden), `${part} mentions ${forbidden}`)
      }
    }
  })

  it('keeps identifiers other parts and tools refer to by name', () => {
    assert.match(TRANSLATIONS['runtime/orchestrator'], /ticket/)
    assert.match(TRANSLATIONS['runtime/orchestrator'], /worker/)
    assert.match(TRANSLATIONS['runtime/handoff/orchestrator'], /orchestrator_reply/)
    assert.match(TRANSLATIONS['runtime/handoff/orchestrator'], /attention\.question/)
    assert.match(TRANSLATIONS['runtime/handoff/orchestrator'], /human_action/)
    assert.match(TRANSLATIONS['runtime/policy'], /^## Policy\n/u)
    assert.match(TRANSLATIONS['runtime/policy/none'], /^## Policy\n/u)
  })
})

describe('planParts', () => {
  it('writes every part of the wave, carrying the built-in base', () => {
    const { writes, skipped } = planParts({ view: view(), table: { 'runtime/orchestrator': '中文 A' } })
    assert.deepEqual(skipped, [])
    assert.deepEqual(writes, [{ part: 'runtime/orchestrator', text: '中文 A', base: 'base-a' }])
  })

  it('skips a part that already holds our text', () => {
    const { writes, skipped } = planParts({
      view: view({ overrides: { 'runtime/orchestrator': { text: '中文 A', base: 'base-a' } } }),
      table: { 'runtime/orchestrator': '中文 A' },
    })
    assert.deepEqual(writes, [])
    assert.deepEqual(skipped, [{ part: 'runtime/orchestrator', reason: 'current' }])
  })

  it('never replaces an override this package did not write', () => {
    const { writes, skipped } = planParts({
      view: view({ overrides: { 'runtime/orchestrator': { text: '人手改过的', base: 'base-a' } } }),
      table: { 'runtime/orchestrator': '中文 A' },
      installed: { 'runtime/orchestrator': hashText('很久以前本包写的中文') },
    })
    assert.deepEqual(writes, [])
    assert.deepEqual(skipped, [{ part: 'runtime/orchestrator', reason: 'foreign' }])
  })

  it('upgrades a part this package wrote earlier', () => {
    const { writes } = planParts({
      view: view({ overrides: { 'runtime/orchestrator': { text: '旧的中文', base: 'base-a' } } }),
      table: { 'runtime/orchestrator': '新的中文' },
      installed: { 'runtime/orchestrator': hashText('旧的中文') },
    })
    assert.equal(writes.length, 1)
    assert.equal(writes[0].replacing, 'ours')
  })

  it('force replaces a foreign override, and says so', () => {
    const { writes } = planParts({
      view: view({ overrides: { 'runtime/orchestrator': { text: '人手改过的', base: 'base-a' } } }),
      table: { 'runtime/orchestrator': '中文 A' },
      force: true,
    })
    assert.equal(writes[0].replacing, 'foreign')
  })

  it('reports a part this Superagent does not have, and our own missing placeholder', () => {
    const withPolicy = normalizeView({
      revision: 0,
      current: { config: { ...TEAM } },
      parts: [{ key: 'runtime/policy', roles: ['orchestrator'], text: 'English P', base: 'base-p' }],
    })
    const { writes, skipped } = planParts({
      view: withPolicy,
      table: { 'runtime/ghost': '中文', 'runtime/policy': '缺了占位符的模板' },
    })
    assert.deepEqual(writes, [])
    assert.deepEqual(skipped, [
      { part: 'runtime/ghost', reason: 'unknown-part' },
      { part: 'runtime/policy', reason: 'missing-placeholder', missing: ['{version}', '{mode}', '{rules}'] },
    ])
  })

  it('checks the real table against placeholders without a view lookup', () => {
    for (const [part, text] of Object.entries(TRANSLATIONS)) {
      assert.deepEqual(missingPlaceholders(part, text), [])
    }
  })
})

describe('composeConfig and stripConfig', () => {
  it('carries the team sections and skills through a save', () => {
    const config = composeConfig(view(), [{ part: 'runtime/orchestrator', text: '中文 A', base: 'base-a' }])
    assert.equal(config.communication, TEAM.communication)
    assert.equal(config.scope, TEAM.scope)
    assert.equal(config.delivery, TEAM.delivery)
    assert.deepEqual(config.skills, {})
    assert.deepEqual(config.overrides, { 'runtime/orchestrator': { text: '中文 A', base: 'base-a' } })
  })

  it('leaves an unrelated override in place', () => {
    const config = composeConfig(
      view({ overrides: { 'runtime/replies': { text: '别人的', base: 'x' } } }),
      [{ part: 'runtime/orchestrator', text: '中文 A', base: 'base-a' }],
    )
    assert.deepEqual(Object.keys(config.overrides).sort(), ['runtime/orchestrator', 'runtime/replies'])
  })

  it('removes only the named parts, and drops the key when none are left', () => {
    const config = stripConfig(view({ overrides: { 'runtime/orchestrator': { text: 'x' }, 'runtime/replies': { text: 'y' } } }), ['runtime/orchestrator'])
    assert.deepEqual(Object.keys(config.overrides), ['runtime/replies'])
    const empty = stripConfig(view({ overrides: { 'runtime/orchestrator': { text: 'x' } } }), ['runtime/orchestrator'])
    assert.ok(!Object.hasOwn(empty, 'overrides'))
    assert.equal(empty.communication, TEAM.communication)
  })
})

describe('the state file', () => {
  it('round-trips, and a corrupt file reads as empty rather than throwing', () => {
    const dir = tempDir()
    assert.deepEqual(readState(dir), { parts: {} })
    const file = writeState(dir, { parts: { 'runtime/orchestrator': 'abc' }, revision: 3 })
    assert.equal(readState(dir).parts['runtime/orchestrator'], 'abc')
    writeFileSync(file, '{ not json')
    assert.deepEqual(readState(dir), { parts: {} })
  })
})

describe('applyTranslations and removeTranslations', () => {
  it('writes the whole wave in one save and records what it wrote', async () => {
    const stateDir = tempDir()
    const initial = { revision: 0, current: { config: { ...TEAM } }, parts: Object.entries(TRANSLATIONS).map(([key]) => ({ key, text: 'English', base: `base-${key}` })) }
    const { impl, puts } = fakeFetch(initial)
    const result = await applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl })

    assert.equal(result.saved, true)
    assert.equal(puts.length, 1)
    assert.equal(puts[0].baseRevision, 0)
    assert.deepEqual(Object.keys(puts[0].config.overrides).sort(), Object.keys(TRANSLATIONS).sort())
    assert.equal(puts[0].config.communication, TEAM.communication)
    for (const part of Object.keys(TRANSLATIONS)) {
      assert.equal(puts[0].config.overrides[part].base, `base-${part}`)
      assert.equal(readState(stateDir).parts[part], hashText(TRANSLATIONS[part]))
    }
  })

  it('is idempotent: a second run writes nothing', async () => {
    const stateDir = tempDir()
    const overrides = Object.fromEntries(Object.entries(TRANSLATIONS).map(([part, text]) => [part, { text, base: `base-${part}` }]))
    const initial = { revision: 1, current: { config: { ...TEAM, overrides } }, parts: Object.entries(TRANSLATIONS).map(([key]) => ({ key, text: TRANSLATIONS[key], base: `base-${key}` })) }
    const { impl, puts } = fakeFetch(initial)
    const result = await applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl })
    assert.equal(result.saved, false)
    assert.equal(puts.length, 0)
  })

  it('refuses to touch a hand edit, and still saves the parts that are new', async () => {
    const stateDir = tempDir()
    const initial = {
      revision: 4,
      current: { config: { ...TEAM, overrides: { 'runtime/orchestrator': { text: '人手写的', base: 'base-x' } } } },
      parts: Object.entries(TRANSLATIONS).map(([key]) => ({ key, text: 'English', base: `base-${key}` })),
    }
    const { impl, puts } = fakeFetch(initial)
    const result = await applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl })
    assert.deepEqual(result.skipped, [{ part: 'runtime/orchestrator', reason: 'foreign' }])
    // A save replaces the whole configuration, so the hand edit must travel
    // through untouched: dropping it would delete it.
    assert.equal(puts[0].config.overrides['runtime/orchestrator'].text, '人手写的')
    assert.equal(puts[0].config.overrides['runtime/policy'] !== undefined, true)
    assert.ok(!Object.hasOwn(readState(stateDir).parts, 'runtime/orchestrator'))
  })

  it('dry-run reads but never saves', async () => {
    const stateDir = tempDir()
    const initial = { revision: 0, current: { config: { ...TEAM } }, parts: [{ key: 'runtime/orchestrator', text: 'English', base: 'base-a' }] }
    const { impl, puts } = fakeFetch(initial)
    const result = await applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl, dryRun: true })
    assert.equal(result.dryRun, true)
    assert.equal(puts.length, 0)
    assert.ok(!existsSync(join(stateDir, 'installed.json')))
  })

  it('remove takes back only our parts and forgets them', async () => {
    const stateDir = tempDir()
    writeState(stateDir, { parts: { 'runtime/orchestrator': hashText(TRANSLATIONS['runtime/orchestrator']) } })
    const initial = {
      revision: 9,
      current: {
        config: {
          ...TEAM,
          overrides: {
            'runtime/orchestrator': { text: TRANSLATIONS['runtime/orchestrator'], base: 'base-a' },
            'runtime/replies': { text: '别人的', base: 'base-r' },
          },
        },
      },
      parts: [],
    }
    const { impl, puts } = fakeFetch(initial)
    const result = await removeTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl })
    assert.deepEqual(result.removed, ['runtime/orchestrator'])
    assert.deepEqual(Object.keys(puts[0].config.overrides), ['runtime/replies'])
    assert.deepEqual(readState(stateDir).parts, {})
  })

  it('surfaces an API refusal instead of pretending it worked', async () => {
    const stateDir = tempDir()
    const fail = async () => json(409, { error: 'Prompt version changed to 3' })
    await assert.rejects(
      () => applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: fail }),
      error => error.name === 'PromptsApiError' && error.status === 409,
    )
  })
})

describe('configuration', () => {
  it('defaults to on, and refuses a misspelled key', () => {
    const config = resolveConfig({})
    assert.deepEqual({ ...config }, { enabled: true, autoInstall: true, force: false, stateDir: '', timeoutMs: 10000 })
    assert.throws(() => resolveConfig({ install: true }), /unknown key "install"/)
    assert.throws(() => resolveConfig({ enabled: 'false' }), /"enabled" must be a boolean/)
    assert.throws(() => resolveConfig({ timeoutMs: 0 }), /"timeoutMs" must be a positive integer/)
  })

  it('resolves the state directory the same way for the plugin and the CLI', () => {
    const env = { DSH_HOME: '/tmp/dsh-home' }
    assert.equal(defaultStateDir(env), '/tmp/dsh-home/vivy-tone')
    assert.equal(resolveStateDir('/absolute/vivy', env), '/absolute/vivy')
    assert.equal(resolveStateDir('nested', env), join(process.cwd(), 'nested'))
    assert.equal(resolveStateDir('', env), '/tmp/dsh-home/vivy-tone')
  })
})

describe('the CLI arguments', () => {
  it('reads the three actions and refuses anything else', () => {
    assert.deepEqual(parseArgs(['--install']), { action: 'install', url: 'http://127.0.0.1:3082', dryRun: false, force: false, stateDir: '' })
    assert.equal(parseArgs(['--remove', '--dry-run']).dryRun, true)
    assert.equal(parseArgs(['--status', '--url', 'http://127.0.0.1:9999/']).url, 'http://127.0.0.1:9999/')
    assert.throws(() => parseArgs(['--wat']), /unknown argument "--wat"/)
  })
})

describe('the editable tone', () => {
  it('splits the orchestrator part into the package head and the shipped tone', () => {
    assert.equal(TRANSLATIONS['runtime/orchestrator'], composeOrchestrator(DEFAULT_TONE))
    assert.ok(!ORCHESTRATOR_HEAD.includes('## 怎么跟人说话'))
    assert.ok(DEFAULT_TONE.startsWith('## 怎么跟人说话'))
  })

  it('composes the head alone for an empty tone', () => {
    assert.equal(composeOrchestrator(''), ORCHESTRATOR_HEAD)
    assert.equal(composeOrchestrator('   \n'), ORCHESTRATOR_HEAD)
    assert.equal(composeOrchestrator('新的语气'), `${ORCHESTRATOR_HEAD}\n\n新的语气`)
    assert.equal(toneTable('')['runtime/orchestrator'], ORCHESTRATOR_HEAD)
  })

  it('reads the shipped default until a tone is saved', () => {
    const dir = tempDir()
    assert.deepEqual(readTone(dir), { text: DEFAULT_TONE, custom: false })
    writeTone(dir, '只留一句：先给结论。')
    assert.deepEqual(readTone(dir), { text: '只留一句：先给结论。', custom: true })
    assert.equal(readFileSync(join(dir, TONE_FILE), 'utf8'), '只留一句：先给结论。\n')
  })

  it('treats an empty saved tone as "no tone section"', () => {
    const dir = tempDir()
    writeTone(dir, '')
    assert.deepEqual(readTone(dir), { text: '', custom: true })
    assert.equal(composeOrchestrator(readTone(dir).text), ORCHESTRATOR_HEAD)
  })

  it('falls back to the shipped default when the tone file cannot be read', () => {
    const dir = tempDir()
    mkdirSync(join(dir, TONE_FILE))
    assert.deepEqual(readTone(dir), { text: DEFAULT_TONE, custom: false })
  })

  it('normalizes newlines and refuses a non-string or oversized tone', () => {
    assert.equal(normalizeTone('  a\r\nb  '), 'a\nb')
    assert.throws(() => normalizeTone(42), /must be a string/)
    assert.throws(() => normalizeTone('x'.repeat(MAX_TONE_CHARS + 1)), /limit is 20000/)
  })

  it('installs the orchestrator part from the stored tone', async () => {
    const stateDir = tempDir()
    const tone = '## 怎么跟人说话\n\n只说结论。'
    writeTone(stateDir, tone)
    const initial = { revision: 0, current: { config: { ...TEAM } }, parts: Object.entries(TRANSLATIONS).map(([key]) => ({ key, text: 'English', base: `base-${key}` })) }
    const { impl, puts } = fakeFetch(initial)
    await applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl })
    assert.equal(puts[0].config.overrides['runtime/orchestrator'].text, `${ORCHESTRATOR_HEAD}\n\n${tone}`)
    assert.equal(readState(stateDir).parts['runtime/orchestrator'], hashText(`${ORCHESTRATOR_HEAD}\n\n${tone}`))
  })

  it('keeps a saved tone across a restart: the install writes nothing', async () => {
    const stateDir = tempDir()
    const tone = '## 怎么跟人说话\n\n只说结论。'
    writeTone(stateDir, tone)
    const composed = `${ORCHESTRATOR_HEAD}\n\n${tone}`
    const overrides = Object.fromEntries(Object.entries(TRANSLATIONS).map(([part, text]) => [
      part, { text: part === 'runtime/orchestrator' ? composed : text, base: `base-${part}` },
    ]))
    const initial = {
      revision: 1,
      current: { config: { ...TEAM, overrides } },
      parts: Object.entries(TRANSLATIONS).map(([key]) => ({ key, text: TRANSLATIONS[key], base: `base-${key}` })),
    }
    const { impl, puts } = fakeFetch(initial)
    const result = await applyTranslations({ baseUrl: 'http://127.0.0.1:3082', stateDir, fetchImpl: impl })
    assert.equal(result.saved, false)
    assert.equal(puts.length, 0)
  })
})

describe('saveTone', () => {
  const panelView = () => ({
    revision: 5,
    current: { config: { ...TEAM } },
    parts: [{ key: 'runtime/orchestrator', text: 'English A', base: 'base-a' }],
  })

  it('writes the composed part and records what it wrote', async () => {
    const stateDir = tempDir()
    const { impl, puts } = fakeFetch(panelView())
    const result = await saveTone({ baseUrl: 'http://127.0.0.1:3082', stateDir, text: '只说结论。', fetchImpl: impl })
    assert.equal(result.revision, 6)
    assert.equal(puts.length, 1)
    assert.equal(puts[0].baseRevision, 5)
    assert.equal(puts[0].config.overrides['runtime/orchestrator'].text, `${ORCHESTRATOR_HEAD}\n\n只说结论。`)
    assert.equal(puts[0].config.overrides['runtime/orchestrator'].base, 'base-a')
    assert.equal(readTone(stateDir).text, '只说结论。')
    assert.equal(readState(stateDir).parts['runtime/orchestrator'], hashText(`${ORCHESTRATOR_HEAD}\n\n只说结论。`))
  })

  it('refuses before touching anything when this Superagent has no orchestrator part', async () => {
    const stateDir = tempDir()
    const { impl, puts } = fakeFetch({ revision: 5, current: { config: { ...TEAM } }, parts: [] })
    await assert.rejects(
      () => saveTone({ baseUrl: 'http://127.0.0.1:3082', stateDir, text: 'x', fetchImpl: impl }),
      error => error.name === 'PromptsApiError' && error.status === 404,
    )
    assert.equal(puts.length, 0)
    assert.deepEqual(readTone(stateDir), { text: DEFAULT_TONE, custom: false })
  })

  it('leaves the stored tone alone when Superagent refuses the save', async () => {
    const stateDir = tempDir()
    const failing = async (_url, init = {}) => ((init.method ?? 'GET') === 'GET'
      ? json(200, panelView())
      : json(409, { error: 'Prompt version changed to 9' }))
    await assert.rejects(
      () => saveTone({ baseUrl: 'http://127.0.0.1:3082', stateDir, text: '新的', fetchImpl: failing }),
      /HTTP 409/,
    )
    assert.deepEqual(readTone(stateDir), { text: DEFAULT_TONE, custom: false })
  })

  it('validates the text before calling Superagent', async () => {
    const stateDir = tempDir()
    let calls = 0
    const impl = async () => { calls += 1; return json(200, {}) }
    await assert.rejects(
      () => saveTone({ baseUrl: 'http://127.0.0.1:3082', stateDir, text: 12, fetchImpl: impl }),
      /must be a string/,
    )
    assert.equal(calls, 0)
  })
})

describe('the tone panel route', () => {
  /** Register the route against a fake host and return its handler. */
  function handlerFor(options = {}) {
    const routes = []
    const ctx = {
      get: name => {
        if (name === 'webServer') {
          return { register: route => { routes.push(route); return () => {} } }
        }
        if (name === 'connection') return { requestRejection: options.rejection ?? (() => undefined) }
        return undefined
      },
    }
    registerTonePanel(ctx, { baseUrl: 'http://127.0.0.1:3082', stateDir: tempDir(), ...options })
    assert.equal(routes.length, 1)
    assert.equal(routes[0].kind, 'prefix')
    assert.equal(routes[0].path, TONE_PREFIX)
    return routes[0].handler
  }

  function request({ method = 'GET', path = `${TONE_PREFIX}/tone`, headers = {}, body = '' } = {}) {
    return {
      method,
      url: path,
      headers: { host: '127.0.0.1:3082', ...headers },
      async *[Symbol.asyncIterator]() { if (body) yield Buffer.from(body) },
    }
  }

  function response() {
    return {
      status: 0,
      body: undefined,
      writeHead(status) { this.status = status },
      end(value) { this.body = JSON.parse(value) },
    }
  }

  it('returns the current tone and the shipped default', async () => {
    const handler = handlerFor()
    const res = response()
    await handler(request(), res)
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, {
      ok: true, text: DEFAULT_TONE, defaultText: DEFAULT_TONE, custom: false, maxChars: MAX_TONE_CHARS,
    })
  })

  it('rejects a non-loopback Host and a cross-origin write', async () => {
    const handler = handlerFor()
    const host = response()
    await handler(request({ headers: { host: 'example.com' } }), host)
    assert.equal(host.status, 403)
    assert.equal(host.body.code, 'HOST_REJECTED')
    const origin = response()
    await handler(request({ method: 'PUT', headers: { origin: 'http://example.com' } }), origin)
    assert.equal(origin.status, 403)
    assert.equal(origin.body.code, 'ORIGIN_REJECTED')
  })

  it('rejects a session the host connection refuses', async () => {
    const handler = handlerFor({ rejection: () => 401 })
    const res = response()
    await handler(request(), res)
    assert.equal(res.status, 401)
    assert.equal(res.body.code, 'AUTH_REJECTED')
  })

  it('requires a JSON body and a string tone', async () => {
    const handler = handlerFor()
    const noJson = response()
    await handler(request({ method: 'PUT', body: '{"text":"x"}' }), noJson)
    assert.equal(noJson.status, 415)
    assert.equal(noJson.body.code, 'CONTENT_TYPE_REQUIRED')

    const notString = response()
    await handler(request({
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 7 }),
    }), notString)
    assert.equal(notString.status, 400)
    assert.equal(notString.body.code, 'INVALID_TONE')
  })

  it('answers an unknown path with 404', async () => {
    const handler = handlerFor()
    const res = response()
    await handler(request({ path: `${TONE_PREFIX}/ghost` }), res)
    assert.equal(res.status, 404)
    assert.equal(res.body.code, 'NOT_FOUND')
  })
})
