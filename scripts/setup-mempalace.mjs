#!/usr/bin/env node
// Install and verify the native dependencies of plugins/dsh-mempalace.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN = join(ROOT, 'plugins', 'dsh-mempalace')
const MARKER = join(ROOT, '.artifacts', 'mempalace-setup.json')
const args = process.argv.slice(2)
const verifyOnly = args.includes('--verify')
const warmModels = args.includes('--warm-models')
const registryIndex = args.indexOf('--registry')
const registry = registryIndex >= 0 ? args[registryIndex + 1] : process.env.npm_config_registry || ''

function step(message) {
  console.log(`\n== ${message}`)
}

function npm(args) {
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(command, args, {
    cwd: PLUGIN,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...(registry ? { npm_config_registry: registry } : {}) },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`npm exited with ${result.status ?? result.signal}`)
    error.setupHint = [
      '原生依赖安装失败。请检查：',
      '- macOS：安装 Xcode Command Line Tools（xcode-select --install）',
      '- Linux：安装 build-essential 与 python3',
      '- Windows：安装 Visual Studio Build Tools（C++ 工作负载）',
      '- 需要强制源码编译时：npm_config_build_from_source=true',
      '- 需要二进制镜像时：npm_config_better_sqlite3_binary_host_mirror=https://npmmirror.com/mirrors/better-sqlite3',
      '- 国内网络可尝试：node scripts/setup-mempalace.mjs --registry https://registry.npmmirror.com',
    ].join('\n')
    throw error
  }
}

const VERIFY_SCRIPT = `
import { createRequire } from 'node:module'
const require = createRequire(process.cwd() + '/package.json')
const Database = require('better-sqlite3')
const sqliteVec = require('sqlite-vec')
const db = new Database(':memory:')
try {
  sqliteVec.load(db)
  db.exec('CREATE TABLE memories_probe (content TEXT NOT NULL)')
  db.exec('CREATE VIRTUAL TABLE vec_probe USING vec0(embedding float[4])')
  db.prepare('INSERT INTO memories_probe (content) VALUES (?)').run('hello')
  if (db.prepare('SELECT content FROM memories_probe').get().content !== 'hello') throw new Error('sqlite probe failed')
  db.prepare('INSERT INTO vec_probe (rowid, embedding) VALUES (?, ?)').run(1n, Buffer.from(new Float32Array([0, 0, 0, 0]).buffer))
} finally {
  db.close()
}
const versions = {}
for (const name of ['better-sqlite3', 'sqlite-vec']) {
  try { versions[name] = require(name + '/package.json').version } catch { versions[name] = 'loaded' }
}
const transformers = await import('@huggingface/transformers')
if (typeof transformers.pipeline !== 'function') throw new Error('transformers pipeline export is missing')
try { versions['@huggingface/transformers'] = require('@huggingface/transformers/package.json').version }
catch { versions['@huggingface/transformers'] = 'loaded' }
process.stdout.write(JSON.stringify({ versions }))
`

function verify() {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', VERIFY_SCRIPT], {
    cwd: PLUGIN,
    encoding: 'utf8',
    env: process.env,
    timeout: 120_000,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`依赖自检失败：${(result.stderr || result.stdout || '').trim()}`)
    error.setupHint = '运行 node scripts/setup-mempalace.mjs 重新安装；若为 Node ABI 不匹配，请删除插件目录的 node_modules 后重装。'
    throw error
  }
  return JSON.parse(result.stdout.trim().split('\n').at(-1))
}

async function warm() {
  const { EmbeddingService } = await import(join(PLUGIN, 'src', 'store', 'embeddings.mjs'))
  const home = process.env.DSH_HOME || join(ROOT, '.artifacts', 'dsh-home')
  const service = new EmbeddingService({
    cacheDir: join(home, 'mempalace', 'models'),
    hfEndpoint: process.env.HF_ENDPOINT || '',
    logger: console,
  })
  try {
    return await service.warmModels()
  } finally {
    await service.dispose()
  }
}

function writeMarker(payload) {
  mkdirSync(dirname(MARKER), { recursive: true })
  writeFileSync(MARKER, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
}

async function main() {
  if (!existsSync(join(PLUGIN, 'package.json'))) throw new Error(`Missing plugin package: ${PLUGIN}`)
  const marker = {
    version: 1,
    generatedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    pluginDir: PLUGIN,
    registry: registry || 'default',
    installed: !verifyOnly,
  }
  try {
    if (!verifyOnly) {
      step('Install native dependencies for dsh-mempalace')
      npm(['install', '--no-audit', '--no-fund'])
    }
    step('Verify better-sqlite3, sqlite-vec and transformers')
    const probe = verify()
    marker.dependencies = probe.versions
    if (warmModels) {
      step('Warm the local embedding and topic models')
      try {
        marker.models = await warm()
        console.log(`embedding: ${marker.models.embedding}, topic: ${marker.models.topic}`)
      } catch (error) {
        marker.models = { error: error instanceof Error ? error.message : String(error) }
        console.warn(`模型预热失败（不影响安装）：${marker.models.error}`)
      }
    }
    marker.ok = true
    writeMarker(marker)
    step('dsh-mempalace is ready')
    console.log(`Marker: ${MARKER}`)
    if (!warmModels) console.log('模型会在首次使用时下载；可运行带 --warm-models 的同一命令提前预热。')
  } catch (error) {
    marker.ok = false
    marker.error = error instanceof Error ? error.message : String(error)
    if (error && error.setupHint) marker.hint = error.setupHint
    writeMarker(marker)
    console.error(`\n${marker.error}`)
    if (marker.hint) console.error(`\n${marker.hint}`)
    process.exitCode = 1
  }
}

await main()
