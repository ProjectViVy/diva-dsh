// 配置仓储与音频契约的单元测试：这两层不碰网络、不拉子进程，纯逻辑。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createConfigStore, normalizeAsr } from '../plugins/asr/src/store.mjs'
import { AudioInputError, fingerprint, inspectWave, writeTempWave } from '../plugins/asr/src/audio.mjs'
import { silentWave } from '../plugins/asr/src/service.mjs'

function tempDir(t, prefix = 'asr-store-') {
  const base = resolve('.artifacts/test-tmp')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, prefix))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/** 造一段规范 WAV：16k / 单声道 / PCM16。 */
function wave(seconds, { channels = 1, sampleRate = 16000, bits = 16, format = 1 } = {}) {
  const frames = Math.max(1, Math.round(seconds * sampleRate))
  const bytes = Buffer.alloc(44 + frames * 2 * channels)
  bytes.write('RIFF', 0, 'ascii'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8, 'ascii')
  bytes.write('fmt ', 12, 'ascii'); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(format, 20)
  bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * channels * bits / 8, 28)
  bytes.writeUInt16LE(bits / 8 * channels, 32); bytes.writeUInt16LE(bits, 34)
  bytes.write('data', 36, 'ascii'); bytes.writeUInt32LE(bytes.length - 44, 40)
  return bytes
}

test('normalizeAsr fills defaults and clamps nonsense', () => {
  const config = normalizeAsr({ limits: { maxSeconds: -5, maxBytes: 'x' }, sensevoice: { precision: 'fp16', threads: 0 }, engine: '  ' })
  assert.equal(config.limits.maxSeconds, 120)
  assert.equal(config.limits.maxBytes, 8 * 1024 * 1024)
  assert.equal(config.sensevoice.precision, 'int8')
  assert.equal(config.sensevoice.threads, 2)
  assert.equal(config.engine, 'sensevoice')
  assert.equal(config.enabled, true)
  assert.equal(config.audit, true)
})

test('normalizeAsr keeps zero as "no limit" instead of resetting it', () => {
  const config = normalizeAsr({ limits: { maxPerMinute: 0, maxPerHour: 0 }, sensevoice: { idleTimeoutMs: 0 } })
  assert.equal(config.limits.maxPerMinute, 0)
  assert.equal(config.limits.maxPerHour, 0)
  assert.equal(config.sensevoice.idleTimeoutMs, 0)
})

test('config store persists the asr section and leaves other keys alone', t => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'config.json'), `${JSON.stringify({ other: { keep: 1 }, asr: { enabled: false } }, null, 2)}\n`)
  const store = createConfigStore(dir)
  assert.equal(store.get().enabled, false)
  const saved = store.save({ limits: { maxSeconds: 30 } })
  assert.equal(saved.limits.maxSeconds, 30)
  assert.equal(saved.enabled, false)
  const disk = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
  assert.equal(disk.other.keep, 1)
  assert.equal(disk.asr.limits.maxSeconds, 30)
  assert.equal(store.reload().limits.maxSeconds, 30)
})

test('a broken config file is reported and left untouched', t => {
  const dir = tempDir(t)
  writeFileSync(join(dir, 'config.json'), '{ not json')
  assert.throws(() => createConfigStore(dir), /已保留原文件/)
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), '{ not json')
})

test('inspectWave accepts the canonical format and reports duration', () => {
  const result = inspectWave(wave(1.5), { maxBytes: 1024 * 1024, maxSeconds: 10 })
  assert.equal(result.sampleRate, 16000)
  assert.ok(Math.abs(result.durationSeconds - 1.5) < 0.01)
})

test('inspectWave rejects everything the engine cannot take as-is', () => {
  assert.throws(() => inspectWave(Buffer.from('nope')), AudioInputError)
  assert.throws(() => inspectWave(wave(0.1, { channels: 2 })), /单声道/)
  assert.throws(() => inspectWave(wave(0.1, { sampleRate: 44100 })), /16000Hz/)
  assert.throws(() => inspectWave(wave(0.1, { bits: 8 })), /16 位/)
  assert.throws(() => inspectWave(wave(0.1, { format: 3 })), /PCM/)
  const error = (() => { try { inspectWave(wave(2), { maxSeconds: 1 }); return null } catch (caught) { return caught } })()
  assert.equal(error.code, 'ASR_AUDIO_TOO_LONG')
})

test('inspectWave tolerates trailing chunks after data', () => {
  const base = wave(0.5)
  const extra = Buffer.alloc(12)
  extra.write('LIST', 0, 'ascii'); extra.writeUInt32LE(4, 4)
  const withExtra = Buffer.concat([base, extra])
  withExtra.writeUInt32LE(withExtra.length - 8, 4)
  assert.ok(Math.abs(inspectWave(withExtra).durationSeconds - 0.5) < 0.01)
})

test('fingerprint is content addressed and writeTempWave puts bytes on disk', t => {
  const dir = tempDir(t)
  const first = wave(0.2), second = wave(0.2)
  assert.equal(fingerprint(first), fingerprint(second))
  assert.notEqual(fingerprint(first), fingerprint(wave(0.3)))
  const file = writeTempWave(join(dir, 'tmp'), first, 'abc')
  assert.deepEqual(readFileSync(file), first)
})

test('silentWave produces a canonical silent recording', () => {
  const bytes = silentWave(0.4)
  const result = inspectWave(bytes)
  assert.ok(Math.abs(result.durationSeconds - 0.4) < 0.01)
  assert.ok(bytes.subarray(44).every(byte => byte === 0))
})
