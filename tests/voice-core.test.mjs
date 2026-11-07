import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  inspectAudio,
  listAudioFiles,
  parseTargetKey,
  resolveAudioProcessing,
  resolveAudioSource,
  resolveFfmpeg,
  safeJoinLibrary,
  sanitizeUploadName,
  AUDIO_EXTS,
} from '../plugins/voice/src/voice-core.mjs'
import * as sendVoiceLib from '../plugins/voice/src/send-voice-lib.mjs'

test('voice core target keys reject zero and non-numeric ids', () => {
  assert.deepEqual(parseTargetKey('group:123'), { kind: 'group', id: '123', key: 'group:123' })
  assert.deepEqual(parseTargetKey(' private:1 '), { kind: 'private', id: '1', key: 'private:1' })
  for (const value of ['group:0', 'group:007', 'group:', 'friend:1', '', null]) assert.equal(parseTargetKey(value), null)
})

test('voice core audio library resolution stays inside the library', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-core-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const library = join(dir, 'audio'); mkdirSync(join(library, 'sub'), { recursive: true })
  writeFileSync(join(library, '晚安.silk'), 'audio')
  writeFileSync(join(library, 'sub', 'hello.mp3'), 'audio')
  writeFileSync(join(library, 'notes.txt'), 'text')
  writeFileSync(join(library, '.hidden.mp3'), 'audio')
  assert.deepEqual(new Set(listAudioFiles(library).map(file => file.slice(library.length + 1))), new Set(['晚安.silk', 'sub/hello.mp3']))
  assert.equal(resolveAudioSource('晚安', { voiceDir: library }).via, 'voice-dir+ext')
  const fuzzy = resolveAudioSource('hello.mp3', { voiceDir: library, cwd: dir })
  assert.equal(fuzzy.via, 'not-found')
  assert.deepEqual(fuzzy.candidates.map(item => item.via), ['voice-dir-fuzzy'])
  assert.equal(resolveAudioSource('missing', { voiceDir: library }).path, null)
  assert.ok(safeJoinLibrary(library, 'sub/hello.mp3'))
  assert.equal(safeJoinLibrary(library, '../outside.mp3'), null)
  const outside = join(dir, 'outside.mp3'); writeFileSync(outside, 'audio')
  symlinkSync(outside, join(library, 'link.mp3'))
  assert.equal(safeJoinLibrary(library, 'link.mp3'), null)
  assert.equal(sanitizeUploadName('../a:b?.mp3'), 'a_b_.mp3')
})

test('voice core inspects silk without ffprobe and rejects empty or oversized files', async t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-inspect-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const silk = join(dir, 'voice.silk'); writeFileSync(silk, 'audio')
  const result = await inspectAudio(silk)
  assert.equal(result.ok, true)
  assert.equal(result.codec, 'silk')
  assert.equal(result.duration, null)
  const empty = join(dir, 'empty.wav'); writeFileSync(empty, '')
  assert.match((await inspectAudio(empty)).error, /空/)
  assert.match((await inspectAudio(silk, { maxBytes: 2 })).error, /过大/)
  assert.match((await inspectAudio(join(dir, 'missing.silk'))).error, /不存在/)
})

test('voice core audio processing validates volume and loudness', () => {
  assert.deepEqual(resolveAudioProcessing({}), { volume: 1, loudness: null, loudnessKey: null })
  assert.deepEqual(resolveAudioProcessing({ volume: 2 }), { volume: 2, loudness: null, loudnessKey: null })
  assert.deepEqual(resolveAudioProcessing({ normalize: true, loudness: 'quiet' }), { volume: 1, loudness: -20, loudnessKey: 'quiet' })
  assert.deepEqual(resolveAudioProcessing({ normalize: true, loudness: -18 }), { volume: 1, loudness: -18, loudnessKey: '-18' })
  assert.throws(() => resolveAudioProcessing({ volume: 5 }), /0\.1~4/)
  assert.throws(() => resolveAudioProcessing({ normalize: true, loudness: 'loudest' }), /未知的响度档位/)
  assert.throws(() => resolveAudioProcessing({ normalize: true, loudness: -50 }), /-40 ~ -5/)
})

test('voice core exposes the stable send-voice re-export layer', () => {
  assert.deepEqual(sendVoiceLib.AUDIO_EXTS, AUDIO_EXTS)
  assert.equal(typeof sendVoiceLib.inspectAudio, 'function')
  assert.equal(typeof sendVoiceLib.processAudioVolume, 'function')
})

test('voice core resolves an existing ffmpeg path and falls back to PATH', t => {
  const base = resolve('.artifacts/test-tmp'); mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'voice-ffmpeg-')); t.after(() => rmSync(dir, { recursive: true, force: true }))
  const ffmpeg = join(dir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  writeFileSync(ffmpeg, 'binary')
  assert.equal(resolveFfmpeg({ ffmpegPath: ffmpeg }), ffmpeg)
  assert.equal(resolveFfmpeg({ ffmpegPath: join(dir, 'missing') }), 'ffmpeg')
})
