// 识别子进程：唯一加载 sherpa-onnx 原生库、唯一做 CPU 推理的地方。
//
// 为什么单独开进程：
//   1. 原生库（ONNX Runtime）崩溃/占内存都不该拖垮 DSH 主进程；
//   2. 模型加载是一次性的重活，进程常驻后每次识别只剩推理；
//   3. 将来换引擎（云端 HTTP 等）时，主进程侧的队列与生命周期不用重写。
//
// 协议：stdin/stdout 上的 NDJSON，一行一条。父进程侧见 worker-host.mjs。
import { createRequire } from 'node:module'

const config = JSON.parse(process.argv[2] ?? '{}')
const require = createRequire(import.meta.url)

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

let recognizer = null
let detector = null
let sherpa = null
let nativeConfig = null

const LANGUAGE_FALLBACK = 'auto'

function loadModel() {
  sherpa = require('sherpa-onnx-node')
  nativeConfig = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: config.model, language: LANGUAGE_FALLBACK, useInverseTextNormalization: 1 },
      tokens: config.tokens,
      numThreads: config.threads,
      provider: 'cpu',
      debug: 0,
    },
  }
  recognizer = new sherpa.OfflineRecognizer(nativeConfig)
  detector = new sherpa.Vad({
    sileroVad: {
      model: config.vad,
      threshold: config.vadThreshold,
      minSilenceDuration: config.minSilenceSeconds,
      minSpeechDuration: config.minSpeechSeconds,
      maxSpeechDuration: config.segmentSeconds,
      windowSize: 512,
    },
    sampleRate: 16000,
    numThreads: config.threads,
    provider: 'cpu',
    debug: 0,
  }, config.segmentSeconds + config.minSilenceSeconds + 1)
}

/**
 * 一次识别：VAD 切段 → 逐段解码 → 拼接。
 * @param path - 规范 16k 单声道 PCM16 WAV 的绝对路径。
 * @param language - SenseVoice 语言提示。
 */
function transcribe(path, language) {
  const wave = sherpa.readWave(path, false)
  if (wave.sampleRate !== 16000) throw new Error(`采样率不是 16000（${wave.sampleRate}）`)
  const samples = wave.samples
  const audioSeconds = samples.length / 16000
  nativeConfig.modelConfig.senseVoice.language = config.languages.includes(language) ? language : LANGUAGE_FALLBACK
  recognizer.setConfig(nativeConfig)
  detector.reset()
  const started = performance.now()
  const texts = []
  // Silero 冷启动时第一段起点会晚报几帧，用录音本身把这段起始补回来。
  const onsetPadding = Math.round(config.vadOnsetPaddingSeconds * 16000)
  let isFirstSegment = true
  const drain = () => {
    while (!detector.isEmpty()) {
      const segment = detector.front(false)
      let speech = segment.samples
      if (isFirstSegment) {
        isFirstSegment = false
        const from = Math.max(0, segment.start - onsetPadding)
        if (from < segment.start) {
          const restored = new Float32Array(segment.start - from + speech.length)
          restored.set(samples.subarray(from, segment.start))
          restored.set(speech, segment.start - from)
          speech = restored
        }
      }
      const stream = recognizer.createStream()
      stream.acceptWaveform({ sampleRate: 16000, samples: speech })
      recognizer.decode(stream)
      texts.push(recognizer.getResult(stream).text.trim())
      detector.pop()
    }
  }
  for (let offset = 0; offset < samples.length; offset += 512) {
    detector.acceptWaveform(samples.subarray(offset, offset + 512))
    drain()
  }
  detector.flush()
  drain()
  return { text: texts.filter(Boolean).join(' ').trim(), audioSeconds, inferenceSeconds: (performance.now() - started) / 1000 }
}

async function handle(line) {
  let message
  try { message = JSON.parse(line) } catch { send({ type: 'log', level: 'warn', message: '忽略无法解析的请求行' }); return }
  if (message.type === 'shutdown') { process.exit(0); return }
  if (message.type !== 'transcribe') { send({ type: 'log', level: 'warn', message: `忽略未知请求 ${message.type}` }); return }
  try {
    const result = transcribe(String(message.path), String(message.language ?? LANGUAGE_FALLBACK))
    send({ type: 'result', id: message.id, ...result })
  } catch (error) {
    send({ type: 'error', id: message.id, code: error?.code ?? 'ASR_INFERENCE_FAILED', message: String(error?.message ?? error) })
  }
}

try {
  const started = performance.now()
  loadModel()
  send({ type: 'ready', model: config.model, precision: config.precision, languages: config.languages, loadMs: Math.round(performance.now() - started), version: sherpa.version, onnxruntime: sherpa.onnxruntimeVersion })
} catch (error) {
  // 带上具体文件路径：sherpa 自己只会说「Please check your config!」。
  const where = `模型 ${config.model} / tokens ${config.tokens} / VAD ${config.vad}`
  send({ type: 'error', fatal: true, code: error?.code ?? 'ASR_WORKER_LOAD_FAILED', message: `${String(error?.message ?? error)}（${where}）` })
  process.exit(1)
}

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line !== '') void handle(line)
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
process.on('uncaughtException', error => { send({ type: 'error', fatal: true, code: 'ASR_WORKER_CRASHED', message: String(error?.message ?? error) }); process.exit(1) })
process.on('unhandledRejection', error => { send({ type: 'error', fatal: true, code: 'ASR_WORKER_CRASHED', message: String(error?.message ?? error) }); process.exit(1) })
