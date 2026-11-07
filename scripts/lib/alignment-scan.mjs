import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { scanQqFeedSnapshot } from '../../plugins/_shared/qq-feed.mjs'

/** Scan only on an explicit request; detected identities remain unapproved candidates. */
export function createAlignmentScanner({ qqFeedFile, qqConfigFile, biliCredFile, biliToolsDir, detect, add, pullBili, resolveBili }) {
  async function scanQqFeedForCandidates({ maxMessages = 800 } = {}) {
    const readConfig = () => { if (!qqConfigFile) return null; try { return readFileSync(qqConfigFile, 'utf8') } catch (error) { if (error.code === 'ENOENT') return null; throw error } }
    const initialConfig = readConfig(), config = initialConfig === null ? {} : JSON.parse(initialConfig)
    const groups = new Set((Array.isArray(config.allow?.groups) ? config.allow.groups : []).map(String))
    const owner = String(config.ownerQQ ?? '')
    const cutoff = Date.now() - 30 * 86400000
    const limit = Math.max(1, Math.min(5000, Number(maxMessages) || 800))
    const recent = await scanQqFeedSnapshot(qqFeedFile, () => {
      const rows = []
      return { line(line) {
      if (!line || !line.trim()) return
      let row; try { row = JSON.parse(line) } catch { return }
      if (!row || typeof row !== 'object' || Array.isArray(row) || Date.parse(row.at) < cutoff || !Number.isFinite(Date.parse(row.at))) return
      const group = String(row.groupId ?? ''), sender = String(row.senderId ?? ''), key = row.conversationKey ?? row.key
      if (!groups.has(group) || !sender || row.isOwner === true || (owner && sender === owner) || row.private === true || row.isPrivate === true || (row.kind != null && row.kind !== 'group') || (row.message_type != null && row.message_type !== 'group') || (key != null && String(key) !== `group:${group}`)) return
      rows.push(row)
      if (rows.length > limit) rows.shift()
      }, result: () => rows }
    }) ?? []
    if (readConfig() !== initialConfig) throw new Error('QQ 配置在候选扫描期间发生变化，请重新扫描')
    let added = 0
    for (const row of recent) {
      const sender = String(row.senderId ?? '')
      const hits = detect({ platform: 'qq', text: String(row.text ?? ''), author: { id: sender, name: String(row.senderName ?? '') }, source: 'qq-public-feed', counterpartPlatform: 'bili' })
      for (const candidate of hits) if (add(candidate)) added++
    }
    return { at: new Date().toISOString(), scanned: recent.length, added }
  }
  async function scanBiliFeedForCandidates({ maxPages = 2 } = {}) {
    try {
      const credentials = biliCredFile && existsSync(biliCredFile) ? JSON.parse(readFileSync(biliCredFile, 'utf8')) : null
      if (!credentials?.sessdata || !credentials?.bili_jct) return { ok: false, error: 'B站凭据未配置，无法扫描 B 站侧候选', added: 0 }
      let items, resolveReply = resolveBili, failedSources = []
      if (pullBili) items = await pullBili(credentials, maxPages)
      else {
        const { pullFeed, makeHeaders, resolveLatestReply } = await import(pathToFileURL(join(biliToolsDir, 'lib', 'msgfeed.mjs')).href)
        const kinds = ['reply', 'at'], headers = makeHeaders(credentials), results = await Promise.allSettled(kinds.map(kind => pullFeed(kind, { headers, pages: maxPages })))
        if (results.every(result => result.status === 'rejected')) throw new Error('B站公开消息读取失败')
        failedSources = kinds.filter((_, i) => results[i].status === 'rejected')
        items = results.flatMap(result => result.status === 'fulfilled' ? result.value.items ?? [] : [])
        resolveReply ||= item => resolveLatestReply({ business: item.business, oid: item.oid, root: item.root, mid: item.mid, parentRpid: item.parent, headers })
      }
      let added = 0, unresolved = 0
      const recent = items.slice(0, 400)
      for (let offset = 0; offset < recent.length; offset += 4) {
        const group = recent.slice(offset, offset + 4)
        const texts = await Promise.all(group.map(async item => {
          const direct = String(item?.text ?? item?.content ?? '').trim()
          if (direct) return direct
          if (!resolveReply || !item?.mid || !item?.oid || !item?.root || !item?.parent) return ''
          try { const reply = await resolveReply(item, credentials); return reply?.exact === true ? String(reply.text ?? '').trim() : '' } catch { return '' }
        }))
        for (let i = 0; i < group.length; i++) {
          if (!texts[i]) { unresolved++; continue }
          const item = group[i]
          const hits = detect({ platform: 'bili', text: texts[i], author: { id: String(item?.mid ?? ''), name: String(item?.who ?? item?.uname ?? '') }, source: 'bili-public-feed', counterpartPlatform: 'qq' })
          for (const candidate of hits) if (add(candidate)) added++
        }
      }
      return { ok: true, at: new Date().toISOString(), scanned: recent.length, added, unresolved, failedSources }
    } catch { return { ok: false, error: 'B站候选扫描失败，请检查凭据和网络', added: 0 } }
  }
  return { scanQqFeedForCandidates, scanBiliFeedForCandidates }
}
