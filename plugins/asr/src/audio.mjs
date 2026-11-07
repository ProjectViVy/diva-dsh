// 音频输入契约：只接受 16kHz / 单声道 / PCM16 的规范 WAV。
//
// 为什么挑剔：子进程里的 SenseVoice 直接吃 16k 单声道样本，重采样放浏览器侧做
// （Web Audio 的 OfflineAudioContext 是原生实现，比我们自己在 Node 里写靠谱）。
// 于是这里只做一件事——**把不合规的输入挡在推理之前**，并给出能照做的错误。
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 输入不符合音频契约时抛出；调用方据此返回 400，而不是让推理报奇怪的错。 */
export class AudioInputError extends Error {
  constructor(message, code = 'ASR_AUDIO_INVALID') {
    super(message)
    this.name = 'AudioInputError'
    this.code = code
  }
}

const CANONICAL_RATE = 16000
const CANONICAL_BYTES_PER_SECOND = CANONICAL_RATE * 2

/** 读取四字符块标识；越界返回空串。 */
function chunkId(buffer, offset) {
  return buffer.length >= offset + 4 ? buffer.toString('ascii', offset, offset + 4) : ''
}

/**
 * 解析规范 WAV，校验采样率/声道/位深与体积上限。
 * @param bytes - 完整 WAV 字节。
 * @param options - maxBytes（总字节）与 maxSeconds（时长）。
 * @returns 时长与数据段位置。
 * @throws {AudioInputError} 输入不是规范 WAV 或超出上限。
 */
export function inspectWave(bytes, { maxBytes, maxSeconds } = {}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new AudioInputError('音频数据无效')
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (buffer.length < 44) throw new AudioInputError('音频太短，不像一个 WAV 文件')
  if (chunkId(buffer, 0) !== 'RIFF' || chunkId(buffer, 8) !== 'WAVE') throw new AudioInputError('只接受 WAV 音频（RIFF/WAVE）')
  if (Number.isFinite(maxBytes) && maxBytes > 0 && buffer.length > maxBytes) {
    throw new AudioInputError(`音频超过大小上限（${buffer.length} > ${maxBytes} 字节）`, 'ASR_AUDIO_TOO_LARGE')
  }
  let offset = 12
  let format = null
  let data = null
  while (offset + 8 <= buffer.length) {
    const id = chunkId(buffer, offset)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buffer.length) throw new AudioInputError('WAV 的 fmt 段不完整')
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      const available = Math.min(size, buffer.length - body)
      data = { offset: body, length: available, declared: size }
      break
    }
    offset = body + size + (size % 2)
  }
  if (!format) throw new AudioInputError('WAV 缺少 fmt 段')
  if (!data || data.length === 0) throw new AudioInputError('WAV 没有音频数据')
  if (format.audioFormat !== 1) throw new AudioInputError('只接受未压缩 PCM 的 WAV')
  if (format.channels !== 1) throw new AudioInputError(`只接受单声道音频（当前 ${format.channels} 声道）`)
  if (format.sampleRate !== CANONICAL_RATE) throw new AudioInputError(`只接受 ${CANONICAL_RATE}Hz 音频（当前 ${format.sampleRate}Hz）`)
  if (format.bitsPerSample !== 16) throw new AudioInputError(`只接受 16 位采样（当前 ${format.bitsPerSample} 位）`)
  const durationSeconds = data.length / CANONICAL_BYTES_PER_SECOND
  if (Number.isFinite(maxSeconds) && maxSeconds > 0 && durationSeconds > maxSeconds) {
    throw new AudioInputError(`音频超过时长上限（${durationSeconds.toFixed(1)}s > ${maxSeconds}s）`, 'ASR_AUDIO_TOO_LONG')
  }
  return { durationSeconds, bytes: buffer.length, dataOffset: data.offset, dataLength: data.length, sampleRate: format.sampleRate }
}

/** 内容指纹：同一条录音重复上传直接命中缓存。 */
export function fingerprint(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * 拼一个规范 WAV（16kHz / 单声道 / PCM16）的头。
 * @param dataLength - data 段字节数（偶数）。
 * @param sampleRate - 采样率，默认规范值。
 */
export function encodeWaveHeader(dataLength, sampleRate = CANONICAL_RATE) {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + dataLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(dataLength, 40)
  return header
}

/** 宽松解析：只要 RIFF/WAVE + PCM(1) + 16 位，1~2 声道、8k~48k 采样率都收。 */
function parseLenientPcm16(buffer) {
  if (buffer.length < 44) throw new AudioInputError('音频太短，不像一个 WAV 文件')
  if (chunkId(buffer, 0) !== 'RIFF' || chunkId(buffer, 8) !== 'WAVE') throw new AudioInputError('只接受 WAV 音频（RIFF/WAVE）')
  let offset = 12
  let format = null
  let data = null
  while (offset + 8 <= buffer.length) {
    const id = chunkId(buffer, offset)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      if (size < 16 || body + 16 > buffer.length) throw new AudioInputError('WAV 的 fmt 段不完整')
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      data = { offset: body, length: Math.min(size, buffer.length - body) }
      break
    }
    offset = body + size + (size % 2)
  }
  if (!format) throw new AudioInputError('WAV 缺少 fmt 段')
  if (!data || data.length === 0) throw new AudioInputError('WAV 没有音频数据')
  if (format.audioFormat !== 1) throw new AudioInputError('只接受未压缩 PCM 的 WAV（无损压缩/浮点请先转成 PCM16）')
  if (format.bitsPerSample !== 16) throw new AudioInputError(`只接受 16 位采样（当前 ${format.bitsPerSample} 位）`)
  if (format.channels !== 1 && format.channels !== 2) throw new AudioInputError(`只接受单声道或双声道（当前 ${format.channels} 声道）`)
  if (format.sampleRate < 8000 || format.sampleRate > 48000) throw new AudioInputError(`采样率超出可转换范围 8k~48k（当前 ${format.sampleRate}Hz）`)
  return { format, data }
}

/**
 * 把「网关/浏览器给的任意 PCM16 WAV」归一成规范 WAV（16kHz / 单声道 / PCM16）。
 *
 * 为什么需要它：上游给的音频不归我们管 —— SnowLuma 的 `get_record?out_format=wav` 走它自己的
 * ffmpeg，采样率和声道数都不是我们定的；组件通道必须能接住这些形态，否则只能对着一句
 * 「只接受 16000Hz」干瞪眼。面板通道仍然走严格契约（格式是我们自己的代码产的，严格能抓 bug）。
 *
 * 归一方式是**确定性的**：双声道取平均下混，线性插值重采样，不引入随机与抖动。
 * @returns { bytes, sampleRate, durationSeconds, fromRate, fromChannels, converted }
 * @throws {AudioInputError} 不是 PCM16 WAV、超出体积/时长上限。
 */
export function normalizeWave(bytes, { maxBytes, maxSeconds } = {}) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) throw new AudioInputError('音频数据无效')
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
  if (Number.isFinite(maxBytes) && maxBytes > 0 && buffer.length > maxBytes) {
    throw new AudioInputError(`音频超过大小上限（${buffer.length} > ${maxBytes} 字节）`, 'ASR_AUDIO_TOO_LARGE')
  }
  const { format, data } = parseLenientPcm16(buffer)
  const frames = Math.floor(data.length / (2 * format.channels))
  if (frames <= 0) throw new AudioInputError('WAV 没有可用的采样点')

  const source = new Int16Array(frames * format.channels)
  for (let i = 0; i < source.length; i += 1) source[i] = buffer.readInt16LE(data.offset + i * 2)

  // 1) 单声道化：双声道取平均（Int16 全范围下不会溢出，四舍五入取整）
  const mono = new Float64Array(frames)
  if (format.channels === 1) {
    for (let i = 0; i < frames; i += 1) mono[i] = source[i]
  } else {
    for (let i = 0; i < frames; i += 1) mono[i] = (source[i * 2] + source[i * 2 + 1]) / 2
  }

  // 2) 重采样到 16k：线性插值，端点对齐（duration 保持不变）
  const outFrames = Math.max(1, Math.round(frames * CANONICAL_RATE / format.sampleRate))
  const out = Buffer.alloc(outFrames * 2)
  const step = format.sampleRate / CANONICAL_RATE
  for (let i = 0; i < outFrames; i += 1) {
    const position = Math.min(i * step, frames - 1)
    const left = Math.floor(position)
    const right = Math.min(left + 1, frames - 1)
    const value = mono[left] + (mono[right] - mono[left]) * (position - left)
    const rounded = Math.max(-32768, Math.min(32767, Math.round(value)))
    out.writeInt16LE(rounded, i * 2)
  }

  const durationSeconds = outFrames / CANONICAL_RATE
  if (Number.isFinite(maxSeconds) && maxSeconds > 0 && durationSeconds > maxSeconds) {
    throw new AudioInputError(`音频超过时长上限（${durationSeconds.toFixed(1)}s > ${maxSeconds}s）`, 'ASR_AUDIO_TOO_LONG')
  }
  return {
    bytes: Buffer.concat([encodeWaveHeader(out.length), out]),
    sampleRate: CANONICAL_RATE,
    durationSeconds,
    fromRate: format.sampleRate,
    fromChannels: format.channels,
    converted: format.sampleRate !== CANONICAL_RATE || format.channels !== 1,
  }
}

/**
 * 把 WAV 落到临时目录，供子进程读取。
 * @param tmpDir - 状态目录下的 tmp/。
 * @param bytes - 完整 WAV 字节。
 * @param id - 本次请求的随机 id，用于文件名。
 * @returns 绝对路径。
 */
export function writeTempWave(tmpDir, bytes, id) {
  mkdirSync(tmpDir, { recursive: true, mode: 0o700 })
  const file = join(tmpDir, `${id}.wav`)
  writeFileSync(file, bytes, { mode: 0o600 })
  return file
}
