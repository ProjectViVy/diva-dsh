import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import test from 'node:test'

import { createVoiceService } from '../plugins/voice/src/service.mjs'

/**
 * 世界网关与语音插件在同一个宿主进程里。合成必须走进程内服务，不能走 HTTP——
 * 服务端发起的 HTTP 请求没有浏览器会话，会被网关的会话校验拒成 401。
 *
 * 这组测试盯的就是这条：`fetchImpl` 故意写成「一旦被调用就失败」，
 * 只要实现悄悄退回 HTTP，测试立刻红，而不是等真机上出现一句难懂的 401。
 */

/** 24kHz 单声道 16bit 的静音 wav，头里的长度是真实值（不是占位值）。 */
function silenceWav(samples = 24000) {
  const data = Buffer.alloc(samples * 2)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii'); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28)
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii'); header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** 任何一次 HTTP 都算失败：这条线路一次网络请求都不该发。 */
const noNetwork = async () => { throw new Error('不应该走 HTTP') }

function make(t, { wired = false, ...options } = {}) {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-gateway-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    voice: {
      tts: {
        route: 'dashscope', enabled: true, character: 'Cherry',
        endpoints: { dashscope: 'http://127.0.0.1:3082/dsh-capability-hub/api' },
      },
    },
  }))
  // 世界网关包只有接线后才会出现在列表里：判据是包目录里有没有 config.toml。
  if (wired) {
    const pack = join(dir, 'packs', 'voice-dashscope')
    mkdirSync(pack, { recursive: true })
    writeFileSync(join(pack, 'config.toml'), '[engine]\nendpoint = "http://127.0.0.1:3082/dsh-capability-hub/api"\n')
  }
  return { dir, service: createVoiceService({ stateDir: dir, ...options }) }
}

test('世界网关线路优先走进程内服务，一次 HTTP 都不发', async t => {
  const calls = []
  const hub = {
    speak: async (capability, input) => {
      calls.push({ capability, ...input })
      return { audio: silenceWav(24000), durationMs: 1000, mime: 'audio/wav', format: 'wav', model: 'qwen3-tts-flash', voice: 'Cherry' }
    },
  }
  const { service } = make(t, { getHub: () => hub, fetchImpl: noNetwork })

  const result = await service.synthesize({ text: '你好', voice: 'Cherry' })

  assert.equal(calls.length, 1, '应该只调用一次进程内服务')
  assert.equal(calls[0].capability, 'tts')
  assert.equal(calls[0].text, '你好')
  assert.equal(calls[0].voice, 'Cherry')
  assert.equal(result.durationMs, 1000)
  assert.ok(result.path.endsWith('.wav'))
  assert.ok(readFileSync(result.path).length > 44)
})

test('进程内服务不可用时退回 HTTP，不至于整条线路瘫痪', async t => {
  const seen = []
  const wav = silenceWav(12000)
  const { service } = make(t, {
    getHub: () => undefined,
    fetchImpl: async (url) => {
      seen.push(url)
      return new Response(wav, { status: 200, headers: { 'content-type': 'audio/wav', 'x-duration-ms': '500' } })
    },
  })

  const result = await service.synthesize({ text: '退回 http', voice: 'Cherry' })

  assert.equal(seen.length, 1)
  assert.match(seen[0], /\/tts$/, '网关的合成路径是 /tts，不是 voxd 的 /v1/speak/file')
  assert.equal(result.durationMs, 500)
})

test('进程内服务的报错原文透出去，不被吞成「未知错误」', async t => {
  const error = Object.assign(new Error('缺少凭据：DASHSCOPE_API_KEY 还没填'), { status: 502, code: 'SYNTHESIS_FAILED' })
  const { service } = make(t, { getHub: () => ({ speak: async () => { throw error } }), fetchImpl: noNetwork })

  await assert.rejects(service.synthesize({ text: '会失败' }), /缺少凭据：DASHSCOPE_API_KEY 还没填/)
})

test('网关线路不会因为拿不到服务而退回本机 voxd 端口', async t => {
  const seen = []
  const { service } = make(t, {
    getHub: () => undefined,
    fetchImpl: async (url) => {
      seen.push(url)
      return new Response(silenceWav(1200), { status: 200, headers: { 'x-duration-ms': '50' } })
    },
  })
  await service.synthesize({ text: '别连本地' })
  assert.ok(!seen.some(url => url.includes('8765') || url.includes('8767')), `不该打本地端口：${seen.join(', ')}`)
})

/**
 * 「世界网关语音包在不在跑」原先由一次 fetch 网关 /health 决定。
 * 那是服务端请求，没有浏览器会话 → 永远 401 → 面板上这个包永远显示没跑起来。
 * 现在改成问进程内的服务；这组测试用「一 fetch 就失败」把回归钉住。
 */
test('世界网关语音包的在跑状态来自进程内服务，不发任何 HTTP', async t => {
  const { service } = make(t, {
    wired: true,
    getHub: () => ({ status: async capability => ({ capability, ready: true, model: 'qwen3-tts-flash' }) }),
    fetchImpl: noNetwork,
  })

  const listed = await service.list()
  const pack = listed.packs.find(item => item.id === 'voice-dashscope')
  assert.ok(pack, '列表里应该出现世界网关语音包')
  assert.equal(pack.running, true, `应该显示在跑，实际：${JSON.stringify(pack)}`)
})

test('网关没就绪时如实显示原因，而不是假装在跑', async t => {
  const { service } = make(t, {
    wired: true,
    getHub: () => ({ status: async capability => ({ capability, ready: false, error: '缺少凭据：DASHSCOPE_API_KEY 还没填' }) }),
    fetchImpl: noNetwork,
  })

  const listed = await service.list()
  const pack = listed.packs.find(item => item.id === 'voice-dashscope')
  assert.equal(pack.running, false)
  assert.match(JSON.stringify(pack), /DASHSCOPE_API_KEY/)
})

