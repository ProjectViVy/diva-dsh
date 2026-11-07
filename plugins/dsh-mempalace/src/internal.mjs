import { registerComponentInternal } from '../../_shared/ipc.mjs'

/**
 * Loopback-only intake used by ActMem to hand over archived memory bodies.
 * Kept separate from the panel API so the archive has exactly one write entry point.
 */
export function registerMempalaceInternal(ctx, home, service) {
  return registerComponentInternal(ctx, { home, name: 'mempalace', handle: async ({ method, path, body }) => {
    if (method === 'POST' && path === '/archive') return service.archiveCommit(body)
    if (method === 'POST' && path === '/archive/status') return service.archiveStatus(body?.archive_ids)
    if (method === 'POST' && path === '/knowledge/commit') return service.knowledgeCommit(body)
    if (method === 'POST' && path === '/knowledge/status') return service.knowledgeStatus(body)
    if (method === 'POST' && path === '/knowledge/rollback') return service.knowledgeRollback(body)
    throw new Error('Unknown mempalace component operation')
  } })
}
