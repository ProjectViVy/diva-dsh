import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULTS, loadPersistedConfig, resolveConfig } from '../plugins/dsh-mempalace/src/config.mjs'
import { REMOVED_CONFIG_KEYS, RETIREMENT_VERSION, retireLegacyState } from '../plugins/dsh-mempalace/src/retire.mjs'
import { MempalaceService } from '../plugins/dsh-mempalace/src/service.mjs'

const silent = { warn() {}, info() {}, error() {} }
const NOW = new Date('2026-11-04T00:00:00.000Z')

function tempDir(t) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'mempalace-retire-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

test('fresh state dir writes a migration marker only', t => {
  const dir = tempDir(t)
  const report = retireLegacyState(dir, { now: NOW, logger: silent })
  assert.equal(report.version, RETIREMENT_VERSION)
  assert.deepEqual(report.warnings, [])
  assert.equal(report.config, null)
  assert.equal(report.identity, null)
  assert.equal(existsSync(join(dir, 'migration.json')), true)
  assert.equal(existsSync(join(dir, 'backups')), false)
  assert.equal(retireLegacyState(dir, { logger: silent }).alreadyMigrated, true)
})

test('legacy config is backed up byte-for-byte and rewritten without retired keys', t => {
  const dir = tempDir(t)
  const legacy = {
    ...DEFAULTS,
    autoCapture: true,
    wakeUpEnabled: true,
    captureMinChars: 5,
    userMinChars: 2,
    captureMaxChars: 120,
    maxPendingCaptures: 3,
    defaultProject: 'legacy-project',
    wakeUpMaxTokens: 500,
  }
  const file = join(dir, 'config.json')
  writeFileSync(file, `${JSON.stringify(legacy, null, 2)}\n`)
  const before = readFileSync(file)
  const report = retireLegacyState(dir, { now: NOW, logger: silent })

  assert.equal(report.config.rewritten, true)
  assert.deepEqual(report.config.removedKeys, REMOVED_CONFIG_KEYS)
  assert.equal(sha256(readFileSync(join(dir, report.config.backup))), sha256(before))
  assert.equal((lstatSync(join(dir, report.config.backup)).mode & 0o777), 0o600)

  const saved = loadPersistedConfig(dir)
  for (const key of REMOVED_CONFIG_KEYS) assert.equal(Object.hasOwn(saved, key), false)
  assert.equal(saved.defaultProject, 'legacy-project')
  assert.equal(saved.wakeUpMaxTokens, 500)

  const backups = readdirSync(join(dir, 'backups'))
  assert.equal(retireLegacyState(dir, { logger: silent }).alreadyMigrated, true)
  assert.deepEqual(readdirSync(join(dir, 'backups')), backups)
})

test('invalid config JSON is preserved but not rewritten', t => {
  const dir = tempDir(t)
  const file = join(dir, 'config.json')
  writeFileSync(file, '{invalid')
  const report = retireLegacyState(dir, { now: NOW, logger: silent })
  assert.equal(report.config.rewritten, false)
  assert.equal(readFileSync(file, 'utf8'), '{invalid')
  assert.ok(report.warnings.some(message => message.includes('不是有效 JSON')))
  assert.equal(sha256(readFileSync(join(dir, report.config.backup))), sha256('{invalid'))
})

test('invalid typed values are backed up and reset to defaults', t => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify({ ...DEFAULTS, autoCapture: true, wakeUpMaxTokens: 'many' }, null, 2)}\n`)
  const report = retireLegacyState(dir, { now: NOW, logger: silent })
  assert.equal(report.config.rewritten, true)
  assert.ok(report.warnings.some(message => message.includes('无效字段')))
  const saved = loadPersistedConfig(dir)
  assert.equal(saved.wakeUpMaxTokens, DEFAULTS.wakeUpMaxTokens)
  assert.equal(Object.hasOwn(saved, 'autoCapture'), false)
})

test('identity.txt is backed up and archived without leaving a live persona file', t => {
  const dir = tempDir(t)
  const file = join(dir, 'identity.txt')
  const bytes = Buffer.from('# persona\nsecret\n')
  writeFileSync(file, bytes)
  const report = retireLegacyState(dir, { now: NOW, logger: silent })

  assert.equal(existsSync(file), false)
  assert.equal(report.identity.sha256, sha256(bytes))
  assert.equal(sha256(readFileSync(join(dir, report.identity.backup))), sha256(bytes))
  assert.equal(readFileSync(join(dir, report.identity.archivedTo), 'utf8'), bytes.toString('utf8'))
  assert.equal((lstatSync(join(dir, report.identity.archivedTo)).mode & 0o777), 0o600)
  assert.doesNotMatch(readFileSync(join(dir, 'migration.json'), 'utf8'), /secret/)
})

test('identity symlinks are left untouched and reported', t => {
  const dir = tempDir(t)
  const target = join(dir, 'persona-target.txt')
  writeFileSync(target, 'persona')
  symlinkSync(target, join(dir, 'identity.txt'))
  const report = retireLegacyState(dir, { now: NOW, logger: silent })
  assert.equal(report.identity, null)
  assert.ok(report.warnings.some(message => message.includes('不是普通文件')))
  assert.equal(lstatSync(join(dir, 'identity.txt')).isSymbolicLink(), true)
  assert.equal(readFileSync(target, 'utf8'), 'persona')
})

test('status snapshot exposes retirement and no identity or capture fields', async t => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'identity.txt'), 'persona')
  retireLegacyState(dir, { now: NOW, logger: silent })
  const service = new MempalaceService({ stateDir: dir, config: resolveConfig({}, {}), logger: silent })
  const snapshot = await service.statusSnapshot()
  assert.equal(snapshot.retirement.version, RETIREMENT_VERSION)
  assert.equal(Object.hasOwn(snapshot, 'pendingCaptures'), false)
  assert.equal(Object.hasOwn(snapshot.paths, 'identityPath'), false)
  assert.equal(typeof service.recentMemoryPreview, 'function')
  assert.equal('wakeupFor' in service, false)
  assert.equal('observeUser' in service, false)
})

test('an existing archive copy is reused only when its bytes match', t => {
  const dir = tempDir(t)
  mkdirSync(join(dir, 'archive'), { recursive: true })
  writeFileSync(join(dir, 'archive', 'identity.txt'), 'same')
  writeFileSync(join(dir, 'identity.txt'), 'same')
  const first = retireLegacyState(dir, { now: NOW, logger: silent })
  assert.equal(first.identity.archivedTo, 'archive/identity.txt')
  assert.equal(existsSync(join(dir, 'identity.txt')), false)

  const other = tempDir(t)
  mkdirSync(join(other, 'archive'), { recursive: true })
  writeFileSync(join(other, 'archive', 'identity.txt'), 'old')
  writeFileSync(join(other, 'identity.txt'), 'new')
  const second = retireLegacyState(other, { now: NOW, logger: silent })
  assert.notEqual(second.identity.archivedTo, 'archive/identity.txt')
  assert.equal(readFileSync(join(other, second.identity.archivedTo), 'utf8'), 'new')
  assert.equal(readFileSync(join(other, 'archive', 'identity.txt'), 'utf8'), 'old')
})
