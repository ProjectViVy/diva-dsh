// 本地 SenseVoice 引擎：模型仓储 + 受管子进程，对外只有「准备」和「识别」两件事。
//
// 设计上刻意不做的事：
//   - 不把模型加载进 DSH 主进程（重活留给子进程）；
//   - 不在 status() 里拉起子进程（面板每秒轮询也不该把 CPU 拉满）；
//   - 不自己判断「该不该识别」（那是 service 的策略与限流）。
import { AsrError } from './errors.mjs'
import { createWorkerHost } from './worker-host.mjs'

const ENGINE_ID = 'sensevoice'

/**
 * 打开本地 SenseVoice 引擎。
 * @param options.stateDir - 状态目录（模型落在这里）。
 * @param options.modelStore - `createModelStore()` 的返回值。
 * @param options.getConfig - 取当前 `asr` 配置。
 * @param options.logger - 可选日志。
 * @param options.workerFactory - 测试替身。
 */
export function createSensevoiceEngine({ stateDir, modelStore, getConfig, logger = null, workerFactory = createWorkerHost }) {
  const manifestEngine = modelStore.manifest.engines[ENGINE_ID]
  const info = {
    id: ENGINE_ID,
    name: 'SenseVoiceSmall（本地）',
    location: 'host-local',
    languages: [...(manifestEngine?.languages ?? ['auto'])],
    about: {
      summary: '在你自己的电脑上识别，不联网、不按次计费。',
      pros: ['完全离线', '跨平台（含 Apple Silicon / NVIDIA / CPU）', '延迟 0.2~1 秒（短句）'],
      cons: ['首次要下载模型（int8 约 228MB）', '长音频会慢，靠 VAD 切段缓解'],
    },
  }

  let worker = null
  let workerSignature = ''
  let prepareTask = null
  let prepareState = { active: false, phase: 'idle', startedAt: null, finishedAt: null, file: null, receivedAll: 0, totalAll: 0, error: null }
  let prepareController = null
  let lastResult = null

  const sensevoiceConfig = () => getConfig().sensevoice
  const precision = () => sensevoiceConfig().precision

  const modelSnapshot = ({ verify = false } = {}) => modelStore.inspect(ENGINE_ID, precision(), { verify })

  /** 子进程需要的是绝对路径 + 推理参数；签名变了就换进程。 */
  function inferenceConfig() {
    const snapshot = modelSnapshot()
    if (!snapshot.ready) {
      throw new AsrError('识别模型还没准备好', {
        code: 'ASR_MODEL_MISSING',
        hint: '在语音识别面板点「下载并准备」，或先调 /dsh-asr/api/asr/prepare',
      })
    }
    const byName = Object.fromEntries(snapshot.files.map(item => [item.name, item.file]))
    const sense = sensevoiceConfig()
    return {
      model: byName.model,
      tokens: byName.tokens,
      vad: byName.vad,
      precision: precision(),
      threads: sense.threads,
      segmentSeconds: sense.segmentSeconds,
      vadThreshold: sense.vadThreshold,
      minSpeechSeconds: sense.minSpeechSeconds,
      minSilenceSeconds: sense.minSilenceSeconds,
      vadOnsetPaddingSeconds: sense.vadOnsetPaddingSeconds,
      inferenceTimeoutMs: sense.inferenceTimeoutMs,
      loadTimeoutMs: sense.prepareTimeoutMs,
      languages: info.languages,
    }
  }

  function ensureWorker() {
    const config = inferenceConfig()
    const signature = JSON.stringify(config)
    if (worker && signature === workerSignature) return worker
    if (worker) worker.stop()
    const sense = sensevoiceConfig()
    worker = workerFactory({ inferenceConfig: config, idleTimeoutMs: sense.idleTimeoutMs, maxPending: sense.maxPending, logger })
    workerSignature = signature
    return worker
  }

  function status() {
    const snapshot = modelSnapshot()
    return {
      id: info.id,
      name: info.name,
      location: info.location,
      languages: info.languages,
      ready: snapshot.ready,
      preparing: prepareState.active,
      precision: snapshot.precision,
      model: {
        directory: snapshot.dir,
        bytes: snapshot.bytes,
        verifiedAt: snapshot.verifiedAt,
        files: snapshot.files.map(item => ({ name: item.name, file: item.file, bytes: item.expectedBytes, verified: item.verified })),
      },
      worker: worker ? worker.status() : { running: false, ready: false, pid: null, pending: 0, logs: [] },
      // 下载进度只在准备期间有意义；面板靠它画进度条，而不是猜文件大小。
      transfer: prepareState.active
        ? { phase: prepareState.phase, file: prepareState.file, receivedAll: prepareState.receivedAll, totalAll: prepareState.totalAll }
        : null,
      lastResult,
    }
  }

  /** 准备模型：幂等，重复调用合流到同一个任务。 */
  function prepare({ signal, onProgress } = {}) {
    if (prepareTask) return prepareTask
    const controller = new AbortController()
    prepareController = controller
    const relay = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal
    prepareState = { active: true, phase: 'check', startedAt: Date.now(), finishedAt: null, file: null, receivedAll: 0, totalAll: 0, error: null }
    const sense = sensevoiceConfig()
    prepareTask = modelStore.prepare(ENGINE_ID, precision(), {
      signal: relay,
      onProgress(event) {
        prepareState = { ...prepareState, phase: event.phase, file: event.file ?? null, receivedAll: event.receivedAll ?? prepareState.receivedAll, totalAll: event.totalAll ?? prepareState.totalAll }
        onProgress?.(event)
      },
    }).then(result => {
      prepareState = { ...prepareState, active: false, phase: 'done', finishedAt: Date.now() }
      // 模型换过文件（重新下载/换精度）就必须换子进程，否则还在用旧路径。
      if (worker) { worker.stop(); worker = null; workerSignature = '' }
      return result
    }).catch(error => {
      const cancelled = relay.aborted || error?.code === 'ASR_PREPARE_CANCELLED'
      prepareState = { ...prepareState, active: false, phase: cancelled ? 'cancelled' : 'failed', finishedAt: Date.now(), error: cancelled ? null : String(error?.message ?? error) }
      throw error
    }).finally(() => { prepareTask = null; prepareController = null })
    return prepareTask
  }

  async function transcribe({ wavPath, language = 'auto' } = {}) {
    const active = ensureWorker()
    const result = await active.transcribe({ path: wavPath, language, timeoutMs: sensevoiceConfig().inferenceTimeoutMs })
    lastResult = { at: Date.now(), text: result.text, audioSeconds: result.audioSeconds, inferenceSeconds: result.inferenceSeconds }
    return result
  }

  return {
    info,
    status,
    prepare,
    transcribe,
    cancelPrepare: () => { prepareController?.abort(new AsrError('准备已取消', { code: 'ASR_PREPARE_CANCELLED' })); },
    dispose: async () => { prepareController?.abort(); worker?.stop(); worker = null; workerSignature = '' },
  }
}
