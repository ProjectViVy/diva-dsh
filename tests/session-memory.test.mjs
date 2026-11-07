import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createSessionMemoryStore } from '../plugins/memory/src/session-memory.mjs'

function fixture(t) {
  const parent = resolve('.artifacts/test-tmp'); mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'session-memory-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('session memory imports legacy QQ state once without changing its source', async t => {
  const dir = fixture(t), legacy = join(dir, 'legacy.json')
  const source = JSON.stringify({ conversations: { 'group:123': { activeTopics: [{ text: '旧话题' }], pendingThoughts: [], memberImpressions: { 小明: { traits: ['喜欢猫'] } }, recentMessages: [{ text: '不迁移消息' }] } } })
  writeFileSync(legacy, source)
  const store = createSessionMemoryStore({ stateDir: join(dir, 'memory'), legacyFile: legacy })
  const item = await store.read('group:123')
  assert.equal(item.value.activeTopics[0].text, '旧话题')
  assert.equal(item.value.recentMessages, undefined)
  assert.equal(readFileSync(legacy, 'utf8'), source)
  writeFileSync(legacy, '{}')
  assert.equal((await createSessionMemoryStore({ stateDir: join(dir, 'memory'), legacyFile: legacy }).read('group:123')).value.activeTopics[0].text, '旧话题')
})

test('legacy session memory follows QQ canonical identifiers and rejects conflicting aliases', async t => {
  const dir = fixture(t), legacy = join(dir, 'legacy.json'), state = join(dir, 'memory')
  const first = { activeTopics: [{ text: '保留旧话题' }], pendingThoughts: [], memberImpressions: {} }
  const source = JSON.stringify({ conversations: { 'group:000123': first } })
  writeFileSync(legacy, source)
  const store = createSessionMemoryStore({ stateDir: state, legacyFile: legacy })
  assert.equal((await store.read('group:123')).value.activeTopics[0].text, '保留旧话题')
  assert.equal(readFileSync(legacy, 'utf8'), source)
  const other = join(dir, 'conflict'), conflicting = JSON.stringify({ conversations: { 'group:000123': first, 'group:123': { ...first, activeTopics: [{ text: '另一份话题' }] } } })
  writeFileSync(legacy, conflicting)
  await assert.rejects(createSessionMemoryStore({ stateDir: other, legacyFile: legacy }).read('group:123'), /冲突|conflict/i)
  assert.equal(existsSync(join(other, 'session-memory.json')), false)
  assert.equal(readFileSync(legacy, 'utf8'), conflicting)
})

test('session operations treat leading-zero identifiers as the same QQ conversation', async t => {
  const dir = fixture(t), store = createSessionMemoryStore({ stateDir: dir })
  store.initialize()
  const value = { activeTopics: [{ text: '同一话题', lastMentionAt: 1 }], pendingThoughts: [], memberImpressions: {} }
  const saved = await store.write('group:000123', value, 0, { backup: true })
  assert.equal((await store.read('group:123')).revision, saved.revision)
  await store.touchTopics('group:000123', ['同一话题'], 10)
  const current = await store.read('group:123')
  assert.equal(current.value.activeTopics[0].lastMentionAt, 10)
  await assert.rejects(store.write('group:000123', value, saved.revision), /conflict/i)
  const names = await store.backups('group:000123')
  assert.equal(names.length, 1)
  await store.restore('group:000123', names[0], current.revision)
  assert.deepEqual(await store.list(), ['group:123'])
  assert.doesNotThrow(() => createSessionMemoryStore({ stateDir: dir }).initialize())
})

test('session operations reject zero identifiers', async t => {
  const store = createSessionMemoryStore({ stateDir: fixture(t) })
  for (const key of ['private:0', 'group:000']) await assert.rejects(store.read(key), /invalid/i)
})

test('legacy sessions with large identifiers remain readable, editable and restorable without rounding', async t => {
  const dir = fixture(t), legacy = join(dir, 'legacy.json'), state = join(dir, 'memory')
  const key = 'group:9007199254740993', other = 'group:9007199254740992'
  const value = { activeTopics: [{ text: '大号码旧话题' }], pendingThoughts: [], memberImpressions: {} }
  writeFileSync(legacy, JSON.stringify({ conversations: { [key]: value, [other]: { ...value, activeTopics: [{ text: '相邻号码' }] } } }))
  const store = createSessionMemoryStore({ stateDir: state, legacyFile: legacy }); store.initialize()
  assert.deepEqual(await store.list(), [other, key])
  const original = await store.read(key)
  assert.equal(original.value.activeTopics[0].text, '大号码旧话题')
  const updated = await store.write(key, { ...value, activeTopics: [{ text: '修改后话题' }] }, original.revision, { backup: true })
  assert.equal((await store.read(other)).value.activeTopics[0].text, '相邻号码')
  const [name] = await store.backups(key)
  await store.restore(key, name, updated.revision)
  assert.equal((await store.read(key)).value.activeTopics[0].text, '大号码旧话题')
})

test('per-session backups with legacy aliases can be restored through canonical keys', async t => {
  const dir = fixture(t), store = createSessionMemoryStore({ stateDir: dir })
  const folder = join(dir, 'backups/sessions'); mkdirSync(folder, { recursive: true })
  const name = 'session-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'
  writeFileSync(join(folder, name), JSON.stringify({ key: 'private:00042', value: { activeTopics: [{ text: '备份话题' }], pendingThoughts: [], memberImpressions: {} } }))
  assert.deepEqual(await store.backups('private:42'), [name])
  await store.restore('private:42', name, 0)
  assert.equal((await store.read('private:00042')).value.activeTopics[0].text, '备份话题')
  assert.deepEqual(await store.list(), ['private:42'])
})

test('existing imported session aliases are repaired at startup with a whole-database backup', async t => {
  const dir = fixture(t), file = join(dir, 'session-memory.json')
  const value = { activeTopics: [{ text: '旧会话话题' }], pendingThoughts: [], memberImpressions: {} }
  const original = JSON.stringify({ version: 1, conversations: { 'private:00042': { revision: 3, value } } })
  writeFileSync(file, original)
  const store = createSessionMemoryStore({ stateDir: dir }); store.initialize()
  const restored = await store.read('private:42')
  assert.equal(restored.revision, 3)
  assert.equal(restored.value.activeTopics[0].text, '旧会话话题')
  const [backup] = await store.databaseBackups()
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'backups/sessions', backup), 'utf8')), JSON.parse(original))
})

test('conflicting existing session aliases cannot be overwritten after startup fails', async t => {
  const dir = fixture(t), file = join(dir, 'session-memory.json')
  const value = { activeTopics: [], pendingThoughts: [], memberImpressions: {} }
  const original = JSON.stringify({ version: 1, conversations: { 'group:0001': { revision: 1, value }, 'group:1': { revision: 1, value: { ...value, activeTopics: [{ text: '另一份记忆' }] } } } })
  writeFileSync(file, original)
  const store = createSessionMemoryStore({ stateDir: dir })
  assert.throws(() => store.initialize(), /冲突|corrupt/i)
  await assert.rejects(store.write('group:1', value, 1), /冲突|corrupt/i)
  assert.equal(readFileSync(file, 'utf8'), original)
})

test('a legacy alias introduced while running cannot be read as empty or overwritten', async t => {
  const dir = fixture(t), file = join(dir, 'session-memory.json'), store = createSessionMemoryStore({ stateDir: dir })
  store.initialize()
  const value = { activeTopics: [{ text: '旧话题', lastMentionAt: 1 }], pendingThoughts: [], memberImpressions: {} }
  const original = JSON.stringify({ version: 1, conversations: { 'group:0001': { revision: 2, value } } })
  writeFileSync(file, original)
  const backups = join(dir, 'backups/sessions'), name = 'session-1-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.json'
  writeFileSync(join(backups, name), JSON.stringify({ key: 'group:1', value }))
  await assert.rejects(store.list(), /别名|alias/i)
  await assert.rejects(store.read('group:1'), /别名|alias/i)
  await assert.rejects(store.write('group:1', value, 0), /别名|alias/i)
  await assert.rejects(store.touchTopics('group:1', ['旧话题'], 2), /别名|alias/i)
  await assert.rejects(store.restore('group:1', name, 0), /别名|alias/i)
  assert.equal(readFileSync(file, 'utf8'), original)
  store.initialize()
  assert.equal((await store.read('group:1')).value.activeTopics[0].text, '旧话题')
})

test('restarting with unchanged session memory does not create duplicate whole-database backups', async t => {
  const dir = fixture(t), store = createSessionMemoryStore({ stateDir: dir })
  store.initialize()
  createSessionMemoryStore({ stateDir: dir }).initialize()
  createSessionMemoryStore({ stateDir: dir }).initialize()
  const initial = await store.databaseBackups()
  assert.equal(initial.length, 1)
  await store.write('group:123', { activeTopics: [{ text: '新话题' }], pendingThoughts: [], memberImpressions: {} }, 0)
  createSessionMemoryStore({ stateDir: dir }).initialize()
  const updated = await store.databaseBackups()
  assert.equal(updated.length, 2)
  assert.ok(updated.includes(initial[0]), 'the earlier backup is retained')
  createSessionMemoryStore({ stateDir: dir }).initialize()
  assert.equal((await store.databaseBackups()).length, 2)
})

test('session memory rejects stale writes and malformed state without overwriting data', async t => {
  const dir = fixture(t), store = createSessionMemoryStore({ stateDir: dir })
  const first = await store.read('private:123')
  const next = await store.write('private:123', { ...first.value, activeTopics: [{ text: '话题' }] }, first.revision)
  await assert.rejects(store.write('private:123', first.value, first.revision), /conflict/i)
  assert.equal((await store.read('private:123')).revision, next.revision)
  await assert.rejects(store.read('__proto__'), /invalid/i)
  writeFileSync(join(dir, 'session-memory.json'), '{broken')
  await assert.rejects(store.write('private:123', first.value, next.revision), /corrupt/i)
  assert.equal(readFileSync(join(dir, 'session-memory.json'), 'utf8'), '{broken')
})

test('topic mentions merge into the latest session without reverting edits or resurrecting deleted topics', async t => {
  const store = createSessionMemoryStore({ stateDir: fixture(t) }), key = 'group:123'
  const initial = await store.write(key, { activeTopics: [{ text: '话题', lastMentionAt: 10, pendingQuestion: '旧问题' }, { text: '已删除', lastMentionAt: 10 }], pendingThoughts: [], memberImpressions: {} }, 0)
  await store.write(key, { ...initial.value, activeTopics: [{ ...initial.value.activeTopics[0], pendingQuestion: '新问题' }], pendingThoughts: [{ text: '新想法' }] }, initial.revision)
  await Promise.all([store.touchTopics(key, ['话题', '已删除'], 30), store.touchTopics(key, ['话题'], 20)])
  const result = await store.read(key)
  assert.deepEqual(result.value.activeTopics, [{ text: '话题', lastMentionAt: 30, pendingQuestion: '新问题' }])
  assert.equal(result.value.pendingThoughts[0].text, '新想法')
  const revision = result.revision
  await store.touchTopics(key, ['不存在'], 40)
  assert.equal((await store.read(key)).revision, revision)
  await assert.rejects(store.touchTopics(key, ['话题'], -1), /invalid/i)
})

test('manual session changes keep a recoverable per-session backup without replacing other sessions', async t => {
  const dir = fixture(t), store = createSessionMemoryStore({ stateDir: dir })
  const empty = await store.read('group:1')
  const original = await store.write('group:1', { ...empty.value, activeTopics: [{ text: '原话题' }] }, empty.revision)
  const changed = await store.write('group:1', empty.value, original.revision, { backup: true })
  await store.write('group:2', { ...empty.value, activeTopics: [{ text: '另一个会话' }] }, 0)
  const names = await store.backups('group:1')
  assert.equal(names.length, 1)
  await assert.rejects(store.restore('group:1', names[0], original.revision), /conflict/i)
  const restored = await store.restore('group:1', names[0], changed.revision)
  assert.equal(restored.value.activeTopics[0].text, '原话题')
  assert.equal((await store.read('group:2')).value.activeTopics[0].text, '另一个会话')
  await assert.rejects(store.restore('group:1', '../elsewhere', restored.revision), /invalid/i)
})

test('a damaged session database can be recovered from a whole-database backup', async t => {
  const dir = fixture(t), store = createSessionMemoryStore({ stateDir: dir })
  const empty = (await store.read('group:1')).value
  const one = await store.write('group:1', { ...empty, activeTopics: [{ text: '第一会话' }] }, 0)
  await store.write('group:2', { ...empty, activeTopics: [{ text: '第二会话' }] }, 0)
  await store.write('group:1', empty, one.revision, { backup: true })
  const [name] = await store.databaseBackups()
  assert.ok(name)
  await assert.rejects(store.recoverDatabase(name), /not corrupt/i)
  writeFileSync(join(dir, 'session-memory.json'), '{damaged')
  await assert.rejects(store.recoverDatabase('../outside'), /invalid/i)
  assert.equal(readFileSync(join(dir, 'session-memory.json'), 'utf8'), '{damaged')
  await store.recoverDatabase(name)
  assert.equal((await store.read('group:1')).value.activeTopics[0].text, '第一会话')
  assert.equal((await store.read('group:2')).value.activeTopics[0].text, '第二会话')
  const saved = readdirSync(join(dir, 'backups/sessions')).filter(item => item.startsWith('session-db-damaged-'))
  assert.equal(readFileSync(join(dir, 'backups/sessions', saved[0]), 'utf8'), '{damaged')
})
