import * as fs from 'node:fs'
import * as path from 'node:path'

export const DEFAULTS = Object.freeze({
  wakeUpMaxTokens: 800,
  topicInferenceEnabled: true,
  defaultProject: null,
  dedupeThreshold: 0.9,
  searchDefaultResults: 5,
  searchMaxResults: 20,
  chunkSize: 800,
  chunkOverlap: 100,
  minChunkSize: 50,
  embeddingDim: 384,
  embeddingModel: 'Xenova/all-MiniLM-L6-v2',
  topicModel: 'Xenova/flan-t5-small',
  modelCacheDir: '',
  hfEndpoint: '',
  modelLoadTimeoutMs: 60_000,
  keywordsFallback: true,
  archiveMaxItems: 200,
  archiveMaxBytes: 384 * 1024,
  archiveMaxContentChars: 40_000,
  archiveMaxStatusIds: 200,
})

export const CONFIG_FILE = 'config.json'

function fail(message) {
  throw new Error(`dsh-mempalace: ${message}`)
}

function integer(value, field, min, max) {
  const number = Number(value)
  if (!Number.isInteger(number)) fail(`${field} must be an integer`)
  if (number < min || number > max) fail(`${field} must be between ${min} and ${max}`)
  return number
}

function boolean(value, field) {
  if (typeof value !== 'boolean') fail(`${field} must be a boolean`)
  return value
}

function text(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') fail(`${field} must be a string`)
  const trimmed = value.trim()
  if (!trimmed && !allowEmpty) fail(`${field} must not be empty`)
  return trimmed
}

export function resolveConfig(pluginConfig = {}, persisted = {}) {
  return validateConfig({ ...DEFAULTS, ...persisted, ...pluginConfig })
}

export function validateConfig(input) {
  if (!input || typeof input !== 'object') fail('config must be an object')
  const config = {
    wakeUpMaxTokens: integer(input.wakeUpMaxTokens, 'wakeUpMaxTokens', 64, 8000, 800),
    topicInferenceEnabled: boolean(input.topicInferenceEnabled, 'topicInferenceEnabled'),
    defaultProject: input.defaultProject === null || input.defaultProject === undefined
      ? null
      : text(input.defaultProject, 'defaultProject'),
    dedupeThreshold: Number(input.dedupeThreshold),
    searchDefaultResults: integer(input.searchDefaultResults, 'searchDefaultResults', 1, 20, 5),
    searchMaxResults: integer(input.searchMaxResults, 'searchMaxResults', 1, 50, 20),
    chunkSize: integer(input.chunkSize, 'chunkSize', 100, 10000, 800),
    chunkOverlap: integer(input.chunkOverlap, 'chunkOverlap', 0, 9999, 100),
    minChunkSize: integer(input.minChunkSize, 'minChunkSize', 0, 10000, 50),
    embeddingDim: integer(input.embeddingDim, 'embeddingDim', 384, 384, 384),
    embeddingModel: text(input.embeddingModel, 'embeddingModel'),
    topicModel: text(input.topicModel, 'topicModel', { allowEmpty: true }),
    modelCacheDir: text(input.modelCacheDir, 'modelCacheDir', { allowEmpty: true }),
    hfEndpoint: text(input.hfEndpoint, 'hfEndpoint', { allowEmpty: true }),
    modelLoadTimeoutMs: integer(input.modelLoadTimeoutMs, 'modelLoadTimeoutMs', 10_000, 900_000),
    keywordsFallback: boolean(input.keywordsFallback, 'keywordsFallback'),
    archiveMaxItems: integer(input.archiveMaxItems, 'archiveMaxItems', 1, 200, 200),
    archiveMaxBytes: integer(input.archiveMaxBytes, 'archiveMaxBytes', 1024, 384 * 1024, 384 * 1024),
    archiveMaxContentChars: integer(input.archiveMaxContentChars, 'archiveMaxContentChars', 100, 40_000, 40_000),
    archiveMaxStatusIds: integer(input.archiveMaxStatusIds, 'archiveMaxStatusIds', 1, 200, 200),
  }
  if (!Number.isFinite(config.dedupeThreshold) || config.dedupeThreshold < 0 || config.dedupeThreshold > 1) {
    fail('dedupeThreshold must be between 0 and 1')
  }
  if (config.chunkOverlap >= config.chunkSize) fail('chunkOverlap must be smaller than chunkSize')
  if (config.minChunkSize > config.chunkSize) fail('minChunkSize must not exceed chunkSize')
  if (config.searchMaxResults < config.searchDefaultResults) {
    fail('searchMaxResults must be at least searchDefaultResults')
  }
  if (config.hfEndpoint) {
    let url
    try { url = new URL(config.hfEndpoint) } catch { fail('hfEndpoint must be an http(s) URL') }
    if (!['http:', 'https:'].includes(url.protocol)) fail('hfEndpoint must be an http(s) URL')
  }
  return config
}

export function configPath(stateDir) {
  return path.join(stateDir, CONFIG_FILE)
}

export function loadPersistedConfig(stateDir) {
  const file = configPath(stateDir)
  try {
    if (!fs.existsSync(file)) return {}
    const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function savePersistedConfig(stateDir, config) {
  fs.mkdirSync(stateDir, { recursive: true })
  const validated = validateConfig(config)
  const file = configPath(stateDir)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  return validated
}

export function publicConfig(config) {
  return { ...config }
}
