/**
 * Dry-run the space migration on a snapshot of the live database.
 *
 * Reads `$DSH_HOME/mempalace/memories.db` through a read-only connection, copies it
 * with SQLite's backup API (a consistent snapshot even in WAL mode), then opens the
 * copy with a local 384-dim space and with a 512-dim cloud-space descriptor. The live
 * file is never written and no model is downloaded.
 *
 *   node scripts/spaces-check.mjs [--home <dir>] [--json]
 */

import * as fs from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from '../plugins/dsh-mempalace/node_modules/better-sqlite3/lib/index.js'
import { MemoryStore } from '../plugins/dsh-mempalace/src/store/memory_store.mjs'

const args = process.argv.slice(2)
const flag = name => args.includes(name)
const value = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const home = resolve(value('--home') || process.env.DSH_HOME || join(process.cwd(), '.artifacts', 'dsh-home'))
const source = join(home, 'mempalace', 'memories.db')
const silent = { warn() {}, info() {}, error() {} }

function report(partial) {
  return { ...partial }
}

function featureVector(text) {
  const vector = new Float32Array(384)
  for (const char of String(text)) vector[char.codePointAt(0) % 384] += 1
  const norm = Math.hypot(...vector) || 1
  for (let index = 0; index < vector.length; index += 1) vector[index] /= norm
  return vector
}

async function main() {
  if (!fs.existsSync(source)) {
    console.error(`没有找到数据库：${source}`)
    return 1
  }
  const dir = mkdtempSync(join(tmpdir(), 'mempalace-spaces-check-'))
  const copy = join(dir, 'memories.db')
  const live = new Database(source, { readonly: true, fileMustExist: true })
  try {
    await live.backup(copy)
  } finally {
    live.close()
  }

  const result = report({ source, copy: '<temp>', ok: true })
  const snapshot = new Database(copy, { readonly: true })
  const alreadyMigrated = Boolean(snapshot.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'embedding_spaces'",
  ).get())
  snapshot.close()
  result.alreadyMigrated = alreadyMigrated
  const open = async (space) => {
    const store = new MemoryStore({
      memoryDir: dir,
      embed: async text => featureVector(text),
      logger: silent,
      ...space ? { space } : {},
    })
    await store.open()
    return store
  }

  let local
  try {
    local = await open()
    result.rows = local.countAll()
    result.legacy = local.status().space
    result.missingAfterAdopt = local.spacesStatus().missing_in_active_space
    result.spacesAfterAdopt = local.spacesStatus().spaces.length
    result.backupWritten = Boolean(local.lastMigrationBackup && fs.existsSync(local.lastMigrationBackup))
    const sample = local.db.prepare('SELECT content FROM memories LIMIT 1').get()
    if (sample) {
      const found = await local.search(String(sample.content).slice(0, 12))
      result.sampleSearch = { mode: found.mode, count: found.results?.length ?? 0 }
    }
    local.close()
    local = null
  } catch (error) {
    result.ok = false
    result.error = `${error?.code ?? ''} ${error?.message ?? error}`.trim()
  } finally {
    try { local?.close() } catch { /* already closed */ }
  }

  let cloud
  try {
    cloud = await open({ source: 'cloud', kind: 'dashscope', model: 'text-embedding-v4', dim: 512 })
    const status = cloud.spacesStatus()
    result.cloud = { spaces: status.spaces.length, missing: status.missing_in_active_space, active: status.active_space }
    cloud.close()
    cloud = null
  } catch (error) {
    result.ok = false
    result.cloudError = `${error?.code ?? ''} ${error?.message ?? error}`.trim()
  } finally {
    try { cloud?.close() } catch { /* already closed */ }
  }

  rmSync(dir, { recursive: true, force: true })
  if (flag('--json')) console.log(JSON.stringify(result, null, 2))
  else {
    console.log(`数据库：${result.source}`)
    console.log(`记忆行数：${result.rows ?? '?'}，收养后空间数：${result.spacesAfterAdopt ?? '?'}，缺向量：${result.missingAfterAdopt ?? '?'}`)
    console.log(`旧表来源：${result.legacy?.provenance ?? '?'} / 表 ${result.legacy?.table ?? '?'} / 维 ${result.legacy?.dim ?? '?'}`)
    console.log(result.alreadyMigrated
      ? '迁移备份：数据库已迁移过，本次无需再备份'
      : `迁移备份已写：${result.backupWritten ? '是' : '否'}`)
    if (result.sampleSearch) console.log(`样本检索：${result.sampleSearch.mode}，命中 ${result.sampleSearch.count}`)
    if (result.cloud) console.log(`切到云空间：共 ${result.cloud.spaces} 个空间，缺向量 ${result.cloud.missing}，活动 ${result.cloud.active}`)
    if (result.error) console.log(`错误：${result.error}`)
    if (result.cloudError) console.log(`云计算错误：${result.cloudError}`)
    console.log(result.ok ? '结论：迁移路径可行，未改动线上数据库。' : '结论：迁移路径有问题，见上面的错误。')
  }
  return result.ok ? 0 : 1
}

process.exitCode = await main()
