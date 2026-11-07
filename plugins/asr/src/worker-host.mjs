// 识别子进程的父侧：负责拉起、排队、超时、空闲回收和崩溃后的可读错误。
//
// 队列是串行的：SenseVoice 一个进程一次只解一段音频，并行只会互相拖慢。
// 所以「队列满」是一种正常拒绝（ASR_BUSY），而不是异常。
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
export const WORKER_SCRIPT = join(HERE, 'worker-server.mjs')

/** 队列已满时抛出；调用方据此返回「忙」，提示稍后重试。 */
export class WorkerBusyError extends Error {
  constructor(message = '识别队列已满，请稍后重试') {
    super(message)
    this.name = 'WorkerBusyError'
    this.code = 'ASR_BUSY'
  }
}

/** 子进程不可用（起不来、崩了、超时）时抛出。 */
export class WorkerUnavailableError extends Error {
  constructor(message, code = 'ASR_WORKER_UNAVAILABLE') {
    super(message)
    this.name = 'WorkerUnavailableError'
    this.code = code
  }
}

function trimLog(lines, limit) {
  return lines.length > limit ? lines.slice(lines.length - limit) : lines
}

/**
 * 打开一个受管的识别子进程（懒启动、按需回收）。
 * @param options.inferenceConfig - 传给子进程的模型路径与推理参数。
 * @param options.logger - 可选日志（cordis logger 或 console 风格）。
 * @param options.spawnImpl - 测试替身。
 */
export function createWorkerHost({ inferenceConfig, idleTimeoutMs = 0, maxPending = 2, logger = null, spawnImpl = spawn, execPath = process.execPath, script = WORKER_SCRIPT } = {}) {
  let child = null
  let readyInfo = null
  let starting = null
  let idleTimer = null
  let stopping = false
  const inflight = new Map()
  const logLines = []

  const log = (level, message) => {
    logLines.push({ at: Date.now(), level, message })
    if (logLines.length > 200) logLines.splice(0, logLines.length - 200)
    if (level === 'error') logger?.warn?.(`[asr] ${message}`)
  }

  const pendingCount = () => inflight.size

  const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null } }

  const armIdle = () => {
    clearIdle()
    if (!(idleTimeoutMs > 0) || !child) return
    idleTimer = setTimeout(() => { if (pendingCount() === 0) stop() }, idleTimeoutMs)
    idleTimer.unref?.()
  }

  function failAll(error) {
    for (const [, entry] of inflight) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    inflight.clear()
  }

  function handleLine(line) {
    let message
    try { message = JSON.parse(line) } catch { log('warn', '忽略无法解析的子进程输出'); return }
    if (message.type === 'ready') { log('info', `识别引擎已加载（${message.model}，${message.loadMs}ms，sherpa ${message.version} / ort ${message.onnxruntime}）`); return }
    if (message.type === 'log') { log(message.level ?? 'info', String(message.message ?? '')); return }
    const entry = message.id ? inflight.get(message.id) : null
    if (!entry) { if (message.fatal) { failAll(new WorkerUnavailableError(String(message.message ?? '识别进程不可用'))); } return }
    clearTimeout(entry.timer)
    inflight.delete(message.id)
    armIdle()
    if (message.type === 'result') entry.resolve({ text: String(message.text ?? ''), audioSeconds: Number(message.audioSeconds) || 0, inferenceSeconds: Number(message.inferenceSeconds) || 0 })
    else entry.reject(new WorkerUnavailableError(String(message.message ?? '识别失败'), message.code ?? 'ASR_INFERENCE_FAILED'))
  }

  function attach(target) {
    let buffer = ''
    target.stdout.setEncoding('utf8')
    target.stdout.on('data', chunk => {
      buffer += chunk
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line !== '') handleLine(line)
        index = buffer.indexOf('\n')
      }
    })
    target.stderr.setEncoding('utf8')
    target.stderr.on('data', chunk => log('warn', String(chunk).trim().slice(0, 400)))
    target.on('error', error => {
      log('error', `识别进程启动失败：${error?.message ?? error}`)
      failAll(new WorkerUnavailableError(`识别进程启动失败：${error?.message ?? error}`))
    })
    target.on('exit', (code, signal) => {
      if (child === target) { child = null; readyInfo = null }
      clearIdle()
      if (!stopping && pendingCount() > 0) failAll(new WorkerUnavailableError(`识别进程已退出（code=${code} signal=${signal}）`, 'ASR_WORKER_EXITED'))
      else if (!stopping) log('warn', `识别进程已退出（code=${code} signal=${signal}），下次识别会重新拉起`)
    })
  }

  /** 拉起子进程并等待模型加载完成。 */
  function start() {
    if (child && readyInfo) return Promise.resolve(readyInfo)
    if (starting) return starting
    stopping = false
    starting = new Promise((resolve, reject) => {
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        starting = null
        if (error) reject(error)
        else resolve(value)
      }
      let target
      try {
        target = spawnImpl(execPath, [script, JSON.stringify(inferenceConfig)], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) {
        finish(new WorkerUnavailableError(`无法启动识别进程：${error?.message ?? error}`))
        return
      }
      child = target
      attach(target)
      const deadline = setTimeout(() => finish(new WorkerUnavailableError('识别引擎加载超时', 'ASR_WORKER_TIMEOUT')), inferenceConfig.loadTimeoutMs ?? 120000)
      const onReady = message => {
        if (!message.fatal && message.type !== 'ready') return
        clearTimeout(deadline)
        target.stdout.removeListener('data', onData)
        if (message.fatal) {
          // 原生库的报错往往是「Please check your config!」这种没法照做的话，
          // 把最后一条原生日志接在后面，至少能看出是哪个文件不对。
          const native = [...logLines].reverse().find(line => line.message.trim() !== '')?.message
          const detail = [String(message.message ?? '识别引擎加载失败'), native && native !== message.message ? `原生库：${native}` : ''].filter(Boolean).join('；')
          finish(new WorkerUnavailableError(detail, message.code ?? 'ASR_WORKER_LOAD_FAILED')); return
        }
        readyInfo = { model: message.model, precision: message.precision, languages: message.languages ?? [], loadMs: message.loadMs ?? 0, version: message.version, onnxruntime: message.onnxruntime, loadedAt: Date.now(), pid: target.pid }
        finish(null, readyInfo)
      }
      // ready 之前也要自己解析一次，避免和 attach 里的解析抢同一条流。
      let buffer = ''
      const onData = chunk => {
        buffer += chunk
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line !== '') { try { onReady(JSON.parse(line)) } catch {} }
          index = buffer.indexOf('\n')
        }
      }
      target.stdout.on('data', onData)
      target.on('exit', code => { clearTimeout(deadline); finish(new WorkerUnavailableError(`识别进程在就绪前退出（code=${code}）`, 'ASR_WORKER_EXITED')) })
    })
    return starting
  }

  /** 串行执行一次识别；队列满则拒绝。 */
  async function transcribe({ path, language = 'auto', timeoutMs = inferenceConfig.inferenceTimeoutMs ?? 60000 }) {
    if (pendingCount() >= maxPending) throw new WorkerBusyError()
    await start()
    // 拉起过程中子进程可能已经退出（崩溃/被杀），此时不能把请求写进空气里。
    if (!child) throw new WorkerUnavailableError('识别进程当前不可用，请重试', 'ASR_WORKER_EXITED')
    return await new Promise((resolve, reject) => {
      const id = randomUUID()
      const timer = setTimeout(() => { inflight.delete(id); armIdle(); reject(new WorkerUnavailableError('识别超时', 'ASR_INFERENCE_TIMEOUT')) }, timeoutMs)
      inflight.set(id, { resolve, reject, timer })
      clearIdle()
      try { child.stdin.write(`${JSON.stringify({ type: 'transcribe', id, path, language })}\n`) }
      catch (error) { clearTimeout(timer); inflight.delete(id); reject(new WorkerUnavailableError(`无法发送识别请求：${error?.message ?? error}`)) }
    })
  }

  /** 停掉子进程（空闲回收或插件卸载时调用）。 */
  function stop() {
    clearIdle()
    if (!child) return
    const target = child
    stopping = true
    child = null
    readyInfo = null
    try { target.stdin.write(`${JSON.stringify({ type: 'shutdown' })}\n`) } catch {}
    const timer = setTimeout(() => { try { target.kill('SIGKILL') } catch {} }, 2000)
    timer.unref?.()
    target.once('exit', () => clearTimeout(timer))
  }

  return {
    start,
    transcribe,
    stop,
    status: () => ({
      running: Boolean(child),
      ready: Boolean(readyInfo),
      pid: child?.pid ?? null,
      pending: pendingCount(),
      idleTimeoutMs,
      maxPending,
      info: readyInfo,
      logs: trimLog([...logLines], 40),
    }),
  }
}
