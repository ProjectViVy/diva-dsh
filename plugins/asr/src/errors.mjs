// 统一错误形状：错误码给程序判断，hint 给人照做。
//
// 面板与内部 API 都会把它翻译成 `{ ok:false, code, error, hint }`，
// 这样「模型没下载」和「识别队列满了」在前端是不同的提示，而不是同一句 "failed"。
export class AsrError extends Error {
  /**
   * @param message - 面向操作者的一句话。
   * @param options.code - 稳定错误码（ASR_*）。
   * @param options.hint - 下一步怎么做；没有就别硬编。
   * @param options.status - 建议的 HTTP 状态码。
   */
  constructor(message, { code = 'ASR_FAILED', hint = '', status = 400, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'AsrError'
    this.code = code
    if (hint) this.hint = hint
    this.status = status
  }
}

/**
 * 已知错误码的下一步。写在这里而不是散落在各处，
 * 是为了让「同一个故障」在面板、内部 API、自检里给出同一句提示。
 */
const HINTS = {
  ASR_MODEL_MISSING: '在语音识别面板点「下载并准备」把模型下下来',
  ASR_MODEL_INCOMPLETE: '模型文件不完整，重新点一次「下载并准备」会补下载',
  ASR_MODEL_DOWNLOAD_FAILED: '网络没连上模型源；可以在面板里换一个下载源再试',
  ASR_WORKER_LOAD_FAILED: '识别模型可能不完整：点「下载并准备」重新校验一次；仍失败就看面板「诊断」里的原生日志',
  ASR_WORKER_UNAVAILABLE: '识别进程没起来，稍后重试；反复失败请看面板「诊断」',
  ASR_WORKER_EXITED: '识别进程退出了，再试一次会自动重新拉起',
  ASR_WORKER_TIMEOUT: '识别进程启动太慢，稍后重试',
  ASR_INFERENCE_TIMEOUT: '这段音频识别超时了，分成短一点的几段再试',
  ASR_BUSY: '同时在识别的请求太多，等一下再试',
  ASR_DISABLED: '语音识别当前是关闭的，需要在面板里打开',
  ASR_RATE_LIMITED: '识别太频繁了，歇一会儿再来',
  ASR_AUDIO_TOO_LONG: '录音太长了，分几段说',
  ASR_AUDIO_TOO_LARGE: '录音文件太大，短一点',
  ASR_AUDIO_INVALID: '音频格式不对，只认 16kHz 单声道 PCM16 WAV',
}

/** 把任意异常收敛成 AsrError，保留已经是 AsrError 的原样。 */
export function toAsrError(error) {
  if (error instanceof AsrError) return error.code && error.hint ? error : new AsrError(error.message, { code: error.code, hint: error.hint ?? HINTS[error.code], status: error.status, cause: error })
  const asr = new AsrError(String(error?.message ?? error), { code: error?.code ?? 'ASR_FAILED', hint: error?.hint ?? HINTS[error?.code] ?? '' })
  return asr
}
