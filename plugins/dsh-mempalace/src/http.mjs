const prefix = '/dsh-mempalace/api'
const DEFAULT_BODY_LIMIT = 512 * 1024
const IMPORT_BODY_LIMIT = 10 * 1024 * 1024

function send(res, status, value) {
  if (res.writableEnded || res.destroyed) return
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(value))
}

function allowedHost(host) {
  const value = String(host ?? '').toLowerCase()
  return /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(value)
}

async function readBody(req, limit = DEFAULT_BODY_LIMIT) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk)
    if (size > limit) {
      const error = new Error(`请求体超过 ${Math.round(limit / 1024)} KB 上限`)
      error.status = 413
      throw error
    }
    chunks.push(Buffer.from(chunk))
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text.trim() ? JSON.parse(text) : {}
}

function integer(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function string(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function errorPayload(error) {
  return {
    ok: false,
    code: error?.code || 'MEMPALACE_OPERATION_FAILED',
    error: error instanceof Error ? error.message : String(error),
    ...(typeof error?.hint === 'string' && error.hint ? { hint: error.hint } : {}),
  }
}

function errorStatus(error) {
  if (error?.status) return error.status
  if (error?.code === 'MEMPALACE_UNAVAILABLE') return 503
  if (error?.code === 'INVALID_ARGS') return 400
  return 400
}

/** JSON-only POST guard shared by every mutating endpoint. */
function requireJson(req, fail) {
  if (!String(req.headers['content-type'] ?? '').toLowerCase().includes('application/json')) {
    fail(415, 'JSON_REQUIRED', '请求必须使用 JSON', '刷新页面后重试')
    return false
  }
  return true
}

/**
 * Register the management HTTP API.
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {import('./service.mjs').MempalaceService} service
 */
export function registerMempalaceHttp(ctx, service) {
  return ctx.webServer.register({
    kind: 'prefix',
    path: prefix,
    handler: async (req, res) => {
      const fail = (status, code, error, hint) => send(res, status, { ok: false, code, error, ...(hint ? { hint } : {}) })
      if (!allowedHost(req.headers.host)) {
        return fail(403, 'HOST_REJECTED', '只接受本机访问', '使用本地 DSH 面板打开记忆宫殿插件')
      }
      if (req.method !== 'GET' && req.headers.origin) {
        let same = false
        try { same = new URL(req.headers.origin).host.toLowerCase() === String(req.headers.host).toLowerCase() } catch { /* malformed origin */ }
        if (!same) return fail(403, 'ORIGIN_REJECTED', '跨站请求被拒绝', '在 DSH 面板内重试')
      }
      const conn = ctx.get('connection')
      if (!conn || typeof conn.requestRejection !== 'function') {
        return fail(503, 'AUTH_UNAVAILABLE', '会话验证不可用', '检查 DSH 连接服务是否已组合')
      }
      const rejection = conn.requestRejection(req)
      if (rejection !== undefined && rejection !== null && rejection !== false) {
        return fail(typeof rejection === 'number' ? rejection : 403, 'AUTH_REJECTED', '会话未通过验证', '重新打开本地面板链接')
      }

      const url = new URL(req.url, 'http://127.0.0.1')
      const route = url.pathname.slice(prefix.length)
      const query = url.searchParams
      try {
        if (route === '/status' && req.method === 'GET') {
          return send(res, 200, { ok: true, snapshot: await service.statusSnapshot() })
        }
        if (route === '/wakeup' && req.method === 'GET') {
          return send(res, 200, { ok: true, ...await service.wakeupPreview({ project: string(query.get('project')) || null }) })
        }
        if (route === '/memories' && req.method === 'GET') {
          const listed = await service.listMemories({
            project: string(query.get('project')) || undefined,
            topic: string(query.get('topic')) || undefined,
            source: string(query.get('source')) || undefined,
            q: string(query.get('q')) || undefined,
            limit: integer(query.get('limit'), 20),
            offset: integer(query.get('offset'), 0),
            sort: string(query.get('sort')) || 'newest',
          })
          return send(res, 200, { ok: true, ...listed })
        }
        if (route === '/memories' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          const saved = await service.saveMemory({
            content: body.content,
            project: body.project,
            topic: body.topic,
            source: body.source || 'manual-save',
            importance: body.importance,
            session_id: body.session_id || '',
          })
          return send(res, 200, { ok: true, ...saved })
        }
        if (route === '/memories/delete' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          const deleted = await service.deleteMemory(string(body.id))
          return send(res, 200, { ok: true, ...deleted })
        }
        if (route === '/search' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          const searched = await service.search(string(body.query), {
            project: string(body.project) || null,
            topic: string(body.topic) || null,
            n_results: Number(body.n_results) || undefined,
          })
          return send(res, 200, { ok: true, ...searched })
        }
        if (route === '/rooms' && req.method === 'GET') {
          return send(res, 200, { ok: true, rooms: await service.rooms(string(query.get('project')) || undefined) })
        }
        if (route === '/taxonomy' && req.method === 'GET') {
          return send(res, 200, { ok: true, taxonomy: await service.taxonomy() })
        }
        if (route === '/graph/palace' && req.method === 'GET') {
          return send(res, 200, { ok: true, graph: await service.palace() })
        }
        if (route === '/graph/tunnel' && req.method === 'GET') {
          const topic = string(query.get('topic'))
          const projectA = string(query.get('projectA') || query.get('project_a'))
          const projectB = string(query.get('projectB') || query.get('project_b'))
          if (!topic || !projectA || !projectB) {
            return fail(400, 'INVALID_ARGS', 'topic、projectA、projectB 均为必填', '从宫殿图中选择一条隧道后重试')
          }
          return send(res, 200, {
            ok: true,
            results: await service.tunnel(topic, projectA, projectB, integer(query.get('n'), 10)),
          })
        }
        if (route === '/knowledge/stats' && req.method === 'GET') {
          return send(res, 200, { ok: true, stats: await service.knowledgeStats() })
        }
        if (route === '/knowledge/entities' && req.method === 'GET') {
          return send(res, 200, {
            ok: true,
            entities: await service.listEntities({ q: string(query.get('q')), limit: integer(query.get('limit'), 50) }),
          })
        }
        if (route === '/knowledge/query' && req.method === 'GET') {
          const entity = string(query.get('entity'))
          if (!entity) return fail(400, 'INVALID_ARGS', 'entity 不能为空', '输入实体名称后重试')
          return send(res, 200, {
            ok: true,
            ...await service.queryEntity(entity, {
              at_time: string(query.get('at_time')) || undefined,
              project: string(query.get('project')) || undefined,
            }),
          })
        }
        if (route === '/knowledge/entity' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          const created = await service.addEntity({
            name: body.name,
            entity_type: body.entity_type || body.type,
            properties: body.properties,
          })
          return send(res, 200, { ok: true, ...created })
        }
        if (route === '/knowledge/triple' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          const created = await service.addTriple({
            subject: body.subject,
            predicate: body.predicate,
            object: body.object,
            valid_from: body.valid_from || null,
            valid_to: body.valid_to || null,
            confidence: body.confidence,
            project: body.project || 'general',
          })
          return send(res, 200, { ok: true, ...created })
        }
        if (route === '/knowledge/invalidate' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          if (body.id !== undefined && body.id !== null && body.id !== '') {
            return send(res, 200, { ok: true, ...await service.invalidateTriple(Number(body.id), body.ended) })
          }
          const invalidated = await service.invalidateFact(
            string(body.subject),
            string(body.predicate),
            string(body.object),
            body.ended || new Date().toISOString(),
          )
          if (invalidated.status === 'not_found') {
            return fail(404, 'NOT_FOUND', '没有找到仍有效的事实', '先用知识图谱查询确认主语、谓语和宾语')
          }
          return send(res, 200, { ok: true, ...invalidated })
        }
        if (route === '/knowledge/timeline' && req.method === 'GET') {
          return send(res, 200, {
            ok: true,
            timeline: await service.timeline(string(query.get('entity')) || undefined),
          })
        }
        if (route === '/diary' && req.method === 'GET') {
          return send(res, 200, {
            ok: true,
            entries: await service.diaryRead({
              agent_name: string(query.get('agent_name')) || 'agent',
              last_n: integer(query.get('last_n'), 10),
              project: string(query.get('project')) || undefined,
            }),
          })
        }
        if (route === '/diary' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          return send(res, 200, {
            ok: true,
            ...await service.diaryWrite({
              agent_name: body.agent_name || 'agent',
              entry: body.entry,
              topic: body.topic || undefined,
            }),
          })
        }
        if (route === '/config' && req.method === 'GET') {
          const snapshot = await service.statusSnapshot()
          return send(res, 200, {
            ok: true,
            config: snapshot.config,
            models: snapshot.models,
            diagnostics: snapshot.diagnostics,
            paths: snapshot.paths,
            state: snapshot.state,
            error: snapshot.error,
            hint: snapshot.hint,
          })
        }
        if (route === '/config' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req)
          return send(res, 200, { ok: true, config: await service.updateConfig(body) })
        }
        if (route === '/export' && req.method === 'GET') {
          const payload = await service.exportAll()
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          if (res.writableEnded || res.destroyed) return
          res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="mempalace-${stamp}.json"`,
            'cache-control': 'no-store',
          })
          return res.end(`${JSON.stringify(payload, null, 2)}\n`)
        }
        if (route === '/import' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          const body = await readBody(req, IMPORT_BODY_LIMIT)
          const payload = body?.payload ?? body
          return send(res, 200, { ok: true, summary: await service.importAll(payload) })
        }
        if (route === '/maintenance/vacuum' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          await readBody(req)
          return send(res, 200, { ok: true, ...await service.vacuum() })
        }
        if (route === '/reindex' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          await readBody(req)
          return send(res, 200, { ok: true, ...await service.reindex() })
        }
        if (route === '/models/warmup' && req.method === 'POST') {
          if (!requireJson(req, fail)) return
          await readBody(req)
          return send(res, 200, { ok: true, result: await service.warmModels() })
        }
        if (route === '/models/status' && req.method === 'GET') {
          return send(res, 200, { ok: true, models: service.modelsStatus() })
        }
        return fail(404, 'NOT_FOUND', '未知接口', '刷新记忆宫殿面板后重试')
      } catch (error) {
        if (res.destroyed) return
        return send(res, errorStatus(error), errorPayload(error))
      }
    },
  })
}
