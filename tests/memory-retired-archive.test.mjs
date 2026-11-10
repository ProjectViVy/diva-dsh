import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveMemoryCardPaths } from '../plugins/memory/src/card-engine.mjs'
import { createMemoryService } from '../plugins/memory/src/service.mjs'

const SUBJECT = 'subject_11111111-1111-4111-8111-111111111111'
const DAY = 24 * 60 * 60 * 1000
const base = resolve('.artifacts/test-tmp')

function make(t) {
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'memory-retired-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const stateDir = join(dir, 'memory')
  return { stateDir, paths: resolveMemoryCardPaths(join(stateDir, 'data')) }
}

function service(env, send = null) {
  return createMemoryService({ stateDir: env.stateDir, subject: async () => SUBJECT, archiveSend: send })
}

function readLines(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(line => line.trim()).map(line => JSON.parse(line))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/** 把卡里的记录改成「很久以前、不重要、指定清晰度」，让衰减条件可预测。 */
function ageRecords(paths, byId) {
  const card = JSON.parse(readFileSync(paths.json, 'utf8'))
  for (const record of card.records) {
    const preset = byId[record.id]
    if (!preset) continue
    record.createdAt = new Date(Date.now() - preset.ageDays * DAY).toISOString()
    record.lastSeenAt = record.createdAt
    record.importance = preset.importance ?? 20
    record.clarity = preset.clarity
  }
  writeFileSync(paths.json, JSON.stringify(card))
}

test('a memory that is still clear stays out of the retired ledger and MemPalace', async t => {
  const env = make(t)
  const first = service(env)
  t.after(() => first.dispose())
  await first.action('add', { text: '今天一起看了星星', scope: 'qq' })
  await first.action('maintain', { forceDecay: true })

  const full = readLines(env.paths.fullJsonl)
  assert.equal(full.length, 1, '全量归档仍然收下每一条记忆')
  assert.equal(existsSync(env.paths.retiredJsonl), false, '还清晰的记忆不进退役账本')
})

test('a faded memory is appended to the retired ledger exactly once', async t => {
  const env = make(t)
  const first = service(env)
  t.after(() => first.dispose())
  await first.action('add', { text: '说过一句以后要去看海', scope: 'qq' })

  const card = JSON.parse(readFileSync(env.paths.json, 'utf8'))
  const id = card.records[0].id
  ageRecords(env.paths, { [id]: { ageDays: 90, clarity: 'clear' } })

  const second = service(env)
  t.after(() => second.dispose())
  await second.action('maintain', { forceDecay: true })

  const retired = readLines(env.paths.retiredJsonl)
  assert.equal(retired.length, 1, retired.map(record => record.retiredReason).join(','))
  assert.equal(retired[0].id, id)
  assert.equal(retired[0].retiredReason, 'faded')
  assert.equal(retired[0].clarity, 'fuzzy')
  assert.equal(retired[0].text, '说过一句以后要去看海')
  assert.ok(retired[0].retiredAt, '退役行要带时间')
  assert.ok(retired[0].provenance?.source, '退役行要保留 provenance 才能投递')

  await second.action('maintain', { forceDecay: true })
  assert.equal(readLines(env.paths.retiredJsonl).length, 1, '同一条记忆只入档一次')
})

test('a memory dropped by decay is retired with its reason and then delivered', async t => {
  const env = make(t)
  const first = service(env)
  t.after(() => first.dispose())
  await first.action('add', { text: '很久以前的琐事', scope: 'qq' })
  const card = JSON.parse(readFileSync(env.paths.json, 'utf8'))
  const id = card.records[0].id
  ageRecords(env.paths, { [id]: { ageDays: 90, clarity: 'trace' } })

  const calls = []
  const send = async (path, body) => {
    calls.push(path)
    if (path === '/archive/status') return { ok: true, states: body.archive_ids.map(archiveId => ({ archive_id: archiveId, state: 'absent' })) }
    return {
      ok: true,
      results: body.items.map(item => ({
        archive_id: item.archive_id,
        state: 'archived',
        digest: item.digest,
        receipt: { archive_id: item.archive_id, digest: item.digest, memory_ids: ['arc_retired_c0'], chunks: 1, subject_id: body.subject_id, received_at: new Date().toISOString() },
      })),
    }
  }
  const second = service(env, send)
  t.after(() => second.dispose())
  await second.action('maintain', { forceDecay: true })

  const retired = readLines(env.paths.retiredJsonl)
  assert.equal(retired.length, 1)
  assert.equal(retired[0].id, id)
  assert.equal(retired[0].retiredReason, 'forgotten')

  const delivered = await second.drainArchives()
  assert.equal(delivered.ok, true)
  assert.deepEqual(calls, ['/archive/status', '/archive'])
  const status = await second.archiveStatus()
  assert.equal(status.archiveOut.pending, 0)
  assert.equal(status.archiveOut.receipts, 1)
})
