// 舞台客户端：插件唯一要做的事，就是把工具调用转给独立舞台进程。
//
// 这里刻意不 import 任何 DSH 的东西，也不碰舞台的渲染逻辑。
// 两者之间只有 HTTP 和一份令牌。
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 舞台默认地址；可被环境变量改掉（换端口、换机器）。 */
export const DEFAULT_BASE = process.env.STAGE_BASE_URL ?? 'http://127.0.0.1:5462'

/** 令牌文件：舞台启动时写，权限 0600，只在本机可见。 */
export function tokenPath(home) {
  return process.env.STAGE_TOKEN_FILE ?? join(home, 'live2d', 'stage-token')
}

export function createStageClient({ base = DEFAULT_BASE, home, logger = null } = {}) {
  let cachedToken = process.env.STAGE_TOKEN ?? null
  let cachedAt = 0
  const TOKEN_TTL_MS = 30_000

  async function token() {
    if (cachedToken !== null && Date.now() - cachedAt < TOKEN_TTL_MS) return cachedToken
    try {
      const text = await readFile(tokenPath(home), 'utf8')
      cachedToken = text.trim()
      cachedAt = Date.now()
      return cachedToken
    } catch (error) {
      // 令牌读不到通常是「舞台还没启动」：这不是错误，是要告诉用户的一句人话。
      logger?.warn?.(`[live2d] 读不到舞台令牌（${tokenPath(home)}）：${error?.message ?? error}`)
      return null
    }
  }

  /** 统一请求：超时、错误分类、令牌都收在这里，工具层只管拿结果。 */
  async function request(path, { method = 'GET', body = null, timeoutMs = 15_000 } = {}) {
    const key = await token()
    if (key === null) {
      return { ok: false, code: 'NO_TOKEN', error: '舞台还没启动（读不到令牌）：先运行 npm run stage 打开独立舞台' }
    }
    const url = new URL(path, base)
    url.searchParams.set('token', key)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(url, {
        method,
        signal: controller.signal,
        ...body === null ? {} : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload?.ok === false) {
        return {
          ok: false,
          code: payload?.code ?? `HTTP_${response.status}`,
          error: payload?.error ?? payload?.hint ?? `舞台返回 HTTP ${response.status}`,
        }
      }
      return { ok: true, ...payload }
    } catch (error) {
      if (error?.name === 'AbortError') {
        return { ok: false, code: 'TIMEOUT', error: `舞台在 ${Math.round(timeoutMs / 1000)} 秒内没有响应` }
      }
      const refused = String(error?.cause?.code ?? '') === 'ECONNREFUSED'
      return {
        ok: false,
        code: refused ? 'NOT_RUNNING' : 'UNREACHABLE',
        error: refused
          ? `舞台没有在 ${base} 上运行：先启动独立舞台（npm run stage）`
          : `连不上舞台：${error?.message ?? error}`,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    base,
    request,
    ping: () => request('/api/ping', { timeoutMs: 4000 }),
    capabilities: (name) => request(`/api/capabilities${name === undefined ? '' : `?name=${encodeURIComponent(name)}`}`, { timeoutMs: 15_000 }),
    catalog: (name) => request(`/api/catalog${name === undefined ? '' : `?name=${encodeURIComponent(name)}`}`, { timeoutMs: 15_000 }),
    compile: (plan, name) => request('/api/compile', { method: 'POST', body: { plan, model: name }, timeoutMs: 20_000 }),
    perform: (plan, { name, requestId } = {}) => request('/api/perform', { method: 'POST', body: { plan, model: name, requestId }, timeoutMs: 20_000 }),
    state: () => request('/api/state', { timeoutMs: 8000 }),
    stop: () => request('/api/stop', { method: 'POST', body: {}, timeoutMs: 8000 }),
    audit: () => request('/api/audit', { timeoutMs: 8000 }),
  }
}
