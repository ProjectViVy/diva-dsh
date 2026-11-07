// 模型仓储：按清单下载、校验、落地，并把「准备进度」变成可观测量。
//
// 与语音包的区别：语音包是「一个目录里塞一整套运行时」，识别模型是「几个可校验的大文件」。
// 所以这里不做解压、不做 venv，只做三件事：查清单、按 sha256 校验、缺什么下什么。
import { createHash } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MANIFEST_FILE = join(HERE, '..', 'assets', 'models.json')

/** 清单缺失或与请求的引擎/精度不匹配时抛出。 */
export class ModelManifestError extends Error {
  constructor(message, code = 'ASR_MODEL_MANIFEST') {
    super(message)
    this.name = 'ModelManifestError'
    this.code = code
  }
}

/** 下载或校验失败时抛出；message 可直接展示给操作者。 */
export class ModelPrepareError extends Error {
  constructor(message, code = 'ASR_MODEL_PREPARE') {
    super(message)
    this.name = 'ModelPrepareError'
    this.code = code
  }
}

/** 读取资产清单（只读一次，清单是随包发布的）。 */
export function readManifest(file = MANIFEST_FILE) {
  let manifest
  try { manifest = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
    throw new ModelManifestError(`无法读取模型清单（${file}）：${error.message}`)
  }
  if (!manifest || typeof manifest !== 'object' || !manifest.engines || typeof manifest.engines !== 'object') throw new ModelManifestError('模型清单格式无效')
  return manifest
}

function assertAsset(name, asset) {
  if (!asset || typeof asset !== 'object' || typeof asset.path !== 'string' || asset.path === '' ||
      !Number.isFinite(asset.bytes) || typeof asset.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(asset.sha256)) {
    throw new ModelManifestError(`模型清单里 ${name} 的条目无效`)
  }
  return asset
}

/**
 * 列出某引擎 + 精度需要的全部文件。
 * @returns `[{ name, asset, file }]`，name 为 `model` / `tokens` / `vad`。
 */
export function assetsFor(manifest, engineId, precision) {
  const engine = manifest.engines?.[engineId]
  if (!engine) throw new ModelManifestError(`模型清单里没有引擎 ${engineId}`)
  const precisionEntry = engine.precisions?.[precision]
  if (!precisionEntry) throw new ModelManifestError(`引擎 ${engineId} 没有精度 ${precision}`)
  const entries = []
  for (const [name, asset] of Object.entries(engine.shared ?? {})) entries.push({ name, asset: assertAsset(`${engineId}.shared.${name}`, asset) })
  for (const [name, asset] of Object.entries(precisionEntry)) entries.push({ name, asset: assertAsset(`${engineId}.${precision}.${name}`, asset) })
  return entries
}

function fileSha256(file) {
  const hash = createHash('sha256')
  const size = statSync(file).size
  const fd = openSync(file, 'r')
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    let read = 0
    while (read < size) {
      const got = readSync(fd, buffer, 0, buffer.length, read)
      if (got <= 0) break
      hash.update(buffer.subarray(0, got))
      read += got
    }
  } finally { closeSync(fd) }
  return hash.digest('hex')
}

function rmQuiet(file) {
  try { unlinkSync(file) } catch {}
}

/**
 * 打开模型仓储。
 * @param stateDir - 状态目录。
 * @param options.getOrigins - 覆盖清单里的下载源（来自配置）。
 */
export function createModelStore(stateDir, { getOrigins = () => null, fetchImpl = fetch, logger = null, manifestFile = MANIFEST_FILE, modelsRoot: modelsRootOverride = null } = {}) {
  const manifest = readManifest(manifestFile)
  const modelsRoot = modelsRootOverride ?? join(stateDir, 'models')

  const dirFor = (engineId, precision) => join(modelsRoot, engineId, precision)
  const readyFile = (engineId, precision) => join(dirFor(engineId, precision), 'ready.json')

  /** 只有「大小对 + ready.json 里记过同样的 sha256」才算就绪，避免把断点文件当成品。 */
  const inspect = (engineId, precision, { verify = false } = {}) => {
    const entries = assetsFor(manifest, engineId, precision)
    const dir = dirFor(engineId, precision)
    let ready = null
    try { ready = JSON.parse(readFileSync(readyFile(engineId, precision), 'utf8')) } catch {}
    const files = entries.map(({ name, asset, file: _file }) => {
      const file = join(dir, asset.path.split('/').pop())
      const present = existsSync(file)
      const bytes = present ? statSync(file).size : 0
      const sizeOk = present && bytes === asset.bytes
      let hash = null
      if (sizeOk && (verify || ready?.files?.[name]?.sha256 === asset.sha256)) hash = verify ? fileSha256(file) : asset.sha256
      const verified = sizeOk && hash === asset.sha256
      return { name, file, present, bytes, expectedBytes: asset.bytes, sha256: asset.sha256, verified }
    })
    const have = files.reduce((total, item) => total + Math.min(item.bytes, item.expectedBytes), 0)
    const total = files.reduce((sum, item) => sum + item.expectedBytes, 0)
    const allReady = files.every(item => item.verified)
    return { engine: engineId, precision, dir, ready: allReady, files, missing: files.filter(item => !item.verified).map(item => item.name), bytes: { have: allReady ? total : have, total }, verifiedAt: allReady ? (ready?.verifiedAt ?? null) : null }
  }

  /** 依据清单 + 配置的下载源，生成候选 URL 列表。 */
  const candidateUrls = (asset, origins) => {
    const configured = origins && Array.isArray(origins) && origins.length > 0 ? origins : manifest.origins
    return configured.map(origin => `${String(origin).replace(/\/+$/, '')}/${asset.path}`)
  }

  async function downloadOne(asset, target, { origins, signal, onProgress, name, totals }) {
    const urls = candidateUrls(asset, origins)
    const failures = []
    for (const url of urls) {
      const part = `${target}.part`
      rmQuiet(part)
      let received = 0
      const hash = createHash('sha256')
      try {
        const response = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': 'dsh-local-asr' }, signal })
        if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
        const stream = createWriteStream(part, { mode: 0o600 })
        try {
          for await (const chunk of response.body) {
            const buffer = Buffer.from(chunk)
            hash.update(buffer)
            received += buffer.length
            if (totals) onProgress?.({ phase: 'download', file: name, url, received, expectedBytes: asset.bytes, receivedAll: totals.base + received, totalAll: totals.total })
            if (!stream.write(buffer)) await new Promise(resolve => stream.once('drain', resolve))
          }
        } finally {
          await new Promise((resolve, reject) => { stream.end(() => resolve()); stream.once('error', reject) })
        }
        const digest = hash.digest('hex')
        if (received !== asset.bytes) throw new Error(`下载大小不符（${received} != ${asset.bytes}）`)
        if (digest !== asset.sha256) throw new Error('sha256 校验失败')
        renameSync(part, target)
        return { url, bytes: received, sha256: digest }
      } catch (error) {
        rmQuiet(part)
        if (signal?.aborted) throw new ModelPrepareError('准备已取消', 'ASR_PREPARE_CANCELLED')
        failures.push(`${new URL(url).host}: ${error?.message ?? error}`)
        logger?.warn?.(`[asr] 从 ${new URL(url).host} 下载 ${name} 失败：${error?.message ?? error}`)
      }
    }
    throw new ModelPrepareError(`下载 ${name} 失败（已尝试 ${urls.length} 个源）：${failures.join('；')}`, 'ASR_MODEL_DOWNLOAD_FAILED')
  }

  /**
   * 准备好某引擎 + 精度的全部文件（已就绪时只做校验）。
   * @returns 结果快照，形状与 `inspect` 一致。
   */
  async function prepare(engineId, precision, { signal, onProgress } = {}) {
    const origins = getOrigins()
    const entries = assetsFor(manifest, engineId, precision)
    const dir = dirFor(engineId, precision)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    onProgress?.({ phase: 'check', message: '检查本地模型文件' })
    const before = inspect(engineId, precision, { verify: true })
    const pending = entries.filter(({ name }) => before.files.find(item => item.name === name)?.verified !== true)
    const total = before.files.reduce((sum, item) => sum + item.expectedBytes, 0)
    let base = before.files.reduce((sum, item) => sum + (item.verified ? item.expectedBytes : 0), 0)
    for (const { name, asset } of pending) {
      signal?.throwIfAborted?.()
      const file = join(dir, asset.path.split('/').pop())
      onProgress?.({ phase: 'download', file: name, expectedBytes: asset.bytes, receivedAll: base, totalAll: total })
      await downloadOne(asset, file, { origins, signal, onProgress, name, totals: { base, total } })
      base += asset.bytes
      onProgress?.({ phase: 'verify', file: name, receivedAll: base, totalAll: total })
    }
    const after = inspect(engineId, precision, { verify: true })
    if (!after.ready) throw new ModelPrepareError(`模型文件校验未通过：${after.missing.join('、')}`, 'ASR_MODEL_INCOMPLETE')
    writeFileSync(readyFile(engineId, precision), `${JSON.stringify({ engine: engineId, precision, verifiedAt: new Date().toISOString(), files: Object.fromEntries(after.files.map(item => [item.name, { file: item.file, bytes: item.expectedBytes, sha256: item.sha256 }])) }, null, 2)}\n`, { mode: 0o600 })
    onProgress?.({ phase: 'done', receivedAll: total, totalAll: total })
    return after
  }

  return { manifest, modelsRoot, dirFor, inspect, prepare }
}
