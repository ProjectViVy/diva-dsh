// 配置仓储：config.json 的读写由本模块独占。
//
// 沿用语音插件的做法：
//   - 只认 `asr` 段，不碰文件里的其他键；
//   - 写入走「同目录临时文件 + rename」，避免半个文件；
//   - 磁盘上的值先解析、再规范化，坏配置报错但**保留原文件**。
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const LIMIT_DEFAULTS = { maxSeconds: 120, maxBytes: 8 * 1024 * 1024, maxPerMinute: 6, maxPerHour: 120 }
const CACHE_DEFAULTS = { enabled: true, maxEntries: 200 }
const SENSEVOICE_DEFAULTS = {
  precision: 'int8',
  threads: 2,
  segmentSeconds: 30,
  vadThreshold: 0.5,
  minSpeechSeconds: 0.25,
  minSilenceSeconds: 0.5,
  vadOnsetPaddingSeconds: 0.3,
  idleTimeoutMs: 600000,
  prepareTimeoutMs: 1800000,
  inferenceTimeoutMs: 60000,
  maxPending: 2,
  modelSources: null,
}
const UI_DEFAULTS = { language: 'auto' }

export const ASR_DEFAULTS = { enabled: true, engine: 'sensevoice' }

/** 非负整数（含 0 = 不限）；非法值回落到默认，不因一个手滑把插件打挂。 */
function nonNegative(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

function positive(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

function stringList(value) {
  if (!Array.isArray(value)) return null
  const items = value.filter(item => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
  return items.length > 0 ? items : null
}

/** 把任意输入收敛成一份完整、可用的 asr 配置。 */
export function normalizeAsr(input) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const limits = raw.limits && typeof raw.limits === 'object' ? raw.limits : {}
  const cache = raw.cache && typeof raw.cache === 'object' ? raw.cache : {}
  const sensevoice = raw.sensevoice && typeof raw.sensevoice === 'object' ? raw.sensevoice : {}
  const ui = raw.ui && typeof raw.ui === 'object' ? raw.ui : {}
  const precision = sensevoice.precision === 'fp32' ? 'fp32' : SENSEVOICE_DEFAULTS.precision
  const engine = typeof raw.engine === 'string' && raw.engine.trim() !== '' ? raw.engine.trim() : ASR_DEFAULTS.engine
  return {
    enabled: bool(raw.enabled, ASR_DEFAULTS.enabled),
    engine,
    limits: {
      maxSeconds: positive(limits.maxSeconds, LIMIT_DEFAULTS.maxSeconds),
      maxBytes: positive(limits.maxBytes, LIMIT_DEFAULTS.maxBytes),
      maxPerMinute: nonNegative(limits.maxPerMinute, LIMIT_DEFAULTS.maxPerMinute),
      maxPerHour: nonNegative(limits.maxPerHour, LIMIT_DEFAULTS.maxPerHour),
    },
    cache: {
      enabled: bool(cache.enabled, CACHE_DEFAULTS.enabled),
      maxEntries: positive(cache.maxEntries, CACHE_DEFAULTS.maxEntries),
    },
    audit: bool(raw.audit, true),
    sensevoice: {
      precision,
      threads: positive(sensevoice.threads, SENSEVOICE_DEFAULTS.threads),
      segmentSeconds: positive(sensevoice.segmentSeconds, SENSEVOICE_DEFAULTS.segmentSeconds),
      vadThreshold: Number.isFinite(Number(sensevoice.vadThreshold)) ? Number(sensevoice.vadThreshold) : SENSEVOICE_DEFAULTS.vadThreshold,
      minSpeechSeconds: positive(sensevoice.minSpeechSeconds, SENSEVOICE_DEFAULTS.minSpeechSeconds),
      minSilenceSeconds: positive(sensevoice.minSilenceSeconds, SENSEVOICE_DEFAULTS.minSilenceSeconds),
      vadOnsetPaddingSeconds: nonNegative(sensevoice.vadOnsetPaddingSeconds, SENSEVOICE_DEFAULTS.vadOnsetPaddingSeconds),
      idleTimeoutMs: nonNegative(sensevoice.idleTimeoutMs, SENSEVOICE_DEFAULTS.idleTimeoutMs),
      prepareTimeoutMs: positive(sensevoice.prepareTimeoutMs, SENSEVOICE_DEFAULTS.prepareTimeoutMs),
      inferenceTimeoutMs: positive(sensevoice.inferenceTimeoutMs, SENSEVOICE_DEFAULTS.inferenceTimeoutMs),
      maxPending: positive(sensevoice.maxPending, SENSEVOICE_DEFAULTS.maxPending),
      modelSources: stringList(sensevoice.modelSources),
    },
    ui: {
      language: typeof ui.language === 'string' && ui.language.trim() !== '' ? ui.language.trim() : UI_DEFAULTS.language,
    },
  }
}

/** 校验磁盘上的 asr 段；形状不对就报错并保留原文件。 */
function validateAsr(value) {
  if (value == null) return {}
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error('ASR 配置无效（asr 必须是对象），已保留原文件')
  for (const key of ['limits', 'cache', 'sensevoice', 'ui']) {
    const section = value[key]
    if (section != null && (typeof section !== 'object' || Array.isArray(section))) throw new Error(`ASR 配置无效（asr.${key} 必须是对象），已保留原文件`)
  }
  return value
}

/**
 * 打开插件状态目录下的配置仓储。
 * @param stateDir - 已就绪的状态目录绝对路径。
 * @returns 读、写与规范化入口。
 */
export function createConfigStore(stateDir) {
  const file = join(stateDir, 'config.json')
  let live = normalizeAsr({})

  const readDisk = () => {
    let disk
    try { disk = JSON.parse(readFileSync(file, 'utf8')) } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw new Error(`ASR 配置无效（config.json 无法解析），已保留原文件：${error.message}`)
    }
    if (!disk || typeof disk !== 'object' || Array.isArray(disk)) throw new Error('ASR 配置无效（config.json 必须是对象），已保留原文件')
    return disk
  }

  const apply = next => { live = normalizeAsr(next); return live }

  apply(readDisk().asr ?? {})

  return {
    file,
    /** 当前生效配置（内存副本，只读使用）。 */
    get: () => live,
    /** 从磁盘重读，返回最新配置。 */
    reload: () => apply(readDisk().asr ?? {}),
    /** 合并写入一段配置；写成功后内存同步更新。 */
    save(patch) {
      const disk = readDisk()
      validateAsr(disk.asr)
      const next = normalizeAsr({ ...(disk.asr ?? {}), ...(patch ?? {}), limits: { ...((disk.asr ?? {}).limits ?? {}), ...(patch?.limits ?? {}) }, cache: { ...((disk.asr ?? {}).cache ?? {}), ...(patch?.cache ?? {}) }, sensevoice: { ...((disk.asr ?? {}).sensevoice ?? {}), ...(patch?.sensevoice ?? {}) }, ui: { ...((disk.asr ?? {}).ui ?? {}), ...(patch?.ui ?? {}) } })
      mkdirSync(stateDir, { recursive: true, mode: 0o700 })
      const tmp = `${file}.${randomUUID()}.tmp`
      try {
        writeFileSync(tmp, `${JSON.stringify({ ...disk, asr: next }, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
        renameSync(tmp, file)
      } catch (error) {
        try { unlinkSync(tmp) } catch {}
        throw error
      }
      return apply(next)
    },
  }
}
