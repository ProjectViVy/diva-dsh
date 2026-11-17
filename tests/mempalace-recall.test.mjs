import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBEDDING_DIM } from '../plugins/dsh-mempalace/src/store/chunk.mjs'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'
import { KEYWORD_WEIGHTS, RECALL_WEIGHTS, lexicalSimilarity, recencyScore, scoreCandidate } from '../plugins/dsh-mempalace/src/recall/score.mjs'
import { RECALL_FOOTER, RECALL_HEADER, renderRecallBlock } from '../plugins/dsh-mempalace/src/recall/render.mjs'
import { createRecallInjection } from '../plugins/dsh-mempalace/src/recall/inject.mjs'
import { classifySensitiveText, isSensitiveText } from '../plugins/dsh-mempalace/src/recall/sensitive.mjs'

const pluginDir = fileURLToPath(new URL('../plugins/dsh-mempalace/', import.meta.url))
const nativeReady = existsSync(join(pluginDir, 'node_modules/better-sqlite3'))
  && existsSync(join(pluginDir, 'node_modules/sqlite-vec'))
const skip = !nativeReady && '原生依赖未安装（plugins/dsh-mempalace/node_modules 缺少 better-sqlite3 或 sqlite-vec）'
const silent = { warn() {}, info() {}, error() {} }

const openStores = []
function tempDir(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'recall-'))
  t.after(() => {
    while (openStores.length > 0) {
      try { openStores.pop().close() } catch { /* already closed */ }
    }
    rmSync(dir, { recursive: true, force: true })
  })
  return dir
}

function featureVector(text) {
  const vector = new Float32Array(EMBEDDING_DIM)
  for (const char of String(text).toLowerCase()) {
    const code = char.codePointAt(0)
    vector[code % EMBEDDING_DIM] += 1
    vector[(code * 31) % EMBEDDING_DIM] += 0.5
  }
  let norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm === 0) { vector[0] = 1; norm = 1 }
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

async function openStore(t, options = {}) {
  const dir = tempDir(t)
  const store = new MemoryStore({
    memoryDir: dir,
    embed: options.embed ?? (async text => featureVector(text)),
    sensitive: text => isSensitiveText(text),
    logger: silent,
  })
  await store.open()
  openStores.push(store)
  return store
}

const RECALL_CONFIG = {
  recallInjectionEnabled: true,
  recallTopK: 4,
  recallMinScore: 0.05,
  recallMaxChars: 600,
  recallTimeoutMs: 200,
  recallExcludeSensitive: true,
  embeddingSource: 'local',
  embeddingDim: 384,
  cloudEmbeddingDim: 512,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
}

test('the four signals rank the on-topic memory first', { skip }, async t => {
  const store = await openStore(t)
  const music = await store.store({ content: '她喜欢雨天听钢琴曲', project: 'qq', topic: '音乐', importance: 0.9, timestamp: new Date().toISOString() })
  await store.store({ content: '她讨厌被敷衍', project: 'qq', topic: '相处', importance: 0.5, timestamp: '2026-01-01T00:00:00.000Z' })
  const ranked = await store.recallRanked('钢琴', { topK: 4, minScore: 0.05 })
  assert.equal(ranked.mode, 'hybrid')
  assert.equal(ranked.results[0].id, music.id)
  assert.ok(ranked.results.length >= 1)
  const score = ranked.results[0].score
  const expected = scoreCandidate(ranked.results[0].signals, RECALL_WEIGHTS)
  assert.ok(Math.abs(score - expected) < 1e-9)
  assert.ok(ranked.results[0].signals.cosine > 0)
  assert.ok(ranked.results[0].signals.lexical > 0)
})

test('with no query vector the three surviving signals are renormalized', { skip }, async t => {
  const store = await openStore(t, {
    embed: async () => { throw Object.assign(new Error('model offline'), { code: 'MEMPALACE_EMBEDDING_FAILED' }) },
  })
  const stored = await store.store({ content: '她养过一只叫年糕的猫', project: 'qq', topic: '宠物', importance: 0.8 })
  assert.equal(store.lastEmbeddingErrorCode, 'MEMPALACE_EMBEDDING_FAILED')
  const ranked = await store.recallRanked('年糕', { topK: 4, minScore: 0.05 })
  assert.equal(ranked.mode, 'keyword')
  assert.equal(ranked.count, 1)
  assert.equal(ranked.results[0].id, stored.id)
  assert.equal(ranked.results[0].signals.cosine, 0)
  const expected = scoreCandidate(ranked.results[0].signals, KEYWORD_WEIGHTS)
  assert.ok(Math.abs(ranked.results[0].score - expected) < 1e-9)
  assert.ok(KEYWORD_WEIGHTS.lexical + KEYWORD_WEIGHTS.importance + KEYWORD_WEIGHTS.recency > 0.999)
})

test('sensitive memories never enter recall, even with an on-topic query', { skip }, async t => {
  const store = await openStore(t)
  const risky = await store.store({ content: '身份证 110101199001011234 记在抽屉里', project: 'qq', topic: '证件' })
  await store.store({ content: '她的证件放在书房', project: 'qq', topic: '家务' })
  assert.equal(store.db.prepare('SELECT sensitive FROM memories WHERE id = ?').get(risky.id).sensitive, 1)
  const ranked = await store.recallRanked('身份证 抽屉', { topK: 4, minScore: 0 })
  assert.equal(ranked.results.some(item => item.id === risky.id), false)
  const unfiltered = await store.recallRanked('身份证 抽屉', { topK: 4, minScore: 0, excludeSensitive: false })
  assert.equal(unfiltered.results.some(item => item.id === risky.id), true, '关掉过滤时才允许出现')
})

test('the rendered block is labelled, budgeted and never empty without a line', () => {
  const items = Array.from({ length: 12 }, (_, index) => ({
    text: `第 ${index} 条很长的旧事：${'她记得那天的风。'.repeat(10)}`,
    project: 'qq',
    topic: '旧事',
    timestamp: '2026-10-01T00:00:00.000Z',
    score: 0.9 - index * 0.01,
  }))
  const block = renderRecallBlock(items, { maxChars: 320 })
  assert.ok(block.startsWith(RECALL_HEADER))
  assert.ok(block.endsWith(RECALL_FOOTER))
  assert.ok(block.length <= 320)
  assert.ok(block.split('\n').filter(line => line.startsWith('- ')).length >= 1)
  assert.equal(renderRecallBlock([], { maxChars: 320 }), '')
})

test('the injection contributes one context per message and reuses the cached block', async () => {
  const calls = []
  const recall = async (text, options) => {
    calls.push({ text, options })
    return { block: '【想起的旧事】\n- [qq/旧事] 2026-10-01 (0.80) 那年秋天', mode: 'hybrid', count: 1 }
  }
  const injection = createRecallInjection({ config: RECALL_CONFIG, recall, logger: { warn() {} } })
  const session = { header: { origin: 'main' }, id: 's1' }
  const agent = { session, delegationDepth: 0 }
  const assembly = { sections: [], contexts: [{ name: 'policy', text: 'p' }], tools: [], variables: {} }

  assert.equal(injection.noteUserMessage(session, { type: 'user/message', seq: 7, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '还记得那年秋天吗' }] } }), true)
  const first = await injection.contribute(assembly, agent)
  assert.equal(first.contexts.length, 2)
  assert.equal(first.contexts[1].name, 'mempalace:recall')
  assert.match(first.contexts[1].text, /想起的旧事/)
  const second = await injection.contribute(assembly, agent)
  assert.deepEqual(second, assembly, '同一条消息的后续步骤不再重复注入')
  assert.equal(calls.length, 1, '同一条消息只查一次')
  assert.equal(injection.snapshot().messages, 1)
  assert.equal(injection.snapshot().injected, 1)

  const next = await injection.contribute(assembly, agent)
  assert.deepEqual(next, assembly)
  injection.noteUserMessage(session, { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '今天的天气呢' }] } })
  const third = await injection.contribute(assembly, agent)
  assert.equal(third.contexts.length, 2, '新消息重新召回一次')
  assert.equal(calls.length, 2)
})

test('subagents and disabled injection never reach recall', async () => {
  let calls = 0
  const recall = async () => { calls += 1; return { block: 'x', mode: 'hybrid', count: 1 } }
  const injection = createRecallInjection({ config: RECALL_CONFIG, recall, logger: { warn() {} } })
  const session = { header: { origin: 'main' } }
  injection.noteUserMessage(session, { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '还记得那次旅行吗' }] } })
  const subagent = { session: { header: { origin: 'subagent' } }, delegationDepth: 2 }
  const assembly = { contexts: [] }
  assert.deepEqual(await injection.contribute(assembly, subagent), assembly)
  assert.equal(calls, 0)

  const off = createRecallInjection({ config: { ...RECALL_CONFIG, recallInjectionEnabled: false }, recall, logger: { warn() {} } })
  off.noteUserMessage(session, { type: 'user/message', seq: 1, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '还记得那次旅行吗' }] } })
  assert.deepEqual(await off.contribute(assembly, { session, delegationDepth: 0 }), assembly)
  assert.equal(calls, 0)
})

test('a slow vector recall falls back to keyword recall instead of blocking the turn', async () => {
  const seen = []
  const recall = async (_text, options) => {
    seen.push(options?.allowVector)
    if (options?.allowVector) return new Promise(() => {})
    return { block: '【想起的旧事】\n- 关键词兜底', mode: 'keyword', count: 1 }
  }
  const injection = createRecallInjection({ config: { ...RECALL_CONFIG, recallTimeoutMs: 30 }, recall, logger: { warn() {} } })
  const session = { header: { origin: 'main' } }
  injection.noteUserMessage(session, { type: 'user/message', seq: 2, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '还记得那次旅行吗' }] } })
  const contributed = await injection.contribute({ contexts: [] }, { session, delegationDepth: 0 })
  assert.equal(contributed.contexts.length, 1)
  assert.match(contributed.contexts[0].text, /关键词兜底/)
  assert.deepEqual(seen, [true, false])
  assert.equal(injection.snapshot().timeouts, 1)
})

test('only human user messages become recall queries', () => {
  const injection = createRecallInjection({ config: RECALL_CONFIG, recall: async () => ({ block: '', mode: 'none', count: 0 }), logger: { warn() {} } })
  const session = { header: { origin: 'main' } }
  const message = (kind, text, seq = 1) => ({ type: 'user/message', seq, data: { source: { kind }, content: [{ type: 'text', text }] } })
  assert.equal(injection.noteUserMessage(session, message('system-prompt', 'runtime context snapshot')), false)
  assert.equal(injection.noteUserMessage(session, message('user', '好')), false, '过短的消息不查')
  assert.equal(injection.noteUserMessage(session, { type: 'assistant/message', seq: 3, data: {} }), false)
  assert.equal(injection.noteUserMessage(session, message('user', '还记得我们一起看过的电影吗')), true)
})

test('sensitivity covers secrets, identifiers and private topics', () => {
  assert.equal(isSensitiveText('她喜欢清晨的雾'), false)
  assert.equal(classifySensitiveText('api_key: sk-abcdefghijklmnopqrstuvwx'), 'secret')
  assert.equal(classifySensitiveText('身份证 110101199001011234'), 'pii')
  assert.equal(classifySensitiveText('她说过家里的事'), null)
  assert.equal(classifySensitiveText('这是她的病历记录'), 'private-topic')
  assert.equal(classifySensitiveText(''), null)
})

test('lexical similarity and recency are bounded and monotonic', () => {
  assert.equal(lexicalSimilarity('钢琴', '钢琴'), 1)
  assert.equal(lexicalSimilarity('钢琴', '敷衍'), 0)
  assert.ok(lexicalSimilarity('雨天的钢琴', '雨天听钢琴曲') > 0)
  const now = Date.parse('2026-11-01T00:00:00.000Z')
  assert.ok(recencyScore('2026-10-31T00:00:00.000Z', now) > recencyScore('2026-01-01T00:00:00.000Z', now))
  assert.equal(recencyScore('not-a-date', now), 0)
  assert.equal(scoreCandidate({ cosine: 2, lexical: -1, importance: 0.5, recency: 0.5 }), scoreCandidate({ cosine: 1, lexical: 0, importance: 0.5, recency: 0.5 }))
})
