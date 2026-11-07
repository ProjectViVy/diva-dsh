import { readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { createSurfcoreComponentClient } from './surfcore-component-client.mjs'
import { createBiliMemory } from '../../plugins/memory/src/bili-memory.mjs'
import { createMemoryOutbox } from './memory-outbox.mjs'
import { scanText } from '../../plugins/memory/src/privacy.mjs'
import { assertSessionDatabaseReady } from '../../plugins/memory/src/session-memory.mjs'
export { renderSplitConsole } from './surfcore-console.mjs'

export function createBridgeHooks({ home, fetchImpl = fetch, log = message => console.warn(message), qqConfigFile = process.env.SURFCORE_CONFIG_FILE || join(home, 'surfcore', 'config.json') }) {
  const client = createSurfcoreComponentClient({ home, fetchImpl })
  const cache = new Map()
  let lastWarning = 0
  function warn(error) {
    if (Date.now() - lastWarning < 30000) return
    lastWarning = Date.now()
    log(`独立组件不可用：${String(error?.message ?? error)}`)
  }
  function runtime(name) {
    try { return readFileSync(join(home, name, 'runtime.json'), 'utf8') } catch { return '' }
  }
  function memoryGeneration() {
    const active = runtime('memory')
    if (!active) return ''
    let settings = '', alignment = ''
    try { settings = readFileSync(join(home, 'memory/config.json'), 'utf8') } catch {}
    for (const file of [process.env.DSH_ALIGNMENTS_FILE || join(home, 'memory', 'inbox', 'alignments.json'), join(home, 'surfcore/alignments.json')]) {
      try { alignment = readFileSync(file, 'utf8'); break } catch {}
    }
    const revision = file => {
      try { const stat = statSync(file); return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}` }
      catch (error) { return error?.code === 'ENOENT' ? 'missing' : `error:${error?.code ?? 'unknown'}` }
    }
    return JSON.stringify([active, settings, alignment,
      revision(join(home, 'memory/data/memory-card.json')),
      revision(join(home, 'memory/data/qq-public-summary.json')),
      revision(join(home, 'memory/data/closures.json')),
      revision(join(home, 'memory/data/slang.json')),
      revision(join(home, 'memory/data/history-watermarks.json')),
      revision(qqConfigFile), revision(join(home, 'surfcore/bili.config.json'))])
  }
  const outbox = isAbsolute(home) ? createMemoryOutbox({ home, send: event => client.recordMemory(event), sendTouch: event => client.touchSessionTopics(event.key, event.topics, event.at, true), log }) : null
  const localBiliMemory = isAbsolute(home) ? createBiliMemory({ stateDir: join(home, 'memory', 'data'), dshHome: home }) : null
  function memoryEnabled() {
    try { return JSON.parse(readFileSync(join(home, 'memory/config.json'), 'utf8')).memoryCard?.enabled !== false }
    catch (error) { return error?.code === 'ENOENT' }
  }
  function biliInQqEnabled() {
    try { const card = JSON.parse(readFileSync(join(home, 'memory/config.json'), 'utf8')).memoryCard || {}; return card.enabled !== false && card.includeBiliInQq !== false }
    catch (error) { return error?.code === 'ENOENT' }
  }
  function refresh(platform, generation) {
    const current = cache.get(platform) || { text: '', generation, updated: 0 }
    if (current.pending) return current.pending
    const promise = client.memoryContext(platform).then(text => {
      if (memoryGeneration() === generation && cache.get(platform)?.pending === promise) cache.set(platform, { text, generation, updated: Date.now() })
      else if (cache.get(platform)?.pending === promise) cache.delete(platform)
    }).catch(error => { if (cache.get(platform)?.pending === promise) cache.delete(platform); warn(error) })
    cache.set(platform, { ...current, generation, pending: promise })
    return promise
  }
  function memoryContextCached(platform) {
    const generation = memoryGeneration()
    if (!generation) { cache.delete(platform); return '' }
    let current = cache.get(platform)
    if (current && current.generation !== generation) { cache.delete(platform); current = undefined }
    if (!current || Date.now() - current.updated > 5000) void refresh(platform, generation)
    return current?.text || ''
  }
  async function awaitMemoryContext(platform) {
    const deadline = Date.now() + 2000
    for (let attempt = 0; attempt < 2; attempt++) {
      const generation = memoryGeneration()
      memoryContextCached(platform)
      const pending = cache.get(platform)?.pending
      if (pending) {
        let timer
        try { await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, Math.max(0, deadline - Date.now())) })]) }
        finally { clearTimeout(timer) }
      }
      const latest = memoryGeneration(), result = cache.get(platform)
      if (latest !== generation && Date.now() < deadline) continue
      if (!result?.text || result.generation !== latest) return ''
      const remaining = deadline - Date.now()
      if (remaining <= 0) { if (memoryGeneration() === latest) cache.clear(); return '' }
      let healthTimer
      try { await Promise.race([client.memoryHealth(), new Promise((_, reject) => { healthTimer = setTimeout(() => reject(new Error('记忆插件健康检查超时')), remaining) })]) }
      catch (error) {
        if (memoryGeneration() === latest) cache.clear()
        warn(error)
        return ''
      }
      finally { clearTimeout(healthTimer) }
      if (memoryGeneration() === latest && cache.get(platform) === result) return result.text
      if (Date.now() >= deadline) { cache.clear(); return '' }
    }
    return ''
  }
  const emptySession = () => ({ revision: 0, value: { activeTopics: [], pendingThoughts: [], memberImpressions: {} } })
  let lastAdapterWarning = 0
  /** The adapter is optional: without it the bridge keeps serving QQ, and one throttled line says why events stopped. */
  function adapterWarn(message) {
    if (Date.now() - lastAdapterWarning < 30000) return
    lastAdapterWarning = Date.now()
    log(`SurfCore 入站适配器：${message}`)
  }
  async function ingestSurfcoreEvent(raw) {
    if (!runtime('surfcore-adapter')) { adapterWarn('未运行，这条 QQ 消息没有进入 Superagent'); return { ok: false } }
    try { return await client.ingestQq(raw) }
    catch (error) { adapterWarn(`转交 QQ 消息失败：${String(error?.message ?? error)}`); return { ok: false } }
  }
  async function ingestSurfcoreBiliEvents(items) {
    if (!runtime('surfcore-adapter')) { adapterWarn('未运行，这些 B站 私信没有进入 Superagent'); return { ok: false } }
    try { return await client.ingestBili(items) }
    catch (error) { adapterWarn(`转交 B站 私信失败：${String(error?.message ?? error)}`); return { ok: false } }
  }
  async function submitSurfcoreProactive(candidate) {
    if (!runtime('surfcore-adapter')) { adapterWarn('未运行，这次主动机会没有进入 Superagent'); return { ok: false } }
    try { return await client.proactiveCandidate(candidate) }
    catch (error) { adapterWarn(`转交主动机会失败：${String(error?.message ?? error)}`); return { ok: false } }
  }
  const sessionFile = join(home, 'memory', 'session-memory.json')
  let sessionCache
  const sessionStamp = () => {
    const st = statSync(sessionFile)
    return `${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`
  }
  function sessionDatabase() {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const before = sessionStamp()
        if (sessionCache?.stamp === before) return sessionCache.data
        const data = assertSessionDatabaseReady(JSON.parse(readFileSync(sessionFile, 'utf8')))
        if (sessionStamp() === before) {
          sessionCache = { stamp: before, data }
          return data
        }
      }
      throw new Error('会话记忆读取期间发生变化')
    } catch (error) { sessionCache = undefined; throw error }
  }
  function readSession(key, required = false) {
    if (!runtime('memory')) {
      if (required) throw new Error('独立记忆插件未运行')
      return emptySession()
    }
    try {
      const data = sessionDatabase()
      const item = data.conversations[key] ?? emptySession()
      if (!Number.isSafeInteger(item.revision) || !item.value || !Array.isArray(item.value.activeTopics) || !Array.isArray(item.value.pendingThoughts) || !item.value.memberImpressions || typeof item.value.memberImpressions !== 'object') throw new Error('Invalid session memory')
      return { ...item, value: structuredClone(item.value) }
    } catch (error) { warn(error); if (required) throw new Error('会话记忆不可用或已损坏'); return emptySession() }
  }
  function hydrateSession(key, state) {
    const item = readSession(key)
    Object.assign(state, item.value, { memoryRevision: item.revision })
    return state
  }
  function editSession(key, state) {
    const item = readSession(key, true)
    return Object.assign({ ...state }, item.value, { memoryRevision: item.revision })
  }
  async function commitSession(key, state) {
    const value = { activeTopics: state.activeTopics, pendingThoughts: state.pendingThoughts, memberImpressions: state.memberImpressions }
    return client.writeSession(key, value, state.memoryRevision)
  }
  return {
    memoryContextCached, awaitMemoryContext,
    ingestSurfcoreEvent, ingestSurfcoreBiliEvents, submitSurfcoreProactive,
    purposeMemoryRecords() {
      if (!runtime('memory') || !memoryEnabled()) return []
      try {
        const data = JSON.parse(readFileSync(join(home, 'memory', 'data', 'memory-card.json'), 'utf8'))
        if (!Array.isArray(data?.records)) return []
        const allowBili = biliInQqEnabled()
        const records = data.records.filter(record => record && typeof record === 'object' && (allowBili || (record.scope !== 'bili' && record.platform !== 'bili')))
        const sanitized = localBiliMemory.neutralizeEntries(records.filter(record => record.scope === 'bili' || record.platform === 'bili'))
        let index = 0
        return records.map(record => record.scope === 'bili' || record.platform === 'bili' ? sanitized[index++] : record)
      } catch { return [] }
    },
    hydrateSession, editSession, commitSession,
    async touchSessionTopics(key, topics, at) {
      if (!outbox) throw new Error('缺少项目内 DSH_HOME')
      outbox.enqueueTouch(key, topics, at)
      await outbox.drain()
    },
    sessionMemoryInitialized() {
      if (!runtime('memory')) return false
      try {
        sessionDatabase()
        return true
      } catch { return false }
    },
    memoryModules() { return client.memoryModules() },
    updateMemoryModule(section, changes) { return client.updateMemoryModule(section, changes) },
    dedupeSessions(mappings) { return client.dedupeSessions(mappings) },
    assessClosure(input) { return client.assessClosure(input) },
    closureGate(assessment, config = null) { return client.closureGate(assessment, config) },
    saveClosure(input) { return client.saveClosure(input) },
    closureStatusRemote(key) { return client.closureStatus(key) },
    reopenClosureRemote(input) { return client.reopenClosure(input) },
    closurePrompt(input) { return client.closurePrompt(input) },
    closureSuppress(input) { return client.closureSuppress(input) },
    slangList(input = {}) { return client.slangList(input) },
    slangUpsert(input) { return client.slangUpsert(input) },
    slangDelete(id) { return client.slangDelete(id) },
    slangContext(input = {}) { return client.slangContext(input) },
    slangExtractionPrompt(messages) { return client.slangExtractionPrompt(messages) },
    slangResearchPrompt(candidates) { return client.slangResearchPrompt(candidates) },
    slangApplyExtraction(input) { return client.slangApplyExtraction(input) },
    slangApplyResearch(input) { return client.slangApplyResearch(input) },
    historyCatchup(input) { return client.historyCatchup(input) },
    contextSnapshot(input) { return client.contextSnapshot(input) },
    waitForContext(platform) { return cache.get(platform)?.pending ?? Promise.resolve() },
    appendMemoryInboxEvent(_paths, event) {
      if (!memoryEnabled()) return false
      if (!outbox) { warn(new Error('缺少项目内 DSH_HOME')); return false }
      return outbox.enqueue(event)
    },
    drainMemoryOutbox() { return outbox?.drain() ?? Promise.resolve() },
    stopMemoryOutbox() { outbox?.stop() },
    synthesizeToFile(options) { return client.synthesize(options) },
    prepareVoiceSend(input) { return client.prepareVoiceSend(input) },
    commitVoiceSend(token, detail) { return client.commitVoiceSend(token, detail) },
    abortVoiceSend(token) { return client.abortVoiceSend(token) },
    voiceLibraryRemote(offset = 0) { return client.voiceLibrary(offset) },
    resolveVoiceLibraryRemote(input) { return client.resolveVoiceLibrary(input) },
    probeVoiceLibraryRemote(offset = 0) { return client.probeVoiceLibrary(offset) },
    voicePolicyRemote(input) { return client.voicePolicy(input) },
    voiceAuditCheckRemote(subject, knownTokens = []) { return client.voiceAuditCheck(subject, knownTokens) },
    voiceBudgetRemote(scopeKey = '') { return client.voiceBudget(scopeKey) },
    async assertIndependentVoiceAvailable() {
      const before = runtime('voice')
      if (!before) throw new Error('独立语音插件不可用')
      await client.voiceHealth()
      if (runtime('voice') !== before) throw new Error('独立语音插件状态已变化')
    },
    async isIndependentMemoryAvailable() {
      const before = runtime('memory')
      if (!before) return false
      try { await client.memoryHealth(); return runtime('memory') === before }
      catch { return false }
    },
    createRemoteBiliMemory() {
      const local = localBiliMemory ?? createBiliMemory({ stateDir: join(home, 'memory', 'data'), dshHome: home })
      const available = () => Boolean(runtime('memory'))
      const safe = text => scanText(text).hits.some(hit => hit.severe) ? '' : text
      return {
        paths: local.paths,
        assertAvailable: () => client.memoryHealth(),
        refresh: () => client.refreshBili(),
        recordShare: (id, slot) => client.recordBiliShare(id, slot),
        status: () => available() ? local.status() : { ok: false, error: '记忆插件未运行' },
        briefBlock: () => available() && biliInQqEnabled() ? safe(local.briefBlock()) : '',
        recallBlock: (...args) => available() && biliInQqEnabled() ? safe(local.recallBlock(...args)) : '',
        purposeEntries: () => available() && biliInQqEnabled() ? local.purposeEntries().filter(entry => entry && !scanText([entry.title, entry.text, entry.quote, entry.reason, entry.anecdote].filter(Boolean).join('\n')).severe) : [],
        pickShareCard: (...args) => available() ? local.pickShareCard(...args) : null,
        lastSlot: (...args) => available() ? local.lastSlot(...args) : '',
        selfName: () => local.selfName(),
        selfInfo: () => local.selfInfo(),
      }
    },
    readIndependentVoiceSettings() {
      if (!runtime('voice')) return { enabled: false, tts: { enabled: false } }
      try { return JSON.parse(readFileSync(join(home, 'voice/config.json'), 'utf8')).voice ?? {} }
      catch { return { enabled: false, tts: { enabled: false } } }
    },
  }
}

const hooks = createBridgeHooks({ home: process.env.DSH_HOME || '' })
export const {
  memoryContextCached, awaitMemoryContext, purposeMemoryRecords, appendMemoryInboxEvent,
  ingestSurfcoreEvent, ingestSurfcoreBiliEvents, submitSurfcoreProactive,
  synthesizeToFile, assertIndependentVoiceAvailable, isIndependentMemoryAvailable,
  readIndependentVoiceSettings, createRemoteBiliMemory, hydrateSession, editSession,
  commitSession, touchSessionTopics, sessionMemoryInitialized, memoryModules, updateMemoryModule, dedupeSessions,
  assessClosure, closureGate, saveClosure, closureStatusRemote, reopenClosureRemote, closurePrompt,
  closureSuppress, slangList, slangUpsert, slangDelete, slangContext, slangExtractionPrompt,
  slangResearchPrompt, slangApplyExtraction, slangApplyResearch, historyCatchup, contextSnapshot,
  prepareVoiceSend, commitVoiceSend, abortVoiceSend, voiceLibraryRemote, resolveVoiceLibraryRemote,
  probeVoiceLibraryRemote, voicePolicyRemote, voiceAuditCheckRemote, voiceBudgetRemote,
} = hooks
