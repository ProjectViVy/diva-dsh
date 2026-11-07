// 面板 API：/dsh-asr/api
//
// 与语音插件同一套门禁：只认本机 Host、写请求要同源、再过 DSH 的会话校验。
// 换句话说，这个口子只服务「当前这台机器上的、已登录的 DSH 面板」。
import { toAsrError } from './errors.mjs'

const prefix = '/dsh-asr/api'
const DEFAULT_BODY_LIMIT = 512 * 1024

function send(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

async function readBody(req, limit = DEFAULT_BODY_LIMIT) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > limit) {
      const error = new Error('请求体过大')
      error.code = 'ASR_BODY_TOO_LARGE'
      throw error
    }
    chunks.push(Buffer.from(chunk))
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
}

export function registerAsrHttp(ctx, service, { logger = null } = {}) {
  return ctx.webServer.register({ kind: 'prefix', path: prefix, handler: async (req, res) => {
    const fail = (status, code, error, hint) => send(res, status, { ok: false, code, error, ...(hint ? { hint } : {}) })
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(String(req.headers.host ?? '').toLowerCase())) return fail(403, 'HOST_REJECTED', '只接受本机访问', '在本地 DSH 面板里打开语音识别')
    if (req.method !== 'GET' && req.headers.origin) {
      let same = false
      try { same = new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host).toLowerCase() } catch {}
      if (!same) return fail(403, 'ORIGIN_REJECTED', '跨站请求被拒绝', '在 DSH 面板内重试')
    }
    const conn = ctx.get('connection')
    if (!conn || typeof conn.requestRejection !== 'function') return fail(503, 'AUTH_UNAVAILABLE', '会话验证不可用', '检查 DSH 连接服务')
    const rejection = conn.requestRejection(req)
    if (rejection !== undefined && rejection !== null && rejection !== false) return fail(typeof rejection === 'number' ? rejection : 403, 'AUTH_REJECTED', '会话未通过验证', '重新打开本地面板链接')
    const url = new URL(req.url, 'http://127.0.0.1')
    try {
      if (req.method === 'GET' && url.pathname === `${prefix}/asr/catalog`) return send(res, 200, service.catalog())
      if (req.method === 'GET' && url.pathname === `${prefix}/asr/rules`) return send(res, 200, service.rules())
      if (req.method === 'GET' && url.pathname === `${prefix}/asr/status`) return send(res, 200, service.status())
      if (req.method === 'GET' && url.pathname === `${prefix}/asr/prepare`) return send(res, 200, service.prepareStatus())
      if (req.method === 'GET' && url.pathname === `${prefix}/asr/audit`) {
        const raw = url.searchParams.get('limit')
        const limit = raw === null ? 20 : Number(raw)
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) return fail(400, 'ASR_LIMIT_INVALID', '审计条数无效', '传 1~200 之间的整数')
        return send(res, 200, { ok: true, records: service.recentAudit(limit) })
      }
      if (req.method !== 'POST') return fail(404, 'NOT_FOUND', '未知接口', '刷新页面后重试')
      if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) return fail(415, 'JSON_REQUIRED', '请求必须使用 JSON', '刷新页面后重试')
      const limit = url.pathname === `${prefix}/asr/transcribe` ? service.catalog().limits.maxBytes * 2 + 4096 : DEFAULT_BODY_LIMIT
      const body = await readBody(req, limit)
      if (url.pathname === `${prefix}/asr/rules`) return send(res, 200, service.saveRules(body))
      if (url.pathname === `${prefix}/asr/prepare`) return send(res, 200, await service.prepare({ engineId: typeof body.engine === 'string' ? body.engine : undefined }))
      if (url.pathname === `${prefix}/asr/prepare-cancel`) return send(res, 200, service.cancelPrepare())
      if (url.pathname === `${prefix}/asr/transcribe`) return send(res, 200, await service.transcribe({ audio: typeof body.audio === 'string' ? body.audio : undefined, audioBytes: body.audioBytes, language: typeof body.language === 'string' ? body.language : undefined, source: 'panel' }))
      if (url.pathname === `${prefix}/asr/self-check`) return send(res, 200, await service.selfCheck({ inference: body.inference !== false }))
      return fail(404, 'NOT_FOUND', '未知接口', '刷新页面后重试')
    } catch (error) {
      const failure = toAsrError(error)
      logger?.warn?.(`[asr] ${req.method} ${url.pathname} 失败：${failure.message}`)
      return fail(failure.status ?? 400, failure.code, failure.message, failure.hint)
    }
  } })
}

export { prefix as ASR_HTTP_PREFIX, readBody as readAsrBody }
