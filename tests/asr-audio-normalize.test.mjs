// 音频归一测试：组件通道拿到「不是 16k 单声道」的 wav 也要能识别。
//
// 背景（2026-11-05）：QQ 入站语音要喂给本地 SenseVoice 兜底时，音频是 SnowLuma 的
// `get_record?out_format=wav` 转出来的 —— 采样率/声道由它的 ffmpeg 决定，不是我们定的。
// 面板通道继续严格（那里的音频是我们自己的浏览器代码产的，严格能抓 bug）；
// 组件通道把它归一成 16k 单声道 PCM16。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { AudioInputError, encodeWaveHeader, inspectWave, normalizeWave } from '../plugins/asr/src/audio.mjs'
import { createConfigStore } from '../plugins/asr/src/store.mjs'
import { createEngineRegistry } from '../plugins/asr/src/engine-registry.mjs'
import { createAsrService } from '../plugins/asr/src/service.mjs'
import { createInternalHandler } from '../plugins/asr/src/internal.mjs'

function tempDir(t, prefix = 'asr-normalize-') {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 造一个指定采样率/声道的 PCM16 WAV，内容是一条正弦（便于验证幅度没被搞坏）。 */
function makeWave({ sampleRate = 16000, channels = 1, seconds = 0.5, amplitude = 12000, frequency = 440, format = 1, bits = 16 } = {}) {
  const frames = Math.max(1, Math.round(seconds * sampleRate))
  const data = Buffer.alloc(frames * channels * 2)
  for (let i = 0; i < frames; i += 1) {
    const value = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * i / sampleRate))
    for (let c = 0; c < channels; c += 1) data.writeInt16LE(value, (i * channels + c) * 2)
  }
  const header = encodeWaveHeader(data.length, sampleRate)
  header.writeUInt16LE(format, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(bits, 34)
  return Buffer.concat([header, data])
}

const sampleAt = (bytes, index) => {
  const parsed = inspectWave(bytes)
  return bytes.readInt16LE(parsed.dataOffset + index * 2)
}

test('44.1k 双声道 → 16k 单声道，时长不变、幅度不被搞坏', () => {
  const source = makeWave({ sampleRate: 44100, channels: 2, seconds: 0.5 })
  const result = normalizeWave(source)
  assert.equal(result.sampleRate, 16000)
  assert.deepEqual({ fromRate: result.fromRate, fromChannels: result.fromChannels }, { fromRate: 44100, fromChannels: 2 })
  assert.equal(result.converted, true)
  // 时长相等的容差：一个采样点以内
  assert.ok(Math.abs(result.durationSeconds - 0.5) <= 1 / 16000 + 1e-6, `时长应保持 0.5s，实际 ${result.durationSeconds}`)
  // 归一后的字节必须是规范 WAV，能被严格校验直接接受
  const parsed = inspectWave(result.bytes)
  assert.equal(parsed.sampleRate, 16000)
  // 正弦的峰值不该被下混或插值削弱太多（允许 10% 误差）
  let peak = 0
  for (let i = 0; i < parsed.dataLength / 2; i += 1) peak = Math.max(peak, Math.abs(result.bytes.readInt16LE(parsed.dataOffset + i * 2)))
  assert.ok(peak > 12000 * 0.9 && peak <= 12001, `峰值应接近 12000，实际 ${peak}`)
})

test('24k 单声道 → 16k（降采样）与 8k → 16k（升采样）都能过严格契约', () => {
  for (const sampleRate of [24000, 8000]) {
    const result = normalizeWave(makeWave({ sampleRate, seconds: 0.25 }))
    const parsed = inspectWave(result.bytes)
    assert.equal(parsed.sampleRate, 16000)
    assert.ok(Math.abs(parsed.durationSeconds - 0.25) <= 1 / 16000 + 1e-6, `${sampleRate}Hz 归一后时长应保持`)
    assert.equal(result.converted, true)
  }
})

test('已经是规范 WAV 时不改字节（converted=false，逐字节相同）', () => {
  const source = makeWave({ sampleRate: 16000, channels: 1 })
  const result = normalizeWave(source)
  assert.equal(result.converted, false)
  assert.equal(result.bytes.equals(source), true)
})

test('非 PCM / 非 16 位 / 损坏的输入照样拒绝，不猜', () => {
  assert.throws(() => normalizeWave(makeWave({ format: 3 })), /未压缩 PCM/)
  assert.throws(() => normalizeWave(makeWave({ bits: 8 })), /16 位/)
  assert.throws(() => normalizeWave(Buffer.from('not a wave at all, just text')), /WAV/)
  assert.throws(() => normalizeWave(Buffer.alloc(10)), /太短/)
  const stereo = makeWave({ channels: 2 })
  const truncated = stereo.subarray(0, stereo.length - 40)
  // 截断只影响尾部采样，仍然可解析；改成把 fmt 段挖掉才是真损坏
  const noFmt = Buffer.concat([stereo.subarray(0, 12), stereo.subarray(36)])
  assert.throws(() => normalizeWave(noFmt), AudioInputError)
})

test('体积与时长上限在归一前后都生效', () => {
  const source = makeWave({ sampleRate: 44100, channels: 2, seconds: 1 })
  assert.throws(() => normalizeWave(source, { maxBytes: 1024 }), /大小上限/)
  assert.throws(() => normalizeWave(source, { maxSeconds: 0.1 }), /时长上限/)
})

/** 假引擎：记录"引擎真正读到的那个 wav 文件"，用来证明喂进去的是归一后的字节。 */
function fakeEngine() {
  const state = { calls: 0, seen: null, seenBytes: null }
  const engine = {
    info: { id: 'sensevoice', name: 'SenseVoiceSmall（本地）', location: 'host-local', languages: ['auto', 'zh', 'en'] },
    status: () => ({ id: 'sensevoice', ready: true, preparing: false, precision: 'int8', model: { directory: '/m', bytes: { have: 1, total: 1 }, files: [] }, worker: { running: false } }),
    prepare: async () => ({ ready: true }),
    transcribe: async request => {
      state.calls += 1
      state.seen = request
      state.seenBytes = readFileSync(request.wavPath)
      return { text: '识别到的文字', audioSeconds: 0.5, inferenceSeconds: 0.1 }
    },
    cancelPrepare: () => {},
  }
  return { engine, state }
}

function makeService(t, { config = {} } = {}) {
  const dir = tempDir(t)
  const configStore = createConfigStore(dir)
  if (Object.keys(config).length > 0) configStore.save(config)
  const engines = createEngineRegistry()
  const { engine, state } = fakeEngine()
  engines.register(engine)
  const { service } = createAsrService({ stateDir: dir, configStore, engines, engine })
  return { dir, service, state, configStore }
}

test('面板通道保持严格：44.1k 输入直接报错（错误文案可照做）', async t => {
  const { service } = makeService(t)
  await assert.rejects(
    () => service.transcribe({ audioBytes: makeWave({ sampleRate: 44100 }), source: 'panel' }),
    error => {
      assert.equal(error.code, 'ASR_AUDIO_INVALID')
      assert.match(error.message, /16000Hz/, '要说清当前采样率，用户才知道该转成什么')
      return true
    },
  )
  // 双声道也拦（严格契约的每一条都要能报出来）
  await assert.rejects(
    () => service.transcribe({ audioBytes: makeWave({ sampleRate: 16000, channels: 2 }), source: 'panel' }),
    error => {
      assert.equal(error.code, 'ASR_AUDIO_INVALID')
      assert.match(error.message, /单声道/)
      return true
    },
  )
})

test('组件通道：44.1k 双声道喂进来，引擎读到的是 16k 单声道，且响应/审计标明转换过', async t => {
  const { dir, service, state } = makeService(t)
  const result = await service.transcribe({ audioBytes: makeWave({ sampleRate: 44100, channels: 2 }), source: 'qq', acceptNonCanonical: true })
  assert.equal(result.text, '识别到的文字')
  assert.equal(result.ok, true)
  assert.deepEqual(result.converted, { fromRate: 44100, fromChannels: 2 }, '响应要回传转换痕迹')
  const parsed = inspectWave(state.seenBytes)
  assert.equal(parsed.sampleRate, 16000, '引擎读到的是归一后的音频')
  const audit = readFileSync(join(dir, 'data', 'audit.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const row = audit[audit.length - 1]
  assert.equal(row.source, 'qq')
  assert.deepEqual(row.converted, { fromRate: 44100, fromChannels: 2 }, '审计要留下"这条是转换来的"')
})

test('组件通道：规范化输入不产生 converted 字段（不制造假痕迹）', async t => {
  const { service } = makeService(t)
  const result = await service.transcribe({ audioBytes: makeWave({ sampleRate: 16000 }), source: 'qq', acceptNonCanonical: true })
  assert.equal(result.converted, undefined)
})

test('组件通道：非 PCM 仍然拒绝（放宽不等于什么都收）', async t => {
  const { service } = makeService(t)
  await assert.rejects(
    () => service.transcribe({ audioBytes: makeWave({ sampleRate: 44100, format: 3 }), source: 'qq', acceptNonCanonical: true }),
    error => {
      assert.equal(error.code, 'ASR_AUDIO_INVALID')
      assert.match(error.message, /16000Hz|PCM/, '归一失败时要给出原始的、能照做的错误')
      return true
    },
  )
})

test('内部接口默认放宽，显式 acceptCanonicalOnly 时回到严格', async t => {
  const { service, state } = makeService(t)
  const handler = createInternalHandler(service)
  const loose = await handler({ method: 'POST', path: '/transcribe', body: { audio: makeWave({ sampleRate: 44100, channels: 2 }).toString('base64'), source: 'qq' } })
  assert.equal(loose.ok, true)
  assert.equal(inspectWave(state.seenBytes).sampleRate, 16000, '组件通道默认会归一')

  const strict = await handler({ method: 'POST', path: '/transcribe', body: { audio: makeWave({ sampleRate: 44100 }).toString('base64'), acceptCanonicalOnly: true } })
    .then(() => null, error => error)
  assert.ok(strict, '严格模式下 44.1k 应失败')
  assert.equal(strict.code, 'ASR_AUDIO_INVALID')
})
