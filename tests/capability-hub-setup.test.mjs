/**
 * `scripts/setup-capability-hub.mjs`：世界网关语音包的接线产物。
 *
 * 这个脚本改的是 `.artifacts/dsh-home` 下的两份状态文件，所以测试只验证
 * 「写到哪、写成什么形状、重跑会不会重复、读坏了会不会覆盖」四件事，
 * 用一个临时 DSH_HOME 跑，不碰真实状态。
 */

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const SCRIPT = join(ROOT, 'scripts', 'setup-capability-hub.mjs')

function home(t) {
  const dir = mkdtempSync(join(tmpdir(), 'hub-setup-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

function run(dir, env = {}) {
  return spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, DSH_HOME: dir, ...env }, encoding: 'utf8' })
}

test('首次运行建出语音包目录与启用的 tts 插槽', t => {
  const dir = home(t)
  const result = run(dir)
  assert.equal(result.status, 0, result.stderr)

  const packDir = join(dir, 'voice', 'packs', 'voice-dashscope')
  const config = readFileSync(join(packDir, 'config.toml'), 'utf8')
  assert.match(config, /\[engine\]/)
  assert.match(config, /endpoint = "http:\/\/127\.0\.0\.1:3082\/dsh-capability-hub\/api"/)
  assert.ok(existsSync(join(packDir, '.installed')))

  const registry = JSON.parse(readFileSync(join(dir, 'capability-hub', 'registry.json'), 'utf8'))
  assert.equal(registry.version, 1)
  assert.equal(registry.slots.tts.enabled, true)
  assert.equal(registry.slots.tts.kind, 'dashscope')
  assert.equal(registry.slots.tts.authRef, 'DASHSCOPE_API_KEY')
  assert.equal(registry.slots.tts.model, 'qwen3-tts-flash')
  // 别的插槽不能被这个脚本动过
  assert.equal(registry.slots.asr, undefined)
})

test('重跑是幂等的：文件内容不变，也不清掉已有插槽', t => {
  const dir = home(t)
  mkdirSync(join(dir, 'capability-hub'), { recursive: true })
  writeFileSync(join(dir, 'capability-hub', 'registry.json'), JSON.stringify({
    version: 1,
    slots: {
      asr: { enabled: true, kind: 'dashscope', baseURL: 'https://example.com', model: 'qwen-audio-3.0-asr-flash', authRef: 'DASHSCOPE_API_KEY', note: '' },
      tts: { enabled: false, kind: 'dashscope', baseURL: 'https://example.com', model: 'qwen-audio-3.1-tts-flash', authRef: 'DASHSCOPE_API_KEY', note: '手填的' },
    },
  }, null, 2))
  const first = run(dir)
  assert.equal(first.status, 0, first.stderr)
  const once = readFileSync(join(dir, 'capability-hub', 'registry.json'), 'utf8')
  const second = run(dir)
  assert.equal(second.status, 0, second.stderr)
  assert.equal(readFileSync(join(dir, 'capability-hub', 'registry.json'), 'utf8'), once)

  const registry = JSON.parse(once)
  assert.equal(registry.slots.tts.enabled, true)
  // 用户填过的模型与备注保留，只把开关打开
  assert.equal(registry.slots.tts.model, 'qwen-audio-3.1-tts-flash')
  assert.equal(registry.slots.tts.note, '手填的')
  assert.equal(registry.slots.asr.enabled, true)
})

test('registry 读坏时停下，不覆盖用户配置', t => {
  const dir = home(t)
  mkdirSync(join(dir, 'capability-hub'), { recursive: true })
  const file = join(dir, 'capability-hub', 'registry.json')
  writeFileSync(file, '{ not json')
  const result = run(dir)
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /不是合法 JSON/)
  assert.equal(readFileSync(file, 'utf8'), '{ not json')
})

test('模型与 baseURL 可以用环境变量指定', t => {
  const dir = home(t)
  const result = run(dir, { DSH_TTS_MODEL: 'qwen-audio-3.1-tts-flash', DSH_TTS_BASE_URL: 'https://abc.cn-beijing.maas.aliyuncs.com' })
  assert.equal(result.status, 0, result.stderr)
  const registry = JSON.parse(readFileSync(join(dir, 'capability-hub', 'registry.json'), 'utf8'))
  assert.equal(registry.slots.tts.model, 'qwen-audio-3.1-tts-flash')
  assert.equal(registry.slots.tts.baseURL, 'https://abc.cn-beijing.maas.aliyuncs.com')
})

test('没有 DSH_HOME 时拒绝运行，别往别处写', t => {
  const dir = home(t)
  const result = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, DSH_HOME: '' }, encoding: 'utf8' })
  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /DSH_HOME/)
})
