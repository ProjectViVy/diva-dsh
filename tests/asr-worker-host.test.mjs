// 识别子进程父侧测试：用假子进程替身验证生命周期契约。
// 真正加载 ONNX 的那部分留给真机用例（tests/asr-sensevoice-e2e.test.mjs）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough, Writable } from 'node:stream'
import { createWorkerHost, WorkerBusyError, WorkerUnavailableError } from '../plugins/asr/src/worker-host.mjs'

/** 一个「像 child_process」的替身：两个可写管道 + 一个可读 stdin。 */
function fakeChild() {
  const child = new EventEmitter()
  child.pid = 4242
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  const sent = []
  child.stdin = new Writable({ write(chunk, _encoding, callback) { sent.push(String(chunk)); callback() } })
  child.sent = sent
  child.killSignals = []
  child.kill = signal => { child.killSignals.push(signal ?? 'SIGTERM'); child.emit('exit', null, signal ?? 'SIGTERM') }
  child.respond = value => child.stdout.write(`${JSON.stringify(value)}\n`)
  child.requests = () => sent.join('').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
  return child
}

/** 等到 transcribe 真正把请求写进 stdin（它先 await start()，所以有一个微任务）。 */
const tick = () => new Promise(resolve => setImmediate(resolve))

function makeHost(t, { child = fakeChild(), ...options } = {}) {
  const host = createWorkerHost({
    inferenceConfig: { model: '/tmp/model.onnx', tokens: '/tmp/tokens.txt', vad: '/tmp/vad.onnx', threads: 1, loadTimeoutMs: 200, inferenceTimeoutMs: 200, languages: ['auto', 'zh'] },
    spawnImpl: () => child,
    ...options,
  })
  t.after(() => host.stop())
  return { host, child }
}

test('start resolves only after the child reports ready', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  assert.equal(host.status().running, true)
  assert.equal(host.status().ready, false)
  child.respond({ type: 'ready', model: '/tmp/model.onnx', precision: 'int8', languages: ['auto'], loadMs: 12, version: '1.13.8', onnxruntime: '1.17.1' })
  const ready = await starting
  assert.equal(ready.precision, 'int8')
  assert.equal(host.status().ready, true)
  assert.equal(host.status().info.pid, 4242)
})

test('a fatal load error rejects start with the child explanation', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  child.respond({ type: 'error', fatal: true, code: 'ASR_WORKER_LOAD_FAILED', message: 'Cannot find module sherpa-onnx-darwin-arm64' })
  await assert.rejects(starting, error => {
    assert.ok(error instanceof WorkerUnavailableError)
    assert.equal(error.code, 'ASR_WORKER_LOAD_FAILED')
    assert.match(error.message, /sherpa-onnx-darwin-arm64/)
    return true
  })
})

test('transcribe writes a request and resolves the matching result', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  const pending = host.transcribe({ path: '/tmp/a.wav', language: 'zh' })
  await tick()
  const request = child.requests().at(-1)
  assert.equal(request.type, 'transcribe')
  assert.equal(request.path, '/tmp/a.wav')
  assert.equal(request.language, 'zh')
  child.respond({ type: 'result', id: request.id, text: '你好', audioSeconds: 1.2, inferenceSeconds: 0.3 })
  const result = await pending
  assert.deepEqual(result, { text: '你好', audioSeconds: 1.2, inferenceSeconds: 0.3 })
  assert.equal(host.status().pending, 0)
})

test('an inference failure surfaces its code instead of a generic error', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  const pending = host.transcribe({ path: '/tmp/a.wav' })
  await tick()
  const request = child.requests().at(-1)
  child.respond({ type: 'error', id: request.id, code: 'ASR_INFERENCE_FAILED', message: '采样率不是 16000' })
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'ASR_INFERENCE_FAILED')
    assert.match(error.message, /采样率/)
    return true
  })
})

test('an answer that never comes times out and frees the queue', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  await assert.rejects(host.transcribe({ path: '/tmp/a.wav', timeoutMs: 30 }), error => {
    assert.equal(error.code, 'ASR_INFERENCE_TIMEOUT')
    return true
  })
  assert.equal(host.status().pending, 0)
})

test('a full queue is refused as busy, not queued forever', async t => {
  const { host, child } = makeHost(t, { maxPending: 1 })
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  const first = host.transcribe({ path: '/tmp/a.wav' })
  await tick()
  await assert.rejects(host.transcribe({ path: '/tmp/b.wav' }), WorkerBusyError)
  const request = child.requests().at(-1)
  child.respond({ type: 'result', id: request.id, text: '', audioSeconds: 0.1, inferenceSeconds: 0.1 })
  await first
})

test('the child is reclaimed after the idle window', async t => {
  const { host, child } = makeHost(t, { idleTimeoutMs: 20 })
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  const pending = host.transcribe({ path: '/tmp/a.wav' })
  await tick()
  const request = child.requests().at(-1)
  child.respond({ type: 'result', id: request.id, text: 'ok', audioSeconds: 0.1, inferenceSeconds: 0.1 })
  await pending
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(child.requests().at(-1).type, 'shutdown')
})

test('a crash while a request is in flight rejects it instead of hanging', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  const pending = host.transcribe({ path: '/tmp/a.wav' })
  await tick()
  child.emit('exit', 134, null)
  await assert.rejects(pending, error => {
    assert.equal(error.code, 'ASR_WORKER_EXITED')
    return true
  })
  assert.equal(host.status().running, false)
})

test('stop writes a shutdown line so the child can exit cleanly', async t => {
  const { host, child } = makeHost(t)
  const starting = host.start()
  child.respond({ type: 'ready', model: 'm', precision: 'int8', languages: ['auto'] })
  await starting
  host.stop()
  assert.equal(child.requests().at(-1).type, 'shutdown')
  assert.equal(host.status().running, false)
})
