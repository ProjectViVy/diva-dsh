// 「世界网关（千问）」识别引擎的契约。
//
// 它只做三件事：报就绪、把规范 wav 交给进程内的 capabilityHub、把错误说成人话。
// 这里用假 hub 把这三件事钉住，不联网、不落盘。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { createGatewayEngine } from '../plugins/asr/src/engine-gateway.mjs'

const WAV = Buffer.from('RIFF....WAVEfmt ')

function tempWav(t) {
  const dir = mkdtempSync(join(resolve('.artifacts/test-tmp'), 'asr-gateway-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const file = join(dir, 'clip.wav')
  writeFileSync(file, WAV)
  return file
}

test('引擎自报是云端来源，且只承诺自动语言（不假装支持 zh/en）', () => {
  const engine = createGatewayEngine({ getHub: () => undefined })
  assert.equal(engine.info.id, 'gateway')
  assert.equal(engine.info.location, 'cloud')
  assert.deepEqual(engine.info.languages, ['auto'])
})

test('网关没挂载时 status 如实说没挂载，而不是假装就绪', async () => {
  const engine = createGatewayEngine({ getHub: () => undefined })
  await engine.prepare().catch(() => {})
  const status = engine.status()
  assert.equal(status.ready, false)
  assert.match(status.error, /没挂载/)
})

test('网关说插槽没启用时，原因原样带出来（面板要能指出缺什么）', async () => {
  const engine = createGatewayEngine({
    getHub: () => ({ status: async () => ({ capability: 'asr', ready: false, error: '世界网关的 asr 插槽没启用' }) }),
  })
  await assert.rejects(engine.prepare(), /asr 插槽没启用/)
  assert.equal(engine.status().ready, false)
  assert.match(engine.status().error, /asr 插槽没启用/)
})

test('网关就绪时 status 报就绪并带上模型名', async () => {
  const engine = createGatewayEngine({
    getHub: () => ({ status: async () => ({ capability: 'asr', ready: true, model: 'qwen-audio-3.0-asr-flash' }) }),
  })
  await engine.prepare()
  const status = engine.status()
  assert.equal(status.ready, true)
  assert.equal(status.model.name, 'qwen-audio-3.0-asr-flash')
})

test('识别时把规范 wav 的字节、格式与 16k 采样率交给网关', async t => {
  const seen = []
  const engine = createGatewayEngine({
    getHub: () => ({
      status: async () => ({ ready: true }),
      transcribe: async (capability, input) => {
        seen.push({ capability, input })
        return { text: '你好，我是diva。', model: 'qwen-audio-3.0-asr-flash', audioSeconds: 4.4 }
      },
    }),
  })
  const result = await engine.transcribe({ wavPath: tempWav(t), language: 'auto' })
  assert.equal(result.text, '你好，我是diva。')
  assert.equal(result.audioSeconds, 4.4)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].capability, 'asr')
  assert.equal(seen[0].input.format, 'wav')
  assert.equal(seen[0].input.sampleRate, 16000, 'asr 面板的规范音频就是 16k，照实告诉上游')
  assert.equal(Buffer.compare(seen[0].input.audio, WAV), 0)
})

test('网关报错时抛 AsrError 并保留原文，不吞成「未知错误」', async t => {
  const engine = createGatewayEngine({
    getHub: () => ({
      status: async () => ({ ready: true }),
      transcribe: async () => { throw Object.assign(new Error('缺少凭据：DASHSCOPE_API_KEY 还没填'), { status: 502 }) },
    }),
  })
  await assert.rejects(engine.transcribe({ wavPath: tempWav(t) }), error => {
    assert.equal(error.code, 'ASR_GATEWAY_FAILED')
    assert.equal(error.status, 502)
    assert.match(error.message, /DASHSCOPE_API_KEY/)
    return true
  })
})

test('网关整个没挂载时，识别直接报不可用并给排查提示', async t => {
  const engine = createGatewayEngine({ getHub: () => undefined })
  await assert.rejects(engine.transcribe({ wavPath: tempWav(t) }), error => {
    assert.equal(error.code, 'ASR_GATEWAY_UNAVAILABLE')
    assert.match(String(error.hint ?? ''), /capability-hub/)
    return true
  })
})

test('临时音频读不到时报音频无效，而不是网关失败', async () => {
  const engine = createGatewayEngine({ getHub: () => ({ status: async () => ({ ready: true }), transcribe: async () => ({ text: '' }) }) })
  await assert.rejects(engine.transcribe({ wavPath: join(resolve('.artifacts/test-tmp'), 'no-such-file.wav') }), error => {
    assert.equal(error.code, 'ASR_AUDIO_INVALID')
    return true
  })
})
