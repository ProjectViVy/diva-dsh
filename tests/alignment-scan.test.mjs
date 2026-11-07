import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createAlignmentScanner } from '../scripts/lib/alignment-scan.mjs'

test('QQ alignment scan only adds candidates from allowed public groups, never the owner', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-scan-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const feed = join(dir, 'feed.jsonl'), config = join(dir, 'qq.json'), now = new Date().toISOString()
  writeFileSync(config, JSON.stringify({ ownerQQ: '11111', allow: { groups: ['12345'] } }))
  writeFileSync(feed, [
    { at: now, groupId: '12345', senderId: '22222', text: '我 B站叫星空' },
    { at: now, groupId: '12345', senderId: '11111', text: '主人内容' },
    { at: now, groupId: '98765', senderId: '33333', text: '其他群内容' },
    { at: now, groupId: '12345', senderId: '44444', kind: 'private', text: '私聊内容' },
  ].map(JSON.stringify).join('\n') + '\n')
  const inputs = [], candidates = []
  const scanner = createAlignmentScanner({ qqFeedFile: feed, qqConfigFile: config,
    detect: value => { inputs.push(value); return [{ id: value.author.id }] }, add: item => { candidates.push(item); return item } })
  const result = await scanner.scanQqFeedForCandidates()
  assert.equal(result.added, 1)
  assert.equal(inputs[0].text, '我 B站叫星空')
  assert.deepEqual(candidates, [{ id: '22222' }])
})

test('QQ alignment scan includes rotated logs and limits only eligible public messages', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-rotated-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const feed = join(dir, 'feed.jsonl'), config = join(dir, 'qq.json'), at = new Date().toISOString()
  writeFileSync(config, JSON.stringify({ allow: { groups: ['12345'] } }))
  const row = (groupId, text, extra = {}) => ({ at, groupId, senderId: '22222', text, ...extra })
  writeFileSync(`${feed}.1`, `${JSON.stringify(row('12345', '轮转的候选'))}\n`)
  writeFileSync(feed, [row('12345', '当前候选'), row('98765', '其他群'), row('12345', '私聊', { private: true })].map(JSON.stringify).join('\n') + '\n')
  const seen = []
  const scanner = createAlignmentScanner({ qqFeedFile: feed, qqConfigFile: config, detect: item => { seen.push(item.text); return [] }, add: () => false })
  await scanner.scanQqFeedForCandidates({ maxMessages: 2 })
  assert.deepEqual(seen, ['轮转的候选', '当前候选'])
  rmSync(feed); seen.length = 0
  await scanner.scanQqFeedForCandidates({ maxMessages: 2 })
  assert.deepEqual(seen, ['轮转的候选'])
})

test('QQ alignment scan yields during a large feed and detects only the latest eligible rows', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-large-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const feed = join(dir, 'feed.jsonl'), config = join(dir, 'qq.json'), at = new Date().toISOString()
  writeFileSync(config, JSON.stringify({ allow: { groups: ['12345'] } }))
  const row = JSON.stringify({ at, groupId: '12345', senderId: '22222', text: '话'.repeat(500) }) + '\n'
  writeFileSync(feed, row.repeat(15000) + JSON.stringify({ at, groupId: '12345', senderId: '22222', text: '最后的候选' }) + '\n')
  const seen = [], scanner = createAlignmentScanner({ qqFeedFile: feed, qqConfigFile: config, detect: item => { seen.push(item.text); return [] }, add: () => false })
  let yielded = false; const timer = new Promise(resolve => setTimeout(() => { yielded = true; resolve() }, 0))
  const result = await scanner.scanQqFeedForCandidates({ maxMessages: 2 })
  assert.equal(yielded, true); await timer; assert.equal(result.scanned, 2); assert.equal(seen.at(-1), '最后的候选')
})

test('QQ alignment scan retries rotation before writing any candidates', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-rotation-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const feed = join(dir, 'feed.jsonl'), config = join(dir, 'qq.json'), at = new Date().toISOString()
  const row = text => JSON.stringify({ at, groupId: '12345', senderId: '22222', text }) + '\n'
  writeFileSync(config, JSON.stringify({ allow: { groups: ['12345'] } }))
  writeFileSync(`${feed}.1`, row('旧轮转')); writeFileSync(feed, row('原当前'))
  const original = fs.promises.open; let rotated = false
  const mock = t.mock.method(fs.promises, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args)
    if (file === `${feed}.1` && !rotated) { rotated = true; fs.renameSync(feed, `${feed}.1`); writeFileSync(feed, row('新当前')) }
    return handle
  }); t.after(() => mock.mock.restore())
  const seen = [], scanner = createAlignmentScanner({ qqFeedFile: feed, qqConfigFile: config, detect: item => { seen.push(item.text); return [] }, add: () => false })
  await scanner.scanQqFeedForCandidates()
  assert.deepEqual(seen, ['原当前', '新当前'])
})

test('QQ alignment scan does not add candidates if the group whitelist changes during the scan', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-permission-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const feed = join(dir, 'feed.jsonl'), config = join(dir, 'qq.json')
  writeFileSync(config, JSON.stringify({ allow: { groups: ['12345'] } }))
  writeFileSync(feed, JSON.stringify({ at: new Date().toISOString(), groupId: '12345', senderId: '22222', text: '候选身份' }) + '\n')
  const original = fs.promises.open; let changed = false
  const mock = t.mock.method(fs.promises, 'open', async function (file, ...args) {
    const handle = await original.call(this, file, ...args)
    if (file === feed && !changed) { changed = true; writeFileSync(config, JSON.stringify({ allow: { groups: [] } })) }
    return handle
  }); t.after(() => mock.mock.restore())
  const added = [], scanner = createAlignmentScanner({ qqFeedFile: feed, qqConfigFile: config, detect: () => [{ id: 'candidate' }], add: candidate => { added.push(candidate); return true } })
  await assert.rejects(scanner.scanQqFeedForCandidates(), /配置.*变化/)
  assert.deepEqual(added, [])
})

test('Bilibili candidate scan only runs with credentials and returns failures without writing candidates', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-bili-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const credentialsFile = join(dir, 'credentials.json')
  let called = 0
  const scanner = createAlignmentScanner({ biliCredFile: credentialsFile, detect: () => [], add: () => {}, pullBili: async () => { called++; return [] } })
  assert.equal((await scanner.scanBiliFeedForCandidates()).ok, false)
  assert.equal(called, 0)
  writeFileSync(credentialsFile, JSON.stringify({ sessdata: 'test', bili_jct: 'test' }))
  assert.equal((await scanner.scanBiliFeedForCandidates()).ok, true)
  assert.equal(called, 1)
})

test('Bilibili scan passes public reply identities to candidate detection', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-bili-feed-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const credentials = join(dir, 'credentials.json'); writeFileSync(credentials, '{"sessdata":"test","bili_jct":"test"}')
  const inputs = [], added = []
  const scanner = createAlignmentScanner({ biliCredFile: credentials, pullBili: async () => [{ mid: '12345', who: '访客', text: '我QQ是123456' }], detect: input => { inputs.push(input); return [{ id: 'candidate' }] }, add: item => { added.push(item); return item } })
  const result = await scanner.scanBiliFeedForCandidates()
  assert.equal(result.added, 1)
  assert.equal(inputs[0].platform, 'bili')
  assert.equal(inputs[0].author.id, '12345')
  assert.equal(added.length, 1)
})

test('Bilibili candidate scan reports a failed source while keeping successful candidates', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-partial-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const credentials = join(dir, 'credentials.json'); writeFileSync(credentials, '{"sessdata":"test","bili_jct":"test"}')
  mkdirSync(join(dir, 'tools/lib'), { recursive: true })
  writeFileSync(join(dir, 'tools/lib/msgfeed.mjs'), `export const makeHeaders = () => ({}); export const pullFeed = async kind => { if (kind === 'at') throw new Error('offline'); return { items: [{ mid: '123', who: '用户', text: '我的 QQ 是 123456' }] } }; export const resolveLatestReply = async () => null;`)
  const scanner = createAlignmentScanner({ biliCredFile: credentials, biliToolsDir: join(dir, 'tools'), detect: () => [{ id: 'candidate' }], add: () => true })
  const result = await scanner.scanBiliFeedForCandidates()
  assert.equal(result.ok, true); assert.equal(result.added, 1)
  assert.deepEqual(result.failedSources, ['at'])
})

test('Bilibili inbox records resolve the actual matching reply before identifying candidates', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-bili-reply-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const credentials = join(dir, 'credentials.json'); writeFileSync(credentials, '{"sessdata":"test","bili_jct":"test"}')
  const inputs = []
  const scanner = createAlignmentScanner({ biliCredFile: credentials,
    pullBili: async () => [{ mid: '12345', who: '访客', business: 1, oid: '8', root: '9', parent: '10', source: '非本人回复' }],
    resolveBili: async item => ({ text: '我的 QQ 是 123456', exact: true, mid: item.mid }),
    detect: input => { inputs.push(input); return [] }, add: () => {} })
  const result = await scanner.scanBiliFeedForCandidates()
  assert.equal(result.ok, true)
  assert.equal(inputs[0].text, '我的 QQ 是 123456')
  assert.equal(inputs[0].author.id, '12345')
})

test('Bilibili scan does not attribute an uncertain reply to the inbox author', async t => {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const dir = mkdtempSync(join(parent, 'alignment-bili-uncertain-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const credentials = join(dir, 'credentials.json'); writeFileSync(credentials, '{"sessdata":"test","bili_jct":"test"}')
  let detected = 0
  const scanner = createAlignmentScanner({ biliCredFile: credentials, pullBili: async () => [{ mid: '12345', oid: '8', root: '9', parent: '10', source: '非本人回复' }],
    resolveBili: async () => ({ text: '不确定的回复', exact: false }), detect: () => { detected++; return [] }, add: () => {} })
  const result = await scanner.scanBiliFeedForCandidates()
  assert.equal(result.ok, true)
  assert.equal(result.unresolved, 1)
  assert.equal(detected, 0)
})
