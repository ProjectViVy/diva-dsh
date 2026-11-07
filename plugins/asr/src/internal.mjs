// 组件内部 API：/dsh-asr/internal
//
// 只回环、要求 `x-component-token`（令牌在状态目录的 runtime.json 里，0600）。
// 将来别的组件（例如 QQ 入站桥接）要把一段语音变成文字，走这里，
// 而不是直接去读状态目录或者 require 本插件的模块。
//
// `/transcribe` 同时接受两种投喂方式：
//   - `audio`：base64 的 WAV，适合短录音（内部通道请求体上限 512KiB）；
//   - `path`：本机绝对路径的 .wav，适合长录音（由本插件按大小上限重新校验）。
//
// 组件通道**放宽音频形态**：非 16k / 双声道的 PCM16 WAV 会被自动归一（见 audio.mjs normalizeWave），
// 因为上游拿到的是网关 ffmpeg 转码的结果，格式不由我们定。面板通道仍走严格契约。
import { toAsrError } from './errors.mjs'

export function createInternalHandler(service, { logger = null } = {}) {
  return async ({ method, path, query, body }) => {
    try {
      if (method === 'GET' && path === '/health') return { ok: true, ready: service.catalog().engines.some(engine => engine.ready), enabled: service.catalog().enabled }
      if (method === 'GET' && path === '/catalog') return { ok: true, ...service.catalog() }
      if (method === 'GET' && path === '/rules') return service.rules()
      if (method === 'GET' && path === '/status') return service.status()
      if (method === 'GET' && path === '/progress') return service.prepareStatus()
      if (method === 'POST' && path === '/rules') return service.saveRules(body)
      if (method === 'POST' && path === '/prepare') return await service.prepare({ engineId: typeof body.engine === 'string' ? body.engine : undefined })
      if (method === 'POST' && path === '/cancel-prepare') return service.cancelPrepare()
      if (method === 'POST' && path === '/transcribe') {
        return await service.transcribe({
          audio: typeof body.audio === 'string' ? body.audio : undefined,
          audioPath: typeof body.path === 'string' ? body.path : undefined,
          language: typeof body.language === 'string' ? body.language : undefined,
          source: typeof body.source === 'string' && body.source !== '' ? body.source : 'component',
          // 组件通道放宽音频形态：上游（QQ 桥接等）拿到的是网关转码的 wav，
          // 采样率/声道不由我们定，先归一成 16k 单声道再推理。
          acceptNonCanonical: body.acceptCanonicalOnly === true ? false : true,
        })
      }
      if (method === 'POST' && path === '/self-check') return await service.selfCheck({ inference: body.inference !== false })
      // 路径写错时，别只说"未知接口"——把可用接口列出来，调用方一眼就能改对。
      const error = new Error('未知接口')
      error.code = 'ASR_NOT_FOUND'
      error.hint = '内部接口：/health、/catalog、/status、/rules、/prepare、/cancel-prepare、/transcribe、/self-check'
      throw error
    } catch (failure) {
      const error = toAsrError(failure)
      logger?.warn?.(`[asr] internal ${path} 失败：${error.message}`)
      throw error
    }
  }
}
