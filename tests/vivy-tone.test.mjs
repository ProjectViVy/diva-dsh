/**
 * dsh-vivy-tone — unit tests.
 *
 * Nothing here touches a real Superagent: the prompt API is a fake that records
 * what was sent, and the state directory is a fresh `mkdtemp`.
 */

import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

import { resolveConfig } from '../plugins/dsh-vivy-tone/src/config.mjs'
import { applyTranslations, removeTranslations, resolveStateDir, defaultStateDir } from '../plugins/dsh-vivy-tone/src/install.mjs'
import { parseArgs } from '../plugins/dsh-vivy-tone/src/cli.mjs'
import {
  composeConfig, hashText, normalizeView, planParts, readPrompts, readState, stripConfig, writeState,
} from '../plugins/dsh-vivy-tone/src/write.mjs'
import { REQUIRED_PLACEHOLDERS, TRANSLATIONS, missingPlaceholders } from '../plugins/dsh-vivy-tone/src/zh.mjs'

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
