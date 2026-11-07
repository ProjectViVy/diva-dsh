import * as fs from 'node:fs'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import { DEFAULTS, savePersistedConfig, validateConfig } from './config.mjs'

export const RETIREMENT_VERSION = 1
export const REMOVED_CONFIG_KEYS = Object.freeze([
  'autoCapture',
  'wakeUpEnabled',
  'captureMinChars',
  'userMinChars',
  'captureMaxChars',
  'maxPendingCaptures',
])

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function relative(stateDir, file) {
  return path.relative(stateDir, file)
}

function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const stat = fs.lstatSync(dir)
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${dir} is not a real directory`)
}

function uniqueFile(dir, stem, extension) {
  let candidate = path.join(dir, `${stem}.${extension}`)
  let index = 2
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${index}.${extension}`)
    index += 1
  }
  return candidate
}

function backupFile(stateDir, kind, stamp, extension, bytes) {
  const dir = path.join(stateDir, 'backups')
  privateDir(dir)
  const target = uniqueFile(dir, `${kind}-${stamp}-${digest(bytes).slice(0, 8)}`, extension)
  fs.writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 })
  return target
}

function writeJsonAtomic(file, value) {
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
}

/**
 * Retires MemPalace's legacy capture settings and identity file once per state directory.
 * Backups are written before any rewrite; the marker is written last and contains no identity bytes.
 */
export function retireLegacyState(stateDir, { now = new Date(), logger = console } = {}) {
  const marker = path.join(stateDir, 'migration.json')
  if (fs.existsSync(marker)) return { alreadyMigrated: true, marker: relative(stateDir, marker) }

  const stamp = now.toISOString().replace(/[:.]/g, '-')
  const report = {
    version: RETIREMENT_VERSION,
    retiredAt: now.toISOString(),
    config: null,
    identity: null,
    warnings: [],
  }
  const warn = message => {
    report.warnings.push(message)
    logger?.warn?.(`dsh-mempalace: ${message}`)
  }

  const configFile = path.join(stateDir, 'config.json')
  if (fs.existsSync(configFile)) {
    try {
      if (!fs.lstatSync(configFile).isFile()) {
        warn('config.json 不是普通文件，已跳过迁移')
      } else {
        const raw = fs.readFileSync(configFile)
        const backup = backupFile(stateDir, 'config', stamp, 'json', raw)
        let parsed
        try {
          parsed = JSON.parse(raw.toString('utf8'))
        } catch {
          warn('config.json 不是有效 JSON；已保留原文备份，跳过重写')
        }
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const removedKeys = REMOVED_CONFIG_KEYS.filter(key => Object.hasOwn(parsed, key))
          let rewritten = false
          if (removedKeys.length > 0) {
            const next = { ...DEFAULTS, ...parsed }
            for (const key of REMOVED_CONFIG_KEYS) delete next[key]
            try {
              savePersistedConfig(stateDir, validateConfig(next))
              rewritten = true
            } catch (error) {
              try {
                savePersistedConfig(stateDir, validateConfig({ ...DEFAULTS }))
                rewritten = true
                warn(`config.json 含无效字段，已重置为默认值：${error.message}`)
              } catch (fallbackError) {
                warn(`config.json 无法重写：${fallbackError.message}`)
              }
            }
          }
          report.config = { backup: relative(stateDir, backup), sha256: digest(raw), removedKeys, rewritten }
        } else {
          if (parsed !== undefined) warn('config.json 顶层不是对象；已保留原文备份，跳过重写')
          report.config = { backup: relative(stateDir, backup), sha256: digest(raw), removedKeys: [], rewritten: false }
        }
      }
    } catch (error) {
      warn(`config.json 迁移失败：${error.message}`)
    }
  }

  const identityFile = path.join(stateDir, 'identity.txt')
  if (fs.existsSync(identityFile)) {
    try {
      if (!fs.lstatSync(identityFile).isFile()) {
        warn('identity.txt 不是普通文件，已保留原样且不再读取')
      } else {
        const bytes = fs.readFileSync(identityFile)
        const backup = backupFile(stateDir, 'identity', stamp, 'txt', bytes)
        const archiveDir = path.join(stateDir, 'archive')
        privateDir(archiveDir)
        let archived = path.join(archiveDir, 'identity.txt')
        if (fs.existsSync(archived)) {
          if (digest(fs.readFileSync(archived)) === digest(bytes)) {
            fs.unlinkSync(identityFile)
          } else {
            archived = uniqueFile(archiveDir, `identity-${digest(bytes).slice(0, 8)}`, 'txt')
            fs.renameSync(identityFile, archived)
          }
        } else {
          fs.renameSync(identityFile, archived)
        }
        fs.chmodSync(archived, 0o600)
        report.identity = {
          backup: relative(stateDir, backup),
          sha256: digest(bytes),
          archivedTo: relative(stateDir, archived),
        }
      }
    } catch (error) {
      warn(`identity.txt 归档失败：${error.message}`)
    }
  }

  try {
    writeJsonAtomic(marker, report)
  } catch (error) {
    warn(`migration.json 写入失败：${error.message}`)
  }
  return report
}
