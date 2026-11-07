import { createHash } from 'node:crypto'
import { callComponent } from '../../plugins/_shared/ipc.mjs'

export function prepareMemoryEvent(event) {
  const id = event.id || createHash('sha256').update(JSON.stringify([event.at, event.senderId, event.conversationKey, event.text])).digest('hex')
  return { ...event, id: String(id), platform: 'qq' }
}

/** Explicit boundary between SurfCore and the project-owned component services. */
export function createSurfcoreComponentClient({ home, fetchImpl = fetch }) {
  const call = (name, path, body, timeoutMs) => callComponent({ home, name, path, body, fetchImpl, timeoutMs })
  return {
    recordMemory(event) {
      return call('memory', '/events', prepareMemoryEvent(event))
    },
    /** Hands one accepted QQ event to the edge adapter, which turns it into an orchestrator input. */
    ingestQq(event) { return call('surfcore-adapter', '/ingest', event, 9000) },
    proactiveCandidate(candidate) { return call('surfcore-adapter', '/proactive', candidate, 9000) },
    ingestBili(items) { return call('surfcore-adapter', '/events', { platform: 'bili', items }, 9000) },
    memoryHealth() { return call('memory', '/health', undefined, 2000) },
    qqSyncStatus(timeoutMs) { return call('memory', '/qq-sync/status', undefined, timeoutMs) },
    syncQqToBili() { return call('memory', '/qq-sync/run', {}) },
    biliBrief(timeoutMs) { return call('memory', '/bili/brief', undefined, timeoutMs) },
    async memoryContext(platform) {
      if (!['qq', 'bili'].includes(platform)) throw new Error('Unknown memory platform')
      return (await call('memory', `/context/${platform}`)).text
    },
    readSession(key) { return call('memory', '/session/read', { key }) },
    writeSession(key, value, revision) { return call('memory', '/session/write', { key, value, revision }) },
    touchSessionTopics(key, topics, at, hashed = false) { return call('memory', '/session/touch-topics', { key, topics, at, hashed }) },
    memoryModules() { return call('memory', '/modules', undefined, 5000) },
    updateMemoryModule(section, changes) { return call('memory', '/settings/module', { section, changes }) },
    dedupeSessions(mappings) { return call('memory', '/session/dedupe', { mappings }) },
    assessClosure(input) { return call('memory', '/closure/assess', input) },
    closureGate(assessment, config = null) { return call('memory', '/closure/gate', { assessment, config }) },
    saveClosure(input) { return call('memory', '/closure/save', input) },
    closureStatus(key) { return call('memory', '/closure/status', { key }) },
    reopenClosure(input) { return call('memory', '/closure/reopen', input) },
    closurePrompt(input) { return call('memory', '/closure/prompt', input) },
    closureSuppress(input) { return call('memory', '/closure/suppress', input) },
    slangList(input = {}) { return call('memory', '/slang/list', input) },
    slangUpsert(input) { return call('memory', '/slang/upsert', input) },
    slangDelete(id) { return call('memory', '/slang/delete', { id }) },
    slangContext(input = {}) { return call('memory', '/slang/context', input) },
    slangExtractionPrompt(messages) { return call('memory', '/slang/extraction-prompt', { messages }) },
    slangResearchPrompt(candidates) { return call('memory', '/slang/research-prompt', { candidates }) },
    slangApplyExtraction(input) { return call('memory', '/slang/apply-extraction', input) },
    slangApplyResearch(input) { return call('memory', '/slang/apply-research', input) },
    historyCatchup(input) { return call('memory', '/history/catchup', input) },
    contextSnapshot(input) { return call('memory', '/context/snapshot', input) },
    synthesize({ text, baseUrl, character, voice, style, timeoutMs, cacheVersion, useDefaultVoice, useRouteVoice }) {
      const wait = Math.max(65000, Math.min(125000, (Number(timeoutMs) || 60000) + 5000))
      return call('voice', '/synthesize', { text, baseUrl, character, voice, style, timeoutMs, cacheVersion, useDefaultVoice, useRouteVoice }, wait)
    },
    voiceRules() { return call('voice', '/rules') },
    voiceHealth() { return call('voice', '/health', undefined, 2000) },
    prepareVoiceSend(input) { return call('voice', '/prepare-send', input, 130000) },
    commitVoiceSend(token, detail = {}) { return call('voice', '/commit-send', { ...detail, token }) },
    abortVoiceSend(token) { return call('voice', '/abort-send', { token }) },
    voiceLibrary(offset = 0) { return call('voice', '/library/list', { offset }) },
    resolveVoiceLibrary(input) { return call('voice', '/library/resolve', input) },
    probeVoiceLibrary(offset = 0) { return call('voice', '/library/probe', { offset }, 130000) },
    voicePolicy(input) { return call('voice', '/policy/trigger', input) },
    voiceAuditCheck(subject, knownTokens = []) { return call('voice', '/audit/check', { subject, knownTokens }) },
    voiceBudget(scopeKey = '') { return call('voice', '/budget/status', { scopeKey }) },
    voicePacks(timeoutMs = 8000) { return call('voice', '/packs', undefined, timeoutMs) },
    activateVoicePack(id) { return call('voice', '/packs/activate', { id }, 120000) },
    stopOwnedVoicePacks() { return call('voice', '/packs/stop-owned', {}, 120000) },
    refreshBili() { return call('memory', '/bili/refresh', {}, 600000) },
    recordBiliShare(id, slot) { return call('memory', '/bili/record-share', { id, slot }) },
  }
}

/** Read-only component checks for the SurfCore diagnostics page. */
export async function collectSplitComponentDiagnostics(client) {
  const timeout = 2500
  const results = await Promise.allSettled([
    client.qqSyncStatus(timeout), client.biliBrief(timeout), client.voicePacks(timeout),
  ])
  const checks = []
  const add = (name, ok, detail) => checks.push({ name, ok, detail })
  const [qq, bili, voice] = results
  if (qq.status === 'rejected') add('QQ→B站记忆', false, '独立记忆插件不可用')
  else if (!qq.value?.config || typeof qq.value.config.enabled !== 'boolean') add('QQ→B站记忆', false, '同步状态无效')
  else if (!qq.value.config.enabled) add('QQ→B站记忆', true, '未开启（正常）')
  else if (qq.value.summaryError) add('QQ→B站记忆', false, '同步摘要无法读取，请在记忆页检查')
  else if (qq.value.summaryBlocked) add('QQ→B站记忆', false, '同步摘要隐私检查未通过，请在记忆页检查')
  else add('QQ→B站记忆', Boolean(qq.value.text), qq.value.text ? '同步摘要可用' : '尚无同步摘要，请在记忆页同步')
  if (bili.status === 'rejected') add('B站→QQ简报', false, '独立记忆插件不可用')
  else if (typeof bili.value?.enabled !== 'boolean') add('B站→QQ简报', false, '简报状态无效')
  else if (!bili.value.enabled) add('B站→QQ简报', true, '未开启（正常）')
  else if (bili.value.blocked) add('B站→QQ简报', false, '简报隐私检查未通过，请在记忆页检查')
  else add('B站→QQ简报', Number(bili.value.status?.briefChars) > 0, Number(bili.value.status?.briefChars) > 0 ? '简报可用' : '尚无简报，请在记忆页刷新')
  if (voice.status === 'rejected') add('语音组件（可选）', false, '独立语音插件不可用')
  else if (!Array.isArray(voice.value?.packs)) add('语音组件（可选）', false, '语音包状态无效')
  else {
    const packs = voice.value.packs, installed = packs.filter(item => item.installed).length, running = packs.filter(item => item.running).length
    add('语音组件（可选）', true, `已安装 ${installed} 个语音包，运行 ${running} 个；自检请打开语音页`)
  }
  return checks
}

/** Asynchronous extension access to the independently owned memory service. */
export function createExtensionMemoryApi(options) {
  const client = createSurfcoreComponentClient(options)
  return {
    async memoryStatus() {
      const [qq, bili] = await Promise.allSettled([client.qqSyncStatus(), client.biliBrief()])
      if (qq.status === 'rejected' && bili.status === 'rejected') throw qq.reason
      const value = result => result.status === 'fulfilled' ? result.value : { ok: false, error: String(result.reason?.message ?? result.reason), code: result.reason?.code || 'COMPONENT_REQUEST_FAILED' }
      return { qqToBili: value(qq), biliToQq: value(bili) }
    },
    async previewQqForBili({ maxChars = 8000 } = {}) {
      const status = await client.qqSyncStatus()
      if (status.summaryError) throw new Error(status.summaryError)
      if (status.summaryBlocked) return { ok: false, blocked: true, labels: status.summaryLabels || [], text: '', chars: 0 }
      const text = String(status.text ?? ''), number = Number(maxChars)
      const limit = Number.isFinite(number) ? Math.max(0, Math.min(20000, Math.floor(number))) : 8000
      return { ok: true, text: text.slice(0, limit), chars: text.length }
    },
    syncQqToBili: () => client.syncQqToBili(),
    refreshBiliToQq: () => client.refreshBili(),
    biliToQqStatus: () => client.biliBrief(),
    async auditTail(limit = 40) {
      const status = await client.qqSyncStatus(), number = Number(limit)
      if (status.auditError) throw new Error(status.auditError)
      const count = Number.isFinite(number) ? Math.max(1, Math.min(40, Math.floor(number))) : 40
      return (Array.isArray(status.audit) ? status.audit : []).slice(-count)
    },
  }
}
