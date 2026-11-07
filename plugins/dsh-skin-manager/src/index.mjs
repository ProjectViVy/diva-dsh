/**
 * Skin manager — host half: one durable skin preference for this panel.
 *
 * Ported from hust-open-atom-club/oh-dsh `plugins/skins` (host half): the
 * preference file, its route, the same-origin rule on writes, the body cap and
 * the atomic temp-file write are that plugin's design, kept here so the client
 * half could be ported with its storage model intact. See README.md for the
 * differences that could not be carried over.
 */
import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'

export const name = 'dsh-skin-manager'
export const inject = ['webServer']

/** Route the browser half reads and writes through. */
export const API_PATH = '/dsh-skin-manager/api/preferences'

/**
 * Skin ids the browser half offers. Its catalog is the display source; this
 * list exists so a stored or submitted id can be validated, and it must be kept
 * in step with `src/client.js` (one line, and a wrong id here only rejects a
 * save the client would otherwise accept).
 */
const SKIN_IDS = [
  'diva',
  'vivy',
  'oh-dsh-skin-deep-current',
  'oh-dsh-skin-jade-circuit',
  'oh-dsh-skin-porcelain',
  'oh-dsh-skin-ember-dusk',
]
const FALLBACK_THEMES = ['light', 'dark', 'system']

/** `vivy` is this deployment's own skin, so a fresh profile looks unchanged. */
export const DEFAULT_PREFERENCES = Object.freeze({ activeId: 'diva', fallbackTheme: 'system' })

const STATE_DIRECTORY = 'skin-manager'
const STATE_FILE = 'preferences.json'
const MAX_BODY_BYTES = 4096

/** @returns {{activeId: string|null, fallbackTheme: string}|undefined} */
export function parsePreferences(value) {
  if (typeof value !== 'object' || value === null) return undefined
  const input = /** @type {Record<string, unknown>} */ (value)
  if (input.activeId !== null && !SKIN_IDS.includes(/** @type {string} */ (input.activeId))) return undefined
  if (!FALLBACK_THEMES.includes(/** @type {string} */ (input.fallbackTheme))) return undefined
  return Object.freeze({ activeId: input.activeId, fallbackTheme: input.fallbackTheme })
}

/** Read the stored preference, falling back to the default when absent. */
export async function loadPreferences(path) {
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return DEFAULT_PREFERENCES
    throw error
  }
  const parsed = parsePreferences(JSON.parse(text))
  if (parsed === undefined) throw new Error('skin preferences are invalid')
  return parsed
}

/** Replace the preference atomically: a reader never sees a partial file. */
export async function savePreferences(path, preferences) {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.next-${randomBytes(6).toString('hex')}`
  await writeFile(temporary, `${JSON.stringify(preferences, undefined, 2)}\n`, { mode: 0o600 })
  try {
    await rename(temporary, path)
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') {
      await unlink(temporary).catch(() => {})
      throw error
    }
    await writeFile(path, await readFile(temporary))
    await unlink(temporary)
  }
}

/** The panel is served on loopback; another Host means DNS rebinding. */
function isLoopbackHost(host) {
  if (typeof host !== 'string' || host === '') return false
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  return name === '127.0.0.1' || name === 'localhost' || name === '::1'
}

function isSameOrigin(request) {
  const origin = request.headers.origin
  const host = request.headers.host
  if (origin === undefined || host === undefined) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

async function readJson(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw new Error('skin preferences are too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

/**
 * Put the stored skin on <html> in the served document, so the first paint
 * already carries it: the browser half can only apply a skin once its module
 * has loaded, and another skin would flash this skin's palette until then.
 */
function injectBootAttribute(html, activeId) {
  if (activeId === null || !SKIN_IDS.includes(activeId)) return html
  const snippet = `<script data-plugin="dsh-skin-manager">document.documentElement.setAttribute('data-dsh-skin', ${JSON.stringify(activeId)})</script>`
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return html + snippet
  const at = body.index + body[0].length
  return html.slice(0, at) + snippet + html.slice(at)
}

/**
 * Mount the skin preference route on a composed DSH context.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  const home = process.env.DSH_HOME
  if (typeof home !== 'string' || !isAbsolute(home)) {
    ctx.logger.warn('dsh-skin-manager: DSH_HOME is not an absolute path; skin preferences are off')
    return
  }
  const directory = join(home, STATE_DIRECTORY)
  mkdirSync(directory, { recursive: true })
  const path = join(directory, STATE_FILE)

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: API_PATH,
    handler: async (request, response) => {
      try {
        if (!isLoopbackHost(request.headers.host)) {
          sendJson(response, 403, { error: 'skin preferences are served on loopback only' })
          return
        }
        if (request.method === 'GET') {
          sendJson(response, 200, await loadPreferences(path))
          return
        }
        if (request.method === 'PUT') {
          if (!isSameOrigin(request)) {
            sendJson(response, 403, { error: 'cross-origin skin preferences are rejected' })
            return
          }
          const preferences = parsePreferences(await readJson(request))
          if (preferences === undefined) {
            sendJson(response, 400, { error: 'invalid skin preferences' })
            return
          }
          await savePreferences(path, preferences)
          sendJson(response, 200, preferences)
          return
        }
        response.writeHead(405, { allow: 'GET, PUT' })
        response.end()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        ctx.logger.warn(`dsh-skin-manager: ${message}`)
        sendJson(response, 500, { error: message })
      }
    },
  }), 'dsh-skin-manager: skin preferences route')

  ctx.effect(() => ctx.webServer.tapIndex((html) => {
    let activeId = null
    try {
      const parsed = parsePreferences(JSON.parse(readFileSync(path, 'utf8')))
      if (parsed !== undefined) activeId = parsed.activeId
    } catch {
      // Absent or unreadable: the browser half owns the fallback palette.
    }
    return injectBootAttribute(html, activeId)
  }), 'dsh-skin-manager: boot skin attribute')

  try {
    const stored = JSON.parse(readFileSync(path, 'utf8'))
    ctx.logger.info?.(`dsh-skin-manager: active skin ${JSON.stringify(stored?.activeId ?? null)}`)
  } catch {
    ctx.logger.info?.('dsh-skin-manager: no stored skin preference yet')
  }
}
