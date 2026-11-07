import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { prepareStateDir, projectHome, resolveComponentPath } from '../plugins/_shared/paths.mjs'
import { surfcoreEnvironment } from '../scripts/lib/surfcore.mjs'

function fixture(t) {
  const parent = resolve('.artifacts/test-tmp')
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(join(parent, 'component-paths-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

test('component paths require an absolute DSH_HOME and absolute overrides', t => {
  const root = fixture(t)
  assert.throws(() => projectHome({}), /DSH_HOME 必须是绝对路径/)
  assert.throws(() => projectHome({ DSH_HOME: 'relative/home' }), /DSH_HOME 必须是绝对路径/)
  assert.equal(projectHome({ DSH_HOME: root }), resolve(root))
  assert.equal(resolveComponentPath({ DSH_MEMORY_STATE_DIR: join(root, 'memory') }, 'DSH_MEMORY_STATE_DIR', join(root, 'fallback')), join(root, 'memory'))
  assert.equal(resolveComponentPath({}, 'DSH_MEMORY_STATE_DIR', join(root, 'fallback')), join(root, 'fallback'))
  assert.throws(() => resolveComponentPath({ DSH_MEMORY_STATE_DIR: 'relative' }, 'DSH_MEMORY_STATE_DIR', join(root, 'fallback')), /必须是绝对路径/)
  writeFileSync(join(root, 'file'), '')
  assert.throws(() => prepareStateDir(join(root, 'file'), '状态目录'), /不是目录/)
})

test('the split runtime injects component state paths inside DSH_HOME and preserves explicit overrides', t => {
  const root = fixture(t)
  const defaults = surfcoreEnvironment(root, { PATH: '/bin' })
  const home = join(root, '.artifacts', 'dsh-home')
  assert.equal(defaults.DSH_MEMORY_STATE_DIR, join(home, 'memory'))
  assert.equal(defaults.DSH_VOICE_STATE_DIR, join(home, 'voice'))
  assert.equal(defaults.DSH_QQ_PUBLIC_FEED, join(home, 'memory', 'inbox', 'qq-public-feed.jsonl'))
  assert.equal(defaults.DSH_BILI_DYNAMICS_CACHE, join(home, 'memory', 'data', 'bili-dynamics-cache.json'))
  assert.equal(defaults.DSH_ALIGNMENTS_FILE, join(home, 'memory', 'inbox', 'alignments.json'))
  assert.equal(defaults.DSH_SESSION_LEGACY_FILE, join(home, 'memory', 'inbox', 'social-v2.json'))
  assert.equal(defaults.SURFCORE_CONFIG_FILE, join(root, 'plugins', 'surfcore', 'config.json'))
  assert.equal(defaults.SURFCORE_CONSOLE_TOKEN_FILE, join(root, 'plugins', 'surfcore', 'state', 'console-token'))
  const customHome = join(root, 'custom-home'), customVoice = join(root, 'voice-state')
  const custom = surfcoreEnvironment(root, { DSH_HOME: customHome, DSH_VOICE_STATE_DIR: customVoice })
  assert.equal(custom.DSH_MEMORY_STATE_DIR, join(customHome, 'memory'))
  assert.equal(custom.DSH_VOICE_STATE_DIR, customVoice)
  assert.equal(custom.DSH_QQ_PUBLIC_FEED, join(customHome, 'memory', 'inbox', 'qq-public-feed.jsonl'))
  const withSubject = surfcoreEnvironment(root, { DSH_SUBJECT_ID: 'subject_00000000-0000-4000-8000-000000000001' })
  assert.equal(withSubject.DSH_SUBJECT_ID, 'subject_00000000-0000-4000-8000-000000000001')
})

test('memory and voice plugins start from their own env-driven state directories', async t => {
  const root = fixture(t), home = join(root, 'dsh-home')
  const memoryDir = join(root, 'custom-memory'), voiceDir = join(root, 'custom-voice')
  const previous = { DSH_HOME: process.env.DSH_HOME, DSH_MEMORY_STATE_DIR: process.env.DSH_MEMORY_STATE_DIR, DSH_VOICE_STATE_DIR: process.env.DSH_VOICE_STATE_DIR }
  process.env.DSH_HOME = home
  process.env.DSH_MEMORY_STATE_DIR = memoryDir
  process.env.DSH_VOICE_STATE_DIR = voiceDir
  const effects = []
  t.after(async () => {
    for (const effect of effects) await effect()()
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  })
  const ctx = {
    webServer: { port: 3082, register: () => () => {} },
    get: () => ({ requestRejection: () => null }),
    inject: () => {},
    effect: effect => effects.push(effect),
  }
  const memory = await import('../plugins/memory/src/index.mjs')
  memory.apply(ctx)
  const voice = await import('../plugins/voice/src/index.mjs')
  voice.apply(ctx)
  assert.ok(existsSync(memoryDir), 'memory must use DSH_MEMORY_STATE_DIR')
  assert.ok(existsSync(voiceDir), 'voice must use DSH_VOICE_STATE_DIR')
  assert.ok(existsSync(join(home, 'memory', 'runtime.json')), 'component discovery stays under DSH_HOME')
  assert.ok(existsSync(join(home, 'voice', 'runtime.json')), 'component discovery stays under DSH_HOME')
})
