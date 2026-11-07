import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

const names = new Set(['memory', 'voice', 'asr', 'mempalace', 'surfcore-adapter', 'evolution'])
/** Domain error codes stay readable to the caller, but only for the component that owns the prefix. */
const errorCodes = { memory: /^(?:MEMORY_|SUBJECT_|ACTMEM_)/, asr: /^ASR_/, mempalace: /^MEMPALACE_/, 'surfcore-adapter': /^SURFCORE_ADAPTER_/, evolution: /^EVOLUTION_/ }
function validName(name) { if (!names.has(name)) throw new Error('Unknown component'); return name }
function loopback(input) {
  let url
  try { url = new URL(input) } catch { throw new Error('Component URL must be loopback HTTP') }
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Component URL must be loopback HTTP')
  return url.origin
}
function equalToken(a, b) {
  const left = Buffer.from(String(a ?? ''))
  const right = Buffer.from(String(b ?? ''))
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right)
}
function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}
async function readBody(req) {
  const chunks = []; let size = 0
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > 512 * 1024) throw new Error('Component request is too large')
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

/** Register a loopback-only endpoint and publish a private, ephemeral discovery file. */
export function registerComponentInternal(ctx, { home, name, handle }) {
  validName(name)
  if (!home || !isAbsolute(home)) throw new Error('A project-local DSH_HOME is required')
  const port = Number(ctx.webServer.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Component web server port is unavailable')
  const dir = join(home, name)
  if (existsSync(dir) && lstatSync(dir).isSymbolicLink()) throw new Error('Component state directory must not be a symlink')
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const token = randomBytes(32).toString('hex')
  const file = join(dir, 'runtime.json')
  if (existsSync(file) && !lstatSync(file).isFile()) throw new Error('Component discovery path is not a file')
  const prefix = `/dsh-${name}/internal`
  const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
    const fail = (status, code, message, hint = '检查插件是否已启用并重试') => send(res, status, { ok: false, code, error: message, hint })
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(String(req.headers.host ?? '').toLowerCase()) || req.headers.origin) return fail(403, 'COMPONENT_ORIGIN', '只允许本机内部调用')
    if (!equalToken(req.headers['x-component-token'], token)) return fail(401, 'COMPONENT_AUTH', '内部调用认证失败')
    try {
      const url = new URL(req.url, 'http://127.0.0.1')
      if (!url.pathname.startsWith(`${prefix}/`)) return fail(404, 'NOT_FOUND', '未知接口')
      const body = req.method === 'GET' ? {} : await readBody(req)
      return send(res, 200, await handle({ method: req.method, path: url.pathname.slice(prefix.length), query: url.searchParams, body }))
    } catch (error) {
      const known = errorCodes[name]?.test(String(error?.code ?? ''))
      return fail(400, known ? error.code : 'COMPONENT_REQUEST_FAILED', String(error?.message ?? error), error?.hint)
    }
  } })
  try {
    const temp = `${file}.${randomUUID()}.tmp`
    writeFileSync(temp, `${JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, token })}\n`, { flag: 'wx', mode: 0o600 })
    renameSync(temp, file)
  } catch (error) { disposeRoute(); throw error }
  return () => {
    disposeRoute()
    try { if (JSON.parse(readFileSync(file, 'utf8')).token === token) unlinkSync(file) } catch {}
  }
}

/** A disconnected or disabled component fails explicitly; no fallback writes to legacy data. */
export async function callComponent({ home, name, path, body, fetchImpl = fetch, timeoutMs = 65000 }) {
  validName(name)
  if (!home || !isAbsolute(home) || !/^\/[a-z0-9/-]+$/.test(String(path))) throw new Error('Invalid component request')
  let discovery
  try { discovery = JSON.parse(readFileSync(join(home, name, 'runtime.json'), 'utf8')) }
  catch { throw new Error(`${name} component is unavailable`) }
  const base = loopback(discovery.baseUrl)
  if (typeof discovery.token !== 'string' || !/^[a-f0-9]{64}$/.test(discovery.token)) throw new Error(`${name} component is unavailable`)
  let response
  const longRefresh = name === 'memory' && path === '/bili/refresh'
  const signal = AbortSignal.timeout(Math.max(1000, Math.min(longRefresh ? 600000 : 130000, Number(timeoutMs) || 65000)))
  try {
    response = await fetchImpl(`${base}/dsh-${name}/internal${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-component-token': discovery.token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal,
    })
  } catch { if (longRefresh && signal.aborted) throw new Error('B站记忆刷新等待超时；后台任务可能仍在运行，请稍后查看记忆状态')
    throw new Error(`${name} component is unavailable`) }
  const data = await response.json()
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || `${name} component request failed`)
    error.code = data.code || 'COMPONENT_REQUEST_FAILED'
    if (typeof data.hint === 'string') error.hint = data.hint
    throw error
  }
  return data
}
