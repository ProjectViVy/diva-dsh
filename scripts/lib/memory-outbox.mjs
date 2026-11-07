import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { redactForMemory } from '../../plugins/memory/src/card-engine.mjs'
import { prepareMemoryEvent } from './surfcore-component-client.mjs'

/** Persistent, redacted transport queue. Only an acknowledged plugin write removes an item. */
export function createMemoryOutbox({ home, send, sendTouch, log = console.warn, retryMs = 5000 }) {
  if (!home || !isAbsolute(home)) throw new Error('A project-local DSH_HOME is required')
  const parent = join(home, 'surfcore'), dir = join(parent, 'memory-outbox')
  let stopped = false, timer = null, running = null, serial = 0, generation = 0, requestedGeneration = 0, lastWarning = 0
  function warn(error) {
    if (Date.now() - lastWarning < 30000) return
    lastWarning = Date.now()
    log(`记忆事件暂存失败或等待重试：${String(error?.message ?? error)}`)
  }
  function checkDirectory() {
    for (const item of [home, parent, dir]) {
      try { if (lstatSync(item).isSymbolicLink()) throw new Error('记忆队列目录不能是符号链接') }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  function files() {
    checkDirectory()
    return existsSync(dir) ? readdirSync(dir).filter(name => /^\d{13}-\d{6}-[a-f0-9-]+\.json$/.test(name)).sort() : []
  }
  function schedule(delay = retryMs) {
    if (stopped || timer) return
    timer = setTimeout(() => { timer = null; void drain() }, delay)
    timer.unref?.()
  }
  function quarantine(path, name) {
    const targetDir = join(dir, 'corrupt')
    if (existsSync(targetDir) && (lstatSync(targetDir).isSymbolicLink() || !lstatSync(targetDir).isDirectory())) throw new Error('损坏队列暂存目录无效')
    mkdirSync(targetDir, { recursive: true, mode: 0o700 })
    let target = join(targetDir, name)
    if (existsSync(target)) target = join(targetDir, `${name}.${randomUUID()}`)
    renameSync(path, target)
    warn(new Error('无效的记忆队列项目已保留在项目内，继续处理后续事件'))
  }
  function invalidEvent(event) {
    try {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return true
      if (event.type === 'session-topic-touch') return !/^(?:group|private):\d{1,24}$/.test(event.key) || !Array.isArray(event.topics) || !event.topics.length || event.topics.length > 1000 || event.topics.some(topic => typeof topic !== 'string' || !/^[a-f0-9]{64}$/.test(topic)) || !Number.isSafeInteger(event.at) || event.at < 0 || Buffer.byteLength(JSON.stringify(event)) > 512 * 1024
      const payload = prepareMemoryEvent(event), id = payload.id
      if (!id.trim() || id.length > 200 || Buffer.byteLength(JSON.stringify(payload)) > 512 * 1024) return true
      const text = redactForMemory(event.text, { scope: 'qq', maxChars: 600 })
      if (!text || text.startsWith('/')) return true
      return event.at !== undefined && !Number.isFinite(new Date(event.at).getTime())
    } catch { return true }
  }
  function drain() {
    if (stopped) return Promise.resolve()
    requestedGeneration = generation
    if (running) return running
    running = Promise.resolve().then(async () => {
      try {
        let memoryEventsBlocked = false
        for (;;) {
          const targetGeneration = requestedGeneration
          let pending = []
          try { pending = files() } catch (error) { warn(error); schedule(); return }
          for (const name of pending) {
            if (stopped) break
            const path = join(dir, name)
            try {
              const stat = lstatSync(path)
              if (!stat.isFile()) throw new Error('记忆队列项目不是普通文件')
              if (stat.size > 512 * 1024) { quarantine(path, name); continue }
              const text = readFileSync(path, 'utf8')
              let event
              try { event = JSON.parse(text) } catch (error) {
                if (!(error instanceof SyntaxError)) throw error
                quarantine(path, name)
                continue
              }
              if (invalidEvent(event)) { quarantine(path, name); continue }
              if (memoryEventsBlocked && event.type !== 'session-topic-touch') continue
              let acknowledgement
              try { acknowledgement = event.type === 'session-topic-touch' ? await sendTouch(event) : await send(event) }
              catch (error) {
                if (event.type !== 'session-topic-touch' && error?.code === 'MEMORY_DISABLED') {
                  memoryEventsBlocked = true
                  warn(error); schedule(); continue
                }
                throw error
              }
              if (acknowledgement?.ok !== true) throw new Error('记忆插件未确认接收事件')
              const current = lstatSync(path)
              if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || readFileSync(path, 'utf8') !== text) throw new Error('记忆队列项目在投递期间发生变化，已保留')
              unlinkSync(path)
            } catch (error) { warn(error); schedule(); return }
          }
          if (stopped || requestedGeneration === targetGeneration) break
        }
      } finally {
        running = null
        if (!stopped) { try { if (files().length) schedule() } catch (error) { warn(error); schedule() } }
      }
    })
    return running
  }
  function persist(event) {
    if (files().length >= 10000) throw new Error('记忆队列已满；请恢复记忆插件后重试')
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    checkDirectory()
    serial = (serial + 1) % 1000000
    const name = `${String(Date.now()).padStart(13, '0')}-${String(serial).padStart(6, '0')}-${randomUUID()}.json`
    const temporary = join(dir, `${name}.${randomUUID()}.tmp`)
    writeFileSync(temporary, `${JSON.stringify(event)}\n`, { flag: 'wx', mode: 0o600 })
    renameSync(temporary, join(dir, name))
    generation++
    schedule(0)
  }
  function enqueue(input) {
    if (stopped) return false
    try {
      const text = redactForMemory(input?.text, { scope: 'qq', maxChars: 600 })
      if (!text || text.startsWith('/')) return false
      const at = Number.isFinite(new Date(input?.at ?? Date.now()).getTime()) ? new Date(input?.at ?? Date.now()).toISOString() : new Date().toISOString()
      const event = { id: randomUUID(), at, kind: input.kind === 'private' ? 'private' : 'group',
        sender: redactForMemory(input.sender ?? '', { scope: 'qq', maxChars: 100 }), senderId: String(input.senderId ?? '').slice(0, 80),
        groupId: String(input.groupId ?? '').slice(0, 80), conversationKey: String(input.conversationKey ?? '').slice(0, 120),
        isOwner: input.isOwner === true, isSelf: input.isSelf === true, private: input.private === true || input.kind === 'private', direct: input.direct === true, text }
      persist(event)
      return true
    } catch (error) { warn(error); return false }
  }
  function enqueueTouch(key, topics, at) {
    if (stopped) throw new Error('记忆队列已停止')
    if (!Array.isArray(topics) || topics.some(topic => typeof topic !== 'string' || !topic || topic.length > 1000)) throw new Error('会话话题更新无效')
    const event = { type: 'session-topic-touch', key, topics: topics.map(topic => createHash('sha256').update(topic).digest('hex')), at }
    if (invalidEvent(event)) throw new Error('会话话题更新无效')
    persist(event)
  }
  try { if (files().length) schedule(0) } catch (error) { warn(error) }
  return { enqueue, enqueueTouch, drain, stop() { stopped = true; if (timer) clearTimeout(timer); timer = null } }
}
